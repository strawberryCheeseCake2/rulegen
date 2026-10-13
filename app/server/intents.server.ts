import { z } from "zod";
import { clarificationSchema, codeSchema, compositionPromptSchema, generatedSchema, type requestSchema } from "../lib/schema";
import { aiNodeMachineSchema, aiRevisionSchema, aiSceneSchema, aiTransformSchema } from "../lib/scene/ai-schema";
import { convertMachine, convertScene, convertTransformation, mergeAIAlgorithms } from "../lib/scene/convert";
import { findNode, updateNode } from "../lib/scene/graph";
import { conformMachine, validateMachine } from "../lib/scene/machines";
import { collapseRepeats, repeatedSiblings, repeatFeedback } from "../lib/scene/procedural";
import { settleProposal, validateSceneProposal, type SceneProposal } from "../lib/scene/revisions";
import type { Scene } from "../lib/scene/schema";
import { canAddTransformation, placeTransformation } from "../lib/scene/transformations";
import { validateScene } from "../lib/scene/validate";
import { sceneBindings, sceneValues } from "../lib/scene/values";
import { connectScene } from "./scene-code.server";
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
  /**
   * Rules the finalized result must satisfy beyond its schema. A problem gets one
   * AI repair round with `feedback`; if that still fails, `repair` fixes it deterministically.
   */
  review?: (input: AIInput, result: any) => { feedback: string; repair: () => unknown } | null;
};

const canvas = { width: 900, height: 600 };
const strokeContext = (input: AIInput) => ({ compositionPens: input.compositionPens, compositionStrokes: input.compositionStrokes, canvas });
const targetNode = (input: AIInput) => input.scene && findNode(input.scene, input.targetNodeId);
const needsTarget = (input: AIInput) => !targetNode(input) ? "대상 Collection 또는 Object를 찾지 못했습니다." : undefined;
/** Repeated sibling nodes must become one procedural node (see contracts/scene-model). */
function proceduralReview(scene: Scene, among?: Set<string>) {
  const groups = repeatedSiblings(scene, among);
  return groups.length ? { feedback: repeatFeedback(groups), repair: () => validateScene(collapseRepeats(scene, groups)) } : null;
}
const needsScene = (input: AIInput) => !input.scene?.nodes.length ? "먼저 스케치에서 collection과 object를 추출해주세요." : undefined;

export const intents: Record<"extract" | "compose" | "transform" | "state-machine" | "code" | "compose-prompt" | "clarification" | "revision", Intent> = {
  extract: {
    schema: aiSceneSchema, maxTokens: () => 20000, strokes: true,
    check: input => !input.image ? "분석할 이미지가 없습니다." : undefined,
    context: input => ({ instruction: input.instruction }),
    finalize: (_input, output) => convertScene(output),
    review: (_input, scene: Scene) => proceduralReview(scene),
  },
  compose: {
    schema: aiSceneSchema, maxTokens: () => 24000, strokes: true,
    check: input => !input.image || !input.instruction.trim() ? "스케치와 Compose prompt가 필요합니다." : undefined,
    context: input => ({ instruction: input.instruction, ...strokeContext(input) }),
    finalize: (_input, output) => convertScene(output),
    review: (_input, scene: Scene) => proceduralReview(scene),
  },
  transform: {
    schema: aiTransformSchema, maxTokens: () => 10000,
    check: input => needsTarget(input) || (!input.targetPropertyId && !input.targetTransformationId && !canAddTransformation(targetNode(input)!) ? "이 노드에는 더 이상 semantic transformation을 추가할 수 없습니다." : undefined),
    context: input => ({ scene: input.scene, targetNodeId: input.targetNodeId, targetTransformationId: input.targetTransformationId, targetPropertyId: input.targetPropertyId,
      mode: input.targetPropertyId ? "property" : input.targetTransformationId ? "replace" : "add", alternative: input.alternative, instruction: input.instruction }),
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
  code: {
    schema: codeSchema, strokes: true, check: needsScene,
    maxTokens: input => input.scene?.nodes.some(node => node.machine) ? 24000 : 14000,
    context: input => ({ scene: input.scene, parameterBindings: sceneBindings(input.scene!), parameterValues: sceneValues(input.scene!), previous: input.previous, instruction: input.instruction,
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
    schema: aiRevisionSchema, maxTokens: () => 20000,
    check: input => needsScene(input) || (!input.image || !input.previous || !input.annotations.length || !input.instruction.trim() ? "결과 위의 스케치와 text clarification을 입력해주세요." : undefined),
    context: input => ({ scene: input.scene, previous: input.previous, instruction: input.instruction, annotations: input.annotations }),
    finalize: (input, output: z.infer<typeof aiRevisionSchema>) => {
      const current = input.scene!, proposed = settleProposal(current, convertScene(output, current.algorithms));
      validateSceneProposal(current, proposed);
      return { summary: output.summary, scene: proposed };
    },
    // Only new nodes are checked: the user may keep repeated nodes on purpose.
    review: (input, result: SceneProposal) => {
      const review = proceduralReview(result.scene, new Set(result.scene.nodes.filter(node => !findNode(input.scene!, node.id)).map(node => node.id)));
      return review && { feedback: review.feedback, repair: () => ({ ...result, scene: review.repair() }) };
    },
  },
};
export type IntentName = keyof typeof intents;
export const isIntent = (name: string): name is IntentName => name in intents;
/** JSON schema sent as the structured output format; `npm run prompts:schemas` writes it to prompts/schemas. */
export const outputSchema = (intent: IntentName) => z.toJSONSchema(intents[intent].schema, { target: "draft-7" });
