import { z } from "zod";
import { MAX_CONSTRAINTS } from "../lib/scene/schema";
import { clarificationSchema, codeSchema, compositionPromptSchema, generatedSchema, type requestSchema } from "../lib/schema";
import { aiMachineRefineSchema, aiNodeMachineSchema, aiRevisionSchema, aiSceneSchema, aiSplitSchema, aiTransformSchema } from "../lib/scene/ai-schema";
import { withMachine, convertMachine, convertScene, convertConstraint, convertConstraints, mergeAIAlgorithms } from "../lib/scene/convert";
import { descendantIds, findNode, updateNode } from "../lib/scene/graph";
import { conformMachine, programModules, validateMachine } from "../lib/scene/machines";
import { settleProposal, validateSceneProposal } from "../lib/scene/revisions";
import { canAddConstraint, placeConstraint } from "../lib/scene/constraints";
import { validateScene } from "../lib/scene/validate";
import { sceneBindings, sceneValues } from "../lib/scene/values";
import { parse } from "@babel/parser";
import { connectScene } from "./scene-code.server";
import { applyParameterEdits, guardSuggestedReads, moduleKeyOf, parameterProblem, recordingProblem, suggestionKey } from "../lib/hidden-parameters";
import { readsPerItem } from "../lib/item-values";
import { concernSuggestionsSchema, handleProblem, inspectResultSchema, overlayKeys, overlayStoreFields, type ConcernSuggestions, type InspectResult } from "../lib/inspection";
import { alignFixSchema, alignKitSchema, BASE_TOOLS, describeIdeal, keptSpecs, readsBehavior, SPEC_PLACING, keptVariables, keptWidget, MAX_IDEAL_OBJECTS, OBJECT_BASE_TOOLS, presetValues, tagWidgetSchema, toolKind, type AlignFix, type AlignKit, type TagWidgetSpec } from "../lib/alignment";
import { isRuntimeKey } from "../lib/runtime-edits";
import { aiCompositionPromptSchema, aiTagRevisionSchema, settleComposeTags, settleConstraint, tagRevisionSchema, tagsForAI, tagsForCompose } from "../lib/compose-tags";
import { behaviorProgram, exploreProgram, exploreResultSchema, traceOnly, type ExploreResult } from "../lib/explore";
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
const handleTarget = (input: AIInput) => ({ constraintId: input.targetConstraintId || undefined, paramId: input.targetParamId || undefined });
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
/**
 * A fix AI read from the state the user drew for one brush: its target exists in the brush (values of its
 * params, a constraint, state or transition of one of its nodes, room for a new constraint); else an error.
 */
function settledFix(input: AIInput, output: AlignFix) {
  const scene = input.scene!, inspection = input.inspection!, nodes = new Map(scene.nodes.filter(node => inspection.nodeIds.includes(node.id)).map(node => [node.id, node]));
  const node = nodes.get(output.nodeId);
  if (!node) throw new Error("The fix does not point at a node of this brush. Please try again.");
  const keys = new Set(inspection.params.map(row => row.key)), has = (kind: string, id: string) => kind === "constraint" ? node.constraints.some(item => item.id === id)
    : Boolean((kind === "state" ? node.machine?.states : node.machine?.transitions)?.some(item => item.id === id));
  const changes = output.changes.filter(item => keys.has(item.key) && (!item.stateId || [...nodes.values()].some(other => other.machine?.states.some(state => state.id === item.stateId))));
  if (output.kind === "value" ? !changes.length : output.kind === "add-constraint" ? node.constraints.length >= MAX_CONSTRAINTS : !has(output.kind, output.targetId)) throw new Error("The fix cannot be applied to this brush. Please try again.");
  return { ...output, targetId: output.kind === "add-constraint" ? "" : output.targetId, changes: output.kind === "value" ? changes : [],
    targetIds: output.kind === "constraint" ? [...new Set(output.targetIds.filter(id => id !== output.targetId && has("constraint", id)))] : [] };
}
/** What both alignment intents read: the concern at one moment of execution of the brush, and its code. */
function alignContext(input: AIInput) {
  const inspection = input.inspection!, align = inspection.align!;
  return { concern: align.concern, inspectionSummary: align.summary, execution: align.execution, brush: inspection.brushName,
    brushNodes: input.scene!.nodes.filter(node => inspection.nodeIds.includes(node.id)), algorithms: input.scene!.algorithms, params: inspection.params,
    step: inspection.steps[0] ?? null, canvas, code: brushModules(input) };
}
const needsTarget = (input: AIInput) => !targetNode(input) ? "Could not find the target Collection or Object." : undefined;
/** The modules the code must define: one per root node, with the node ids it draws. */
const codeModules = (scene: NonNullable<AIInput["scene"]>) => scene.nodes.filter(node => !node.parentId).map(root => ({ key: root.id, nodes: [root.id, ...descendantIds(scene, root.id)] }));
const needsScene = (input: AIInput) => !input.scene?.nodes.length ? "Extract collections and objects from the sketch first." : undefined;

export const intents: Record<"extract" | "compose" | "transform" | "state-machine" | "machine-refine" | "inspect" | "handles" | "concern" | "explore" | "code" | "compose-prompt" | "clarification" | "revision" | "split" | "align-kit" | "align" | "tag-revise" | "tag-widget", Intent> = {
  "tag-revise": {
    schema: aiTagRevisionSchema, maxTokens: () => 3000, strokes: true,
    check: input => { const target = input.tagTarget, tag = target && input.composeTags.find(item => item.id === target.tagId);
      return !input.image ? "A sketch image is needed to change the tag." : !tag?.constraints[target!.index] ? "Could not find the tag's constraint to change." : !input.instruction.trim() ? "Say how to change it." : undefined; },
    context: input => ({ request: input.instruction, target: input.tagTarget, tags: tagsForAI(input.composeTags, input.compositionPens) }),
    finalize: (input, output: z.infer<typeof aiTagRevisionSchema>) => tagRevisionSchema.parse({ ...input.tagTarget!, constraint: settleConstraint(output.constraint, input.compositionPens), note: output.note }),
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
    check: input => needsTarget(input) || (!input.targetParamId && !input.targetConstraintId && !canAddConstraint(targetNode(input)!) ? "No more constraints can be added to this node." : undefined),
    context: input => ({ scene: input.scene, targetNodeId: input.targetNodeId, targetConstraintId: input.targetConstraintId, targetParamId: input.targetParamId,
      mode: input.targetParamId ? "param" : input.targetConstraintId ? "replace" : "add", alternative: input.alternative, instruction: input.instruction, annotationMarks: input.transformMarks, canvas }),
    finalize: (input, output: z.infer<typeof aiTransformSchema>) => {
      const scene = input.scene!, { library, ids } = mergeAIAlgorithms(scene.algorithms, output.algorithms);
      const generated = convertConstraint(output.constraint, library, ids);
      const target = { constraintId: input.targetConstraintId || undefined, paramId: input.targetParamId || undefined };
      return validateScene(updateNode({ ...scene, algorithms: library }, input.targetNodeId, node => conformMachine(keepHandles(node, placeConstraint(node, generated, target)))));
    },
  },
  /** Decompose again: one constraint (of a minimal example) into the meaningful algorithms its code runs, each its own constraint. */
  split: {
    schema: aiSplitSchema, maxTokens: () => 16000, effort: "medium",
    check: input => needsTarget(input) || (!targetNode(input)!.constraints.some(item => item.id === input.targetConstraintId) ? "Could not find the constraint to divide." : undefined),
    context: input => { const node = targetNode(input)!, key = moduleKeyOf(input.scene!, node.id), code = key && input.previous ? programModules(input.previous).get(key) ?? "" : "";
      return { scene: input.scene, targetNodeId: input.targetNodeId, targetConstraintId: input.targetConstraintId, code: code.slice(0, 40000), instruction: input.instruction }; },
    finalize: (input, output: z.infer<typeof aiSplitSchema>) => {
      const scene = input.scene!, node = targetNode(input)!, { library, ids } = mergeAIAlgorithms(scene.algorithms, output.algorithms);
      // Each part becomes a constraint of its own: ids unique in the node (the parent's own id is taken too).
      const taken = new Set(node.constraints.map(item => item.id));
      const parts = convertConstraints(output.parts, library, ids).map(part => { let id = part.id, n = 2; while (taken.has(id)) id = `${part.id}-${n++}`; taken.add(id); return { ...part, id }; })
        .filter(part => part.params.length);
      const divisible = output.divisible && parts.length >= 2;
      return { divisible, reason: (divisible ? output.reason : output.reason || "There are no meaningful inner algorithms to divide it into.").slice(0, 400), algorithms: divisible ? library : [], parts: divisible ? parts : [] };
    },
  },
  "state-machine": {
    schema: aiNodeMachineSchema, maxTokens: () => 32000, effort: "medium", strokes: true, check: needsTarget,
    context: input => ({ scene: input.scene, targetNodeId: input.targetNodeId, instruction: input.instruction, previous: input.previous }),
    finalize: (input, output: z.infer<typeof aiNodeMachineSchema>) => {
      const scene = input.scene!, { library, ids } = mergeAIAlgorithms(scene.algorithms, output.algorithms);
      const node = withMachine(findNode(scene, input.targetNodeId)!, output, library, ids);
      validateMachine(node, node.machine!);
      return validateScene(updateNode({ ...scene, algorithms: library }, input.targetNodeId, () => node));
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
      const node = withMachine(findNode(scene, input.targetNodeId)!, output, library, ids);
      validateMachine(node, node.machine!);
      return { scene: validateScene(updateNode({ ...scene, algorithms: library }, input.targetNodeId, () => node)), composePrompt: output.composePrompt.trim() || input.composePrompt };
    },
  },
  inspect: {
    schema: inspectResultSchema, maxTokens: () => 16000, effort: "medium",
    check: input => !input.scene || !input.inspection ? "A brush to inspect and its records are needed." : !input.instruction.trim() && !input.inspection.marks.length ? "Write what you want to know, or mark it with an Inspection annotation." : undefined,
    context: input => ({ concern: input.instruction, brush: input.inspection!.brushName, brushNodes: input.scene!.nodes.filter(node => input.inspection!.nodeIds.includes(node.id)),
      algorithms: input.scene!.algorithms, params: input.inspection!.params, steps: input.inspection!.steps, currentStep: input.inspection!.cursor, annotationMarks: input.inspection!.marks, annotationMarkStyles: input.inspection!.markStyles, canvas,
      // The modules that draw the brush, to find constants the concern depends on (hidden parameters).
      code: brushModules(input),
      // A fix was applied (values, a constraint changed or added, a state or transition): the overlays are rebuilt for it.
      ...(input.inspection!.update ? { appliedFix: { kind: input.inspection!.update.kind, title: input.inspection!.update.title, detail: input.inspection!.update.detail, nodeId: input.inspection!.update.nodeId,
          ...(input.inspection!.update.targetId ? { targetId: input.inspection!.update.targetId } : {}), ...(input.inspection!.update.constraintId ? { addedConstraintId: input.inspection!.update.constraintId } : {}),
          ...(input.inspection!.update.changes.length ? { changes: input.inspection!.update.changes } : {}) },
        previousSummary: input.inspection!.update.summary, previousOverlays: input.inspection!.update.overlays } : {}) }),
    /** Drop anything that points outside the brush, so overlays stay applicable. */
    finalize: (input, output: InspectResult) => {
      const nodes = new Map(input.scene!.nodes.filter(node => input.inspection!.nodeIds.includes(node.id)).map(node => [node.id, node]));
      // A hidden parameter is kept only if its edits apply to the module and the result is valid code.
      const parameters = (output.parameters ?? []).filter((item, i, all) => all.findIndex(other => other.nodeId === item.nodeId && other.id === item.id) === i
        && nodes.has(item.nodeId) && !parameterProblem(input.scene!, input.previous, item, parsesModule));
      // Overlays may show a suggested parameter (link and p("…")), only one that is kept.
      const dropped = new Set((output.parameters ?? []).filter(item => !parameters.includes(item)).map(suggestionKey));
      const linked = (kind: string, nodeId: string, id: string) => {
        const node = nodes.get(nodeId); if (!node) return false;
        if (kind === "parameter") return parameters.some(item => item.nodeId === nodeId && item.id === id);
        if (kind === "param") return input.inspection!.params.some(row => row.nodeId === nodeId && row.paramId === id);
        if (kind === "constraint") return node.constraints.some(item => item.id === id);
        return Boolean((kind === "state" ? node.machine?.states : node.machine?.transitions)?.some(item => item.id === id));
      };
      // A handle changes a number or toggle of the brush (or of a kept suggestion); one that cannot is dropped, the overlay stays.
      const specs = new Map<string, { type: string }>([...input.inspection!.params.map(row => [row.key, { type: row.type }] as const), ...parameters.map(item => [suggestionKey(item), item.value] as const)]);
      const handled = (overlay: InspectResult["overlays"][number]) => overlay.handle && !handleProblem(overlay.handle, specs.get(overlay.handle.key)) ? overlay : { ...overlay, handle: null };
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
      return { ...output, summary: output.summary.slice(0, 1500 - note.length) + note, overlays: gripped.map(item => item.each && item.handle && !perItem(item.handle.key) ? { ...item, handle: null } : item),
        parameters, records, fields };
    },
  },
  /** Debugging intent alignment, first half: the tools for drawing the state the user wants at one moment of execution, and presets made with them. */
  "align-kit": {
    schema: alignKitSchema, maxTokens: () => 12000, effort: "medium",
    check: input => !input.scene || !input.inspection?.align || !input.image ? "An Execution frame, its picture and its brush are needed." : undefined,
    // A tool asked for in words: what the user asked and the tools they have.
    context: input => ({ ...alignContext(input), ...(input.instruction.trim() ? { request: input.instruction, toolsSoFar: input.inspection!.align!.tools, variablesSoFar: input.inspection!.align!.variables } : {}) }),
    /**
     * Only tools that change what the frame shows, ids once and none of a base tool: a state tool shows the condition
     * and keeps only grips that change execution state; a behavior tool's code applies to its node's module, is valid
     * and reads every value it gives; no tool that only offers names. Presets keep the objects their tools make and the
     * state their state tools set. Rules on tags keep only what the drawing shows (place, size, turn, color).
     */
    finalize: (input, output: AlignKit) => {
      // A tag links an object of this brush (else none); its rules each set one aspect the drawing shows, written out, an open one with readings to choose.
      const shown = (specs: AlignKit["tools"][number]["specs"]) => keptSpecs(specs).filter(spec => (SPEC_PLACING as readonly string[]).includes(spec.aspect) || spec.aspect === "color");
      const tag = <T extends { nodeId: string; specs: AlignKit["tools"][number]["specs"] }>(item: T, made = true) => ({ ...item, nodeId: made && input.scene && item.nodeId && findNode(input.scene, item.nodeId) ? item.nodeId : "", specs: made ? shown(item.specs) : [] });
      const grips = (tool: AlignKit["tools"][number]) => tool.kind !== "state" ? [] : tool.handles.map(item => item.handle && isRuntimeKey(item.handle.key) && !handleProblem(item.handle, undefined) ? item : { ...item, handle: null });
      // A behavior's code, as it will run in the frame: the module of one of the brush's nodes (as the behaviors the user
      // already has left it, when a tool is asked for), edited, still valid, reading the values, and allowed by the
      // execution guard every program passes (only p5 and plain JavaScript).
      const asked = input.instruction.trim() ? input.inspection?.align?.tools ?? [] : [];
      const base = input.previous && input.scene ? behaviorProgram(input.previous, input.scene, asked).code : "";
      const behaves = (tool: AlignKit["tools"][number]) => {
        if (tool.kind !== "behavior") return true;
        const patch = tool.patch, key = patch && input.scene && input.inspection?.nodeIds.includes(patch.nodeId) ? moduleKeyOf(input.scene, patch.nodeId) : null;
        const module = key && base ? programModules(base).get(key) : undefined;
        if (!module || !patch!.edits.length || !readsBehavior(tool) || !(tool.probe.w > 0 || tool.probe.h > 0)) return false;
        const edited = applyParameterEdits(module, patch!.edits);
        if ("error" in edited || !parsesModule(edited.module)) return false;
        try { prepareCode(base.replace(module, () => edited.module)); return true; } catch { return false; }
      };
      const tools = output.tools.map(tool => ({ ...tool, handles: grips(tool) }))
        .filter((tool, i, all) => all.findIndex(other => other.id === tool.id) === i && ![...BASE_TOOLS, ...OBJECT_BASE_TOOLS].includes(tool.id as never) && tool.kind !== "label"
          && (tool.kind !== "shape" || tool.template.length >= 3) && (tool.kind !== "state" || tool.handles.length > 0) && behaves(tool))
        .map(tool => tag({ ...tool, template: tool.kind === "shape" || tool.kind === "behavior" ? tool.template : [], labels: [], closed: tool.kind === "pen" || tool.kind === "behavior" ? tool.closed : tool.kind === "shape",
          values: tool.kind === "behavior" ? tool.values : [], patch: tool.kind === "behavior" ? tool.patch : null, probe: tool.kind === "behavior" ? tool.probe : { x: 0, y: 0, w: 0, h: 0 } }, tool.kind === "shape" || tool.kind === "pen"));
      if (!tools.length) throw new Error("Could not make tools for this moment. Please try again.");
      const presets = output.presets.map(preset => ({ ...preset, objects: preset.objects.filter((item, i, all) => all.findIndex(other => other.id === item.id) === i && toolKind(item.tool, tools)).slice(0, MAX_IDEAL_OBJECTS).map(item => tag(item)) }))
        .map(preset => ({ ...preset, merges: preset.merges.map(merge => ({ ...merge, members: [...new Set(merge.members)].filter(id => preset.objects.some(item => item.id === id && toolKind(item.tool, tools) === "shape")) })).filter(merge => merge.members.length > 1) }))
        .map(preset => ({ ...preset, state: Object.entries(presetValues(preset, tools)).map(([key, value]) => ({ key, value })) }))
        .filter(preset => preset.objects.length > 0 || preset.state.length > 0);
      return { reading: output.reading, tools, presets, variables: keptVariables(output.variables) };
    },
  },
  /** Debugging intent alignment, second half: the change of the brush that makes it do what the user drew at that moment. */
  align: {
    schema: alignFixSchema, maxTokens: () => 8000, effort: "medium",
    check: input => !input.scene || !input.inspection?.align || !input.image ? "An Execution frame and its brush are needed."
      : !input.instruction.trim() && !input.inspection.marks.length && !input.inspection.align.ideal.objects.length && !input.inspection.align.state.length ? "Draw the state you want at this moment, set it, or say it." : undefined,
    context: input => { const align = input.inspection!.align!;
      return { ...alignContext(input), request: input.instruction, reading: align.reading, ...(align.preset ? { startedFrom: align.preset } : {}),
        drawn: describeIdeal(align.ideal, align.tools), stateSet: align.state, notes: input.inspection!.marks, ...(align.refs.length ? { refs: align.refs } : {}),
        // Behaviors the user drew: the frame ran with this code reading what they drew.
        ...(() => { const tried = align.tools.filter(tool => tool.kind === "behavior" && tool.patch && align.ideal.objects.some(item => item.tool === tool.id))
          .map(tool => ({ tool: tool.name, drawn: align.ideal.objects.filter(item => item.tool === tool.id).map(item => item.id), values: tool.values.map(({ id, label, kind, expr, fallback }) => ({ key: `@tool/${tool.id}/${id}`, label, kind, expr, fallback })), patch: tool.patch }));
          return tried.length ? { behaviors: tried } : {}; })() }; },
    /** The fix stays one of this brush (its target exists); else nothing changes. */
    finalize: (input, output: AlignFix) => settledFix(input, output),
  },
  /**
   * A widget on the tag of a drawn object: AI reads what the rules written there mean and makes a direct manipulation
   * interface on the picture for trying what they could be instead (the values it changes, the rules it writes with them, its code).
   */
  "tag-widget": {
    schema: tagWidgetSchema, maxTokens: () => 24000, effort: "medium",
    check: input => !input.scene || !input.inspection?.align?.widget || !input.image ? "An Execution frame, its picture and the tagged object are needed."
      : !input.inspection.align.widget.rules.some(rule => rule.expr.trim()) ? "Write a rule on the tag first." : undefined,
    context: input => { const align = input.inspection!.align!, widget = align.widget!, drawn = describeIdeal(align.ideal, align.tools);
      return { ...alignContext(input), reading: align.reading, object: { ...drawn.objects.find(item => item.id === widget.object), box: widget.box, rules: widget.rules },
        others: drawn.objects.filter(item => item.id !== widget.object), ...(align.refs.length ? { refs: align.refs } : {}),
        ...(widget.current ? { current: widget.current } : {}), ...(input.instruction.trim() ? { request: input.instruction } : {}) }; },
    /** Values of their kinds, rules using only them; the code registers a widget and runs guarded (else an error to try again). */
    finalize: (_input, output: TagWidgetSpec) => { const kept = keptWidget(output); return { ...kept, prepared: prepareHandle(kept.code) }; },
  },
  concern: {
    schema: concernSuggestionsSchema, maxTokens: () => 3000, effort: "low",
    check: input => !input.scene || !input.inspection ? "A brush to inspect is needed." : !input.inspection.marks.length && !input.instruction.trim() ? "Mark it with an Inspection annotation or write a concern." : undefined,
    context: input => ({ typed: input.instruction, brush: input.inspection!.brushName,
      brushNodes: input.scene!.nodes.filter(node => input.inspection!.nodeIds.includes(node.id)).map(node => ({ id: node.id, name: node.name, kind: node.kind, description: node.description, region: node.region,
        constraints: node.constraints.map(item => ({ label: item.property, description: item.description, params: item.params.map(param => ({ label: param.label, description: param.description })) })),
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
    context: input => ({ concern: input.instruction, brush: input.inspection!.brushName, brushNodes: input.scene!.nodes.filter(node => input.inspection!.nodeIds.includes(node.id)),
      algorithms: input.scene!.algorithms, params: input.inspection!.params, steps: input.inspection!.steps, currentStep: input.inspection!.cursor, input: input.explore!.input, canvas,
      code: brushModules(input), inspection: { summary: input.explore!.summary, overlays: input.explore!.overlays } }),
    /**
     * Keep only what this frame can run: inner terms and decisions that apply to the module (its steps are the brush's
     * own state machine steps, recorded by the runtime: no checkpoints are added), overlays of the brush's parts.
     */
    finalize: (input, output: ExploreResult) => {
      const nodes = new Map(input.scene!.nodes.filter(node => input.inspection!.nodeIds.includes(node.id)).map(node => [node.id, node]));
      const notes: string[] = [];
      // Wrappers that name inner terms and decisions of the steps (m.term, m.test, m.runtime), changing nothing the code does.
      let edits = output.edits.filter(edit => nodes.has(edit.nodeId) && traceOnly(edit));
      const program = edits.length ? exploreProgram(input.previous, input.scene!, { edits }) : null;
      const modules = (code: string) => [...new Set(edits.map(edit => moduleKeyOf(input.scene!, edit.nodeId)!))].map(key => programModules(code).get(key) ?? "");
      if (program && ("error" in program || !modules(program.code).every(parsesModule))) { edits = []; notes.push("Could not add the code that names the steps' inner terms, so only the state machine steps are shown."); }
      const linked = (kind: string, nodeId: string, id: string) => {
        const node = nodes.get(nodeId); if (!node) return false;
        if (kind === "param") return input.inspection!.params.some(row => row.nodeId === nodeId && row.paramId === id);
        if (kind === "constraint") return node.constraints.some(item => item.id === id);
        return Boolean((kind === "state" ? node.machine?.states : node.machine?.transitions)?.some(item => item.id === id));
      };
      // They explain the steps; execution goes by the buttons, the keys and pressing a part of the picture.
      const overlays = output.overlays.filter(item => linked(item.link.kind, item.link.nodeId, item.link.id));
      // Steps only when there are steps to move between; a range too narrow to move in is the whole.
      const axis = output.axis === "steps" && input.inspection!.steps.length < 2 ? "input" : output.axis;
      const [from, to] = output.to - output.from >= .02 ? [output.from, output.to] : [0, 1];
      // A run's steps are its state machine steps: what each is comes from the brush itself (its states, constraints and
      // transitions), so no operations are named here. Steps are run with the buttons and keys, never by drawing marks.
      const stages: ExploreResult["stages"] = [], sketches: ExploreResult["sketches"] = [];
      // What the execution and each operation are part of: only constraints, states and transitions the brush has (or the preview brings), each once.
      const parts = (list: ExploreResult["of"]) => list.filter((part, i, all) => all.findIndex(other => other.kind === part.kind && other.nodeId === part.nodeId && other.id === part.id) === i
        && (part.kind === "constraint" ? Boolean(nodes.get(part.nodeId)?.constraints.some(item => item.id === part.id)) : linked(part.kind, part.nodeId, part.id)));
      const linkedStages = stages;
      const note = notes.length ? ` (${notes.join(" ")})` : "";
      return { ...output, summary: output.summary.slice(0, 1200 - note.length) + note, axis, from, to, edits, overlays, stages: linkedStages, sketches,
        of: parts([...(output.of ?? []), ...linkedStages.flatMap(stage => stage.of)]).slice(0, 4) };
    },
  },
  handles: {
    schema: aiHandlesSchema, maxTokens: () => 32000, effort: "medium",
    check: input => needsTarget(input) || (!input.targetParamId && !input.targetConstraintId ? "Direct manipulation handles are made for one param or one constraint." : undefined) || (!handleTargets(targetNode(input)!, input.scene!.algorithms, handleTarget(input)).length ? "There is no param that a direct manipulation handle can control." : undefined),
    context: input => { const node = targetNode(input)!, r = node.region, params = handleTargets(node, input.scene!.algorithms, handleTarget(input));
      // The widget area each will get in the proxy frame, given how many the node will show.
      // Each constraint has its own proxy frame: the cell this request's first param gets there once its widgets are in.
      const designed = new Set(params.map(item => item.paramId)), owner = node.constraints.find(item => item.params.some(param => designed.has(param.id)));
      const cell = proxySections([owner ? owner.params.filter(param => param.handle || designed.has(param.id)).length : 1])[0].cells[0];
      return { targetNodeId: node.id, node: { name: node.name, kind: node.kind, description: node.description, primitive: node.primitive, region: { x: r.x * canvas.width, y: r.y * canvas.height, w: r.w * canvas.width, h: r.h * canvas.height } },
        params, widgetArea: { w: Math.round(cell.w), h: Math.round(cell.h - CELL_HEADER) }, instruction: input.instruction, canvas }; },
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
