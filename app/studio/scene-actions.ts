import { reviseTag, tagRevisionSchema } from "../lib/compose-tags";
import { compositionPromptSchema, generatedSchema, machineRefineResultSchema, splitResultSchema, type MachineMark, type MachineTarget } from "../lib/schema";
import { annotatedImage, compactMarks, type Marks } from "./annotated-image";
import { compositionContext } from "../lib/semantic-pens";
import { emptyMachineDraft, type SketchPanel } from "../lib/sketch-panels";
import { isBackdrop, markBrushes } from "../lib/brushes";
import type { ParamHandle, Scene, ScalarValue, SceneNode, Constraint } from "../lib/scene/schema";
import { MAX_NESTING_DEPTH } from "../lib/scene/schema";
import { sceneSchema } from "../lib/scene/validate";
import { findNode, updateNode, groupNodes, moveNodes, removeNodes, reorderNode, sceneDepth, selectionRoots, setParent, ungroupNode, uniqueNodeId } from "../lib/scene/graph";
import * as ops from "../lib/scene/panel-ops";
import { moveNodeTo, pasteConstraint, transplantNodes, type ConstraintClip } from "../lib/scene/transfer";
import { liveSceneSource } from "../lib/scene/live";
import { hasModules, ownCodeIds, programModules } from "../lib/scene/machines";
import { stampModule } from "../lib/scene/stamp";
import { decomposeTargets, exampleLabel, exampleScene, minimalExampleInstruction, nodeExampleInstruction, type ExampleTarget } from "../lib/scene/minimal-example";
import { findConstraint, setDragOff } from "../lib/scene/constraints";
import { applyHandles, handleLeaves, handleSuggestionsSchema, handleConstraints, proxyGroups, setHandle, type HandleTarget } from "../lib/scene/handles";
import { MAX_SKETCH_FRAMES, type FrameId } from "../lib/workspace";
import { sandboxHandleInstruction, sandboxInstruction, sandboxSchema, sandboxTarget, type SandboxPart } from "../lib/execution/concern-sandbox";
import { partNodes } from "../lib/scene/propagation";
import type { StudioDeps } from "./deps";
import { answeredStages, clarifiedText, MAX_CLARIFY_STAGES, settleSketchClarify, startingAnswers, aiSketchClarifySchema, type ClarifyAnswer, type ClarifyMode, type SketchClarifyState } from "../lib/sketch-clarify";

export const tagRevisionLabel = "AI is changing the tag's constraint…";
export const sketchClarifyLabel = "AI is checking what is still ambiguous in the sketch…";
export const compositionPromptLabel = "AI is reading the sketch and pen meanings to write the Compose prompt…";

/** How example frames wait when the server is busy with other AI requests (tests shorten it). */
export const exampleRetry = { ms: 2500, attempts: 6 };
const BUSY = /request is in progress/i;
/** A request the server turned away for being busy goes again a little later (as an example frame's code does). */
async function patient<T>(send: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try { return await send(); }
    catch (error) { if (attempt >= exampleRetry.attempts || !(error instanceof Error && BUSY.test(error.message))) throw error; }
    await new Promise(resolve => setTimeout(resolve, exampleRetry.ms * attempt));
  }
}

/** Local scene edits (no AI) for one sketch panel. */
export function sceneEdits(deps: StudioDeps, owner: string) {
  const apply = (op: (panel: SketchPanel) => Partial<SketchPanel>) => deps.updatePanel(owner, panel => panel.loading ? {} : op(panel));
  /** Layer edits that would nest deeper than MAX_NESTING_DEPTH are refused. */
  const tooDeep = (scene: Scene) => sceneDepth(scene) > MAX_NESTING_DEPTH ? { error: `Brush stamps can be nested at most ${MAX_NESTING_DEPTH} levels deep.` } : null;
  const structural = (edit: (scene: Scene, panel: SketchPanel) => Scene, dirty?: (panel: SketchPanel) => string[]) => apply(panel => { const next = edit(panel.scene, panel); return tooDeep(next) || ops.commitScene(panel, next, dirty?.(panel)); });
  return {
    select: (id: string | null, additive = false) => deps.updatePanel(owner, panel => ops.selectNodes(panel, id, additive)),
    hover: (id: string | null) => deps.updatePanel(owner, { hovered: id }),
    move: (scene: Scene, before?: Scene) => apply(panel => before ? ops.commitSceneFrom(panel, before, scene) : ops.commitScene(panel, scene)),
    /** Live drag preview: the scene (and the running result) follows without an undo entry. */
    preview: (scene: Scene) => apply(panel => ops.setScene(panel, scene)),
    nudge: (dx: number, dy: number) => structural((scene, panel) => moveNodes(scene, panel.selectedNodeIds, dx, dy)),
    rename: (id: string, name: string) => apply(panel => ops.editNode(panel, id, { name }, true)),
    toggleVisible: (id: string) => apply(panel => ops.editNode(panel, id, { visible: !findNode(panel.scene, id)?.visible }, true)),
    group: () => apply(panel => {
      const id = uniqueNodeId(panel.scene, "collection");
      const roots = selectionRoots(panel.scene, panel.selectedNodeIds);
      if (!roots.length) return {};
      const next = groupNodes(panel.scene, roots, id, `Brush stamp ${panel.scene.nodes.filter(node => node.kind === "collection").length + 1}`);
      return tooDeep(next) || { ...ops.commitScene(panel, next, roots), selectedNodeIds: [id] };
    }),
    ungroup: (id: string) => structural(scene => ungroupNode(scene, id)),
    remove: () => structural((scene, panel) => removeNodes(scene, panel.selectedNodeIds)),
    /** Delete these nodes (e.g. one brush stamp) whatever is selected. */
    removeIds: (ids: string[]) => structural(scene => removeNodes(scene, ids)),
    reparent: (id: string, parentId: string | null, beforeId: string | null) => structural(scene => setParent(scene, id, parentId, beforeId), () => [id]),
    reorder: (id: string, direction: -1 | 1) => structural(scene => reorderNode(scene, id, direction)),
    add: (kind: "collection" | "object") => apply(panel => {
      const id = uniqueNodeId(panel.scene, kind === "collection" ? "collection" : "object");
      const parent = findNode(panel.scene, panel.selectedNodeIds[0]);
      const node: SceneNode = { id, kind, parentId: parent?.kind === "collection" ? parent.id : null, name: kind === "collection" ? "New brush stamp" : "New object", description: "", primitive: kind === "collection" ? "group" : "shape",
        region: parent ? parent.region : { x: .4, y: .4, w: .2, h: .2 }, constraints: [], visible: true, machine: null };
      return panel.scene.nodes.length >= 48 ? {} : { ...ops.commitScene(panel, { ...panel.scene, nodes: [...panel.scene.nodes, node] }, [id]), selectedNodeIds: [id] };
    }),
    undo: () => apply(ops.undoScene),
    redo: () => apply(ops.redoScene),
    scalar: (nodeId: string, paramId: string, path: string[], raw: ScalarValue["value"]) => apply(panel => ops.setParamScalar(panel, nodeId, paramId, path, raw)),
    /** A value drag turned off (its value is adjusted by its param only) or on again: one undo step, nothing regenerated. */
    dragOff: (nodeId: string, constraintId: string, index: number, off: boolean) => structural(scene => updateNode(scene, nodeId, node => setDragOff(node, constraintId, index, off))),
    editNode: (nodeId: string, patch: Parameters<typeof ops.editNode>[2]) => apply(panel => ops.editNode(panel, nodeId, patch)),
    editParam: (nodeId: string, paramId: string, patch: Parameters<typeof ops.editParam>[3]) => apply(panel => ops.editParam(panel, nodeId, paramId, patch)),
    removeParam: (nodeId: string, paramId: string) => apply(panel => ops.removeParam(panel, nodeId, paramId)),
    /** A param's handle changed (its hint) or removed (null). UI only: the code needs nothing new. */
    handle: (nodeId: string, paramId: string, handle: ParamHandle | null) => apply(panel => ops.commitScene(panel, setHandle(panel.scene, nodeId, paramId, handle))),
    /** A new slider param in a constraint. */
    addParam: (nodeId: string, constraintId?: string | null) => {
      try { deps.updatePanel(owner, ops.addSliderParam(deps.panel(owner), nodeId, constraintId)); }
      catch (error) { deps.updatePanel(owner, { error: (error as Error).message }); }
    },
    addConstraint: (nodeId: string) => apply(panel => ops.addConstraint(panel, nodeId)),
    editConstraint: (nodeId: string, constraintId: string, patch: Parameters<typeof ops.editConstraint>[3]) => apply(panel => ops.editConstraint(panel, nodeId, constraintId, patch)),
    removeConstraint: (nodeId: string, constraintId: string) => apply(panel => ops.removeConstraint(panel, nodeId, constraintId)),
    moveConstraint: (nodeId: string, constraintId: string, offset: number) => apply(panel => ops.moveConstraint(panel, nodeId, constraintId, offset)),
    /** Whether a state evaluates a constraint (live: the order is host data). */
    stateConstraint: (nodeId: string, stateId: string, constraintId: string, included: boolean) => apply(panel => ops.setStateConstraintIncluded(panel, nodeId, stateId, constraintId, included)),
    relocateConstraint: (fromNodeId: string, constraintId: string, toNodeId: string, beforeId: string | null) => apply(panel => ops.relocateConstraint(panel, fromNodeId, constraintId, toNodeId, beforeId)),
    /** A copied constraint (from this sketch or another) pasted into a node, after `afterId` (none: at its end). */
    pasteConstraint: (nodeId: string, clip: ConstraintClip, afterId?: string | null) => apply(panel => {
      try { return ops.commitScene(panel, pasteConstraint(panel.scene, nodeId, clip, afterId), [nodeId]); }
      catch (error) { return { error: (error as Error).message }; }
    }),
    chooseState: (nodeId: string, stateId: string | null) => { deps.updatePanel(owner, panel => ops.chooseState(panel, nodeId, stateId)); deps.focus(owner as FrameId); },
    editState: (nodeId: string, stateId: string, patch: Parameters<typeof ops.editMachineState>[3]) => apply(panel => ops.editMachineState(panel, nodeId, stateId, patch)),
    editTransition: (nodeId: string, transitionId: string, patch: Parameters<typeof ops.editTransition>[3]) => apply(panel => ops.editTransition(panel, nodeId, transitionId, patch)),
    removeMachine: (nodeId: string) => apply(panel => ops.removeMachine(panel, nodeId)),
  };
}

/**
 * Drop a layer onto a sketch (its sketch frame or its result frame). Another
 * sketch gets a copy (members, blocks and machines included) and its generated
 * result is produced right away; the same sketch just moves the node, which
 * the running result follows through the live layout keys.
 */
export async function dropNode(deps: StudioDeps, from: string, nodeId: string, to: string, at: { x: number; y: number }) {
  const source = deps.panel(from), target = deps.panel(to);
  if (source.loading || target.loading) return;
  if (from === to) { deps.updatePanel(to, panel => ops.commitScene(panel, moveNodeTo(panel.scene, nodeId, at))); return; }
  // A root node has its own code module: copy it with the node, no AI needed.
  const node = findNode(source.scene, nodeId), key = node && !node.parentId ? node.codeModule ?? node.id : null;
  const text = key && source.generated ? programModules(source.generated.code).get(key) : undefined;
  if (key && text && (!target.generated || hasModules(target.generated.code))) {
    try {
      const result = stampModule(target, source.scene, nodeId, { key, text }, [at], node!.name);
      deps.activate(to);
      deps.updatePanel(to, panel => ({ ...ops.commitScene(panel, result.scene, []), generated: result.generated, codeDraft: result.generated.code, selectedNodeIds: result.roots, runtimeError: "" }));
      deps.focus(to as FrameId);
      deps.toast(`Copied ${node!.name} into this sketch.`);
    } catch (error) { deps.updatePanel(to, { error: (error as Error).message }); }
    return;
  }
  let rootId: string;
  try {
    const result = transplantNodes(source.scene, nodeId, target.scene, at);
    rootId = result.rootId;
    deps.activate(to);
    // The result frame appears immediately and shows progress until the code arrives.
    deps.updatePanel(to, panel => ({ ...ops.commitScene(panel, result.scene, [result.rootId]), selectedNodeIds: [result.rootId], pendingResult: true }));
    deps.focus(to as FrameId);
    deps.toast(`Copied ${findNode(result.scene, rootId)?.name} into this sketch and generating the result.`);
  } catch (error) { deps.updatePanel(to, { error: (error as Error).message }); return; }
  try { await sceneAI(deps, to).generateCode(); }
  finally { deps.updatePanel(to, { pendingResult: false }); }
}

async function sketchContext(deps: StudioDeps, owner: string) {
  const artwork = deps.artwork(owner);
  if (!artwork) throw new Error("Could not find the sketch.");
  return { artwork, image: (await deps.capture(owner, true)).image, ...compositionContext(artwork) };
}

/** Whether the user is still on this frame (unknown: assume yes). */
const stillHereFor = (deps: StudioDeps) => (frame: string) => !deps.active || deps.active() === frame;

/** How a regenerated part is named to the code step: the constraint (or param) and its node. */
function describeTarget(scene: Scene, nodeId: string, target: { constraintId?: string; paramId?: string }) {
  const node = findNode(scene, nodeId);
  if (!node) return "A constraint";
  const owner = target.paramId ? node.constraints.find(item => item.params.some(param => param.id === target.paramId))
    : target.constraintId ? node.constraints.find(item => item.id === target.constraintId) : node.constraints.at(-1);
  const param = target.paramId ? owner?.params.find(item => item.id === target.paramId) : undefined;
  return `${param ? `Param "${param.label}" (${param.id}) of ` : ""}constraint "${owner?.property ?? ""}" (${owner?.id ?? ""}) of node "${node.name}" (${node.id})`;
}

/** AI-backed scene actions for one sketch panel. */
export function sceneAI(deps: StudioDeps, owner: string) {
  const stillHere = stillHereFor(deps);
  const fresh = (document: number, revision: number | undefined) => document === deps.documentId() && revision === deps.artwork(owner)?.revision;
  async function generateCode(repair = false, instructionOverride?: string) {
    const panel = deps.panel(owner);
    if (!panel.scene.nodes.length) { deps.updatePanel(owner, { error: "Extract brush stamps and objects first." }); return; }
    const snapshot = JSON.stringify(panel.scene), document = deps.documentId();
    await deps.task(repair ? "Fixing the runtime error…" : "Translating brush stamps and objects into p5.js code…", async () => {
      // Derived frames are coded against the sketch they were extracted from.
      const context = await sketchContext(deps, panel.sourceFrameId && deps.artwork(panel.sourceFrameId) ? panel.sourceFrameId : owner);
      // A minimal example frame keeps its hint for every generation (also Update and fixes later on).
      const of = panel.exampleOf, example = of && findNode(panel.scene, of.nodeId);
      const hint = !example ? "" : of!.scope ? nodeExampleInstruction(example, of!.scope) : minimalExampleInstruction(example, of!.constraintId);
      const base = [hint, instructionOverride ?? (panel.generationMode === "compose" ? panel.composePrompt : panel.instruction)].filter(Boolean).join("\n");
      const scene = ownCodeIds(panel.scene);
      const result = generatedSchema.parse(await deps.request("code", { scene, image: context.image, compositionPens: context.compositionPens, compositionStrokes: context.compositionStrokes,
        previous: panel.generated ? liveSceneSource(panel.generated, panel.scene) : "", instruction: (repair ? `${base}\nFix this runtime error: ${panel.runtimeError}` : base).slice(0, 6000) }, owner));
      if (document !== deps.documentId() || snapshot !== JSON.stringify(deps.panel(owner).scene)) throw new Error("The brush stamp or param structure changed during generation. Please generate again.");
      deps.updatePanel(owner, { scene, generated: result, codeDraft: result.code, executable: "", preparedCode: "", runtimeError: "", runtimeStates: {}, dirtyNodeIds: [] });
      // Brushes made from this frame keep a copy of their module for when the frame is gone.
      deps.refreshBrushCode?.(owner, result.code);
      if (stillHere(owner)) deps.focus(owner as FrameId);
    }, owner);
  }
  async function draftComposePrompt() {
    const previous = deps.panel(owner).composePrompt, document = deps.documentId(), revision = deps.artwork(owner)?.revision;
    await deps.task(compositionPromptLabel, async () => {
      const number = deps.requestId(owner), context = await sketchContext(deps, owner);
      const result = compositionPromptSchema.parse(await deps.request("compose-prompt", { image: context.image, compositionPens: context.compositionPens, compositionStrokes: context.compositionStrokes, instruction: previous }, owner));
      if (number !== deps.requestId(owner) || document !== deps.documentId()) return;
      if (!fresh(document, revision) || previous !== deps.panel(owner).composePrompt) throw new Error("The sketch or prompt changed. Please create the AI prompt again.");
      deps.updatePanel(owner, { composePrompt: result.prompt, composeTags: result.tags, composeTagsRevision: revision ?? -1 });
      const tagged = `tagged ${result.tags.length} part${result.tags.length === 1 ? "" : "s"} of the sketch (click a tag to see what goes into it)`;
      deps.toast(deps.panel(owner).composeWithText ? `AI wrote the Compose prompt${result.tags.length ? ` and ${tagged}` : ""}. Review or edit the description, then press Compose sketch.`
        : result.tags.length ? `AI ${tagged}. Check the tags, then press Compose sketch.` : "AI found no part of the sketch to tag. Turn the text prompt on to describe it.");
    }, owner);
  }
  /** A new sketch frame holding a scene derived from this one. */
  function derive(scene: Scene, name: string, revision: number, extra: Partial<SketchPanel>, brushes = false, quiet = false) {
    const id = deps.createFrame(owner, name);
    if (!id) { deps.updatePanel(owner, { error: `You can create at most ${MAX_SKETCH_FRAMES} sketch frames.` }); return null; }
    // Collections AI made become reusable brushes in the toolbar.
    if (brushes) scene = markBrushes(scene, deps.addBrushes(id, scene));
    deps.updatePanel(id, panel => ({ ...ops.commitScene(panel, scene), sourceFrameId: owner, analysisRevision: revision, instruction: deps.panel(owner).instruction, pendingResult: true, ...extra }));
    // A frame made by AI work the user has moved away from appears without taking the view.
    if (stillHere(owner) && !quiet) { deps.activate(id); deps.focus(id as FrameId); }
    return id;
  }
  async function renderDerived(id: string, instruction?: string) {
    try { await sceneAI(deps, id).generateCode(false, instruction); }
    finally { deps.updatePanel(id, { pendingResult: false }); }
  }
  /**
   * A new frame beside this one showing the target (one constraint of the node, plus a plain member for a
   * collection; the node's constraints together; or the node with everything below it), linked back to this
   * frame; it is rendered afterwards. Throws when the example cannot be made; null when there is no room for another frame.
   */
  function exampleFrame(target: ExampleTarget, quiet = false, from?: Scene, title?: string) {
    // `from`: the scene the constraint is in (a part of a decomposed constraint is in this frame's scene only as the child's).
    const { nodeId, constraintId, scope } = target;
    const source = from ?? deps.panel(owner).scene, node = findNode(source, nodeId);
    if (!node || (scope === "constraint" && !findConstraint(node, constraintId))) throw new Error("Could not find the Constraint.");
    const scene = sceneSchema.parse(exampleScene(source, target));
    const label = exampleLabel(node, scope, constraintId);
    // An ordinary new sketch frame. Its first code run gets the hint and its own (empty) sketch
    // instead of the original, so only this constraint shows; after that it is edited like any frame.
    const id = derive(scene, title ?? (scope === "node" ? `${label} · part` : `${node.name} · ${label} example`), deps.artwork(owner)?.revision ?? 0,
      { sourceFrameId: null, exampleOf: scope === "constraint" ? { frameId: owner, nodeId, constraintId } : { frameId: owner, nodeId, constraintId: "", scope }, analysisRevision: -1, instruction: "", generationMode: "extract", composePrompt: "", selectedNodeIds: [nodeId] }, false, quiet);
    if (!id) return null;
    // Every example is also a sub brush in the tool group of the brush it came from, so it can be brushed and played with.
    const sub = deps.addSubBrush?.(owner, nodeId, id, scene, `${label} · example`);
    if (sub) deps.updatePanel(id, current => ({ scene: markBrushes(current.scene, [sub]) }));
    return { id, label, sub: Boolean(sub) };
  }
  /**
   * Render an example frame. The server takes only a couple of AI requests at once: a request turned
   * away for that waits and goes again, instead of leaving the frame empty.
   */
  async function renderExample(id: string) {
    for (let attempt = 1; ; attempt++) {
      await renderDerived(id);
      const panel = deps.panel(id);
      if (panel.generated || !deps.artwork(id) || attempt >= exampleRetry.attempts || !BUSY.test(panel.error)) return;
      deps.updatePanel(id, { error: "", pendingResult: true });
      await new Promise(resolve => setTimeout(resolve, exampleRetry.ms * attempt));
    }
  }
  /** Example frames for these targets (linked to this frame), then their code, two at a time. */
  async function makeExamples(targets: (ExampleTarget & { from?: Scene })[], what: string) {
    const made: NonNullable<ReturnType<typeof exampleFrame>>[] = [], failed: string[] = [];
    for (const target of targets) {
      try { const frame = exampleFrame(target, true, target.from); if (!frame) break; made.push(frame); }
      catch { failed.push(target.constraintId); }
    }
    if (!made.length) { if (failed.length) deps.updatePanel(owner, { error: "Could not create the minimal example." }); return; }
    const left = targets.length - made.length - failed.length;
    const subs = made.filter(frame => frame.sub).length;
    deps.toast([`Decomposed into ${made.length} ${what} frame(s)${subs ? ` (${subs} added as sub brushes to the original brush's tool group)` : ""}. Generating the results…`,
      left ? `${left} could not be created because the frames are full (max ${MAX_SKETCH_FRAMES}).` : "", failed.length ? `${failed.length} could not be made into examples.` : ""].filter(Boolean).join(" "));
    // Two at a time (what the server takes at once): each frame's code is its own AI request.
    const queue = [...made];
    await Promise.all(Array.from({ length: Math.min(2, queue.length) }, async () => { for (let next = queue.shift(); next; next = queue.shift()) await renderExample(next.id); }));
  }
  /**
   * Decompose a minimal example again: AI divides its constraint into the meaningful computations its code runs
   * (their hard-coded constants become params). This frame is left as it is; each part gets a child example frame
   * of its own, linked to this one, where only that part is shown and adjusted.
   */
  async function splitExample(nodeId: string, constraintId: string) {
    const out: { parts?: Constraint[]; reason?: string; scene?: Scene } = {};
    await deps.task("AI is dividing this constraint into the computations inside it…", async () => {
      const panel = deps.panel(owner);
      const result = splitResultSchema.parse(await deps.request("split", { scene: panel.scene, targetNodeId: nodeId, targetConstraintId: constraintId,
        previous: panel.generated ? liveSceneSource(panel.generated, panel.scene) : "", instruction: "" }, owner));
      Object.assign(out, { parts: result.divisible ? result.parts : [], reason: result.reason, scene: panel.scene });
    }, owner);
    if (!out.scene) return;
    if (!out.parts?.length) { deps.toast(`Cannot be divided further: ${out.reason}`); return; }
    // Each part as the node's only constraint, in a copy of this frame's scene (the frame itself keeps its own).
    const withPart = (part: Constraint): Scene => ({ nodes: out.scene!.nodes.map(node => node.id === nodeId ? { ...node, constraints: [part] } : node) });
    await makeExamples(out.parts.map(part => ({ nodeId, constraintId: part.id, scope: "constraint" as const, from: withPart(part) })), "inner computation");
  }
  /** Regenerate one param/constraint (or add one); returns what changed, or null. */
  async function regenerateOne(nodeId: string, target: { constraintId?: string; paramId?: string }, instruction?: string, marks: Marks = []) {
    const panel = deps.panel(owner), snapshot = JSON.stringify(panel.scene);
    const done: { changed?: { scene: Scene; label: string } } = {};
    const message = target.paramId ? "Regenerating only this param's implementation…" : target.constraintId ? "Regenerating this constraint…" : "Creating a new constraint…";
    await deps.task(message, async () => {
      const scene = sceneSchema.parse(await deps.request("transform", { scene: panel.scene, targetNodeId: nodeId, targetConstraintId: target.constraintId || "", targetParamId: target.paramId || "",
        alternative: Boolean(target.constraintId && !target.paramId), instruction: instruction?.trim() || panel.instruction, transformMarks: compactMarks(marks),
        image: await annotatedImage((await deps.capture(owner, true)).image, marks) }, owner));
      if (snapshot !== JSON.stringify(deps.panel(owner).scene)) throw new Error("The scene changed during generation. Please try again.");
      deps.updatePanel(owner, current => ({ ...ops.commitScene(current, scene, [nodeId]), transformDraft: null }));
      done.changed = { scene: deps.panel(owner).scene, label: describeTarget(scene, nodeId, target) };
    }, owner);
    return done.changed ?? null;
  }
  /** The running code still does the old thing: rewrite it from the new descriptions right away (unless the scene moved on). */
  async function rewriteCode(labels: string[], scene: Scene) {
    if (!labels.length || !deps.panel(owner).generated || JSON.stringify(deps.panel(owner).scene) !== JSON.stringify(scene)) return;
    const panelNow = deps.panel(owner), base = panelNow.generationMode === "compose" ? panelNow.composePrompt : panelNow.instruction;
    const what = labels.length === 1 ? `${labels[0]} was just regenerated: implement its NEW description and params` : `${labels.join("; ")} were just regenerated together: implement their NEW descriptions and params`;
    await generateCode(false, `${base}\n${what} exactly, replacing the old behavior in the previous code (do not keep the old logic).`);
  }

  /** Begin clarifying the sketch before Extract / Compose: the first stage of questions. */
  async function startClarify(mode: ClarifyMode) {
    const open: SketchClarifyState = { mode, stages: [], reason: "" };
    deps.updatePanel(owner, { sketchClarify: open, error: "" });
    await askClarify(open);
  }
  /** One more stage: the AI asks what is still ambiguous given the answers so far, or finds it clear enough (then it runs). */
  async function askClarify(open: SketchClarifyState, askAnyway = false) {
    const document = deps.documentId(), out: { done?: string; again?: boolean } = {};
    await deps.task(sketchClarifyLabel, async () => {
      const number = deps.requestId(owner), panel = deps.panel(owner);
      const context = await sketchContext(deps, owner);
      const instruction = open.mode === "extract" ? panel.instruction : panel.composeWithText ? panel.composePrompt.trim() : "";
      const result = settleSketchClarify(aiSketchClarifySchema.parse(await deps.request("sketch-clarify", { image: context.image, compositionPens: context.compositionPens, compositionStrokes: context.compositionStrokes,
        instruction, composeTags: open.mode === "compose" ? panel.composeTags : [], sketchClarify: { mode: open.mode, askAnyway, stages: answeredStages(open.stages) } }, owner)), open.stages.length);
      if (number !== deps.requestId(owner) || document !== deps.documentId() || deps.panel(owner).sketchClarify?.mode !== open.mode) return;
      // At least one stage is asked: found clear from the start, it is asked once more for what is most uncertain.
      if (result.done && !open.stages.length && !askAnyway) { out.again = true; return; }
      // Still clear: the panel says why, and the user runs it.
      if (result.done && !open.stages.length) { deps.updatePanel(owner, { sketchClarify: { ...open, clear: result.reason || "Nothing critical is ambiguous." } }); return; }
      if (result.done) { out.done = result.reason; return; }
      deps.updatePanel(owner, { sketchClarify: { ...open, clear: undefined, reason: result.reason, picture: context.image, strokes: context.compositionStrokes, stages: [...open.stages, { questions: result.questions, answers: startingAnswers(result.questions) }] } });
    }, owner);
    if (out.again) { await askClarify(open, true); return; }
    if (out.done === undefined) return;
    deps.toast(open.stages.length ? `Clear enough now${out.done ? `: ${out.done}` : ""}` : `Nothing critical is ambiguous${out.done ? `: ${out.done}` : ""}`);
    await proceed(open);
  }
  /** Close the clarification and Extract / Compose with its answers. */
  async function proceed(open: SketchClarifyState) {
    deps.updatePanel(owner, { sketchClarify: null });
    const text = clarifiedText(open.stages);
    if (open.mode === "extract") await actions.extract(text); else await actions.compose(false, text);
  }

  const actions = {
    generateCode,
    draftComposePrompt,
    /** One constraint of a Compose tag changed by AI as the user asks (the card shows the result). */
    async reviseComposeTag(tagId: string, index: number, request: string) {
      const tags = deps.panel(owner).composeTags, document = deps.documentId();
      await deps.task(tagRevisionLabel, async () => {
        const context = await sketchContext(deps, owner);
        const result = tagRevisionSchema.parse(await deps.request("tag-revise", { image: context.image, compositionPens: context.compositionPens, compositionStrokes: context.compositionStrokes, composeTags: tags, tagTarget: { tagId, index }, instruction: request.slice(0, 2000) }, owner));
        if (document !== deps.documentId()) return;
        deps.updatePanel(owner, current => ({ composeTags: reviseTag(current.composeTags, result) }));
        deps.toast(result.note || `Changed “${result.constraint.label}”.`);
      }, owner);
    },
    /**
     * Extract from this sketch into a NEW sketch frame beside it, then render that frame's result.
     * `clarified`: what the user answered when asked first (unset: ask first when that is on).
     */
    async extract(clarified?: string) {
      if (clarified === undefined && deps.clarifyFirst?.()) { await startClarify("extract"); return; }
      const document = deps.documentId(), revision = deps.artwork(owner)?.revision, name = deps.artwork(owner)?.name || "Sketch";
      const instruction = [deps.panel(owner).instruction, clarified].filter(Boolean).join("\n\n");
      const out: { frame?: string } = {};
      await deps.task("Extracting brush stamps and objects from the sketch…", async () => {
        const capture = await deps.capture(owner), context = compositionContext(deps.artwork(owner)!);
        const scene = sceneSchema.parse(await deps.request("extract", { image: capture.image, recoveryRegion: capture.region, compositionPens: context.compositionPens, compositionStrokes: context.compositionStrokes, instruction: instruction.slice(0, 6000) }, owner));
        if (!fresh(document, revision)) throw new Error("The sketch changed during extraction. Please extract again.");
        const r = capture.region;
        const mapped = { ...scene, nodes: scene.nodes.map(node => ({ ...node, region: { x: r.x + node.region.x * r.w, y: r.y + node.region.y * r.h, w: Math.max(.01, node.region.w * r.w), h: Math.max(.01, node.region.h * r.h) } })) };
        out.frame = derive(mapped, `${name} · extracted`, revision!, clarified ? { instruction: instruction.slice(0, 2000) } : {}, true) || undefined;
        deps.toast(`Extracted ${scene.nodes.filter(node => node.kind === "collection").length} brush stamp(s) and ${scene.nodes.filter(node => node.kind === "object").length} object(s) into a new frame.`);
      }, owner);
      if (out.frame) await renderDerived(out.frame);
    },
    /** AI makes a direct manipulation interface for one param, a constraint's params, or every param of the node; they run in its proxy frame. */
    async suggestHandles(nodeId: string, target: HandleTarget, instruction = "") {
      const out: { count?: number; skipped?: number } = {};
      await deps.task(target.paramId ? "AI is creating a direct manipulation interface for this param…" : "AI is creating a direct manipulation interface for each param…", async () => {
        const result = handleSuggestionsSchema.parse(await deps.request("handles", { scene: deps.panel(owner).scene, targetNodeId: nodeId, targetConstraintId: target.constraintId || "", targetParamId: target.paramId || "",
          instruction: instruction.trim(), image: (await deps.capture(owner, true)).image }, owner));
        // Handles are UI: they go onto the scene as it is now, even if it changed meanwhile.
        deps.updatePanel(owner, current => findNode(current.scene, nodeId) ? ops.commitScene(current, applyHandles(current.scene, nodeId, result.handles)) : {});
        out.count = result.handles.length; out.skipped = result.skipped.length;
      }, owner);
      if (!out.count) return;
      deps.openProxy?.(owner, nodeId);
      deps.toast(`Created ${out.count} direct manipulation handle(s)${out.skipped ? ` (${out.skipped} left out due to code errors)` : ""}. Manipulating them in the proxy frame changes the result immediately.`);
    },
    /**
     * Handles for every constraint (as in the base state) of these nodes — every node of the frame but a
     * backdrop by default — that has a param without one: one request per constraint, two at a time, each
     * put on the scene as it arrives; then each node's proxy frame opens. One that fails does not stop the others.
     */
    async suggestAllHandles(nodeIds?: string[], redesign = false, options: { instruction?: string; width?: number } = {}) {
      const panel = deps.panel(owner), chosen = panel.scene.nodes.filter(node => nodeIds ? nodeIds.includes(node.id) : node.parentId || !isBackdrop(node));
      // Redesign: every constraint that has a handle now, made again (the AI sees each current widget); undo takes each back.
      const targets = chosen.flatMap(node => handleConstraints(node).filter(item => redesign ? item.params.some(param => param.handle)
        : item.params.some(param => handleLeaves(param).length > 0 && !param.handle))
        .map(item => ({ nodeId: node.id, constraintId: item.id, label: item.property })));
      // Every node that has handles (or gets them) shows its proxy frames, one per constraint, in its group.
      const openAll = () => { for (const node of chosen) { const now = findNode(deps.panel(owner).scene, node.id); if (now && proxyGroups(now.constraints).length) deps.openProxy?.(owner, node.id); } };
      if (!targets.length && redesign) { deps.toast("There is no handle to redesign yet. Make them with Handles for all."); return; }
      if (!targets.length) {
        openAll();
        const shown = chosen.filter(node => proxyGroups(node.constraints).length).length;
        deps.toast(shown ? `Every constraint already has its handles: opened the proxy frames of ${shown} node(s), one per constraint, grouped by node. To make one again, use Redesign on it.` : "There is no param a direct manipulation handle can control.");
        return;
      }
      const nodes = new Set<string>(), failed: string[] = [];
      let count = 0, skipped = 0, done = 0;
      const label = (n: number) => `AI is ${redesign ? "redesigning" : "creating"} direct manipulation handles for each constraint (${n}/${targets.length})…`;
      await deps.task(label(0), async () => {
        const image = (await deps.capture(owner, true)).image, queue = [...targets];
        // Cancelling the frame's work ends the task: what is still running is dropped.
        const live = () => Boolean(deps.panel(owner).loading);
        await Promise.all(Array.from({ length: Math.min(options.width ?? 2, queue.length) }, async () => {
          for (let next = queue.shift(); next && live(); next = queue.shift()) {
            try {
              const target = next;
              const result = handleSuggestionsSchema.parse(await patient(() => deps.request("handles", { scene: deps.panel(owner).scene, targetNodeId: target.nodeId, targetConstraintId: target.constraintId, targetParamId: "", instruction: options.instruction ?? "", image }, owner)));
              if (!live()) return;
              deps.updatePanel(owner, current => findNode(current.scene, target.nodeId) ? ops.commitScene(current, applyHandles(current.scene, target.nodeId, result.handles)) : {});
              if (result.handles.length) nodes.add(next.nodeId);
              count += result.handles.length; skipped += result.skipped.length;
            } catch (error) { if (error instanceof DOMException && error.name === "AbortError") return; failed.push(next.label); }
            if (live()) deps.updatePanel(owner, { loading: label(++done) });
          }
        }));
      }, owner);
      if (nodes.size) openAll();
      if (count || failed.length) deps.toast([count ? `${redesign ? "Redesigned" : "Created"} ${count} direct manipulation handle(s) for ${targets.length - failed.length} constraint(s), each constraint in its own proxy frame, grouped by node.` : "",
        skipped ? `${skipped} left out due to code errors.` : "", failed.length ? `Could not make: ${failed.join(", ")}.` : ""].filter(Boolean).join(" "));
    },
    /**
     * A mini sandbox for an inspection concern: AI finds the one part of the brush it is about (a node, its own
     * constraints, one constraint, or one computation inside a constraint); that part alone becomes a part frame
     * (as decompose makes, linked to this frame), and then gets direct manipulation handles for its params.
     */
    async concernSandbox(concern: string, image: string, marks: { x: number; y: number }[][] = []) {
      const panel = deps.panel(owner), generated = panel.generated;
      if (!generated) { deps.updatePanel(owner, { error: "Generate this frame's result first." }); return; }
      const out: { part?: SandboxPart; scene?: Scene } = {};
      await deps.task("AI is finding the part of the brush this is about, for a mini sandbox…", async () => {
        const nodeIds = panel.scene.nodes.map(node => node.id).slice(0, 64);
        out.part = sandboxSchema.parse(await patient(() => deps.request("trace-part", { scene: panel.scene, previous: liveSceneSource(generated, panel.scene), image,
          trace: { concern, nodeIds, cycles: 0, sites: [], marks } }, owner)));
        out.scene = panel.scene;
      }, owner);
      if (!out.part || !out.scene) return;
      const target = sandboxTarget(out.scene, out.part);
      let made: ReturnType<typeof exampleFrame>;
      try { made = exampleFrame(target, true, target.from, `${findNode(target.from ?? out.scene, target.nodeId)?.name ?? "Part"} · sandbox`); }
      catch (error) { deps.updatePanel(owner, { error: error instanceof Error ? error.message : "Could not make the sandbox." }); return; }
      if (!made) return;
      // What it is for stays with its code (every generation of it, also Update and fixes later on).
      deps.updatePanel(made.id, { instruction: sandboxInstruction(concern), sandboxLogic: { ...out.part.logic, concern } });
      deps.toast(`Made a mini sandbox frame of “${made.label}” beside this one: ${out.part.reason} Generating it, then its handles…`);
      await renderExample(made.id);
      const frame = deps.panel(made.id);
      if (!deps.artwork(made.id) || !frame.generated || !frame.exampleOf) return;
      // One handle request at a time: the inspection goes on beside it (the server takes two at once).
      await sceneAI(deps, made.id).suggestAllHandles(partNodes(frame.scene, frame.exampleOf).map(node => node.id), false, { instruction: sandboxHandleInstruction(concern), width: 1 });
    },
    async minimalExample(nodeId: string, constraintId: string) {
      let made: ReturnType<typeof exampleFrame>;
      try { made = exampleFrame({ nodeId, constraintId, scope: "constraint" }); }
      catch (error) { deps.updatePanel(owner, { error: error instanceof Error ? error.message : "Could not create the minimal example." }); return; }
      if (!made) return;
      deps.toast(`Created a minimal example frame with only “${made.label}”${made.sub ? " (added as a sub brush to the original brush's tool group)" : ""}. Generating the result…`);
      await renderExample(made.id);
    },
    /**
     * Decompose one level (base state, state machines left out), each part a frame linked to this one:
     * a frame into its nodes (its single brush straight into the next level), a node into its own
     * constraints as one group and each child node whole, a group or a leaf object into its single
     * constraints, and a single constraint into the computations inside it. Decompose a part to go further.
     */
    async decompose() {
      const panel = deps.panel(owner), of = panel.exampleOf;
      // A still background filling the canvas is no brush and not part of one: nothing to try out on its own.
      const keep = (node: SceneNode) => Boolean(node.parentId) || !isBackdrop(node);
      const tunable = panel.scene.nodes.filter(keep).flatMap(node => node.constraints.filter(item => item.params.length).map(item => ({ nodeId: node.id, constraintId: item.id })));
      if (!tunable.length) { deps.updatePanel(owner, { error: "There is no constraint to decompose." }); return; }
      // A frame that shows one constraint on its own: decomposing it again divides that constraint into the computations inside it.
      if (of && (!of.scope || tunable.length === 1)) { const only = tunable.find(item => item.constraintId === of.constraintId) ?? tunable[0]; await splitExample(only.nodeId, only.constraintId); return; }
      const targets = decomposeTargets(panel.scene, of && { nodeId: of.nodeId, scope: of.scope, constraintId: of.constraintId }, keep);
      if (!targets.length) { deps.updatePanel(owner, { error: "There is nothing below this to decompose." }); return; }
      const kinds = new Set(targets.map(target => target.scope));
      await makeExamples(targets.map(target => ({ ...target, from: undefined })), kinds.size > 1 ? "part" : kinds.has("constraint") ? "constraint" : kinds.has("node") ? "node" : "constraint group");
    },
    /** AI on the constraint stack: one param, one constraint, or (neither) a new stacked constraint. Then the code follows. */
    async regenerate(nodeId: string, target: { constraintId?: string; paramId?: string } = {}, instruction?: string, marks: Marks = []) {
      const done = await regenerateOne(nodeId, target, instruction, marks);
      if (done) await rewriteCode([done.label], done.scene);
    },
    /**
     * One fix that changes several constraints of a node: each is regenerated
     * in turn (told which others change with it), then the code is rewritten once.
     */
    async regenerateAll(nodeId: string, constraintIds: string[], instruction: string) {
      const labels: string[] = [];
      let last: Scene | null = null;
      for (const [i, id] of constraintIds.entries()) {
        const together = constraintIds.length > 1 ? `\n\nThis fix changes ${constraintIds.length} constraints of this node together (${constraintIds.join(", ")}). This is ${i + 1}/${constraintIds.length}: regenerate only "${id}", doing its own part of the fix so that it works with the others.` : "";
        const done = await regenerateOne(nodeId, { constraintId: id }, `${instruction}${together}`.slice(0, 4000));
        if (!done) break;
        labels.push(done.label); last = done.scene;
      }
      if (last) await rewriteCode(labels, last);
      return labels.length;
    },
    async generateMachine(nodeId: string) {
      const panel = deps.panel(owner), snapshot = JSON.stringify(panel.scene);
      await deps.task("AI is planning the states and transitions of this node…", async () => {
        const context = await sketchContext(deps, owner);
        const scene = sceneSchema.parse(await deps.request("state-machine", { scene: panel.scene, targetNodeId: nodeId, image: context.image, compositionPens: context.compositionPens, compositionStrokes: context.compositionStrokes,
          instruction: panel.generationMode === "compose" ? panel.composePrompt || panel.instruction : panel.instruction, previous: panel.generated ? liveSceneSource(panel.generated, panel.scene) : "" }, owner));
        if (snapshot !== JSON.stringify(deps.panel(owner).scene)) throw new Error("The scene changed during generation. Please try again.");
        const machine = findNode(scene, nodeId)?.machine;
        deps.updatePanel(owner, current => ({ ...ops.commitScene(current, scene, [nodeId]), selectedNodeIds: [nodeId], ...(machine ? ops.chooseState({ ...current, scene }, nodeId, machine.initialState) : {}) }));
        deps.toast("Created the state machine. Press Generate code to connect it to the code.");
      }, owner);
    },
    /**
     * Refine the node's machine as the user wrote/drew, focused on the attached
     * state or transition; the frame's Compose prompt is rewritten to match.
     * With `code`, the running code is rewritten to it right away (as a fix is), else the user presses Update.
     */
    async refineMachine(nodeId: string, request: { target: MachineTarget | null; instruction: string; image?: string; marks: MachineMark[]; code?: boolean }) {
      const panel = deps.panel(owner), snapshot = JSON.stringify(panel.scene);
      const sourceId = panel.sourceFrameId && deps.artwork(panel.sourceFrameId) ? panel.sourceFrameId : null;
      const prompt = panel.composePrompt.trim() || (sourceId ? deps.panel(sourceId).composePrompt.trim() : "");
      const label = request.target ? `AI is refining the attached ${request.target.kind === "state" ? "state" : "transition"}…` : "AI is refining the state machine…";
      const done: { changed?: { scene: Scene; label: string } } = {};
      await deps.task(label, async () => {
        const context = await sketchContext(deps, owner);
        const result = machineRefineResultSchema.parse(await deps.request("machine-refine", { scene: panel.scene, targetNodeId: nodeId, machineTarget: request.target, instruction: request.instruction,
          machineImage: request.image, machineMarks: request.marks, composePrompt: prompt, image: context.image, compositionPens: context.compositionPens, compositionStrokes: context.compositionStrokes,
          previous: panel.generated ? liveSceneSource(panel.generated, panel.scene) : "" }, owner));
        if (snapshot !== JSON.stringify(deps.panel(owner).scene)) throw new Error("The scene changed during generation. Please try again.");
        const machine = findNode(result.scene, nodeId)?.machine;
        deps.updatePanel(owner, current => {
          const kept = (id: string | null | undefined) => id && machine?.states.some(state => state.id === id) ? id : null;
          const target = current.machineTarget && machine && (current.machineTarget.kind === "state" ? machine.states : machine.transitions).some(item => item.id === current.machineTarget!.id) ? current.machineTarget : null;
          const stateId = kept(request.target?.kind === "state" ? request.target.id : null) || kept(current.editingStates[nodeId]) || machine?.initialState;
          return { ...ops.commitScene(current, result.scene, [nodeId]), selectedNodeIds: [nodeId], composePrompt: result.composePrompt, machineTarget: target, machineDraft: emptyMachineDraft(nodeId),
            ...(stateId ? ops.chooseState({ ...current, scene: result.scene }, nodeId, stateId) : {}) };
        });
        // The sketch this frame was composed from keeps the same prompt, so it follows too.
        if (sourceId && prompt && deps.panel(sourceId).composePrompt.trim() === prompt) deps.updatePanel(sourceId, { composePrompt: result.composePrompt });
        const part = request.target && (request.target.kind === "state" ? machine?.states : machine?.transitions)?.find(item => item.id === request.target!.id);
        done.changed = { scene: deps.panel(owner).scene, label: `The ${request.target?.kind ?? "state machine"}${part ? ` "${(part as { label?: string }).label || part.id}" (${part.id})` : ""} of ${findNode(result.scene, nodeId)?.name ?? nodeId}'s state machine` };
        if (!request.code) deps.toast("Refined the state machine and updated the Compose prompt too. Press Update to connect it to the code.");
      }, owner);
      if (request.code && done.changed) await rewriteCode([done.changed.label], done.changed.scene);
    },
    /** `clarified`: what the user answered when asked first (unset: ask first when that is on). */
    async compose(repair = false, clarified?: string) {
      // Without the text prompt, Compose reads the tags on the sketch alone; with it, the tags go along.
      // The tags go as they are now, edited by hand or not and even when the sketch changed since: only a frame with
      // nothing to compose from yet is read first, and reading the sketch again is the user's Regenerate.
      const panel = deps.panel(owner), text = panel.composeWithText, prompt = text ? panel.composePrompt.trim() : "", tags = panel.composeTags;
      if (repair) { await generateCode(true, prompt); return; }
      if (text ? !prompt : !tags.length) { await draftComposePrompt(); return; }
      if (clarified === undefined && deps.clarifyFirst?.()) { await startClarify("compose"); return; }
      const instruction = [prompt, clarified].filter(Boolean).join("\n\n");
      const document = deps.documentId(), revision = deps.artwork(owner)?.revision;
      const out: { frame?: string } = {};
      await deps.task("Composing the pen marks and sketch into brush stamps…", async () => {
        const context = await sketchContext(deps, owner);
        // Marks erased since the tags were made are no longer there to point at.
        const drawn = new Set(context.compositionStrokes.map(stroke => stroke.id));
        const composeTags = tags.map(tag => ({ ...tag, strokeIds: tag.strokeIds.filter(id => drawn.has(id)) }));
        const scene = sceneSchema.parse(await deps.request("compose", { image: context.image, compositionPens: context.compositionPens, compositionStrokes: context.compositionStrokes, instruction: instruction.slice(0, 6000), composeTags }, owner));
        const now = deps.panel(owner);
        if (!fresh(document, revision) || (text && prompt !== now.composePrompt.trim()) || (tags.length > 0 && tags !== now.composeTags)) throw new Error("The sketch, prompt or tags changed. Please Compose again.");
        out.frame = derive(scene, `${context.artwork.name} · composed`, revision!, { generationMode: "compose", composePrompt: instruction.slice(0, 2000), composeWithText: text }, true) || undefined;
      }, owner);
      if (out.frame) await renderDerived(out.frame, instruction);
    },
    /** Answer a question of the open clarification's current stage. */
    answerClarify(questionId: string, answer: ClarifyAnswer) {
      deps.updatePanel(owner, panel => {
        const open = panel.sketchClarify, stage = open?.stages.at(-1);
        if (!open || !stage) return {};
        return { sketchClarify: { ...open, stages: [...open.stages.slice(0, -1), { ...stage, answers: { ...stage.answers, [questionId]: answer } }] } };
      });
    },
    /** The next stage (after the last one: Extract / Compose with the answers). */
    async continueClarify() {
      const open = deps.panel(owner).sketchClarify;
      if (!open) return;
      if (open.stages.length >= MAX_CLARIFY_STAGES) { await actions.finishClarify(); return; }
      await askClarify(open);
    },
    /** Stop asking: Extract / Compose with what was answered so far. */
    async finishClarify() {
      const open = deps.panel(owner).sketchClarify;
      if (!open) return;
      await proceed(open);
    },
    /** The AI found it clear, but the user wants to be asked: questions about what is most uncertain. */
    async askAnyway() {
      const open = deps.panel(owner).sketchClarify;
      if (open) await askClarify({ ...open, clear: undefined }, true);
    },
    cancelClarify() { deps.updatePanel(owner, { sketchClarify: null }); },
  };
  return actions;
}
