import { z } from "zod";
import { clarificationSchema, codeSchema, compositionPromptSchema, generatedSchema, type requestSchema } from "../lib/schema";
import { aiMachineRefineSchema, aiNodeMachineSchema, aiRevisionSchema, aiSceneSchema, aiSplitSchema, aiTransformSchema } from "../lib/scene/ai-schema";
import { withMachine, convertScene, convertConstraint, convertConstraints } from "../lib/scene/convert";
import { descendantIds, findNode, moduleKeyOf, updateNode } from "../lib/scene/graph";
import { conformMachine, programModules, validateMachine } from "../lib/scene/machines";
import { settleProposal, validateSceneProposal } from "../lib/scene/revisions";
import { canAddConstraint, placeConstraint } from "../lib/scene/constraints";
import { validateScene } from "../lib/scene/validate";
import { bindingKey, sceneBindings, sceneValues } from "../lib/scene/values";
import { nodeParams } from "../lib/scene/constraints";
import { clarifySchema, settleClarify, type Clarify } from "../lib/execution/manipulate";
import { generalizeSchema, settleGeneralize, type Generalize } from "../lib/execution/generalize";
import { connectScene } from "./scene-code.server";
import { aiCompositionPromptSchema, aiTagRevisionSchema, settleComposeTags, settleConstraint, tagRevisionSchema, tagsForAI, tagsForCompose } from "../lib/compose-tags";
import { aiHandlesSchema, CELL_HEADER, handleTargets, keepHandles, proxySections, settleHandles, type AIHandles } from "../lib/scene/handles";
import { prepareCode, prepareHandle } from "./code.server";
import { analysisSchema, MAX_ANALYSIS_PATHS } from "../lib/execution/trace";
import { overlayPlanSchema } from "../lib/execution/overlay";
import { aiSandboxesSchema, settleSandboxes, type AISandboxes } from "../lib/execution/concern-sandbox";
import { aiRestructureSchema, settleRestructure, type AIRestructure } from "../lib/execution/sandbox-restructure";
import { aiSketchClarifySchema, MAX_CLARIFY_STAGES, settleSketchClarify, type SketchClarifyResult } from "../lib/sketch-clarify";

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
/** The code of the modules that draw the inspected brush (by module key). */
function traceModules(input: AIInput) {
  if (!input.previous || !input.scene || !input.trace) return {};
  const all = programModules(input.previous), keys = new Set(input.trace.nodeIds.map(id => moduleKeyOf(input.scene!, id)).filter((key): key is string => Boolean(key)));
  return Object.fromEntries([...keys].filter(key => all.has(key)).map(key => [key, all.get(key)!.slice(0, 40000)]));
}
/** The inspected brush's nodes: their constraints and machines (what the steps are steps of). */
function traceBrush(input: AIInput) {
  const ids = new Set(input.trace?.nodeIds ?? []);
  return (input.scene?.nodes ?? []).filter(node => ids.has(node.id)).map(node => ({ id: node.id, name: node.name, kind: node.kind, parentId: node.parentId,
    constraints: node.constraints.map(item => ({ id: item.id, property: item.property, description: item.description, params: item.params.map(param => param.id) })),
    machine: node.machine }));
}
/** The params of the inspected brush (what m.v("<node>/<param>") reads), with their current values. */
function traceParams(input: AIInput) {
  const ids = new Set(input.trace?.nodeIds ?? []);
  return (input.scene?.nodes ?? []).filter(node => ids.has(node.id)).flatMap(node => nodeParams(node).map(param =>
    ({ key: bindingKey([node.id, param.id]), label: param.label, description: param.description, ...param.value })));
}
const strokeContext = (input: AIInput) => ({ compositionPens: input.compositionPens, compositionStrokes: input.compositionStrokes, canvas });
const targetNode = (input: AIInput) => input.scene && findNode(input.scene, input.targetNodeId);
const handleTarget = (input: AIInput) => ({ constraintId: input.targetConstraintId || undefined, paramId: input.targetParamId || undefined });
const needsTarget = (input: AIInput) => !targetNode(input) ? "Could not find the target Collection or Object." : undefined;
/** The modules the code must define: one per root node, with the node ids it draws. */
const codeModules = (scene: NonNullable<AIInput["scene"]>) => scene.nodes.filter(node => !node.parentId).map(root => ({ key: root.id, nodes: [root.id, ...descendantIds(scene, root.id)] }));
const needsScene = (input: AIInput) => !input.scene?.nodes.length ? "Extract collections and objects from the sketch first." : undefined;

export const intents: Record<"extract" | "compose" | "transform" | "state-machine" | "machine-refine" | "handles" | "code" | "compose-prompt" | "clarification" | "revision" | "split" | "tag-revise" | "trace-analyze" | "trace-overlay" | "trace-clarify" | "trace-part" | "sandbox-restructure" | "sketch-clarify" | "trace-generalize", Intent> = {
  /** Inspection: the recorded steps (sites) and variables that explain a concern about a brush's execution. */
  "trace-analyze": {
    schema: analysisSchema, maxTokens: () => 8000, effort: "medium",
    check: input => !input.trace ? "Nothing was recorded to inspect." : !input.trace.sites.length ? "No steps were recorded yet: use the brush on this frame first." : undefined,
    context: input => ({ concern: input.trace!.concern, marks: input.trace!.marks, code: traceModules(input), brush: traceBrush(input), sites: input.trace!.sites, cycles: input.trace!.cycles, canvas }),
    finalize: (input, output: z.infer<typeof analysisSchema>) => {
      // Only sites that were recorded, with variables seen there (or the step's own fields).
      const known = new Map(input.trace!.sites.map(site => [String(site.site), site]));
      const sites = output.sites.filter(site => known.has(site.site)).map(site => {
        const names = new Set(Object.keys((known.get(site.site)!.variables ?? {}) as Record<string, unknown>));
        const recorded = (paths: string[]) => [...new Set(paths)].filter(path => path.startsWith("@") ? names.has(path.slice(1).split(".")[0]) : ["state", "key", "property", "event"].includes(path)).slice(0, MAX_ANALYSIS_PATHS);
        const show = recorded(site.show), locate = recorded(site.locate).filter(path => !show.includes(path));
        const range = site.range && site.range.end >= site.range.start ? site.range : null;
        return { ...site, show, locate, range };
      });
      if (!sites.length) throw new Error("No recorded step explains this concern. Use the brush so the behavior happens, then inspect again.");
      return { ...output, sites, cycleCount: Math.max(1, Math.min(output.cycleCount, input.trace!.cycles || 1)) };
    },
  },
  /** Inspection: code that places the chosen variables on the picture, per site. */
  "trace-overlay": {
    schema: overlayPlanSchema, maxTokens: () => 16000, effort: "medium",
    check: input => !input.trace?.analysis ? "Choose what to inspect first." : undefined,
    context: input => ({ concern: input.trace!.concern, marks: input.trace!.marks, code: traceModules(input), sites: input.trace!.sites, canvas }),
  },
  /** Inspection: the direct manipulation tools that make a concern clear (or first, the rule to pick for them). */
  "trace-clarify": {
    schema: clarifySchema, maxTokens: () => 20000, effort: "medium",
    check: input => !input.trace ? "Nothing was recorded to inspect." : !input.trace.sites.length ? "No steps were recorded yet: use the brush on this frame first." : undefined,
    context: input => ({ concern: input.trace!.concern, marks: input.trace!.marks, code: traceModules(input), brush: traceBrush(input), sites: input.trace!.sites, cycles: input.trace!.cycles,
      analysis: input.trace!.analysis, params: traceParams(input), choice: input.trace!.choice, ...(input.trace!.feedback ? { feedback: input.trace!.feedback } : {}), canvas }),
    finalize: (input, output: Clarify) => settleClarify(output,
      input.trace!.sites.map(site => ({ site: String(site.site), variables: Object.keys((site.variables ?? {}) as Record<string, unknown>) })),
      traceParams(input), Boolean(input.trace!.choice)),
  },
  /** A demonstration made the brush's own rule: the rules what was shown could be, each with a preview, to pick one. */
  "trace-generalize": {
    schema: generalizeSchema, maxTokens: () => 20000, effort: "medium",
    check: input => !input.trace || !input.previous || !input.image || !input.instruction.trim() ? "Show something with the tools first." : undefined,
    context: input => ({ demonstration: input.instruction, annotations: input.annotations, code: traceModules(input), brush: traceBrush(input), params: traceParams(input), sites: input.trace!.sites, canvas }),
    finalize: (_input, output: Generalize) => settleGeneralize(output),
  },
  /** Inspection: the one part of the brush a concern is about, for a mini sandbox of it (a part frame with handles). */
  "trace-part": {
    schema: aiSandboxesSchema, maxTokens: () => 20000, effort: "medium",
    check: input => !input.trace ? "Say what to look into first." : !input.scene?.nodes.length ? "Generate this frame's result first." : undefined,
    context: input => { const ids = new Set(input.trace!.nodeIds);
      return { concern: input.trace!.concern, marks: input.trace!.marks, code: traceModules(input), canvas,
        brush: input.scene!.nodes.filter(node => ids.has(node.id)).map(node => ({ id: node.id, name: node.name, kind: node.kind, parentId: node.parentId, description: node.description,
          constraints: node.constraints.map(item => ({ id: item.id, property: item.property, description: item.description, params: item.params.map(param => ({ id: param.id, label: param.label, ...param.value })) })) })) }; },
    finalize: (input, output: AISandboxes) => settleSandboxes(input.scene!, input.trace!.nodeIds, output),
  },
  /** A mini sandbox whose params may not give what its concern asks: 2–4 structural changes of its part, each with a preview. */
  "sandbox-restructure": {
    schema: aiRestructureSchema, maxTokens: () => 24000, effort: "medium",
    check: input => needsTarget(input) || (!input.instruction.trim() ? "Say what the sandbox is for first." : !targetNode(input)!.constraints.some(item => item.id === input.targetConstraintId) ? "Could not find the sandbox's part." : undefined),
    context: input => { const node = targetNode(input)!, constraint = node.constraints.find(item => item.id === input.targetConstraintId)!, key = moduleKeyOf(input.scene!, node.id);
      return { concern: input.instruction, node: { id: node.id, name: node.name, description: node.description }, constraint, code: (key && input.previous ? programModules(input.previous).get(key) ?? "" : "").slice(0, 40000), canvas }; },
    finalize: (input, output: AIRestructure) => settleRestructure(output, input.targetConstraintId),
  },
  /** Before Extract / Compose: the next stage of questions about what is still ambiguous (or that it is clear enough). */
  "sketch-clarify": {
    schema: aiSketchClarifySchema, maxTokens: () => 16000, strokes: true,
    check: input => !input.image ? "A sketch image is needed to clarify it." : !input.sketchClarify ? "Nothing to clarify." : undefined,
    context: input => { const ask = input.sketchClarify!;
      return { mode: ask.mode, instruction: input.instruction, ...(input.composeTags.length ? { tags: tagsForCompose(input.composeTags) } : {}),
        stage: ask.stages.length + 1, maxStages: MAX_CLARIFY_STAGES, mustAsk: ask.askAnyway || !ask.stages.length, answered: ask.stages.map((questions, k) => ({ stage: k + 1, questions })), canvas }; },
    finalize: (input, output: SketchClarifyResult) => settleSketchClarify(output, input.sketchClarify!.stages.length),
  },
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
      const scene = input.scene!;
      const generated = convertConstraint(output.constraint);
      const target = { constraintId: input.targetConstraintId || undefined, paramId: input.targetParamId || undefined };
      return validateScene(updateNode(scene, input.targetNodeId, node => conformMachine(keepHandles(node, placeConstraint(node, generated, target)))));
    },
  },
  /** Decompose again: one constraint (of a minimal example) into the meaningful computations its code runs, each its own constraint. */
  split: {
    schema: aiSplitSchema, maxTokens: () => 16000, effort: "medium",
    check: input => needsTarget(input) || (!targetNode(input)!.constraints.some(item => item.id === input.targetConstraintId) ? "Could not find the constraint to divide." : undefined),
    context: input => { const node = targetNode(input)!, key = moduleKeyOf(input.scene!, node.id), code = key && input.previous ? programModules(input.previous).get(key) ?? "" : "";
      return { scene: input.scene, targetNodeId: input.targetNodeId, targetConstraintId: input.targetConstraintId, code: code.slice(0, 40000), instruction: input.instruction }; },
    finalize: (input, output: z.infer<typeof aiSplitSchema>) => {
      const node = targetNode(input)!;
      // Each part becomes a constraint of its own: ids unique in the node (the parent's own id is taken too).
      const taken = new Set(node.constraints.map(item => item.id));
      const parts = convertConstraints(output.parts).map(part => { let id = part.id, n = 2; while (taken.has(id)) id = `${part.id}-${n++}`; taken.add(id); return { ...part, id }; })
        .filter(part => part.params.length);
      const divisible = output.divisible && parts.length >= 2;
      return { divisible, reason: (divisible ? output.reason : output.reason || "There are no meaningful inner computations to divide it into.").slice(0, 400), parts: divisible ? parts : [] };
    },
  },
  "state-machine": {
    schema: aiNodeMachineSchema, maxTokens: () => 32000, effort: "medium", strokes: true, check: needsTarget,
    context: input => ({ scene: input.scene, targetNodeId: input.targetNodeId, instruction: input.instruction, previous: input.previous }),
    finalize: (input, output: z.infer<typeof aiNodeMachineSchema>) => {
      const scene = input.scene!;
      const node = withMachine(findNode(scene, input.targetNodeId)!, output);
      validateMachine(node, node.machine!);
      return validateScene(updateNode(scene, input.targetNodeId, () => node));
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
      const scene = input.scene!;
      const node = withMachine(findNode(scene, input.targetNodeId)!, output);
      validateMachine(node, node.machine!);
      return { scene: validateScene(updateNode(scene, input.targetNodeId, () => node)), composePrompt: output.composePrompt.trim() || input.composePrompt };
    },
  },
  handles: {
    schema: aiHandlesSchema, maxTokens: () => 32000, effort: "medium",
    check: input => needsTarget(input) || (!input.targetParamId && !input.targetConstraintId ? "Direct manipulation handles are made for one param or one constraint." : undefined) || (!handleTargets(targetNode(input)!, handleTarget(input)).length ? "There is no param that a direct manipulation handle can control." : undefined),
    context: input => { const node = targetNode(input)!, r = node.region, params = handleTargets(node, handleTarget(input));
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
      const current = input.scene!, proposed = settleProposal(current, convertScene(output));
      validateSceneProposal(current, proposed);
      return { summary: output.summary, scene: proposed };
    },
  },
};
export type IntentName = keyof typeof intents;
export const isIntent = (name: string): name is IntentName => name in intents;
/** JSON schema sent as the structured output format; `npm run prompts:schemas` writes it to prompts/schemas. */
export const outputSchema = (intent: IntentName, input?: AIInput) => z.toJSONSchema((input && intents[intent].variant?.(input)?.schema) || intents[intent].schema, { target: "draft-7" });
