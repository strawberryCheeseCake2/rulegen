import { useEffect, useRef, useState } from "react";
import type { Route } from "./+types/home";
import { Icon } from "../components/icons";
import { SketchCanvas, type CanvasHandle } from "../components/sketch-canvas";
import { FreeformWorkspace, type FrameLink, type WorkspaceHandle } from "../components/freeform-workspace";
import { ToolRail } from "../components/tool-rail";
import type { CodePreviewHandle } from "../components/code-preview";
import { FrameRender } from "../components/frame-render";
import { GenerationHistory } from "../components/generation-history";
import { RawCodePanel } from "../components/raw-code-panel";
import { SketchComposition } from "../components/sketch-composition";
import { CompositionHead, ExampleHead, ObjectHead, SketchWorkflow, type ExampleRow } from "../components/workflow-panels";
import { LayerPanel } from "../components/scene/layer-panel";
import { SceneOverlay } from "../components/scene/scene-overlay";
import { PropertyInspector } from "../components/scene/property-inspector";
import { PanelResizer } from "../components/panel-resizer";
import { AlgorithmLibrary, type AlgorithmSource } from "../components/scene/algorithm-library";
import { NodeMachinePanel } from "../components/scene/node-machine-panel";
import { besideFrameGrid, nextSketchPosition, removeWorkspaceFrame, showWorkspaceFrame, workspaceSchema, type FrameId, type WorkspaceLayout } from "../lib/workspace";
import { type RecoveredGeneration } from "../lib/generation-recovery";
import type { Artwork, SemanticPen, Stroke, Viewport } from "../lib/schema";
import { type SketchFrame, projectSchema, exampleStrokes, readPhoto, downloadFile, MAX_PENS, MAX_SKETCH_FRAMES } from "../lib/project";
import { createInteractionPen, examplePen, livePen, semanticPenColors } from "../lib/algorithm-pens";
import { createSketchPanel, newTransformDraft, savedSketchPanels, type SketchPanel } from "../lib/sketch-panels";
import { clarificationTarget } from "../lib/scene/clarify";
import { AnnotationComposer } from "../components/annotation-composer";
import { emptyScene } from "../lib/scene/schema";
import { algorithmClosure, instantiate } from "../lib/scene/algorithms";
import { findNode } from "../lib/scene/graph";
import { syncScene } from "../lib/scene/machines";
import { liveSceneSource, sceneLiveStatus } from "../lib/scene/live";
import { findTransformation } from "../lib/scene/transformations";
import { editingState, inspectedNode, inspectedTransformations, commitScene } from "../lib/scene/panel-ops";
import { markLogged, reportError } from "../lib/error-report";
import type { StudioDeps, PanelPatch } from "../studio/deps";
import { compositionPromptLabel, decomposeLabel, sceneAI, sceneEdits, splitLabel, splitTarget } from "../studio/scene-actions";
import type { AlgorithmClip } from "../lib/scene/transfer";

export function meta({}: Route.MetaArgs) { return [{ title: "Rulegen — From a mark to a system" }, { name: "description", content: "Sketch, decompose into semantic transformations, turn each into a pen, and compose p5.js systems with AI." }]; }
const blank = (): Artwork => ({ strokes: [], photo: null, name: "Untitled exploration", revision: 0 });
const storageKey = "rulegen.project.v1";
const drawingViewport: Viewport = { zoom: 1, x: 0, y: 0 };

export default function Home() {
  // ── Frames (the original sketch and every other frame) ─────────────────────
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

  // ── Per-frame panels (kept in a ref too, so chained actions see their own writes) ──
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
  const [color, setColor] = useState("#75664e"), [width, setWidth] = useState(3), [opacity, setOpacity] = useState(80);
  const [workspace, setWorkspace] = useState<WorkspaceLayout>(() => workspaceSchema.parse({}));
  const workspaceCanvas = useRef<WorkspaceHandle>(null);
  /** Frames picked together on the board (select-tool drag), to delete together. */
  const [selectedFrames, setSelectedFrames] = useState<FrameId[]>([]);
  const [pendingFrameFocus, setPendingFrameFocus] = useState<FrameId | null>(null);
  const resultPreviews = useRef(new Map<string, CodePreviewHandle>());
  // The frame whose running result takes mouse, touch and keyboard input (Esc stops).
  const [playing, setPlaying] = useState<string | null>(null);
  // Studio-wide clipboard for algorithm blocks (copy in one frame, paste in any).
  const [clip, setClip] = useState<AlgorithmClip | null>(null);
  const clipRef = useRef(clip); clipRef.current = clip;
  const [penSettingsOpen, setPenSettingsOpen] = useState(false);
  // Right panel width chosen by dragging its edge (null = responsive default); remembered per browser.
  const inspectorPanel = useRef<HTMLElement>(null);
  const [inspectorWidth, setInspectorWidth] = useState<number | null>(null);
  // Transformation pens (one per minimal example) and the built-in interaction pen.
  const [semanticPens, setSemanticPensState] = useState<SemanticPen[]>([]), [activeSemanticPenId, setActiveSemanticPenId] = useState<string | null>(null);
  const semanticPensRef = useRef(semanticPens);
  const setSemanticPens = (next: SemanticPen[]) => { semanticPensRef.current = next; setSemanticPensState(next); };
  const [interactionPen, setInteractionPen] = useState<SemanticPen>(createInteractionPen);
  const [toast, setToast] = useState(""), [model, setModel] = useState(""), [configured, setConfigured] = useState<boolean | null>(null);
  const [restoreReady, setRestoreReady] = useState(false), [saveState, setSaveState] = useState("Local draft");
  const [historyOpen, setHistoryOpen] = useState(false), [modal, setModal] = useState(false), [exportOpen, setExportOpen] = useState(false), [newName, setNewName] = useState("");
  const upload = useRef<HTMLInputElement>(null), importInput = useRef<HTMLInputElement>(null), inspector = useRef<HTMLDivElement>(null);
  // AI work is per frame: each frame has its own request in flight, abort controller and request number, so switching frames never cuts another frame's generation.
  const aborts = useRef(new Map<string, AbortController>()), requestNumbers = useRef(new Map<string, number>()), activeDocument = useRef(0), prepareNumber = useRef(0);

  // ── Derived view of the active frame ───────────────────────────────────────
  const { scene, generated } = panel;
  const busy = Boolean(panel.loading);
  const artworkOf = (id: string) => id === "source" ? artworkRef.current : sketchFramesRef.current.find(frame => frame.id === id)?.artwork;
  const currentSketch = activeSketch === "source" ? artwork : sketchFrames.find(f => f.id === activeSketch)?.artwork || artwork;
  const sourcePresent = Boolean(currentSketch.photo || currentSketch.strokes.length);
  // An example or composition is stale when the sketch it was made from has changed since.
  const sourceSketch = panel.sourceFrameId ? artworkOf(panel.sourceFrameId) : undefined;
  const stale = panel.role !== "sketch" && Boolean(sourceSketch) && panel.analysisRevision !== sourceSketch!.revision;
  const liveSource = liveSceneSource(generated, scene);
  const liveStatus = sceneLiveStatus(generated, scene);
  const node = inspectedNode(panel);
  const nodeState = editingState(panel, node);
  const machineNode = node || scene.nodes.find(item => item.machine);
  /** A pen as it reads now: the toolbar's copy (by id) following its minimal example while that frame has it. */
  const resolvePen = (pen: SemanticPen) => livePen(semanticPensRef.current.find(item => item.id === pen.id) ?? pen, frameId => artworkOf(frameId) ? panelsRef.current[frameId]?.scene : undefined);
  const algorithmPens = [interactionPen, ...semanticPens.map(resolvePen)];
  const activeSemanticPen = algorithmPens.find(pen => pen.id === activeSemanticPenId);

  // ── Server requests ────────────────────────────────────────────────────────
  function projectData() {
    return { version: 2 as const, name: artwork.name, artwork: artworkRef.current, sketchFrames: sketchFramesRef.current, activeSketchId: activeSketchRef.current,
      sketchPanels: savedSketchPanels(panelsRef.current), semanticPens: semanticPensRef.current.map(resolvePen), interactionPen, activeSemanticPenId, workspace };
  }
  async function request(intent: string, body: object, owner = activeSketch) {
    updatePanel(owner, { error: "" });
    const controller = new AbortController(); aborts.current.set(owner, controller);
    const recoveryContext = { project: { ...projectData(), activeSketchId: owner }, owner };
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
    if (panelsRef.current[owner]?.loading) updatePanel(owner, { loading: "", pendingResult: false });
  }
  /** Stop every frame's AI work (a project is opened, replaced or closed). */
  function cancelAll() { for (const owner of new Set([...aborts.current.keys(), ...Object.keys(panelsRef.current)])) cancel(owner); }
  const canvasFor = (id: string) => id === "source" ? canvas.current : sketchCanvases.current.get(id);
  /** A pen for the toolbar, with a free color and a unique name (null when the toolbar is full). */
  function addPen(make: (id: string, color: string) => SemanticPen | null) {
    const pens = semanticPensRef.current;
    if (pens.length >= MAX_PENS) return null;
    const pen = make(crypto.randomUUID(), semanticPenColors.find(c => !pens.some(p => p.color === c)) || semanticPenColors[pens.length % semanticPenColors.length]);
    if (!pen) return null;
    const baseName = pen.name.slice(0, 90); let name = baseName, suffix = 2;
    while (pens.some(item => item.name === name)) name = `${baseName} ${suffix++}`;
    const next = { ...pen, name };
    setSemanticPens([...pens, next]);
    return next;
  }
  /** Make a pen from a transformation example frame (Make pen): it follows that example from now on. */
  function makeExamplePen(id: string) {
    const frame = panelsRef.current[id], example = frame?.example;
    if (frame?.role !== "example" || !example || example.kind !== "transformation") return;
    const existing = semanticPensRef.current.find(pen => pen.id === example.penId);
    if (existing) { selectAlgorithmPen(existing); return; }
    if (semanticPensRef.current.length >= MAX_PENS) { setToast(`펜은 최대 ${MAX_PENS}개까지 만들 수 있습니다. 쓰지 않는 펜을 지워주세요.`); return; }
    const pen = addPen((penId, color) => examplePen(frame.scene, id, example, penId, color));
    if (!pen) { updatePanel(id, { error: "이 예제의 transformation을 찾지 못해 펜을 만들 수 없습니다." }); return; }
    updatePanel(id, current => current.example ? { example: { ...current.example, penId: pen.id } } : {});
    setToast(`펜 「${pen.name}」을 만들었습니다. 이 예제의 지금 상태를 따라갑니다.`);
  }
  /** New frames beside `fromId` (a grid of columns for several), with empty sketches and panels. */
  function createFrames(fromId: string, names: string[]) {
    const room = Math.max(0, MAX_SKETCH_FRAMES - sketchFramesRef.current.length), count = Math.min(room, names.length);
    if (!count) return [];
    const ids = names.slice(0, count).map(() => `sketch-${crypto.randomUUID()}` as const);
    const frames = [...sketchFramesRef.current, ...ids.map((id, i) => ({ id, artwork: { ...blank(), name: names[i].slice(0, 200) } }))];
    sketchFramesRef.current = frames; setSketchFrames(frames);
    setWorkspace(current => { const spots = besideFrameGrid(current.frames, fromId, count); return { ...current, frames: { ...current.frames, ...Object.fromEntries(ids.map((id, i) => [id, spots[i]])) } }; });
    setSketchHistories(current => ({ ...current, ...Object.fromEntries(ids.map(id => [id, { past: [], future: [] }])) }));
    mutatePanels(current => ({ ...current, ...Object.fromEntries(ids.map(id => [id, createSketchPanel()])) }));
    return ids;
  }
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
  /** What a frame shows: its rendered result (if any) under its strokes, as one image. */
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
    capture: captureFrame, createFrames, resolvePen, pen: id => { const pen = semanticPensRef.current.find(item => item.id === id); return pen && resolvePen(pen); },
    preview: owner => resultPreviews.current.get(owner),
    artwork: artworkOf, documentId: () => activeDocument.current, requestId: owner => requestNumbers.current.get(owner) ?? 0,
    toast: setToast, focus: setPendingFrameFocus,
    clip: () => clipRef.current, setClip: next => { clipRef.current = next; setClip(next); }, activate: id => activateSketch(id), active: () => activeSketchRef.current,
  };
  const edits = sceneEdits(deps, activeSketch), ai = sceneAI(deps, activeSketch);

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
  }, [artwork, sketchFrames, activeSketch, panels, semanticPens, interactionPen, activeSemanticPenId, workspace, restoreReady]);
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
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(""), 6000); return () => clearTimeout(timer); }, [toast]);
  // Value edits only patch the host block of the code draft.
  useEffect(() => { if (generated) patchActive(previous => { const codeDraft = syncScene(previous.codeDraft || "", previous.scene); return codeDraft === previous.codeDraft ? {} : { codeDraft, runtimeError: "" }; }); }, [scene, generated]);
  useEffect(() => { inspector.current?.scrollTo({ top: 0 }); }, [node?.id, activeSketch]);
  useEffect(() => { if (pendingFrameFocus) { workspaceCanvas.current?.focus(pendingFrameFocus); setPendingFrameFocus(null); } }, [pendingFrameFocus, sketchFrames, panels]);
  // A frame that is gone (or lost its result) stops taking input.
  useEffect(() => { if (playing && !panels[playing]?.generated) setPlaying(null); }, [playing, panels]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (historyOpen || modal || exportOpen || (e.target as HTMLElement).closest("input,textarea,select,[contenteditable]")) return;
      const command = e.metaKey || e.ctrlKey, key = e.key.toLowerCase();
      // Playing with a result: the frame only takes input for it; Esc stops.
      if (playing === activeSketch) { if (e.key === "Escape") setPlaying(null); return; }
      if (e.key === "Escape") { setSelectedFrames([]); setPencilOpen(false); setPenSettingsOpen(false); canvas.current?.clearSelection(); setModal(false); setExportOpen(false); setHistoryOpen(false); if (tool === "select") edits.select(null); }
      if (command && key === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      else if (command && key === "y") { e.preventDefault(); redo(); }
      else if (command && key === "g" && tool === "select") { e.preventDefault(); if (e.shiftKey) { if (node?.kind === "collection") edits.ungroup(node.id); } else edits.group(); }
      else if (tool === "select" && selectedFrames.length && (e.key === "Delete" || e.key === "Backspace")) { e.preventDefault(); if (!busy) deleteFrames(selectedFrames); }
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
    setSketchHistories({}); setSketchSelections({}); setSelectedFrames([]); setWorkspace(data.workspace); setSemanticPens(data.semanticPens); setInteractionPen(data.interactionPen); setActiveSemanticPenId(data.activeSemanticPenId); setPenSettingsOpen(false);
    setPlaying(null); setHistory([]); setFuture([]); canvas.current?.clearSelection();
  }
  function newProject() {
    cancelAll(); activeDocument.current++; prepareNumber.current++;
    const nextArtwork = { ...blank(), name: newName.trim() || "Untitled exploration" };
    mutatePanels(() => ({ source: createSketchPanel() })); setActiveSketch("source"); activeSketchRef.current = "source"; setPlaying(null);
    setSketchFrames([]); sketchFramesRef.current = []; setSketchHistories({}); setSketchSelections({}); setSelectedFrames([]); setSemanticPens([]);
    setWorkspace(workspaceSchema.parse({})); setArtwork(nextArtwork); artworkRef.current = nextArtwork;
    setTool("pen"); setPencilOpen(false); setActiveSemanticPenId(null); setPenSettingsOpen(false); setHistory([]); setFuture([]); setModal(false); canvas.current?.clearSelection();
  }
  function restoreAIHistory(data: RecoveredGeneration) {
    restore(data.project);
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
  /** Go to a frame (and make it active). */
  function showFrame(id: string) { if (!artworkOf(id)) return false; activateSketch(id); setPendingFrameFocus(id as FrameId); return true; }
  function addSketchFrame() {
    if (busy) return;
    if (workspace.hiddenFrames.includes("source")) {
      setWorkspace(current => showWorkspaceFrame(current, "source"));
      activateSketch("source"); setTool("pen"); setPencilOpen(false); setPenSettingsOpen(false); setPendingFrameFocus("source");
      return;
    }
    if (sketchFrames.length >= MAX_SKETCH_FRAMES) return;
    const id: FrameId = `sketch-${crypto.randomUUID()}`;
    const frames = [...sketchFramesRef.current, { id, artwork: { ...blank(), name: `Sketch ${sketchFramesRef.current.filter(frame => (panelsRef.current[frame.id]?.role ?? "sketch") === "sketch").length + 2}` } }];
    sketchFramesRef.current = frames; setSketchFrames(frames);
    setWorkspace(current => ({ ...current, frames: { ...current.frames, [id]: nextSketchPosition(current.frames) } }));
    setSketchHistories(current => ({ ...current, [id]: { past: [], future: [] } }));
    activateSketch(id); setPencilOpen(false); setPenSettingsOpen(false); setPendingFrameFocus(id);
  }
  /** Delete several frames at once (a board selection); frames still running AI work are kept. */
  function deleteFrames(ids: FrameId[]) {
    const removable = ids.filter(id => !panelsRef.current[id]?.loading), kept = ids.length - removable.length;
    if (!removable.length) { setToast("AI 작업 중인 프레임은 삭제할 수 없습니다. 먼저 작업을 취소해주세요."); return; }
    if (removable.length > 1 && !window.confirm(`선택한 ${removable.length}개 프레임을 삭제할까요? 되돌릴 수 없습니다.`)) return;
    const pens = removable.filter(id => panelsRef.current[id]?.example?.penId).length;
    for (const id of removable) deleteFrame(id, true);
    setSelectedFrames([]);
    setToast(`${removable.length}개 프레임을 삭제했습니다.${pens ? ` 예제로 만든 펜 ${pens}개는 지금 상태로 남아 있습니다.` : ""}${kept ? ` AI 작업 중인 ${kept}개는 남겼습니다.` : ""}`);
  }
  function deleteFrame(id: FrameId, quiet = false) {
    if (panelsRef.current[id]?.loading) return;
    setSelectedFrames(current => current.includes(id) ? current.filter(item => item !== id) : current);
    cancel(id); prepareNumber.current++;
    // A pen made from this example keeps the transformation as it is now.
    const example = panelsRef.current[id]?.example;
    if (example?.penId) setSemanticPens(semanticPensRef.current.map(pen => pen.id === example.penId ? resolvePen(pen) : pen));
    setPendingFrameFocus(null); setPencilOpen(false); setPenSettingsOpen(false); if (playing === id) setPlaying(null);
    const remaining = sketchFramesRef.current.filter(frame => frame.id !== id);
    sketchFramesRef.current = remaining; setSketchFrames(remaining);
    mutatePanels(current => { const next = { ...current }; if (id === "source") next.source = createSketchPanel(); else delete next[id]; return next; });
    setSketchHistories(current => { const next = { ...current }; delete next[id]; return next; });
    setSketchSelections(current => { const next = { ...current }; delete next[id]; return next; });
    sketchCanvases.current.delete(id); resultPreviews.current.delete(id);
    if (id === "source") { const empty = { ...blank(), name: artworkRef.current.name }; artworkRef.current = empty; setArtwork(empty); setHistory([]); setFuture([]); setHasSelection(false); }
    setWorkspace(current => removeWorkspaceFrame(current, id));
    if (activeSketchRef.current === id) {
      const sourceShown = id !== "source" && !workspace.hiddenFrames.includes("source") && !(quiet && selectedFrames.includes("source"));
      const fallback = sourceShown ? "source" : remaining[0]?.id || "source";
      activeSketchRef.current = fallback; setActiveSketch(fallback);
      if (fallback !== "source" || (id !== "source" && !workspace.hiddenFrames.includes("source"))) setPendingFrameFocus(fallback as FrameId);
    }
    if (!quiet) setToast(example?.penId ? "최소 예제 프레임을 삭제했습니다. 펜은 지금 상태로 남아 있습니다." : "프레임을 삭제했습니다.");
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
    const frames = sketchFramesRef.current.map(f => f.id === activeSketch ? { ...f, artwork: target } : f);
    sketchFramesRef.current = frames; setSketchFrames(frames);
    setSketchHistories(current => ({ ...current, [activeSketch]: direction === "undo" ? { past: state.past.slice(0, -1), future: [...state.future, currentSketch] } : { past: [...state.past, currentSketch], future: state.future.slice(0, -1) } }));
  }
  function undo() {
    if (tool === "select") { edits.undo(); return; }
    if (activeSketch !== "source") { stepSketchFrame("undo"); return; }
    if (!history.length) return; setFuture(f => [...f, artwork]); const target = history[history.length - 1]; artworkRef.current = target; setArtwork(target); setHistory(h => h.slice(0, -1));
  }
  function redo() {
    if (tool === "select") { edits.redo(); return; }
    if (activeSketch !== "source") { stepSketchFrame("redo"); return; }
    if (!future.length) return; setHistory(h => [...h, artwork]); const target = future[future.length - 1]; artworkRef.current = target; setArtwork(target); setFuture(f => f.slice(0, -1));
  }
  const canUndo = tool === "select" ? panel.sceneHistory.length > 0 : activeSketch !== "source" ? Boolean(sketchHistories[activeSketch]?.past.length) : history.length > 0;
  const canRedo = tool === "select" ? panel.sceneFuture.length > 0 : activeSketch !== "source" ? Boolean(sketchHistories[activeSketch]?.future.length) : future.length > 0;
  function clearCanvas() {
    commitFrame(activeSketch, { ...currentSketch, strokes: [], photo: null });
    canvasFor(activeSketch)?.clearSelection();
  }
  function chooseTool(next: string) {
    setPenSettingsOpen(false); setTool(next); setPlaying(null);
    setPencilOpen(next === "pen" ? !pencilOpen : false);
  }
  /** A stroke drawn on the frame for the open request (normalized); drawn with a transformation pen, it carries that pen ("its transformation goes here"). */
  function addTransformMark(frameId: string, points: { x: number; y: number }[]) {
    if (points.length < 2) return;
    const pen = tool === "semantic" && activeSemanticPen?.kind === "transformation" ? activeSemanticPen.id : "";
    updatePanel(frameId, previous => previous.transformDraft ? { transformDraft: { ...previous.transformDraft,
      marks: [...previous.transformDraft.marks, points.map(point => ({ x: Math.min(1, Math.max(0, point.x / 900)), y: Math.min(1, Math.max(0, point.y / 600)) }))].slice(-64),
      markPens: [...previous.transformDraft.marks.map((_, i) => previous.transformDraft!.markPens[i] ?? ""), pen].slice(-64) } } : {});
  }
  /** A toolbar pen by id, as it reads now. */
  const penById = (id: string) => algorithmPens.find(pen => pen.id === id);
  function selectAlgorithmPen(pen: SemanticPen) {
    setActiveSemanticPenId(pen.id); setTool("semantic"); setPlaying(null); setPencilOpen(false); setPenSettingsOpen(true);
    // An open request on this frame: the pen annotates it here ("this transformation goes here"), so stay and draw.
    const open = panelsRef.current[activeSketchRef.current]?.transformDraft;
    if (open) { if (pen.kind === "transformation") updatePanel(activeSketchRef.current, previous => previous.transformDraft ? { transformDraft: { ...previous.transformDraft, annotating: true } } : {}); return; }
    // Pens draw on sketches: from an example (however deep) or composition, the sketch it came from is brought into view.
    const sketch = rootSketch(activeSketchRef.current);
    if (sketch !== activeSketchRef.current) showFrame(sketch);
    else workspaceCanvas.current?.focus(activeSketchRef.current as FrameId);
  }
  /** The sketch a frame was ultimately made from (through examples decomposed from examples). */
  function rootSketch(id: string) {
    const seen = new Set<string>();
    for (let current = id; ; ) {
      const owner = panelsRef.current[current], from = owner?.sourceFrameId;
      if (!owner || owner.role === "sketch" || !from || !artworkOf(from) || seen.has(from)) return current;
      seen.add(current); current = from;
    }
  }
  function editDrawingPen(pen: SemanticPen) { if (pen.id === interactionPen.id) { setInteractionPen(pen); return; } setSemanticPens(semanticPensRef.current.map(item => item.id === pen.id ? { ...item, color: pen.color } : item)); }
  /** The example frame a transformation pen comes from. */
  const penExample = (pen: SemanticPen) => pen.transformation && artworkOf(pen.transformation.frameId) ? pen.transformation.frameId : null;

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
    if (!event.clipboardData || target?.closest("input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox']") || modal || exportOpen || historyOpen || busy || playing === activeSketch) return;
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
  function emitTransition(nodeId: string, transitionId: string) {
    const machine = findNode(scene, nodeId)?.machine, current = panel.runtimeStates[nodeId] || machine?.initialState;
    const transition = machine?.transitions.find(item => item.id === transitionId && item.trigger === "event" && item.from === current);
    if (!transition || busy) return;
    resultPreviews.current.get(activeSketch)?.emit(nodeId, transitionId);
    patchActive({ editingStates: { ...panel.editingStates, [nodeId]: transition.to } });
  }
  function restartMachine(nodeId: string) {
    const machine = findNode(scene, nodeId)?.machine; if (!machine) return;
    patchActive(previous => ({ machinePlaying: true, stateJump: { nodeId, stateId: machine.initialState, revision: (previous.stateJump?.revision || 0) + 1 }, editingStates: { ...previous.editingStates, [nodeId]: machine.initialState } }));
  }
  // Algorithms from other frames can be imported into this one.
  const algorithmImports: (AlgorithmSource & { source: { call: ReturnType<typeof instantiate>; library: ReturnType<typeof algorithmClosure> } })[] = Object.entries(panels).filter(([id]) => id !== activeSketch && artworkOf(id)).flatMap(([id, other]) => other.scene.algorithms.map(algorithm => ({
    key: `sketch:${id}:${algorithm.id}`, label: artworkOf(id)?.name || id, algorithm,
    source: { call: instantiate(other.scene.algorithms, algorithm.id), library: algorithmClosure(other.scene.algorithms, [algorithm.id]) } })))
    .filter(item => !scene.algorithms.some(algorithm => JSON.stringify(algorithm) === JSON.stringify(item.algorithm)));

  // ── Workflow views ─────────────────────────────────────────────────────────
  const frameIds = ["source", ...sketchFrames.map(frame => frame.id)];
  /** The minimal example frames decomposed from a frame, each followed by the smaller ones it was decomposed into, with their pens and how far their code is. */
  const examplesOf = (frameId: string, depth = 0, seen = new Set([frameId])): ExampleRow[] => frameIds.filter(id => panels[id]?.role === "example" && panels[id].sourceFrameId === frameId && !seen.has(id)).flatMap(id => {
    const item = panels[id], pen = algorithmPens.find(entry => entry.id === item.example?.penId);
    seen.add(id);
    return [{ id, depth, name: artworkOf(id)?.name.replace(/ · (example|object)$/, "") || id, object: item.example?.kind === "object", pen, status: item.runtimeError || item.error ? "error" : item.generated ? "ready" : item.pendingResult || item.loading ? "pending" : "empty" } as ExampleRow, ...examplesOf(id, depth + 1, seen)];
  });
  const roleLabel = { sketch: "sketch", example: "minimal example", composition: "composition" } as const;
  // Frames made from a sketch are linked to it on the board.
  const links: FrameLink[] = frameIds.flatMap(id => { const item = panels[id], from = item?.sourceFrameId; return item && item.role !== "sketch" && from && artworkOf(from) ? [{ from: from as FrameId, to: id as FrameId, label: item.role === "composition" ? "composed" : item.example?.kind === "object" ? "object" : panels[from]?.role === "example" ? "smaller" : "example" }] : []; });

  // ── Frames on the infinite canvas ──────────────────────────────────────────
  const sketchFrameContent = (id: string, frameArtwork: Artwork, ref: React.Ref<CanvasHandle>, empty: React.ReactNode) => (boardZoom: number) => {
    const owner = panels[id] || createSketchPanel(), frameEdits = sceneEdits(deps, id);
    // Playing with the result: sketch strokes and layer boxes are switched off; only the result takes input.
    const interacting = playing === id && Boolean(owner.generated);
    // Drawing the annotation of an open regeneration: strokes go to it, not to the sketch.
    const transformDrawing = Boolean(owner.transformDraft?.annotating && id === activeSketch);
    return <div className={`sketch-frame-surface frame-role-${owner.role} ${owner.generated || owner.pendingResult ? "has-render" : ""} ${interacting ? "frame-interacting" : ""} ${transformDrawing ? "transform-drawing" : ""}`} onPointerDownCapture={e => { if (!(e.target as Element).closest("button")) activateSketch(id); }}
      onPointerDown={e => { if (!interacting && !transformDrawing && tool === "select" && !(e.target as Element).closest(".scene-node")) frameEdits.select(null); }}>
      {/* One frame, two layers: the generated result, and the sketch strokes with layer boxes. */}
      <FrameRender owner={id} panel={owner} interacting={interacting} onEscape={() => setPlaying(null)} documentRevision={activeDocument.current} onPatch={patch => updatePanel(id, patch)}
        onPreview={handle => { if (handle) resultPreviews.current.set(id, handle); else resultPreviews.current.delete(id); }} />
      <SketchCanvas ref={ref} artwork={frameArtwork} tool={tool} gestureTool={() => transformDrawing} onGesture={(_, points) => addTransformMark(id, points)}
        color={color} width={width} opacity={opacity} transparent viewport={drawingViewport} semanticPen={activeSemanticPen}
        onStroke={(stroke: Stroke) => { const latest = artworkOf(id); if (!latest) return; if (latest.strokes.length >= 500) { updatePanel(id, { error: "한 프레임에는 최대 500개의 획을 저장할 수 있습니다. 새 스케치 프레임을 추가해주세요." }); return; } activateSketch(id); commitFrame(id, { ...latest, strokes: [...latest.strokes, stroke] }); }}
        onViewport={() => {}} onSelection={value => id === "source" ? setHasSelection(value) : setSketchSelections(current => current[id] === value ? current : { ...current, [id]: value })} onError={message => updatePanel(id, { error: message })}>
        {!interacting && <SceneOverlay scene={owner.scene} selected={owner.selectedNodeIds} hovered={owner.hovered} zoom={boardZoom} interactive={tool === "select" && !transformDrawing}
          onSelect={(nodeId, additive) => { activateSketch(id); frameEdits.select(nodeId, additive); }}
          onHover={nodeId => updatePanel(id, { hovered: nodeId })} onLiveMove={next => frameEdits.preview(next)} onMove={(next, before) => frameEdits.move(next, before)} />}
      </SketchCanvas>
      {owner.transformDraft && owner.transformDraft.marks.length > 0 && <svg className="transform-marks" viewBox="0 0 900 600" preserveAspectRatio="none" aria-label="Regeneration annotation">
        {owner.transformDraft.marks.map((mark, i) => { const pen = owner.transformDraft!.markPens[i] ? penById(owner.transformDraft!.markPens[i]) : undefined;
          return <polyline key={i} vectorEffect="non-scaling-stroke" className={pen ? "pen-mark" : undefined} style={pen ? { stroke: pen.color } : undefined} points={mark.map(point => `${point.x * 900},${point.y * 600}`).join(" ")} />; })}</svg>}
      {!(frameArtwork.photo || frameArtwork.strokes.length) && !owner.generated && !owner.pendingResult && !owner.scene.nodes.length && empty}</div>;
  };
  // Header controls for a frame: its AI work, its pen (an example), run/pause, interact, re-render, (re)generate code, decompose (a sketch or an example).
  const frameActions = (id: string, present: boolean) => {
    const frame = panels[id] || createSketchPanel(), frameBusy = Boolean(frame.loading);
    const status = sceneLiveStatus(frame.generated, frame.scene), pen = frame.role === "example" ? algorithmPens.find(item => item.id === frame.example?.penId) : undefined;
    return <>
      {/* Each frame shows (and can stop) its own AI work, also while another frame is active. */}
      {frameBusy && <span className="frame-working" role="status" title={frame.loading}><span className="loading-spinner" />AI 작업 중
        <button aria-label="Cancel this frame's AI work" title="Cancel" onClick={e => { e.stopPropagation(); cancel(id); }}><Icon name="close" size={11} /></button></span>}
      {frame.role === "example" && frame.example?.kind === "transformation" && !pen && <button disabled={!splitTarget(frame)} title="Make a pen from this example: drawing with it means this transformation goes here" onClick={e => { e.stopPropagation(); activateSketch(id); makeExamplePen(id); }}><Icon name="pen" size={13} />Make pen</button>}
      {pen && <button className="frame-pen-chip" style={{ color: pen.color }} title={`이 예제로 만든 펜 「${pen.name}」으로 그리기`} onClick={e => { e.stopPropagation(); activateSketch(id); selectAlgorithmPen(pen); }}><span className="semantic-pen-dot" style={{ background: pen.color }} />Pen</button>}
      {frame.generated && <button aria-label={frame.machinePlaying ? "Pause result" : "Run result"} title={frame.machinePlaying ? "Pause" : "Run"} disabled={!frame.executable} onClick={() => updatePanel(id, { machinePlaying: !frame.machinePlaying })}><Icon name={frame.machinePlaying ? "pause" : "play"} size={13} />{frame.machinePlaying ? "Pause" : "Run"}</button>}
      {frame.generated && <button aria-pressed={playing === id} title={playing === id ? "Stop interacting (Esc)" : "Use the result with the mouse and keyboard"} disabled={!frame.executable} onClick={() => { activateSketch(id); setPlaying(current => current === id ? null : id); }}><Icon name="hand" size={13} />{playing === id ? "Stop" : "Interact"}</button>}
      {frame.generated && <button aria-label="Re-render result" title="Re-render from the start" disabled={!frame.executable || frameBusy} onClick={() => { activateSketch(id); updatePanel(id, previous => ({ renderRevision: previous.renderRevision + 1, machinePlaying: true })); }}><Icon name="undo" size={13} /></button>}
      {frame.scene.nodes.length > 0 && (!frame.generated || status !== "live" || frame.dirtyNodeIds.length > 0) && <button disabled={frameBusy} title="Generate this frame's p5.js result" onClick={() => { activateSketch(id); void sceneAI(deps, id).generateCode(); }}><Icon name="code" size={13} />{frame.generated ? "Update" : "Generate"}</button>}
      {frame.scene.nodes.length > 0 && <button aria-pressed={frame.transformDraft?.nodeId === null} disabled={frameBusy} title="Annotate this frame to add or modify a semantic transformation (AI clarifies in text first)"
        onClick={() => {
          const opening = panelsRef.current[id]?.transformDraft?.nodeId !== null;
          activateSketch(id); setPlaying(null); updatePanel(id, { transformDraft: opening ? newTransformDraft(null) : null });
          // The frame is drawn on next: bring it into view.
          if (opening) workspaceCanvas.current?.focus(id as FrameId);
        }}><Icon name="pen" size={13} />Annotate</button>}
      {frame.role === "sketch" && <button disabled={frameBusy || !present} title="Split this sketch into independent semantic transformations: a minimal example frame and a pen for each" onClick={() => { activateSketch(id); void sceneAI(deps, id).decompose(); }}>Decompose<Icon name="spark" size={13} /></button>}
      {frame.role === "example" && frame.example?.kind !== "object" && <button disabled={frameBusy || !splitTarget(frame)} title="Split this example's transformation into smaller ones: a minimal example frame and a pen for each" onClick={() => { activateSketch(id); void sceneAI(deps, id).decompose(); }}>Decompose<Icon name="spark" size={13} /></button>}
    </>;
  };
  const frameSubtitle = (id: string, artwork: Artwork) => {
    const frame = panels[id], from = frame?.sourceFrameId ? artworkOf(frame.sourceFrameId)?.name : null;
    return [frame?.example?.kind === "object" ? "object example" : roleLabel[frame?.role ?? "sketch"], artwork.strokes.length ? `${artwork.strokes.length} strokes` : "", frame?.scene.nodes.length ? `${frame.scene.nodes.length} layers` : "", from ? `from ${from}` : "", frame?.generated ? "p5.js" : "", playing === id ? "interacting" : "", activeSketch === id ? "active" : ""].filter(Boolean).join(" · ");
  };
  const frames = [
    { id: "source" as const, title: artwork.photo ? "Photo + sketch" : "Original sketch", subtitle: frameSubtitle("source", artwork),
      actions: <><button title="Load example sketch" aria-label="Load example sketch" disabled={busy} onClick={() => { activateSketch("source"); commit({ ...blank(), name: "Branch studies", strokes: exampleStrokes() }); updatePanel("source", createSketchPanel()); }}><Icon name="pen" size={13} /></button>{frameActions("source", Boolean(artwork.photo || artwork.strokes.length))}</>,
      content: sketchFrameContent("source", artwork, canvas, <div className="frame-empty source-empty"><Icon name="pen" size={30} /><strong>Start with a mark.</strong><span>Draw here, drop a photo, or paste an image. Then Decompose it.</span><button onClick={() => upload.current?.click()}>Attach photo<Icon name="upload" size={14} /></button></div>) },
    ...sketchFrames.map(frame => ({ id: frame.id as FrameId, title: frame.artwork.name, subtitle: frameSubtitle(frame.id, frame.artwork),
      actions: frameActions(frame.id, Boolean(frame.artwork.photo || frame.artwork.strokes.length)),
      content: sketchFrameContent(frame.id, frame.artwork, handle => { if (handle) sketchCanvases.current.set(frame.id, handle); else sketchCanvases.current.delete(frame.id); }, <div className="frame-empty source-empty"><Icon name="pen" size={30} /><strong>Start a new sketch.</strong><span>Draw with the pencil and transformation pens, then Compose.</span></div>) })),
  ].filter(frame => frame.id !== "source" || !workspace.hiddenFrames.includes("source"));

  // ── Inspector (right) ──────────────────────────────────────────────────────
  const statusLabel = liveStatus === "live" ? panel.dirtyNodeIds.length ? "Live · descriptions changed, regenerate to apply" : "Live · controls update code & visual" : liveStatus === "changed" ? "Structure changed · update code to connect" : generated ? "Connect controls to your current code" : "Generate code to enable live controls";
  const compose = <SketchComposition artwork={currentSketch} prompt={panel.composePrompt} onPrompt={value => patchActive({ composePrompt: value })} onDraft={() => { void ai.draftComposePrompt(); }} onCompose={() => { void ai.compose(); }} busy={busy} drafting={panel.loading === compositionPromptLabel} />;
  const exampleNode = panel.example ? findNode(scene, panel.example.nodeId) : undefined, exampleTransformation = exampleNode && panel.example ? findTransformation(exampleNode, panel.example.transformationId) : undefined;
  const workflowHead = panel.role === "example" && panel.example?.kind === "object"
    ? <ObjectHead name={exampleNode?.name || "Object"} description={exampleNode?.description || ""} source={panel.sourceFrameId && artworkOf(panel.sourceFrameId) ? artworkOf(panel.sourceFrameId)!.name : null} onSource={() => panel.sourceFrameId && showFrame(panel.sourceFrameId)} />
    : panel.role === "example"
    ? <ExampleHead transformation={exampleTransformation?.label || panel.example?.transformationId || "Transformation"} subject={exampleNode?.name || ""} pen={algorithmPens.find(item => item.id === panel.example?.penId)} activePenId={activeSemanticPenId}
      source={panel.sourceFrameId && artworkOf(panel.sourceFrameId) ? artworkOf(panel.sourceFrameId)!.name : null} onUsePen={selectAlgorithmPen} onMakePen={() => makeExamplePen(activeSketch)} canMakePen={Boolean(splitTarget(panel))} onSource={() => panel.sourceFrameId && showFrame(panel.sourceFrameId)}
      examples={examplesOf(activeSketch)} busy={busy || !splitTarget(panel)} onDecompose={() => { void ai.decompose(); }} onShowExample={showFrame} />
    : panel.role === "composition"
      ? <CompositionHead source={panel.sourceFrameId && artworkOf(panel.sourceFrameId) ? artworkOf(panel.sourceFrameId)!.name : null} prompt={panel.composePrompt} onSource={() => panel.sourceFrameId && showFrame(panel.sourceFrameId)} onOrigin={id => { showFrame(id); }}
        origins={[...new Map(scene.nodes.flatMap(item => item.transformations).flatMap(item => item.origin ? [[`${item.origin.frameId}:${item.origin.transformationId}`, { frameId: item.origin.frameId, label: item.origin.label || item.label, exists: Boolean(artworkOf(item.origin.frameId)) }] as const] : [])).values()]} />
      : <SketchWorkflow examples={examplesOf(activeSketch)} pens={algorithmPens.filter(pen => pen.kind === "transformation")} activePenId={activeSemanticPenId} busy={busy} canDecompose={sourcePresent}
        onDecompose={() => { void ai.decompose(); }} onShowExample={showFrame} onUsePen={selectAlgorithmPen} compose={compose} />;
  const propertiesStage = <>
    {stale && <div className="stale-banner">{`원본 스케치(${sourceSketch!.name})가 바뀌었습니다. 원본에서 다시 ${panel.role === "example" ? "Decompose" : "Compose"}하면 새 프레임으로 만듭니다.`}</div>}
    {scene.nodes.length > 0 && <div className={`live-controls-status status-${liveStatus}`} role="status"><span className="status-dot" />{statusLabel}</div>}
    {scene.nodes.length > 0 && <button className="primary-button rules-generate-button" disabled={busy} onClick={() => { void ai.generateCode(); }}>{generated && (liveStatus !== "live" || panel.dirtyNodeIds.length) ? "Update code" : generated ? "Regenerate code" : "Generate code"}<Icon name="code" size={17} /></button>}
    {panel.runtimeError && generated && <div className="runtime-error" role="alert">{panel.runtimeError}<button disabled={busy} onClick={() => { void ai.generateCode(true); }}>Fix with AI</button></div>}
    {node ? <PropertyInspector node={node} transformations={inspectedTransformations(panel, node)} library={scene.algorithms} state={nodeState} busy={busy} clip={clip}
      onNode={patch => edits.editNode(node.id, patch)} onTransformation={(id, patch) => edits.editTransformation(node.id, id, patch)}
      onAddTransformation={() => edits.addTransformation(node.id)} onRemoveTransformation={id => edits.removeTransformation(node.id, id)} onMoveTransformation={(id, offset) => edits.moveTransformation(node.id, id, offset)} onChooseState={stateId => edits.chooseState(node.id, stateId)}
      onState={patch => nodeState && edits.editState(node.id, nodeState.id, patch)} onTransition={(id, patch) => edits.editTransition(node.id, id, patch)}
      onScalar={(propertyId, path, value) => edits.scalar(node.id, propertyId, path, value)} onSwap={(propertyId, path, choice) => edits.swap(node.id, propertyId, path, choice)}
      onProperty={(propertyId, patch) => edits.editProperty(node.id, propertyId, patch)} onRemoveProperty={propertyId => edits.removeProperty(node.id, propertyId)}
      onAddProperty={(algorithmId, transformationId) => edits.addProperty(node.id, algorithmId, transformationId)} onRegenerate={target => updatePanel(activeSketch, { transformDraft: newTransformDraft(node.id, target) })}
      draft={panel.transformDraft?.nodeId === node.id ? panel.transformDraft : null}
      onDraftChange={patch => updatePanel(activeSketch, previous => previous.transformDraft ? { transformDraft: { ...previous.transformDraft, ...patch } } : {})}
      onDraftClarify={() => { void ai.clarify(); }} onDraftApply={() => { void ai.applyClarification(); }} describeClarification={clarification => clarificationTarget(scene, clarification, penById)} annotationPen={penById}
      onDraftCancel={() => updatePanel(activeSketch, { transformDraft: null })}
      onOrigin={showFrame}
      onCopy={(propertyId, path) => edits.copySlot(node.id, propertyId, path)} onPaste={(propertyId, path, dropped) => edits.pasteSlot(node.id, propertyId, path, dropped)}
      clipFor={(propertyId, path) => edits.clipFor(node.id, propertyId, path)} onAddBlock={(block, transformationId) => edits.addBlock(node.id, block, transformationId)} onRemoveMachine={() => edits.removeMachine(node.id)} />
      : scene.nodes.length > 0 && <p className="section-description">Select a collection or object in Layers or on the frame to edit its semantic transformations.</p>}
    {scene.nodes.length > 0 && <AlgorithmLibrary scene={scene} busy={busy} targetName={node?.name || null} imports={algorithmImports}
      onEdit={edits.editAlgorithm} onUse={algorithmId => { if (node) edits.addProperty(node.id, algorithmId); }}
      onCopy={edits.copyDefinition} clipFor={edits.definitionClip}
      onImport={key => { const item = algorithmImports.find(entry => entry.key === key); if (item) { edits.importAlgorithm(item.source); setToast(`${item.algorithm.name} 블록을 이 프레임으로 가져왔습니다.`); } }} />}
  </>;

  return <div className="studio live-studio freeform-studio scene-studio">
    <header className="topbar"><a className="brand" href="/" aria-label="Rulegen home"><span className="brand-mark"><i /><i /><i /></span>rulegen<span className="beta">LAB</span></a><div className="project-title"><span className="slash">/</span><input aria-label="Project name" value={artwork.name} maxLength={200} onChange={e => { const next = { ...artworkRef.current, name: e.target.value }; artworkRef.current = next; setArtwork(next); }} /><span className="saved-dot" /><span className="saved-label">{saveState}</span></div><div className="top-actions"><button className="text-button" onClick={() => setHistoryOpen(true)}>AI history<Icon name="undo" size={14} /></button><button className="text-button" onClick={() => setExportOpen(true)}>Export project <Icon name="download" size={14} /></button><button className="text-button" onClick={() => importInput.current?.click()}>Open JSON</button><button className="text-button" onClick={() => { setNewName(""); setModal(true); }}>New exploration <Icon name="plus" size={15} /></button></div></header>
    <input ref={upload} className="visually-hidden" type="file" accept="image/png,image/jpeg,image/webp" aria-label="Attach photograph" onChange={e => { if (e.target.files?.[0]) void attach(e.target.files[0]); e.target.value = ""; }} />
    <input ref={importInput} className="visually-hidden" type="file" accept=".json" aria-label="Open project JSON" onChange={async e => { const file = e.target.files?.[0]; e.target.value = ""; if (!file) return; try { if (file.size > 12_000_000) throw new Error("프로젝트 파일이 너무 큽니다."); restore(projectSchema.parse(JSON.parse(await file.text()))); } catch { patchActive({ error: "올바른 Rulegen 프로젝트 JSON 파일을 선택해주세요." }); } }} />
    <div className="workspace">
      <ToolRail tool={tool} toolsActive pencilOpen={pencilOpen} color={color} width={width} opacity={opacity} pens={algorithmPens} activePen={activeSemanticPen} penSettingsOpen={penSettingsOpen}
        busy={busy} canAddSketch={!busy && (sketchFrames.length < MAX_SKETCH_FRAMES || workspace.hiddenFrames.includes("source"))} canUndo={canUndo} canRedo={canRedo} canClear zoom={workspace.camera?.zoom || .4}
        onTool={chooseTool} onPencilClose={() => setPencilOpen(false)} onColor={setColor} onWidth={setWidth} onOpacity={setOpacity}
        onPen={pen => { if (tool === "semantic" && activeSemanticPenId === pen.id) { setPenSettingsOpen(open => !open); setPencilOpen(false); } else selectAlgorithmPen(pen); }}
        onPenChange={editDrawingPen} onPenRemove={pen => { setSemanticPens(semanticPensRef.current.filter(item => item.id !== pen.id)); setActiveSemanticPenId(null); setTool("pen"); setPenSettingsOpen(false); }} onPenSettingsClose={() => setPenSettingsOpen(false)}
        onPenExample={pen => { const id = penExample(pen); return Boolean(id && showFrame(id)); }}
        onUndo={undo} onRedo={redo} onClear={clearCanvas} onZoom={amount => workspaceCanvas.current?.zoom(amount)} onFit={() => workspaceCanvas.current?.fit()}
        onHome={() => workspaceCanvas.current?.fit()} onAddSketch={addSketchFrame} onAttach={() => upload.current?.click()}
        onHelp={() => setToast("V 선택·이동(빈 보드를 드래그하면 프레임 여러 개 선택, ⇧ 추가, Delete로 삭제) · P 연필 · E 지우개 · L 라쏘 · H 이동 · ⌘/Ctrl+G 그룹 · ⇧⌘G 그룹 해제 · Delete 레이어 삭제 · 화살표 이동 · ⌘/Ctrl+Z 실행 취소 · ⌘/Ctrl+V 이미지 붙여넣기 · Esc 선택 해제·Interact 끝내기")} />
      <aside className="layer-sidebar">
        <LayerPanel scene={scene} sketchId={activeSketch} selected={panel.selectedNodeIds} hovered={panel.hovered} busy={busy} canUndo={panel.sceneHistory.length > 0} canRedo={panel.sceneFuture.length > 0} title={currentSketch.name}
          onSelect={edits.select} onHover={edits.hover}
          onRename={edits.rename} onToggleVisible={edits.toggleVisible} onGroup={edits.group} onUngroup={edits.ungroup} onDelete={edits.remove}
          onMove={edits.reparent} onReorder={edits.reorder} onAdd={edits.add} onUndo={edits.undo} onRedo={edits.redo}
          onDecompose={panel.role === "sketch" ? () => { void ai.decompose(); } : undefined} canDecompose={sourcePresent} />
      </aside>
      <main className="canvas-workspace">
        <FreeformWorkspace ref={workspaceCanvas} links={links} onDeleteFrame={deleteFrame} deleteDisabled={busy} layout={workspace} onChange={setWorkspace} activeFrame={activeSketch as FrameId} tool={tool}
          selectedFrames={selectedFrames.filter(id => frames.some(frame => frame.id === id))} onSelectFrames={setSelectedFrames} onDeleteFrames={deleteFrames}
          onActivateFrame={id => activateSketch(id)}
          onBackground={() => { setPencilOpen(false); setPenSettingsOpen(false); }} onDrop={file => { void attach(file); }} frames={frames} />
        <footer className="workspace-footer"><span><span className="status-dot" />{configured ? `Connected · ${model}` : configured === false ? "OpenAI configuration required" : "Connecting…"}</span><span>SKETCH → DECOMPOSE → PENS → COMPOSE</span></footer>
      </main>
      <aside ref={inspectorPanel} className={`inspector ${inspectorWidth ? "inspector-resized" : ""}`} style={inspectorWidth ? { "--inspector-width": `${inspectorWidth}px` } as React.CSSProperties : undefined}>
        <PanelResizer label="Resize properties panel" min={280} max={Math.max(320, Math.min(900, (typeof window === "undefined" ? 1400 : window.innerWidth) - 520))}
          measure={() => inspectorPanel.current?.getBoundingClientRect().width || 354} onResize={setInspectorWidth} onReset={() => setInspectorWidth(null)} /><div className="inspector-title"><span aria-label="Inspector frame" title={currentSketch.name}>{node ? `${currentSketch.name} / ${node.name}` : currentSketch.name}</span><Icon name="spark" size={17} /></div>
        {clip && <div className="block-clipboard" title="Right-click a socket to paste, or drag blocks from the palette"><span className="algorithm-badge">ƒ</span>Clipboard · <strong>{clip.label}</strong></div>}
        {panel.loading && <div className="loading-banner" role="status"><span className="loading-spinner" /><span>{panel.loading}</span><button onClick={() => cancel()}>Cancel</button></div>}{panel.error && <div className="error-banner" role="alert"><span>{panel.error}</span><button aria-label="Dismiss error" onClick={() => patchActive({ error: "" })}><Icon name="close" size={14} /></button></div>}
        <div ref={inspector} className="inspector-content live-inspector-content">
          {/* An annotation on the whole frame: AI picks what to add or modify, says so in text, and changes nothing until Apply. */}
          {panel.transformDraft?.nodeId === null && <AnnotationComposer draft={panel.transformDraft} kind="Frame" what={`${currentSketch.name} 첨부됨`} busy={busy} pen={penById}
            describe={clarification => clarificationTarget(scene, clarification, penById)}
            onChange={patch => updatePanel(activeSketch, previous => previous.transformDraft ? { transformDraft: { ...previous.transformDraft, ...patch } } : {})}
            onClarify={() => { void ai.clarify(); }} onApply={() => { void ai.applyClarification(); }} onCancel={() => updatePanel(activeSketch, { transformDraft: null })} />}
          {workflowHead}
          {propertiesStage}
          {(scene.nodes.length > 0 || panel.role === "sketch") && <label className="refinement-input"><span>YOUR DIRECTION <small>optional</small></span><textarea aria-label="Generation direction" placeholder={panel.role === "sketch" ? "Decompose에 줄 방향. 예: 반복과 색은 따로 나눠줘" : "예: 더 유기적으로, 반복은 적게, 파란색으로…"} value={panel.instruction} maxLength={2000} onChange={e => patchActive({ instruction: e.target.value })} /></label>}
        </div><div className="inspector-footer"><span className="tiny-dot" />{panel.loading === decomposeLabel || panel.loading === splitLabel ? "Decomposing…" : "Built for exploration, not perfection."}</div></aside>
    </div>
    <RawCodePanel code={liveSource} sketchName={currentSketch.name} fileName={generated?.title || currentSketch.name} onCopy={() => setToast("p5.js 코드를 복사했습니다.")} onError={message => patchActive({ error: message })}
      editor={{ draft: panel.codeDraft || "", busy, runtimeError: panel.runtimeError, onDraft: value => patchActive({ codeDraft: value }),
        onRun: () => { if (!generated) return; if (generated.code === panel.codeDraft) void prepare(panel.codeDraft); else patchActive({ generated: { ...generated, code: panel.codeDraft || "" }, executable: "", preparedCode: "" }); patchActive(previous => ({ renderRevision: previous.renderRevision + 1 })); },
        onFix: () => { void ai.generateCode(true); } }}
      machinePanel={<NodeMachinePanel scene={scene} node={machineNode} editingStateId={machineNode ? panel.editingStates[machineNode.id] || null : null} runtimeStateId={machineNode ? panel.runtimeStates[machineNode.id] || null : null}
        playing={panel.machinePlaying} busy={busy} hasCode={Boolean(generated)}
        target={machineNode && panel.machineTarget?.nodeId === machineNode.id ? { kind: panel.machineTarget.kind, id: panel.machineTarget.id } : null}
        onSelectNode={id => edits.select(id)}
        onState={stateId => { if (!machineNode) return; edits.chooseState(machineNode.id, stateId); patchActive({ machineTarget: { nodeId: machineNode.id, kind: "state", id: stateId } }); }}
        onTransition={transitionId => machineNode && patchActive({ machineTarget: { nodeId: machineNode.id, kind: "transition", id: transitionId } })}
        onClearTarget={() => patchActive({ machineTarget: null })}
        onDeselect={() => { if (!machineNode) return; patchActive(previous => { const editingStates = { ...previous.editingStates }; delete editingStates[machineNode.id]; return { machineTarget: null, editingStates }; }); }}
        layout={machineNode ? panel.machineLayouts[machineNode.id] : undefined}
        onLayout={next => machineNode && patchActive(previous => { const machineLayouts = { ...previous.machineLayouts }; if (next) machineLayouts[machineNode.id] = next; else delete machineLayouts[machineNode.id]; return { machineLayouts }; })}
        onPlay={value => patchActive({ machinePlaying: value })}
        onRestart={() => machineNode && restartMachine(machineNode.id)} onEvent={transitionId => machineNode && emitTransition(machineNode.id, transitionId)} />} />
    {toast && <div className="toast" role="status"><Icon name="spark" size={17} /><span>{toast}</span><button aria-label="Dismiss notification" onClick={() => setToast("")}><Icon name="close" size={15} /></button></div>}
    {historyOpen && <GenerationHistory disabled={busy} onClose={() => setHistoryOpen(false)} onRestore={restoreAIHistory} />}
    {exportOpen && <div className="modal-backdrop" onClick={() => setExportOpen(false)}><div className="modal project-export-modal" role="dialog" aria-modal="true" aria-labelledby="export-title" onClick={e => e.stopPropagation()}><button className="modal-close" aria-label="Close export dialog" onClick={() => setExportOpen(false)}><Icon name="close" /></button><div className="section-kicker">KEEP YOUR EXPLORATION</div><h2 id="export-title">Take your project with you.</h2><p>스케치·사진·최소 예제·펜·collection·object·알고리즘 블록·코드가 함께 저장됩니다. JSON 파일로 다운로드하거나 복사할 수 있어요.</p><textarea aria-label="Exported project JSON" className="project-json-preview" readOnly value={JSON.stringify(projectData(), null, 2)} /><button className="primary-button" onClick={() => downloadFile(`${artwork.name}.rulegen.json`, JSON.stringify(projectData(), null, 2), "application/json")}>Download project JSON<Icon name="download" /></button><button className="alternative-button" onClick={async () => { try { await navigator.clipboard.writeText(JSON.stringify(projectData(), null, 2)); setToast("프로젝트 JSON을 복사했습니다."); } catch { patchActive({ error: "JSON 내용을 선택해 복사하거나 다운로드해주세요." }); } }}>Copy project JSON<Icon name="copy" size={15} /></button></div></div>}
    {modal && <div className="modal-backdrop" onClick={() => setModal(false)}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="new-title" onClick={e => e.stopPropagation()}><button className="modal-close" aria-label="Close dialog" onClick={() => setModal(false)}><Icon name="close" /></button><div className="section-kicker">A FRESH PERSPECTIVE</div><h2 id="new-title">What will you explore?</h2><p>새 탐색을 시작하면 현재 로컬 초안이 교체됩니다. JSON으로 내보내면 언제든 다시 열 수 있어요.</p><label>Exploration name<input autoFocus value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === "Enter" && newProject()} /></label><button className="primary-button" onClick={newProject}>Start exploring<Icon name="arrow" /></button></div></div>}
  </div>;
}
