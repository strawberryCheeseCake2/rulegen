import { compositionPromptSchema, generatedSchema } from "../lib/schema";
import { compositionContext } from "../lib/algorithm-pens";
import type { SketchPanel } from "../lib/sketch-panels";
import type { AlgorithmCall, Algorithm, Scene, ScalarValue, SceneNode } from "../lib/scene/schema";
import { MAX_NESTING_DEPTH } from "../lib/scene/schema";
import { sceneSchema } from "../lib/scene/validate";
import { findNode, groupNodes, moveNodes, removeNodes, reorderNode, sceneDepth, selectionRoots, setParent, ungroupNode, uniqueNodeId } from "../lib/scene/graph";
import * as ops from "../lib/scene/panel-ops";
import { importAlgorithmCall, makeAlgorithmPen } from "../lib/scene/pens";
import { addBlockProperty, copyAlgorithm, moveNodeTo, pasteAlgorithm, transplantNodes, type AlgorithmClip } from "../lib/scene/transfer";
import { instantiate } from "../lib/scene/algorithms";
import { isAlgorithm, valueAt } from "../lib/scene/values";
import { liveSceneSource } from "../lib/scene/live";
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
  let rootId: string;
  try {
    const result = transplantNodes(source.scene, nodeId, target.scene, at);
    rootId = result.rootId;
    deps.activate(to);
    // The result frame appears immediately and shows progress until the code arrives.
    deps.updatePanel(to, panel => ({ ...ops.commitScene(panel, result.scene, [result.rootId]), selectedNodeIds: [result.rootId], pendingResult: true }));
    deps.focus(to as FrameId);
    deps.toast(`${findNode(result.scene, rootId)?.name}을 이 스케치로 복사하고 결과를 만들고 있습니다.`);
  } catch (error) { deps.updatePanel(to, { error: (error as Error).message }); return; }
  try { await sceneAI(deps, to).generateCode(); }
  finally { deps.updatePanel(to, { pendingResult: false }); }
}

async function sketchContext(deps: StudioDeps, owner: string) {
  const artwork = deps.artwork(owner);
  if (!artwork) throw new Error("스케치를 찾지 못했습니다.");
  return { artwork, image: (await deps.capture(owner, true)).image, ...compositionContext(artwork) };
}

/** AI-backed scene actions for one sketch panel. */
export function sceneAI(deps: StudioDeps, owner: string) {
  const fresh = (document: number, revision: number | undefined) => document === deps.documentId() && revision === deps.artwork(owner)?.revision;
  async function generateCode(repair = false, instructionOverride?: string) {
    const panel = deps.panel(owner);
    if (!panel.scene.nodes.length) { deps.updatePanel(owner, { error: "먼저 collection과 object를 추출해주세요." }); return; }
    const snapshot = JSON.stringify(panel.scene), document = deps.documentId();
    await deps.task(repair ? "실행 오류를 수정하고 있습니다…" : "Collection과 object를 p5.js 코드로 번역하고 있습니다…", async () => {
      // Derived frames are coded against the sketch they were extracted from.
      const context = await sketchContext(deps, panel.sourceFrameId && deps.artwork(panel.sourceFrameId) ? panel.sourceFrameId : owner);
      const base = instructionOverride ?? (panel.generationMode === "compose" ? panel.composePrompt : panel.instruction);
      const result = generatedSchema.parse(await deps.request("code", { scene: panel.scene, image: context.image, compositionPens: context.compositionPens, compositionStrokes: context.compositionStrokes,
        previous: panel.generated ? liveSceneSource(panel.generated, panel.scene) : "", instruction: repair ? `${base}\nFix this runtime error: ${panel.runtimeError}` : base }, owner));
      if (document !== deps.documentId() || snapshot !== JSON.stringify(deps.panel(owner).scene)) throw new Error("생성 중 collection 또는 property 구조가 변경되었습니다. 다시 생성해주세요.");
      deps.updatePanel(owner, { generated: result, codeDraft: result.code, executable: "", preparedCode: "", runtimeError: "", runtimeStates: {}, dirtyNodeIds: [] });
      deps.focus(owner as FrameId);
    }, owner);
  }
  async function draftComposePrompt() {
    const previous = deps.panel(owner).composePrompt, document = deps.documentId(), revision = deps.artwork(owner)?.revision;
    await deps.task(compositionPromptLabel, async () => {
      const number = deps.requestId(), context = await sketchContext(deps, owner);
      const result = compositionPromptSchema.parse(await deps.request("compose-prompt", { image: context.image, compositionPens: context.compositionPens, compositionStrokes: context.compositionStrokes, instruction: previous }, owner));
      if (number !== deps.requestId() || document !== deps.documentId()) return;
      if (!fresh(document, revision) || previous !== deps.panel(owner).composePrompt) throw new Error("스케치 또는 prompt가 변경되었습니다. AI prompt를 다시 만들어주세요.");
      deps.updatePanel(owner, { composePrompt: result.prompt });
      deps.toast("AI가 Compose prompt를 작성했습니다. 설명을 확인하거나 수정한 뒤 Compose sketch를 눌러주세요.");
    }, owner);
  }
  /** A new sketch frame holding a scene derived from this one. */
  function derive(scene: Scene, name: string, revision: number, extra: Partial<SketchPanel>) {
    const id = deps.createFrame(owner, name);
    if (!id) { deps.updatePanel(owner, { error: "스케치 프레임은 최대 24개까지 만들 수 있습니다." }); return null; }
    deps.updatePanel(id, panel => ({ ...ops.commitScene(panel, scene), sourceFrameId: owner, analysisRevision: revision, instruction: deps.panel(owner).instruction, pendingResult: true, ...extra }));
    deps.activate(id); deps.focus(id as FrameId);
    return id;
  }
  async function renderDerived(id: string, instruction?: string) {
    try { await sceneAI(deps, id).generateCode(false, instruction); }
    finally { deps.updatePanel(id, { pendingResult: false }); }
  }
  return {
    generateCode,
    draftComposePrompt,
    /** Extract from this sketch into a NEW sketch frame beside it, then render that frame's result. */
    async extract() {
      const document = deps.documentId(), revision = deps.artwork(owner)?.revision, name = deps.artwork(owner)?.name || "Sketch";
      const out: { frame?: string } = {};
      await deps.task("스케치에서 collection과 object를 추출하고 있습니다…", async () => {
        const capture = await deps.capture(owner), context = compositionContext(deps.artwork(owner)!);
        const scene = sceneSchema.parse(await deps.request("extract", { image: capture.image, recoveryRegion: capture.region, compositionPens: context.compositionPens, compositionStrokes: context.compositionStrokes, instruction: deps.panel(owner).instruction }, owner));
        if (!fresh(document, revision)) throw new Error("추출 중 스케치가 변경되었습니다. 다시 추출해주세요.");
        const r = capture.region;
        const mapped = { ...scene, nodes: scene.nodes.map(node => ({ ...node, region: { x: r.x + node.region.x * r.w, y: r.y + node.region.y * r.h, w: Math.max(.01, node.region.w * r.w), h: Math.max(.01, node.region.h * r.h) } })) };
        out.frame = derive(mapped, `${name} · extracted`, revision!, {}) || undefined;
        deps.toast(`${scene.nodes.filter(node => node.kind === "collection").length}개의 collection과 ${scene.nodes.filter(node => node.kind === "object").length}개의 object를 새 프레임으로 추출했습니다.`);
      }, owner);
      if (out.frame) await renderDerived(out.frame);
    },
    /** AI on the transformation stack: one property, one transformation, or (neither) a new stacked transformation. */
    async regenerate(nodeId: string, target: { transformationId?: string; propertyId?: string } = {}) {
      const panel = deps.panel(owner), snapshot = JSON.stringify(panel.scene);
      const message = target.propertyId ? "이 property의 구현만 다시 만들고 있습니다…" : target.transformationId ? "이 semantic transformation을 다시 만들고 있습니다…" : "새 semantic transformation을 만들고 있습니다…";
      await deps.task(message, async () => {
        const scene = sceneSchema.parse(await deps.request("transform", { scene: panel.scene, targetNodeId: nodeId, targetTransformationId: target.transformationId || "", targetPropertyId: target.propertyId || "",
          alternative: Boolean(target.transformationId && !target.propertyId), instruction: panel.instruction, image: (await deps.capture(owner, true)).image }, owner));
        if (snapshot !== JSON.stringify(deps.panel(owner).scene)) throw new Error("생성 중 장면이 변경되었습니다. 다시 시도해주세요.");
        deps.updatePanel(owner, current => ops.commitScene(current, scene, [nodeId]));
      }, owner);
    },
    async generateMachine(nodeId: string) {
      const panel = deps.panel(owner), snapshot = JSON.stringify(panel.scene);
      await deps.task("AI가 이 노드의 상태와 전이를 계획하고 있습니다…", async () => {
        const context = await sketchContext(deps, owner);
        const scene = sceneSchema.parse(await deps.request("state-machine", { scene: panel.scene, targetNodeId: nodeId, image: context.image, compositionPens: context.compositionPens, compositionStrokes: context.compositionStrokes,
          instruction: panel.generationMode === "compose" ? panel.composePrompt || panel.instruction : panel.instruction, previous: panel.generated ? liveSceneSource(panel.generated, panel.scene) : "" }, owner));
        if (snapshot !== JSON.stringify(deps.panel(owner).scene)) throw new Error("생성 중 장면이 변경되었습니다. 다시 시도해주세요.");
        const machine = findNode(scene, nodeId)?.machine;
        deps.updatePanel(owner, current => ({ ...ops.commitScene(current, scene, [nodeId]), selectedNodeIds: [nodeId], ...(machine ? ops.chooseState({ ...current, scene }, nodeId, machine.initialState) : {}) }));
        deps.toast("상태 머신을 만들었습니다. 코드에 연결하려면 Generate code를 눌러주세요.");
      }, owner);
    },
    async compose(repair = false) {
      const panel = deps.panel(owner), prompt = panel.composePrompt.trim();
      if (repair) { await generateCode(true, prompt); return; }
      if (!prompt) { await draftComposePrompt(); return; }
      const document = deps.documentId(), revision = deps.artwork(owner)?.revision;
      const out: { frame?: string } = {};
      await deps.task("펜의 알고리즘과 스케치를 collection으로 조합하고 있습니다…", async () => {
        const context = await sketchContext(deps, owner);
        const scene = sceneSchema.parse(await deps.request("compose", { image: context.image, compositionPens: context.compositionPens, compositionStrokes: context.compositionStrokes, instruction: prompt }, owner));
        if (!fresh(document, revision) || prompt !== deps.panel(owner).composePrompt.trim()) throw new Error("스케치 또는 prompt가 변경되었습니다. 다시 Compose해주세요.");
        out.frame = derive(scene, `${context.artwork.name} · composed`, revision!, { generationMode: "compose", composePrompt: prompt }) || undefined;
      }, owner);
      if (out.frame) await renderDerived(out.frame, prompt);
    },
  };
}
