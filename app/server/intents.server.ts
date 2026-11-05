import { z } from "zod";
import { MAX_TRANSFORMATIONS } from "../lib/scene/schema";
import { clarificationSchema, codeSchema, compositionPromptSchema, generatedSchema, type requestSchema } from "../lib/schema";
import { aiMachineRefineSchema, aiNodeMachineSchema, aiRevisionSchema, aiSceneSchema, aiSplitSchema, aiTransformSchema } from "../lib/scene/ai-schema";
import { convertMachine, convertScene, convertTransformation, convertTransformations, mergeAIAlgorithms } from "../lib/scene/convert";
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
import { concernSuggestionsSchema, handleProblem, inspectPreviewResultSchema, inspectResultSchema, revisedRecommendationSchema, type RecommendationPreview, type RevisedRecommendation, overlayKeys, overlayStoreFields, type ConcernSuggestions, type InspectResult } from "../lib/inspection";
import { isRuntimeKey } from "../lib/runtime-edits";
import { cleanMachineChange } from "../lib/machine-change";
import { aiCompositionPromptSchema, aiTagRevisionSchema, settleComposeTags, settleTransformation, tagRevisionSchema, tagsForAI, tagsForCompose } from "../lib/compose-tags";
import { EXEC_KEY, exploreProgram, exploreResultSchema, previewKey, traceOnly, type ExploreResult } from "../lib/explore";
import { fieldHookProblem } from "../lib/fields";
import { aiHandlesSchema, CELL_HEADER, handleTargets, keepHandles, proxySections, settleHandles, type AIHandles } from "../lib/scene/handles";
import { prepareCode, prepareHandle } from "./code.server";

// One entry per AI intent: its structured output schema, prompt file, budget,
// preconditions, the request context and how the model output is finalized.

export type AIInput = z.infer<typeof requestSchema>;
type Intent = {
  schema: z.ZodType;
  /** The output schema for this request when it differs from `schema` (e.g. an option asks for more), and the prompt parts it adds. */
  variant?: (input: AIInput) => { schema: z.ZodType; prompts: string[] } | null; maxTokens: (input: AIInput) => number; effort?: "low" | "medium";
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
/** A recommendation's preview is kept only if its edits apply to the brush's modules (`nodes`), give valid code and read only values it brings. */
function keptPreview(input: AIInput, nodes: Map<string, unknown>, item: { kind: string; preview?: RecommendationPreview | null }) {
  const preview = item.preview;
  if (!preview || item.kind === "value" || !preview.edits.length || preview.edits.some(edit => !nodes.has(edit.nodeId)) || preview.values.some(value => !nodes.has(value.nodeId))) return null;
  // The states and transitions it brings: of a brush node, and an event one only when the edits emit it.
  const machine = preview.machine && nodes.has(preview.machine.nodeId) ? cleanMachineChange(input.scene!, preview.machine, preview.edits) : null;
  const program = exploreProgram(input.previous, input.scene!, { ...preview, machine });
  if ("error" in program) return null;
  const keys = [...new Set(preview.edits.map(edit => moduleKeyOf(input.scene!, edit.nodeId)!))];
  if (!keys.every(key => parsesModule(programModules(program.code).get(key) ?? ""))) return null;
  // Its handles change a number or toggle of the brush or one the preview brings (not the running state).
  const specs = new Map<string, { type: string }>([...(input.inspection?.constraints ?? []).map(row => [row.key, { type: row.type }] as const), ...preview.values.map(value => [previewKey(value), value.value] as const)]);
  const handles = (preview.handles ?? []).filter(overlay => overlay.handle && !isRuntimeKey(overlay.handle.key) && !handleProblem(overlay.handle, specs.get(overlay.handle.key)));
  return { ...preview, machine, handles };
}
/**
 * A recommendation AI wrote for one brush (revised, or made from an Execution frame): its target exists in the brush and
 * its preview runs; else an error (nothing changes). `what` says which in the error ("revised", "new").
 */
function settledRecommendation(input: AIInput, output: RevisedRecommendation, what: string) {
  const scene = input.scene!, inspection = input.inspection!, nodes = new Map(scene.nodes.filter(node => inspection.nodeIds.includes(node.id)).map(node => [node.id, node]));
  const node = nodes.get(output.nodeId);
  if (!node) throw new Error(`The ${what} recommendation does not point at a node of this brush. Please try again.`);
  const keys = new Set(inspection.constraints.map(row => row.key)), has = (kind: string, id: string) => kind === "transformation" ? node.transformations.some(item => item.id === id)
    : Boolean((kind === "state" ? node.machine?.states : node.machine?.transitions)?.some(item => item.id === id));
  const changes = output.changes.filter(item => keys.has(item.key) && (!item.stateId || [...nodes.values()].some(other => other.machine?.states.some(state => state.id === item.stateId))));
  if (output.kind === "value" ? !changes.length : output.kind === "add-transformation" ? node.transformations.length >= MAX_TRANSFORMATIONS : !has(output.kind, output.targetId)) throw new Error(`The ${what} recommendation cannot be applied to this brush. Please try again.`);
  const preview = output.kind === "value" ? null : keptPreview(input, nodes, output);
  if (output.kind !== "value" && !preview) throw new Error(`Could not apply the preview code of the ${what} recommendation. Please try again.`);
  return { ...output, targetId: output.kind === "add-transformation" ? "" : output.targetId, changes: output.kind === "value" ? changes : [],
    targetIds: output.kind === "transformation" ? [...new Set(output.targetIds.filter(id => id !== output.targetId && has("transformation", id)))] : [], preview };
}
const needsTarget = (input: AIInput) => !targetNode(input) ? "Could not find the target Collection or Object." : undefined;
/** The modules the code must define: one per root node, with the node ids it draws. */
const codeModules = (scene: NonNullable<AIInput["scene"]>) => scene.nodes.filter(node => !node.parentId).map(root => ({ key: root.id, nodes: [root.id, ...descendantIds(scene, root.id)] }));
const needsScene = (input: AIInput) => !input.scene?.nodes.length ? "Extract collections and objects from the sketch first." : undefined;

export const intents: Record<"extract" | "compose" | "transform" | "state-machine" | "machine-refine" | "inspect" | "handles" | "concern" | "explore" | "code" | "compose-prompt" | "clarification" | "revision" | "split" | "revise-recommendation" | "execution-recommendation" | "tag-revise", Intent> = {
  "tag-revise": {
    schema: aiTagRevisionSchema, maxTokens: () => 3000, strokes: true,
    check: input => { const target = input.tagTarget, tag = target && input.composeTags.find(item => item.id === target.tagId);
      return !input.image ? "A sketch image is needed to change the tag." : !tag?.transformations[target!.index] ? "Could not find the tag's transformation to change." : !input.instruction.trim() ? "Say how to change it." : undefined; },
    context: input => ({ request: input.instruction, target: input.tagTarget, tags: tagsForAI(input.composeTags, input.compositionPens) }),
    finalize: (input, output: z.infer<typeof aiTagRevisionSchema>) => tagRevisionSchema.parse({ ...input.tagTarget!, transformation: settleTransformation(output.transformation, input.compositionPens), note: output.note }),
  },
  extract: {
    schema: aiSceneSchema, maxTokens: () => 40000, strokes: true,
    check: input => !input.image ? "There is no image to analyze." : undefined,
    context: input => ({ instruction: input.instruction }),
    finalize: (_input, output) => convertScene(output),
  },
  compose: {
    schema: aiSceneSchema, maxTokens: () => 44000, strokes: true,
    check: input => !input.image || (!input.instruction.trim() && !input.composeTags.length) ? "A sketch and a Compose prompt (or its tags on the sketch) are needed." : undefined,
    context: input => ({ instruction: input.instruction, ...(input.composeTags.length ? { tags: tagsForCompose(input.composeTags) } : {}), ...strokeContext(input) }),
    finalize: (_input, output) => convertScene(output),
  },
  transform: {
    schema: aiTransformSchema, maxTokens: () => 10000,
    check: input => needsTarget(input) || (!input.targetPropertyId && !input.targetTransformationId && !canAddTransformation(targetNode(input)!) ? "No more semantic transformations can be added to this node." : undefined),
    context: input => ({ scene: input.scene, targetNodeId: input.targetNodeId, targetTransformationId: input.targetTransformationId, targetPropertyId: input.targetPropertyId,
      mode: input.targetPropertyId ? "property" : input.targetTransformationId ? "replace" : "add", alternative: input.alternative, instruction: input.instruction, annotationMarks: input.transformMarks, canvas }),
    finalize: (input, output: z.infer<typeof aiTransformSchema>) => {
      const scene = input.scene!, { library, ids } = mergeAIAlgorithms(scene.algorithms, output.algorithms);
      const generated = convertTransformation(output.transformation, library, ids);
      const target = { transformationId: input.targetTransformationId || undefined, propertyId: input.targetPropertyId || undefined };
      return validateScene(updateNode({ ...scene, algorithms: library }, input.targetNodeId, node => conformMachine(keepHandles(node, placeTransformation(node, generated, target)))));
    },
  },
  /** Decompose again: one transformation (of a minimal example) into the meaningful algorithms its code runs, each its own transformation. */
  split: {
    schema: aiSplitSchema, maxTokens: () => 16000, effort: "medium",
    check: input => needsTarget(input) || (!targetNode(input)!.transformations.some(item => item.id === input.targetTransformationId) ? "Could not find the transformation to divide." : undefined),
    context: input => { const node = targetNode(input)!, key = moduleKeyOf(input.scene!, node.id), code = key && input.previous ? programModules(input.previous).get(key) ?? "" : "";
      return { scene: input.scene, targetNodeId: input.targetNodeId, targetTransformationId: input.targetTransformationId, code: code.slice(0, 40000), instruction: input.instruction }; },
    finalize: (input, output: z.infer<typeof aiSplitSchema>) => {
      const scene = input.scene!, node = targetNode(input)!, { library, ids } = mergeAIAlgorithms(scene.algorithms, output.algorithms);
      // Each part becomes a transformation of its own: ids unique in the node (the parent's own id is taken too).
      const taken = new Set(node.transformations.map(item => item.id));
      const parts = convertTransformations(output.parts, library, ids).map(part => { let id = part.id, n = 2; while (taken.has(id)) id = `${part.id}-${n++}`; taken.add(id); return { ...part, id }; })
        .filter(part => part.properties.length);
      const divisible = output.divisible && parts.length >= 2;
      return { divisible, reason: (divisible ? output.reason : output.reason || "There are no meaningful inner algorithms to divide it into.").slice(0, 400), algorithms: divisible ? library : [], parts: divisible ? parts : [] };
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
      if (!node) return "Could not find the target Collection or Object.";
      if (!machine) return "Create a state machine for this node first.";
      if (target && !(target.kind === "state" ? machine.states : machine.transitions).some(item => item.id === target.id)) return "Could not find the attached state or transition.";
      if (!input.instruction.trim() && !input.machineMarks.length) return "Describe how to change it, or draw an annotation on the state machine.";
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
    schema: inspectResultSchema, maxTokens: input => input.inspection?.previews ? 24000 : 16000, effort: "medium",
    variant: input => input.inspection?.previews && !input.inspection.update ? { schema: inspectPreviewResultSchema, prompts: ["inspect-preview"] } : null,
    check: input => !input.scene || !input.inspection ? "A brush to inspect and its records are needed." : !input.instruction.trim() && !input.inspection.marks.length ? "Write what you want to know, or mark it with an Inspection annotation." : undefined,
    context: input => ({ concern: input.instruction, brush: input.inspection!.brushName, brushNodes: input.scene!.nodes.filter(node => input.inspection!.nodeIds.includes(node.id)),
      algorithms: input.scene!.algorithms, constraints: input.inspection!.constraints, steps: input.inspection!.steps, currentStep: input.inspection!.cursor, annotationMarks: input.inspection!.marks, annotationMarkStyles: input.inspection!.markStyles, canvas,
      // The modules that draw the brush, to find constants the concern depends on (hidden parameters).
      code: brushModules(input),
      // A recommendation was applied (values, a transformation changed or added, a state or transition): the overlays are rebuilt for it.
      ...(input.inspection!.update ? { appliedRecommendation: { kind: input.inspection!.update.kind, title: input.inspection!.update.title, detail: input.inspection!.update.detail, nodeId: input.inspection!.update.nodeId,
          ...(input.inspection!.update.targetId ? { targetId: input.inspection!.update.targetId } : {}), ...(input.inspection!.update.transformationId ? { addedTransformationId: input.inspection!.update.transformationId } : {}),
          ...(input.inspection!.update.changes.length ? { changes: input.inspection!.update.changes } : {}) },
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
      // The running state (an input point, a store value) is the step's, not an item's value: any grip on it is kept.
      const perItem = (key: string) => { if (isRuntimeKey(key)) return true; const suggestion = parameters.find(item => suggestionKey(item) === key); return readsPerItem(suggestion ? patched(recorded, suggestion.nodeId, suggestion.edits) : recorded, key); };
      const gripped = overlays.map(handled), shared = gripped.filter(item => item.each && item.handle && !perItem(item.handle.key)).length;
      // Fields the concern is about: kept only when the code declares them, or the edits declare them and stay valid (after the records).
      const fields = (output.fields ?? []).filter((item, i, all) => all.findIndex(other => other.id === item.id) === i && nodes.has(item.nodeId) && !fieldHookProblem(input.scene!, recorded, item, parsesModule));
      const lostFields = (output.fields ?? []).length - fields.length;
      const note = (overlays.length < drawable.length ? ` (The code that adds item records was invalid, so ${drawable.length - overlays.length} overlay(s) could not be shown. Please try again with Inspect again.)` : "")
        + (shared ? ` (${shared} handle(s) were left out because the code does not read that value per item. Please try again with Inspect again.)` : "")
        + (lostFields ? ` (${lostFields} field(s) could not be hooked into the code to show them. Please try again with Inspect again.)` : "");
      const previewOf = (item: InspectResult["recommendations"][number] & { preview?: RecommendationPreview | null }) => keptPreview(input, nodes, item);
      return { ...output, summary: output.summary.slice(0, 1500 - note.length) + note, overlays: gripped.map(item => item.each && item.handle && !perItem(item.handle.key) ? { ...item, handle: null } : item), valueFixes: output.valueFixes.filter(change),
        parameters, records, fields,
        recommendations: output.recommendations.filter(item => item.kind === "value" ? item.changes.length > 0 : item.kind === "add-transformation" ? (nodes.get(item.nodeId)?.transformations.length ?? MAX_TRANSFORMATIONS) < MAX_TRANSFORMATIONS : linked(item.kind, item.nodeId, item.targetId)).map(item => ({ ...item, changes: item.changes.filter(change),
          targetIds: item.kind === "transformation" ? [...new Set(item.targetIds.filter(id => id !== item.targetId && linked("transformation", item.nodeId, id)))] : [],
          ...("preview" in item ? { preview: previewOf(item) } : {}) })) };
    },
  },
  "revise-recommendation": {
    schema: revisedRecommendationSchema, maxTokens: () => 16000, effort: "medium",
    check: input => !input.scene || !input.inspection?.revise ? "A recommendation to revise is needed."
      : !input.instruction.trim() && !input.inspection.marks.length && !input.inspection.revise.manipulations.length && !input.inspection.revise.adjusted.length ? "Draw an annotation on the preview, move an object or handle, or describe how to revise it." : undefined,
    context: input => {
      const inspection = input.inspection!, revise = inspection.revise!, held = inspection.cursor ?? inspection.steps.length - 1;
      return { request: input.instruction, concern: revise.concern, inspectionSummary: revise.summary, recommendation: revise.recommendation, brush: inspection.brushName,
        brushNodes: input.scene!.nodes.filter(node => inspection.nodeIds.includes(node.id)), algorithms: input.scene!.algorithms, constraints: inspection.constraints,
        // Only the step the preview is drawn on.
        step: inspection.steps[held] ?? null, annotationMarks: inspection.marks, annotationMarkStyles: inspection.markStyles, manipulations: revise.manipulations, adjusted: revise.adjusted, canvas, code: brushModules(input) };
    },
    /** The revised recommendation stays one of this brush (its target exists) with a preview that runs; else nothing changes. */
    finalize: (input, output: RevisedRecommendation) => settledRecommendation(input, output, "revised"),
  },
  /** A new recommendation from what the user showed on an Execution frame (annotation, crops moved, scaled or rotated) at one moment of execution. */
  "execution-recommendation": {
    schema: revisedRecommendationSchema, maxTokens: () => 16000, effort: "medium",
    check: input => !input.scene || !input.inspection?.fromExecution ? "An Execution frame and its brush are needed."
      : !input.instruction.trim() && !input.inspection.marks.length && !input.inspection.fromExecution.manipulations.length ? "Draw an annotation on the Execution picture, crop and move part of it, or describe how it should change." : undefined,
    context: input => {
      const inspection = input.inspection!, from = inspection.fromExecution!, held = inspection.cursor ?? inspection.steps.length - 1;
      return { request: input.instruction, concern: from.concern, inspectionSummary: from.summary, execution: from.execution,
        ...(from.base ? { framedRecommendation: { ...from.base, applied: from.applied } } : {}), listedRecommendations: from.listed,
        brush: inspection.brushName, brushNodes: input.scene!.nodes.filter(node => inspection.nodeIds.includes(node.id)), algorithms: input.scene!.algorithms, constraints: inspection.constraints,
        step: inspection.steps[held] ?? null, annotationMarks: inspection.marks, annotationMarkStyles: inspection.markStyles, manipulations: from.manipulations, canvas, code: brushModules(input) };
    },
    finalize: (input, output: RevisedRecommendation) => settledRecommendation(input, output, "new"),
  },
  concern: {
    schema: concernSuggestionsSchema, maxTokens: () => 3000, effort: "low",
    check: input => !input.scene || !input.inspection ? "A brush to inspect is needed." : !input.inspection.marks.length && !input.instruction.trim() ? "Mark it with an Inspection annotation or write a concern." : undefined,
    context: input => ({ typed: input.instruction, brush: input.inspection!.brushName,
      brushNodes: input.scene!.nodes.filter(node => input.inspection!.nodeIds.includes(node.id)).map(node => ({ id: node.id, name: node.name, kind: node.kind, description: node.description, region: node.region,
        transformations: node.transformations.map(item => ({ label: item.label, description: item.description, properties: item.properties.map(property => ({ label: property.label, description: property.description })) })),
        states: node.machine?.states.map(state => state.label) ?? [], transitions: node.machine?.transitions.map(transition => transition.label) ?? [] })),
      annotationMarks: input.inspection!.marks, annotationMarkStyles: input.inspection!.markStyles, canvas }),
    /** Whole, distinct concerns; ones that continue the typed text first. */
    finalize: (input, output: ConcernSuggestions) => {
      const typed = input.instruction, seen = new Set<string>();
      const items = output.suggestions.map(item => item.replace(/\s+/g, " ").trim()).filter(item => item && item !== typed.trim() && !seen.has(item) && seen.add(item));
      if (!items.length) throw new Error("Could not come up with concerns to suggest.");
      return { suggestions: [...items.filter(item => typed && item.startsWith(typed)), ...items.filter(item => !typed || !item.startsWith(typed))] };
    },
  },
  explore: {
    schema: exploreResultSchema, maxTokens: () => 16000, effort: "medium",
    check: input => !input.scene || !input.inspection || !input.explore ? "A brush to explore and its records are needed." : !input.inspection.steps.length ? "Move the brush first to record steps." : undefined,
    context: input => ({ mode: input.explore!.mode, concern: input.instruction, brush: input.inspection!.brushName, brushNodes: input.scene!.nodes.filter(node => input.inspection!.nodeIds.includes(node.id)),
      algorithms: input.scene!.algorithms, constraints: input.inspection!.constraints, steps: input.inspection!.steps, currentStep: input.inspection!.cursor, input: input.explore!.input, canvas,
      code: brushModules(input), inspection: { summary: input.explore!.summary, overlays: input.explore!.overlays },
      ...(input.explore!.recommendation ? { recommendation: input.explore!.recommendation } : {}) }),
    /** Keep only what this frame can run: a preview that applies to the module, values it reads, handles on values it has. */
    finalize: (input, output: ExploreResult) => {
      const explore = input.explore!, nodes = new Map(input.scene!.nodes.filter(node => input.inspection!.nodeIds.includes(node.id)).map(node => [node.id, node]));
      const notes: string[] = [];
      // A preview only for a recommendation that is not in the code yet (a value one is drawn with its values instead);
      // checkpoints of the code's execution (edits that only add m.trace calls) for running it.
      const previewing = Boolean(explore.recommendation && !explore.recommendation.applied && explore.recommendation.kind !== "value");
      const execution = explore.mode === "execution";
      // Edits that only add checkpoints and wrappers change nothing the code does: execution keeps them; the values mode only
      // those that keep an item's quantity in the execution state (m.runtime), for its handles to change at the moment.
      const keepsState = (edit: { replace: string }) => edit.replace.includes("m.runtime(") && !edit.replace.includes("m.trace(");
      let edits = output.edits.filter(edit => nodes.has(edit.nodeId) && (previewing || (traceOnly(edit) && (execution || keepsState(edit)))));
      const program = edits.length ? exploreProgram(input.previous, input.scene!, { edits, values: [] }) : null;
      const modules = (code: string) => [...new Set(edits.map(edit => moduleKeyOf(input.scene!, edit.nodeId)!))].map(key => programModules(code).get(key) ?? "");
      if (program && ("error" in program || !modules(program.code).every(parsesModule))) { edits = []; notes.push(previewing ? "Could not write code that previews the recommendation, so the current code is shown." : "Could not add code that records the execution, so only the drawing order is shown."); }
      const edited = edits.map(edit => edit.replace).join("\n");
      // A preview value is one the edits read and the node does not have yet.
      const values = output.values.filter((value, i, all) => all.findIndex(other => other.nodeId === value.nodeId && other.id === value.id) === i && nodes.has(value.nodeId)
        && !input.inspection!.constraints.some(row => row.nodeId === value.nodeId && row.propertyId === value.id)
        && (value.value.type !== "number" || (value.value.min <= value.value.value && value.value.value <= value.value.max && value.value.min < value.value.max))
        && new RegExp(`m\\.(?:v|opt)\\(\\s*(?:[^,()]*,\\s*)?["'][^"']*/${value.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`).test(edited));
      // Code that reads a value that is not there stops: edits reading a dropped one go too.
      if (edits.length && output.values.some(value => !values.includes(value) && edited.includes(`/${value.id}"`))) { edits = []; notes.push("The preview code reads an invalid value, so the current code is shown."); }
      const kept = edits.length ? values : [];
      // A preview's states and transitions (for the behavior it adds): only with its edits, which emit its events.
      const machine = previewing && edits.length && output.machine && nodes.has(output.machine.nodeId) ? cleanMachineChange(input.scene!, output.machine, edits) : null;
      const specs = new Map<string, { type: string }>([...input.inspection!.constraints.map(row => [row.key, { type: row.type }] as const), ...kept.map(value => [previewKey(value), value.value] as const)]);
      const linked = (kind: string, nodeId: string, id: string) => {
        const node = nodes.get(nodeId); if (!node) return false;
        if (kind === "parameter") return kept.some(value => value.nodeId === nodeId && value.id === id);
        if (kind === "constraint") return input.inspection!.constraints.some(row => row.nodeId === nodeId && row.propertyId === id);
        if (machine?.nodeId === nodeId && (kind === "state" ? machine.states : machine.transitions).some(item => item.id === id)) return true;
        return Boolean((kind === "state" ? node.machine?.states : node.machine?.transitions)?.some(item => item.id === id));
      };
      // Execution: the handle runs execution (and only it); parameters: handles change the brush's values or the preview's.
      const usable = (handle: NonNullable<ExploreResult["overlays"][number]["handle"]>) => execution
        ? handle.key === EXEC_KEY && !handleProblem(handle, { type: "number" })
        : handle.key !== EXEC_KEY && !handleProblem(handle, specs.get(handle.key));
      const overlays = output.overlays.filter(item => linked(item.link.kind, item.link.nodeId, item.link.id)).map(item => item.handle && usable(item.handle) ? item : { ...item, handle: null });
      // An execution with its steps recorded runs without a handle of its own too (the buttons, the keys and a plain grip on each step).
      if (!overlays.some(item => item.handle) && !(execution && edits.length)) throw new Error(execution ? "Could not create a handle to control the execution. Please try again." : "Could not create handles for the key parameters. Please try again.");
      // Steps only when there are steps to move between; a range too narrow to move in is the whole.
      const axis = output.axis === "steps" && input.inspection!.steps.length < 2 ? "input" : output.axis;
      const [from, to] = output.to - output.from >= .02 ? [output.from, output.to] : [0, 1];
      // The kinds of operation a run's steps are, named once each: only those the kept checkpoints take (`op: n`).
      const ops = new Set(edits.flatMap(edit => [...edit.replace.matchAll(/\bop\s*:\s*(\d+)/g)].map(match => Number(match[1]))));
      const named = execution && axis === "run" ? output.stages.filter((stage, i, all) => all.findIndex(other => other.op === stage.op) === i) : [];
      const stages = named.filter(stage => ops.has(stage.op)), lost = named.filter(stage => !ops.has(stage.op));
      // Steps are run with handles (and the buttons), never by drawing marks.
      const sketches: ExploreResult["sketches"] = [];
      if (lost.length) notes.push(`Step(s) ${lost.map(stage => `“${stage.name}”`).join(", ")} could not be added to the code and were left out. Generating again may include them.`);
      // What the execution and each operation are part of: only transformations, states and transitions the brush has (or the preview brings), each once.
      const parts = (list: ExploreResult["of"]) => list.filter((part, i, all) => all.findIndex(other => other.kind === part.kind && other.nodeId === part.nodeId && other.id === part.id) === i
        && (part.kind === "transformation" ? Boolean(nodes.get(part.nodeId)?.transformations.some(item => item.id === part.id)) : linked(part.kind, part.nodeId, part.id)));
      const linkedStages = stages.map(stage => ({ ...stage, of: parts(stage.of ?? []) }));
      const note = notes.length ? ` (${notes.join(" ")})` : "";
      return { ...output, summary: output.summary.slice(0, 1200 - note.length) + note, axis, from, to, edits, values: kept, machine, overlays, stages: linkedStages, sketches,
        of: execution ? parts([...(output.of ?? []), ...linkedStages.flatMap(stage => stage.of)]).slice(0, 4) : [] };
    },
  },
  handles: {
    schema: aiHandlesSchema, maxTokens: () => 32000, effort: "medium",
    check: input => needsTarget(input) || (!input.targetPropertyId && !input.targetTransformationId ? "Direct manipulation handles are made for one property or one transformation." : undefined) || (!handleTargets(targetNode(input)!, input.scene!.algorithms, handleTarget(input)).length ? "There is no property that a direct manipulation handle can control." : undefined),
    context: input => { const node = targetNode(input)!, r = node.region, properties = handleTargets(node, input.scene!.algorithms, handleTarget(input));
      // The widget area each will get in the proxy frame, given how many the node will show.
      // Each transformation has its own proxy frame: the cell this request's first property gets there once its widgets are in.
      const designed = new Set(properties.map(item => item.propertyId)), owner = node.transformations.find(item => item.properties.some(property => designed.has(property.id)));
      const cell = proxySections([owner ? owner.properties.filter(property => property.handle || designed.has(property.id)).length : 1])[0].cells[0];
      return { targetNodeId: node.id, node: { name: node.name, kind: node.kind, description: node.description, primitive: node.primitive, region: { x: r.x * canvas.width, y: r.y * canvas.height, w: r.w * canvas.width, h: r.h * canvas.height } },
        properties, widgetArea: { w: Math.round(cell.w), h: Math.round(cell.h - CELL_HEADER) }, instruction: input.instruction, canvas }; },
    finalize: (input, output: AIHandles) => {
      const settled = settleHandles(targetNode(input)!, output, handleTarget(input), prepareHandle);
      if (!settled.handles.length) throw new Error(settled.skipped.length ? `Could not run the handle code: ${settled.skipped[0].reason}` : "No handles were created. Please try again.");
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
    schema: aiCompositionPromptSchema, maxTokens: () => 6000,
    check: input => !input.image ? "A sketch image is needed to write the prompt." : undefined,
    context: input => ({ instruction: input.instruction, ...strokeContext(input) }),
    finalize: (input, output: z.infer<typeof aiCompositionPromptSchema>) => compositionPromptSchema.parse({ prompt: output.prompt, tags: settleComposeTags(output.tags, input.compositionStrokes, input.compositionPens) }),
  },
  clarification: {
    schema: clarificationSchema, maxTokens: () => 2000,
    check: input => !input.image || !input.resultImage || !input.previous || !input.annotations.length ? "A result image and an annotation sketch are needed to write the description." : undefined,
    context: input => ({ scene: input.scene, previous: input.previous, instruction: input.instruction, annotations: input.annotations }),
  },
  revision: {
    schema: aiRevisionSchema, maxTokens: () => 40000,
    check: input => needsScene(input) || (!input.image || !input.previous || !input.annotations.length || !input.instruction.trim() ? "Provide a sketch over the result and a text clarification." : undefined),
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
export const outputSchema = (intent: IntentName, input?: AIInput) => z.toJSONSchema((input && intents[intent].variant?.(input)?.schema) || intents[intent].schema, { target: "draft-7" });
