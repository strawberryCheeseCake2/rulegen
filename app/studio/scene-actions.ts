import { clarificationSchema, compositionPromptSchema, generatedSchema, type CodeReference, type SemanticPen } from "../lib/schema";
import { clarifiedInstruction } from "../lib/scene/clarify";
import { addPenTransformation } from "../lib/scene/convert";
import type { TransformDraft } from "../lib/sketch-panels";
import { annotatedImage, compactMarks, type Marks } from "./annotated-image";
import { compositionContext } from "../lib/algorithm-pens";
import type { SketchPanel } from "../lib/sketch-panels";
import type { Algorithm, AlgorithmCall, Scene, ScalarValue, SceneNode } from "../lib/scene/schema";
import { MAX_NESTING_DEPTH } from "../lib/scene/schema";
import { sceneSchema } from "../lib/scene/validate";
import { findNode, groupNodes, moveNodes, removeNodes, reorderNode, sceneDepth, selectionRoots, setParent, ungroupNode, uniqueNodeId } from "../lib/scene/graph";
import * as ops from "../lib/scene/panel-ops";
import { importAlgorithmCall } from "../lib/scene/algorithms";
import { addBlockProperty, copyAlgorithm, pasteAlgorithm, type AlgorithmClip } from "../lib/scene/transfer";
import { instantiate } from "../lib/scene/algorithms";
import { isAlgorithm, valueAt } from "../lib/scene/values";
import { liveSceneSource } from "../lib/scene/live";
import { ownCodeIds, programModules } from "../lib/scene/machines";
import { decompositionSchema, exampleFrames, exampleInstruction } from "../lib/scene/minimal-example";
import { findTransformation } from "../lib/scene/transformations";
import type { FrameId } from "../lib/workspace";
import type { StudioDeps } from "./deps";

export const compositionPromptLabel = "AI가 스케치와 펜의 의미를 읽어 Compose prompt를 만들고 있습니다…";

/** Local scene edits (no AI) for one sketch panel. */
export function sceneEdits(deps: StudioDeps, owner: string) {
  const apply = (op: (panel: SketchPanel) => Partial<SketchPanel>) => deps.updatePanel(owner, panel => panel.loading ? {} : op(panel));
  /** Layer edits that would nest deeper than MAX_NESTING_DEPTH are refused. */
  const tooDeep = (scene: Scene) => sceneDepth(scene) > MAX_NESTING_DEPTH ? { error: `Collection은 ${MAX_NESTING_DEPTH}단계까지만 중첩할 수 있습니다.` } : null;
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
      const next = groupNodes(panel.scene, roots, id, `Collection ${panel.scene.nodes.filter(node => node.kind === "collection").length + 1}`);
      return tooDeep(next) || { ...ops.commitScene(panel, next, roots), selectedNodeIds: [id] };
    }),
    ungroup: (id: string) => structural(scene => ungroupNode(scene, id)),
    remove: () => structural((scene, panel) => removeNodes(scene, panel.selectedNodeIds)),
    /** Delete these nodes (e.g. one collection) whatever is selected. */
    removeIds: (ids: string[]) => structural(scene => removeNodes(scene, ids)),
    reparent: (id: string, parentId: string | null, beforeId: string | null) => structural(scene => setParent(scene, id, parentId, beforeId), () => [id]),
    reorder: (id: string, direction: -1 | 1) => structural(scene => reorderNode(scene, id, direction)),
    add: (kind: "collection" | "object") => apply(panel => {
      const id = uniqueNodeId(panel.scene, kind === "collection" ? "collection" : "object");
      const parent = findNode(panel.scene, panel.selectedNodeIds[0]);
      const node: SceneNode = { id, kind, parentId: parent?.kind === "collection" ? parent.id : null, name: kind === "collection" ? "New collection" : "New object", description: "", primitive: kind === "collection" ? "group" : "shape",
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
    addProperty: (nodeId: string, algorithmId: string, transformationId?: string | null) => {
      try { deps.updatePanel(owner, ops.addAlgorithmProperty(deps.panel(owner), nodeId, algorithmId, transformationId)); }
      catch (error) { deps.updatePanel(owner, { error: (error as Error).message }); }
    },
    addTransformation: (nodeId: string) => apply(panel => ops.addTransformation(panel, nodeId)),
    editTransformation: (nodeId: string, transformationId: string, patch: Parameters<typeof ops.editTransformation>[3]) => apply(panel => ops.editTransformation(panel, nodeId, transformationId, patch)),
    removeTransformation: (nodeId: string, transformationId: string) => apply(panel => ops.removeTransformation(panel, nodeId, transformationId)),
    moveTransformation: (nodeId: string, transformationId: string, offset: number) => apply(panel => ops.moveTransformation(panel, nodeId, transformationId, offset)),
    editAlgorithm: (algorithmId: string, patch: { name?: string; description?: string }) => apply(panel => ops.editAlgorithm(panel, algorithmId, patch)),
    importAlgorithm: (source: { call: AlgorithmCall; library: Algorithm[] }) => apply(panel => {
      const { scene } = importAlgorithmCall(panel.scene, source);
      return scene.algorithms.length > 96 ? { error: "알고리즘 라이브러리가 가득 찼습니다." } : ops.commitScene(panel, scene);
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
      const clip = copyAlgorithm(panel.scene, value); deps.setClip(clip); deps.toast(`${clip.label}을 복사했습니다. 다른 property에서 우클릭해 붙여넣으세요.`);
    },
    copyDefinition: (algorithmId: string) => {
      const scene = deps.panel(owner).scene, clip = copyAlgorithm(scene, instantiate(scene.algorithms, algorithmId));
      deps.setClip(clip); deps.toast(`${clip.label}을 복사했습니다. 다른 property에서 우클릭해 붙여넣으세요.`);
    },
    /** Paste replaces the slot's value in the base property; a state cannot change structure. */
    pasteSlot: (nodeId: string, propertyId: string, path: string[], dropped?: AlgorithmClip) => {
      const panel = deps.panel(owner), clip = dropped || deps.clip();
      if (!clip) return;
      if (panel.editingStates[nodeId]) { deps.updatePanel(owner, { error: "알고리즘 블록은 Base에서만 끼울 수 있습니다. 상태에서는 값만 바꿀 수 있어요." }); return; }
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
  };
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

/** What a frame's code is asked to do: an example shows its one transformation; a composition follows its Compose prompt. Plus the user's direction. */
export function codeInstruction(panel: SketchPanel) {
  if (panel.role === "example" && panel.example) return exampleInstruction(panel.scene, panel.example, panel.instruction);
  if (panel.role === "composition") return [panel.composePrompt.trim(), panel.instruction.trim() && `User direction: ${panel.instruction.trim()}`].filter(Boolean).join("\n").slice(0, 2000);
  return panel.instruction;
}
/** The code module of a minimal example frame: the one drawing the node that carries its transformation. */
export function exampleModule(panel: SketchPanel) {
  if (panel.role !== "example" || !panel.example || !panel.generated) return null;
  let node = findNode(panel.scene, panel.example.nodeId);
  while (node?.parentId) node = findNode(panel.scene, node.parentId);
  return node ? programModules(panel.generated.code).get(node.codeModule ?? node.id) ?? null : null;
}
/** The working code of every example a composition took a transformation from (while that example frame still has it). */
export function codeReferences(deps: Pick<StudioDeps, "panel" | "artwork">, scene: Scene): CodeReference[] {
  const seen = new Set<string>(), references: CodeReference[] = [];
  for (const transformation of scene.nodes.flatMap(node => node.transformations)) {
    const origin = transformation.origin;
    if (!origin || seen.has(`${origin.frameId}:${origin.transformationId}`) || !deps.artwork(origin.frameId)) continue;
    seen.add(`${origin.frameId}:${origin.transformationId}`);
    const code = exampleModule(deps.panel(origin.frameId));
    if (code && references.length < 12) references.push({ transformationId: transformation.id, label: transformation.label || origin.label, code: code.slice(0, 40000) });
  }
  return references;
}

/** Run `work` for every item, at most `limit` at a time. */
async function pool<T>(items: T[], limit: number, work: (item: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, async () => { for (let item = queue.shift(); item !== undefined; item = queue.shift()) await work(item); }));
}

export const decomposeLabel = "스케치를 독립적인 semantic transformation으로 나누고 있습니다…";
export const splitLabel = "이 최소 예제를 더 작은 semantic transformation으로 나누고 있습니다…";
/** What decomposing a minimal example splits: the transformation it shows (null for a sketch, or when it is gone). */
export function splitTarget(panel: SketchPanel) {
  if (panel.role !== "example" || !panel.example) return null;
  const node = findNode(panel.scene, panel.example.nodeId);
  return node && findTransformation(node, panel.example.transformationId) ? { nodeId: node.id, transformationId: panel.example.transformationId } : null;
}

/** AI-backed scene actions for one frame. */
export function sceneAI(deps: StudioDeps, owner: string) {
  const stillHere = stillHereFor(deps);
  const fresh = (document: number, revision: number | undefined) => document === deps.documentId() && revision === deps.artwork(owner)?.revision;
  async function sketchContext(frame: string) {
    const artwork = deps.artwork(frame);
    if (!artwork) throw new Error("스케치를 찾지 못했습니다.");
    return { artwork, image: (await deps.capture(frame, true)).image, ...compositionContext(artwork, deps.resolvePen) };
  }
  async function generateCode(repair = false, instructionOverride?: string) {
    const panel = deps.panel(owner);
    if (!panel.scene.nodes.length) { deps.updatePanel(owner, { error: "먼저 스케치를 Decompose하거나 Compose해주세요." }); return; }
    const snapshot = JSON.stringify(panel.scene), document = deps.documentId();
    await deps.task(repair ? "실행 오류를 수정하고 있습니다…" : panel.role === "example" ? "이 transformation만 보여주는 최소 예제 코드를 만들고 있습니다…" : "장면을 p5.js 코드로 번역하고 있습니다…", async () => {
      // A composition is coded against the sketch it was composed from; an example against itself, except that one drawing the
      // sketch's elements sees the source sketch's image (to draw them like it; its instruction says to take nothing else).
      const source = panel.sourceFrameId && deps.artwork(panel.sourceFrameId) ? panel.sourceFrameId : null;
      const context = await sketchContext(panel.role === "composition" && source ? source : owner);
      if (panel.role === "example" && panel.example?.elements.length && source) context.image = (await deps.capture(source, true)).image;
      const base = instructionOverride ?? codeInstruction(panel);
      const scene = ownCodeIds(panel.scene);
      const result = generatedSchema.parse(await deps.request("code", { scene, image: context.image, compositionPens: context.compositionPens, compositionStrokes: context.compositionStrokes,
        previous: panel.generated ? liveSceneSource(panel.generated, panel.scene) : "", instruction: repair ? `${base}\nFix this runtime error: ${panel.runtimeError}` : base,
        references: codeReferences(deps, scene) }, owner));
      if (document !== deps.documentId() || snapshot !== JSON.stringify(deps.panel(owner).scene)) throw new Error("생성 중 장면이 변경되었습니다. 다시 생성해주세요.");
      deps.updatePanel(owner, { scene, generated: result, codeDraft: result.code, executable: "", preparedCode: "", runtimeError: "", runtimeStates: {}, dirtyNodeIds: [] });
    }, owner);
  }
  async function draftComposePrompt() {
    const previous = deps.panel(owner).composePrompt, document = deps.documentId(), revision = deps.artwork(owner)?.revision;
    await deps.task(compositionPromptLabel, async () => {
      const number = deps.requestId(owner), context = await sketchContext(owner);
      const result = compositionPromptSchema.parse(await deps.request("compose-prompt", { image: context.image, compositionPens: context.compositionPens, compositionStrokes: context.compositionStrokes, instruction: previous }, owner));
      if (number !== deps.requestId(owner) || document !== deps.documentId()) return;
      if (!fresh(document, revision) || previous !== deps.panel(owner).composePrompt) throw new Error("스케치 또는 prompt가 변경되었습니다. AI prompt를 다시 만들어주세요.");
      deps.updatePanel(owner, { composePrompt: result.prompt });
      deps.toast("AI가 Compose prompt를 작성했습니다. 설명을 확인하거나 수정한 뒤 Compose sketch를 눌러주세요.");
    }, owner);
  }
  async function renderDerived(id: string) {
    try { await sceneAI(deps, id).generateCode(); }
    finally { deps.updatePanel(id, { pendingResult: false }); }
  }
  /** The transformation pens an annotation was drawn with (as they read now), and each mark's pen ("" when plain or the pen is gone). */
  function annotationPens(draft: Pick<TransformDraft, "marks" | "markPens">) {
    const pens = [...new Set(draft.markPens.filter(Boolean))].map(id => deps.pen?.(id)).filter((pen): pen is SemanticPen => pen?.kind === "transformation");
    return { pens, markPens: draft.marks.map((_, i) => pens.some(pen => pen.id === draft.markPens[i]) ? draft.markPens[i] : "") };
  }
  /** The annotation for AI: thinned marks with their pens, and the frame drawn over with them (pen marks in their pen's color). */
  async function annotation(marks: Marks, markPens: string[], pens: SemanticPen[]) {
    const styles = marks.map((_, i) => { const pen = pens.find(item => item.id === markPens[i]); return pen ? { color: pen.color, width: 5, opacity: 1 } : undefined; });
    return { transformMarks: compactMarks(marks), transformMarkPens: markPens.slice(-64), compositionPens: pens,
      image: await annotatedImage((await deps.capture(owner, true)).image, marks, undefined, styles as { color: string; width: number; opacity: number }[]) };
  }
  type Extra = { alternative?: boolean; markPens?: string[]; pens?: SemanticPen[] };
  async function regenerate(nodeId: string, target: { transformationId?: string; propertyId?: string } = {}, instruction?: string, marks: Marks = [], extra: Extra = {}) {
    const done = await regenerateOne(nodeId, target, instruction, marks, extra);
    // The running code still does the old thing: rewrite it from the new description right away (unless the scene moved on).
    if (!done || !deps.panel(owner).generated || JSON.stringify(deps.panel(owner).scene) !== JSON.stringify(done.scene)) return;
    await generateCode(false, `${codeInstruction(deps.panel(owner))}\n${done.label} was just regenerated: implement its NEW description and algorithms exactly, replacing the old behavior in the previous code (do not keep the old logic).`);
  }
  /** Regenerate one property/transformation (or add one); returns what changed, or null. */
  async function regenerateOne(nodeId: string, target: { transformationId?: string; propertyId?: string }, instruction?: string, marks: Marks = [],
    { alternative = Boolean(target.transformationId && !target.propertyId), markPens = [], pens = [] }: Extra = {}) {
    const panel = deps.panel(owner), snapshot = JSON.stringify(panel.scene);
    const done: { changed?: { scene: Scene; label: string } } = {};
    const message = target.propertyId ? "이 property의 구현만 다시 만들고 있습니다…" : target.transformationId ? "이 semantic transformation을 다시 만들고 있습니다…" : "새 semantic transformation을 만들고 있습니다…";
    await deps.task(message, async () => {
      const scene = sceneSchema.parse(await deps.request("transform", { scene: panel.scene, targetNodeId: nodeId, targetTransformationId: target.transformationId || "", targetPropertyId: target.propertyId || "",
        alternative, instruction: instruction?.trim() || panel.instruction, ...await annotation(marks, markPens, pens) }, owner));
      if (snapshot !== JSON.stringify(deps.panel(owner).scene)) throw new Error("생성 중 장면이 변경되었습니다. 다시 시도해주세요.");
      deps.updatePanel(owner, current => ({ ...ops.commitScene(current, scene, [nodeId]), transformDraft: null }));
      done.changed = { scene: deps.panel(owner).scene, label: describeTarget(scene, nodeId, target) };
    }, owner);
    return done.changed ?? null;
  }

  return {
    generateCode,
    draftComposePrompt,
    /**
     * Decompose this sketch: AI splits it into its objects and semantic
     * transformations, each as independent as possible. Every object becomes a
     * minimal example frame beside the sketch (that element alone), every
     * transformation one too (that transformation alone, on the sketch's elements;
     * the user makes a pen from it with Make pen); then the examples' code is
     * generated, a few at a time. A minimal example decomposes the same way into
     * smaller examples of its one transformation, on plain stand-in shapes, unless
     * that is already primitive.
     */
    async decompose() {
      const document = deps.documentId(), revision = deps.artwork(owner)?.revision, out: { frames: string[] } = { frames: [] };
      const panel = deps.panel(owner), parent = splitTarget(panel), snapshot = JSON.stringify(panel.scene);
      if (panel.role === "example" && !parent) { deps.updatePanel(owner, { error: "이 예제의 transformation을 찾지 못했습니다." }); return; }
      await deps.task(parent ? splitLabel : decomposeLabel, async () => {
        const context = await sketchContext(owner);
        const decomposition = decompositionSchema.parse(await deps.request("decompose", { image: (await deps.capture(owner)).image, compositionPens: context.compositionPens, compositionStrokes: context.compositionStrokes, instruction: panel.instruction,
          ...(parent ? { scene: panel.scene, targetNodeId: parent.nodeId, targetTransformationId: parent.transformationId } : {}) }, owner));
        if (!fresh(document, revision) || snapshot !== JSON.stringify(deps.panel(owner).scene)) throw new Error(`분석 중 ${parent ? "예제" : "스케치"}가 변경되었습니다. 다시 Decompose해주세요.`);
        if (parent && decomposition.items.length < 2) {
          const reason = decomposition.minimalReason.trim();
          deps.toast(`AI가 이 transformation을 이미 최소 단위로 보고 나누지 않았습니다${reason ? `: ${reason}` : "."} 나눌 방향을 Generation direction에 적고 다시 Decompose할 수 있습니다.`);
          return;
        }
        // The sketch's objects, then the transformations: a frame each (a transformation example becomes a pen only when the user makes one).
        const frames = exampleFrames(decomposition), ids = deps.createFrames(owner, frames.map(frame => frame.name));
        ids.forEach((id, i) => {
          const { scene, example } = frames[i];
          deps.updatePanel(id, panel => ({ ...ops.commitScene(panel, scene), role: "example", sourceFrameId: owner, analysisRevision: revision ?? -1, selectedNodeIds: [example.nodeId], pendingResult: true,
            example: { ...example, sourceFrameId: owner, penId: "" } }));
        });
        out.frames = ids;
        const made = frames.slice(0, ids.length), objects = made.filter(frame => frame.example.kind === "object").length, skipped = frames.length - ids.length;
        deps.toast(`${objects ? `스케치의 object ${objects}개와 ` : ""}${made.length - objects}개의 ${parent ? "더 작은 " : ""}semantic transformation을 최소 예제 프레임으로 만들었습니다${skipped ? ` (프레임이 가득 차 ${skipped}개는 빠짐)` : ""}. 예제 코드를 만드는 중입니다… 펜은 예제의 Make pen으로 만드세요.`);
      }, owner);
      await pool(out.frames, 3, renderDerived);
    },
    /** AI on the transformation stack: one property, one transformation, or (neither) a new stacked transformation. Then the code follows. */
    regenerate,
    /**
     * Before adding or modifying: the open request (text and frame annotation, on a node or the whole frame) comes
     * back as text: what the AI understood, the target, the concrete plan and its questions. Nothing changes yet.
     * Asked again with an answer, the answer joins the request.
     */
    async clarify() {
      const panel = deps.panel(owner), draft = panel.transformDraft;
      if (!draft) return;
      const snapshot = JSON.stringify(panel.scene), document = deps.documentId(), answer = draft.clarification ? draft.answer.trim() : "";
      const instruction = [draft.instruction.trim(), answer && `(답변) ${answer}`].filter(Boolean).join("\n");
      deps.updatePanel(owner, current => current.transformDraft ? { transformDraft: { ...current.transformDraft, annotating: false } } : {});
      await deps.task("무엇을 추가하거나 바꿀지 확인하고 있습니다…", async () => {
        const { pens, markPens } = annotationPens(draft);
        const clarification = clarificationSchema.parse(await deps.request("clarify", { scene: panel.scene, targetNodeId: draft.nodeId ?? "",
          targetTransformationId: draft.nodeId ? draft.target.transformationId || "" : "", targetPropertyId: draft.nodeId ? draft.target.propertyId || "" : "",
          instruction, clarification: draft.clarification, ...await annotation(draft.marks, markPens, pens) }, owner));
        if (document !== deps.documentId() || snapshot !== JSON.stringify(deps.panel(owner).scene)) throw new Error("확인 중 장면이 변경되었습니다. 다시 시도해주세요.");
        // The node it would change is selected, so it shows on the frame.
        deps.updatePanel(owner, current => current.transformDraft ? { transformDraft: { ...current.transformDraft, instruction: instruction.slice(0, 2000), answer: "", clarification }, selectedNodeIds: [clarification.nodeId] } : {});
      }, owner);
    },
    /**
     * The user confirmed the clarification: add or modify exactly that (its plan and their answers as the brief), then the code follows.
     * Adding a pen's transformation needs no AI: it is copied in exactly as its example has it (the code then reuses the example's code).
     */
    async applyClarification() {
      const panel = deps.panel(owner), draft = panel.transformDraft, clarification = draft?.clarification;
      if (!draft || !clarification) return;
      const { pens, markPens } = annotationPens(draft), pen = pens.find(item => item.id === clarification.penId);
      if (clarification.action === "add" && pen) {
        try { deps.updatePanel(owner, current => ({ ...ops.commitScene(current, addPenTransformation(current.scene, clarification.nodeId, pen), [clarification.nodeId]), transformDraft: null })); }
        catch (error) { deps.updatePanel(owner, { error: (error as Error).message }); return; }
        deps.toast(`펜 「${pen.name}」의 transformation을 그대로 더했습니다.`);
        if (deps.panel(owner).generated) await generateCode(false, `${codeInstruction(deps.panel(owner))}\nSemantic transformation "${pen.transformation!.transformation.label}" was just added to node "${clarification.nodeId}" from a pen: implement it exactly, reusing its example's code in references.`);
        return;
      }
      await regenerate(clarification.nodeId, { transformationId: clarification.transformationId || undefined, propertyId: clarification.propertyId || undefined },
        clarifiedInstruction(draft.instruction, clarification, draft.answer), draft.marks, { alternative: false, markPens, pens });
    },
    /**
     * Compose this sketch, drawn with transformation pens (and the pencil), into a
     * NEW composition frame: the nodes take the pens' transformations as their
     * minimal examples show them now; its code reuses those examples' code.
     */
    async compose(repair = false) {
      const panel = deps.panel(owner), prompt = panel.composePrompt.trim();
      if (repair) { await generateCode(true); return; }
      if (!prompt) { await draftComposePrompt(); return; }
      const document = deps.documentId(), revision = deps.artwork(owner)?.revision;
      const out: { frame?: string } = {};
      await deps.task("펜의 transformation과 스케치를 장면으로 조합하고 있습니다…", async () => {
        const context = await sketchContext(owner);
        const scene = sceneSchema.parse(await deps.request("compose", { image: context.image, compositionPens: context.compositionPens, compositionStrokes: context.compositionStrokes, instruction: prompt }, owner));
        if (!fresh(document, revision) || prompt !== deps.panel(owner).composePrompt.trim()) throw new Error("스케치 또는 prompt가 변경되었습니다. 다시 Compose해주세요.");
        const [id] = deps.createFrames(owner, [`${context.artwork.name} · composed`]);
        if (!id) throw new Error("프레임이 가득 찼습니다. 쓰지 않는 프레임을 지워주세요.");
        deps.updatePanel(id, current => ({ ...ops.commitScene(current, scene), role: "composition", sourceFrameId: owner, analysisRevision: revision ?? -1, composePrompt: prompt, instruction: panel.instruction, pendingResult: true }));
        if (stillHere(owner)) { deps.activate(id); deps.focus(id as FrameId); }
        out.frame = id;
      }, owner);
      if (out.frame) await renderDerived(out.frame);
    },
  };
}
