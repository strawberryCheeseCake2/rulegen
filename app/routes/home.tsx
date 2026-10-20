import { useEffect, useRef, useState } from "react";
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
import { LayerPanel } from "../components/scene/layer-panel";
import { SceneOverlay } from "../components/scene/scene-overlay";
import { ProxyFrame } from "../components/proxy-frame";
import { ADJUST_IN_PLACE_INSTRUCTION, bakesInput, isProxyFrame, MAX_PROXY_FRAMES, proxyFor, type ProxyFrame as ProxyFrameData } from "../lib/proxy-frames";
import { PropertyInspector } from "../components/scene/property-inspector";
import { PanelResizer } from "../components/panel-resizer";
import { AlgorithmLibrary, type AlgorithmSource } from "../components/scene/algorithm-library";
import { NodeMachinePanel } from "../components/scene/node-machine-panel";
import { InspectionPanel } from "../components/inspection-panel";
import { InspectionOverlay } from "../components/inspection-overlay";
import { brushesFor, brushGroup, brushNodeIds, brushRole, brushRoots, subBrushFor, brushTool, detachedBrush, frameIds, isInspectionTool, MAX_BRUSHES, MAX_TARGETED, parseBrushTool, sharedIds, type Brush, type TargetedTool } from "../lib/brushes";
import { addMark, addStep, DEFAULT_MARK_STYLE, eraseStyledMarks, filterValues, machineInspection, markStyleAt, markStyleSchema, remapResult, resultInFrame, type InspectionFocus, type InspectionState, type MarkStyle, type Recommendation } from "../lib/inspection";
import { BrushRoleBadge, BrushRoleBanner, DetachDialog, type DetachPrompt } from "../components/brush-role";
import { subScene } from "../lib/scene/graph";
import { sceneValues } from "../lib/scene/values";
import { prepareBrushFor, startBrushGesture } from "../studio/brush-actions";
import { programModules } from "../lib/scene/machines";
import { acceptParameter, applyChanges, applyRecording, applyRecommendation, appliedCurrent, concernMarksKey, inspectConcern, suggestConcerns, inspectionFor, recommendationKey, stepApplied, targetedName, withInspection } from "../studio/inspection-actions";
import type { TraceStep } from "../components/code-preview";
import { besideFramePosition, nextSketchPosition, removeWorkspaceFrame, showWorkspaceFrame, workspaceSchema, type FrameId, type WorkspaceLayout } from "../lib/workspace";
import { annotationHistoryReducer } from "../lib/annotation-history";
import { type RecoveredGeneration } from "../lib/generation-recovery";
import type { Artwork, SemanticPen, Stroke, Viewport } from "../lib/schema";
import { type SketchFrame, projectSchema, exampleStrokes, readPhoto, downloadFile } from "../lib/project";
import { createInteractionPen, semanticPenColors } from "../lib/algorithm-pens";
import { createSketchPanel, clearedResultAnnotations, savedSketchPanels, type SketchPanel } from "../lib/sketch-panels";
import { emptyScene } from "../lib/scene/schema";
import { algorithmClosure, instantiate } from "../lib/scene/algorithms";
import { findNode } from "../lib/scene/graph";
import { syncScene } from "../lib/scene/machines";
import { liveSceneSource, sceneLiveStatus } from "../lib/scene/live";
import { editingState, inspectedNode, inspectedTransformations, commitScene } from "../lib/scene/panel-ops";
import { penAlgorithm } from "../lib/scene/pens";
import { markLogged, reportError } from "../lib/error-report";
import { sceneChanges } from "../lib/scene/revisions";
import type { StudioDeps, PanelPatch } from "../studio/deps";
import { compositionPromptLabel, dropNode, sceneAI, sceneEdits } from "../studio/scene-actions";
import { NODE_DRAG_TYPE, readNodeDrag, type AlgorithmClip } from "../lib/scene/transfer";
import { clarificationLabel, revisionActions, revisionSnapshot } from "../studio/revision-actions";

export function meta({}: Route.MetaArgs) { return [{ title: "Rulegen — From a mark to a system" }, { name: "description", content: "Draw, extract collections and objects, and create p5.js systems with AI." }]; }
const blank = (): Artwork => ({ strokes: [], photo: null, name: "Untitled exploration", revision: 0 });
const storageKey = "rulegen.project.v1";
const drawingViewport: Viewport = { zoom: 1, x: 0, y: 0 };

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
  // Brushes: reusable collections, each a tool group (brush + inspection tools) in the toolbar.
  const [brushes, setBrushesState] = useState<Brush[]>([]);
  const brushesRef = useRef(brushes);
  const setBrushes = (next: Brush[]) => { brushesRef.current = next; setBrushesState(next); };
  // The tool each group shows (a toolbar tool id), so a group remembers its last tool.
  const [groupTools, setGroupTools] = useState<Record<string, string>>({}), [openGroup, setOpenGroup] = useState<string | null>(null);
  const brushPick = parseBrushTool(tool), activeBrush = brushPick ? brushes.find(brush => brush.id === brushPick.brushId) : undefined;
  const activeTargeted = brushPick?.kind === "targeted" ? activeBrush?.targeted.find(item => item.id === brushPick.targetedId) : undefined;
  const inspectionKind = activeBrush && isInspectionTool(brushPick!.kind) && (brushPick!.kind !== "targeted" || activeTargeted) ? brushPick!.kind : null;
  // The brush tool plays with the brush on the active frame that has it (interaction); `placing` is a frame whose brush gesture is still being fed in.
  const playingBrush = brushPick?.kind === "brush" ? activeBrush : undefined;
  const [placing, setPlacing] = useState<string | null>(null);
  // The inspection annotation pen: color, width and opacity of the next marks (remembered in this browser).
  const [inspectionPen, setInspectionPenState] = useState<MarkStyle>(DEFAULT_MARK_STYLE);
  const [concernSuggest, setConcernSuggest] = useState<{ key: string; items: string[]; loading: boolean; error: string }>({ key: "", items: [], loading: false, error: "" });
  useEffect(() => { try { const saved = markStyleSchema.safeParse(JSON.parse(localStorage.getItem("rulegen.inspectionPen") || "null")); if (saved.success) setInspectionPenState(saved.data); } catch { /* storage unavailable */ } }, []);
  const setInspectionPen = (pen: MarkStyle) => { setInspectionPenState(pen); try { localStorage.setItem("rulegen.inspectionPen", JSON.stringify(pen)); } catch { /* storage unavailable */ } };
  // The inspection annotation tool draws, or (eraser) wipes out the marks it passes over.
  const [inspectionEraser, setInspectionEraser] = useState(false);
  // Proxy frames (direct manipulation handles of a node, beside its frame) and their widgets' runtime errors (with the code that failed).
  const [proxyFrames, setProxyFrames] = useState<ProxyFrameData[]>([]);
  const proxyFramesRef = useRef(proxyFrames); proxyFramesRef.current = proxyFrames;
  // The frame at the other end of a hovered proxy link (highlighted on the board).
  const [linkHover, setLinkHover] = useState<FrameId | null>(null);
  const [handleErrors, setHandleErrors] = useState<Record<string, { code: string; message: string }>>({});
  // An edit an instance could not take, waiting for detach / the master.
  const [detachPrompt, setDetachPrompt] = useState<DetachPrompt | null>(null);
  const [color, setColor] = useState("#75664e"), [width, setWidth] = useState(3), [opacity, setOpacity] = useState(80);
  const [workspace, setWorkspace] = useState<WorkspaceLayout>(() => workspaceSchema.parse({}));
  const workspaceCanvas = useRef<WorkspaceHandle>(null);
  const [pendingFrameFocus, setPendingFrameFocus] = useState<FrameId | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const resultPreviews = useRef(new Map<string, CodePreviewHandle>());
  // Studio-wide clipboard for algorithm blocks (copy in one sketch, paste in any).
  const [clip, setClip] = useState<AlgorithmClip | null>(null);
  const clipRef = useRef(clip); clipRef.current = clip;
  const [penSettingsOpen, setPenSettingsOpen] = useState(false);
  // Right panel width chosen by dragging its edge (null = responsive default); remembered per browser.
  const inspectorPanel = useRef<HTMLElement>(null);
  const [inspectorWidth, setInspectorWidth] = useState<number | null>(null);
  const [semanticPens, setSemanticPens] = useState<SemanticPen[]>([]), [activeSemanticPenId, setActiveSemanticPenId] = useState<string | null>(null);
  const [interactionPen, setInteractionPen] = useState<SemanticPen>(createInteractionPen);
  const algorithmPens = [interactionPen, ...semanticPens];
  const activeSemanticPen = algorithmPens.find(pen => pen.id === activeSemanticPenId);
  const [toast, setToast] = useState(""), [model, setModel] = useState(""), [configured, setConfigured] = useState<boolean | null>(null);
  const [restoreReady, setRestoreReady] = useState(false), [saveState, setSaveState] = useState("Local draft");
  /** The frame whose JSON (state machines, constraints, code) is shown to copy. */
  const [frameJson, setFrameJson] = useState<string | null>(null);
  /** Per frame: the stores as its held inspection step is drawn now (by restore id). */
  const [drawnStores, setDrawnStores] = useState<Record<string, { restore: string; stores: Record<string, unknown> }>>({});
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
  // While a brush is inspected, the state machine panel shows that brush in this frame (master or instance).
  const inspectedIds = inspectionKind && activeBrush ? brushNodeIds(scene, activeBrush, activeSketch) : [];
  const inspection = inspectionKind && activeBrush ? inspectionFor(panel, activeBrush.id) : null;
  const stepNode = inspection?.steps[inspection.cursor ?? inspection.steps.length - 1]?.nodeId;
  const machineNode = (node && (!inspectedIds.length || inspectedIds.includes(node.id)) ? node : undefined)
    || (stepNode && inspectedIds.includes(stepNode) && findNode(scene, stepNode)?.machine ? findNode(scene, stepNode) : undefined)
    || inspectedIds.map(id => findNode(scene, id)).find(item => item?.machine) || node || scene.nodes.find(item => item.machine);
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
    if (!response.ok || result.error) { if (result.logged) markLogged(result.error); throw new Error(result.error || "요청을 처리하지 못했습니다."); }
    return result;
  }
  async function task(label: string, work: () => Promise<void>, owner = activeSketch) {
    if (panelsRef.current[owner]?.loading) return;
    const number = (requestNumbers.current.get(owner) ?? 0) + 1; requestNumbers.current.set(owner, number); updatePanel(owner, { loading: label, error: "" });
    const current = () => number === requestNumbers.current.get(owner);
    try { await work(); } catch (e) { if (current() && !(e instanceof DOMException && e.name === "AbortError")) updatePanel(owner, { error: e instanceof Error ? e.message : "처리 중 오류가 발생했습니다." }); }
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
    if (semanticPens.length >= 32) { patchActive({ error: "툴바에 펜이 가득 찼습니다. 사용하지 않는 펜을 제거해주세요." }); return; }
    const pen = make(crypto.randomUUID(), semanticPenColors.find(c => !semanticPens.some(p => p.color === c)) || semanticPenColors[semanticPens.length % semanticPenColors.length]);
    const baseName = pen.name.slice(0, 90); let name = baseName, suffix = 2;
    while (semanticPens.some(item => item.name === name)) name = `${baseName} ${suffix++}`;
    const next = { ...pen, name };
    setSemanticPens(current => [...current, next]); selectAlgorithmPen(next);
    setToast(`${name}을 툴바에 추가했습니다. 자유롭게 그린 뒤 Compose prompt로 조합하세요.`);
  }
  /** A new sketch frame placed beside `fromId` (used for extracted/composed scenes). */
  function createFrame(fromId: string, name: string): string | null {
    if (sketchFramesRef.current.length >= 24) return null;
    const id: FrameId = `sketch-${crypto.randomUUID()}`;
    const frames = [...sketchFramesRef.current, { id, artwork: { ...blank(), name: name.slice(0, 200) } }];
    sketchFramesRef.current = frames; setSketchFrames(frames);
    setWorkspace(current => ({ ...current, frames: { ...current.frames, [id]: besideFramePosition(current.frames, fromId) } }));
    setSketchHistories(current => ({ ...current, [id]: { past: [], future: [] } }));
    mutatePanels(current => ({ ...current, [id]: createSketchPanel() }));
    return id;
  }
  /** What a frame shows: its rendered result (if any) under its strokes, as one image. */
  /** A frame created a moment ago mounts and loads p5 first, so wait (up to ~8s) until its canvas can be captured. */
  async function readyCanvas(owner: string, full: boolean) {
    const notReady = /캔버스가 준비될 때까지|사진을 불러오는 중/;
    for (let attempt = 0; ; attempt++) {
      const handle = canvasFor(owner);
      try { if (handle) return { handle, plain: handle.capture(full) }; }
      catch (error) { if (!(error instanceof Error && notReady.test(error.message)) || attempt >= 80) throw error; }
      if (!handle && attempt >= 80) throw new Error("캔버스가 준비될 때까지 잠시 기다려주세요.");
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
    addBrushes: (frameId, scene) => {
      const made = brushesFor(scene, frameId, brushesRef.current, () => crypto.randomUUID());
      if (made.length) { setBrushes([...brushesRef.current, ...made]); setToast(`${made.map(brush => brush.name).join(", ")} brush를 툴바에 추가했습니다.`); }
      return made;
    },
    openProxy: (owner, nodeId) => openProxy(owner, nodeId),
    addSubBrush: (owner, nodeId, frameId, scene, name) => {
      const ownerScene = panelsRef.current[owner]?.scene, role = ownerScene ? brushRole(ownerScene, owner, nodeId, brushesRef.current) : null;
      // Inside the group of the brush the node belongs to (its group, if that brush is a sub brush itself).
      const parent = role ? brushesRef.current.find(item => item.id === brushGroup(brushesRef.current, role.brush.id)) : undefined;
      const made = subBrushFor(scene, frameId, name, parent, brushesRef.current, crypto.randomUUID());
      if (made) setBrushes([...brushesRef.current, made]);
      return made;
    },
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
    clip: () => clipRef.current, setClip: next => { clipRef.current = next; setClip(next); }, activate: id => activateSketch(id), active: () => activeSketchRef.current,
  };
  const edits = sceneEdits(deps, activeSketch), ai = sceneAI(deps, activeSketch), revisions = revisionActions(deps, activeSketch);

  // ── Persistence and effects ────────────────────────────────────────────────
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey); if (raw) { const result = projectSchema.safeParse(JSON.parse(raw)); if (result.success) restore(result.data); else setToast("저장된 프로젝트 형식이 변경되어 새 작업실을 열었습니다."); }
    } catch { setToast("로컬 프로젝트를 불러오지 못했습니다. JSON 파일이 있다면 가져올 수 있습니다."); }
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
  useEffect(() => {
    if (brushPick && !activeBrush) setTool("pen");
    else if (brushPick?.kind === "targeted" && activeBrush && !activeTargeted) setTool(brushTool("inspect-annotate", activeBrush.id));
  }, [brushPick?.brushId, brushPick?.targetedId, activeBrush, activeTargeted]);
  // Leaving the inspection annotation tool puts its eraser away.
  useEffect(() => { if (brushPick?.kind !== "inspect-annotate") setInspectionEraser(false); }, [brushPick?.kind]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(""), 6000); return () => clearTimeout(timer); }, [toast]);
  // Widget edits only patch the host block of the code draft.
  useEffect(() => { if (generated) patchActive(previous => { const codeDraft = syncScene(previous.codeDraft || "", previous.scene); return codeDraft === previous.codeDraft ? {} : { codeDraft, runtimeError: "" }; }); }, [scene, generated]);
  useEffect(() => { inspector.current?.scrollTo({ top: 0 }); }, [node?.id, activeSketch]);
  useEffect(() => { if (pendingFrameFocus) { workspaceCanvas.current?.focus(pendingFrameFocus); setPendingFrameFocus(null); } }, [pendingFrameFocus, sketchFrames, panels]);

  // ── Concern autocomplete (inspection annotation) ──────────────────────────
  // Autocomplete asks AI to read the inspection annotation (and what has been typed)
  // and suggest concerns for this frame and brush. A newer request replaces an
  // older one; an answer for other marks, text, frames or brushes is dropped.
  const concernRun = useRef<{ id: number; controller: AbortController | null }>({ id: 0, controller: null });
  async function requestConcerns() {
    const frame = activeSketchRef.current, brush = activeBrush; if (!brush) return;
    const state = inspectionFor(panelsRef.current[frame] || panel, brush.id), scope = `${frame}|${brush.id}`, run = concernRun.current;
    run.controller?.abort();
    const controller = new AbortController(), id = ++run.id, asked = { concern: state.concern, marks: concernMarksKey(state.marks) };
    setConcernSuggest(current => ({ key: scope, items: current.key === scope ? current.items : [], loading: true, error: "" }));
    try {
      const items = await suggestConcerns(deps, frame, brush, { concern: state.concern, marks: state.marks, markStyles: state.markStyles }, controller.signal);
      const now = inspectionFor(panelsRef.current[frame] || panel, brush.id);
      if (id !== run.id) return;
      // The marks changed meanwhile: these suggestions read the old ones.
      setConcernSuggest(concernMarksKey(now.marks) === asked.marks ? { key: scope, items, loading: false, error: "" } : { key: scope, items: [], loading: false, error: "표시가 바뀌었습니다. 다시 눌러주세요." });
    } catch {
      if (id === run.id && !controller.signal.aborted) setConcernSuggest(current => ({ ...current, loading: false, error: "concern을 제안하지 못했습니다." }));
    }
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (historyOpen || modal || exportOpen || (e.target as HTMLElement).closest("input,textarea,select,[contenteditable]")) return;
      const command = e.metaKey || e.ctrlKey, key = e.key.toLowerCase();
      // Playing with a brush: the frame only takes input for its running result; Esc puts the brush down.
      if (interactingIn(activeSketch, panel)) { if (e.key === "Escape") chooseTool("select"); return; }
      if (e.key === "Escape") { setOpenGroup(null); setPencilOpen(false); setPenSettingsOpen(false); canvas.current?.clearSelection(); setModal(false); setExportOpen(false); setHistoryOpen(false); setFrameJson(null); if (tool === "select") edits.select(null); }
      if (command && key === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      else if (command && key === "y") { e.preventDefault(); redo(); }
      else if (command && key === "g" && tool === "select") { e.preventDefault(); if (e.shiftKey) { if (node?.kind === "collection") edits.ungroup(node.id); } else edits.group(); }
      else if (tool === "select" && panel.selectedNodeIds.length && (e.key === "Delete" || e.key === "Backspace")) { e.preventDefault(); edits.remove(); }
      else if (tool === "select" && panel.selectedNodeIds.length && e.key.startsWith("Arrow")) { e.preventDefault(); const step = e.shiftKey ? 10 : 1; edits.nudge((e.key === "ArrowRight" ? step : e.key === "ArrowLeft" ? -step : 0) / 900, (e.key === "ArrowDown" ? step : e.key === "ArrowUp" ? -step : 0) / 600); }
      else if (!(command || e.altKey)) { if (key === "v") chooseTool("select"); if (key === "p") chooseTool("pen"); if (key === "e") chooseTool("eraser"); if (key === "l") chooseTool("lasso"); if (key === "h") chooseTool("hand"); }
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
    setToast("AI 생성 기록을 복원했습니다.");
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
    if (sketchFrames.length >= 24) return;
    const id: FrameId = `sketch-${crypto.randomUUID()}`;
    setSketchFrames(current => [...current, { id, artwork: { ...blank(), name: `Sketch ${current.length + 2}` } }]);
    setWorkspace(current => ({ ...current, frames: { ...current.frames, [id]: nextSketchPosition(current.frames) } }));
    setSketchHistories(current => ({ ...current, [id]: { past: [], future: [] } }));
    activateSketch(id); setTool("pen"); setPencilOpen(false); setPenSettingsOpen(false); setPendingFrameFocus(id);
  }
  /** Show the proxy frame of a node, adding it beside its frame when there is none. */
  function openProxy(targetFrameId: string, nodeId: string) {
    const existing = proxyFor(proxyFramesRef.current, targetFrameId, nodeId);
    if (existing) { setPendingFrameFocus(existing.id as FrameId); return; }
    if (proxyFramesRef.current.length >= MAX_PROXY_FRAMES) { setToast(`proxy frame은 ${MAX_PROXY_FRAMES}개까지 둘 수 있습니다. 쓰지 않는 것을 지워주세요.`); return; }
    const id = `proxy-${crypto.randomUUID()}` as const, frames = [...proxyFramesRef.current, { id, targetFrameId, nodeId }];
    proxyFramesRef.current = frames; setProxyFrames(frames);
    setWorkspace(current => ({ ...current, frames: { ...current.frames, [id]: besideFramePosition(current.frames, targetFrameId) } }));
    setPendingFrameFocus(id);
  }
  /** Clicking a proxy frame works on its node: its frame becomes active with the node selected. */
  function activateFrame(id: string) {
    if (!isProxyFrame(id)) { activateSketch(id); return; }
    const proxy = proxyFramesRef.current.find(frame => frame.id === id); if (!proxy) return;
    activateSketch(proxy.targetFrameId);
    if (findNode(panelsRef.current[proxy.targetFrameId]?.scene ?? { nodes: [], algorithms: [] }, proxy.nodeId) && panelsRef.current[proxy.targetFrameId]?.selectedNodeIds.join() !== proxy.nodeId) sceneEdits(deps, proxy.targetFrameId).select(proxy.nodeId);
  }
  function deleteFrame(id: FrameId) {
    if (isProxyFrame(id)) {
      const remaining = proxyFramesRef.current.filter(frame => frame.id !== id);
      proxyFramesRef.current = remaining; setProxyFrames(remaining); setWorkspace(current => removeWorkspaceFrame(current, id));
      setToast("proxy frame을 지웠습니다. handle은 property에 남아 있어 다시 열 수 있습니다.");
      return;
    }
    if (panelsRef.current[id]?.loading) return;
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
        const fallback = id !== "source" && !workspace.hiddenFrames.includes("source") ? "source" : remaining[0]?.id || "source";
        activeSketchRef.current = fallback; setActiveSketch(fallback);
        if (fallback !== "source" || (id !== "source" && !workspace.hiddenFrames.includes("source"))) setPendingFrameFocus(fallback as FrameId);
      }
    }
    setToast("프레임을 삭제했습니다.");
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
    if (tool === "select") { edits.undo(); return; }
    if (activeSketch !== "source") { stepSketchFrame("undo"); return; }
    if (!history.length) return; setFuture(f => [...f, artwork]); setArtwork(history[history.length - 1]); setHistory(h => h.slice(0, -1));
  }
  function redo() {
    if (annotating) { if (!busy) editAnnotations({ type: "redo" }); return; }
    if (tool === "select") { edits.redo(); return; }
    if (activeSketch !== "source") { stepSketchFrame("redo"); return; }
    if (!future.length) return; setHistory(h => [...h, artwork]); setArtwork(future[future.length - 1]); setFuture(f => f.slice(0, -1));
  }
  const canUndo = annotating ? !busy && panel.annotationHistory.past.length > 0 : tool === "select" ? panel.sceneHistory.length > 0 : activeSketch !== "source" ? Boolean(sketchHistories[activeSketch]?.past.length) : history.length > 0;
  const canRedo = annotating ? !busy && panel.annotationHistory.future.length > 0 : tool === "select" ? panel.sceneFuture.length > 0 : activeSketch !== "source" ? Boolean(sketchHistories[activeSketch]?.future.length) : future.length > 0;
  function clearCanvas() {
    if (annotating) { editAnnotations({ type: "clear" }); return; }
    commitFrame(activeSketch, { ...currentSketch, strokes: [], photo: null });
    canvasFor(activeSketch)?.clearSelection();
  }
  function chooseTool(next: string) {
    // With the inspection annotation tool, the toolbar Eraser (or E) erases its purple marks on the frame; pressing it again draws again.
    if (next === "eraser" && brushPick?.kind === "inspect-annotate") { setInspectionEraser(on => !on); return; }
    setPenSettingsOpen(false); setTool(next);
    if (!parseBrushTool(next)) setOpenGroup(null);
    if (annotating) { setPencilOpen(false); return; }
    setPencilOpen(next === "pen" ? !pencilOpen : false);
  }
  // ── Brush tool groups ─────────────────────────────────────────────────────
  /** First click selects the group's tool; clicking the selected group opens, then closes, its tool panel. */
  function clickBrushGroup(brushId: string) {
    if (brushPick && brushGroup(brushesRef.current, brushPick.brushId) === brushId) { setOpenGroup(open => open === brushId ? null : brushId); return; }
    const remembered = groupTools[brushId], pick = remembered ? parseBrushTool(remembered) : null;
    // The remembered tool may be a sub brush's; it must still exist.
    const owner = pick ? brushesRef.current.find(item => item.id === pick.brushId) : undefined;
    const exists = pick && owner && brushGroup(brushesRef.current, owner.id) === brushId && (pick.kind !== "targeted" || owner.targeted.some(item => item.id === pick.targetedId));
    chooseTool(exists ? remembered! : brushTool("brush", brushId)); setOpenGroup(null);
  }
  /** Pick a tool of a brush (or of one of its sub brushes); its group remembers it. */
  function chooseBrushTool(brushId: string, toolId: string) {
    const pick = parseBrushTool(toolId), group = brushGroup(brushesRef.current, pick?.brushId ?? brushId);
    chooseTool(toolId); setGroupTools(current => ({ ...current, [group]: toolId }));
    const brush = pick?.kind === "brush" ? brushesRef.current.find(item => item.id === pick.brushId) : undefined;
    if (brush) prepareBrushFor(deps, brush, activeSketchRef.current);
  }
  /** Inspection annotation → a new targeted inspection tool in the group; a targeted tool → its concern again. */
  async function runTargeted(brush: Brush) {
    const frame = activeSketch, state = inspectionFor(panelsRef.current[frame] || panel, brush.id);
    const tool = activeTargeted, draft = tool ? { concern: tool.concern, marks: tool.marks, markStyles: tool.markStyles } : { concern: state.concern, marks: state.marks, markStyles: state.markStyles };
    const found = await inspectConcern(deps, frame, brush, draft);
    if (!found) return;
    // Kept in the brush's shared ids, so the tool works on the master and on every instance.
    const frameScene = (panelsRef.current[frame] || panel).scene, result = remapResult(found, sharedIds(frameScene, brushRoots(frameScene, brush, frame)));
    const latest = brushesRef.current.find(item => item.id === brush.id); if (!latest) return;
    if (tool) { setBrushes(brushesRef.current.map(item => item.id === brush.id ? { ...item, targeted: item.targeted.map(entry => entry.id === tool.id ? { ...entry, result } : entry) } : item)); return; }
    const made = { id: crypto.randomUUID(), name: targetedName(draft.concern, latest.targeted.length), concern: draft.concern.trim(), marks: draft.marks, markStyles: draft.marks.map((_, i) => markStyleAt(draft.markStyles, i)), result };
    setBrushes(brushesRef.current.map(item => item.id === brush.id ? { ...item, targeted: [...item.targeted, made].slice(-MAX_TARGETED) } : item));
    updatePanel(frame, previous => withInspection(previous, { ...inspectionFor(previous, brush.id), marks: [], markStyles: [], concern: "", focus: null }));
    chooseBrushTool(brush.id, brushTool("targeted", brush.id, made.id));
    setToast(`「${made.name}」 targeted inspection 도구를 ${brush.name} 그룹에 만들었습니다.`);
  }
  /** Change one targeted tool of a brush as it is now. */
  function patchTargeted(brushId: string, toolId: string, patch: (tool: TargetedTool) => TargetedTool) {
    setBrushes(brushesRef.current.map(item => item.id === brushId ? { ...item, targeted: item.targeted.map(entry => entry.id === toolId ? patch(entry) : entry) } : item));
  }
  /**
   * Apply a recommendation of the selected targeted tool. One that adds a
   * transformation then reads as that transformation in the list, and the tool's
   * overlays are rebuilt by AI so they show the added transformation too.
   */
  async function applyTargetedRecommendation(brush: Brush, recommendation: Recommendation, index: number, listed: Recommendation) {
    const frame = activeSketch, tool = activeTargeted;
    const added = await applyRecommendation(deps, frame, recommendation, recommendationKey(listed));
    if (!added || !tool) return;
    // The stored result keeps the brush's shared ids, so the recommendation is matched by its place in the list.
    patchTargeted(brush.id, tool.id, entry => ({ ...entry, result: { ...entry.result, recommendations: entry.result.recommendations.map((item, i) => i === index ? { ...item, addedId: added.id } : item) } }));
    await settledResult(frame);
    const owner = panelsRef.current[frame], latest = brushesRef.current.find(item => item.id === brush.id), current = latest?.targeted.find(entry => entry.id === tool.id);
    if (!owner || !latest || !current) return;
    // The overlays so far, in the ids of the stamp the transformation was added to.
    const roots = brushRoots(owner.scene, latest, frame), root = roots.find(id => [...frameIds(owner.scene, id).values()].includes(recommendation.nodeId)) ?? roots[0];
    const before = root ? resultInFrame(current.result, [frameIds(owner.scene, root)]) : current.result;
    const found = await inspectConcern(deps, frame, latest, { concern: current.concern, marks: current.marks, markStyles: current.markStyles },
      { title: recommendation.title, detail: recommendation.detail, nodeId: recommendation.nodeId, transformationId: added.id, summary: before.summary, overlays: before.overlays });
    if (!found) return;
    const scene = (panelsRef.current[frame] || owner).scene, result = remapResult(found, sharedIds(scene, brushRoots(scene, latest, frame)));
    // The recommendations stay the list the user is working from.
    patchTargeted(brush.id, tool.id, entry => ({ ...entry, result: { ...result, recommendations: entry.result.recommendations } }));
    setToast(`「${added.label}」을(를) 추가하고 「${tool.name}」 overlay를 그에 맞게 고쳤습니다.`);
  }
  /** Wait until the frame runs its current code (a little after it starts), so a capture shows the new result. */
  async function settledResult(frame: string) {
    const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
    for (let i = 0; i < 100; i++) {
      const current = panelsRef.current[frame];
      if (!current?.generated || current.runtimeError || (current.executable && current.preparedCode === current.generated.code)) break;
      await sleep(100);
    }
    await sleep(800);
  }
  function removeTargeted(brushId: string, targetedId: string) {
    setBrushes(brushesRef.current.map(item => item.id === brushId ? { ...item, targeted: item.targeted.filter(entry => entry.id !== targetedId) } : item));
  }
  /** Remove a brush; a group goes with its sub brushes. */
  function removeBrush(brush: Brush) {
    const gone = new Set([brush.id, ...brushesRef.current.filter(item => item.parentId === brush.id).map(item => item.id)]);
    setBrushes(brushesRef.current.filter(item => !gone.has(item.id))); if (!brush.parentId) setOpenGroup(null);
    if (brushPick && gone.has(brushPick.brushId)) setTool("pen");
  }
  // A brush gesture is fed to the frame's result while the user moves (after placing the brush there if needed).
  const brushDrag = useRef<ReturnType<typeof startBrushGesture>>(null);
  function brushGestureStep(frameId: string, toolId: string, point: { x: number; y: number }, phase: "start" | "move") {
    if (inspectionEraser && parseBrushTool(toolId)?.kind === "inspect-annotate") { eraseInspectionMarks(frameId, toolId, [point]); return; }
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
  /** The brush tool is in use on a frame that has the brush: every brush there records its steps. */
  const playingIn = (frameId: string, owner: SketchPanel) => Boolean(playingBrush && owner.generated && brushNodeIds(owner.scene, playingBrush, frameId).length);
  /** A brush gesture on a frame: stamp/paint with the brush, or add an inspection annotation stroke. */
  function brushGesture(frameId: string, toolId: string, points: { x: number; y: number; t: number }[]) {
    const pick = parseBrushTool(toolId), brush = pick && brushesRef.current.find(item => item.id === pick.brushId);
    if (!pick || !brush) return;
    activateSketch(frameId);
    if (pick.kind === "brush") { brushDrag.current?.end(points.at(-1)!); brushDrag.current = null; setPlacing(null); return; }
    if (pick.kind === "inspect-annotate" && inspectionEraser) { eraseInspectionMarks(frameId, toolId, points); return; }
    if (pick.kind === "inspect-annotate" && points.length > 1) updatePanel(frameId, previous => { const state = inspectionFor(previous, brush.id);
      return withInspection(previous, { ...state, ...addMark(state, points.map(point => ({ x: Math.min(1, Math.max(0, point.x / 900)), y: Math.min(1, Math.max(0, point.y / 600)) })), inspectionPen) }); });
  }
  /** Inspection annotation eraser: every mark passing within a few pixels of these canvas points is removed. */
  function eraseInspectionMarks(frameId: string, toolId: string, points: { x: number; y: number }[]) {
    const brushId = parseBrushTool(toolId)?.brushId; if (!brushId || !points.length) return;
    updatePanel(frameId, previous => { const state = inspectionFor(previous, brushId), kept = eraseStyledMarks(state, points);
      return kept.marks.length === state.marks.length ? {} : withInspection(previous, { ...state, ...kept }); });
  }
  /** A stroke drawn on the frame for the open regeneration (normalized, like the inspection annotation). */
  function addTransformMark(frameId: string, points: { x: number; y: number }[]) {
    if (points.length < 2) return;
    updatePanel(frameId, previous => previous.transformDraft ? { transformDraft: { ...previous.transformDraft,
      marks: [...previous.transformDraft.marks, points.map(point => ({ x: Math.min(1, Math.max(0, point.x / 900)), y: Math.min(1, Math.max(0, point.y / 600)) }))].slice(-64) } } : {});
  }
  /**
   * A step reported by the running result, kept by the brush it concerns (always
   * recorded, no toggle). While the brush tool plays on the frame every brush in it
   * records on its own; otherwise only the inspected brush.
   */
  function recordStep(frameId: string, step: TraceStep) {
    updatePanel(frameId, previous => {
      const interacting = playingIn(frameId, previous), inspected = inspectionKind && frameId === activeSketch ? activeBrush : undefined;
      let inspections = previous.inspections, changed = false;
      for (const brush of brushesRef.current) {
        if (!interacting && brush.id !== inspected?.id) continue;
        const nodeIds = brushNodeIds(previous.scene, brush, frameId);
        if (!nodeIds.length || (step.nodeId ? !nodeIds.includes(step.nodeId) : interacting && inspected && brush.id !== inspected.id)) continue;
        const state = inspectionFor(previous, brush.id);
        inspections = { ...inspections, [brush.id]: addStep(state, { at: Date.now(), nodeId: step.nodeId, from: step.from, to: step.to, transitionId: step.transitionId, values: filterValues(step.params, nodeIds), runtime: step.runtime }) };
        changed = true;
      }
      return changed ? { inspections } : {};
    });
  }
  /** How a recorded step reads on hover: the transition, or the state change. */
  function stepName(stepScene: typeof scene, step: InspectionState["steps"][number] | undefined) {
    if (!step) return "";
    if (!step.nodeId) return "Start";
    const machine = findNode(stepScene, step.nodeId)?.machine, label = (id: string | null) => machine?.states.find(state => state.id === id)?.label || id || "—";
    const via = machine?.transitions.find(item => item.id === step.transitionId);
    return `${via ? `${via.label} · ` : ""}${label(step.from)} → ${label(step.to)}`;
  }
  function patchInspection(frameId: string, patch: Partial<InspectionState>) {
    if (!activeBrush) return;
    const brushId = activeBrush.id;
    updatePanel(frameId, previous => withInspection(previous, { ...inspectionFor(previous, brushId), ...patch }));
  }
  /** Highlight what an overlay or row stands for: the constraint in the inspector, the state/transition in the machine panel. */
  function focusInspection(frameId: string, focus: InspectionFocus | null) {
    if (!activeBrush) return;
    const brushId = activeBrush.id;
    updatePanel(frameId, previous => ({ ...withInspection(previous, { ...inspectionFor(previous, brushId), focus }),
      ...(focus ? { selectedNodeIds: [focus.nodeId], machineTarget: focus.kind === "state" || focus.kind === "transition" ? { nodeId: focus.nodeId, kind: focus.kind, id: focus.id } : null } : {}) }));
  }
  /**
   * The selected targeted tool as it reads in one frame: its overlays on every
   * stamp of the brush there (master and instances), its fixes and recommendations
   * on the selected stamp (else the first).
   */
  function targetedIn(frameId: string, owner: SketchPanel) {
    if (!activeTargeted || !activeBrush) return activeTargeted;
    const roots = brushRoots(owner.scene, activeBrush, frameId);
    const selectedRoot = owner.selectedNodeIds.map(id => brushRole(owner.scene, frameId, id, brushes)).find(role => role?.brush.id === activeBrush.id)?.rootId;
    return { ...activeTargeted, result: resultInFrame(activeTargeted.result, roots.map(root => frameIds(owner.scene, root)), Math.max(0, roots.indexOf(selectedRoot ?? ""))) };
  }

  // ── Master and instances ───────────────────────────────────────────────────
  /** Frames a brush is in, its master's frame first. */
  function brushFrames(brush: Brush) {
    const ids = ["source", ...sketchFrames.map(frame => frame.id)].filter(id => artworkOf(id) && panels[id] && brushNodeIds(panels[id].scene, brush, id).length);
    return ids.map(id => ({ id, name: artworkOf(id)!.name, master: id === brush.sourceFrameId })).sort((a, b) => Number(b.master) - Number(a.master));
  }
  /** The master's frame name, or null when that frame (or the master in it) is gone. */
  const masterFrame = (brush: Brush) => { const owner = panels[brush.sourceFrameId]; return artworkOf(brush.sourceFrameId) && owner && findNode(owner.scene, brush.nodeId) ? artworkOf(brush.sourceFrameId)!.name : null; };
  /**
   * Semantic transformations and state machines of an instance follow its brush:
   * an edit there asks first (detach into a new brush, or go to the master).
   * Plain value adjustments (sliders, inspection value fixes) are the instance's own and never ask.
   */
  function guard(nodeId: string, what: string, apply: () => void) {
    const frameId = activeSketch, owner = panelsRef.current[frameId] || panel, role = brushRole(owner.scene, frameId, nodeId, brushesRef.current);
    if (!role || role.master) { apply(); return; }
    setDetachPrompt({ frameId, rootId: role.rootId, brushId: role.brush.id, nodeName: findNode(owner.scene, role.rootId)?.name || role.brush.name, what, apply });
  }
  const guardEach = (nodeIds: string[], what: string, apply: () => void) => { const id = nodeIds.find(item => { const role = brushRole(scene, activeSketch, item, brushes); return role && !role.master; }); if (id) guard(id, what, apply); else apply(); };
  /** The instance's module in its frame's program (what the new brush runs). */
  const instanceCode = (owner: SketchPanel, rootId: string) => { const root = findNode(owner.scene, rootId); return root && owner.generated ? programModules(owner.generated.code).get(root.codeModule ?? root.id) ?? "" : ""; };
  /** Detach an instance: it becomes the master of a new brush (with the old brush's targeted tools and this frame's recorded steps). */
  function detachInstance(frameId: string, rootId: string, brushId: string) {
    const owner = panelsRef.current[frameId], from = brushesRef.current.find(item => item.id === brushId);
    if (!owner || !from || !findNode(owner.scene, rootId)) return null;
    if (brushesRef.current.length >= MAX_BRUSHES) { updatePanel(frameId, { error: `Brush는 최대 ${MAX_BRUSHES}개까지 만들 수 있습니다. 쓰지 않는 brush를 지워주세요.` }); return null; }
    const made = detachedBrush(owner.scene, frameId, rootId, from, brushesRef.current, crypto.randomUUID(), instanceCode(owner, rootId));
    setBrushes([...brushesRef.current, made]);
    updatePanel(frameId, previous => ({ scene: { ...previous.scene, nodes: previous.scene.nodes.map(item => item.id === rootId ? { ...item, brushId: made.id } : item) },
      inspections: previous.inspections[from.id] ? { ...previous.inspections, [made.id]: { ...previous.inspections[from.id], brushId: made.id } } : previous.inspections }));
    // A tool of the old brush in use moves to the same tool of the new one.
    if (brushPick?.brushId === from.id) chooseBrushTool(made.id, brushPick.kind === "targeted" ? brushTool("targeted", made.id, brushPick.targetedId) : brushTool(brushPick.kind, made.id));
    setToast(`${from.name}에서 detach해 「${made.name}」 brush를 만들었습니다. 이 노드가 새 brush의 master입니다.`);
    return made;
  }
  /** The master's frame is gone: this instance becomes the brush's master. */
  function adoptMaster(frameId: string, rootId: string, brushId: string) {
    const owner = panelsRef.current[frameId]; if (!owner || !findNode(owner.scene, rootId)) return false;
    setBrushes(brushesRef.current.map(item => item.id === brushId ? { ...item, sourceFrameId: frameId, nodeId: rootId, scene: subScene(owner.scene, [rootId]), code: instanceCode(owner, rootId) || item.code } : item));
    setToast("이 instance를 brush의 master로 지정했습니다.");
    return true;
  }
  function goToMaster(brush: Brush) {
    if (!masterFrame(brush)) return;
    activateSketch(brush.sourceFrameId); updatePanel(brush.sourceFrameId, { selectedNodeIds: [brush.nodeId] }); setPendingFrameFocus(brush.sourceFrameId as FrameId);
  }
  /** Inspect a brush in another frame (the inspection follows the active frame). */
  function inspectFrame(frameId: string, brush: Brush) {
    activateSketch(frameId);
    const owner = panelsRef.current[frameId], root = owner ? brushRoots(owner.scene, brush, frameId)[0] : undefined;
    if (root) updatePanel(frameId, { selectedNodeIds: [root] });
    setPendingFrameFocus(frameId as FrameId);
  }
  function selectAlgorithmPen(pen: SemanticPen) {
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
  /** Paste an image into the selected frame. Listens on window: clicking a frame does not focus anything inside the studio. */
  function pastePhoto(event: ClipboardEvent) {
    const target = event.target instanceof Element ? event.target : null;
    if (!event.clipboardData || target?.closest("input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox']") || modal || exportOpen || historyOpen || busy || interactingIn(activeSketch, panelsRef.current[activeSketch] || panel)) return;
    const item = Array.from(event.clipboardData.items).find(item => item.kind === "file" && item.type.startsWith("image/"));
    const image = item?.getAsFile() || Array.from(event.clipboardData.files).find(file => file.type.startsWith("image/"));
    if (!image) return;
    event.preventDefault();
    const extension = image.type === "image/jpeg" ? "jpg" : image.type === "image/webp" ? "webp" : "png";
    void attach(new File([image], `Clipboard image.${extension}`, { type: image.type })).then(attached => { if (attached) setToast("클립보드 이미지를 첨부했습니다."); });
  }

  // ── Results and state preview ─────────────────────────────────────
  async function prepare(code: string) {
    const number = ++prepareNumber.current; patchActive({ runtimeError: "" });
    try { const result = await fetch("/api/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ intent: "prepare", code }) }).then(r => r.json()); if (number !== prepareNumber.current) return; if (result.error) { if (result.logged) markLogged(result.error); throw new Error(result.error); } patchActive({ executable: result.executable, preparedCode: code }); }
    catch (e) { if (number === prepareNumber.current) patchActive({ runtimeError: e instanceof Error ? e.message : "코드를 실행하지 못했습니다." }); }
  }
  function beginAnnotations(owner = activeSketch) {
    activateSketch(owner);
    const resultPanel = panelsRef.current[owner]; if (!resultPanel) return;
    if (resultPanel.annotating) { updatePanel(owner, { annotating: false }); return; }
    const image = resultPanel.annotationImage || resultPreviews.current.get(owner)?.capture();
    if (!image || !resultPanel.generated) { updatePanel(owner, { error: "결과 렌더링이 완료된 뒤 Annotate를 눌러주세요." }); return; }
    updatePanel(owner, { annotationImage: image, annotationSource: liveSceneSource(resultPanel.generated, resultPanel.scene), annotationRenderRevision: resultPanel.renderRevision, annotating: true, machinePlaying: false });
    setTool("pen"); setPencilOpen(false); setPenSettingsOpen(false); workspaceCanvas.current?.focus(owner as FrameId);
  }
  function emitTransition(nodeId: string, transitionId: string) {
    const machine = findNode(scene, nodeId)?.machine, current = panel.runtimeStates[nodeId] || machine?.initialState;
    const transition = machine?.transitions.find(item => item.id === transitionId && item.trigger === "event" && item.from === current);
    if (!transition || busy) return;
    resultPreviews.current.get(activeSketch)?.emit(nodeId, transitionId);
    patchActive({ editingStates: { ...panel.editingStates, [nodeId]: transition.to }, ...clearedResultAnnotations() });
  }
  function restartMachine(nodeId: string) {
    const machine = findNode(scene, nodeId)?.machine; if (!machine) return;
    patchActive(previous => ({ machinePlaying: true, stateJump: { nodeId, stateId: machine.initialState, revision: (previous.stateJump?.revision || 0) + 1 }, editingStates: { ...previous.editingStates, [nodeId]: machine.initialState } }));
  }
  // Algorithms from other sketches and from pens can be imported into this sketch.
  const algorithmImports: (AlgorithmSource & { source: NonNullable<ReturnType<typeof penAlgorithm>> })[] = [
    ...Object.entries(panels).filter(([id]) => id !== activeSketch).flatMap(([id, other]) => other.scene.algorithms.map(algorithm => ({
      key: `sketch:${id}:${algorithm.id}`, label: artworkOf(id)?.name || id, algorithm,
      source: { call: instantiate(other.scene.algorithms, algorithm.id), library: algorithmClosure(other.scene.algorithms, [algorithm.id]) } }))),
    ...semanticPens.flatMap(pen => { const source = penAlgorithm(pen); const algorithm = source?.library.find(item => item.id === source.call.algorithmId); return source && algorithm ? [{ key: `pen:${pen.id}`, label: pen.name, algorithm, source }] : []; }),
  ].filter(item => !scene.algorithms.some(algorithm => JSON.stringify(algorithm) === JSON.stringify(item.algorithm)));

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
    // Inspection tools of a brush act on the active frame, and only on that brush's nodes.
    // Drawing the annotation of an open regeneration: strokes go to it, not to the sketch.
    const transformDrawing = Boolean(owner.transformDraft?.annotating && id === activeSketch);
    const inspected = inspectionKind && activeBrush && id === activeSketch && brushNodeIds(owner.scene, activeBrush, id).length > 0 ? inspectionFor(owner, activeBrush.id) : null;
    // The step held in the result (stepping through the inspection); overlays there read the stores as it is drawn now.
    const restoreId = inspected && inspected.cursor !== null && inspected.steps[inspected.cursor] ? `${inspected.brushId}:${inspected.steps[inspected.cursor].id}` : null;
    const drawn = restoreId && drawnStores[id]?.restore === restoreId ? drawnStores[id].stores : null;
    return <div className={`sketch-frame-surface ${owner.generated || owner.pendingResult ? "has-render" : ""} ${interacting ? "frame-interacting" : ""} ${dropTarget === id ? "node-drop-target" : ""} ${transformDrawing ? "transform-drawing" : ""} ${inspectionEraser && inspectionKind === "inspect-annotate" && id === activeSketch ? "inspection-erasing" : ""}`} onPointerDownCapture={e => { if (!(e.target as Element).closest("button")) activateSketch(id); }}
      onPointerEnter={() => { if (playingBrush) prepareBrushFor(deps, playingBrush, id); }}
      onPointerDown={e => { if (!interacting && !transformDrawing && tool === "select" && !(e.target as Element).closest(".scene-node, .property-handles")) frameEdits.select(null); }}
      {...(interacting ? {} : layerDrop(id, id, target => target.querySelector(".p5-surface") || target))}>
      {/* One frame, three layers: generated result, sketch strokes + layer boxes, annotations. */}
      <FrameRender owner={id} panel={owner} interacting={interacting} live={placing === id} onEscape={() => { if (interacting) chooseTool("select"); }} tracing={playingIn(id, owner) || Boolean(inspected)} onTrace={step => recordStep(id, step)} restore={restoreId ? { id: restoreId, runtime: inspected!.steps[inspected!.cursor!].runtime } : null} onDrawn={(restore, stores) => setDrawnStores(current => ({ ...current, [id]: { restore, stores } }))} documentRevision={activeDocument.current} onPatch={patch => updatePanel(id, patch)}
        onPreview={handle => { if (handle) resultPreviews.current.set(id, handle); else resultPreviews.current.delete(id); }} />
      <SketchCanvas ref={ref} artwork={frameArtwork} tool={tool} showGesture={name => parseBrushTool(name)?.kind !== "brush" && !(inspectionEraser && parseBrushTool(name)?.kind === "inspect-annotate")}
        gestureStyle={name => parseBrushTool(name)?.kind === "inspect-annotate" && !transformDrawing ? inspectionPen : undefined} gestureTool={name => { if (transformDrawing) return true; const kind = parseBrushTool(name)?.kind; return kind === "brush" || kind === "inspect-annotate"; }}
        onGesture={(name, points) => transformDrawing ? addTransformMark(id, points) : brushGesture(id, name, points)} onGestureStep={(name, point, phase) => { if (!transformDrawing) brushGestureStep(id, name, point, phase); }} color={color} width={width} opacity={opacity} transparent viewport={drawingViewport} semanticPen={activeSemanticPen}
        onStroke={(stroke: Stroke) => { const latest = artworkOf(id); if (!latest) return; if (latest.strokes.length >= 500) { updatePanel(id, { error: "한 프레임에는 최대 500개의 획을 저장할 수 있습니다. 새 스케치 프레임을 추가해주세요." }); return; } activateSketch(id); commitFrame(id, { ...latest, strokes: [...latest.strokes, stroke] }); }}
        onViewport={() => {}} onSelection={value => id === "source" ? setHasSelection(value) : setSketchSelections(current => current[id] === value ? current : { ...current, [id]: value })} onError={message => updatePanel(id, { error: message })}>
        {/* The brush tool draws nothing of its own on the frame: no layer boxes, no gesture path. */}
        {!interacting && !playingBrush && <SceneOverlay scene={owner.scene} selected={owner.selectedNodeIds} hovered={owner.hovered} zoom={boardZoom} interactive={tool === "select" && !transformDrawing}
          onSelect={(nodeId, additive) => { activateSketch(id); frameEdits.select(nodeId, additive); }}
          onHover={nodeId => updatePanel(id, { hovered: nodeId })} onLiveMove={next => frameEdits.preview(next)} onMove={(next, before) => frameEdits.move(next, before)} />}
      </SketchCanvas>
      <FrameAnnotations panel={owner} tool={tool} zoom={boardZoom} onPatch={patch => updatePanel(id, patch)} />
      {owner.transformDraft && owner.transformDraft.marks.length > 0 && <svg className="transform-marks" viewBox="0 0 900 600" preserveAspectRatio="none" aria-label="Regeneration annotation">
        {owner.transformDraft.marks.map((mark, i) => <polyline key={i} vectorEffect="non-scaling-stroke" points={mark.map(point => `${point.x * 900},${point.y * 600}`).join(" ")} />)}</svg>}
      {inspected && <InspectionOverlay state={inspected} marks={inspectionKind === "inspect-annotate" ? inspected.marks : []} markStyles={inspected.markStyles} result={inspectionKind === "targeted" ? targetedIn(id, owner)?.result || null : null} drawn={drawn} liveValues={filterValues(sceneValues(owner.scene), brushNodeIds(owner.scene, activeBrush!, id))} clickable={inspectionKind !== "inspect-annotate"} zoom={boardZoom} onFocus={focus => focusInspection(id, focus)}
        onStep={index => patchInspection(id, { cursor: index })} stepName={index => stepName(owner.scene, inspected.steps[index])} />}
      {!(frameArtwork.photo || frameArtwork.strokes.length) && !owner.generated && !owner.pendingResult && !owner.scene.nodes.length && empty}</div>;
  };
  // Header controls for a frame: run/pause and re-render its result, (re)generate code, annotate, extract.
  const frameActions = (id: string, selection: boolean, present: boolean) => {
    const frame = panels[id] || createSketchPanel(), frameBusy = Boolean(frame.loading);
    const status = sceneLiveStatus(frame.generated, frame.scene);
    const proxies = proxyFrames.filter(proxy => proxy.targetFrameId === id);
    return <>
      {/* Proxy frames that control nodes of this frame: hover shows the link, click goes there. */}
      {proxies.map(proxy => <button key={proxy.id} className="proxy-link-chip back" aria-label={`Proxy frame of ${findNode(frame.scene, proxy.nodeId)?.name || proxy.nodeId}`} title="이 프레임의 노드를 조작하는 proxy frame으로 이동"
        onMouseEnter={() => setLinkHover(proxy.id as FrameId)} onMouseLeave={() => setLinkHover(null)} onClick={e => { e.stopPropagation(); setLinkHover(null); setPendingFrameFocus(proxy.id as FrameId); }}>
        ◎<b>{findNode(frame.scene, proxy.nodeId)?.name || proxy.nodeId}</b><i>proxy</i></button>)}
      {/* Each frame shows (and can stop) its own AI work, also while another frame is active. */}
      {frameBusy && <span className="frame-working" role="status" title={frame.loading}><span className="loading-spinner" />AI 작업 중
        <button aria-label="Cancel this frame's AI work" title="Cancel" onClick={e => { e.stopPropagation(); cancel(id); }}><Icon name="close" size={11} /></button></span>}
      {frame.scene.nodes.length > 0 && <button aria-label={`Copy ${artworkOf(id)?.name || id} as JSON`} title="Copy this frame's state machines, constraints and code as one JSON" onClick={e => { e.stopPropagation(); setFrameJson(id); }}><Icon name="copy" size={13} />JSON</button>}
      {frame.generated && <button aria-label={frame.machinePlaying ? "Pause result" : "Run result"} title={frame.machinePlaying ? "Pause" : "Run"} disabled={!frame.executable} onClick={() => updatePanel(id, { machinePlaying: !frame.machinePlaying })}><Icon name={frame.machinePlaying ? "pause" : "play"} size={13} />{frame.machinePlaying ? "Pause" : "Run"}</button>}
      {frame.generated && <button aria-label="Re-render result" title="Re-render from the start" disabled={!frame.executable || frameBusy} onClick={() => { activateSketch(id); updatePanel(id, previous => ({ renderRevision: previous.renderRevision + 1, machinePlaying: true })); }}><Icon name="undo" size={13} /></button>}
      {frame.scene.nodes.length > 0 && (!frame.generated || status !== "live" || frame.dirtyNodeIds.length > 0) && <button disabled={frameBusy} title="Generate this frame's p5.js result" onClick={() => { activateSketch(id); void sceneAI(deps, id).generateCode(); }}><Icon name="code" size={13} />{frame.generated ? "Update" : "Generate"}</button>}
      {frame.generated && <button disabled={!frame.executable || frameBusy} aria-pressed={frame.annotating} onClick={() => beginAnnotations(id)}><Icon name="pen" size={13} />{frame.annotating ? "Done" : "Annotate"}</button>}
      <button disabled={frameBusy || !(present || frame.generated)} title="Extract brush stamps into a new frame" onClick={() => { activateSketch(id); void sceneAI(deps, id).extract(); }}>{selection ? "Extract selection" : "Extract"}<Icon name="spark" size={13} /></button>
    </>;
  };
  const frameSubtitle = (id: string, artwork: Artwork, selection: boolean) => {
    const frame = panels[id], from = frame?.sourceFrameId ? artworkOf(frame.sourceFrameId)?.name : null;
    return [`${artwork.strokes.length} strokes`, frame?.scene.nodes.length ? `${frame.scene.nodes.length} layers` : "", from ? `from ${from}` : "", frame?.generated ? "p5.js" : "", selection ? "selection" : "", frame && playingBrush && interactingIn(id, frame) ? `playing ${playingBrush.name}` : "", activeSketch === id ? "active" : ""].filter(Boolean).join(" · ");
  };
  const frames = [
    { id: "source" as const, title: artwork.photo ? "Photo + sketch" : "Original sketch", subtitle: frameSubtitle("source", artwork, hasSelection),
      actions: <><button title="Load example sketch" aria-label="Load example sketch" disabled={busy} onClick={() => { activateSketch("source"); commit({ ...blank(), name: "Branch studies", strokes: exampleStrokes() }); updatePanel("source", createSketchPanel()); }}><Icon name="pen" size={13} /></button>{frameActions("source", hasSelection, Boolean(artwork.photo || artwork.strokes.length))}</>,
      content: sketchFrameContent("source", artwork, canvas, <div className="frame-empty source-empty"><Icon name="pen" size={30} /><strong>Start with a mark.</strong><span>Draw here, drop a photo, or paste an image.</span><button onClick={() => upload.current?.click()}>Attach photo<Icon name="upload" size={14} /></button></div>) },
    ...sketchFrames.map(frame => ({ id: frame.id as FrameId, title: frame.artwork.name, subtitle: frameSubtitle(frame.id, frame.artwork, Boolean(sketchSelections[frame.id])),
      actions: frameActions(frame.id, Boolean(sketchSelections[frame.id]), Boolean(frame.artwork.photo || frame.artwork.strokes.length)),
      content: sketchFrameContent(frame.id, frame.artwork, handle => { if (handle) sketchCanvases.current.set(frame.id, handle); else sketchCanvases.current.delete(frame.id); }, <div className="frame-empty source-empty"><Icon name="pen" size={30} /><strong>Start a new sketch.</strong><span>Draw here, then extract its collections.</span></div>) })),
    ...proxyFrames.map(proxy => {
      const target = panels[proxy.targetFrameId], targetNode = target && findNode(target.scene, proxy.nodeId), targetName = artworkOf(proxy.targetFrameId)?.name || "frame";
      const transformations = target && targetNode ? inspectedTransformations(target, targetNode) : [], count = transformations.flatMap(item => item.properties).filter(property => property.handle).length;
      const stateId = targetNode ? target.editingStates[targetNode.id] : undefined, state = stateId && targetNode?.machine?.states.find(item => item.id === stateId);
      // The module that draws the node (its root's), to tell whether values adjust what input made in place.
      let root = targetNode; while (root?.parentId) root = findNode(target.scene, root.parentId);
      const module = root && target.generated ? programModules(target.generated.code).get(root.codeModule ?? root.id) : undefined;
      return { id: proxy.id as FrameId, title: `◎ ${targetNode?.name || proxy.nodeId} · proxy`, subtitle: [`${count} handles`, state ? `editing ${state.label}` : ""].filter(Boolean).join(" · "),
        actions: <>
          {/* The frame (and node) this proxy controls: hover shows it on the board, click goes there. */}
          <button className="proxy-link-chip" aria-label={`Linked frame: ${targetName}, ${targetNode?.name || proxy.nodeId}`} title={`이 proxy frame은 ${targetName}의 「${targetNode?.name || proxy.nodeId}」를 조작합니다. 눌러서 이동`}
            onMouseEnter={() => setLinkHover(proxy.targetFrameId as FrameId)} onMouseLeave={() => setLinkHover(null)}
            onClick={() => { setLinkHover(null); activateFrame(proxy.id); setPendingFrameFocus(proxy.targetFrameId as FrameId); }}>
            <span className="proxy-link-kicker">LINKED</span><Icon name="arrow" size={11} /><b>{targetName}</b><i>/ {targetNode?.name || "삭제된 노드"}</i>{state && <em>{state.label}</em>}</button>
</>,
        content: <ProxyFrame frameId={proxy.id} node={targetNode} transformations={transformations} targetName={targetName} busy={target?.loading || ""} onActivate={() => activateFrame(proxy.id)}
          bakedInput={bakesInput(module) ? { onUpdate: () => { activateFrame(proxy.id); void sceneAI(deps, proxy.targetFrameId).generateCode(false, `${target.generationMode === "compose" ? target.composePrompt : target.instruction}\n${ADJUST_IN_PLACE_INSTRUCTION}`); } } : undefined}
          onDesign={transformationId => { activateFrame(proxy.id); void sceneAI(deps, proxy.targetFrameId).suggestHandles(proxy.nodeId, { transformationId }, ""); }}
          onSet={(propertyId, path, value) => { if (targetNode) sceneEdits(deps, proxy.targetFrameId).scalar(targetNode.id, propertyId, path, value); }}
          onError={(propertyId, message) => { const code = propertyId && targetNode ? transformations.flatMap(item => item.properties).find(property => property.id === propertyId)?.handle?.prepared : undefined;
            if (code) setHandleErrors(current => current[`${proxy.targetFrameId}:${proxy.nodeId}:${propertyId}`]?.code === code ? current : { ...current, [`${proxy.targetFrameId}:${proxy.nodeId}:${propertyId}`]: { code, message } });
            else if (!propertyId) updatePanel(proxy.targetFrameId, { error: `proxy frame 오류: ${message}` }); }} /> };
    }),
  ].filter(frame => frame.id !== "source" || !workspace.hiddenFrames.includes("source"));

  // ── Inspector (right) ──────────────────────────────────────────────────────
  /** Frame handles are played with the Select tool: making one switches to it. */
  /** Errors of this node's handles that still apply (its code has not changed since). */
  const nodeHandleErrors = (frameId: string, current: NonNullable<typeof node>) => Object.fromEntries(current.transformations.flatMap(item => item.properties).flatMap(property => {
    const error = handleErrors[`${frameId}:${current.id}:${property.id}`];
    return error && property.handle?.prepared === error.code ? [[property.id, error.message]] : [];
  }));
  const statusLabel = liveStatus === "live" ? panel.dirtyNodeIds.length ? "Live · descriptions changed, regenerate to apply" : "Live · controls update code & visual" : liveStatus === "changed" ? "Structure changed · update code to connect" : generated ? "Connect controls to your current code" : "Generate code to enable live controls";
  const propertiesStage = <>
    {stale && <div className="stale-banner">{sourceSketch ? `원본 스케치(${sourceSketch.name})가 바뀌었습니다. 원본에서 다시 Extract하면 새 프레임으로 추출됩니다.` : "스케치가 바뀌었습니다. 다시 Extract하면 새 프레임으로 추출됩니다."}</div>}
    {scene.nodes.length > 0 && <div className={`live-controls-status status-${liveStatus}`} role="status"><span className="status-dot" />{statusLabel}</div>}
    {scene.nodes.length > 0 && <button className="primary-button rules-generate-button" disabled={busy} onClick={() => { void ai.generateCode(); }}>{generated && (liveStatus !== "live" || panel.dirtyNodeIds.length) ? "Update code" : generated ? "Regenerate code" : "Generate code"}<Icon name="code" size={17} /></button>}
    {panel.runtimeError && generated && <div className="runtime-error" role="alert">{panel.runtimeError}<button disabled={busy} onClick={() => { void ai.generateCode(true); }}>Fix with AI</button></div>}
    {node && nodeRole && <BrushRoleBanner role={nodeRole} nodeName={node.name} masterFrame={masterFrame(nodeRole.brush)} onMaster={() => goToMaster(nodeRole.brush)}
      onDetach={() => detachInstance(activeSketch, nodeRole.rootId, nodeRole.brush.id)} onAdopt={() => adoptMaster(activeSketch, nodeRole.rootId, nodeRole.brush.id)}
      onDelete={busy ? undefined : () => { edits.removeIds([nodeRole.rootId]); setToast(nodeRole.master ? `${nodeRole.brush.name}의 master를 지웠습니다. Brush는 저장된 사본으로 계속 쓸 수 있습니다 (Layers에서 되돌리기).` : `${nodeRole.brush.name} brush stamp를 지웠습니다 (Layers에서 되돌리기).`); }} />}
    {node ? (() => { const transform = (apply: () => void) => guard(node.id, "semantic transformation", apply), machine = (apply: () => void) => guard(node.id, "state machine", apply); return <PropertyInspector node={node} transformations={inspectedTransformations(panel, node)} library={scene.algorithms} state={nodeState} busy={busy} clip={clip}
      onNode={patch => "description" in patch ? guard(node.id, "설명", () => edits.editNode(node.id, patch)) : edits.editNode(node.id, patch)} onTransformation={(id, patch) => transform(() => edits.editTransformation(node.id, id, patch))}
      onAddTransformation={() => transform(() => edits.addTransformation(node.id))} onRemoveTransformation={id => transform(() => edits.removeTransformation(node.id, id))} onMoveTransformation={(id, offset) => transform(() => edits.moveTransformation(node.id, id, offset))} onChooseState={stateId => edits.chooseState(node.id, stateId)}
      onState={patch => nodeState && machine(() => edits.editState(node.id, nodeState.id, patch))} onTransition={(id, patch) => machine(() => edits.editTransition(node.id, id, patch))}
      onScalar={(propertyId, path, value) => edits.scalar(node.id, propertyId, path, value)} onSwap={(propertyId, path, choice) => transform(() => edits.swap(node.id, propertyId, path, choice))}
      onProperty={(propertyId, patch) => transform(() => edits.editProperty(node.id, propertyId, patch))} onRemoveProperty={propertyId => transform(() => edits.removeProperty(node.id, propertyId))}
      onAddProperty={(algorithmId, transformationId) => transform(() => edits.addProperty(node.id, algorithmId, transformationId))} onRegenerate={target => transform(() => updatePanel(activeSketch, { transformDraft: { nodeId: node.id, target, instruction: "", annotating: false, marks: [] } }))}
      draft={panel.transformDraft?.nodeId === node.id ? panel.transformDraft : null}
      onDraftChange={patch => updatePanel(activeSketch, previous => previous.transformDraft ? { transformDraft: { ...previous.transformDraft, ...patch } } : {})}
      onDraftSubmit={() => { const draft = panel.transformDraft; if (!draft) return; updatePanel(activeSketch, previous => previous.transformDraft ? { transformDraft: { ...previous.transformDraft, annotating: false } } : {}); void ai.regenerate(draft.nodeId, draft.target, draft.instruction, draft.marks); }}
      onDraftCancel={() => updatePanel(activeSketch, { transformDraft: null })}
      onMinimalExample={transformationId => { void ai.minimalExample(node.id, transformationId); }}
      highlightPropertyId={(focus => inspectionKind && focus?.kind === "constraint" && focus.nodeId === node.id ? focus.id : null)(activeBrush ? inspectionFor(panel, activeBrush.id).focus : null)}
      highlightTransformationId={(focus => inspectionKind && focus?.kind === "transformation" && focus.nodeId === node.id ? focus.id : null)(activeBrush ? inspectionFor(panel, activeBrush.id).focus : null)}
      onMakePen={(propertyId, path) => edits.makePen({ nodeId: node.id, propertyId, path })}
      onHandle={(propertyId, handle) => edits.handle(node.id, propertyId, handle)} onDesignHandles={(target, instruction) => { void ai.suggestHandles(node.id, target, instruction); }}
      onOpenProxy={() => openProxy(activeSketch, node.id)} handleErrors={nodeHandleErrors(activeSketch, node)}
      onCopy={(propertyId, path) => edits.copySlot(node.id, propertyId, path)} onPaste={(propertyId, path, dropped) => transform(() => edits.pasteSlot(node.id, propertyId, path, dropped))}
      clipFor={(propertyId, path) => edits.clipFor(node.id, propertyId, path)} onAddBlock={(block, transformationId) => transform(() => edits.addBlock(node.id, block, transformationId))} onGenerateMachine={() => machine(() => { void ai.generateMachine(node.id); })} onRemoveMachine={() => machine(() => edits.removeMachine(node.id))} />; })()
      : <><div className="section-kicker">LOOK A LITTLE CLOSER</div><h2>Every sketch is<br />a set of systems.</h2>
        <p className="section-description">{scene.nodes.length ? "Select a brush stamp or object in Layers or on the sketch to edit its semantic transformation." : "Draw or attach a photo, then extract its collections and objects."}</p>
        {!scene.nodes.length && <div className="empty-features"><Icon name="layers" size={30} /><p>No brush stamps yet.</p><span>Sketch → Extract → Explore</span><button className="primary-button" disabled={!sourcePresent || busy} onClick={() => { void ai.extract(); }}>Extract {currentSelection ? "selection" : "sketch"}<Icon name="spark" size={17} /></button></div>}
        {scene.nodes.length > 0 && <button className="copy-button" disabled={busy || !sourcePresent} onClick={() => { void ai.extract(); }}>Re-extract {currentSelection ? "selection" : "sketch"}</button>}
      </>}
    <AlgorithmLibrary scene={scene} busy={busy} targetName={node?.name || null} imports={algorithmImports}
      onEdit={edits.editAlgorithm} onUse={algorithmId => { if (node) edits.addProperty(node.id, algorithmId); }} onMakePen={algorithmId => edits.makePen({ algorithmId })}
      onCopy={edits.copyDefinition} clipFor={edits.definitionClip}
      onImport={key => { const item = algorithmImports.find(entry => entry.key === key); if (item) { edits.importAlgorithm(item.source); setToast(`${item.algorithm.name} 블록을 이 스케치로 가져왔습니다.`); } }} />
  </>;

  return <div className="studio live-studio freeform-studio scene-studio">
    <header className="topbar"><a className="brand" href="/" aria-label="Rulegen home"><span className="brand-mark"><i /><i /><i /></span>rulegen<span className="beta">LAB</span></a><div className="project-title"><span className="slash">/</span><input aria-label="Project name" value={artwork.name} maxLength={200} onChange={e => setArtwork(a => ({ ...a, name: e.target.value }))} /><span className="saved-dot" /><span className="saved-label">{saveState}</span></div><div className="top-actions"><button className="text-button" onClick={() => setHistoryOpen(true)}>AI history<Icon name="undo" size={14} /></button><button className="text-button" onClick={() => setExportOpen(true)}>Export project <Icon name="download" size={14} /></button><button className="text-button" onClick={() => importInput.current?.click()}>Open JSON</button><button className="text-button" onClick={() => { setNewName(""); setModal(true); }}>New exploration <Icon name="plus" size={15} /></button></div></header>
    <input ref={upload} className="visually-hidden" type="file" accept="image/png,image/jpeg,image/webp" aria-label="Attach photograph" onChange={e => { if (e.target.files?.[0]) void attach(e.target.files[0]); e.target.value = ""; }} />
    <input ref={importInput} className="visually-hidden" type="file" accept=".json" aria-label="Open project JSON" onChange={async e => { const file = e.target.files?.[0]; e.target.value = ""; if (!file) return; try { if (file.size > 12_000_000) throw new Error("프로젝트 파일이 너무 큽니다."); restore(projectSchema.parse(JSON.parse(await file.text()))); } catch { patchActive({ error: "올바른 Rulegen 프로젝트 JSON 파일을 선택해주세요." }); } }} />
    <div className="workspace">
      <ToolRail tool={tool} inspectionEraser={brushPick?.kind === "inspect-annotate" ? inspectionEraser : undefined} toolsActive pencilOpen={pencilOpen} color={color} width={width} opacity={opacity} pens={algorithmPens} activePen={activeSemanticPen} penSettingsOpen={penSettingsOpen}
        busy={busy} canAddSketch={!busy && (sketchFrames.length < 24 || workspace.hiddenFrames.includes("source"))} canUndo={canUndo} canRedo={canRedo} canClear={!(annotating && (busy || !annotations.length))} zoom={workspace.camera?.zoom || .4}
        onTool={chooseTool} onPencilClose={() => setPencilOpen(false)} onColor={setColor} onWidth={setWidth} onOpacity={setOpacity}
        onPen={pen => { if (tool === "semantic" && activeSemanticPenId === pen.id) { setPenSettingsOpen(open => !open); setPencilOpen(false); } else selectAlgorithmPen(pen); }}
        onPenChange={editDrawingPen} onPenRemove={pen => { setSemanticPens(current => current.filter(item => item.id !== pen.id)); setActiveSemanticPenId(null); setTool("pen"); setPenSettingsOpen(false); }} onPenSettingsClose={() => setPenSettingsOpen(false)}
        onUndo={undo} onRedo={redo} onClear={clearCanvas} onZoom={amount => workspaceCanvas.current?.zoom(amount)} onFit={() => workspaceCanvas.current?.fit()}
        onHome={() => workspaceCanvas.current?.fit()} onAddSketch={addSketchFrame} onAttach={() => upload.current?.click()}
        brushes={brushes} groupTools={groupTools} openGroup={openGroup} onBrushGroup={clickBrushGroup} onBrushTool={chooseBrushTool} onBrushGroupClose={() => setOpenGroup(null)} onTargetedRemove={removeTargeted}
        onBrushChange={brush => setBrushes(brushesRef.current.map(item => item.id === brush.id ? brush : item))} onBrushRemove={removeBrush} brushMaster={masterFrame} onBrushMaster={brush => { setOpenGroup(null); goToMaster(brush); }}
        onHelp={() => setToast("V 선택·이동 · P 연필 · E 지우개 · L 라쏘 · H 이동 · ⌘/Ctrl+G 그룹 · ⇧⌘G 그룹 해제 · Delete 레이어 삭제 · 화살표 이동 · ⌘/Ctrl+Z 실행 취소 · ⌘/Ctrl+V 이미지 붙여넣기 · Esc 선택 해제")} />
      <aside className="layer-sidebar">
        <LayerPanel scene={scene} sketchId={activeSketch} selected={panel.selectedNodeIds} hovered={panel.hovered} busy={busy} canUndo={panel.sceneHistory.length > 0} canRedo={panel.sceneFuture.length > 0} title={currentSketch.name}
          onSelect={edits.select} onHover={edits.hover}
          onRename={edits.rename} onToggleVisible={edits.toggleVisible} onGroup={edits.group} onUngroup={edits.ungroup} onDelete={edits.remove}
          onMove={edits.reparent} onReorder={edits.reorder} onAdd={edits.add} onUndo={edits.undo} onRedo={edits.redo}
          onExtract={() => { void ai.extract(); }} canExtract={sourcePresent}
          badge={id => { const role = brushRole(scene, activeSketch, id, brushes); return role?.rootId === id ? <BrushRoleBadge role={role} /> : null; }} />
      </aside>
      <main className="canvas-workspace">
        <FreeformWorkspace ref={workspaceCanvas} highlight={linkHover}
          links={proxyFrames.map(proxy => ({ from: proxy.id as FrameId, to: proxy.targetFrameId as FrameId, label: "◎ 조작" }))} onDeleteFrame={deleteFrame} deleteDisabled={busy} layout={workspace} onChange={setWorkspace} activeFrame={activeSketch as FrameId} tool={tool}
          onActivateFrame={id => activateFrame(id)}
          onBackground={() => { setPencilOpen(false); setPenSettingsOpen(false); }} onDrop={file => { void attach(file); }} frames={frames} />
        <footer className="workspace-footer"><span><span className="status-dot" />{configured ? `Connected · ${model}` : configured === false ? "OpenAI configuration required" : "Connecting…"}</span><span>FREEFORM · P5.JS</span></footer>
      </main>
      <aside ref={inspectorPanel} className={`inspector ${inspectorWidth ? "inspector-resized" : ""}`} style={inspectorWidth ? { "--inspector-width": `${inspectorWidth}px` } as React.CSSProperties : undefined}>
        <PanelResizer label="Resize properties panel" min={280} max={Math.max(320, Math.min(900, (typeof window === "undefined" ? 1400 : window.innerWidth) - 520))}
          measure={() => inspectorPanel.current?.getBoundingClientRect().width || 354} onResize={setInspectorWidth} onReset={() => setInspectorWidth(null)} /><div className="inspector-title"><span aria-label="Inspector sketch" title={currentSketch.name}>{node ? `${currentSketch.name} / ${node.name}` : currentSketch.name}</span><Icon name="spark" size={17} /></div>
        {clip && <div className="block-clipboard" title="Right-click a socket to paste, or drag blocks from the palette"><span className="algorithm-badge">ƒ</span>Clipboard · <strong>{clip.label}</strong></div>}
        {panel.loading && <div className="loading-banner" role="status"><span className="loading-spinner" /><span>{panel.loading}</span><button onClick={() => cancel()}>Cancel</button></div>}{panel.error && <div className="error-banner" role="alert"><span>{panel.error}</span><button aria-label="Dismiss error" onClick={() => patchActive({ error: "" })}><Icon name="close" size={14} /></button></div>}
        <div ref={inspector} className="inspector-content live-inspector-content">
          {!annotating && <SketchComposition artwork={currentSketch} prompt={panel.composePrompt} onPrompt={value => patchActive({ composePrompt: value })} onDraft={() => { void ai.draftComposePrompt(); }} onCompose={() => { void ai.compose(); }} busy={busy} drafting={panel.loading === compositionPromptLabel} />}
          {annotating && <ResultRevisionPanel hasSketch={Boolean(annotations.length)} clarifying={panel.clarifying} onClarify={() => { void revisions.beginClarification(); }} onRegenerateClarification={() => { void revisions.requestClarification(); }} generatingClarification={panel.loading === clarificationLabel} clarificationStale={Boolean(panel.clarificationContext && panel.clarificationContext !== revisionSnapshot(panel, ""))} onSketch={() => patchActive({ clarifying: false })} instruction={panel.revisionInstruction} proposal={panel.revisionProposal?.proposal || null} changes={proposalChanges} stale={proposalStale} busy={busy} tool={tool} canUndo={panel.annotationHistory.past.length > 0} canRedo={panel.annotationHistory.future.length > 0} onTool={chooseTool} onUndo={undo} onRedo={redo} onInstruction={value => patchActive({ revisionInstruction: value })} onRequest={() => { void revisions.requestRevision(); }} onConfirm={() => { void revisions.confirmRevision(); }} onDiscard={() => patchActive({ revisionProposal: null })} onClose={() => patchActive({ annotating: false })} />}
          {propertiesStage}
          {scene.nodes.length > 0 && <label className="refinement-input"><span>YOUR DIRECTION <small>optional</small></span><textarea aria-label="Generation direction" placeholder="예: 더 유기적으로, 반복은 적게, 파란색으로…" value={panel.instruction} maxLength={2000} onChange={e => patchActive({ instruction: e.target.value })} /></label>}
        </div><div className="inspector-footer"><span className="tiny-dot" />Built for exploration, not perfection.</div></aside>
    </div>
    <RawCodePanel code={liveSource} sketchName={currentSketch.name} fileName={generated?.title || currentSketch.name} onCopy={() => setToast("p5.js 코드를 복사했습니다.")} onError={message => patchActive({ error: message })}
      editor={{ draft: panel.codeDraft || "", busy, runtimeError: panel.runtimeError, onDraft: value => patchActive({ codeDraft: value }),
        onRun: () => { if (!generated) return; if (generated.code === panel.codeDraft) void prepare(panel.codeDraft); else patchActive({ generated: { ...generated, code: panel.codeDraft || "" }, executable: "", preparedCode: "" }); patchActive(previous => ({ renderRevision: previous.renderRevision + 1 })); },
        onFix: () => { void ai.generateCode(true); } }}
      inspectionPanel={inspectionKind && activeBrush ? <InspectionPanel brush={activeBrush} kind={inspectionKind} scene={scene} nodeIds={brushNodeIds(scene, activeBrush, activeSketch)} state={inspectionFor(panel, activeBrush.id)} busy={busy} running={Boolean(panel.executable)}
        frameId={activeSketch} frames={brushFrames(activeBrush)} onFrame={frameId => inspectFrame(frameId, activeBrush)}
        onCursor={cursor => patchInspection(activeSketch, { cursor })} onClear={() => patchInspection(activeSketch, { steps: [], cursor: null, focus: null })}
        onFocus={focus => focusInspection(activeSketch, focus)}
        eraser={inspectionEraser} onEraser={setInspectionEraser}
        onConcern={concern => patchInspection(activeSketch, { concern })} onClearMarks={() => patchInspection(activeSketch, { marks: [], markStyles: [] })}
        pen={inspectionPen} onPen={setInspectionPen}
        suggestions={concernSuggest.key === `${activeSketch}|${activeBrush.id}` ? concernSuggest : { items: [], loading: false, error: "" }} onSuggest={() => { void requestConcerns(); }}
        targeted={targetedIn(activeSketch, panel)} onInspect={() => { void runTargeted(activeBrush); }}
        applied={{ past: panel.applied.past, future: panel.applied.future, undoClean: appliedCurrent(panel, "undo"), redoClean: appliedCurrent(panel, "redo") }} recommendationKey={recommendationKey}
        onUndoApplied={() => { const entry = stepApplied(deps, activeSketch, "undo"); if (entry) setToast(`「${entry.title}」 적용을 되돌렸습니다 (장면과 코드).`); }}
        onRedoApplied={() => { const entry = stepApplied(deps, activeSketch, "redo"); if (entry) setToast(`「${entry.title}」을(를) 다시 적용했습니다.`); }}
        onApplyChanges={changes => applyChanges(deps, activeSketch, changes)}
        code={panel.generated?.code} onApplyRecording={item => { void applyRecording(deps, activeSketch, item).then(done => { if (done) setToast(`그려진 항목마다 ${item.fields.join(", ")}을(를) 기록하도록 코드를 고쳤습니다.`); }); }}
        onAcceptParameter={item => guardEach([item.nodeId], "semantic transformation", () => { void acceptParameter(deps, activeSketch, item).then(added => { if (added) setToast(`「${item.label}」을(를) property로 추가했습니다. 바로 조절할 수 있습니다.`); }); })}
        onRejectParameter={(index, rejected) => { if (activeTargeted) patchTargeted(activeBrush.id, activeTargeted.id, entry => ({ ...entry, result: { ...entry.result, parameters: entry.result.parameters.map((item, i) => i === index ? { ...item, rejected } : item) } })); }}
        onParameterValue={(nodeId, propertyId, value) => edits.scalar(nodeId, propertyId, [], value)}
        onApplyRecommendation={(recommendation, index, listed) => recommendation.kind === "value" ? void applyRecommendation(deps, activeSketch, recommendation, recommendationKey(listed))
          : guardEach([recommendation.nodeId], recommendation.kind === "transformation" || recommendation.kind === "add-transformation" ? "semantic transformation" : "state machine", () => { void applyTargetedRecommendation(activeBrush, recommendation, index, listed); })} onTool={toolId => chooseBrushTool(activeBrush.id, toolId)} /> : undefined}
      machinePanel={<NodeMachinePanel scene={scene} node={machineNode}
        inspected={inspection && machineNode && inspectedIds.includes(machineNode.id) ? machineInspection(inspection, inspectionKind === "targeted" ? targetedIn(activeSketch, panel)?.result ?? null : null, machineNode.id) : null} editingStateId={machineNode ? panel.editingStates[machineNode.id] || null : null} runtimeStateId={machineNode ? panel.runtimeStates[machineNode.id] || null : null}
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
        onRestart={() => machineNode && restartMachine(machineNode.id)} onEvent={transitionId => machineNode && emitTransition(machineNode.id, transitionId)} />} />
    {detachPrompt && (() => { const brush = brushes.find(item => item.id === detachPrompt.brushId); if (!brush) return null;
      const close = () => setDetachPrompt(null);
      return <DetachDialog prompt={detachPrompt} brushName={brush.name} masterFrame={masterFrame(brush)} onCancel={close}
        onDetach={() => { close(); if (detachInstance(detachPrompt.frameId, detachPrompt.rootId, brush.id)) detachPrompt.apply(); }}
        onMaster={() => { close(); goToMaster(brush); }}
        onAdopt={() => { close(); if (adoptMaster(detachPrompt.frameId, detachPrompt.rootId, brush.id)) detachPrompt.apply(); }} />; })()}
    {toast && <div className="toast" role="status"><Icon name="spark" size={17} /><span>{toast}</span><button aria-label="Dismiss notification" onClick={() => setToast("")}><Icon name="close" size={15} /></button></div>}
    {historyOpen && <GenerationHistory disabled={busy} onClose={() => setHistoryOpen(false)} onRestore={restoreAIHistory} />}
    {frameJson && panels[frameJson] && <FrameJsonDialog name={artworkOf(frameJson)?.name || frameJson} onClose={() => setFrameJson(null)} onCopied={setToast}
      data={frameExport({ id: frameJson, name: artworkOf(frameJson)?.name || frameJson, scene: panels[frameJson].scene, generated: panels[frameJson].generated,
        brushOf: nodeId => { const role = brushRole(panels[frameJson].scene, frameJson, nodeId, brushes); return role ? { name: role.brush.name, master: role.master } : null; },
        brushes: brushes.filter(brush => brushNodeIds(panels[frameJson].scene, brush, frameJson).length).map(brush => ({ id: brush.id, name: brush.name, roots: brushRoots(panels[frameJson].scene, brush, frameJson), targeted: brush.targeted })) })} />}
    {exportOpen && <div className="modal-backdrop" onClick={() => setExportOpen(false)}><div className="modal project-export-modal" role="dialog" aria-modal="true" aria-labelledby="export-title" onClick={e => e.stopPropagation()}><button className="modal-close" aria-label="Close export dialog" onClick={() => setExportOpen(false)}><Icon name="close" /></button><div className="section-kicker">KEEP YOUR EXPLORATION</div><h2 id="export-title">Take your project with you.</h2><p>스케치·사진·collection·object·알고리즘 블록·코드가 함께 저장됩니다. JSON 파일로 다운로드하거나 복사할 수 있어요.</p><textarea aria-label="Exported project JSON" className="project-json-preview" readOnly value={JSON.stringify(projectData(), null, 2)} /><button className="primary-button" onClick={() => downloadFile(`${artwork.name}.rulegen.json`, JSON.stringify(projectData(), null, 2), "application/json")}>Download project JSON<Icon name="download" /></button><button className="alternative-button" onClick={async () => { try { await navigator.clipboard.writeText(JSON.stringify(projectData(), null, 2)); setToast("프로젝트 JSON을 복사했습니다."); } catch { patchActive({ error: "JSON 내용을 선택해 복사하거나 다운로드해주세요." }); } }}>Copy project JSON<Icon name="copy" size={15} /></button></div></div>}
    {modal && <div className="modal-backdrop" onClick={() => setModal(false)}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="new-title" onClick={e => e.stopPropagation()}><button className="modal-close" aria-label="Close dialog" onClick={() => setModal(false)}><Icon name="close" /></button><div className="section-kicker">A FRESH PERSPECTIVE</div><h2 id="new-title">What will you explore?</h2><p>새 탐색을 시작하면 현재 로컬 초안이 교체됩니다. JSON으로 내보내면 언제든 다시 열 수 있어요.</p><label>Exploration name<input autoFocus value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === "Enter" && newProject()} /></label><button className="primary-button" onClick={newProject}>Start exploring<Icon name="arrow" /></button></div></div>}
  </div>;
}
