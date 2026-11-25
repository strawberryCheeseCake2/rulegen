import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Route } from "./+types/home";
import { Icon } from "../components/icons";
import { SketchCanvas, type CanvasHandle } from "../components/sketch-canvas";
import { FreeformWorkspace, type WorkspaceHandle } from "../components/freeform-workspace";
import { ToolRail } from "../components/tool-rail";
import { ResultRevisionPanel } from "../components/result-revision-panel";
import { FrameJsonDialog } from "../components/frame-json-dialog";
import { frameExport } from "../lib/frame-export";
import type { CodePreviewHandle } from "../components/code-preview";
import { FrameAnnotations, FrameRender } from "../components/frame-render";
import { GenerationHistory } from "../components/generation-history";
import { RawCodePanel } from "../components/raw-code-panel";
import { SketchComposition } from "../components/sketch-composition";
import { ComposeTags, type ExampleThumb } from "../components/compose-tags";
import { ClarifyInsitu, SketchClarifyPanel } from "../components/sketch-clarify";
import { useClarifyDrawings } from "../studio/use-clarify-drawings";
import { drawingKey } from "../lib/sketch-clarify";
import { addTag, canMoveTag, deleteTag, MAX_TAG_CONSTRAINTS, moveTag, moveConstraint, penExamples, placedPen, setTagKind, type ComposeTag, type ComposeTagPen, type TagConstraintAt } from "../lib/compose-tags";
import { LayerPanel } from "../components/scene/layer-panel";
import { SceneOverlay } from "../components/scene/scene-overlay";
import { ProxyFrame, ProxyFrameBar, proxyNumber } from "../components/proxy-frame";
import { handleLeaves, handleConstraints, proxyGroups } from "../lib/scene/handles";
import { ADJUST_IN_PLACE_INSTRUCTION, bakesInput, isProxyFrame, MAX_PROXY_FRAMES, placeProxyGroup, planProxyFrames, proxiesOf, type ProxyFrame as ProxyFrameData } from "../lib/proxy-frames";
import { ConstraintInspector } from "../components/scene/constraint-inspector";
import { PanelResizer } from "../components/panel-resizer";
import { NodeMachinePanel } from "../components/scene/node-machine-panel";
import { brushesFor, isBackdrop, brushGroup, brushNodeIds, groupBrushes, brushRole, brushRoots, markBrushes, sourceBrushGroup, subBrushFor, brushTool, detachedBrush, MAX_BRUSHES, parseBrushTool, type Brush } from "../lib/brushes";
import { BrushRoleBadge, BrushRoleBanner, DetachDialog, type DetachPrompt } from "../components/brush-role";
import { subScene } from "../lib/scene/graph";
import { findConstraint } from "../lib/scene/constraints";
import { exampleLabel } from "../lib/scene/minimal-example";
import { captureThumbnail } from "../lib/brush-thumbnail";
import { prepareBrushFor, startBrushGesture } from "../studio/brush-actions";
import { programModules } from "../lib/scene/machines";
import { besideFramePosition, execFrameId, isExecFrame, liveGroups, MAX_SKETCH_FRAMES, nextSketchPosition, removeWorkspaceFrame, showWorkspaceFrame, workspaceSchema, type FrameId, type WorkspaceLayout } from "../lib/workspace";
import { annotationHistoryReducer } from "../lib/annotation-history";
import { type RecoveredGeneration } from "../lib/generation-recovery";
import type { Artwork, SemanticPen, Stroke, Viewport } from "../lib/schema";
import { type SketchFrame, projectSchema, exampleStrokes, readPhoto, downloadFile } from "../lib/project";
import { compositionContext, createInteractionPen, semanticPenColors } from "../lib/semantic-pens";
import { createSketchPanel, clearedResultAnnotations, savedSketchPanels, type SketchPanel } from "../lib/sketch-panels";
import { emptyScene, type Scene } from "../lib/scene/schema";
import { findNode } from "../lib/scene/graph";
import { syncScene } from "../lib/scene/machines";
import { liveSceneSource, sceneLiveStatus } from "../lib/scene/live";
import { editingState, inspectedNode, inspectedConstraints, commitScene } from "../lib/scene/panel-ops";
import { DragAdjustLayer } from "../components/scene/drag-adjust";
import { makeConstraintPen } from "../lib/scene/pens";
import { markLogged, reportError } from "../lib/error-report";
import { sceneChanges } from "../lib/scene/revisions";
import type { StudioDeps, PanelPatch, ConfirmPrompt, ConfirmAnswer } from "../studio/deps";
import { ConfirmDialog } from "../components/confirm-dialog";
import { compositionPromptLabel, dropNode, sceneAI, sceneEdits } from "../studio/scene-actions";
import { copyConstraint, NODE_DRAG_TYPE, readNodeDrag, type ConstraintClip } from "../lib/scene/transfer";
import { clarificationLabel, revisionActions, revisionSnapshot } from "../studio/revision-actions";
import { restorePoint, useExecution, type Analyzed } from "../studio/use-execution";
import type { ExecStep } from "../lib/execution/trace";
import { useManipulation, type ManipSaved, type ManipView } from "../studio/use-manipulation";
import { useKeptTools } from "../studio/use-kept-tools";
import { useGeneralize, type GeneralizeView } from "../studio/use-generalize";
import { GeneralizePanel } from "../components/generalize-panel";
import { ancestorsOf, changesOf, propagate, settle } from "../studio/propagate";
import { PropagatePanel } from "../components/propagate-panel";
import { SandboxLogicPanel } from "../components/sandbox-logic";
import { restructureTarget } from "../lib/execution/sandbox-restructure";
import { keptValues } from "../lib/execution/kept-tools";
import type { SavedTools } from "../lib/execution/manipulate";
import { ManipLayer, ManipPanel } from "../components/execution-manip";
import { ExecutionPanel } from "../components/execution-panel";
import { ExecutionOverlay } from "../components/execution-overlay";
import { ExecutionMarks } from "../components/execution-marks";
import { ExecutionFrame } from "../components/execution-frame";
import { MARK_COLOR } from "../studio/use-execution";

export function meta({}: Route.MetaArgs) { return [{ title: "GenTool — From a mark to a system" }, { name: "description", content: "Draw, extract collections and objects, and create p5.js systems with AI." }]; }
const blank = (): Artwork => ({ strokes: [], photo: null, name: "Untitled exploration", revision: 0 });
const storageKey = "rulegen.project.v1";
/** The direct manipulation session on a temporary fork, kept across a reload (the fork frame is kept with the project). */
const manipulationKey = "rulegen.manipulation.v1";
const drawingViewport: Viewport = { zoom: 1, x: 0, y: 0 };

/** The layers panel's width range when dragged (px). */
const LAYER_MIN_WIDTH = 150, LAYER_MAX_WIDTH = 520;

export default function Home() {
  // ── Sketch frames ──────────────────────────────────────────────────────────
  const [artwork, setArtwork] = useState<Artwork>(blank);
  const artworkRef = useRef(artwork); artworkRef.current = artwork;
  const [sketchFrames, setSketchFrames] = useState<SketchFrame[]>([]);
  const sketchFramesRef = useRef(sketchFrames); sketchFramesRef.current = sketchFrames;
  const [history, setHistory] = useState<Artwork[]>([]), [future, setFuture] = useState<Artwork[]>([]);
  const [sketchHistories, setSketchHistories] = useState<Record<string, { past: Artwork[]; future: Artwork[] }>>({});
  const [sketchSelections, setSketchSelections] = useState<Record<string, boolean>>({});
  const [hasSelection, setHasSelection] = useState(false);
  const sketchCanvases = useRef(new Map<string, CanvasHandle>());
  const canvas = useRef<CanvasHandle>(null);
  const [activeSketch, setActiveSketch] = useState("source");
  const activeSketchRef = useRef(activeSketch); activeSketchRef.current = activeSketch;

  // ── Per-sketch panels (kept in a ref too, so chained actions see their own writes) ──
  const [panels, setPanels] = useState<Record<string, SketchPanel>>(() => ({ source: createSketchPanel() }));
  const panelsRef = useRef(panels);
  function mutatePanels(edit: (current: Record<string, SketchPanel>) => Record<string, SketchPanel>) {
    const next = edit(panelsRef.current);
    if (next !== panelsRef.current) { panelsRef.current = next; setPanels(next); }
  }
  function updatePanel(id: string, patch: PanelPatch) {
    mutatePanels(current => {
      const previous = current[id] || createSketchPanel();
      const changes = typeof patch === "function" ? patch(previous) : patch;
      return Object.keys(changes).length ? { ...current, [id]: { ...previous, ...changes } } : current;
    });
  }
  const panel = panels[activeSketch] || createSketchPanel();
  const patchActive = (patch: PanelPatch) => updatePanel(activeSketch, patch);

  // ── Tools, pens, workspace and app chrome ──────────────────────────────────
  const [tool, setTool] = useState("pen"), [pencilOpen, setPencilOpen] = useState(false);
  // Where an Adjust drag started (its frame and scene), to make the drag one undo step.
  const adjustStart = useRef<{ frame: string; scene: Scene } | null>(null);
  // Brushes: reusable collections, each a tool group in the toolbar.
  const [brushes, setBrushesState] = useState<Brush[]>([]);
  const brushesRef = useRef(brushes);
  const setBrushes = (next: Brush[]) => { brushesRef.current = next; setBrushesState(next); };
  // The tool each group shows (a toolbar tool id), so a group remembers its last tool.
  const [groupTools, setGroupTools] = useState<Record<string, string>>({}), [openGroup, setOpenGroup] = useState<string | null>(null);
  /** The brush the Brush tool picks up again when its button is pressed. */
  const [lastBrush, setLastBrush] = useState<string | null>(null);
  /** The brush pointed at in the Brush panel (its master frame is shown on the board). */
  const [brushHover, setBrushHover] = useState<string | null>(null);
  const brushPick = parseBrushTool(tool), activeBrush = brushPick ? brushes.find(brush => brush.id === brushPick.brushId) : undefined;
  // The brush tool plays with the brush on the active frame that has it (interaction); `placing` is a frame whose brush gesture is still being fed in.
  const playingBrush = brushPick?.kind === "brush" ? activeBrush : undefined;
  const [placing, setPlacing] = useState<string | null>(null);
  // Proxy frames (direct manipulation handles of a node, beside its frame) and their widgets' runtime errors (with the code that failed).
  const [proxyFrames, setProxyFrames] = useState<ProxyFrameData[]>([]);
  const proxyFramesRef = useRef(proxyFrames); proxyFramesRef.current = proxyFrames;
  // The frame at the other end of a hovered proxy link (highlighted on the board).
  const [linkHover, setLinkHover] = useState<FrameId | null>(null);
  /** Frames picked on the board with the select tool (a dragged box), deleted together with Backspace/Delete. */
  const [pickedFrames, setPickedFrames] = useState<FrameId[]>([]);
  const [handleErrors, setHandleErrors] = useState<Record<string, { code: string; message: string }>>({});
  // An edit an instance could not take, waiting for detach / the master.
  const [detachPrompt, setDetachPrompt] = useState<DetachPrompt | null>(null);
  // A change the studio asks about first (e.g. adding sliders for hard-coded values), and how to answer it.
  const [confirmAsk, setConfirmAsk] = useState<{ prompt: ConfirmPrompt; answer: (answer: ConfirmAnswer) => void } | null>(null);
  const [color, setColor] = useState("#75664e"), [width, setWidth] = useState(3), [opacity, setOpacity] = useState(80);
  const [workspace, setWorkspace] = useState<WorkspaceLayout>(() => workspaceSchema.parse({}));
  const workspaceCanvas = useRef<WorkspaceHandle>(null);
  const [pendingFrameFocus, setPendingFrameFocus] = useState<FrameId | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const resultPreviews = useRef(new Map<string, CodePreviewHandle>());
  // The Compose prompt's tags on the sketch (what the AI read: objects, collections and what goes into them).
  const [showComposeTags, setShowComposeTagsState] = useState(true);
  useEffect(() => { try { setShowComposeTagsState(localStorage.getItem("rulegen:compose-tags") !== "0"); } catch { /* storage unavailable */ } }, []);
  // Pictures of minimal example frames shown in compose tag cards (taken from their running result when a card opens).
  const [exampleThumbs, setExampleThumbs] = useState<Record<string, string>>({});
  // The tag whose card is open in each frame, and the tag pointed at in the Compose panel's tag tree.
  const [openTags, setOpenTags] = useState<Record<string, string | null>>({}), [pointedTag, setPointedTag] = useState<{ frameId: string; id: string } | null>(null);
  // The clarification's in-situ drawings of the active frame, and the choice option pointed at in its panel: that one is
  // drawn over the frame (or else the option last picked that has a drawing).
  const clarifyDrawings = useClarifyDrawings(panel.sketchClarify);
  const [clarifyPoint, setClarifyPoint] = useState<{ questionId: string; optionId: string } | null>(null);
  const clarifyShown = (() => {
    const stage = panel.sketchClarify?.stages.at(-1);
    if (!stage) return null;
    const found = (questionId: string, optionId: string | undefined) => {
      const option = stage.questions.find(item => item.id === questionId)?.options.find(item => item.id === optionId), drawing = clarifyDrawings[drawingKey(questionId, optionId ?? "")];
      return option && drawing?.src ? { label: option.label, logic: option.logic, drawing } : null;
    };
    return (clarifyPoint && found(clarifyPoint.questionId, clarifyPoint.optionId))
      ?? stage.questions.map(question => found(question.id, stage.answers[question.id]?.choice)).filter(Boolean).at(-1) ?? null;
  })();
  // Constraints moved between a frame's tags (from the card or the tag tree): its tag cards start over, as what they keep goes by place.
  const [tagMoves, setTagMoves] = useState<Record<string, number>>({});
  // The constraint picked in Layers, shown in the inspector.
  const [layerConstraint, setLayerConstraint] = useState<{ frameId: string; nodeId: string; constraintId: string } | null>(null);
  // Studio-wide clipboard for a constraint copied in Layers (paste into any layer of any sketch).
  const [constraintClip, setConstraintClip] = useState<ConstraintClip | null>(null);
  /** The Layers pick in this frame, while its layer is still the selected one. */
  const layerPick = (frameId: string) => layerConstraint?.frameId === frameId && panelsRef.current[frameId]?.selectedNodeIds[0] === layerConstraint.nodeId ? layerConstraint : null;
  // Extract / Compose clarify the sketch with the user first (progressive questions in the right panel).
  const [clarifyFirst, setClarifyFirstState] = useState(true);
  useEffect(() => { try { setClarifyFirstState(localStorage.getItem("rulegen:clarify-first") !== "0"); } catch { /* storage unavailable */ } }, []);
  const setClarifyFirst = (on: boolean) => { setClarifyFirstState(on); try { localStorage.setItem("rulegen:clarify-first", on ? "1" : "0"); } catch { /* storage unavailable */ } };
  const setShowComposeTags = (on: boolean) => { setShowComposeTagsState(on); try { localStorage.setItem("rulegen:compose-tags", on ? "1" : "0"); } catch { /* storage unavailable */ } };
  const [penSettingsOpen, setPenSettingsOpen] = useState(false);
  // Right panel width chosen by dragging its edge (null = responsive default); remembered per browser.
  const inspectorPanel = useRef<HTMLElement>(null), layerPanel = useRef<HTMLElement>(null);
  const [inspectorWidth, setInspectorWidth] = useState<number | null>(null);
  const [layerWidth, setLayerWidth] = useState<number | null>(null);
  const [semanticPens, setSemanticPens] = useState<SemanticPen[]>([]), [activeSemanticPenId, setActiveSemanticPenId] = useState<string | null>(null);
  const [interactionPen, setInteractionPen] = useState<SemanticPen>(createInteractionPen);
  const drawingPens = [interactionPen, ...semanticPens];
  const activeSemanticPen = drawingPens.find(pen => pen.id === activeSemanticPenId);
  const [toast, setToast] = useState(""), [model, setModel] = useState(""), [configured, setConfigured] = useState<boolean | null>(null);
  const [restoreReady, setRestoreReady] = useState(false), [saveState, setSaveState] = useState("Local draft");
  /** The frame whose JSON (state machines, params, code) is shown to copy. */
  const [frameJson, setFrameJson] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false), [modal, setModal] = useState(false), [exportOpen, setExportOpen] = useState(false), [newName, setNewName] = useState("");
  const upload = useRef<HTMLInputElement>(null), importInput = useRef<HTMLInputElement>(null), inspector = useRef<HTMLDivElement>(null);
  // AI work is per frame: each frame has its own request in flight, abort controller and request number, so switching frames never cuts another frame's generation.
  const aborts = useRef(new Map<string, AbortController>()), requestNumbers = useRef(new Map<string, number>()), activeDocument = useRef(0), prepareNumber = useRef(0);

  // ── Derived view of the active sketch ──────────────────────────────────────
  const { scene, generated, annotating } = panel;
  const annotations = panel.annotationHistory.present;
  const busy = Boolean(panel.loading);
  const artworkOf = (id: string) => id === "source" ? artworkRef.current : sketchFramesRef.current.find(frame => frame.id === id)?.artwork;
  const currentSketch = activeSketch === "source" ? artwork : sketchFrames.find(f => f.id === activeSketch)?.artwork || artwork;
  const currentSelection = activeSketch === "source" ? hasSelection : Boolean(sketchSelections[activeSketch]);
  const sourcePresent = Boolean(currentSketch.photo || currentSketch.strokes.length);
  // A derived frame is stale when the sketch it was extracted from has changed since.
  const sourceSketch = panel.sourceFrameId ? artworkOf(panel.sourceFrameId) : undefined;
  const stale = scene.nodes.length > 0 && (sourceSketch ? panel.analysisRevision !== sourceSketch.revision : !panel.sourceFrameId && panel.analysisRevision >= 0 && panel.analysisRevision !== currentSketch.revision);
  const liveSource = liveSceneSource(generated, scene);
  const liveStatus = sceneLiveStatus(generated, scene);
  const node = inspectedNode(panel);
  const nodeState = editingState(panel, node);
  const machineNode = node || scene.nodes.find(item => item.machine);
  const nodeRole = node ? brushRole(scene, activeSketch, node.id, brushes) : null;
  const proposalStale = Boolean(panel.revisionProposal && panel.revisionProposal.snapshot !== revisionSnapshot(panel));
  const proposalChanges = panel.revisionProposal ? sceneChanges(scene, panel.revisionProposal.proposal.scene) : [];

  // ── Server requests ────────────────────────────────────────────────────────
  function projectData() {
    return { version: 2 as const, name: artwork.name, artwork: artworkRef.current, sketchFrames: sketchFramesRef.current, activeSketchId: activeSketchRef.current,
      sketchPanels: savedSketchPanels(panelsRef.current), semanticPens, interactionPen, activeSemanticPenId, brushes: brushesRef.current, proxyFrames: proxyFramesRef.current, workspace };
  }
  async function request(intent: string, body: object, owner = activeSketch) {
    updatePanel(owner, { error: "" });
    const controller = new AbortController(); aborts.current.set(owner, controller);
    const ownerPanel = panelsRef.current[owner] || createSketchPanel();
    const recoveryContext = { project: { ...projectData(), activeSketchId: owner }, owner,
      region: (body as { recoveryRegion?: { x: number; y: number; w: number; h: number } }).recoveryRegion,
      annotations: ownerPanel.annotationHistory.present, annotationImage: ownerPanel.annotationImage, revisionInstruction: ownerPanel.revisionInstruction, proposal: ownerPanel.revisionProposal?.proposal || null };
    const response = await fetch("/api/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ intent, ...body, recoveryContext }), signal: controller.signal });
    const result = await response.json();
    if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
    if (aborts.current.get(owner) === controller) aborts.current.delete(owner);
    if (!response.ok || result.error) { if (result.logged) markLogged(result.error); throw new Error(result.error || "Could not process the request."); }
    return result;
  }
  async function task(label: string, work: () => Promise<void>, owner = activeSketch) {
    if (panelsRef.current[owner]?.loading) return;
    const number = (requestNumbers.current.get(owner) ?? 0) + 1; requestNumbers.current.set(owner, number); updatePanel(owner, { loading: label, error: "" });
    const current = () => number === requestNumbers.current.get(owner);
    try { await work(); } catch (e) { if (current() && !(e instanceof DOMException && e.name === "AbortError")) updatePanel(owner, { error: e instanceof Error ? e.message : "Something went wrong while processing." }); }
    finally { if (current() && panelsRef.current[owner]) updatePanel(owner, { loading: "" }); }
  }
  /** Stop one frame's AI work (the active frame's by default). */
  function cancel(owner = activeSketchRef.current) {
    requestNumbers.current.set(owner, (requestNumbers.current.get(owner) ?? 0) + 1);
    aborts.current.get(owner)?.abort(); aborts.current.delete(owner);
    if (panelsRef.current[owner]?.loading) updatePanel(owner, { loading: "" });
  }
  /** Stop every frame's AI work (a project is opened, replaced or closed). */
  function cancelAll() { for (const owner of new Set([...aborts.current.keys(), ...Object.keys(panelsRef.current)])) cancel(owner); }
  const canvasFor = (id: string) => id === "source" ? canvas.current : sketchCanvases.current.get(id);
  function addPen(make: (id: string, color: string) => SemanticPen) {
    if (semanticPens.length >= 32) { patchActive({ error: "The toolbar is full of pens. Remove pens you are not using." }); return; }
    const pen = make(crypto.randomUUID(), semanticPenColors.find(c => !semanticPens.some(p => p.color === c)) || semanticPenColors[semanticPens.length % semanticPenColors.length]);
    const baseName = pen.name.slice(0, 90); let name = baseName, suffix = 2;
    while (semanticPens.some(item => item.name === name)) name = `${baseName} ${suffix++}`;
    const next = { ...pen, name };
    setSemanticPens(current => [...current, next]); selectDrawingPen(next);
    setToast(`Added ${name} to the toolbar. Draw freely, then combine with Compose prompt.`);
  }
  /** A new sketch frame placed beside `fromId` (used for extracted/composed scenes). */
  function createFrame(fromId: string, name: string, marks?: Pick<Artwork, "strokes" | "photo">): string | null {
    if (sketchFramesRef.current.length >= MAX_SKETCH_FRAMES) return null;
    const id: FrameId = `sketch-${crypto.randomUUID()}`;
    const frames = [...sketchFramesRef.current, { id, artwork: { ...blank(), ...(marks ? { strokes: marks.strokes, photo: marks.photo } : {}), name: name.slice(0, 200) } }];
    sketchFramesRef.current = frames; setSketchFrames(frames);
    setWorkspace(current => ({ ...current, frames: { ...current.frames, [id]: besideFramePosition(current.frames, fromId) } }));
    setSketchHistories(current => ({ ...current, [id]: { past: [], future: [] } }));
    mutatePanels(current => ({ ...current, [id]: createSketchPanel() }));
    return id;
  }
  /** What a frame shows: its rendered result (if any) under its strokes, as one image. */
  /** A frame created a moment ago mounts and loads p5 first, so wait (up to ~8s) until its canvas can be captured. */
  async function readyCanvas(owner: string, full: boolean) {
    const notReady = /canvas to be ready|photo is still loading/;
    for (let attempt = 0; ; attempt++) {
      const handle = canvasFor(owner);
      try { if (handle) return { handle, plain: handle.capture(full) }; }
      catch (error) { if (!(error instanceof Error && notReady.test(error.message)) || attempt >= 80) throw error; }
      if (!handle && attempt >= 80) throw new Error("Wait a moment for the canvas to be ready.");
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  async function captureFrame(owner: string, full = false) {
    const { handle, plain } = await readyCanvas(owner, full);
    const render = panelsRef.current[owner]?.generated ? resultPreviews.current.get(owner)?.capture() : "";
    if (!render) return plain;
    const sketch = handle.capture(full, true), region = sketch.region;
    const load = async (src: string) => { const image = new Image(); image.src = src; await image.decode(); return image; };
    const [under, over] = await Promise.all([load(render), load(sketch.image)]);
    const canvas = document.createElement("canvas"); canvas.width = over.width; canvas.height = over.height;
    const ctx = canvas.getContext("2d")!; ctx.fillStyle = "#fffefa"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(under, region.x * under.width, region.y * under.height, region.w * under.width, region.h * under.height, 0, 0, canvas.width, canvas.height);
    ctx.drawImage(over, 0, 0);
    return { image: canvas.toDataURL("image/png"), region };
  }
  const deps: StudioDeps = {
    panel: id => panelsRef.current[id] || createSketchPanel(), updatePanel, request, task,
    capture: captureFrame, createFrame,
    fork: fromId => {
      const art = artworkOf(fromId), panel = panelsRef.current[fromId];
      if (!art || !panel?.generated) return null;
      const id = createFrame(fromId, `${art.name || "Frame"} · temporary fork`, { strokes: art.strokes, photo: art.photo });
      if (!id) return null;
      // The same sketch, scene, result and input, as the saved project would hold them.
      // Not a part of the decomposition itself (its change goes to the original when kept, which asks then).
      mutatePanels(current => ({ ...current, [id]: { ...createSketchPanel(savedSketchPanels({ [fromId]: panel })[fromId]), sourceFrameId: fromId, exampleOf: null, propagationBase: null } }));
      return id;
    },
    removeFrame: id => { if (artworkOf(id)) deleteFrame(id as FrameId); },
    clarifyFirst: () => clarifyFirst,
    addBrushes: (frameId, scene) => {
      const made = brushesFor(scene, frameId, brushesRef.current, () => crypto.randomUUID());
      if (made.length) { setBrushes([...brushesRef.current, ...made]); setToast(`Added brushes to the toolbar: ${made.map(brush => brush.name).join(", ")}.`); }
      return made;
    },
    openProxy: (owner, nodeId) => openProxy(owner, nodeId),
    confirm: prompt => new Promise<ConfirmAnswer>(resolve => setConfirmAsk(current => { current?.answer(false); return { prompt, answer: resolve }; })),
    addSubBrush: (owner, nodeId, frameId, scene, name) => {
      const ownerScene = panelsRef.current[owner]?.scene;
      // Inside the tool group of the brush the node comes from (its group, if that brush is a sub brush itself).
      const parent = ownerScene ? sourceBrushGroup(ownerScene, owner, nodeId, brushesRef.current) : undefined;
      // Only inside a brush: a node that belongs to none (e.g. a still background) gets no brush of its own.
      if (!parent) return null;
      const made = subBrushFor(scene, frameId, name, parent, brushesRef.current, crypto.randomUUID());
      if (made) setBrushes([...brushesRef.current, made]);
      return made;
    },
    brushesOf: frameId => brushesRef.current.filter(brush => brush.sourceFrameId === frameId),
    preview: owner => resultPreviews.current.get(owner),
    refreshBrushCode: (frameId, code) => {
      const scene = panelsRef.current[frameId]?.scene, modules = programModules(code);
      let changed = false;
      const next = brushesRef.current.map(brush => {
        const root = brush.sourceFrameId === frameId && scene ? scene.nodes.find(node => node.id === brush.nodeId) : undefined;
        const text = root && modules.get(root.codeModule ?? root.id);
        if (!text || text === brush.code) return brush;
        changed = true; return { ...brush, code: text };
      });
      if (changed) setBrushes(next);
    },
    artwork: artworkOf, documentId: () => activeDocument.current, requestId: owner => requestNumbers.current.get(owner) ?? 0,
    toast: setToast, focus: setPendingFrameFocus, addPen,
    activate: id => activateSketch(id), active: () => activeSketchRef.current,
  };
  // Execution inspection: one frame's running result recorded by cycle, every variable at every step.
  // After a concern is sent, its steps are stepped through in an Execution frame of their own, beside the inspected frame.
  const execution = useExecution(deps, frameId => {
    const id = execFrameId(frameId);
    setWorkspace(current => current.frames[id] ? current : { ...current, frames: { ...current.frames, [id]: besideFramePosition(current.frames, frameId) } });
    setPendingFrameFocus(id);
  }, analyzed => manipulationStart.current?.(analyzed));
  // Direct manipulation in the Execution frame: tools made for the concern, what they show measured into its variables.
  const manipulation = useManipulation(deps, execution);
  // Tools kept with frames (from kept forks): used on the frame itself, offered as sub tools of its brush.
  const kept = useKeptTools(deps);
  // What was shown with the tools made the brush's own rule (the rule it means picked from previews).
  const generalize = useGeneralize(deps);
  // A fork's question goes with the fork session.
  useEffect(() => { const open = generalize.view; if (open?.kind === "fork" && manipulation.view?.fork !== open.from) generalize.close(); }, [manipulation.view?.fork, generalize.view?.from]);
  const generalizePanel = (open: GeneralizeView) => <GeneralizePanel view={open} onChoose={id => { void generalize.choose(id); }} onRetry={generalize.retry} onClose={generalize.close} />;
  /** Under a frame: what goes there, and the rule question of what was shown on it (if open). */
  const withGeneralize = (id: string, below: React.ReactNode) => generalize.view?.from === id ? <>{below}{generalizePanel(generalize.view)}</> : below;
  // A part frame of a decomposition is in step with the frames above once it has a result; what changes in it on its
  // own after that (values, constraints, code, kept tools) is offered to pass up (below the frame).
  useEffect(() => { for (const [id, panel] of Object.entries(panels)) if (panel.exampleOf && panel.generated && !panel.propagationBase && !panel.loading) settle(deps, id); }, [panels]);
  const [propagating, setPropagating] = useState<string | null>(null);
  const propagationPanel = (id: string) => {
    const panel = panels[id], changes = changesOf(panel);
    if (!panel || !changes || (panel.loading && propagating !== id)) return undefined;
    const ancestors = ancestorsOf(deps, id).map(frame => ({ id: frame, name: artworkOf(frame)?.name || "Frame" }));
    if (!ancestors.length) return undefined;
    return <PropagatePanel key={`${id}-${JSON.stringify(panel.propagationBase).length}`} changes={changes} ancestors={ancestors} busy={propagating !== null}
      tools={panel.keptTools.filter(set => changes.tools.includes(set.id)).map(set => set.concern)}
      onKeep={() => settle(deps, id)} onShow={frame => setPendingFrameFocus(frame as FrameId)}
      onPropagate={targets => { setPropagating(id); void propagate(deps, id, targets).finally(() => setPropagating(null)); }} />;
  };
  // Another tool taken (anything but select) puts a kept tool away.
  useEffect(() => { if (tool !== "select") kept.stop(); }, [tool]);
  const manipulationStart = useRef<((analyzed: Analyzed) => void) | null>(null);
  manipulationStart.current = manipulation.start;
  // Thumbnails of the inspected frame's recorded steps (in the Execution panel), drawn by its own code.
  const inspected = execution.view ? panels[execution.view.frameId] : undefined, inspectedTrace = execution.view?.trace;
  const inspectedExecutable = useMemo(() => inspected?.executable ? syncScene(inspected.executable, inspected.scene) : "", [inspected?.executable, inspected?.scene]);
  const restoreStep = useCallback((step: ExecStep) => inspectedTrace ? restorePoint(inspectedTrace, step) : null, [inspectedTrace]);
  const stepThumbnails = useMemo(() => inspectedExecutable ? { executable: inspectedExecutable, restoreOf: restoreStep } : undefined, [inspectedExecutable, restoreStep]);
  /** Fork mode: the temporary fork the tools act on live (their strokes over it, the panel below it). */
  const liveFork = manipulation.view?.mode === "fork" ? manipulation.view.fork : null;
  const manipLayer = (manip: ManipView) => <ManipLayer strokes={manip.strokes} hidden={manip.marksHidden} tool={manip.tool} selected={manip.selected} onAdd={manipulation.add} onChange={manipulation.change} onSelect={manipulation.select} probes={manip.probes} onProbe={manipulation.probe}  marks={manip.draft?.marks} onMark={manipulation.addMark} />;
  const manipPanel = (manip: ManipView) => <ManipPanel view={manip} rows={manipulation.rows} onBegin={manipulation.begin} onChoose={id => { const rule = manip.asked?.rules.find(item => item.id === id); if (rule) manipulation.choose(rule); }}
    onRechoose={manipulation.rechoose} onTool={manipulation.setTool} onClearProbes={manipulation.clearProbes} onRemove={manipulation.remove} onClear={manipulation.clear} onToggleMarks={manipulation.toggleMarks} onApply={() => { void manipulation.apply(); }} onTryFork={() => { void manipulation.tryOnFork(); }} onKeepFork={manipulation.keepFork} onDiscardFork={manipulation.discardFork}
    onShowFork={() => { if (manip.fork) setPendingFrameFocus(manip.fork as FrameId); }} onShowOriginal={() => setPendingFrameFocus(manip.frameId as FrameId)} onRetry={manipulation.retry}
    forkError={manip.mode === "fork" && manip.fork && manip.live === "ready" ? panels[manip.fork]?.runtimeError ?? "" : ""} onRegenerate={manipulation.regenerate}
    feedback={{ open: manipulation.openFeedback, text: manipulation.draftText, clearMarks: manipulation.clearMarks, submit: () => { void manipulation.submitFeedback(); }, cancel: manipulation.cancelFeedback }}
    onGeneralize={() => { const source = manipulation.generalizeSource(); if (source) generalize.start(source, manipulation.close); }} generalizing={Boolean(manip.fork && generalize.view?.from === manip.fork)} />;
  // An Execution frame is on the board only while its inspection has one.
  useEffect(() => {
    const keep = execution.view?.framed ? execFrameId(execution.view.frameId) : null;
    setWorkspace(current => { const stale = Object.keys(current.frames).filter(id => isExecFrame(id) && id !== keep); if (!stale.length) return current;
      const frames = { ...current.frames }; for (const id of stale) delete frames[id]; return { ...current, frames }; });
  }, [execution.view?.framed, execution.view?.frameId]);
  // The inspection annotation tool draws only on an inspected frame.
  useEffect(() => { if (!execution.view && tool === "inspect-mark") setTool("select"); }, [execution.view, tool]);
  const edits = sceneEdits(deps, activeSketch), ai = sceneAI(deps, activeSketch), revisions = revisionActions(deps, activeSketch);

  // The tools on a temporary fork survive a reload: once the project is back, the session comes back with it (when its
  // frames are still there); then it is saved as it changes.
  const manipulationResumed = useRef(false);
  useEffect(() => {
    if (!restoreReady || manipulationResumed.current) return;
    manipulationResumed.current = true;
    let saved: ManipSaved | null = null;
    try { const raw = localStorage.getItem(manipulationKey); saved = raw ? JSON.parse(raw) as ManipSaved : null; } catch { saved = null; }
    if (!saved || typeof saved.frameId !== "string" || typeof saved.fork !== "string") return;
    if (!artworkOf(saved.frameId) || !artworkOf(saved.fork) || !panelsRef.current[saved.frameId]?.generated) { try { localStorage.removeItem(manipulationKey); } catch { /* storage unavailable */ } return; }
    manipulation.resume(saved);
  }, [restoreReady]);
  useEffect(() => {
    if (!manipulationResumed.current) return;
    const timer = setTimeout(() => {
      try { const saved = manipulation.snapshot(); if (saved) localStorage.setItem(manipulationKey, JSON.stringify(saved)); else localStorage.removeItem(manipulationKey); }
      catch { /* storage full or unavailable: the session is only lost on reload */ }
    }, 400);
    return () => clearTimeout(timer);
  }, [manipulation.view]);
  /** Tools made before (from AI history) used again on a new temporary fork of their frame, without AI. */
  async function reuseTools(tools: SavedTools) {
    if (!artworkOf(tools.owner) || !panelsRef.current[tools.owner]?.generated) { setToast("The frame these tools were made for is not on the board (or has no result)."); return; }
    setHistoryOpen(false);
    execution.ensure(tools.owner, tools.concern);
    let picture = "";
    try { picture = (await captureFrame(tools.owner, true)).image; } catch { /* thumbnails go without the faded picture */ }
    manipulation.start({ frameId: tools.owner, concern: tools.concern, picture, image: picture, marks: tools.marks, analysis: null, cycleIds: [] }, { clarify: tools.clarify, choice: tools.choice });
    setPendingFrameFocus(tools.owner as FrameId);
  }

  // ── Persistence and effects ────────────────────────────────────────────────
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey); if (raw) { const result = projectSchema.safeParse(JSON.parse(raw)); if (result.success) restore(result.data); else setToast("The saved project format has changed, so a new workspace was opened."); }
    } catch { setToast("Could not load the local project. If you have a JSON file, you can import it."); }
    setRestoreReady(true);
    fetch("/api/generate").then(r => r.json()).then(data => { setConfigured(data.configured); setModel(data.model); }).catch(() => setConfigured(false));
    return () => { for (const controller of aborts.current.values()) controller.abort(); };
  }, []);
  useEffect(() => {
    if (!restoreReady) return;
    setSaveState("Saving…");
    const timer = setTimeout(() => { try { localStorage.setItem(storageKey, JSON.stringify(projectData())); setSaveState("Saved locally"); } catch { setSaveState("Storage full · export JSON"); } }, 450);
    return () => clearTimeout(timer);
  }, [artwork, sketchFrames, activeSketch, panels, semanticPens, interactionPen, activeSemanticPenId, brushes, workspace, restoreReady]);
  useEffect(() => { try { const saved = Number(localStorage.getItem("rulegen-inspector-width")); if (saved >= 280 && saved <= 900) setInspectorWidth(saved); } catch { /* storage unavailable */ } }, []);
  useEffect(() => { try { if (inspectorWidth) localStorage.setItem("rulegen-inspector-width", String(inspectorWidth)); else localStorage.removeItem("rulegen-inspector-width"); } catch { /* storage unavailable */ } }, [inspectorWidth]);
  useEffect(() => { try { const saved = Number(localStorage.getItem("rulegen-layer-width")); if (saved >= LAYER_MIN_WIDTH && saved <= LAYER_MAX_WIDTH) setLayerWidth(saved); } catch { /* storage unavailable */ } }, []);
  useEffect(() => { try { if (layerWidth) localStorage.setItem("rulegen-layer-width", String(layerWidth)); else localStorage.removeItem("rulegen-layer-width"); } catch { /* storage unavailable */ } }, [layerWidth]);
  // Every error a frame shows is written to error-logs/ (runtime errors with the failing program).
  const reportedErrors = useRef(new Map<string, string>());
  useEffect(() => {
    for (const [id, item] of Object.entries(panels)) for (const [field, source] of [["error", "ui"], ["runtimeError", "runtime"]] as const) {
      const key = `${id}:${field}`, message = item[field];
      if (message === reportedErrors.current.get(key)) continue;
      reportedErrors.current.set(key, message);
      if (message) reportError({ source, message, owner: id, frame: artworkOf(id)?.name || id, code: source === "runtime" ? item.generated?.code || "" : "" });
    }
  }, [panels]);
  useEffect(() => { if (brushPick && !activeBrush) setTool("pen"); }, [brushPick?.brushId, activeBrush]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(""), 6000); return () => clearTimeout(timer); }, [toast]);
  // Widget edits only patch the host block of the code draft.
  useEffect(() => { if (generated) patchActive(previous => { const codeDraft = syncScene(previous.codeDraft || "", previous.scene); return codeDraft === previous.codeDraft ? {} : { codeDraft, runtimeError: "" }; }); }, [scene, generated]);
  useEffect(() => { inspector.current?.scrollTo({ top: 0 }); }, [node?.id, activeSketch, panel.sketchClarify?.mode, panel.sketchClarify?.stages.length]);
  useEffect(() => { if (pendingFrameFocus) { workspaceCanvas.current?.focus(pendingFrameFocus); setPendingFrameFocus(null); } }, [pendingFrameFocus, sketchFrames, panels]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (historyOpen || modal || exportOpen || (e.target as HTMLElement).closest("input,textarea,select,[contenteditable]")) return;
      const command = e.metaKey || e.ctrlKey, key = e.key.toLowerCase();
      // Playing with a brush: the frame only takes input for its running result; Esc puts the brush down.
      if (interactingIn(activeSketch, panel)) { if (e.key === "Escape") chooseTool("select"); return; }
      if (e.key === "Escape") { setPickedFrames([]); setOpenGroup(null); setPencilOpen(false); setPenSettingsOpen(false); canvas.current?.clearSelection(); setModal(false); setExportOpen(false); setHistoryOpen(false); setFrameJson(null); if (tool === "select") edits.select(null); }
      if (command && key === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      else if (command && key === "y") { e.preventDefault(); redo(); }
      else if (command && key === "c" && layerPick(activeSketch) && !window.getSelection()?.toString()) { e.preventDefault(); copyLayerConstraint(layerPick(activeSketch)!.nodeId, layerPick(activeSketch)!.constraintId); }
      else if (command && key === "g" && tool === "select") { e.preventDefault(); if (e.shiftKey) { if (node?.kind === "collection") edits.ungroup(node.id); } else edits.group(); }
      else if (tool === "select" && pickedFrames.length && (e.key === "Delete" || e.key === "Backspace")) { e.preventDefault(); deleteFrames(pickedFrames); }
      else if (tool === "select" && panel.selectedNodeIds.length && (e.key === "Delete" || e.key === "Backspace")) { e.preventDefault(); edits.remove(); }
      else if (tool === "select" && panel.selectedNodeIds.length && e.key.startsWith("Arrow")) { e.preventDefault(); const step = e.shiftKey ? 10 : 1; edits.nudge((e.key === "ArrowRight" ? step : e.key === "ArrowLeft" ? -step : 0) / 900, (e.key === "ArrowDown" ? step : e.key === "ArrowUp" ? -step : 0) / 600); }
      else if (!(command || e.altKey)) { if (key === "v") chooseTool("select"); if (key === "a") chooseTool("adjust"); if (key === "p") chooseTool("pen"); if (key === "e") chooseTool("eraser"); if (key === "l") chooseTool("lasso"); if (key === "h") chooseTool("hand"); }
    };
    window.addEventListener("keydown", onKey); window.addEventListener("paste", pastePhoto);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("paste", pastePhoto); };
  });

  // ── Project lifecycle ──────────────────────────────────────────────────────
  function restore(data: ReturnType<typeof projectSchema.parse>) {
    activeDocument.current++; cancelAll(); prepareNumber.current++;
    setArtwork(data.artwork); artworkRef.current = data.artwork; setSketchFrames(data.sketchFrames); sketchFramesRef.current = data.sketchFrames;
    mutatePanels(() => Object.fromEntries(Object.entries(data.sketchPanels).map(([id, saved]) => [id, createSketchPanel(saved)])));
    setActiveSketch(data.activeSketchId); activeSketchRef.current = data.activeSketchId;
    setSketchHistories({}); setSketchSelections({}); setWorkspace(data.workspace); setSemanticPens(data.semanticPens); setInteractionPen(data.interactionPen); setActiveSemanticPenId(data.activeSemanticPenId); setPenSettingsOpen(false);
    setBrushes(data.brushes); setOpenGroup(null); setProxyFrames(data.proxyFrames); proxyFramesRef.current = data.proxyFrames; setHandleErrors({});
    setHistory([]); setFuture([]); canvas.current?.clearSelection();
  }
  function newProject() {
    cancelAll(); activeDocument.current++; prepareNumber.current++;
    const nextArtwork = { ...blank(), name: newName.trim() || "Untitled exploration" };
    mutatePanels(() => ({ source: createSketchPanel() })); setActiveSketch("source"); activeSketchRef.current = "source"; setBrushes([]); setOpenGroup(null); setProxyFrames([]); proxyFramesRef.current = []; setHandleErrors({});
    setSketchFrames([]); sketchFramesRef.current = []; setSketchHistories({}); setSketchSelections({});
    setWorkspace(workspaceSchema.parse({})); setArtwork(nextArtwork); artworkRef.current = nextArtwork;
    setTool("pen"); setPencilOpen(false); setActiveSemanticPenId(null); setPenSettingsOpen(false); setHistory([]); setFuture([]); setModal(false); canvas.current?.clearSelection();
  }
  function restoreAIHistory(data: RecoveredGeneration) {
    restore(data.project);
    const saved = data.project.sketchPanels[data.owner];
    const restored = { ...createSketchPanel(saved), annotationHistory: { past: [], present: data.annotations, future: [] }, annotationImage: data.annotationImage, revisionInstruction: data.revisionInstruction };
    updatePanel(data.owner, { annotationHistory: restored.annotationHistory, annotationImage: data.annotationImage, annotationSource: liveSceneSource(restored.generated, restored.scene),
      annotating: Boolean(data.annotationImage && data.annotations.length && restored.generated), clarifying: Boolean(data.revisionInstruction), revisionInstruction: data.revisionInstruction,
      clarificationContext: revisionSnapshot(restored, ""), revisionProposal: data.proposal ? { proposal: data.proposal, snapshot: revisionSnapshot(restored) } : null });
    // The board comes back as it was then: frame positions and the view (camera). Only a log without a view focuses the frame.
    setHistoryOpen(false); if (!data.project.workspace.camera) setPendingFrameFocus(data.owner as FrameId);
    setToast("Restored the AI generation history.");
  }

  // ── Frames and drawing history ─────────────────────────────────────────────
  function activateSketch(id: string) {
    if (id === activeSketchRef.current) return;
    // The frame being left keeps its AI work running; only its hover is cleared.
    prepareNumber.current++;
    updatePanel(activeSketchRef.current, { hovered: null });
    mutatePanels(current => current[id] ? current : { ...current, [id]: createSketchPanel() });
    activeSketchRef.current = id; setActiveSketch(id);
  }
  function addSketchFrame() {
    if (busy) return;
    if (workspace.hiddenFrames.includes("source")) {
      setWorkspace(current => showWorkspaceFrame(current, "source"));
      activateSketch("source"); setTool("pen"); setPencilOpen(false); setPenSettingsOpen(false); setPendingFrameFocus("source");
      return;
    }
    if (sketchFrames.length >= MAX_SKETCH_FRAMES) return;
    const id: FrameId = `sketch-${crypto.randomUUID()}`;
    setSketchFrames(current => [...current, { id, artwork: { ...blank(), name: `Sketch ${current.length + 2}` } }]);
    setWorkspace(current => ({ ...current, frames: { ...current.frames, [id]: nextSketchPosition(current.frames) } }));
    setSketchHistories(current => ({ ...current, [id]: { past: [], future: [] } }));
    activateSketch(id); setTool("pen"); setPencilOpen(false); setPenSettingsOpen(false); setPendingFrameFocus(id);
  }
  /**
   * Show a node's proxy frames: one per constraint with handles (each the whole frame), kept together in one
   * frame group beside its frame; new ones are added, hidden ones shown again. A node with no handles yet gets one
   * frame to design them from (it goes once there are constraint frames, which take its spot).
   */
  function openProxy(targetFrameId: string, nodeId: string, focus = true) {
    const node = panelsRef.current[targetFrameId] && findNode(panelsRef.current[targetFrameId].scene, nodeId);
    const withWidgets = node ? proxyGroups(node.constraints).map(group => group.constraint.id) : [];
    const plan = planProxyFrames(proxyFramesRef.current, targetFrameId, nodeId, withWidgets, () => `proxy-${crypto.randomUUID()}`);
    if (plan.left) setToast(`You can have up to ${MAX_PROXY_FRAMES} proxy frames; ${plan.left} could not be opened. Delete the ones you are not using.`);
    proxyFramesRef.current = plan.frames; setProxyFrames(plan.frames);
    const members = plan.mine.map(frame => frame.id);
    setWorkspace(current => placeProxyGroup(current, plan, targetFrameId, `◎ ${node?.name || nodeId} · proxy`, () => `group-${crypto.randomUUID()}`));
    if (focus && members[0]) setPendingFrameFocus(members[0] as FrameId);
  }
  /** Take proxy frames off the board (or put them back); their handles and spots are kept. */
  function hideProxies(ids: string[], hide: boolean) {
    const frames = proxyFramesRef.current.map(frame => ids.includes(frame.id) ? { ...frame, hidden: hide } : frame);
    proxyFramesRef.current = frames; setProxyFrames(frames);
  }
  /** Clicking a proxy frame works on its node: its frame becomes active with the node selected. */
  function activateFrame(id: string) {
    if (isExecFrame(id)) { activateSketch(id.slice("exec-".length)); return; }
    if (!isProxyFrame(id)) { activateSketch(id); return; }
    const proxy = proxyFramesRef.current.find(frame => frame.id === id); if (!proxy) return;
    activateSketch(proxy.targetFrameId);
    if (findNode(panelsRef.current[proxy.targetFrameId]?.scene ?? { nodes: [] }, proxy.nodeId) && panelsRef.current[proxy.targetFrameId]?.selectedNodeIds.join() !== proxy.nodeId) sceneEdits(deps, proxy.targetFrameId).select(proxy.nodeId);
  }
  /** Delete the frames picked on the board (frames still busy with AI work stay). */
  function deleteFrames(ids: FrameId[]) {
    if (busy) return;
    const kept = ids.filter(id => !isProxyFrame(id) && !isExecFrame(id) && panelsRef.current[id]?.loading);
    for (const id of ids) if (!kept.includes(id)) deleteFrame(id);
    setPickedFrames(kept);
    const gone = ids.length - kept.length;
    setToast(`Deleted ${gone} frame(s).${kept.length ? ` Kept ${kept.length} that AI is working on.` : ""}`);
  }
  function deleteFrame(id: FrameId) {
    if (manipulation.view?.fork === id) manipulation.forkGone(id);
    if (isExecFrame(id)) { execution.unframe(); setWorkspace(current => removeWorkspaceFrame(current, id)); return; }
    if (isProxyFrame(id)) {
      const remaining = proxyFramesRef.current.filter(frame => frame.id !== id);
      proxyFramesRef.current = remaining; setProxyFrames(remaining); setWorkspace(current => removeWorkspaceFrame(current, id));
      setToast("Deleted the proxy frame. The handle stays on the param, so you can open it again.");
      return;
    }
    if (panelsRef.current[id]?.loading) return;
    // The frame it came from (an example's, an extraction's), still on the board: what is shown after it.
    const own = panelsRef.current[id];
    const parent = [own?.exampleOf?.frameId, own?.sourceFrameId].find((frame): frame is string => Boolean(frame && frame !== id && artworkOf(frame)
      && (frame !== "source" || !workspace.hiddenFrames.includes("source"))));
    cancel(id); prepareNumber.current++;
    setPendingFrameFocus(null); setPencilOpen(false); setPenSettingsOpen(false);
    {
      const remaining = sketchFramesRef.current.filter(frame => frame.id !== id);
      sketchFramesRef.current = remaining; setSketchFrames(remaining);
      mutatePanels(current => { const next = { ...current }; if (id === "source") next.source = createSketchPanel(); else delete next[id]; return next; });
      setSketchHistories(current => { const next = { ...current }; delete next[id]; return next; });
      setSketchSelections(current => { const next = { ...current }; delete next[id]; return next; });
      sketchCanvases.current.delete(id); resultPreviews.current.delete(id);
      if (id === "source") { const empty = { ...blank(), name: artworkRef.current.name }; artworkRef.current = empty; setArtwork(empty); setHistory([]); setFuture([]); setHasSelection(false); }
      // Its proxy frames go with it.
      const orphans = proxyFramesRef.current.filter(frame => frame.targetFrameId === id);
      if (orphans.length) { const kept = proxyFramesRef.current.filter(frame => frame.targetFrameId !== id); proxyFramesRef.current = kept; setProxyFrames(kept); }
      setWorkspace(current => orphans.reduce((layout, frame) => removeWorkspaceFrame(layout, frame.id as FrameId), removeWorkspaceFrame(current, id)));
      if (activeSketchRef.current === id) {
        const fallback = parent ?? (id !== "source" && !workspace.hiddenFrames.includes("source") ? "source" : remaining[0]?.id || "source");
        activeSketchRef.current = fallback; setActiveSketch(fallback);
        if (fallback !== "source" || (id !== "source" && !workspace.hiddenFrames.includes("source"))) setPendingFrameFocus(fallback as FrameId);
      }
    }
    setToast(parent ? `Deleted the frame. “${artworkOf(parent)!.name}”, the frame it came from, is unchanged.` : "Deleted the frame.");
  }
  function commit(next: Artwork) { setWorkspace(current => showWorkspaceFrame(current, "source")); const previous = artworkRef.current; const updated = { ...next, revision: previous.revision + 1 }; setHistory(h => [...h.slice(-39), previous]); setFuture([]); artworkRef.current = updated; setArtwork(updated); }
  function commitSketchFrame(id: string, next: Artwork) {
    const previous = sketchFramesRef.current.find(f => f.id === id)?.artwork; if (!previous) return;
    const updated = { ...next, revision: previous.revision + 1 };
    setSketchHistories(current => ({ ...current, [id]: { past: [...(current[id]?.past || []).slice(-39), previous], future: [] } }));
    const frames = sketchFramesRef.current.map(f => f.id === id ? { ...f, artwork: updated } : f);
    sketchFramesRef.current = frames; setSketchFrames(frames);
  }
  const commitFrame = (id: string, next: Artwork) => id === "source" ? commit(next) : commitSketchFrame(id, next);
  function stepSketchFrame(direction: "undo" | "redo") {
    const state = sketchHistories[activeSketch]; const stack = direction === "undo" ? state?.past : state?.future;
    if (!stack?.length) return;
    const target = stack[stack.length - 1];
    setSketchFrames(current => current.map(f => f.id === activeSketch ? { ...f, artwork: target } : f));
    setSketchHistories(current => ({ ...current, [activeSketch]: direction === "undo" ? { past: state.past.slice(0, -1), future: [...state.future, currentSketch] } : { past: [...state.past, currentSketch], future: state.future.slice(0, -1) } }));
  }
  const editAnnotations = (action: Parameters<typeof annotationHistoryReducer>[1]) => patchActive(previous => ({ annotationHistory: annotationHistoryReducer(previous.annotationHistory, action) }));
  function undo() {
    if (annotating) { if (!busy) editAnnotations({ type: "undo" }); return; }
    if (tool === "select" || tool === "adjust") { edits.undo(); return; }
    if (activeSketch !== "source") { stepSketchFrame("undo"); return; }
    if (!history.length) return; setFuture(f => [...f, artwork]); setArtwork(history[history.length - 1]); setHistory(h => h.slice(0, -1));
  }
  function redo() {
    if (annotating) { if (!busy) editAnnotations({ type: "redo" }); return; }
    if (tool === "select" || tool === "adjust") { edits.redo(); return; }
    if (activeSketch !== "source") { stepSketchFrame("redo"); return; }
    if (!future.length) return; setHistory(h => [...h, artwork]); setArtwork(future[future.length - 1]); setFuture(f => f.slice(0, -1));
  }
  const canUndo = annotating ? !busy && panel.annotationHistory.past.length > 0 : tool === "select" || tool === "adjust" ? panel.sceneHistory.length > 0 : activeSketch !== "source" ? Boolean(sketchHistories[activeSketch]?.past.length) : history.length > 0;
  const canRedo = annotating ? !busy && panel.annotationHistory.future.length > 0 : tool === "select" || tool === "adjust" ? panel.sceneFuture.length > 0 : activeSketch !== "source" ? Boolean(sketchHistories[activeSketch]?.future.length) : future.length > 0;
  function clearCanvas() {
    if (annotating) { editAnnotations({ type: "clear" }); return; }
    commitFrame(activeSketch, { ...currentSketch, strokes: [], photo: null });
    canvasFor(activeSketch)?.clearSelection();
  }
  function chooseTool(next: string) {
    setPenSettingsOpen(false); setTool(next);
    if (!parseBrushTool(next)) setOpenGroup(null);
    if (annotating) { setPencilOpen(false); return; }
    setPencilOpen(next === "pen" ? !pencilOpen : false);
  }
  // ── The Brush tool ────────────────────────────────────────────────────────
  // Opening the Brush panel takes a new thumbnail of each brush from its master frame's result (as it is now).
  const brushPanelOpen = openGroup !== null;
  useEffect(() => {
    if (!brushPanelOpen) { setBrushHover(null); return; }
    let cancelled = false;
    void (async () => {
      const made: Record<string, string> = {};
      for (const brush of brushesRef.current) {
        const owner = panelsRef.current[brush.sourceFrameId], node = owner && findNode(owner.scene, brush.nodeId);
        const image = node && owner.generated ? resultPreviews.current.get(brush.sourceFrameId)?.capture() : "";
        const thumbnail = image ? await captureThumbnail(image, node!.region).catch(() => null) : null;
        if (thumbnail && thumbnail !== brush.thumbnail) made[brush.id] = thumbnail;
      }
      if (!cancelled && Object.keys(made).length) setBrushes(brushesRef.current.map(brush => made[brush.id] ? { ...brush, thumbnail: made[brush.id] } : brush));
    })();
    return () => { cancelled = true; };
  }, [brushPanelOpen]);
  /** The tool a brush (its group) remembers, if it still exists; else its Brush tool. */
  function rememberedTool(brushId: string) {
    const remembered = groupTools[brushId], pick = remembered ? parseBrushTool(remembered) : null;
    // The remembered tool may be a sub brush's; it must still exist.
    const owner = pick ? brushesRef.current.find(item => item.id === pick.brushId) : undefined;
    const exists = pick && owner && brushGroup(brushesRef.current, owner.id) === brushId;
    return exists ? remembered! : brushTool("brush", brushId);
  }
  /** Pick a brush in the Brush panel: its remembered tool is selected and the panel shows its tools and options. */
  function clickBrushGroup(brushId: string) {
    const using = brushPick && brushGroup(brushesRef.current, brushPick.brushId) === brushId;
    if (!using) chooseTool(rememberedTool(brushId));
    setLastBrush(brushId); setOpenGroup(brushId);
  }
  /** The Brush tool's button: selects the brush tool (the last brush used) and opens its panel; pressed again, closes it. */
  function toggleBrushPanel() {
    if (openGroup) { setOpenGroup(null); return; }
    const groups = groupBrushes(brushesRef.current), using = brushPick ? brushGroup(brushesRef.current, brushPick.brushId) : null;
    const brushId = using ?? groups.find(item => item.id === lastBrush)?.id ?? groups[0]?.id;
    if (brushId) clickBrushGroup(brushId);
  }
  /** Pick a tool of a brush (or of one of its sub brushes); its group remembers it. */
  function chooseBrushTool(brushId: string, toolId: string) {
    const pick = parseBrushTool(toolId), group = brushGroup(brushesRef.current, pick?.brushId ?? brushId);
    chooseTool(toolId); setGroupTools(current => ({ ...current, [group]: toolId })); setLastBrush(group);
    if (openGroup) setOpenGroup(group);
    const brush = pick?.kind === "brush" ? brushesRef.current.find(item => item.id === pick.brushId) : undefined;
    if (brush) prepareBrushFor(deps, brush, activeSketchRef.current);
  }
  /** Delete a frame group with every frame in it. */
  function deleteGroup(groupId: string) {
    const group = workspace.groups.find(item => item.id === groupId);
    if (!group) return;
    for (const id of group.frames) if (frames.some(frame => frame.id === id)) deleteFrame(id as FrameId);
    setWorkspace(current => ({ ...current, groups: current.groups.filter(item => item.id !== groupId) }));
    setToast(`Deleted the “${group.title}” group and its frames.`);
  }
  /** Remove a brush; a group goes with its sub brushes. */
  function removeBrush(brush: Brush) {
    const gone = new Set([brush.id, ...brushesRef.current.filter(item => item.parentId === brush.id).map(item => item.id)]);
    setBrushes(brushesRef.current.filter(item => !gone.has(item.id)));
    // The Brush panel stays open on another brush (closed when none is left).
    if (!brush.parentId && openGroup === brush.id) setOpenGroup(groupBrushes(brushesRef.current)[0]?.id ?? null);
    if (brushPick && gone.has(brushPick.brushId)) setTool("pen");
  }
  // A brush gesture is fed to the frame's result while the user moves (after placing the brush there if needed).
  const brushDrag = useRef<ReturnType<typeof startBrushGesture>>(null);
  function brushGestureStep(frameId: string, toolId: string, point: { x: number; y: number }, phase: "start" | "move") {
    const pick = parseBrushTool(toolId), brush = pick?.kind === "brush" ? brushesRef.current.find(item => item.id === pick.brushId) : undefined;
    if (!brush) return;
    if (phase === "start") { activateSketch(frameId); setPlacing(frameId); brushDrag.current = startBrushGesture(deps, brush, frameId, point); }
    else brushDrag.current?.move(point);
  }
  /**
   * Interaction is part of the brush tool: on the active frame that has the brush
   * (and its result), the running result alone takes mouse, touch and keyboard input.
   */
  function interactingIn(frameId: string, owner: SketchPanel) {
    return Boolean(playingBrush && frameId === activeSketch && placing !== frameId && owner.generated && !owner.annotating && !owner.transformDraft?.annotating
      && brushNodeIds(owner.scene, playingBrush, frameId).length);
  }
  /** A brush gesture on a frame: stamp/paint with the brush. */
  function brushGesture(frameId: string, toolId: string, points: { x: number; y: number; t: number }[]) {
    const pick = parseBrushTool(toolId), brush = pick && brushesRef.current.find(item => item.id === pick.brushId);
    if (!pick || !brush) return;
    activateSketch(frameId);
    if (pick.kind === "brush") { brushDrag.current?.end(points.at(-1)!); brushDrag.current = null; setPlacing(null); }
  }
  /** A stroke drawn on the frame for the open regeneration (normalized). */
  function addTransformMark(frameId: string, points: { x: number; y: number }[]) {
    if (points.length < 2) return;
    updatePanel(frameId, previous => previous.transformDraft ? { transformDraft: { ...previous.transformDraft,
      marks: [...previous.transformDraft.marks, points.map(point => ({ x: Math.min(1, Math.max(0, point.x / 900)), y: Math.min(1, Math.max(0, point.y / 600)) }))].slice(-64) } } : {});
  }
  /** Make a root node of a frame a brush in the toolbar (one AI did not make: e.g. it was taken for a background). */
  function makeBrush(frameId: string, nodeId: string) {
    const owner = panelsRef.current[frameId], node = owner && findNode(owner.scene, nodeId);
    if (!owner || !node || node.parentId || node.brushId) return;
    if (brushesRef.current.length >= MAX_BRUSHES) { setToast(`There can be at most ${MAX_BRUSHES} brushes.`); return; }
    const [brush] = brushesFor({ ...owner.scene, nodes: owner.scene.nodes.filter(item => item.id === nodeId) }, frameId, brushesRef.current, () => crypto.randomUUID());
    if (!brush) return;
    setBrushes([...brushesRef.current, brush]);
    updatePanel(frameId, panel => ({ scene: markBrushes(panel.scene, [brush]) }));
    if (owner.generated) deps.refreshBrushCode?.(frameId, owner.generated.code);
    setToast(`Added the ${node.name} brush to the toolbar.`);
  }

  // ── Master and instances ───────────────────────────────────────────────────
  /** The master's frame name, or null when that frame (or the master in it) is gone. */
  /** On the board: the master of the brush pointed at in the Brush panel, else of the brush picked there while it is open. */
  const highlightedBrush = brushes.find(item => item.id === (brushHover ?? openGroup));
  const masterNode = highlightedBrush && artworkOf(highlightedBrush.sourceFrameId) && panels[highlightedBrush.sourceFrameId] ? findNode(panels[highlightedBrush.sourceFrameId].scene, highlightedBrush.nodeId) : undefined;
  const masterHighlight = highlightedBrush && masterNode ? { frame: highlightedBrush.sourceFrameId as FrameId, name: highlightedBrush.name, color: highlightedBrush.color, region: masterNode.region } : null;
  const masterFrame = (brush: Brush) => { const owner = panels[brush.sourceFrameId]; return artworkOf(brush.sourceFrameId) && owner && findNode(owner.scene, brush.nodeId) ? artworkOf(brush.sourceFrameId)!.name : null; };
  /**
   * constraints and state machines of an instance follow its brush:
   * an edit there asks first (detach into a new brush, or go to the master).
   * Plain value adjustments (sliders) are the instance's own and never ask.
   */
  function guard(nodeId: string, what: string, apply: () => void) {
    const frameId = activeSketch, owner = panelsRef.current[frameId] || panel, role = brushRole(owner.scene, frameId, nodeId, brushesRef.current);
    if (!role || role.master) { apply(); return; }
    setDetachPrompt({ frameId, rootId: role.rootId, brushId: role.brush.id, nodeName: findNode(owner.scene, role.rootId)?.name || role.brush.name, what, apply });
  }
  const guardEach = (nodeIds: string[], what: string, apply: () => void) => { const id = nodeIds.find(item => { const role = brushRole(scene, activeSketch, item, brushes); return role && !role.master; }); if (id) guard(id, what, apply); else apply(); };
  /** The instance's module in its frame's program (what the new brush runs). */
  const instanceCode = (owner: SketchPanel, rootId: string) => { const root = findNode(owner.scene, rootId); return root && owner.generated ? programModules(owner.generated.code).get(root.codeModule ?? root.id) ?? "" : ""; };
  /** Detach an instance: it becomes the master of a new brush. */
  function detachInstance(frameId: string, rootId: string, brushId: string) {
    const owner = panelsRef.current[frameId], from = brushesRef.current.find(item => item.id === brushId);
    if (!owner || !from || !findNode(owner.scene, rootId)) return null;
    if (brushesRef.current.length >= MAX_BRUSHES) { updatePanel(frameId, { error: `You can make up to ${MAX_BRUSHES} brushes. Delete the brushes you are not using.` }); return null; }
    const made = detachedBrush(owner.scene, frameId, rootId, brushesRef.current, crypto.randomUUID(), instanceCode(owner, rootId));
    setBrushes([...brushesRef.current, made]);
    updatePanel(frameId, previous => ({ scene: { ...previous.scene, nodes: previous.scene.nodes.map(item => item.id === rootId ? { ...item, brushId: made.id } : item) } }));
    // A tool of the old brush in use moves to the same tool of the new one.
    if (brushPick?.brushId === from.id) chooseBrushTool(made.id, brushTool(brushPick.kind, made.id));
    setToast(`Detached from ${from.name} and made the “${made.name}” brush. This node is the new brush's master.`);
    return made;
  }
  /** The master's frame is gone: this instance becomes the brush's master. */
  function adoptMaster(frameId: string, rootId: string, brushId: string) {
    const owner = panelsRef.current[frameId]; if (!owner || !findNode(owner.scene, rootId)) return false;
    setBrushes(brushesRef.current.map(item => item.id === brushId ? { ...item, sourceFrameId: frameId, nodeId: rootId, scene: subScene(owner.scene, [rootId]), code: instanceCode(owner, rootId) || item.code } : item));
    setToast("Set this instance as the brush's master.");
    return true;
  }
  function goToMaster(brush: Brush) {
    if (!masterFrame(brush)) return;
    activateSketch(brush.sourceFrameId); updatePanel(brush.sourceFrameId, { selectedNodeIds: [brush.nodeId] }); setPendingFrameFocus(brush.sourceFrameId as FrameId);
  }
  function selectDrawingPen(pen: SemanticPen) {
    setActiveSemanticPenId(pen.id); setTool("semantic"); patchActive({ annotating: false }); setPencilOpen(false); setPenSettingsOpen(true);
    workspaceCanvas.current?.focus(activeSketch as FrameId);
  }
  function editDrawingPen(pen: SemanticPen) { if (pen.id === interactionPen.id) { setInteractionPen(pen); return; } setSemanticPens(current => current.map(item => item.id === pen.id ? pen : item)); }

  // ── Photos ─────────────────────────────────────────────────────────────────
  async function attach(file: File) {
    const targetId = activeSketch, document = activeDocument.current;
    try {
      const photo = await readPhoto(file);
      if (document !== activeDocument.current) return false;
      const previous = artworkOf(targetId);
      if (!previous) return false;
      cancel(targetId);
      commitFrame(targetId, { ...previous, photo, strokes: [], name: file.name.replace(/\.[^.]+$/, "") });
      canvasFor(targetId)?.clearSelection();
      // A new photo starts a new scene; the previous one stays reachable with layer undo.
      updatePanel(targetId, previous => ({ ...commitScene(previous, emptyScene()), selectedNodeIds: [], editingStates: {}, generated: null, codeDraft: "", analysisRevision: -1 }));
      if (activeSketchRef.current === targetId) workspaceCanvas.current?.focus(targetId as FrameId);
      return true;
    } catch (e) { if (document === activeDocument.current) patchActive({ error: (e as Error).message }); return false; }
  }
  /**
   * Copy a constraint from Layers. The system clipboard gets a line of text for it too, so an image copied
   * before does not take the next paste; an image copied after it still does.
   */
  function copyLayerConstraint(nodeId: string, constraintId: string) {
    try {
      const clip = copyConstraint((panelsRef.current[activeSketch] || panel).scene, nodeId, constraintId);
      setConstraintClip(clip); void navigator.clipboard?.writeText(`Constraint: ${clip.label}`).catch(() => {});
      setToast(`Copied “${clip.label}”. Select a layer (or a constraint, to paste after it) and press ⌘V, or press Paste on a layer.`);
    } catch (error) { patchActive({ error: (error as Error).message }); }
  }
  /** Paste the copied constraint: after the constraint picked in Layers, else at the end of the selected layer. False when there is nowhere to paste. */
  function pasteLayerConstraint(target?: { nodeId: string; afterId: string | null }) {
    const clip = constraintClip, owner = panelsRef.current[activeSketch] || panel;
    const picked = layerPick(activeSketch);
    const at = target ?? (picked ? { nodeId: picked.nodeId, afterId: picked.constraintId } : owner.selectedNodeIds[0] ? { nodeId: owner.selectedNodeIds[0], afterId: null } : null);
    if (!clip || !at) return false;
    guard(at.nodeId, "constraint", () => { edits.pasteConstraint(at.nodeId, clip, at.afterId); setToast(`Pasted “${clip.label}” into ${findNode(owner.scene, at.nodeId)?.name || "the layer"}. Press Update code to connect it.`); });
    return true;
  }
  /** Paste an image into the selected frame. Listens on window: clicking a frame does not focus anything inside the studio. */
  function pastePhoto(event: ClipboardEvent) {
    const target = event.target instanceof Element ? event.target : null;
    if (!event.clipboardData || target?.closest("input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox']") || modal || exportOpen || historyOpen || busy || interactingIn(activeSketch, panelsRef.current[activeSketch] || panel)) return;
    const item = Array.from(event.clipboardData.items).find(item => item.kind === "file" && item.type.startsWith("image/"));
    const image = item?.getAsFile() || Array.from(event.clipboardData.files).find(file => file.type.startsWith("image/"));
    if (!image) { if (pasteLayerConstraint()) event.preventDefault(); return; }
    event.preventDefault();
    const extension = image.type === "image/jpeg" ? "jpg" : image.type === "image/webp" ? "webp" : "png";
    void attach(new File([image], `Clipboard image.${extension}`, { type: image.type })).then(attached => { if (attached) setToast("Attached the clipboard image."); });
  }

  // ── Results and state preview ─────────────────────────────────────
  async function prepare(code: string) {
    const number = ++prepareNumber.current; patchActive({ runtimeError: "" });
    try { const result = await fetch("/api/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ intent: "prepare", code }) }).then(r => r.json()); if (number !== prepareNumber.current) return; if (result.error) { if (result.logged) markLogged(result.error); throw new Error(result.error); } patchActive({ executable: result.executable, preparedCode: code }); }
    catch (e) { if (number === prepareNumber.current) patchActive({ runtimeError: e instanceof Error ? e.message : "Could not run the code." }); }
  }
  function beginAnnotations(owner = activeSketch) {
    activateSketch(owner);
    const resultPanel = panelsRef.current[owner]; if (!resultPanel) return;
    if (resultPanel.annotating) { updatePanel(owner, { annotating: false }); return; }
    const image = resultPanel.annotationImage || resultPreviews.current.get(owner)?.capture();
    if (!image || !resultPanel.generated) { updatePanel(owner, { error: "Press Annotate after the result finishes rendering." }); return; }
    updatePanel(owner, { annotationImage: image, annotationSource: liveSceneSource(resultPanel.generated, resultPanel.scene), annotationRenderRevision: resultPanel.renderRevision, annotating: true, machinePlaying: false });
    setTool("pen"); setPencilOpen(false); setPenSettingsOpen(false); workspaceCanvas.current?.focus(owner as FrameId);
  }
  function emitTransition(nodeId: string, transitionId: string) {
    const machine = findNode(scene, nodeId)?.machine, current = panel.runtimeStates[nodeId] || machine?.initialState;
    const transition = machine?.transitions.find(item => item.id === transitionId && item.from === current);
    if (!transition || busy) return;
    resultPreviews.current.get(activeSketch)?.emit(nodeId, transitionId);
    patchActive({ editingStates: { ...panel.editingStates, [nodeId]: transition.to }, ...clearedResultAnnotations() });
  }
  function restartMachine(nodeId: string) {
    const machine = findNode(scene, nodeId)?.machine; if (!machine) return;
    patchActive(previous => ({ machinePlaying: true, stateJump: { nodeId, stateId: machine.initialState, revision: (previous.stateJump?.revision || 0) + 1 }, editingStates: { ...previous.editingStates, [nodeId]: machine.initialState } }));
  }

  // ── Frames on the infinite canvas ──────────────────────────────────────────
  // Layers dragged from the Layers panel can land on a sketch frame or on its result frame.
  const layerDrop = (id: string, highlight: string, measure: (target: HTMLElement) => Element) => ({
    onDragOver: (e: React.DragEvent<HTMLElement>) => { if (!e.dataTransfer.types.includes(NODE_DRAG_TYPE) || busy) return; e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "copy"; if (dropTarget !== highlight) setDropTarget(highlight); },
    onDragLeave: (e: React.DragEvent<HTMLElement>) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropTarget(null); },
    onDrop: (e: React.DragEvent<HTMLElement>) => {
      setDropTarget(null);
      const payload = readNodeDrag(e.dataTransfer); if (!payload) return;
      e.preventDefault(); e.stopPropagation();
      const box = measure(e.currentTarget).getBoundingClientRect();
      void dropNode(deps, payload.sketchId, payload.nodeId, id, { x: Math.max(0, Math.min(1, (e.clientX - box.left) / box.width)), y: Math.max(0, Math.min(1, (e.clientY - box.top) / box.height)) });
    },
  });
  const sketchFrameContent = (id: string, frameArtwork: Artwork, ref: React.Ref<CanvasHandle>, empty: React.ReactNode) => (boardZoom: number) => {
    const owner = panels[id] || createSketchPanel(), frameEdits = sceneEdits(deps, id);
    // Playing with a brush (interaction): sketch strokes, layer boxes and layer drops are switched off; only the result takes input.
    const interacting = interactingIn(id, owner);
    // Drawing the annotation of an open regeneration: strokes go to it, not to the sketch.
    const transformDrawing = Boolean(owner.transformDraft?.annotating && id === activeSketch);
    return <div className={`sketch-frame-surface ${owner.generated || owner.pendingResult ? "has-render" : ""} ${interacting ? "frame-interacting" : ""} ${dropTarget === id ? "node-drop-target" : ""} ${transformDrawing ? "transform-drawing" : ""}`} onPointerDownCapture={e => { if (!(e.target as Element).closest("button")) activateSketch(id); }}
      onPointerEnter={() => { if (playingBrush) prepareBrushFor(deps, playingBrush, id); }}
      onPointerDown={e => { if (!interacting && !transformDrawing && tool === "select" && !(e.target as Element).closest(".scene-node, .param-handles")) frameEdits.select(null); }}
      {...(interacting ? {} : layerDrop(id, id, target => target.querySelector(".p5-surface") || target))}>
      {/* One frame, three layers: generated result, sketch strokes + layer boxes, annotations. */}
      <FrameRender owner={id} panel={owner} interacting={interacting} live={placing === id} onEscape={() => { if (interacting) chooseTool("select"); }} documentRevision={activeDocument.current} onPatch={patch => updatePanel(id, patch)}
        tracing={execution.view?.frameId === id || manipulation.view?.fork === id || (kept.active?.frameId === id && kept.active.tool === "inspect")} onCycle={raw => { if (manipulation.view?.fork === id) manipulation.onForkCycle(raw); else { execution.onCycle(id, raw); kept.onCycle(id, raw); } }} restore={execution.view?.frameId === id && !execution.view.framed ? execution.restore ?? undefined : undefined}
        hostValues={liveFork === id ? { ...keptValues(owner.keptTools), ...manipulation.view!.demo } : owner.keptTools.length ? keptValues(owner.keptTools) : undefined}
        overlay={kept.active?.frameId === id && kept.overlays.length ? <>{kept.overlays.map(item => <ExecutionOverlay key={item.site} steps={item.steps} step={item.step} plan={item.plan} shown={kept.shown} probes={kept.probes} />)}</>
          : liveFork === id ? <>{manipulation.forkOverlays.map(item => <ExecutionOverlay key={item.site} steps={item.steps} step={item.step} plan={item.plan} shown={manipulation.forkShown} probes={manipulation.view!.probes} onFail={message => manipulation.overlayFailed(item.site, message)} />)}</>
          : execution.view?.frameId === id && !execution.view.framed && execution.step ? <ExecutionOverlay steps={execution.steps.length ? execution.steps : []} step={execution.step} plan={execution.plan} shown={execution.shown} onStatus={execution.setOverlayStatus} /> : null}
        onPreview={handle => { if (handle) resultPreviews.current.set(id, handle); else resultPreviews.current.delete(id); }} />
      <SketchCanvas ref={ref} artwork={frameArtwork} tool={tool} showGesture={name => parseBrushTool(name)?.kind !== "brush"}
        gestureTool={name => transformDrawing || parseBrushTool(name)?.kind === "brush"}
        onGesture={(name, points) => transformDrawing ? addTransformMark(id, points) : brushGesture(id, name, points)} onGestureStep={(name, point, phase) => { if (!transformDrawing) brushGestureStep(id, name, point, phase); }} color={color} width={width} opacity={opacity} transparent viewport={drawingViewport} semanticPen={activeSemanticPen}
        onStroke={(stroke: Stroke) => { const latest = artworkOf(id); if (!latest) return; if (latest.strokes.length >= 500) { updatePanel(id, { error: "A frame can store up to 500 strokes. Add a new sketch frame." }); return; } activateSketch(id); commitFrame(id, { ...latest, strokes: [...latest.strokes, stroke] }); }}
        onViewport={() => {}} onSelection={value => id === "source" ? setHasSelection(value) : setSketchSelections(current => current[id] === value ? current : { ...current, [id]: value })} onError={message => updatePanel(id, { error: message })}>
        {/* The brush tool draws nothing of its own on the frame: no layer boxes, no gesture path. */}
        {!interacting && !playingBrush && <SceneOverlay scene={owner.scene} selected={owner.selectedNodeIds} hovered={owner.hovered} zoom={boardZoom} interactive={tool === "select" && !transformDrawing}
          onSelect={(nodeId, additive) => { activateSketch(id); frameEdits.select(nodeId, additive); }}
          onHover={nodeId => updatePanel(id, { hovered: nodeId })} onLiveMove={next => frameEdits.preview(next)} onMove={(next, before) => frameEdits.move(next, before)} />}
      </SketchCanvas>
      {/* The Adjust tool: dragging a drawn object moves the values its constraints give a drag (one undo step per drag). */}
      {tool === "adjust" && owner.generated && !interacting && !transformDrawing && !owner.annotating && <DragAdjustLayer scene={owner.scene} zoom={boardZoom} stack={node => inspectedConstraints(panelsRef.current[id] ?? owner, node)}
        onStart={() => { activateSketch(id); adjustStart.current = { frame: id, scene: panelsRef.current[id]?.scene ?? owner.scene }; }}
        onValue={(nodeId, paramId, path, value) => frameEdits.scalar(nodeId, paramId, path, value)}
        onEnd={() => { const start = adjustStart.current; adjustStart.current = null; const now = panelsRef.current[id]?.scene; if (start?.frame === id && now && now !== start.scene) frameEdits.move(now, start.scene); }} />}
      <FrameAnnotations panel={owner} tool={tool} zoom={boardZoom} onPatch={patch => updatePanel(id, patch)} />
      {execution.view?.frameId === id && <ExecutionMarks marks={execution.view.marks} active={tool === "inspect-mark"} color={MARK_COLOR} onAdd={execution.addMark} />}
      {id === activeSketch && clarifyShown && !owner.annotating && <ClarifyInsitu {...clarifyShown} />}
      {liveFork === id && manipLayer(manipulation.view!)}
      {kept.active?.frameId === id && kept.set && <ManipLayer strokes={kept.set.strokes} hidden={kept.hidden} tool={kept.active.tool} selected={kept.selected} onAdd={kept.add} onChange={kept.change} onSelect={kept.select} probes={kept.probes} onProbe={kept.probe} />}
      {showComposeTags && owner.composeTags.length > 0 && !interacting && !playingBrush && !transformDrawing && !owner.annotating
        && <ComposeTags key={tagMoves[id] ?? 0} tags={owner.composeTags} zoom={boardZoom} stale={frameArtwork.revision !== owner.composeTagsRevision} examples={pen => exampleThumbsFor(id, pen)}
          onCard={tag => { void captureExampleThumbs(tag.constraints.flatMap(item => penExamples(placedPen(item.pen, framePens(id)), panelsRef.current))); }} onExample={openExample} onEdit={composeTags => updatePanel(id, { composeTags })}
          onRevise={(tagId, index, request) => { activateSketch(id); void sceneAI(deps, id).reviseComposeTag(tagId, index, request); }} busy={Boolean(owner.loading)}
          open={openTags[id] ?? null} onOpen={tagId => setOpenTags(current => ({ ...current, [id]: tagId }))} highlight={pointedTag?.frameId === id ? pointedTag.id : null}
          {...(({ onAdd: _add, ...structure }) => structure)(tagStructure(id))} />}
      {owner.transformDraft && owner.transformDraft.marks.length > 0 && <svg className="transform-marks" viewBox="0 0 900 600" preserveAspectRatio="none" aria-label="Regeneration annotation">
        {owner.transformDraft.marks.map((mark, i) => <polyline key={i} vectorEffect="non-scaling-stroke" points={mark.map(point => `${point.x * 900},${point.y * 600}`).join(" ")} />)}</svg>}
      {!(frameArtwork.photo || frameArtwork.strokes.length) && !owner.generated && !owner.pendingResult && !owner.scene.nodes.length && empty}</div>;
  };
  // ── Minimal example frames ──────────────────────────────────────────────────
  // Hidden examples are off the board (their result does not run). One whose frame it came from is gone shows again.
  const hiddenExamples = new Set(workspace.hiddenExamples.filter(id => { const of = panels[id]?.exampleOf; return Boolean(of && artworkOf(id) && artworkOf(of.frameId)); }));
  /** Every example made from a frame, and from those examples in turn (a decomposed example's parts). */
  const examplesOf = (frameId: string) => {
    const out: string[] = [], queue = [frameId];
    for (let next = queue.shift(); next !== undefined; next = queue.shift()) for (const [id, frame] of Object.entries(panels)) if (frame.exampleOf?.frameId === next && artworkOf(id) && !out.includes(id)) { out.push(id); queue.push(id); }
    return out;
  };
  const hiddenExamplesOf = (frameId: string) => examplesOf(frameId).filter(id => hiddenExamples.has(id));
  /** Hide every example of a frame (and their parts) at once. */
  function hideExamplesOf(frameId: string) {
    const ids = examplesOf(frameId).filter(id => !hiddenExamples.has(id)); if (!ids.length) return;
    setWorkspace(current => ({ ...current, hiddenExamples: [...new Set([...current.hiddenExamples, ...ids])].slice(-MAX_SKETCH_FRAMES) }));
    setPickedFrames(current => current.filter(id => !ids.includes(id)));
    if (ids.includes(activeSketchRef.current)) { activateSketch(frameId); setPendingFrameFocus(frameId as FrameId); }
    setToast(`Hid ${ids.length} example(s). Bring them back with Show examples.`);
  }
  function hideExample(frameId: string) {
    const of = panelsRef.current[frameId]?.exampleOf; if (!of) return;
    setWorkspace(current => ({ ...current, hiddenExamples: [...new Set([...current.hiddenExamples, frameId])].slice(-MAX_SKETCH_FRAMES) }));
    setPickedFrames(current => current.filter(id => id !== frameId));
    if (activeSketchRef.current === frameId) { activateSketch(of.frameId); setPendingFrameFocus(of.frameId as FrameId); }
    setToast(`Hid “${artworkOf(frameId)?.name ?? "example"}”. Bring it back with Show examples on ${artworkOf(of.frameId)?.name ?? "the original frame"}.`);
  }
  function showExamples(frameId: string) {
    const shown = new Set(hiddenExamplesOf(frameId));
    setWorkspace(current => ({ ...current, hiddenExamples: current.hiddenExamples.filter(id => !shown.has(id)) }));
  }
  // Examples once became brushes of their own when their node belonged to no brush (a background's "Paper fill · example"):
  // those are not the user's and go.
  useEffect(() => {
    const stray = brushes.filter(brush => !brush.parentId && panels[brush.sourceFrameId]?.exampleOf && brush.name.endsWith(" · example"));
    if (!stray.length) return;
    for (const brush of stray) removeBrush(brush);
    setToast(`Deleted ${stray.length} brush(es) (${stray.map(brush => `“${brush.name}”`).join(", ")}) mistakenly made from examples of non-brush nodes.`);
  }, [brushes, panels]);
  /** Whether an example can have a sub brush: its node belongs to a brush of the frame it came from. */
  const exampleCanBrush = (frameId: string) => { const of = panels[frameId]?.exampleOf, owner = of && panels[of.frameId];
    return Boolean(owner && of && sourceBrushGroup(owner.scene, of.frameId, of.nodeId, brushes)); };
  /** The sub brush an example frame made (its own frame is the sub brush's master). */
  const exampleSubBrush = (frameId: string) => brushes.find(item => item.sourceFrameId === frameId && item.parentId);
  /** The constraint an example frame shows, in its own scene (a part of a decomposed one exists only there). */
  function exampleConstraint(frameId: string) {
    const frame = panelsRef.current[frameId], of = frame?.exampleOf, node = of && !of.scope ? findNode(frame.scene, of.nodeId) : undefined;
    const constraint = node ? findConstraint(node, of!.constraintId) ?? node.constraints.find(item => item.params.length) : undefined;
    return node && constraint ? { node, constraint } : null;
  }
  /** Brush with an example: its sub brush is picked (made first, when it has none). */
  function brushWithExample(frameId: string) {
    const frame = panelsRef.current[frameId], of = frame?.exampleOf; if (!frame || !of) return;
    let sub = exampleSubBrush(frameId);
    if (!sub) {
      const shown = exampleConstraint(frameId), own = findNode(frame.scene, of.nodeId);
      const made = deps.addSubBrush?.(of.frameId, of.nodeId, frameId, frame.scene, `${(own && exampleLabel(own, of.scope, of.constraintId)) || shown?.constraint.property || "Example"} · example`);
      if (!made) { updatePanel(frameId, { error: "Could not make the sub brush (the original brush is missing or the brushes are full)." }); return; }
      updatePanel(frameId, current => ({ scene: markBrushes(current.scene, [made]) }));
      sub = made;
    }
    chooseBrushTool(sub.id, brushTool("brush", sub.id));
    setToast(`Drawing with the “${sub.name}” sub brush. It is in the tool group of the brush this example belongs to.`);
  }
  /** Changes a frame's compose tags (their structure): boxes are fitted again over the sketch's marks while the tags still fit the sketch. */
  function editComposeTags(frameId: string, change: (tags: ComposeTag[], strokes: { id: string; tool: string; points: { x: number; y: number }[] }[]) => ComposeTag[] | null) {
    const owner = panelsRef.current[frameId], art = artworkOf(frameId); if (!owner || !art) return;
    const next = change(owner.composeTags, owner.composeTagsRevision === art.revision ? compositionContext(art).compositionStrokes : []);
    if (next) updatePanel(frameId, { composeTags: next });
  }
  const tagStructure = (frameId: string) => ({
    canMove: (tagId: string, parentId: string) => canMoveTag(panels[frameId]?.composeTags ?? [], tagId, parentId),
    onMove: (tagId: string, parentId: string) => editComposeTags(frameId, (tags, strokes) => moveTag(tags, tagId, parentId, strokes)),
    onKind: (tagId: string, kind: ComposeTag["kind"]) => editComposeTags(frameId, (tags, strokes) => setTagKind(tags, tagId, kind, strokes)),
    onDelete: (tagId: string) => { editComposeTags(frameId, (tags, strokes) => deleteTag(tags, tagId, strokes)); setOpenTags(current => current[frameId] === tagId ? { ...current, [frameId]: null } : current); },
    onAdd: (kind: ComposeTag["kind"]) => {
      const owner = panelsRef.current[frameId], open = owner && openTags[frameId], made = owner && addTag(owner.composeTags, kind, open ?? "");
      if (!made) { setToast("A sketch can have at most 16 tags."); return; }
      // A tag made by hand fits the sketch as it is now.
      updatePanel(frameId, { composeTags: made.tags, ...(owner.composeTags.length ? {} : { composeTagsRevision: artworkOf(frameId)?.revision ?? -1 }) });
      setShowComposeTags(true); setOpenTags(current => ({ ...current, [frameId]: made.id }));
    },
    onMoveConstraint: (from: TagConstraintAt, to: string, before?: number) => {
      const owner = panelsRef.current[frameId]; if (!owner) return;
      const next = moveConstraint(owner.composeTags, from, to, before);
      if (!next) { if (to !== from.tagId) setToast(`A tag can have at most ${MAX_TAG_CONSTRAINTS} constraints.`); return; }
      updatePanel(frameId, { composeTags: next }); setTagMoves(current => ({ ...current, [frameId]: (current[frameId] ?? 0) + 1 }));
    },
  });
  /** The minimal examples of the constraint a compose tag's pen carries, with their pictures. */
  /** The pens a frame's strokes keep (with the toolbar's), to place a tag's pen. */
  const framePens = (frameId: string) => [...(artworkOf(frameId)?.strokes ?? []).flatMap(stroke => stroke.semanticPen ? [stroke.semanticPen] : []), ...semanticPens];
  const exampleThumbsFor = (frameId: string, pen: ComposeTagPen | null): ExampleThumb[] => penExamples(placedPen(pen, framePens(frameId)), panels).filter(id => artworkOf(id))
    .map(id => ({ id, name: artworkOf(id)!.name, thumbnail: exampleThumbs[id] ?? null, hidden: hiddenExamples.has(id) }));
  /** Takes the pictures of these example frames from their running results (one hidden or not run yet keeps its last). */
  async function captureExampleThumbs(ids: string[]) {
    const made: Record<string, string> = {};
    for (const id of new Set(ids)) {
      const frame = panelsRef.current[id], node = frame?.exampleOf && findNode(frame.scene, frame.exampleOf.nodeId);
      const image = node && frame.generated ? resultPreviews.current.get(id)?.capture() : "";
      const thumbnail = image ? await captureThumbnail(image, node!.region, { w: 132, h: 88 }).catch(() => null) : null;
      if (thumbnail) made[id] = thumbnail;
    }
    if (Object.keys(made).length) setExampleThumbs(current => ({ ...current, ...made }));
  }
  /** Goes to an example frame (shown again first when it is hidden). */
  function openExample(id: string) {
    if (hiddenExamples.has(id)) setWorkspace(current => ({ ...current, hiddenExamples: current.hiddenExamples.filter(item => item !== id) }));
    activateSketch(id); setPendingFrameFocus(id as FrameId);
  }
  /** A pen carrying the example's constraint. */
  function makeExamplePen(frameId: string) {
    const frame = panelsRef.current[frameId], shown = exampleConstraint(frameId); if (!frame || !shown) return;
    try { addPen((penId, color) => makeConstraintPen(frame.scene, shown.node.id, shown.constraint.id, frameId, penId, color)); }
    catch (error) { updatePanel(frameId, { error: error instanceof Error ? error.message : "Could not make the pen." }); }
  }
  // Header controls for a frame: run/pause and re-render its result, (re)generate code, annotate, extract.
  const frameActions = (id: string, selection: boolean, present: boolean) => {
    const frame = panels[id] || createSketchPanel(), frameBusy = Boolean(frame.loading);
    const status = sceneLiveStatus(frame.generated, frame.scene);
    const proxies = proxyFrames.filter(proxy => proxy.targetFrameId === id);
    return <>
      {/* Each node of this frame with proxy frames: hover shows the link, click shows them (hidden ones too) and goes there. */}
      {[...new Set(proxies.map(proxy => proxy.nodeId))].map(nodeId => { const mine = proxies.filter(proxy => proxy.nodeId === nodeId), name = findNode(frame.scene, nodeId)?.name || nodeId, off = mine.every(proxy => proxy.hidden);
        return <button key={nodeId} className={`proxy-link-chip back${off ? " off" : ""}`} aria-label={`Proxy frames of ${name}`} title={off ? "Show the hidden proxy frames of this node" : "Go to the proxy frames that control this node"}
          onMouseEnter={() => setLinkHover((mine.find(proxy => !proxy.hidden) ?? mine[0]).id as FrameId)} onMouseLeave={() => setLinkHover(null)} onClick={e => { e.stopPropagation(); setLinkHover(null); openProxy(id, nodeId); }}>
          ◎<b>{name}</b><i>{mine.length > 1 ? `${mine.length} proxies` : "proxy"}{off ? " · hidden" : ""}</i></button>; })}
      {/* Each frame shows (and can stop) its own AI work, also while another frame is active. */}
      {frameBusy && <span className="frame-working" role="status" title={frame.loading}><span className="loading-spinner" />AI working
        <button aria-label="Cancel this frame's AI work" title="Cancel" onClick={e => { e.stopPropagation(); cancel(id); }}><Icon name="close" size={11} /></button></span>}
      {frame.scene.nodes.length > 0 && <button aria-label={`Copy ${artworkOf(id)?.name || id} as JSON`} title="Copy this frame's state machines, params and code as one JSON" onClick={e => { e.stopPropagation(); setFrameJson(id); }}><Icon name="copy" size={13} />JSON</button>}
      {frame.generated && <button aria-label={frame.machinePlaying ? "Pause result" : "Run result"} title={frame.machinePlaying ? "Pause" : "Run"} disabled={!frame.executable} onClick={() => updatePanel(id, { machinePlaying: !frame.machinePlaying })}><Icon name={frame.machinePlaying ? "pause" : "play"} size={13} />{frame.machinePlaying ? "Pause" : "Run"}</button>}
      {frame.generated && <button aria-label="Re-render result" title="Re-render from the start" disabled={!frame.executable || frameBusy} onClick={() => { activateSketch(id); if (execution.view?.frameId === id) execution.clearTrace(); updatePanel(id, previous => ({ renderRevision: previous.renderRevision + 1, machinePlaying: true, seed: null })); }}><Icon name="undo" size={13} /></button>}
      {frame.scene.nodes.length > 0 && (!frame.generated || status !== "live" || frame.dirtyNodeIds.length > 0) && <button disabled={frameBusy} title="Generate this frame's p5.js result" onClick={() => { activateSketch(id); void sceneAI(deps, id).generateCode(); }}><Icon name="code" size={13} />{frame.generated ? "Update" : "Generate"}</button>}
      {frame.generated && <button disabled={!frame.executable} aria-pressed={execution.view?.frameId === id} title="Record this frame's execution (every variable at every step) and inspect it" onClick={e => { e.stopPropagation(); activateSketch(id); execution.open(id); }}><Icon name="inspect" size={13} />{execution.view?.frameId === id ? "Inspecting" : "Inspect"}</button>}
      {frame.generated && <button disabled={!frame.executable || frameBusy} aria-pressed={frame.annotating} onClick={() => beginAnnotations(id)}><Icon name="pen" size={13} />{frame.annotating ? "Done" : "Annotate"}</button>}
      {frame.scene.nodes.some(node => node.constraints.some(item => item.params.length)) && <button disabled={frameBusy} title={frame.exampleOf && !frame.exampleOf.scope ? "Divide this constraint into the computations inside it, each in a frame linked to this one"
          : "Decompose one level (base state): into nodes, then a node into its constraints (as one group) and its child nodes, then single constraints. Decompose a part to go further"}
        onClick={e => { e.stopPropagation(); activateSketch(id); void sceneAI(deps, id).decompose(); }}><Icon name="layers" size={13} />Decompose</button>}
      {(() => { // Handles for every constraint of every node; when all have them, the button opens every node's proxy group.
        const nodes = frame.scene.nodes.filter(node => (node.parentId || !isBackdrop(node)) && handleConstraints(node).length > 0); if (!nodes.length) return null;
        const missing = nodes.some(node => handleConstraints(node).some(item => item.params.some(param => handleLeaves(param).length > 0 && !param.handle)));
        return <button disabled={frameBusy} title={missing ? "AI makes a direct manipulation proxy (handles) for every constraint (base state) of every node still without them, one request per constraint; each constraint gets its own proxy frame, grouped by node"
          : "Every constraint has its handles: open each node's proxy frames (one per constraint, grouped by node), hidden ones too"}
          onClick={e => { e.stopPropagation(); activateSketch(id); void sceneAI(deps, id).suggestAllHandles(); }}><Icon name="target" size={13} />{missing ? "Handles for all" : "Open all handles"}</button>; })()}
      {frame.scene.nodes.some(node => (node.parentId || !isBackdrop(node)) && proxyGroups(node.constraints).length > 0) && <button disabled={frameBusy}
        title="AI makes again every handle of every node (base state), one request per constraint, each seeing its current widget; undo takes each back"
        onClick={e => { e.stopPropagation(); activateSketch(id); void sceneAI(deps, id).suggestAllHandles(undefined, true); }}><Icon name="spark" size={13} />Redesign all handles</button>}
      {proxies.length > 0 && (() => { // Every proxy frame of this frame: take them all off the board, or (all hidden) put them back. The handles stay on the nodes.
        const shown = proxies.some(proxy => !proxy.hidden);
        return <button aria-pressed={!shown} title={shown ? "Hide every proxy frame (handles) of this frame; they are kept" : "Show this frame's proxy frames (handles) again"}
          onClick={e => { e.stopPropagation(); hideProxies(proxies.map(proxy => proxy.id), shown); }}><Icon name={shown ? "eye-off" : "eye"} size={13} />{shown ? "Hide all handles" : `Show all handles (${proxies.length})`}</button>; })()}
      {examplesOf(id).some(child => !hiddenExamples.has(child)) && <button title="Hide every minimal example made from this frame (and their parts); their results stop running" onClick={e => { e.stopPropagation(); hideExamplesOf(id); }}><Icon name="eye-off" size={13} />Hide all examples</button>}
      {hiddenExamplesOf(id).length > 0 && <button title="Show the minimal example frames hidden from this frame" onClick={e => { e.stopPropagation(); showExamples(id); }}><Icon name="eye" size={13} />Show {hiddenExamplesOf(id).length} examples</button>}
      {frame.exampleOf && <button title="Hide this minimal example (its result stops running); show it again from the frame it came from" onClick={e => { e.stopPropagation(); hideExample(id); }}><Icon name="eye-off" size={13} />Hide</button>}
      {/* A minimal example: brush with it (its sub brush), or carry its constraint in a pen. */}
      {frame.exampleOf && (() => { const sub = exampleSubBrush(id), using = Boolean(sub && brushPick?.kind === "brush" && brushPick.brushId === sub.id);
        if (!sub && !exampleCanBrush(id)) return null;
        return <button disabled={frameBusy || !frame.generated} aria-pressed={using} title={sub ? "Brush with this example (its sub brush in the source brush's tool group)" : "Add this example as a sub brush and brush with it"}
          onClick={e => { e.stopPropagation(); activateSketch(id); brushWithExample(id); }}><Icon name="brush" size={13} />Sub brush</button>; })()}
      {frame.exampleOf && <button disabled={frameBusy || !exampleConstraint(id)} title="Make a pen that carries this example's constraint (its params and values)"
        onClick={e => { e.stopPropagation(); makeExamplePen(id); }}><Icon name="pen" size={13} />Make pen</button>}
      <button disabled={frameBusy || !(present || frame.generated)} title="Extract brush stamps into a new frame" onClick={() => { activateSketch(id); void sceneAI(deps, id).extract(); }}>{selection ? "Extract selection" : "Extract"}<Icon name="spark" size={13} /></button>
    </>;
  };
  const frameSubtitle = (id: string, artwork: Artwork, selection: boolean) => {
    const frame = panels[id], from = frame?.sourceFrameId ? artworkOf(frame.sourceFrameId)?.name : null, exampleOf = frame?.exampleOf ? artworkOf(frame.exampleOf.frameId)?.name : null;
    return [`${artwork.strokes.length} strokes`, frame?.scene.nodes.length ? `${frame.scene.nodes.length} layers` : "", from ? `from ${from}` : "", exampleOf ? `example of ${exampleOf}` : "", frame?.generated ? "p5.js" : "", selection ? "selection" : "", frame && playingBrush && interactingIn(id, frame) ? `playing ${playingBrush.name}` : "", activeSketch === id ? "active" : ""].filter(Boolean).join(" · ");
  };
  // Minimal examples hang off the frame they were decomposed from, named by their constraint.
  const exampleLinks = Object.entries(panels).flatMap(([id, frame]) => {
    const of = frame.exampleOf, node = of && panels[of.frameId] && findNode(panels[of.frameId].scene, of.nodeId);
    const own = findNode(frame.scene, of?.nodeId ?? "") ?? node, label = own && exampleLabel(own, of!.scope, of!.constraintId);
    const mark = of?.scope === "node" ? (own?.kind === "object" ? "○" : "◇") : of?.scope === "constraints" ? "≡" : "▣";
    return of && artworkOf(id) && artworkOf(of.frameId) ? [{ from: of.frameId as FrameId, to: id as FrameId, label: `${mark} ${label || "minimal example"}` }] : [];
  });
  const frames = [
    { id: "source" as const, title: artwork.photo ? "Photo + sketch" : "Original sketch", subtitle: frameSubtitle("source", artwork, hasSelection),
      below: withGeneralize("source", undefined),
      actions: <><button title="Load example sketch" aria-label="Load example sketch" disabled={busy} onClick={() => { activateSketch("source"); commit({ ...blank(), name: "Branch studies", strokes: exampleStrokes() }); updatePanel("source", createSketchPanel()); }}><Icon name="pen" size={13} /></button>{frameActions("source", hasSelection, Boolean(artwork.photo || artwork.strokes.length))}</>,
      content: sketchFrameContent("source", artwork, canvas, <div className="frame-empty source-empty"><Icon name="pen" size={30} /><strong>Start with a mark.</strong><span>Draw here, drop a photo, or paste an image.</span><button onClick={() => upload.current?.click()}>Attach photo<Icon name="upload" size={14} /></button></div>) },
    ...sketchFrames.map(frame => ({ id: frame.id as FrameId, title: frame.artwork.name, subtitle: frameSubtitle(frame.id, frame.artwork, Boolean(sketchSelections[frame.id])),
      below: withGeneralize(frame.id, liveFork === frame.id ? manipPanel(manipulation.view!) : propagationPanel(frame.id)),
      actions: frameActions(frame.id, Boolean(sketchSelections[frame.id]), Boolean(frame.artwork.photo || frame.artwork.strokes.length)),
      content: sketchFrameContent(frame.id, frame.artwork, handle => { if (handle) sketchCanvases.current.set(frame.id, handle); else sketchCanvases.current.delete(frame.id); }, <div className="frame-empty source-empty"><Icon name="pen" size={30} /><strong>Start a new sketch.</strong><span>Draw here, then extract its collections.</span></div>) })),
    ...proxyFrames.filter(proxy => !proxy.hidden).map(proxy => {
      const target = panels[proxy.targetFrameId], targetNode = target && findNode(target.scene, proxy.nodeId), targetName = artworkOf(proxy.targetFrameId)?.name || "frame";
      const constraints = target && targetNode ? inspectedConstraints(target, targetNode) : [];
      // A constraint's frame: its own widgets, number and color; the node's (no handles yet): all of them.
      const own = proxy.constraintId ? constraints.find(item => item.id === proxy.constraintId) : undefined, at = proxyNumber(constraints, proxy.constraintId);
      const count = (own ? [own] : constraints).flatMap(item => item.params).filter(param => param.handle).length;
      const siblings = proxiesOf(proxyFrames, proxy.targetFrameId, proxy.nodeId, constraints.map(item => item.id));
      const stateId = targetNode ? target.editingStates[targetNode.id] : undefined, state = stateId && targetNode?.machine?.states.find(item => item.id === stateId);
      // The module that draws the node (its root's), to tell whether values adjust what input made in place.
      let root = targetNode; while (root?.parentId) root = findNode(target.scene, root.parentId);
      const module = root && target.generated ? programModules(target.generated.code).get(root.codeModule ?? root.id) : undefined;
      return { id: proxy.id as FrameId, title: own ? `◎ ${at ? `${at.number} · ` : ""}${own.property}` : `◎ ${targetNode?.name || proxy.nodeId} · proxy`,
        subtitle: [own ? targetNode?.name : "", `${count} handles`, state ? `editing ${state.label}` : ""].filter(Boolean).join(" · "),
        actions: <>
          {/* The frame (and node) this proxy controls: hover shows it on the board, click goes there. */}
          <button className="proxy-link-chip" aria-label={`Linked frame: ${targetName}, ${targetNode?.name || proxy.nodeId}`} title={`This proxy frame controls “${targetNode?.name || proxy.nodeId}” in ${targetName}. Click to go there`}
            onMouseEnter={() => setLinkHover(proxy.targetFrameId as FrameId)} onMouseLeave={() => setLinkHover(null)}
            onClick={() => { setLinkHover(null); activateFrame(proxy.id); setPendingFrameFocus(proxy.targetFrameId as FrameId); }}>
            <span className="proxy-link-kicker">LINKED</span><Icon name="arrow" size={11} /><b>{targetName}</b><i>/ {targetNode?.name || "deleted node"}</i>{state && <em>{state.label}</em>}</button>
          <ProxyFrameBar node={targetNode} constraints={constraints} current={proxy.id} siblings={siblings} busy={Boolean(target?.loading)} onHide={hideProxies}
            onDesign={constraintId => { activateFrame(proxy.id); void sceneAI(deps, proxy.targetFrameId).suggestHandles(proxy.nodeId, { constraintId }, ""); }}
            onDesignAll={() => { activateFrame(proxy.id); void sceneAI(deps, proxy.targetFrameId).suggestAllHandles([proxy.nodeId]); }}
            onRedesignAll={() => { activateFrame(proxy.id); void sceneAI(deps, proxy.targetFrameId).suggestAllHandles([proxy.nodeId], true); }} />
</>,
        // A mini sandbox's proxy frame: how its program works with the values these handles change.
        below: target?.sandboxLogic ? <SandboxLogicPanel logic={target.sandboxLogic} constraints={own ? [own] : constraints}
          restructure={restructureTarget(target.scene, target.exampleOf) ? { state: target.restructure, busy: Boolean(target.loading) || Boolean(target.restructure?.busy),
            onSuggest: () => { activateFrame(proxy.id); void sceneAI(deps, proxy.targetFrameId).suggestRestructure(); },
            onPick: optionId => { activateFrame(proxy.id); void sceneAI(deps, proxy.targetFrameId).pickRestructure(optionId); },
            onClose: () => updatePanel(proxy.targetFrameId, { restructure: null }) } : undefined} /> : undefined,
        content: <ProxyFrame frameId={proxy.id} node={targetNode} constraints={constraints} targetName={targetName} busy={target?.loading || ""} onActivate={() => activateFrame(proxy.id)}
          bakedInput={bakesInput(module) ? { onUpdate: () => { activateFrame(proxy.id); void sceneAI(deps, proxy.targetFrameId).generateCode(false, `${target.generationMode === "compose" ? target.composePrompt : target.instruction}\n${ADJUST_IN_PLACE_INSTRUCTION}`); } } : undefined}
          onDesign={constraintId => { activateFrame(proxy.id); void sceneAI(deps, proxy.targetFrameId).suggestHandles(proxy.nodeId, { constraintId }, ""); }}
          only={proxy.constraintId}
          onDesignAll={() => { activateFrame(proxy.id); void sceneAI(deps, proxy.targetFrameId).suggestAllHandles([proxy.nodeId]); }}
          onSet={(paramId, path, value) => { if (targetNode) sceneEdits(deps, proxy.targetFrameId).scalar(targetNode.id, paramId, path, value); }}
          onError={(paramId, message) => { const code = paramId && targetNode ? constraints.flatMap(item => item.params).find(param => param.id === paramId)?.handle?.prepared : undefined;
            if (code) setHandleErrors(current => current[`${proxy.targetFrameId}:${proxy.nodeId}:${paramId}`]?.code === code ? current : { ...current, [`${proxy.targetFrameId}:${proxy.nodeId}:${paramId}`]: { code, message } });
            else if (!paramId) updatePanel(proxy.targetFrameId, { error: `Proxy frame error: ${message}` }); }} /> };
    }),
    // The Execution frame of the inspected frame: its concern's steps, stepped through.
    ...(execution.view?.framed && panels[execution.view.frameId]?.generated ? (() => {
      const view = execution.view!, source = view.frameId, target = panels[source], name = artworkOf(source)?.name || "frame";
      const manip = manipulation.view?.frameId === source && manipulation.view.mode === "stepping" ? manipulation.view : null;
      return [{ id: execFrameId(source) as FrameId, title: `▶ Execution · ${name}`, subtitle: view.concern.slice(0, 120),
        actions: <>
          <button className="proxy-link-chip" aria-label={`Inspected frame: ${name}`} title={`The steps of ${name}'s recorded execution. Click to go there`}
            onMouseEnter={() => setLinkHover(source as FrameId)} onMouseLeave={() => setLinkHover(null)} onClick={() => { setLinkHover(null); setPendingFrameFocus(source as FrameId); }}>
            <span className="proxy-link-kicker">LINKED</span><Icon name="arrow" size={11} /><b>{name}</b></button>
        </>,
        content: <ExecutionFrame executable={target.executable ? syncScene(target.executable, target.scene) : ""} steps={execution.steps} step={execution.step} restore={execution.restore}
          analysis={view.analysis} plan={execution.plan} shown={execution.shown} marks={view.marks} markColor={MARK_COLOR} busy={view.busy} status={view.status} overlayStatus={view.overlayStatus}
          layer={manip ? manipLayer(manip) : undefined}
          onSelect={execution.select} onOverlayStatus={execution.setOverlayStatus} onError={message => updatePanel(source, { runtimeError: message })} />,
        below: manip ? manipPanel(manip) : undefined }];
    })() : []),
  ].filter(frame => (frame.id !== "source" || !workspace.hiddenFrames.includes("source")) && !hiddenExamples.has(frame.id));
  // Frame groups with the frames on the board; grouped frames hang off nothing (no lines to the frame they came from).
  const boardGroups = liveGroups(workspace.groups, new Set(frames.map(frame => frame.id)));
  // Frames that left the board leave their groups; a group with none left goes.
  const boardIds = frames.map(frame => frame.id).join("|");
  // Hidden frames keep their group (they come back to it).
  useEffect(() => { const ids = new Set([...boardIds.split("|"), ...hiddenExamples, ...proxyFrames.filter(proxy => proxy.hidden).map(proxy => proxy.id)]);
    setWorkspace(current => { const next = liveGroups(current.groups, ids); return JSON.stringify(next) === JSON.stringify(current.groups) ? current : { ...current, groups: next }; }); }, [boardIds]);

  // A node's frame that has widgets (made before frames were per constraint): split it into a frame per constraint.
  useEffect(() => {
    const whole = proxyFrames.find(proxy => !proxy.constraintId && !proxy.hidden && (() => { const node = panels[proxy.targetFrameId] && findNode(panels[proxy.targetFrameId].scene, proxy.nodeId); return Boolean(node && proxyGroups(node.constraints).length); })());
    if (whole) openProxy(whole.targetFrameId, whole.nodeId, false);
  }, [proxyFrames, panels]);

  // ── Inspector (right) ──────────────────────────────────────────────────────
  /** Frame handles are played with the Select tool: making one switches to it. */
  /** Errors of this node's handles that still apply (its code has not changed since). */
  const nodeHandleErrors = (frameId: string, current: NonNullable<typeof node>) => Object.fromEntries(current.constraints.flatMap(item => item.params).flatMap(param => {
    const error = handleErrors[`${frameId}:${current.id}:${param.id}`];
    return error && param.handle?.prepared === error.code ? [[param.id, error.message]] : [];
  }));
  const statusLabel = liveStatus === "live" ? panel.dirtyNodeIds.length ? "Live · descriptions changed, regenerate to apply" : "Live · controls update code & visual" : liveStatus === "changed" ? "Structure changed · update code to connect" : generated ? "Connect controls to your current code" : "Generate code to enable live controls";
  const paramsStage = <>
    {stale && <div className="stale-banner">{sourceSketch ? `The source sketch (${sourceSketch.name}) changed. Extract again from the source to extract into a new frame.` : "The sketch changed. Extract again to extract into a new frame."}</div>}
    {scene.nodes.length > 0 && <div className={`live-controls-status status-${liveStatus}`} role="status"><span className="status-dot" />{statusLabel}</div>}
    {scene.nodes.length > 0 && <button className="primary-button rules-generate-button" disabled={busy} onClick={() => { void ai.generateCode(); }}>{generated && (liveStatus !== "live" || panel.dirtyNodeIds.length) ? "Update code" : generated ? "Regenerate code" : "Generate code"}<Icon name="code" size={17} /></button>}
    {panel.runtimeError && generated && <div className="runtime-error" role="alert">{panel.runtimeError}<button disabled={busy} onClick={() => { void ai.generateCode(true); }}>Fix with AI</button></div>}
    {node && nodeRole && <BrushRoleBanner role={nodeRole} nodeName={node.name} masterFrame={masterFrame(nodeRole.brush)} onMaster={() => goToMaster(nodeRole.brush)}
      onDetach={() => detachInstance(activeSketch, nodeRole.rootId, nodeRole.brush.id)} onAdopt={() => adoptMaster(activeSketch, nodeRole.rootId, nodeRole.brush.id)}
      onDelete={busy ? undefined : () => { edits.removeIds([nodeRole.rootId]); setToast(nodeRole.master ? `Deleted the master of ${nodeRole.brush.name}. The brush can still be used from its saved copy (undo in Layers).` : `Deleted the ${nodeRole.brush.name} brush stamp (undo in Layers).`); }} />}
    {node ? (() => { const transform = (apply: () => void) => guard(node.id, "constraint", apply), machine = (apply: () => void) => guard(node.id, "state machine", apply);
      return <ConstraintInspector node={node} constraints={inspectedConstraints(panel, node)} state={nodeState} busy={busy}
      onNode={patch => "description" in patch ? guard(node.id, "description", () => edits.editNode(node.id, patch)) : edits.editNode(node.id, patch)} onConstraint={(id, patch) => transform(() => edits.editConstraint(node.id, id, patch))}
      onAddConstraint={() => transform(() => edits.addConstraint(node.id))} onRemoveConstraint={id => transform(() => edits.removeConstraint(node.id, id))} onMoveConstraint={(id, offset) => transform(() => edits.moveConstraint(node.id, id, offset))}
      onStateConstraint={(id, included) => nodeState && machine(() => edits.stateConstraint(node.id, nodeState.id, id, included))} onChooseState={stateId => edits.chooseState(node.id, stateId)}
      onState={patch => nodeState && machine(() => edits.editState(node.id, nodeState.id, patch))} onTransition={(id, patch) => machine(() => edits.editTransition(node.id, id, patch))}
      onScalar={(paramId, path, value) => edits.scalar(node.id, paramId, path, value)} onDragOff={(constraintId, index, off) => edits.dragOff(node.id, constraintId, index, off)}
      onParam={(paramId, patch) => transform(() => edits.editParam(node.id, paramId, patch))} onRemoveParam={paramId => transform(() => edits.removeParam(node.id, paramId))}
      onAddParam={constraintId => transform(() => edits.addParam(node.id, constraintId))} onRegenerate={target => transform(() => updatePanel(activeSketch, { transformDraft: { nodeId: node.id, target, instruction: "", annotating: false, marks: [] } }))}
      draft={panel.transformDraft?.nodeId === node.id ? panel.transformDraft : null}
      onDraftChange={patch => updatePanel(activeSketch, previous => previous.transformDraft ? { transformDraft: { ...previous.transformDraft, ...patch } } : {})}
      onDraftSubmit={() => { const draft = panel.transformDraft; if (!draft) return; updatePanel(activeSketch, previous => previous.transformDraft ? { transformDraft: { ...previous.transformDraft, annotating: false } } : {}); void ai.regenerate(draft.nodeId, draft.target, draft.instruction, draft.marks); }}
      onDraftCancel={() => updatePanel(activeSketch, { transformDraft: null })}
      onMinimalExample={constraintId => { void ai.minimalExample(node.id, constraintId); }}
      highlightConstraintId={layerPick(activeSketch)?.nodeId === node.id ? layerPick(activeSketch)!.constraintId : null}
      onHandle={(paramId, handle) => edits.handle(node.id, paramId, handle)} onDesignHandles={(target, instruction) => { void ai.suggestHandles(node.id, target, instruction); }}
      onOpenProxy={() => openProxy(activeSketch, node.id)} handleErrors={nodeHandleErrors(activeSketch, node)}
      onGenerateMachine={() => machine(() => { void ai.generateMachine(node.id); })} onRemoveMachine={() => machine(() => edits.removeMachine(node.id))} />; })()
      : <><div className="section-kicker">LOOK A LITTLE CLOSER</div><h2>Every sketch is<br />a set of systems.</h2>
        <p className="section-description">{scene.nodes.length ? "Select a brush stamp or object in Layers or on the sketch to edit its constraint." : "Draw or attach a photo, then extract its collections and objects."}</p>
        {!scene.nodes.length && <div className="empty-features"><Icon name="layers" size={30} /><p>No brush stamps yet.</p><span>Sketch → Extract → Explore</span>
          {/* What to extract and how: sent with Extract, and kept as the direction of the extracted frame's code. */}
          <label className="refinement-input extract-direction"><span>EXTRACTION DIRECTION <small>optional</small></span><textarea aria-label="Extraction direction" placeholder="e.g. what to focus on or leave out, how the parts group, how it is made…" value={panel.instruction} maxLength={2000} onChange={e => patchActive({ instruction: e.target.value })} /></label>
          <label className="composition-tags-toggle" title="Before extracting, the AI asks about what is still ambiguous in the sketch (only what would change the result)">
            <input type="checkbox" checked={clarifyFirst} onChange={e => setClarifyFirst(e.currentTarget.checked)} />Clarify first</label>
          <button className="primary-button" disabled={!sourcePresent || busy} onClick={() => { void ai.extract(); }}>Extract {currentSelection ? "selection" : "sketch"}<Icon name="spark" size={17} /></button></div>}
        {scene.nodes.length > 0 && <button className="copy-button" disabled={busy || !sourcePresent} title="Extracts again with “Your direction” below" onClick={() => { void ai.extract(); }}>Re-extract {currentSelection ? "selection" : "sketch"}</button>}
      </>}
  </>;

  return <div className="studio live-studio freeform-studio scene-studio">
    <header className="topbar"><a className="brand" href="/" aria-label="GenTool home"><span className="brand-mark"><i /><i /><i /></span>GenTool<span className="beta">LAB</span></a><div className="project-title"><span className="slash">/</span><input aria-label="Project name" value={artwork.name} maxLength={200} onChange={e => setArtwork(a => ({ ...a, name: e.target.value }))} /><span className="saved-dot" /><span className="saved-label">{saveState}</span></div><div className="top-actions"><button className="text-button" onClick={() => setHistoryOpen(true)}>AI history<Icon name="undo" size={14} /></button><button className="text-button" onClick={() => setExportOpen(true)}>Export project <Icon name="download" size={14} /></button><button className="text-button" onClick={() => importInput.current?.click()}>Open JSON</button><button className="text-button" onClick={() => { setNewName(""); setModal(true); }}>New exploration <Icon name="plus" size={15} /></button></div></header>
    <input ref={upload} className="visually-hidden" type="file" accept="image/png,image/jpeg,image/webp" aria-label="Attach photograph" onChange={e => { if (e.target.files?.[0]) void attach(e.target.files[0]); e.target.value = ""; }} />
    <input ref={importInput} className="visually-hidden" type="file" accept=".json" aria-label="Open project JSON" onChange={async e => { const file = e.target.files?.[0]; e.target.value = ""; if (!file) return; try { if (file.size > 12_000_000) throw new Error("The project file is too large."); restore(projectSchema.parse(JSON.parse(await file.text()))); } catch { patchActive({ error: "Choose a valid Rulegen project JSON file." }); } }} />
    <div className="workspace">
      <ToolRail marking={tool === "inspect-mark"} canMark={Boolean(execution.view)} onMark={() => { if (tool === "inspect-mark") chooseTool("select"); else { if (execution.view) activateSketch(execution.view.frameId); chooseTool("inspect-mark"); } }}
        inspecting={Boolean(execution.view)} canInspect={Boolean(panels[activeSketch]?.generated && panels[activeSketch]?.executable)} onInspect={() => { if (execution.view && execution.view.frameId !== activeSketch) execution.close(); execution.open(activeSketch); }}
        tool={tool} toolsActive pencilOpen={pencilOpen} color={color} width={width} opacity={opacity} pens={drawingPens} activePen={activeSemanticPen} penSettingsOpen={penSettingsOpen}
        busy={busy} canAddSketch={!busy && (sketchFrames.length < MAX_SKETCH_FRAMES || workspace.hiddenFrames.includes("source"))} canUndo={canUndo} canRedo={canRedo} canClear={!(annotating && (busy || !annotations.length))} zoom={workspace.camera?.zoom || .4}
        onTool={chooseTool} onPencilClose={() => setPencilOpen(false)} onColor={setColor} onWidth={setWidth} onOpacity={setOpacity}
        onPen={pen => { if (tool === "semantic" && activeSemanticPenId === pen.id) { setPenSettingsOpen(open => !open); setPencilOpen(false); } else selectDrawingPen(pen); }}
        onPenChange={editDrawingPen} onPenRemove={pen => { setSemanticPens(current => current.filter(item => item.id !== pen.id)); setActiveSemanticPenId(null); setTool("pen"); setPenSettingsOpen(false); }} onPenSettingsClose={() => setPenSettingsOpen(false)}
        onUndo={undo} onRedo={redo} onClear={clearCanvas} onZoom={amount => workspaceCanvas.current?.zoom(amount)} onFit={() => workspaceCanvas.current?.fit()}
        onHome={() => workspaceCanvas.current?.fit()} onAddSketch={addSketchFrame} onAttach={() => upload.current?.click()}
        brushes={brushes} groupTools={groupTools} openGroup={openGroup} onBrushPanel={toggleBrushPanel} onBrushGroup={clickBrushGroup} onBrushHover={setBrushHover} onBrushTool={chooseBrushTool} onBrushGroupClose={() => setOpenGroup(null)}
        onBrushChange={brush => setBrushes(brushesRef.current.map(item => item.id === brush.id ? brush : item))} onBrushRemove={removeBrush} brushMaster={masterFrame}
        keptTools={brush => { const frameId = brush.sourceFrameId, sets = panels[frameId]?.keptTools ?? []; return sets.length ? { frameId, sets: sets.map(set => ({ id: set.id, concern: set.concern, rule: set.rule, tools: set.tools, shown: set.strokes.length })) } : null; }}
        keptActive={kept.active} keptHidden={kept.hidden} onKeptToggleMarks={kept.toggleMarks} keptSelected={Boolean(kept.selected)} keptStatus={kept.status}
        onKeptTool={(frameId, setId, keptTool) => { activateSketch(frameId); setPenSettingsOpen(false); setPencilOpen(false); setTool("select"); kept.use(frameId, setId, keptTool); }}
        onKeptGeneralize={(frameId, setId) => { const source = kept.generalizeSource(frameId, setId); if (source) { activateSketch(frameId); generalize.start(source); } }}
        onKeptClear={kept.clear} onKeptRemove={kept.remove} onKeptRemoveSelected={kept.removeSelected} onBrushMaster={brush => { setOpenGroup(null); goToMaster(brush); }}
        onHelp={() => setToast("V Select/move · P Pencil · E Eraser · L Lasso · H Pan · ⌘/Ctrl+G Group · ⇧⌘G Ungroup · Delete Delete layer · Arrows Move · ⌘/Ctrl+Z Undo · ⌘/Ctrl+V Paste image · Esc Deselect")} />
      <aside ref={layerPanel} className={`layer-sidebar ${layerWidth ? "layer-sidebar-resized" : ""}`} style={layerWidth ? { "--layer-width": `${layerWidth}px` } as React.CSSProperties : undefined}>
        <PanelResizer edge="right" label="Resize layers panel" min={LAYER_MIN_WIDTH} max={LAYER_MAX_WIDTH}
          measure={() => layerPanel.current?.getBoundingClientRect().width || 236} onResize={setLayerWidth} onReset={() => setLayerWidth(null)} />
        <LayerPanel scene={scene} sketchId={activeSketch} selected={panel.selectedNodeIds} hovered={panel.hovered} busy={busy} canUndo={panel.sceneHistory.length > 0} canRedo={panel.sceneFuture.length > 0} title={currentSketch.name}
          onSelect={edits.select} onHover={edits.hover}
          onRename={edits.rename} onToggleVisible={edits.toggleVisible} onGroup={edits.group} onUngroup={edits.ungroup} onDelete={edits.remove}
          onMove={edits.reparent} onReorder={edits.reorder} onAdd={edits.add} onUndo={edits.undo} onRedo={edits.redo}
          onExtract={() => { void ai.extract(); }} canExtract={sourcePresent}
          pickedConstraint={layerPick(activeSketch)}
          onPickConstraint={(nodeId, constraintId) => { edits.select(nodeId, false); setLayerConstraint({ frameId: activeSketch, nodeId, constraintId }); }}
          onMoveConstraint={(fromNodeId, constraintId, toNodeId, beforeId) => guardEach([fromNodeId, toNodeId], "constraint", () => {
            edits.relocateConstraint(fromNodeId, constraintId, toNodeId, beforeId);
            // In another node its id may change, so the pick is let go.
            if (fromNodeId !== toNodeId) setLayerConstraint(null);
          })}
          onRemoveConstraint={(nodeId, constraintId) => guard(nodeId, "constraint", () => edits.removeConstraint(nodeId, constraintId))}
          copied={constraintClip?.label ?? null} onCopyConstraint={copyLayerConstraint} onPasteConstraint={(nodeId, afterId) => { pasteLayerConstraint({ nodeId, afterId }); }}
          badge={id => { const role = brushRole(scene, activeSketch, id, brushes); if (role?.rootId === id) return <BrushRoleBadge role={role} />;
            // A drawn form at the root that is no brush yet (e.g. one taken for a background before): it can be made one.
            const node = !role && panel.generated ? findNode(scene, id) : undefined;
            return node && !node.parentId && !isBackdrop(node) ? <button type="button" className="layer-make-brush" title="Make this a brush in the toolbar (brush it onto frames)"
              onClick={e => { e.stopPropagation(); makeBrush(activeSketch, id); }}>+ Brush</button> : null; }} />
      </aside>
      <main className="canvas-workspace">
        <FreeformWorkspace ref={workspaceCanvas} highlight={linkHover}
          links={[...exampleLinks, ...(execution.view?.framed && panels[execution.view.frameId]?.generated ? [{ from: execution.view.frameId as FrameId, to: execFrameId(execution.view.frameId) as FrameId, label: "▶ execution" }] : []), ...(manipulation.view?.fork && artworkOf(manipulation.view.fork) ? [{ from: manipulation.view.frameId as FrameId, to: manipulation.view.fork as FrameId, label: "⑂ temporary fork" }] : []), ...proxyFrames.filter((proxy, i, all) => !proxy.hidden && all.findIndex(other => !other.hidden && other.targetFrameId === proxy.targetFrameId && other.nodeId === proxy.nodeId) === i).map(proxy => ({ from: proxy.id as FrameId, to: proxy.targetFrameId as FrameId, label: "◎ Control" }))].filter(link => !hiddenExamples.has(link.from) && !hiddenExamples.has(link.to))} groups={boardGroups} onDeleteGroup={deleteGroup} onDeleteFrame={deleteFrame} deleteDisabled={busy} layout={workspace} onChange={setWorkspace} activeFrame={activeSketch as FrameId} tool={tool}
          onActivateFrame={id => activateFrame(id)} masterHighlight={masterHighlight} selectedFrames={pickedFrames.filter(id => frames.some(frame => frame.id === id))} onSelectFrames={setPickedFrames}
          onBackground={() => { setPencilOpen(false); setPenSettingsOpen(false); }} onDrop={file => { void attach(file); }} frames={frames} />
        <footer className="workspace-footer"><span><span className="status-dot" />{configured ? `Connected · ${model}` : configured === false ? "OpenAI configuration required" : "Connecting…"}</span><span>FREEFORM · P5.JS</span></footer>
      </main>
      <aside ref={inspectorPanel} className={`inspector ${inspectorWidth ? "inspector-resized" : ""}`} style={inspectorWidth ? { "--inspector-width": `${inspectorWidth}px` } as React.CSSProperties : undefined}>
        <PanelResizer label="Resize params panel" min={280} max={Math.max(320, Math.min(900, (typeof window === "undefined" ? 1400 : window.innerWidth) - 520))}
          measure={() => inspectorPanel.current?.getBoundingClientRect().width || 354} onResize={setInspectorWidth} onReset={() => setInspectorWidth(null)} /><div className="inspector-title"><span aria-label="Inspector sketch" title={currentSketch.name}>{node ? `${currentSketch.name} / ${node.name}` : currentSketch.name}</span><Icon name="spark" size={17} /></div>
        {panel.loading && <div className="loading-banner" role="status"><span className="loading-spinner" /><span>{panel.loading}</span><button onClick={() => cancel()}>Cancel</button></div>}{panel.error && <div className="error-banner" role="alert"><span>{panel.error}</span><button aria-label="Dismiss error" onClick={() => patchActive({ error: "" })}><Icon name="close" size={14} /></button></div>}
        <div ref={inspector} className="inspector-content live-inspector-content">
          {!annotating && panel.sketchClarify && <SketchClarifyPanel open={panel.sketchClarify} busy={busy} drawings={clarifyDrawings}
            onPoint={(questionId, optionId) => setClarifyPoint(current => optionId ? { questionId, optionId } : current?.questionId === questionId ? null : current)} onAnswer={ai.answerClarify} onContinue={() => { void ai.continueClarify(); }}
            onFinish={() => { void ai.finishClarify(); }} onAskAnyway={() => { void ai.askAnyway(); }} onCancel={ai.cancelClarify} />}
          {!annotating && !panel.sketchClarify && <SketchComposition clarifyFirst={clarifyFirst} onClarifyFirst={setClarifyFirst} artwork={currentSketch} prompt={panel.composePrompt} onPrompt={value => patchActive({ composePrompt: value })} tags={panel.composeTags.length} showTags={showComposeTags} onShowTags={setShowComposeTags}
            withText={panel.composeWithText} onWithText={on => { patchActive({ composeWithText: on }); if (!on) setShowComposeTags(true); }} tagsStale={panel.composeTagsRevision !== currentSketch.revision}
            tagList={panel.composeTags} openTag={openTags[activeSketch] ?? null} onHoverTag={tagId => setPointedTag(tagId ? { frameId: activeSketch, id: tagId } : null)}
            canMoveTag={tagStructure(activeSketch).canMove} onMoveTag={tagStructure(activeSketch).onMove} onDeleteTag={tagStructure(activeSketch).onDelete} onAddTag={tagStructure(activeSketch).onAdd} onMoveConstraint={tagStructure(activeSketch).onMoveConstraint}
            onPickTag={tagId => { setShowComposeTags(true); setOpenTags(current => ({ ...current, [activeSketch]: current[activeSketch] === tagId ? null : tagId })); setPendingFrameFocus(activeSketch as FrameId); }} onDraft={() => { void ai.draftComposePrompt(); }} onCompose={() => { void ai.compose(); }} busy={busy} drafting={panel.loading === compositionPromptLabel} />}
          {annotating && <ResultRevisionPanel hasSketch={Boolean(annotations.length)} clarifying={panel.clarifying} onClarify={() => { void revisions.beginClarification(); }} onRegenerateClarification={() => { void revisions.requestClarification(); }} generatingClarification={panel.loading === clarificationLabel} clarificationStale={Boolean(panel.clarificationContext && panel.clarificationContext !== revisionSnapshot(panel, ""))} onSketch={() => patchActive({ clarifying: false })} instruction={panel.revisionInstruction} proposal={panel.revisionProposal?.proposal || null} changes={proposalChanges} stale={proposalStale} busy={busy} tool={tool} canUndo={panel.annotationHistory.past.length > 0} canRedo={panel.annotationHistory.future.length > 0} onTool={chooseTool} onUndo={undo} onRedo={redo} onInstruction={value => patchActive({ revisionInstruction: value })} onRequest={() => { void revisions.requestRevision(); }} onConfirm={() => { void revisions.confirmRevision(); }} onDiscard={() => patchActive({ revisionProposal: null })} onClose={() => patchActive({ annotating: false })} />}
          {paramsStage}
          {scene.nodes.length > 0 && <label className="refinement-input"><span>YOUR DIRECTION <small>optional</small></span><textarea aria-label="Generation direction" placeholder="e.g. more organic, less repetition, in blue…" value={panel.instruction} maxLength={2000} onChange={e => patchActive({ instruction: e.target.value })} /></label>}
        </div><div className="inspector-footer"><span className="tiny-dot" />Built for exploration, not perfection.</div></aside>
    </div>
    <RawCodePanel code={liveSource} sketchName={currentSketch.name} fileName={generated?.title || currentSketch.name} onCopy={() => setToast("Copied the p5.js code.")} onError={message => patchActive({ error: message })}
      editor={{ draft: panel.codeDraft || "", busy, runtimeError: panel.runtimeError, onDraft: value => patchActive({ codeDraft: value }),
        onRun: () => { if (!generated) return; if (generated.code === panel.codeDraft) void prepare(panel.codeDraft); else patchActive({ generated: { ...generated, code: panel.codeDraft || "" }, executable: "", preparedCode: "" }); patchActive(previous => ({ renderRevision: previous.renderRevision + 1 })); },
        onFix: () => { void ai.generateCode(true); } }}
      machinePanel={<NodeMachinePanel scene={scene} node={machineNode}
        editingStateId={machineNode ? panel.editingStates[machineNode.id] || null : null} runtimeStateId={machineNode ? panel.runtimeStates[machineNode.id] || null : null}
        playing={panel.machinePlaying} busy={busy} hasCode={Boolean(generated)}
        target={machineNode && panel.machineTarget?.nodeId === machineNode.id ? { kind: panel.machineTarget.kind, id: panel.machineTarget.id } : null} draft={panel.machineDraft}
        onSelectNode={id => edits.select(id)}
        onState={stateId => { if (!machineNode) return; edits.chooseState(machineNode.id, stateId); patchActive({ machineTarget: { nodeId: machineNode.id, kind: "state", id: stateId } }); }}
        onTransition={transitionId => machineNode && patchActive({ machineTarget: { nodeId: machineNode.id, kind: "transition", id: transitionId } })}
        onClearTarget={() => patchActive({ machineTarget: null })}
        onDeselect={() => { if (!machineNode) return; patchActive(previous => { const editingStates = { ...previous.editingStates }; delete editingStates[machineNode.id]; return { machineTarget: null, editingStates }; }); }}
        layout={machineNode ? panel.machineLayouts[machineNode.id] : undefined}
        onLayout={next => machineNode && patchActive(previous => { const machineLayouts = { ...previous.machineLayouts }; if (next) machineLayouts[machineNode.id] = next; else delete machineLayouts[machineNode.id]; return { machineLayouts }; })} onDraft={draft => patchActive({ machineDraft: draft })} onError={message => patchActive({ error: message })}
        onRefine={request => { if (machineNode) guard(machineNode.id, "state machine", () => { void ai.refineMachine(machineNode.id, request); }); }}
        onGenerate={() => { if (machineNode) guard(machineNode.id, "state machine", () => { void ai.generateMachine(machineNode.id); }); }} onPlay={playing => patchActive({ machinePlaying: playing })}
        onRestart={() => machineNode && restartMachine(machineNode.id)} onEvent={transitionId => machineNode && emitTransition(machineNode.id, transitionId)}
        inspected={execution.view?.frameId === activeSketch ? execution.machine(machineNode?.id ?? null) : null} />}
      inspectionPanel={execution.view ? <ExecutionPanel thumbnails={stepThumbnails} brushName={artworkOf(execution.view.frameId)?.name || "Frame"} trace={execution.view.trace} recording={!execution.step}
        steps={execution.steps} step={execution.step} analysis={execution.view.analysis} busy={execution.view.busy} status={[execution.view.status, execution.step ? execution.view.overlayStatus : ""].filter(Boolean).join(" ")}
        skipped={execution.skipped} onSelect={execution.select} onInspect={(concern, plan) => { if (plan.stepping) void execution.inspect(concern); else if (plan.fork) void execution.direct(concern, plan.fork === "tools"); if (plan.sandbox) void execution.sandbox(concern); }} marks={execution.view.marks.length} onClearMarks={execution.clearMarks} onClearAnalysis={execution.clearAnalysis} onClearTrace={execution.clearTrace} onClose={execution.close} /> : undefined} />
    {detachPrompt && (() => { const brush = brushes.find(item => item.id === detachPrompt.brushId); if (!brush) return null;
      const close = () => setDetachPrompt(null);
      return <DetachDialog prompt={detachPrompt} brushName={brush.name} masterFrame={masterFrame(brush)} onCancel={close}
        onDetach={() => { close(); if (detachInstance(detachPrompt.frameId, detachPrompt.rootId, brush.id)) detachPrompt.apply(); }}
        onMaster={() => { close(); goToMaster(brush); }}
        onAdopt={() => { close(); if (adoptMaster(detachPrompt.frameId, detachPrompt.rootId, brush.id)) detachPrompt.apply(); }} />; })()}
    {confirmAsk && <ConfirmDialog prompt={confirmAsk.prompt} onAnswer={answer => { setConfirmAsk(null); confirmAsk.answer(answer); }} />}
    {toast && <div className="toast" role="status"><Icon name="spark" size={17} /><span>{toast}</span><button aria-label="Dismiss notification" onClick={() => setToast("")}><Icon name="close" size={15} /></button></div>}
    {historyOpen && <GenerationHistory disabled={busy} onClose={() => setHistoryOpen(false)} onRestore={restoreAIHistory} onReuseTools={tools => { void reuseTools(tools); }} />}
    {frameJson && panels[frameJson] && <FrameJsonDialog name={artworkOf(frameJson)?.name || frameJson} onClose={() => setFrameJson(null)} onCopied={setToast}
      data={frameExport({ id: frameJson, name: artworkOf(frameJson)?.name || frameJson, scene: panels[frameJson].scene, generated: panels[frameJson].generated,
        brushOf: nodeId => { const role = brushRole(panels[frameJson].scene, frameJson, nodeId, brushes); return role ? { name: role.brush.name, master: role.master } : null; },
        brushes: brushes.filter(brush => brushNodeIds(panels[frameJson].scene, brush, frameJson).length).map(brush => ({ id: brush.id, name: brush.name, roots: brushRoots(panels[frameJson].scene, brush, frameJson) })) })} />}
    {exportOpen && <div className="modal-backdrop" onClick={() => setExportOpen(false)}><div className="modal project-export-modal" role="dialog" aria-modal="true" aria-labelledby="export-title" onClick={e => e.stopPropagation()}><button className="modal-close" aria-label="Close export dialog" onClick={() => setExportOpen(false)}><Icon name="close" /></button><div className="section-kicker">KEEP YOUR EXPLORATION</div><h2 id="export-title">Take your project with you.</h2><p>Sketches, photos, Collections, Objects, constraints, and code are saved together. You can download or copy them as a JSON file.</p><textarea aria-label="Exported project JSON" className="project-json-preview" readOnly value={JSON.stringify(projectData(), null, 2)} /><button className="primary-button" onClick={() => downloadFile(`${artwork.name}.rulegen.json`, JSON.stringify(projectData(), null, 2), "application/json")}>Download project JSON<Icon name="download" /></button><button className="alternative-button" onClick={async () => { try { await navigator.clipboard.writeText(JSON.stringify(projectData(), null, 2)); setToast("Copied the project JSON."); } catch { patchActive({ error: "Select the JSON text to copy it, or download it." }); } }}>Copy project JSON<Icon name="copy" size={15} /></button></div></div>}
    {modal && <div className="modal-backdrop" onClick={() => setModal(false)}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="new-title" onClick={e => e.stopPropagation()}><button className="modal-close" aria-label="Close dialog" onClick={() => setModal(false)}><Icon name="close" /></button><div className="section-kicker">A FRESH PERSPECTIVE</div><h2 id="new-title">What will you explore?</h2><p>Starting a new exploration replaces the current local draft. Export it as JSON to reopen it anytime.</p><label>Exploration name<input autoFocus value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === "Enter" && newProject()} /></label><button className="primary-button" onClick={newProject}>Start exploring<Icon name="arrow" /></button></div></div>}
  </div>;
}
