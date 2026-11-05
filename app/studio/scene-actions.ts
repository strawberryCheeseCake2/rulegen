import { reviseTag, tagRevisionSchema } from "../lib/compose-tags";
import { compositionPromptSchema, generatedSchema, machineRefineResultSchema, splitResultSchema, type MachineMark, type MachineTarget } from "../lib/schema";
import { annotatedImage, compactMarks, type Marks } from "./annotated-image";
import { compositionContext } from "../lib/algorithm-pens";
import { emptyMachineDraft, type SketchPanel } from "../lib/sketch-panels";
import { isBackdrop, markBrushes } from "../lib/brushes";
import type { AlgorithmCall, Algorithm, PropertyHandle, Scene, ScalarValue, SceneNode, SemanticTransformation } from "../lib/scene/schema";
import { MAX_NESTING_DEPTH } from "../lib/scene/schema";
import { sceneSchema } from "../lib/scene/validate";
import { findNode, groupNodes, moveNodes, removeNodes, reorderNode, sceneDepth, selectionRoots, setParent, ungroupNode, uniqueNodeId } from "../lib/scene/graph";
import * as ops from "../lib/scene/panel-ops";
import { importAlgorithmCall, makeAlgorithmPen } from "../lib/scene/pens";
import { addBlockProperty, copyAlgorithm, moveNodeTo, pasteAlgorithm, pasteTransformation, transplantNodes, type AlgorithmClip, type TransformationClip } from "../lib/scene/transfer";
import { instantiate } from "../lib/scene/algorithms";
import { isAlgorithm, valueAt } from "../lib/scene/values";
import { liveSceneSource } from "../lib/scene/live";
import { hasModules, ownCodeIds, programModules } from "../lib/scene/machines";
import { stampModule } from "../lib/scene/stamp";
import { minimalExampleInstruction, minimalExampleScene } from "../lib/scene/minimal-example";
import { findTransformation } from "../lib/scene/transformations";
import { applyHandles, handleLeaves, handleSuggestionsSchema, handleTransformations, proxyGroups, setHandle, type HandleTarget } from "../lib/scene/handles";
import { MAX_SKETCH_FRAMES, type FrameId } from "../lib/workspace";
import type { StudioDeps } from "./deps";

export const tagRevisionLabel = "AI is changing the tag's transformation…";
export const compositionPromptLabel = "AI is reading the sketch and pen meanings to write the Compose prompt…";

/** How example frames wait when the server is busy with other AI requests (tests shorten it). */
export const exampleRetry = { ms: 2500, attempts: 6 };
const BUSY = /request is in progress/i;

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
        region: parent ? parent.region : { x: .4, y: .4, w: .2, h: .2 }, transformations: [], visible: true, machine: null };
      return panel.scene.nodes.length >= 48 ? {} : { ...ops.commitScene(panel, { ...panel.scene, nodes: [...panel.scene.nodes, node] }, [id]), selectedNodeIds: [id] };
    }),
    undo: () => apply(ops.undoScene),
    redo: () => apply(ops.redoScene),
    scalar: (nodeId: string, propertyId: string, path: string[], raw: ScalarValue["value"]) => apply(panel => ops.setPropertyScalar(panel, nodeId, propertyId, path, raw)),
    /** Instantiating can fail (nesting limit), so it runs before the state update. */
    swap: (nodeId: string, propertyId: string, path: string[], choice: ops.SlotChoice) => {
      try { const patch = ops.swapSlot(deps.panel(owner), nodeId, propertyId, path, choice); deps.updatePanel(owner, patch); }
      catch (error) { deps.updatePanel(owner, { error: (error as Error).message }); }
    },
    editNode: (nodeId: string, patch: Parameters<typeof ops.editNode>[2]) => apply(panel => ops.editNode(panel, nodeId, patch)),
    editProperty: (nodeId: string, propertyId: string, patch: Parameters<typeof ops.editProperty>[3]) => apply(panel => ops.editProperty(panel, nodeId, propertyId, patch)),
    removeProperty: (nodeId: string, propertyId: string) => apply(panel => ops.removeProperty(panel, nodeId, propertyId)),
    /** A property's handle changed (its hint) or removed (null). UI only: the code needs nothing new. */
    handle: (nodeId: string, propertyId: string, handle: PropertyHandle | null) => apply(panel => ops.commitScene(panel, setHandle(panel.scene, nodeId, propertyId, handle))),
    addProperty: (nodeId: string, algorithmId: string, transformationId?: string | null) => {
      try { deps.updatePanel(owner, ops.addAlgorithmProperty(deps.panel(owner), nodeId, algorithmId, transformationId)); }
      catch (error) { deps.updatePanel(owner, { error: (error as Error).message }); }
    },
    addTransformation: (nodeId: string) => apply(panel => ops.addTransformation(panel, nodeId)),
    editTransformation: (nodeId: string, transformationId: string, patch: Parameters<typeof ops.editTransformation>[3]) => apply(panel => ops.editTransformation(panel, nodeId, transformationId, patch)),
    removeTransformation: (nodeId: string, transformationId: string) => apply(panel => ops.removeTransformation(panel, nodeId, transformationId)),
    moveTransformation: (nodeId: string, transformationId: string, offset: number) => apply(panel => ops.moveTransformation(panel, nodeId, transformationId, offset)),
    relocateTransformation: (fromNodeId: string, transformationId: string, toNodeId: string, beforeId: string | null) => apply(panel => ops.relocateTransformation(panel, fromNodeId, transformationId, toNodeId, beforeId)),
    /** A copied transformation (from this sketch or another) pasted into a node, after `afterId` (none: at its end). */
    pasteTransformation: (nodeId: string, clip: TransformationClip, afterId?: string | null) => apply(panel => {
      try { return ops.commitScene(panel, pasteTransformation(panel.scene, nodeId, clip, afterId), [nodeId]); }
      catch (error) { return { error: (error as Error).message }; }
    }),
    editAlgorithm: (algorithmId: string, patch: { name?: string; description?: string }) => apply(panel => ops.editAlgorithm(panel, algorithmId, patch)),
    importAlgorithm: (source: { call: AlgorithmCall; library: Algorithm[] }) => apply(panel => {
      const { scene } = importAlgorithmCall(panel.scene, source);
      return scene.algorithms.length > 96 ? { error: "The algorithm library is full." } : ops.commitScene(panel, scene);
    }),
    chooseState: (nodeId: string, stateId: string | null) => { deps.updatePanel(owner, panel => ops.chooseState(panel, nodeId, stateId)); deps.focus(owner as FrameId); },
    editState: (nodeId: string, stateId: string, patch: Parameters<typeof ops.editMachineState>[3]) => apply(panel => ops.editMachineState(panel, nodeId, stateId, patch)),
    editTransition: (nodeId: string, transitionId: string, patch: Parameters<typeof ops.editTransition>[3]) => apply(panel => ops.editTransition(panel, nodeId, transitionId, patch)),
    removeMachine: (nodeId: string) => apply(panel => ops.removeMachine(panel, nodeId)),
    /** Copy the algorithm plugged into a slot (with its arguments and dependencies). */
    copySlot: (nodeId: string, propertyId: string, path: string[]) => {
      const panel = deps.panel(owner), node = findNode(panel.scene, nodeId);
      const value = node && valueAt(ops.inspectedProperties(panel, node).find(p => p.id === propertyId)?.value ?? { type: "toggle", value: false }, path);
      if (!value || !isAlgorithm(value)) return;
      const clip = copyAlgorithm(panel.scene, value); deps.setClip(clip); deps.toast(`Copied ${clip.label}. Right-click another property to paste it.`);
    },
    copyDefinition: (algorithmId: string) => {
      const scene = deps.panel(owner).scene, clip = copyAlgorithm(scene, instantiate(scene.algorithms, algorithmId));
      deps.setClip(clip); deps.toast(`Copied ${clip.label}. Right-click another property to paste it.`);
    },
    /** Paste replaces the slot's value in the base property; a state cannot change structure. */
    pasteSlot: (nodeId: string, propertyId: string, path: string[], dropped?: AlgorithmClip) => {
      const panel = deps.panel(owner), clip = dropped || deps.clip();
      if (!clip) return;
      if (panel.editingStates[nodeId]) { deps.updatePanel(owner, { error: "Algorithm blocks can only be inserted in Base. In a state, you can only change values." }); return; }
      try { deps.updatePanel(owner, ops.commitScene(panel, pasteAlgorithm(panel.scene, nodeId, propertyId, path, clip), [nodeId])); }
      catch (error) { deps.updatePanel(owner, { error: (error as Error).message }); }
    },
    /** The block plugged at a slot, ready to be dragged elsewhere. */
    clipFor: (nodeId: string, propertyId: string, path: string[]): AlgorithmClip | null => {
      const panel = deps.panel(owner), node = findNode(panel.scene, nodeId);
      const value = node && valueAt(ops.inspectedProperties(panel, node).find(p => p.id === propertyId)?.value ?? { type: "toggle", value: false }, path);
      return value && isAlgorithm(value) ? copyAlgorithm(panel.scene, value) : null;
    },
    definitionClip: (algorithmId: string): AlgorithmClip => { const scene = deps.panel(owner).scene; return copyAlgorithm(scene, instantiate(scene.algorithms, algorithmId)); },
    addBlock: (nodeId: string, clip: AlgorithmClip, transformationId?: string | null) => {
      const panel = deps.panel(owner);
      try { deps.updatePanel(owner, ops.commitScene(panel, addBlockProperty(panel.scene, nodeId, clip, transformationId), [nodeId])); }
      catch (error) { deps.updatePanel(owner, { error: (error as Error).message }); }
    },
    makePen: (source: { nodeId: string; propertyId: string; path?: string[] } | { algorithmId: string }) => {
      try { const scene = deps.panel(owner).scene; deps.addPen((id, color) => makeAlgorithmPen(scene, source, owner, id, color)); }
      catch (error) { deps.updatePanel(owner, { error: (error as Error).message }); }
    },
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

/** How a regenerated part is named to the code step: the transformation (or property) and its node. */
function describeTarget(scene: Scene, nodeId: string, target: { transformationId?: string; propertyId?: string }) {
  const node = findNode(scene, nodeId);
  if (!node) return "A semantic transformation";
  const owner = target.propertyId ? node.transformations.find(item => item.properties.some(property => property.id === target.propertyId))
    : target.transformationId ? node.transformations.find(item => item.id === target.transformationId) : node.transformations.at(-1);
  const property = target.propertyId ? owner?.properties.find(item => item.id === target.propertyId) : undefined;
  return `${property ? `Property "${property.label}" (${property.id}) of ` : ""}semantic transformation "${owner?.label ?? ""}" (${owner?.id ?? ""}) of node "${node.name}" (${node.id})`;
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
      const example = panel.exampleOf && findNode(panel.scene, panel.exampleOf.nodeId), hint = example ? minimalExampleInstruction(example, panel.exampleOf!.transformationId) : "";
      const base = [hint, instructionOverride ?? (panel.generationMode === "compose" ? panel.composePrompt : panel.instruction)].filter(Boolean).join("\n");
      const scene = ownCodeIds(panel.scene);
      const result = generatedSchema.parse(await deps.request("code", { scene, image: context.image, compositionPens: context.compositionPens, compositionStrokes: context.compositionStrokes,
        previous: panel.generated ? liveSceneSource(panel.generated, panel.scene) : "", instruction: (repair ? `${base}\nFix this runtime error: ${panel.runtimeError}` : base).slice(0, 6000) }, owner));
      if (document !== deps.documentId() || snapshot !== JSON.stringify(deps.panel(owner).scene)) throw new Error("The brush stamp or property structure changed during generation. Please generate again.");
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
   * A new frame beside this one with only `transformationId` of the node (plus a plain member
   * for a collection), linked back to this frame; it is rendered afterwards with `instruction`.
   * Throws when the example cannot be made; null when there is no room for another frame.
   */
  function exampleFrame(nodeId: string, transformationId: string, quiet = false, from?: Scene) {
    // `from`: the scene the transformation is in (a part of a decomposed transformation is in this frame's scene only as the child's).
    const source = from ?? deps.panel(owner).scene, node = findNode(source, nodeId), transformation = node && findTransformation(node, transformationId);
    if (!node || !transformation) throw new Error("Could not find the Transformation.");
    const scene = sceneSchema.parse(minimalExampleScene(source, nodeId, transformationId));
    const label = transformation.label || "Transformation";
    // An ordinary new sketch frame. Its first code run gets the hint and its own (empty) sketch
    // instead of the original, so only this transformation shows; after that it is edited like any frame.
    const id = derive(scene, `${node.name} · ${label} example`, deps.artwork(owner)?.revision ?? 0,
      { sourceFrameId: null, exampleOf: { frameId: owner, nodeId, transformationId }, analysisRevision: -1, instruction: "", generationMode: "extract", composePrompt: "", selectedNodeIds: [nodeId] }, false, quiet);
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
  /** Example frames for these transformations (linked to this frame), then their code, two at a time. */
  async function makeExamples(targets: { nodeId: string; transformationId: string; from?: Scene }[], what: string) {
    const made: NonNullable<ReturnType<typeof exampleFrame>>[] = [], failed: string[] = [];
    for (const target of targets) {
      try { const frame = exampleFrame(target.nodeId, target.transformationId, true, target.from); if (!frame) break; made.push(frame); }
      catch { failed.push(target.transformationId); }
    }
    if (!made.length) { if (failed.length) deps.updatePanel(owner, { error: "Could not create the minimal example." }); return; }
    const left = targets.length - made.length - failed.length;
    const subs = made.filter(frame => frame.sub).length;
    deps.toast([`Decomposed ${made.length} ${what}(s) into minimal example frames${subs ? ` (${subs} added as sub brushes to the original brush's tool group)` : ""}. Generating the results…`,
      left ? `${left} could not be created because the frames are full (max ${MAX_SKETCH_FRAMES}).` : "", failed.length ? `${failed.length} could not be made into examples.` : ""].filter(Boolean).join(" "));
    // Two at a time (what the server takes at once): each frame's code is its own AI request.
    const queue = [...made];
    await Promise.all(Array.from({ length: Math.min(2, queue.length) }, async () => { for (let next = queue.shift(); next; next = queue.shift()) await renderExample(next.id); }));
  }
  /**
   * Decompose a minimal example again: AI divides its transformation into the meaningful algorithms its code runs
   * (their hard-coded constants become properties). This frame is left as it is; each part gets a child example frame
   * of its own, linked to this one, where only that part is shown and adjusted.
   */
  async function splitExample(nodeId: string, transformationId: string) {
    const out: { parts?: SemanticTransformation[]; algorithms?: Algorithm[]; reason?: string; scene?: Scene } = {};
    await deps.task("AI is dividing this transformation into the algorithms inside it…", async () => {
      const panel = deps.panel(owner);
      const result = splitResultSchema.parse(await deps.request("split", { scene: panel.scene, targetNodeId: nodeId, targetTransformationId: transformationId,
        previous: panel.generated ? liveSceneSource(panel.generated, panel.scene) : "", instruction: "" }, owner));
      Object.assign(out, { parts: result.divisible ? result.parts : [], algorithms: result.algorithms, reason: result.reason, scene: panel.scene });
    }, owner);
    if (!out.scene) return;
    if (!out.parts?.length) { deps.toast(`Cannot be divided further: ${out.reason}`); return; }
    // Each part as the node's only transformation, in a copy of this frame's scene (the frame itself keeps its own).
    const withPart = (part: SemanticTransformation): Scene => ({ algorithms: out.algorithms!, nodes: out.scene!.nodes.map(node => node.id === nodeId ? { ...node, transformations: [part] } : node) });
    await makeExamples(out.parts.map(part => ({ nodeId, transformationId: part.id, from: withPart(part) })), "inner algorithm");
  }
  /** Regenerate one property/transformation (or add one); returns what changed, or null. */
  async function regenerateOne(nodeId: string, target: { transformationId?: string; propertyId?: string }, instruction?: string, marks: Marks = []) {
    const panel = deps.panel(owner), snapshot = JSON.stringify(panel.scene);
    const done: { changed?: { scene: Scene; label: string } } = {};
    const message = target.propertyId ? "Regenerating only this property's implementation…" : target.transformationId ? "Regenerating this semantic transformation…" : "Creating a new semantic transformation…";
    await deps.task(message, async () => {
      const scene = sceneSchema.parse(await deps.request("transform", { scene: panel.scene, targetNodeId: nodeId, targetTransformationId: target.transformationId || "", targetPropertyId: target.propertyId || "",
        alternative: Boolean(target.transformationId && !target.propertyId), instruction: instruction?.trim() || panel.instruction, transformMarks: compactMarks(marks),
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
    const what = labels.length === 1 ? `${labels[0]} was just regenerated: implement its NEW description and algorithms` : `${labels.join("; ")} were just regenerated together: implement their NEW descriptions and algorithms`;
    await generateCode(false, `${base}\n${what} exactly, replacing the old behavior in the previous code (do not keep the old logic).`);
  }

  return {
    generateCode,
    draftComposePrompt,
    /** One transformation of a Compose tag changed by AI as the user asks (the card shows the result). */
    async reviseComposeTag(tagId: string, index: number, request: string) {
      const tags = deps.panel(owner).composeTags, document = deps.documentId();
      await deps.task(tagRevisionLabel, async () => {
        const context = await sketchContext(deps, owner);
        const result = tagRevisionSchema.parse(await deps.request("tag-revise", { image: context.image, compositionPens: context.compositionPens, compositionStrokes: context.compositionStrokes, composeTags: tags, tagTarget: { tagId, index }, instruction: request.slice(0, 2000) }, owner));
        if (document !== deps.documentId()) return;
        deps.updatePanel(owner, current => ({ composeTags: reviseTag(current.composeTags, result) }));
        deps.toast(result.note || `Changed “${result.transformation.label}”.`);
      }, owner);
    },
    /** Extract from this sketch into a NEW sketch frame beside it, then render that frame's result. */
    async extract() {
      const document = deps.documentId(), revision = deps.artwork(owner)?.revision, name = deps.artwork(owner)?.name || "Sketch";
      const out: { frame?: string } = {};
      await deps.task("Extracting brush stamps and objects from the sketch…", async () => {
        const capture = await deps.capture(owner), context = compositionContext(deps.artwork(owner)!);
        const scene = sceneSchema.parse(await deps.request("extract", { image: capture.image, recoveryRegion: capture.region, compositionPens: context.compositionPens, compositionStrokes: context.compositionStrokes, instruction: deps.panel(owner).instruction }, owner));
        if (!fresh(document, revision)) throw new Error("The sketch changed during extraction. Please extract again.");
        const r = capture.region;
        const mapped = { ...scene, nodes: scene.nodes.map(node => ({ ...node, region: { x: r.x + node.region.x * r.w, y: r.y + node.region.y * r.h, w: Math.max(.01, node.region.w * r.w), h: Math.max(.01, node.region.h * r.h) } })) };
        out.frame = derive(mapped, `${name} · extracted`, revision!, {}, true) || undefined;
        deps.toast(`Extracted ${scene.nodes.filter(node => node.kind === "collection").length} brush stamp(s) and ${scene.nodes.filter(node => node.kind === "object").length} object(s) into a new frame.`);
      }, owner);
      if (out.frame) await renderDerived(out.frame);
    },
    /** AI makes a direct manipulation interface for one property, a transformation's properties, or every property of the node; they run in its proxy frame. */
    async suggestHandles(nodeId: string, target: HandleTarget, instruction = "") {
      const out: { count?: number; skipped?: number } = {};
      await deps.task(target.propertyId ? "AI is creating a direct manipulation interface for this property…" : "AI is creating a direct manipulation interface for each property…", async () => {
        const result = handleSuggestionsSchema.parse(await deps.request("handles", { scene: deps.panel(owner).scene, targetNodeId: nodeId, targetTransformationId: target.transformationId || "", targetPropertyId: target.propertyId || "",
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
     * Handles for every semantic transformation (as in the base state) of these nodes — every node of the frame but a
     * backdrop by default — that has a property without one: one request per transformation, two at a time, each
     * put on the scene as it arrives; then each node's proxy frame opens. One that fails does not stop the others.
     */
    async suggestAllHandles(nodeIds?: string[], redesign = false) {
      const panel = deps.panel(owner), chosen = panel.scene.nodes.filter(node => nodeIds ? nodeIds.includes(node.id) : node.parentId || !isBackdrop(node));
      // Redesign: every transformation that has a handle now, made again (the AI sees each current widget); undo takes each back.
      const targets = chosen.flatMap(node => handleTransformations(node).filter(item => redesign ? item.properties.some(property => property.handle)
        : item.properties.some(property => handleLeaves(property).length > 0 && !property.handle))
        .map(item => ({ nodeId: node.id, transformationId: item.id, label: item.label })));
      // Every node that has handles (or gets them) shows its proxy frames, one per transformation, in its group.
      const openAll = () => { for (const node of chosen) { const now = findNode(deps.panel(owner).scene, node.id); if (now && proxyGroups(now.transformations).length) deps.openProxy?.(owner, node.id); } };
      if (!targets.length && redesign) { deps.toast("There is no handle to redesign yet. Make them with Handles for all."); return; }
      if (!targets.length) {
        openAll();
        const shown = chosen.filter(node => proxyGroups(node.transformations).length).length;
        deps.toast(shown ? `Every transformation already has its handles: opened the proxy frames of ${shown} node(s), one per transformation, grouped by node. To make one again, use Redesign on it.` : "There is no property a direct manipulation handle can control.");
        return;
      }
      const nodes = new Set<string>(), failed: string[] = [];
      let count = 0, skipped = 0, done = 0;
      const label = (n: number) => `AI is ${redesign ? "redesigning" : "creating"} direct manipulation handles for each transformation (${n}/${targets.length})…`;
      await deps.task(label(0), async () => {
        const image = (await deps.capture(owner, true)).image, queue = [...targets];
        // Cancelling the frame's work ends the task: what is still running is dropped.
        const live = () => Boolean(deps.panel(owner).loading);
        await Promise.all(Array.from({ length: Math.min(2, queue.length) }, async () => {
          for (let next = queue.shift(); next && live(); next = queue.shift()) {
            try {
              const result = handleSuggestionsSchema.parse(await deps.request("handles", { scene: deps.panel(owner).scene, targetNodeId: next.nodeId, targetTransformationId: next.transformationId, targetPropertyId: "", instruction: "", image }, owner));
              if (!live()) return;
              const target = next;
              deps.updatePanel(owner, current => findNode(current.scene, target.nodeId) ? ops.commitScene(current, applyHandles(current.scene, target.nodeId, result.handles)) : {});
              if (result.handles.length) nodes.add(next.nodeId);
              count += result.handles.length; skipped += result.skipped.length;
            } catch (error) { if (error instanceof DOMException && error.name === "AbortError") return; failed.push(next.label); }
            if (live()) deps.updatePanel(owner, { loading: label(++done) });
          }
        }));
      }, owner);
      if (nodes.size) openAll();
      if (count || failed.length) deps.toast([count ? `${redesign ? "Redesigned" : "Created"} ${count} direct manipulation handle(s) for ${targets.length - failed.length} transformation(s), each transformation in its own proxy frame, grouped by node.` : "",
        skipped ? `${skipped} left out due to code errors.` : "", failed.length ? `Could not make: ${failed.join(", ")}.` : ""].filter(Boolean).join(" "));
    },
    async minimalExample(nodeId: string, transformationId: string) {
      let made: ReturnType<typeof exampleFrame>;
      try { made = exampleFrame(nodeId, transformationId); }
      catch (error) { deps.updatePanel(owner, { error: error instanceof Error ? error.message : "Could not create the minimal example." }); return; }
      if (!made) return;
      deps.toast(`Created a minimal example frame with only “${made.label}”${made.sub ? " (added as a sub brush to the original brush's tool group)" : ""}. Generating the result…`);
      await renderExample(made.id);
    },
    /**
     * Decompose: a minimal example frame for every semantic transformation of every node, as
     * defined in the base state (state machines left out), each linked back to this frame.
     */
    async decompose() {
      const panel = deps.panel(owner);
      // A still background filling the canvas is no brush and not part of one: nothing to try out on its own.
      const targets = panel.scene.nodes.filter(node => node.parentId || !isBackdrop(node))
        .flatMap(node => node.transformations.filter(item => item.properties.length).map(item => ({ nodeId: node.id, transformationId: item.id })));
      if (!targets.length) { deps.updatePanel(owner, { error: "There is no semantic transformation to decompose." }); return; }
      // A minimal example already holds one transformation: decomposing it again divides that transformation into the algorithms inside it.
      if (panel.exampleOf && targets.length === 1) { await splitExample(targets[0].nodeId, targets[0].transformationId); return; }
      await makeExamples(targets.map(target => ({ ...target, from: undefined })), "transformation");
    },
    /** AI on the transformation stack: one property, one transformation, or (neither) a new stacked transformation. Then the code follows. */
    async regenerate(nodeId: string, target: { transformationId?: string; propertyId?: string } = {}, instruction?: string, marks: Marks = []) {
      const done = await regenerateOne(nodeId, target, instruction, marks);
      if (done) await rewriteCode([done.label], done.scene);
    },
    /**
     * One fix that changes several transformations of a node: each is regenerated
     * in turn (told which others change with it), then the code is rewritten once.
     */
    async regenerateAll(nodeId: string, transformationIds: string[], instruction: string) {
      const labels: string[] = [];
      let last: Scene | null = null;
      for (const [i, id] of transformationIds.entries()) {
        const together = transformationIds.length > 1 ? `\n\nThis fix changes ${transformationIds.length} semantic transformations of this node together (${transformationIds.join(", ")}). This is ${i + 1}/${transformationIds.length}: regenerate only "${id}", doing its own part of the fix so that it works with the others.` : "";
        const done = await regenerateOne(nodeId, { transformationId: id }, `${instruction}${together}`.slice(0, 4000));
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
     */
    async refineMachine(nodeId: string, request: { target: MachineTarget | null; instruction: string; image?: string; marks: MachineMark[] }) {
      const panel = deps.panel(owner), snapshot = JSON.stringify(panel.scene);
      const sourceId = panel.sourceFrameId && deps.artwork(panel.sourceFrameId) ? panel.sourceFrameId : null;
      const prompt = panel.composePrompt.trim() || (sourceId ? deps.panel(sourceId).composePrompt.trim() : "");
      const label = request.target ? `AI is refining the attached ${request.target.kind === "state" ? "state" : "transition"}…` : "AI is refining the state machine…";
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
        deps.toast("Refined the state machine and updated the Compose prompt too. Press Update to connect it to the code.");
      }, owner);
    },
    async compose(repair = false) {
      // Without the text prompt, Compose reads the tags on the sketch alone; with it, the tags go along.
      // The tags go as they are now, edited by hand or not and even when the sketch changed since: only a frame with
      // nothing to compose from yet is read first, and reading the sketch again is the user's Regenerate.
      const panel = deps.panel(owner), text = panel.composeWithText, prompt = text ? panel.composePrompt.trim() : "", tags = panel.composeTags;
      if (repair) { await generateCode(true, prompt); return; }
      if (text ? !prompt : !tags.length) { await draftComposePrompt(); return; }
      const document = deps.documentId(), revision = deps.artwork(owner)?.revision;
      const out: { frame?: string } = {};
      await deps.task("Composing the pen algorithms and sketch into brush stamps…", async () => {
        const context = await sketchContext(deps, owner);
        // Marks erased since the tags were made are no longer there to point at.
        const drawn = new Set(context.compositionStrokes.map(stroke => stroke.id));
        const composeTags = tags.map(tag => ({ ...tag, strokeIds: tag.strokeIds.filter(id => drawn.has(id)) }));
        const scene = sceneSchema.parse(await deps.request("compose", { image: context.image, compositionPens: context.compositionPens, compositionStrokes: context.compositionStrokes, instruction: prompt, composeTags }, owner));
        const now = deps.panel(owner);
        if (!fresh(document, revision) || (text && prompt !== now.composePrompt.trim()) || (tags.length > 0 && tags !== now.composeTags)) throw new Error("The sketch, prompt or tags changed. Please Compose again.");
        out.frame = derive(scene, `${context.artwork.name} · composed`, revision!, { generationMode: "compose", composePrompt: prompt, composeWithText: text }, true) || undefined;
      }, owner);
      if (out.frame) await renderDerived(out.frame, prompt);
    },
  };
}
