import { z } from "zod";
import { clarificationSchema, codeSchema, compositionPromptSchema, generatedSchema, type requestSchema } from "../lib/schema";
import { aiMachineRefineSchema, aiNodeMachineSchema, aiRevisionSchema, aiSceneSchema, aiTransformSchema } from "../lib/scene/ai-schema";
import { convertMachine, convertScene, convertTransformation, mergeAIAlgorithms } from "../lib/scene/convert";
import { descendantIds, findNode, updateNode } from "../lib/scene/graph";
import { conformMachine, validateMachine } from "../lib/scene/machines";
import { settleProposal, validateSceneProposal } from "../lib/scene/revisions";
import { canAddTransformation, placeTransformation } from "../lib/scene/transformations";
import { validateScene } from "../lib/scene/validate";
import { sceneBindings, sceneValues } from "../lib/scene/values";
import { connectScene } from "./scene-code.server";
import { inspectResultSchema, type InspectResult } from "../lib/inspection";
import { prepareCode } from "./code.server";

// One entry per AI intent: its structured output schema, prompt file, budget,
// preconditions, the request context and how the model output is finalized.

export type AIInput = z.infer<typeof requestSchema>;
type Intent = {
  schema: z.ZodType; maxTokens: (input: AIInput) => number; effort?: "low" | "medium";
  /** Returns an error message when the request cannot run. */
  check?: (input: AIInput) => string | void;
  context: (input: AIInput) => Record<string, unknown>;
  /** Attach the sketch's pen/stroke context as a separate part. */
  strokes?: boolean;
  finalize?: (input: AIInput, output: any) => unknown;
};

const canvas = { width: 900, height: 600 };
const strokeContext = (input: AIInput) => ({ compositionPens: input.compositionPens, compositionStrokes: input.compositionStrokes, canvas });
const targetNode = (input: AIInput) => input.scene && findNode(input.scene, input.targetNodeId);
const needsTarget = (input: AIInput) => !targetNode(input) ? "대상 Collection 또는 Object를 찾지 못했습니다." : undefined;
/** The modules the code must define: one per root node, with the node ids it draws. */
const codeModules = (scene: NonNullable<AIInput["scene"]>) => scene.nodes.filter(node => !node.parentId).map(root => ({ key: root.id, nodes: [root.id, ...descendantIds(scene, root.id)] }));
const needsScene = (input: AIInput) => !input.scene?.nodes.length ? "먼저 스케치에서 collection과 object를 추출해주세요." : undefined;

export const intents: Record<"extract" | "compose" | "transform" | "state-machine" | "machine-refine" | "inspect" | "code" | "compose-prompt" | "clarification" | "revision", Intent> = {
  extract: {
    schema: aiSceneSchema, maxTokens: () => 40000, strokes: true,
    check: input => !input.image ? "분석할 이미지가 없습니다." : undefined,
    context: input => ({ instruction: input.instruction }),
    finalize: (_input, output) => convertScene(output),
  },
  compose: {
    schema: aiSceneSchema, maxTokens: () => 44000, strokes: true,
    check: input => !input.image || !input.instruction.trim() ? "스케치와 Compose prompt가 필요합니다." : undefined,
    context: input => ({ instruction: input.instruction, ...strokeContext(input) }),
    finalize: (_input, output) => convertScene(output),
  },
  transform: {
    schema: aiTransformSchema, maxTokens: () => 10000,
    check: input => needsTarget(input) || (!input.targetPropertyId && !input.targetTransformationId && !canAddTransformation(targetNode(input)!) ? "이 노드에는 더 이상 semantic transformation을 추가할 수 없습니다." : undefined),
    context: input => ({ scene: input.scene, targetNodeId: input.targetNodeId, targetTransformationId: input.targetTransformationId, targetPropertyId: input.targetPropertyId,
      mode: input.targetPropertyId ? "property" : input.targetTransformationId ? "replace" : "add", alternative: input.alternative, instruction: input.instruction, annotationMarks: input.transformMarks, canvas }),
    finalize: (input, output: z.infer<typeof aiTransformSchema>) => {
      const scene = input.scene!, { library, ids } = mergeAIAlgorithms(scene.algorithms, output.algorithms);
      const generated = convertTransformation(output.transformation, library, ids);
      const target = { transformationId: input.targetTransformationId || undefined, propertyId: input.targetPropertyId || undefined };
      return validateScene(updateNode({ ...scene, algorithms: library }, input.targetNodeId, node => conformMachine(placeTransformation(node, generated, target))));
    },
  },
  "state-machine": {
    schema: aiNodeMachineSchema, maxTokens: () => 32000, effort: "medium", strokes: true, check: needsTarget,
    context: input => ({ scene: input.scene, targetNodeId: input.targetNodeId, instruction: input.instruction, previous: input.previous }),
    finalize: (input, output: z.infer<typeof aiNodeMachineSchema>) => {
      const scene = input.scene!, { library, ids } = mergeAIAlgorithms(scene.algorithms, output.algorithms);
      const machine = convertMachine(output.machine, library, ids);
      validateMachine(findNode(scene, input.targetNodeId)!, machine);
      return validateScene(updateNode({ ...scene, algorithms: library }, input.targetNodeId, node => ({ ...node, machine })));
    },
  },
  "machine-refine": {
    schema: aiMachineRefineSchema, maxTokens: () => 32000, effort: "medium", strokes: true,
    check: input => {
      const node = targetNode(input), target = input.machineTarget, machine = node ? node.machine : null;
      if (!node) return "대상 Collection 또는 Object를 찾지 못했습니다.";
      if (!machine) return "먼저 이 노드의 상태 머신을 만들어주세요.";
      if (target && !(target.kind === "state" ? machine.states : machine.transitions).some(item => item.id === target.id)) return "첨부한 state 또는 transition을 찾지 못했습니다.";
      if (!input.instruction.trim() && !input.machineMarks.length) return "어떻게 바꿀지 적거나 상태 머신 위에 annotation을 그려주세요.";
    },
    context: input => {
      const machine = targetNode(input)!.machine!, target = input.machineTarget;
      const attached = target ? { kind: target.kind, ...(target.kind === "state" ? machine.states : machine.transitions).find(item => item.id === target.id) } : null;
      return { scene: input.scene, targetNodeId: input.targetNodeId, attached, instruction: input.instruction, annotationMarks: input.machineMarks, composePrompt: input.composePrompt, previous: input.previous };
    },
    finalize: (input, output: z.infer<typeof aiMachineRefineSchema>) => {
      const scene = input.scene!, { library, ids } = mergeAIAlgorithms(scene.algorithms, output.algorithms);
      const machine = convertMachine(output.machine, library, ids);
      validateMachine(findNode(scene, input.targetNodeId)!, machine);
      return { scene: validateScene(updateNode({ ...scene, algorithms: library }, input.targetNodeId, node => ({ ...node, machine }))), composePrompt: output.composePrompt.trim() || input.composePrompt };
    },
  },
  inspect: {
    schema: inspectResultSchema, maxTokens: () => 16000, effort: "medium",
    check: input => !input.scene || !input.inspection ? "검사할 brush와 기록이 필요합니다." : !input.instruction.trim() && !input.inspection.marks.length ? "알고 싶은 점을 적거나 Inspection annotation으로 표시해주세요." : undefined,
    context: input => ({ concern: input.instruction, brush: input.inspection!.brushName, brushNodes: input.scene!.nodes.filter(node => input.inspection!.nodeIds.includes(node.id)),
      algorithms: input.scene!.algorithms, constraints: input.inspection!.constraints, steps: input.inspection!.steps, currentStep: input.inspection!.cursor, annotationMarks: input.inspection!.marks, canvas }),
    /** Drop anything that points outside the brush, so overlays and fixes stay applicable. */
    finalize: (input, output: InspectResult) => {
      const nodes = new Map(input.scene!.nodes.filter(node => input.inspection!.nodeIds.includes(node.id)).map(node => [node.id, node]));
      const keys = new Set(input.inspection!.constraints.map(row => row.key));
      const linked = (kind: string, nodeId: string, id: string) => {
        const node = nodes.get(nodeId); if (!node) return false;
        if (kind === "constraint") return input.inspection!.constraints.some(row => row.nodeId === nodeId && row.propertyId === id);
        if (kind === "transformation") return node.transformations.some(item => item.id === id);
        return Boolean((kind === "state" ? node.machine?.states : node.machine?.transitions)?.some(item => item.id === id));
      };
      const change = (item: { key: string; stateId: string; nodeId?: string }) => keys.has(item.key) && (!item.stateId || [...nodes.values()].some(node => node.machine?.states.some(state => state.id === item.stateId)));
      return { ...output, overlays: output.overlays.filter(item => linked(item.link.kind, item.link.nodeId, item.link.id)), valueFixes: output.valueFixes.filter(change),
        recommendations: output.recommendations.filter(item => item.kind === "value" ? item.changes.length > 0 : linked(item.kind, item.nodeId, item.targetId)).map(item => ({ ...item, changes: item.changes.filter(change) })) };
    },
  },
  code: {
    schema: codeSchema, strokes: true, check: needsScene,
    maxTokens: input => input.scene?.nodes.some(node => node.machine) ? 32000 : 24000,
    context: input => ({ scene: input.scene, modules: codeModules(input.scene!), parameterBindings: sceneBindings(input.scene!), parameterValues: sceneValues(input.scene!), previous: input.previous, instruction: input.instruction,
      ...(input.annotations.length ? { annotations: input.annotations, confirmedRevisionSummary: input.revisionSummary } : {}) }),
    finalize: (input, output: z.infer<typeof codeSchema>) => {
      const generated = generatedSchema.parse(connectScene(output, input.scene!));
      prepareCode(generated.code);
      return generated;
    },
  },
  "compose-prompt": {
    schema: compositionPromptSchema, maxTokens: () => 2000,
    check: input => !input.image ? "프롬프트를 만들 스케치 이미지가 필요합니다." : undefined,
    context: input => ({ instruction: input.instruction, ...strokeContext(input) }),
  },
  clarification: {
    schema: clarificationSchema, maxTokens: () => 2000,
    check: input => !input.image || !input.resultImage || !input.previous || !input.annotations.length ? "설명을 만들 결과 이미지와 annotation 스케치가 필요합니다." : undefined,
    context: input => ({ scene: input.scene, previous: input.previous, instruction: input.instruction, annotations: input.annotations }),
  },
  revision: {
    schema: aiRevisionSchema, maxTokens: () => 40000,
    check: input => needsScene(input) || (!input.image || !input.previous || !input.annotations.length || !input.instruction.trim() ? "결과 위의 스케치와 text clarification을 입력해주세요." : undefined),
    context: input => ({ scene: input.scene, previous: input.previous, instruction: input.instruction, annotations: input.annotations }),
    finalize: (input, output: z.infer<typeof aiRevisionSchema>) => {
      const current = input.scene!, proposed = settleProposal(current, convertScene(output, current.algorithms));
      validateSceneProposal(current, proposed);
      return { summary: output.summary, scene: proposed };
    },
  },
};
export type IntentName = keyof typeof intents;
export const isIntent = (name: string): name is IntentName => name in intents;
/** JSON schema sent as the structured output format; `npm run prompts:schemas` writes it to prompts/schemas. */
export const outputSchema = (intent: IntentName) => z.toJSONSchema(intents[intent].schema, { target: "draft-7" });
