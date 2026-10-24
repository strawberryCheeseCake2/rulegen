import { z } from "zod";
import { MAX_TRANSFORMATIONS } from "../lib/scene/schema";
import { clarificationSchema, codeSchema, compositionPromptSchema, generatedSchema, type requestSchema } from "../lib/schema";
import { aiMachineRefineSchema, aiNodeMachineSchema, aiRevisionSchema, aiSceneSchema, aiTransformSchema } from "../lib/scene/ai-schema";
import { convertMachine, convertScene, convertTransformation, mergeAIAlgorithms } from "../lib/scene/convert";
import { descendantIds, findNode, updateNode } from "../lib/scene/graph";
import { conformMachine, programModules, validateMachine } from "../lib/scene/machines";
import { settleProposal, validateSceneProposal } from "../lib/scene/revisions";
import { canAddTransformation, placeTransformation } from "../lib/scene/transformations";
import { validateScene } from "../lib/scene/validate";
import { sceneBindings, sceneValues } from "../lib/scene/values";
import { parse } from "@babel/parser";
import { connectScene } from "./scene-code.server";
import { applyParameterEdits, guardSuggestedReads, moduleKeyOf, parameterProblem, recordingProblem, suggestionKey } from "../lib/hidden-parameters";
import { readsPerItem } from "../lib/item-values";
import { concernSuggestionsSchema, handleProblem, inspectResultSchema, overlayKeys, overlayStoreFields, type ConcernSuggestions, type InspectResult } from "../lib/inspection";
import { aiHandlesSchema, CELL_HEADER, handleTargets, keepHandles, proxyCells, settleHandles, type AIHandles } from "../lib/scene/handles";
import { prepareCode, prepareHandle } from "./code.server";

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
const handleTarget = (input: AIInput) => ({ transformationId: input.targetTransformationId || undefined, propertyId: input.targetPropertyId || undefined });
/** The code of the modules that draw the inspected brush (by module key). */
function brushModules(input: AIInput) {
  if (!input.previous || !input.scene || !input.inspection) return {};
  const all = programModules(input.previous), keys = new Set(input.inspection.nodeIds.map(id => moduleKeyOf(input.scene!, id)).filter((key): key is string => Boolean(key)));
  return Object.fromEntries([...keys].filter(key => all.has(key)).map(key => [key, all.get(key)!]));
}
/** Edited module text (with its markers) is still valid JavaScript. */
function parsesModule(module: string) {
  try { parse(module, { sourceType: "script" }); return true; } catch { return false; }
}
const needsTarget = (input: AIInput) => !targetNode(input) ? "대상 Collection 또는 Object를 찾지 못했습니다." : undefined;
/** The modules the code must define: one per root node, with the node ids it draws. */
const codeModules = (scene: NonNullable<AIInput["scene"]>) => scene.nodes.filter(node => !node.parentId).map(root => ({ key: root.id, nodes: [root.id, ...descendantIds(scene, root.id)] }));
const needsScene = (input: AIInput) => !input.scene?.nodes.length ? "먼저 스케치에서 collection과 object를 추출해주세요." : undefined;

export const intents: Record<"extract" | "compose" | "transform" | "state-machine" | "machine-refine" | "inspect" | "handles" | "concern" | "code" | "compose-prompt" | "clarification" | "revision", Intent> = {
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
      return validateScene(updateNode({ ...scene, algorithms: library }, input.targetNodeId, node => conformMachine(keepHandles(node, placeTransformation(node, generated, target)))));
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
      algorithms: input.scene!.algorithms, constraints: input.inspection!.constraints, steps: input.inspection!.steps, currentStep: input.inspection!.cursor, annotationMarks: input.inspection!.marks, annotationMarkStyles: input.inspection!.markStyles, canvas,
      // The modules that draw the brush, to find constants the concern depends on (hidden parameters).
      code: brushModules(input),
      // A recommendation was applied and added a transformation: the overlays are rebuilt to show it too.
      ...(input.inspection!.update ? { appliedRecommendation: { title: input.inspection!.update.title, detail: input.inspection!.update.detail, nodeId: input.inspection!.update.nodeId, addedTransformationId: input.inspection!.update.transformationId },
        previousSummary: input.inspection!.update.summary, previousOverlays: input.inspection!.update.overlays } : {}) }),
    /** Drop anything that points outside the brush, so overlays and fixes stay applicable. */
    finalize: (input, output: InspectResult) => {
      const nodes = new Map(input.scene!.nodes.filter(node => input.inspection!.nodeIds.includes(node.id)).map(node => [node.id, node]));
      const keys = new Set(input.inspection!.constraints.map(row => row.key));
      // A hidden parameter is kept only if its edits apply to the module and the result is valid code.
      const parameters = (output.parameters ?? []).filter((item, i, all) => all.findIndex(other => other.nodeId === item.nodeId && other.id === item.id) === i
        && nodes.has(item.nodeId) && !parameterProblem(input.scene!, input.previous, item, parsesModule));
      // Overlays may show a suggested parameter (link and p("…")), only one that is kept.
      const dropped = new Set((output.parameters ?? []).filter(item => !parameters.includes(item)).map(suggestionKey));
      const linked = (kind: string, nodeId: string, id: string) => {
        const node = nodes.get(nodeId); if (!node) return false;
        if (kind === "parameter") return parameters.some(item => item.nodeId === nodeId && item.id === id);
        if (kind === "constraint") return input.inspection!.constraints.some(row => row.nodeId === nodeId && row.propertyId === id);
        if (kind === "transformation") return node.transformations.some(item => item.id === id);
        return Boolean((kind === "state" ? node.machine?.states : node.machine?.transitions)?.some(item => item.id === id));
      };
      // A handle changes a number or toggle of the brush (or of a kept suggestion); one that cannot is dropped, the overlay stays.
      const specs = new Map<string, { type: string }>([...input.inspection!.constraints.map(row => [row.key, { type: row.type }] as const), ...parameters.map(item => [suggestionKey(item), item.value] as const)]);
      const handled = (overlay: InspectResult["overlays"][number]) => overlay.handle && !handleProblem(overlay.handle, specs.get(overlay.handle.key)) ? overlay : { ...overlay, handle: null };
      const change = (item: { key: string; stateId: string; nodeId?: string }) => keys.has(item.key) && (!item.stateId || [...nodes.values()].some(node => node.machine?.states.some(state => state.id === item.stateId)));
      // Fields added to the item records: kept only if the edits apply to the brush's module and the result is valid code.
      // They are applied at once: a read of a suggested parameter (not a value until accepted) falls back to the code's value.
      const guarded = output.records && guardSuggestedReads(output.records, output.parameters ?? []);
      const records = guarded && nodes.has(guarded.nodeId) && !recordingProblem(input.scene!, input.previous, guarded, parsesModule) ? guarded : null;
      // Dropped: the fields it would add that the stores do not have already cannot be drawn, nor the overlays that read them.
      const stores = JSON.stringify(input.inspection!.steps.map(step => step.runtime?.stores ?? {}));
      const unrecorded = new Set(output.records && !records ? output.records.fields.filter(field => !stores.includes(`"${field}":`)) : []);
      const drawable = output.overlays.filter(item => linked(item.link.kind, item.link.nodeId, item.link.id) && ![...overlayKeys(item)].some(key => dropped.has(key)));
      const overlays = drawable.filter(item => ![...overlayStoreFields(item)].some(field => unrecorded.has(field)));
      // A grip on one item of an `each` overlay changes that item only: the code (with the records, and the suggestion
      // once accepted) must read its value per item, m.v(key, id). One that would change every item is dropped.
      const patched = (code: string, nodeId: string, edits: { find: string; replace: string }[]) => {
        const key = moduleKeyOf(input.scene!, nodeId), module = key ? programModules(code).get(key) : undefined; if (!module) return code;
        const edited = applyParameterEdits(module, edits); return "error" in edited ? code : code.replace(module, () => edited.module);
      };
      const recorded = records ? patched(input.previous, records.nodeId, records.edits) : input.previous;
      const perItem = (key: string) => { const suggestion = parameters.find(item => suggestionKey(item) === key); return readsPerItem(suggestion ? patched(recorded, suggestion.nodeId, suggestion.edits) : recorded, key); };
      const gripped = overlays.map(handled), shared = gripped.filter(item => item.each && item.handle && !perItem(item.handle.key)).length;
      const note = (overlays.length < drawable.length ? ` (항목 기록을 추가하는 코드가 올바르지 않아 오버레이 ${drawable.length - overlays.length}개를 표시하지 못했습니다. Inspect again으로 다시 시도해주세요.)` : "")
        + (shared ? ` (손잡이 ${shared}개는 코드가 그 값을 항목마다 따로 읽지 않아 뺐습니다. Inspect again으로 다시 시도해주세요.)` : "");
      return { ...output, summary: output.summary.slice(0, 1500 - note.length) + note, overlays: gripped.map(item => item.each && item.handle && !perItem(item.handle.key) ? { ...item, handle: null } : item), valueFixes: output.valueFixes.filter(change),
        parameters, records,
        recommendations: output.recommendations.filter(item => item.kind === "value" ? item.changes.length > 0 : item.kind === "add-transformation" ? (nodes.get(item.nodeId)?.transformations.length ?? MAX_TRANSFORMATIONS) < MAX_TRANSFORMATIONS : linked(item.kind, item.nodeId, item.targetId)).map(item => ({ ...item, changes: item.changes.filter(change),
          targetIds: item.kind === "transformation" ? [...new Set(item.targetIds.filter(id => id !== item.targetId && linked("transformation", item.nodeId, id)))] : [] })) };
    },
  },
  concern: {
    schema: concernSuggestionsSchema, maxTokens: () => 3000, effort: "low",
    check: input => !input.scene || !input.inspection ? "검사할 brush가 필요합니다." : !input.inspection.marks.length && !input.instruction.trim() ? "Inspection annotation으로 표시하거나 concern을 적어주세요." : undefined,
    context: input => ({ typed: input.instruction, brush: input.inspection!.brushName,
      brushNodes: input.scene!.nodes.filter(node => input.inspection!.nodeIds.includes(node.id)).map(node => ({ id: node.id, name: node.name, kind: node.kind, description: node.description, region: node.region,
        transformations: node.transformations.map(item => ({ label: item.label, description: item.description, properties: item.properties.map(property => ({ label: property.label, description: property.description })) })),
        states: node.machine?.states.map(state => state.label) ?? [], transitions: node.machine?.transitions.map(transition => transition.label) ?? [] })),
      annotationMarks: input.inspection!.marks, annotationMarkStyles: input.inspection!.markStyles, canvas }),
    /** Whole, distinct concerns; ones that continue the typed text first. */
    finalize: (input, output: ConcernSuggestions) => {
      const typed = input.instruction, seen = new Set<string>();
      const items = output.suggestions.map(item => item.replace(/\s+/g, " ").trim()).filter(item => item && item !== typed.trim() && !seen.has(item) && seen.add(item));
      if (!items.length) throw new Error("제안할 concern을 만들지 못했습니다.");
      return { suggestions: [...items.filter(item => typed && item.startsWith(typed)), ...items.filter(item => !typed || !item.startsWith(typed))] };
    },
  },
  handles: {
    schema: aiHandlesSchema, maxTokens: () => 32000, effort: "medium",
    check: input => needsTarget(input) || (!input.targetPropertyId && !input.targetTransformationId ? "direct manipulation handle은 property 하나나 transformation 하나에 대해 만듭니다." : undefined) || (!handleTargets(targetNode(input)!, input.scene!.algorithms, handleTarget(input)).length ? "direct manipulation handle로 조절할 수 있는 property가 없습니다." : undefined),
    context: input => { const node = targetNode(input)!, r = node.region, properties = handleTargets(node, input.scene!.algorithms, handleTarget(input));
      // The widget area each will get in the proxy frame, given how many the node will show.
      const shown = new Set([...node.transformations.flatMap(item => item.properties).filter(item => item.handle).map(item => item.id), ...properties.map(item => item.propertyId)]).size, cell = proxyCells(shown)[0];
      return { targetNodeId: node.id, node: { name: node.name, kind: node.kind, description: node.description, primitive: node.primitive, region: { x: r.x * canvas.width, y: r.y * canvas.height, w: r.w * canvas.width, h: r.h * canvas.height } },
        properties, widgetArea: { w: Math.round(cell.w), h: Math.round(cell.h - CELL_HEADER) }, instruction: input.instruction, canvas }; },
    finalize: (input, output: AIHandles) => {
      const settled = settleHandles(targetNode(input)!, output, handleTarget(input), prepareHandle);
      if (!settled.handles.length) throw new Error(settled.skipped.length ? `handle 코드를 실행할 수 없습니다: ${settled.skipped[0].reason}` : "만들어진 handle이 없습니다. 다시 시도해주세요.");
      return settled;
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
