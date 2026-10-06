import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { Route } from "./+types/home";
import { Icon, type IconName } from "../components/icons";
import { SketchCanvas, type CanvasHandle } from "../components/sketch-canvas";
import { FreeformWorkspace, type WorkspaceHandle } from "../components/freeform-workspace";
import { nextSketchPosition, ensureResultFramePositions, resultFrameId, resultSketchId, workspaceSchema, type FrameId, type WorkspaceLayout } from "../lib/workspace";
import { annotationHistoryReducer } from "../lib/annotation-history";
import { ResultRevisionPanel } from "../components/result-revision-panel";
import { annotatedResultImage, revisionCodeFeatures, revisionCodeGroups, revisionChanges, revisionSnapshot, validateRevisionProposal } from "../lib/result-revisions";
import type { CodePreviewHandle } from "../components/code-preview";
import { SketchResult } from "../components/sketch-result";
import { compositionPromptSchema, clarificationSchema, revisionProposalSchema, analysisSchema, rulesSchema, generatedSchema, subfeatureSchema, brushSchema, ART_WIDTH as W, ART_HEIGHT as H, type Artwork, type RuleGroup, type BrushRecipe, type SemanticPen, type Stroke, type Viewport } from "../lib/schema";
import { type SketchFrame, projectSchema, exampleStrokes, readPhoto, downloadFile } from "../lib/project";
import { SubfeatureControls } from "../components/subfeature-controls";
import { activeGroups, updateParameter, replaceSubfeature, removeControl } from "../lib/subfeatures";
import { syncParameters, liveStatus, detachControls } from "../lib/live-parameters";
import { FeatureOverlay } from "../components/feature-overlay";
import { AlgorithmPenSettings } from "../components/algorithm-pen-settings";
import { compositionContext, makeSemanticPen, semanticPenColors } from "../lib/algorithm-pens";
import { SketchComposition } from "../components/sketch-composition";
import { brushCode } from "../lib/brush-engine";
import { createSketchPanel, clearedResultAnnotations, updateSketchPanel, savedSketchPanels, type SketchPanel } from "../lib/sketch-panels";

export function meta({}: Route.MetaArgs) { return [{ title: "Rulegen — From a mark to a system" }, { name: "description", content: "Draw, discover visual features, and create p5.js systems and procedural brushes with AI." }]; }
const blank = (): Artwork => ({ strokes: [], photo: null, name: "Untitled exploration", revision: 0 });
const storageKey = "rulegen.project.v1";
const clarificationLabel = "AI가 annotation 스케치를 보고 설명 초안을 만들고 있습니다…";
const compositionPromptLabel = "AI가 스케치와 펜의 의미를 읽어 Compose prompt를 만들고 있습니다…";
const drawingViewport: Viewport = { zoom: 1, x: 0, y: 0 };
export default function Home() {
  const [artwork, setArtwork] = useState<Artwork>(blank);
  const [sketchFrames, setSketchFrames] = useState<SketchFrame[]>([]);
  const sketchFramesRef = useRef(sketchFrames); sketchFramesRef.current = sketchFrames;
  const sketchCanvases = useRef(new Map<string, CanvasHandle>());
  const [activeSketch, setActiveSketch] = useState("source");
  const featureSourceId = activeSketch;
  const activeSketchRef = useRef(activeSketch); activeSketchRef.current = activeSketch;
  const [panels, setPanels] = useState<Record<string, SketchPanel>>(() => ({ source: createSketchPanel() }));
  const panelsRef = useRef(panels); panelsRef.current = panels;
  const panel = panels[activeSketch] || createSketchPanel();
  function panelState<K extends keyof SketchPanel>(key: K): [SketchPanel[K], Dispatch<SetStateAction<SketchPanel[K]>>] {
    return [panel[key], next => setPanels(current => updateSketchPanel(current, activeSketch, key, next))];
  }
  function updatePanel(id: string, patch: Partial<SketchPanel> | ((panel: SketchPanel) => Partial<SketchPanel>)) {
    setPanels(current => { const previous = current[id] || createSketchPanel(); return { ...current, [id]: { ...previous, ...(typeof patch === "function" ? patch(previous) : patch) } }; });
  }
  const [stage, setStage] = panelState("stage");
  const [sketchHistories, setSketchHistories] = useState<Record<string, { past: Artwork[]; future: Artwork[] }>>({});
  const [sketchSelections, setSketchSelections] = useState<Record<string, boolean>>({});
  const [pendingFrameFocus, setPendingFrameFocus] = useState<FrameId | null>(null);
  const artworkRef = useRef(artwork); artworkRef.current = artwork;
  const [features, setFeatures] = panelState("features"), [groups, setGroups] = panelState("groups");
  const [selected, setSelected] = panelState("selected"), [hovered, setHovered] = panelState("hovered");
  const [analysisRevision, setAnalysisRevision] = panelState("analysisRevision");
  const [tool, setTool] = useState("pen"), [pencilOpen, setPencilOpen] = useState(false);
  const [color, setColor] = useState("#75664e"), [width, setWidth] = useState(3), [opacity, setOpacity] = useState(80);
  const viewport = drawingViewport;
  const [workspace, setWorkspace] = useState<WorkspaceLayout>(() => workspaceSchema.parse({}));
  const workspaceCanvas = useRef<WorkspaceHandle>(null);
  const [, setRenderRevision] = panelState("renderRevision");
  const [hasSelection, setHasSelection] = useState(false);
  const [generated, setGenerated] = panelState("generated"), [codeDraft, setCodeDraft] = panelState("codeDraft"), [, setExecutable] = panelState("executable");
  const resultPreviews = useRef(new Map<string, CodePreviewHandle>());
  const [annotating, setAnnotating] = panelState("annotating"), [annotationImage] = panelState("annotationImage");
  const [annotationHistory, setAnnotationHistory] = panelState("annotationHistory");
  const editAnnotations = (action: Parameters<typeof annotationHistoryReducer>[1]) => setAnnotationHistory(current => annotationHistoryReducer(current, action));
  const annotations = annotationHistory.present;
  const [clarifying, setClarifying] = panelState("clarifying");
  const [clarificationContext, setClarificationContext] = panelState("clarificationContext");
  const [revisionInstruction, setRevisionInstruction] = panelState("revisionInstruction");
  const [revisionProposal, setRevisionProposal] = panelState("revisionProposal");
  const [removedControls, setRemovedControls] = panelState("removedControls");
  const [runtimeError, setRuntimeError] = panelState("runtimeError");
  const [brush, setBrush] = panelState("brush"), [savedBrushes, setSavedBrushes] = useState<BrushRecipe[]>([]), [blend, setBlend] = panelState("blend");
  const [drawingBrush, setDrawingBrush] = useState<BrushRecipe | null>(null), [penSettingsOpen, setPenSettingsOpen] = useState(false);
  const activeDrawingBrush = drawingBrush || brush;
  const [semanticPens, setSemanticPens] = useState<SemanticPen[]>([]), [activeSemanticPenId, setActiveSemanticPenId] = useState<string | null>(null);
  const algorithmPens = semanticPens;
  const activeSemanticPen = semanticPens.find(pen => pen.id === activeSemanticPenId);
  const [lab, setLab] = panelState("lab"), [labFuture, setLabFuture] = panelState("labFuture"), [gesture, setGesture] = panelState("gesture");
  const [loading, setLoading] = panelState("loading"), [error, setError] = panelState("error"), [toast, setToast] = useState("");
  const [model, setModel] = useState(""), [configured, setConfigured] = useState<boolean | null>(null);
  const [restoreReady, setRestoreReady] = useState(false), [saveState, setSaveState] = useState("Local draft");
  const [modal, setModal] = useState(false), [exportOpen, setExportOpen] = useState(false), [newName, setNewName] = useState("");
  const [composePrompt, setComposePrompt] = panelState("composePrompt"), [generationMode, setGenerationMode] = panelState("generationMode");
  const [instruction, setInstruction] = panelState("instruction");
  const [brushDescription, setBrushDescription] = panelState("brushDescription");
  const [history, setHistory] = useState<Artwork[]>([]), [future, setFuture] = useState<Artwork[]>([]);
  const canvas = useRef<CanvasHandle>(null), brushCanvas = useRef<CanvasHandle>(null), upload = useRef<HTMLInputElement>(null), importInput = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null), requestNumber = useRef(0), activeDocument = useRef(0), prepareNumber = useRef(0);
  const inspector = useRef<HTMLDivElement>(null);
  const chosen = features.find(f => f.id === selected);
  const active = features.find(f => f.id === (hovered || selected));
  const visibleGroups = groups.filter(g => !selected || g.featureId === selected);
  const currentSketch = activeSketch === "source" ? artwork : sketchFrames.find(f => f.id === activeSketch)?.artwork || artwork;
  const analyzedSketch = featureSourceId === "source" ? artwork : sketchFrames.find(f => f.id === featureSourceId)?.artwork || artwork;
  const currentSelection = activeSketch === "source" ? hasSelection : Boolean(sketchSelections[activeSketch]);
  const busy = Boolean(loading), sourcePresent = Boolean(currentSketch.photo || currentSketch.strokes.length);
  const stale = features.length > 0 && analysisRevision !== analyzedSketch.revision;
  const liveSource = useMemo(() => generated ? syncParameters(generated.code, groups, generated.bindings) : "", [generated, groups]);
  const controlsStatus = generated ? liveStatus(generated.code, groups, generated.bindings) : "unlinked";

  const currentRevisionSnapshot = revisionSnapshot(features, groups, liveSource, annotations, revisionInstruction, annotationImage);
  const currentSketchSnapshot = revisionSnapshot(features, groups, liveSource, annotations, "", annotationImage);
  const revisionState = useRef(currentRevisionSnapshot); revisionState.current = currentRevisionSnapshot;
  const proposalStale = Boolean(revisionProposal && revisionProposal.snapshot !== currentRevisionSnapshot);
  const proposalChanges = useMemo(() => revisionProposal ? revisionChanges(features, groups, revisionProposal.proposal) : [], [features, groups, revisionProposal]);
  const resultOwners = [{ id: "source", name: artwork.name }, ...sketchFrames.map(frame => ({ id: frame.id, name: frame.artwork.name }))].filter(owner => owner.id === "source" || panels[owner.id]?.generated);
  const resultPositions = ensureResultFramePositions(workspace.frames, resultOwners.map(owner => owner.id));
  const resultLayout = resultPositions === workspace.frames ? workspace : { ...workspace, frames: resultPositions };
  useEffect(() => { if (resultPositions !== workspace.frames) setWorkspace(current => ({ ...current, frames: ensureResultFramePositions(current.frames, resultOwners.map(owner => owner.id)) })); }, [resultPositions, workspace.frames]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey); if (raw) { const result = projectSchema.safeParse(JSON.parse(raw)); if (result.success) restore(result.data); else setToast("저장된 프로젝트 형식이 변경되어 새 작업실을 열었습니다."); }
    } catch { setToast("로컬 프로젝트를 불러오지 못했습니다. JSON 파일이 있다면 가져올 수 있습니다."); }
    setRestoreReady(true);
    fetch("/api/generate").then(r => r.json()).then(data => { setConfigured(data.configured); setModel(data.model); }).catch(() => setConfigured(false));
    return () => abort.current?.abort();
  }, []);
  useEffect(() => {
    if (!restoreReady) return;
    setSaveState("Saving…");
    const timer = setTimeout(() => { try { localStorage.setItem(storageKey, JSON.stringify(projectData())); setSaveState("Saved locally"); } catch { setSaveState("Storage full · export JSON"); } }, 450);
    return () => clearTimeout(timer);
  }, [artwork, sketchFrames, activeSketch, panels, savedBrushes, drawingBrush, semanticPens, activeSemanticPenId, workspace, restoreReady]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(""), 6000); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input,textarea,select")) return;
      if (e.key === "Escape") { setPencilOpen(false); setPenSettingsOpen(false); canvas.current?.clearSelection(); setModal(false); setExportOpen(false); }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); }
      else if (!(e.metaKey || e.ctrlKey || e.altKey)) { const key = e.key.toLowerCase(); if (key === "p") chooseTool("pen"); if (key === "e") chooseTool("eraser"); if (key === "l") chooseTool("lasso"); if (key === "h") chooseTool("hand"); }
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [history, future, artwork, stage, lab, labFuture, brush, annotating, annotationHistory, busy, activeSketch, sketchFrames, sketchHistories, panels]);
  useEffect(() => { if (generated?.bindings.length) { setCodeDraft(current => syncParameters(current, groups, generated.bindings)); setRuntimeError(""); } }, [groups, generated]);
  useEffect(() => { if (brush) setLab(current => ({ ...current, strokes: current.strokes.map(s => ({ ...s, brush: structuredClone(brush) })) })); }, [brush]);

  useEffect(() => { inspector.current?.scrollTo({ top: 0 }); }, [stage, selected, activeSketch]);
  useEffect(() => { if (stage === "brush" && !annotating) workspaceCanvas.current?.focus("brush"); }, [stage, annotating]);
  useEffect(() => { if (pendingFrameFocus) { workspaceCanvas.current?.focus(pendingFrameFocus); setPendingFrameFocus(null); } }, [pendingFrameFocus, sketchFrames, panels]);

  function projectData() { return { version: 1 as const, name: artwork.name, artwork, sketchFrames, activeSketchId: activeSketch, sketchPanels: savedSketchPanels(panels), featureSourceId, features, groups, analysisRevision, generated: generated ? { ...generated, code: liveSource } : null, brush, savedBrushes, drawingBrush, semanticPens, activeSemanticPenId, brushDescription, workspace }; }
  function restore(data: ReturnType<typeof projectSchema.parse>) {
    activeDocument.current++; cancel(); prepareNumber.current++;
    setArtwork(data.artwork); artworkRef.current = data.artwork; setSketchFrames(data.sketchFrames); sketchFramesRef.current = data.sketchFrames;
    setPanels(Object.fromEntries(Object.entries(data.sketchPanels).map(([id, saved]) => [id, createSketchPanel(saved)])));
    setActiveSketch(data.activeSketchId); activeSketchRef.current = data.activeSketchId;
    setSketchHistories({}); setSketchSelections({}); setWorkspace(data.workspace); setSavedBrushes(data.savedBrushes); setDrawingBrush(data.drawingBrush); setSemanticPens(data.semanticPens); setActiveSemanticPenId(data.activeSemanticPenId); setPenSettingsOpen(false);
    setHistory([]); setFuture([]); canvas.current?.clearSelection();
  }
  function commit(next: Artwork) { const previous = artworkRef.current; const updated = { ...next, revision: previous.revision + 1 }; setHistory(h => [...h.slice(-39), previous]); setFuture([]); artworkRef.current = updated; setArtwork(updated); }
  function undo() { if (annotating) { if (!busy) editAnnotations({ type: "undo" }); return; } if (stage === "brush") { if (!lab.strokes.length) return; setLabFuture(f => [...f, lab.strokes[lab.strokes.length - 1]]); setLab(a => ({ ...a, strokes: a.strokes.slice(0, -1) })); return; } if (activeSketch !== "source") { undoSketchFrame(); return; } if (!history.length) return; setFuture(f => [...f, artwork]); setArtwork(history[history.length - 1]); setHistory(h => h.slice(0, -1)); }
  function redo() { if (annotating) { if (!busy) editAnnotations({ type: "redo" }); return; } if (stage === "brush") { if (!labFuture.length) return; const stroke = labFuture[labFuture.length - 1]; setLab(a => ({ ...a, strokes: [...a.strokes, { ...stroke, brush: brush || stroke.brush }] })); setLabFuture(f => f.slice(0, -1)); return; } if (activeSketch !== "source") { redoSketchFrame(); return; } if (!future.length) return; setHistory(h => [...h, artwork]); setArtwork(future[future.length - 1]); setFuture(f => f.slice(0, -1)); }
  function chooseTool(next: string) { setPenSettingsOpen(false); if (annotating) { setTool(next); setPencilOpen(false); return; } setTool(next); setPencilOpen(next === "pen" ? !pencilOpen : false); if (stage === "brush") { setStage("features"); workspaceCanvas.current?.focus(activeSketch as FrameId); } }
  function selectFeature(id: string) { setSelected(selected === id ? null : id); setHovered(null); }
  function selectSketchFeature(owner: string, id: string) {
    activateSketch(owner);
    updatePanel(owner, previous => ({ selected: previous.selected === id ? null : id, hovered: null }));
  }
  function zoom(change: number) { workspaceCanvas.current?.zoom(change); }
  async function request(intent: string, body: object, owner = activeSketch) {
    updatePanel(owner, { error: "" }); const controller = new AbortController(); abort.current = controller;
    const response = await fetch("/api/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ intent, ...body }), signal: controller.signal });
    const result = await response.json(); if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError"); if (!response.ok || result.error) throw new Error(result.error || "요청을 처리하지 못했습니다."); return result;
  }
  async function task(label: string, work: () => Promise<void>, owner = activeSketch) {
    if (panelsRef.current[owner]?.loading) return; const number = ++requestNumber.current; updatePanel(owner, { loading: label, error: "" });
    try { await work(); } catch (e) { if (number === requestNumber.current && !(e instanceof DOMException && e.name === "AbortError")) updatePanel(owner, { error: e instanceof Error ? e.message : "처리 중 오류가 발생했습니다." }); }
    finally { if (number === requestNumber.current) updatePanel(owner, { loading: "" }); }
  }
  function cancel() { requestNumber.current++; abort.current?.abort(); updatePanel(activeSketchRef.current, { loading: "" }); }
  function activateSketch(id: string) {
    if (id === activeSketchRef.current) return;
    cancel(); prepareNumber.current++;
    updatePanel(activeSketchRef.current, { loading: "", hovered: null });
    setPanels(current => current[id] ? current : { ...current, [id]: createSketchPanel() });
    activeSketchRef.current = id; setActiveSketch(id);
  }
  function addSketchFrame() {
    if (busy || sketchFrames.length >= 24) return;
    const id: FrameId = `sketch-${crypto.randomUUID()}`;
    setSketchFrames(current => [...current, { id, artwork: { ...blank(), name: `Sketch ${current.length + 2}` } }]);
    setWorkspace(current => ({ ...current, frames: { ...current.frames, [id]: nextSketchPosition(current.frames) } }));
    setSketchHistories(current => ({ ...current, [id]: { past: [], future: [] } }));
    activateSketch(id); setTool("pen"); setPencilOpen(false); setPenSettingsOpen(false); setPendingFrameFocus(id);
  }
  function commitSketchFrame(id: string, next: Artwork) {
    const previous = sketchFramesRef.current.find(f => f.id === id)?.artwork; if (!previous) return;
    const updated = { ...next, revision: previous.revision + 1 };
    setSketchHistories(current => ({ ...current, [id]: { past: [...(current[id]?.past || []).slice(-39), previous], future: [] } }));
    const frames = sketchFramesRef.current.map(f => f.id === id ? { ...f, artwork: updated } : f);
    sketchFramesRef.current = frames; setSketchFrames(frames);
  }
  function undoSketchFrame() {
    const state = sketchHistories[activeSketch]; if (!state?.past.length) return;
    const previous = state.past[state.past.length - 1];
    setSketchFrames(current => current.map(f => f.id === activeSketch ? { ...f, artwork: previous } : f));
    setSketchHistories(current => ({ ...current, [activeSketch]: { past: state.past.slice(0, -1), future: [...state.future, currentSketch] } }));
  }
  function redoSketchFrame() {
    const state = sketchHistories[activeSketch]; if (!state?.future.length) return;
    const next = state.future[state.future.length - 1];
    setSketchFrames(current => current.map(f => f.id === activeSketch ? { ...f, artwork: next } : f));
    setSketchHistories(current => ({ ...current, [activeSketch]: { past: [...state.past, currentSketch], future: state.future.slice(0, -1) } }));
  }
  async function analyze() { await analyzeFrame(activeSketch); }
  async function analyzeFrame(id: string) {
    activateSketch(id);
    await task("스케치의 시각적 특징을 분석하고 있습니다…", async () => {
      const frameArtwork = () => id === "source" ? artworkRef.current : sketchFramesRef.current.find(f => f.id === id)?.artwork;
      const revision = frameArtwork()?.revision, document = activeDocument.current;
      const handle = id === "source" ? canvas.current : sketchCanvases.current.get(id);
      if (!handle) throw new Error("캔버스가 준비될 때까지 잠시 기다려주세요.");
      const capture = handle.capture(); const result = analysisSchema.parse(await request("analyze", { image: capture.image }, id));
      if (document !== activeDocument.current || revision !== frameArtwork()?.revision) throw new Error("분석 중 스케치가 변경되었습니다. 다시 분석해주세요.");
      const mapped = result.features.map(f => ({ ...f, region: { x: capture.region.x + f.region.x * capture.region.w, y: capture.region.y + f.region.y * capture.region.h, w: f.region.w * capture.region.w, h: f.region.h * capture.region.h } }));
      updatePanel(id, { ...createSketchPanel(), features: mapped, analysisRevision: revision! }); setToast(`${mapped.length}개의 특징을 발견했습니다.`);
    }, id);
  }
  async function generateRules(target?: string, alternative = false) {
    const wanted = target ? features.filter(f => f.id === target) : selected ? features.filter(f => f.id === selected) : features;
    if (!wanted.length) { setError("먼저 스케치나 사진을 분석해주세요."); return; }
    await task("선택한 특징의 subfeature와 파라미터를 만들고 있습니다…", async () => {
      const result = rulesSchema.parse(await request("rules", { features: wanted, groups: groups.filter(g => wanted.some(f => f.id === g.featureId)), alternative, instruction }));
      setGroups(current => [...current.filter(g => !wanted.some(f => f.id === g.featureId)), ...result.groups]); setRemovedControls([]); setStage("rules");
    });
  }
  function deleteControl(featureId: string, subId: string, methodId?: string, parameterId?: string) {
    if (busy) return;
    const updated = removeControl(groups, featureId, subId, methodId, parameterId);
    setRemovedControls(history => [...history.slice(-19), { groups, generated: generated ? { ...generated, code: liveSource } : null }]);
    setGroups(updated);
    if (generated) setGenerated(detachControls(generated, groups, updated));
    setToast("위젯을 삭제했습니다. 현재 그림은 유지됩니다.");
  }
  function undoControlDeletion() {
    const previous = removedControls[removedControls.length - 1]; if (!previous || busy) return;
    setGroups(previous.groups); setGenerated(previous.generated); setRemovedControls(history => history.slice(0, -1));
  }
  async function refreshBoundCode(updated: RuleGroup[], featureId: string, subfeatureId: string) {
    if (!generated?.bindings.some(b => b.featureId === featureId && b.subfeatureId === subfeatureId)) return;
    setLoading("새 위젯을 코드에 연결하고 있습니다…");
    const scope = updated.filter(g => generated.bindings.some(b => b.featureId === g.featureId));
    const result = generatedSchema.parse(await request("code", { features: features.filter(f => scope.some(g => g.featureId === f.id)), groups: activeGroups(scope), previous: liveSource, instruction: `${instruction}\nOnly change the implementation of subfeature ${subfeatureId} for feature ${featureId}; preserve other subfeatures and composition.` }));
    setGenerated(result); setRemovedControls([]);
  }
  async function changeImplementation(featureId: string, subId: string, methodId: string) {
    const updated = groups.map(g => g.featureId !== featureId ? g : { ...g, subfeatures: g.subfeatures.map(s => s.id !== subId ? s : { ...s, selectedImplementation: methodId }) });
    setGroups(updated); setRemovedControls([]);
    if (generated?.bindings.some(b => b.featureId === featureId && b.subfeatureId === subId)) await task("구현 방식을 코드에 반영하고 있습니다…", () => refreshBoundCode(updated, featureId, subId));
  }
  async function regenerateSubfeature(featureId: string, subfeatureId: string) {
    const group = groups.find(g => g.featureId === featureId); if (!group) return;
    await task("이 subfeature의 구현과 위젯만 다시 만들고 있습니다…", async () => {
      const replacement = subfeatureSchema.parse(await request("subfeature", { features: features.filter(f => f.id === featureId), groups: [group], targetFeatureId: featureId, targetSubfeatureId: subfeatureId, instruction }));
      const updated = replaceSubfeature(groups, featureId, subfeatureId, replacement); setGroups(updated); setRemovedControls([]);
      await refreshBoundCode(updated, featureId, subfeatureId);
    });
  }
  async function generateCode(repair = false) {
    if (!visibleGroups.length) { setError("먼저 해당 특징의 subfeature를 생성해주세요."); return; }
    await task(repair ? "실행 오류를 수정하고 있습니다…" : "규칙을 p5.js 코드로 번역하고 있습니다…", async () => {
      const relevant = features.filter(f => visibleGroups.some(g => g.featureId === f.id));
      const result = generatedSchema.parse(await request("code", { features: relevant, groups: activeGroups(visibleGroups), instruction: repair ? `${instruction}\nFix this runtime error: ${runtimeError}` : instruction, previous: generated ? liveSource : "" }));
      setGenerated(result); updatePanel(activeSketch, { generationMode: "rules" }); setRemovedControls([]); setRuntimeError(""); setStage("code"); setPendingFrameFocus(resultFrameId(activeSketch));
    });
  }
  async function prepare(code: string) { const number = ++prepareNumber.current; setRuntimeError(""); try { const result = await fetch("/api/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ intent: "prepare", code }) }).then(r => r.json()); if (number !== prepareNumber.current) return; if (result.error) throw new Error(result.error); setExecutable(result.executable); updatePanel(activeSketch, { preparedCode: code }); } catch (e) { if (number === prepareNumber.current) setRuntimeError(e instanceof Error ? e.message : "코드를 실행하지 못했습니다."); } }
  function resetAnnotations() { updatePanel(activeSketch, clearedResultAnnotations()); }
  function beginAnnotations(owner = activeSketch) {
    activateSketch(owner);
    const resultPanel = panelsRef.current[owner]; if (!resultPanel) return;
    if (resultPanel.annotating) { updatePanel(owner, { annotating: false }); return; }
    const image = resultPanel.annotationImage || resultPreviews.current.get(owner)?.capture();
    if (!image || !resultPanel.generated) { updatePanel(owner, { error: "결과 렌더링이 완료된 뒤 Annotate를 눌러주세요." }); return; }
    const code = syncParameters(resultPanel.generated.code, resultPanel.groups, resultPanel.generated.bindings);
    updatePanel(owner, { annotationImage: image, annotationSource: code, annotationRenderRevision: resultPanel.renderRevision, annotating: true });
    setTool("pen"); setPencilOpen(false); setPenSettingsOpen(false); workspaceCanvas.current?.focus(resultFrameId(owner));
  }
  function openResultCode(owner: string) { activateSketch(owner); updatePanel(owner, { stage: "code" }); }
  async function beginClarification() {
    if (busy || !annotations.length) return;
    setClarifying(true);
    if (revisionInstruction.trim() && clarificationContext === currentSketchSnapshot) return;
    await requestClarification();
  }
  async function requestClarification() {
    if (busy || !generated || !annotationImage || !annotations.length) return;
    const snapshot = currentRevisionSnapshot, sketchSnapshot = currentSketchSnapshot;
    await task(clarificationLabel, async () => {
      const number = requestNumber.current;
      const image = await annotatedResultImage(annotationImage, annotations);
      if (number !== requestNumber.current || revisionState.current !== snapshot) return;
      const result = clarificationSchema.parse(await request("clarification", { image, resultImage: annotationImage, annotations, features, groups, previous: liveSource, instruction: revisionInstruction }));
      if (number !== requestNumber.current || revisionState.current !== snapshot) return;
      setRevisionInstruction(result.clarification); setClarificationContext(sketchSnapshot); setRevisionProposal(null);
    });
  }
  async function requestRevision() {
    if (!generated || !annotationImage || !annotations.length || !revisionInstruction.trim()) return;
    const snapshot = currentRevisionSnapshot;
    await task("스케치와 clarification을 바탕으로 feature와 rule 변경안을 만들고 있습니다…", async () => {
      const number = requestNumber.current;
      const image = await annotatedResultImage(annotationImage, annotations);
      if (number !== requestNumber.current || revisionState.current !== snapshot) return;
      const proposal = revisionProposalSchema.parse(await request("revision", { image, annotations, features, groups, previous: liveSource, instruction: revisionInstruction }));
      if (number !== requestNumber.current || revisionState.current !== snapshot) return;
      validateRevisionProposal(proposal, features, groups);
      setRevisionProposal({ proposal, snapshot });
    });
  }
  async function confirmRevision() {
    if (!revisionProposal || proposalStale || !generated) return;
    const { proposal, snapshot } = revisionProposal;
    await task("확인한 변경안을 위젯과 p5.js 결과에 적용하고 있습니다…", async () => {
      const number = requestNumber.current;
      const image = await annotatedResultImage(annotationImage, annotations);
      if (number !== requestNumber.current || revisionState.current !== snapshot) return;
      const scope = revisionCodeGroups(proposal, features, groups, generated.bindings.map(b => b.featureId));
      const result = generatedSchema.parse(await request("code", { features: revisionCodeFeatures(proposal, features, scope), groups: activeGroups(scope), previous: liveSource, image, annotations, revisionSummary: proposal.summary, instruction: revisionInstruction }));
      if (number !== requestNumber.current || revisionState.current !== snapshot) return;
      // Validate execution before committing any feature, widget or code changes.
      await request("prepare", { code: result.code });
      if (number !== requestNumber.current || revisionState.current !== snapshot) return;
      setFeatures(proposal.features); setGroups(proposal.groups); setGenerated(result); setRemovedControls([]); setRuntimeError("");
      setSelected(null); setHovered(null); resetAnnotations(); setStage("rules");
      setToast("확인한 feature·widget 변경안을 적용하고 결과를 업데이트했습니다.");
    });
  }
  async function generateBrush(alternative = false) {
    const sources = selected ? features.filter(f => f.id === selected || blend.includes(f.id)) : features;
    if (!sources.length) { setError("먼저 스케치나 사진을 분석해주세요."); return; }
    await task("특징을 담은 procedural brush를 만들고 있습니다…", async () => {
      const result = brushSchema.parse(await request("brush", { features: sources, groups: activeGroups(groups.filter(g => sources.some(f => f.id === g.featureId))), image: (featureSourceId === "source" ? canvas.current : sketchCanvases.current.get(featureSourceId))?.capture().image, alternative, previous: alternative && brush ? JSON.stringify(brush) : "", instruction, brushDescription: brushDescription.trim() }));
      setBrush(result); applyGesture(gesture, result); setStage("brush"); setPencilOpen(false);
    });
  }
  function applyGesture(path: string, recipe = brush) {
    setGesture(path); setLabFuture([]);  if (!recipe) return;
    const points = Array.from({ length: 151 }, (_, i) => { const t = i / 150; return { x: 95 + t * 710, y: path === "line" ? 310 : path === "wave" ? 300 + Math.sin(t * Math.PI * 2) * 65 : 370 - Math.sin(t * Math.PI) * 150 }; });
    setLab({ ...blank(), strokes: [{ tool: "brush", brush: recipe, points, width: 3, color: recipe.settings.color, opacity: 1 }] });
  }
  async function attach(file: File) {
    const targetId = activeSketch, document = activeDocument.current;
    try {
      const photo = await readPhoto(file);
      if (document !== activeDocument.current) return false;
      const previous = targetId === "source" ? artworkRef.current : sketchFramesRef.current.find(f => f.id === targetId)?.artwork;
      if (!previous) return false;
      cancel();
      const next = { ...previous, photo, strokes: [], name: file.name.replace(/\.[^.]+$/, "") };
      if (targetId === "source") commit(next); else commitSketchFrame(targetId, next);
      const handle = targetId === "source" ? canvas.current : sketchCanvases.current.get(targetId);
      handle?.clearSelection();
      if (panelsRef.current[targetId]) {
        setFeatures([]); setGroups([]); setRemovedControls([]); setGenerated(null); setSelected(null); setHovered(null); setAnalysisRevision(-1);
      }
      if (activeSketchRef.current === targetId) { activateSketch(targetId); workspaceCanvas.current?.focus(targetId as FrameId); }
      return true;
    } catch (e) { if (document === activeDocument.current) setError((e as Error).message); return false; }
  }
  function pastePhoto(event: React.ClipboardEvent) {
    if ((event.target as Element).closest("input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox']") || modal || exportOpen) return;
    const item = Array.from(event.clipboardData.items).find(item => item.kind === "file" && item.type.startsWith("image/"));
    const image = item?.getAsFile() || Array.from(event.clipboardData.files).find(file => file.type.startsWith("image/"));
    if (!image) return;
    event.preventDefault();
    const extension = image.type === "image/jpeg" ? "jpg" : image.type === "image/webp" ? "webp" : "png";
    const file = new File([image], `Clipboard image.${extension}`, { type: image.type });
    void attach(file).then(attached => { if (attached) setToast("클립보드 이미지를 첨부했습니다."); });
  }
  function saveBrush() { if (!brush) return; setSavedBrushes(current => [...current.filter(b => b.name !== brush.name), structuredClone(brush)].slice(-32)); setToast("브러시를 로컬 라이브러리에 저장했습니다."); }
  function useBrush(recipe = brush) { if (!recipe) return; setDrawingBrush(structuredClone(recipe)); setTool("brush"); setAnnotating(false); setStage("features"); workspaceCanvas.current?.focus(activeSketch as FrameId); setPencilOpen(false); setPenSettingsOpen(false); setToast("스케치 위에서 드래그하면 선택한 펜으로 그려집니다."); }
  function editDrawingPen(pen: SemanticPen) { setSemanticPens(current => current.map(item => item.id === pen.id ? pen : item)); }
  function selectAlgorithmPen(pen: SemanticPen) {
    setActiveSemanticPenId(pen.id); setTool("semantic"); setAnnotating(false); setPencilOpen(false); setPenSettingsOpen(true);
    if (stage === "brush") setStage("features");
    workspaceCanvas.current?.focus(activeSketch as FrameId);
  }
  function generateAlgorithmPen(featureId: string, subfeatureId: string) {
    if (semanticPens.length >= 32) { setError("툴바에 펜이 가득 찼습니다. 사용하지 않는 펜을 제거해주세요."); return; }
    const feature = features.find(f => f.id === featureId); if (!feature) return;
    try {
      const pen = makeSemanticPen(groups, feature, subfeatureId, activeSketch, crypto.randomUUID(), semanticPenColors.find(c => !semanticPens.some(p => p.color === c)) || semanticPenColors[semanticPens.length % semanticPenColors.length]);
      const baseName = pen.name.slice(0, 90); let name = baseName, suffix = 2;
      while (semanticPens.some(item => item.name === name)) name = `${baseName} ${suffix++}`;
      const next = { ...pen, name };
      setSemanticPens(current => [...current, next]); selectAlgorithmPen(next);
      setToast(`${name}을 툴바에 추가했습니다. 자유롭게 그린 뒤 Compose prompt로 조합하세요.`);
    } catch (e) { setError(e instanceof Error ? e.message : "펜에 알고리즘을 담지 못했습니다."); }
  }
  async function draftComposePrompt() {
    if (busy || !sourcePresent) return;
    const owner = activeSketch, document = activeDocument.current, revision = currentSketch.revision, previousPrompt = composePrompt;
    await task(compositionPromptLabel, async () => {
      const number = requestNumber.current;
      const handle = owner === "source" ? canvas.current : sketchCanvases.current.get(owner);
      if (!handle) throw new Error("스케치 캔버스가 준비될 때까지 잠시 기다려주세요.");
      const capture = handle.capture(true), context = compositionContext(currentSketch);
      const result = compositionPromptSchema.parse(await request("compose-prompt", { image: capture.image, ...context, instruction: previousPrompt }, owner));
      const latest = owner === "source" ? artworkRef.current : sketchFramesRef.current.find(f => f.id === owner)?.artwork;
      if (number !== requestNumber.current || document !== activeDocument.current) return;
      if (revision !== latest?.revision || previousPrompt !== panelsRef.current[owner]?.composePrompt) throw new Error("스케치 또는 prompt가 변경되었습니다. AI prompt를 다시 만들어주세요.");
      updatePanel(owner, { composePrompt: result.prompt });
      setToast("AI가 Compose prompt를 작성했습니다. 설명을 확인하거나 수정한 뒤 Compose sketch를 눌러주세요.");
    }, owner);
  }
  async function composeSketch(repair = false) {
    const owner = activeSketch, document = activeDocument.current, prompt = composePrompt.trim();
    if (!sourcePresent) { setError("먼저 스케치하거나 사진을 추가해주세요."); return; }
    if (!prompt) { await draftComposePrompt(); return; }
    const revision = currentSketch.revision;
    await task("펜의 의미와 스케치를 prompt로 조합하고 있습니다…", async () => {
      const handle = owner === "source" ? canvas.current : sketchCanvases.current.get(owner);
      if (!handle) throw new Error("스케치 캔버스가 준비될 때까지 잠시 기다려주세요.");
      const capture = handle.capture(true), context = compositionContext(currentSketch);
      const result = generatedSchema.parse(await request("compose", { image: capture.image, ...context, instruction: repair ? `${prompt}\nFix this runtime error: ${runtimeError}` : prompt, previous: repair ? liveSource : "" }, owner));
      const latest = owner === "source" ? artworkRef.current : sketchFramesRef.current.find(f => f.id === owner)?.artwork;
      if (document !== activeDocument.current || revision !== latest?.revision || prompt !== panelsRef.current[owner]?.composePrompt.trim()) throw new Error("스케치 또는 prompt가 변경되었습니다. 다시 Compose해주세요.");
      updatePanel(owner, { generated: result, codeDraft: result.code, executable: "", preparedCode: "", runtimeError: "", removedControls: [], stage: "code", generationMode: "compose" });
      setPendingFrameFocus(resultFrameId(owner));
    }, owner);
  }
  function newProject() {
    cancel(); activeDocument.current++; prepareNumber.current++;
    const nextArtwork = { ...blank(), name: newName.trim() || "Untitled exploration" };
    setPanels({ source: createSketchPanel() }); setActiveSketch("source"); activeSketchRef.current = "source";
    setSketchFrames([]); sketchFramesRef.current = []; setSketchHistories({}); setSketchSelections({});
    setWorkspace(workspaceSchema.parse({})); setArtwork(nextArtwork); artworkRef.current = nextArtwork;
    setTool("pen"); setPencilOpen(false); setDrawingBrush(null); setActiveSemanticPenId(null); setPenSettingsOpen(false); setHistory([]); setFuture([]); setModal(false); canvas.current?.clearSelection();
  }
  const setFeatureLabel = (id: string, label: string) => setFeatures(fs => fs.map(f => f.id === id ? { ...f, label } : f));
  const featureName = (id: string) => features.find(f => f.id === id)?.label || id;
  const toolButton = (name: string, icon: IconName, label: string) => <button className={`rail-button ${tool === name && (annotating || stage !== "brush") ? "active" : ""}`} aria-label={label} aria-pressed={tool === name && (annotating || stage !== "brush")} aria-expanded={name === "pen" ? pencilOpen : undefined} onClick={() => chooseTool(name)}><Icon name={icon} /></button>;

  return <div className={`studio live-studio freeform-studio ${stage === "brush" ? "brush-mode" : ""}`} onPaste={pastePhoto}>
    <header className="topbar"><a className="brand" href="/" aria-label="Rulegen home"><span className="brand-mark"><i /><i /><i /></span>rulegen<span className="beta">LAB</span></a><div className="project-title"><span className="slash">/</span><input aria-label="Project name" value={artwork.name} maxLength={200} onChange={e => setArtwork(a => ({ ...a, name: e.target.value }))} /><span className="saved-dot" /><span className="saved-label">{saveState}</span></div><div className="top-actions"><button className="text-button" onClick={() => setExportOpen(true)}>Export project <Icon name="download" size={14} /></button><button className="text-button" onClick={() => importInput.current?.click()}>Open JSON</button><button className="text-button" onClick={() => { setNewName(""); setModal(true); }}>New exploration <Icon name="plus" size={15} /></button></div></header>
    <input ref={upload} className="visually-hidden" type="file" accept="image/png,image/jpeg,image/webp" aria-label="Attach photograph" onChange={e => { if (e.target.files?.[0]) void attach(e.target.files[0]); e.target.value = ""; }} />
    <input ref={importInput} className="visually-hidden" type="file" accept=".json" aria-label="Open project JSON" onChange={async e => { const file = e.target.files?.[0]; e.target.value = ""; if (!file) return; try { if (file.size > 12_000_000) throw new Error("프로젝트 파일이 너무 큽니다."); restore(projectSchema.parse(JSON.parse(await file.text()))); } catch { setError("올바른 Rulegen 프로젝트 JSON 파일을 선택해주세요."); } }} />
    <div className="workspace">
      <nav className="rail" aria-label="Workspace toolbar"><button className="rail-button" aria-label="Exploration workspace" onClick={() => setStage("features")}><Icon name="grid" size={20} /></button><button className="rail-button" aria-label="Add sketch frame" title="Add sketch frame" disabled={busy || sketchFrames.length >= 24} onClick={addSketchFrame}><Icon name="plus" size={20} /></button><button className="rail-button" aria-label="Attach photo" title="Attach photo" onClick={() => upload.current?.click()}><Icon name="upload" size={20} /></button><div className="rail-line" /><div className="left-sketch-tools" role="toolbar" aria-label="Sketch tools"><div className="left-tool-anchor">{toolButton("pen", "pen", "Pencil")}{pencilOpen && <div className="pencil-popover" role="group" aria-label="Pencil settings"><div className="pencil-popover-heading"><span>Pencil settings</span><button aria-label="Close pencil settings" onClick={() => setPencilOpen(false)}><Icon name="close" size={14} /></button></div><span className="left-setting-title">INK COLOR</span><div className="left-colors">{["#75664e", "#397461", "#333a3b", "#b56850"].map(c => <button key={c} className={`color ${color === c ? "active" : ""}`} style={{ background: c }} aria-label={`Select color ${c}`} aria-pressed={color === c} onClick={() => setColor(c)} />)}</div><label><span>Size</span><input aria-label="Pencil size" type="range" min="1" max="20" value={width} onChange={e => setWidth(+e.target.value)} /><output>{width}px</output></label><label><span>Opacity</span><input aria-label="Pencil opacity" type="range" min="5" max="100" value={opacity} onChange={e => setOpacity(+e.target.value)} /><output>{opacity}%</output></label></div>}</div>{toolButton("eraser", "eraser", "Eraser")}{toolButton("lasso", "lasso", "Lasso selection")}{toolButton("hand", "hand", "Pan")}{activeDrawingBrush && toolButton("brush", "brush", "Generated brush")}{algorithmPens.length > 0 && <div className="left-tool-anchor algorithm-pen-anchor"><div className="algorithm-pen-toolbar" role="group" aria-label="Algorithm pens">{algorithmPens.map(pen => <button key={pen.id} style={{ color: pen.color }} className={`rail-button algorithm-pen-button ${tool === "semantic" && activeSemanticPenId === pen.id ? "active" : ""}`} title={`${pen.name} · ${pen.meaning}`} aria-label={`Use algorithm pen ${pen.name}`} aria-pressed={tool === "semantic" && activeSemanticPenId === pen.id} onClick={() => { if (tool === "semantic" && activeSemanticPenId === pen.id) { setPenSettingsOpen(open => !open); setPencilOpen(false); } else selectAlgorithmPen(pen); }}><Icon name="pen" size={18} /><span className="semantic-pen-dot" style={{ background: pen.color }} /></button>)}</div>{penSettingsOpen && activeSemanticPen && tool === "semantic" && <AlgorithmPenSettings pen={activeSemanticPen} onChange={editDrawingPen} onClose={() => setPenSettingsOpen(false)} onRemove={() => { setSemanticPens(current => current.filter(pen => pen.id !== activeSemanticPen.id)); setActiveSemanticPenId(null); setTool("pen"); setPenSettingsOpen(false); }} />}</div>}<div className="rail-line" /><button className="rail-button" aria-label="Undo" disabled={annotating ? busy || !annotationHistory.past.length : stage === "brush" ? !lab.strokes.length : activeSketch !== "source" ? !sketchHistories[activeSketch]?.past.length : !history.length} onClick={undo}><Icon name="undo" size={16} /></button><button className="rail-button" aria-label="Redo" disabled={annotating ? busy || !annotationHistory.future.length : stage === "brush" ? !labFuture.length : activeSketch !== "source" ? !sketchHistories[activeSketch]?.future.length : !future.length} onClick={redo}><Icon name="redo" size={16} /></button><button className="rail-button" aria-label="Clear canvas" disabled={annotating && (busy || !annotations.length)} onClick={() => { if (annotating) { editAnnotations({ type: "clear" }); return; } if (stage === "brush") { setLabFuture(lab.strokes.slice().reverse()); setLab(blank()); } else if (activeSketch !== "source") { commitSketchFrame(activeSketch, { ...currentSketch, strokes: [], photo: null }); sketchCanvases.current.get(activeSketch)?.clearSelection(); } else { commit({ ...artwork, strokes: [], photo: null }); if (featureSourceId === "source") { setFeatures([]); setGroups([]); setRemovedControls([]); setGenerated(null); setSelected(null); } } canvas.current?.clearSelection(); }}><Icon name="close" size={16} /></button></div><div className="left-zoom"><button className="rail-button" aria-label="Zoom in" onClick={() => zoom(.1)}><Icon name="plus" size={14} /></button><button aria-label="Fit canvas frames" onClick={() => workspaceCanvas.current?.fit()}>{Math.round((workspace.camera?.zoom || .4) * 100)}%</button><button className="rail-button" aria-label="Zoom out" onClick={() => zoom(-.1)}><Icon name="minus" size={14} /></button></div><button className="help-button" aria-label="Keyboard shortcuts" onClick={() => setToast("P 연필 · E 지우개 · L 라쏘 · H 이동 · ⌘/Ctrl+Z 실행 취소 · Space/Alt+드래그 이동 · ⌘/Ctrl+스크롤 확대 · ⌘/Ctrl+V 이미지 붙여넣기 · Esc 선택 해제")}>?</button></nav>
      <main className="canvas-workspace">
        <FreeformWorkspace ref={workspaceCanvas} layout={resultLayout} onChange={setWorkspace} activeFrame={activeSketch as FrameId} onActivateFrame={id => { const owner = resultSketchId(id); if (owner) activateSketch(owner); else if (id === "source" || id.startsWith("sketch-")) activateSketch(id); }} tool={tool} onBackground={() => { setPencilOpen(false); setPenSettingsOpen(false); }} onDrop={file => { void attach(file); }} frames={[
          { id: "source", title: artwork.photo ? "Photo + sketch" : "Original sketch", subtitle: `${artwork.strokes.length} strokes${hasSelection ? " · selection" : ""}${activeSketch === "source" ? " · active" : ""}`, actions: <><button title="Load example sketch" aria-label="Load example sketch" disabled={busy} onClick={() => { activateSketch("source"); commit({ ...blank(), name: "Branch studies", strokes: exampleStrokes() }); updatePanel("source", createSketchPanel()); }}><Icon name="pen" size={13} /></button><button disabled={!(artwork.photo || artwork.strokes.length) || busy} onClick={() => { activateSketch("source"); void analyzeFrame("source"); }}>{hasSelection ? "Analyze selection" : "Analyze"}<Icon name="spark" size={13} /></button></>, content: boardZoom => <div className="sketch-frame-surface" onPointerDownCapture={e => { if (!(e.target as Element).closest("button")) activateSketch("source"); }}><SketchCanvas ref={canvas} artwork={artwork} tool={tool} color={color} width={width} opacity={opacity} transparent viewport={viewport} brush={activeDrawingBrush || undefined} semanticPen={activeSemanticPen} onStroke={stroke => { if (artworkRef.current.strokes.length >= 500) { setError("한 프레임에는 최대 500개의 획을 저장할 수 있습니다. 새 스케치 프레임을 추가해주세요."); return; } setStage("features"); commit({ ...artworkRef.current, strokes: [...artworkRef.current.strokes, stroke] }); }} onViewport={() => {}} onSelection={setHasSelection} onError={message => updatePanel("source", { error: message })}>
              <FeatureOverlay features={panels.source?.features || []} selected={panels.source?.selected || null} hovered={activeSketch === "source" ? hovered : null} zoom={boardZoom} onSelect={id => selectSketchFeature("source", id)} onHover={id => { if (activeSketch === "source") setHovered(id); }} />
            </SketchCanvas>{!(artwork.photo || artwork.strokes.length) && <div className="frame-empty source-empty"><Icon name="pen" size={30} /><strong>Start with a mark.</strong><span>Draw here, drop a photo, or paste an image.</span><button onClick={() => upload.current?.click()}>Attach photo<Icon name="upload" size={14} /></button></div>}</div> },
          ...sketchFrames.map(frame => ({ id: frame.id as FrameId, title: frame.artwork.name, subtitle: `${frame.artwork.strokes.length} strokes${sketchSelections[frame.id] ? " · selection" : ""}${activeSketch === frame.id ? " · active" : ""}`, actions: <button disabled={busy || !(frame.artwork.photo || frame.artwork.strokes.length)} onClick={() => { activateSketch(frame.id); void analyzeFrame(frame.id); }}>{sketchSelections[frame.id] ? "Analyze selection" : "Analyze"}<Icon name="spark" size={13} /></button>, content: (boardZoom: number) => <div className="sketch-frame-surface" onPointerDownCapture={e => { if (!(e.target as Element).closest("button")) activateSketch(frame.id); }}><SketchCanvas ref={handle => { if (handle) sketchCanvases.current.set(frame.id, handle); else sketchCanvases.current.delete(frame.id); }} artwork={frame.artwork} tool={tool} color={color} width={width} opacity={opacity} viewport={viewport} brush={activeDrawingBrush || undefined} semanticPen={activeSemanticPen} onStroke={stroke => { if (frame.artwork.strokes.length >= 500) { setError("한 프레임에는 최대 500개의 획을 저장할 수 있습니다."); return; } activateSketch(frame.id); commitSketchFrame(frame.id, { ...sketchFramesRef.current.find(f => f.id === frame.id)!.artwork, strokes: [...sketchFramesRef.current.find(f => f.id === frame.id)!.artwork.strokes, stroke] }); }} onViewport={() => {}} onSelection={value => setSketchSelections(current => current[frame.id] === value ? current : { ...current, [frame.id]: value })} onError={message => updatePanel(frame.id, { error: message })}><FeatureOverlay features={panels[frame.id]?.features || []} selected={panels[frame.id]?.selected || null} hovered={activeSketch === frame.id ? hovered : null} zoom={boardZoom} onSelect={id => selectSketchFeature(frame.id, id)} onHover={id => { if (activeSketch === frame.id) setHovered(id); }} /></SketchCanvas>{!(frame.artwork.photo || frame.artwork.strokes.length) && <div className="frame-empty source-empty"><Icon name="pen" size={30} /><strong>Start a new sketch.</strong><span>Draw here, then analyze this frame.</span></div>}</div> })),
          ...resultOwners.map(owner => {
            const resultPanel = panels[owner.id] || createSketchPanel();
            return { id: resultFrameId(owner.id), title: `Generated result · ${owner.name}`, subtitle: resultPanel.annotating ? "Sketch → clarification → suggestions" : "p5.js", actions: <>
              <button disabled={!resultPanel.executable || Boolean(resultPanel.loading)} aria-pressed={resultPanel.annotating} onClick={() => beginAnnotations(owner.id)}><Icon name="pen" size={13} />{resultPanel.annotating ? "Done" : "Annotate"}</button>
              <button disabled={!resultPanel.executable || Boolean(resultPanel.loading)} aria-label="Rerun generated result" onClick={() => { activateSketch(owner.id); updatePanel(owner.id, previous => ({ renderRevision: previous.renderRevision + 1 })); }}><Icon name="play" size={13} />Run again</button>
            </>, content: (boardZoom: number) => <SketchResult owner={owner.id} panel={resultPanel} tool={tool} zoom={boardZoom} documentRevision={activeDocument.current}
              onActivate={() => activateSketch(owner.id)} onPatch={patch => updatePanel(owner.id, patch)}
              onPreview={handle => { if (handle) resultPreviews.current.set(owner.id, handle); else resultPreviews.current.delete(owner.id); }}
              onOpenCode={() => openResultCode(owner.id)} onExplore={() => { activateSketch(owner.id); updatePanel(owner.id, { stage: "rules" }); }} /> };
          }),
          ...(stage === "brush" ? [{ id: "brush" as const, title: brush?.name || "Brush playground", subtitle: "Draw to try your brush", actions: <button onClick={() => { setLabFuture(lab.strokes.slice().reverse()); setLab(blank()); }}>Clear</button>, content: <><SketchCanvas ref={brushCanvas} artwork={lab} tool={brush ? "brush" : "pen"} color={color} width={width} opacity={100} viewport={viewport} brush={brush || undefined} onStroke={stroke => { setLabFuture([]); setLab(a => ({ ...a, strokes: [...a.strokes.slice(-499), stroke] })); }} onViewport={() => {}} onSelection={() => {}} onError={setError} /></> }] : [])
        ]} />
        <footer className="workspace-footer"><span><span className="status-dot" />{configured ? `Connected · ${model}` : configured === false ? "OpenAI configuration required" : "Connecting…"}</span><span>FREEFORM · P5.JS</span></footer>
      </main>
      <aside className="inspector"><div className="inspector-title"><span aria-label="Inspector sketch" title={currentSketch.name}>{currentSketch.name}</span><Icon name="spark" size={17} /></div><div className="stage-tabs" role="tablist" aria-label="Exploration steps">{(["features", "rules", "code", "brush"] as const).map((s, i) => <button key={s} role="tab" aria-selected={stage === s} className={stage === s ? "active" : ""} onClick={() => { setStage(s); setPencilOpen(false); }}><span>0{i + 1}</span>{s === "features" ? "Features" : s === "rules" ? "Rules" : s === "code" ? "Code" : "Brush"}</button>)}</div>
        {loading && <div className="loading-banner" role="status"><span className="loading-spinner" /><span>{loading}</span><button onClick={cancel}>Cancel</button></div>}{error && <div className="error-banner" role="alert"><span>{error}</span><button aria-label="Dismiss error" onClick={() => setError("")}><Icon name="close" size={14} /></button></div>}
        <div ref={inspector} className="inspector-content live-inspector-content">
          {stage !== "brush" && !annotating && <SketchComposition artwork={currentSketch} prompt={composePrompt} onPrompt={setComposePrompt} onDraft={() => { void draftComposePrompt(); }} onCompose={() => { void composeSketch(); }} busy={busy} drafting={loading === compositionPromptLabel} />}
          {annotating && <ResultRevisionPanel hasSketch={Boolean(annotations.length)} clarifying={clarifying} onClarify={() => { void beginClarification(); }} onRegenerateClarification={() => { void requestClarification(); }} generatingClarification={loading === clarificationLabel} clarificationStale={Boolean(clarificationContext && clarificationContext !== currentSketchSnapshot)} onSketch={() => setClarifying(false)} instruction={revisionInstruction} proposal={revisionProposal?.proposal || null} changes={proposalChanges} stale={proposalStale} busy={busy} tool={tool} canUndo={Boolean(annotationHistory.past.length)} canRedo={Boolean(annotationHistory.future.length)} onTool={chooseTool} onUndo={undo} onRedo={redo} onInstruction={setRevisionInstruction} onRequest={() => { void requestRevision(); }} onConfirm={() => { void confirmRevision(); }} onDiscard={() => setRevisionProposal(null)} onClose={() => setAnnotating(false)} />}

          {stage === "features" && <><div className="section-kicker">LOOK A LITTLE CLOSER</div><h2>Every sketch has<br />a story to tell.</h2><p className="section-description">{features.length ? "Pick a visual ingredient. Edit it to match what you see." : "Draw or attach a photo, then analyze it to discover 2–6 visual ingredients."}</p>{stale && <div className="stale-banner">스케치가 변경되었습니다. 다시 분석하면 최신 특징으로 업데이트됩니다.</div>}{!features.length ? <div className="empty-features"><Icon name="spark" size={30} /><p>No features yet.</p><span>Sketch → Analyze → Explore</span><button className="primary-button" disabled={!sourcePresent || busy} onClick={analyze}>Analyze {currentSelection ? "selection" : "sketch"}<Icon name="spark" size={17} /></button></div> : <><div className="feature-list">{features.map((feature, i) => <div key={feature.id} className={`feature-item ${selected === feature.id ? "active" : ""}`}><button className="feature-select" aria-label={`Select ${feature.label}`} aria-pressed={selected === feature.id} onClick={() => selectFeature(feature.id)}><span className="feature-number">0{i + 1}</span></button><input aria-label={`Edit feature ${i + 1}`} value={feature.label} maxLength={100} onChange={e => setFeatureLabel(feature.id, e.target.value)} /></div>)}</div>{chosen && <p className="chosen-feature-description">{chosen.description}</p>}<div className="selection-summary"><span>{chosen ? "EXPLORING" : "NO FEATURE FILTER"}</span><strong>{chosen?.label || "All sketch features"}</strong>{selected && <button className="clear-feature" onClick={() => setSelected(null)}>Clear selection<Icon name="close" size={12} /></button>}</div><button className="primary-button" disabled={busy} onClick={() => generateRules()}>Generate subfeatures<Icon name="arrow" size={17} /></button><button className="feature-brush-button" disabled={busy} onClick={() => { setStage("brush"); setPencilOpen(false); }}><span><Icon name="brush" size={16} /><span>Create procedural brush<small>Turn selected features into a drawing tool</small></span></span><Icon name="arrow" size={15} /></button><button className="copy-button" disabled={busy} onClick={analyze}>Reanalyze {currentSelection ? "selection" : "sketch"}</button></>}</>}
          {stage === "rules" && <><div className="section-kicker">FROM FEATURE TO PARAMETERS</div><div className="rule-feature-filters" role="group" aria-label="Filter rules by visual feature"><button className={!selected ? "active" : ""} aria-pressed={!selected} onClick={() => setSelected(null)}>All features<span>{groups.reduce((n, g) => n + g.subfeatures.length, 0)}</span></button>{features.map(f => <button key={f.id} className={selected === f.id ? "active" : ""} aria-pressed={selected === f.id} onClick={() => selectFeature(f.id)}>{f.label}<span>{groups.find(g => g.featureId === f.id)?.subfeatures.length || 0}</span></button>)}</div><div className="rules-count" role="status">{visibleGroups.reduce((n, g) => n + g.subfeatures.length, 0)} subfeatures · {chosen?.label || "all features"}</div>{removedControls.length > 0 && <button className="undo-control-deletion" disabled={busy} onClick={undoControlDeletion}><Icon name="undo" size={13} />Undo deletion</button>}{!visibleGroups.length && <div className="empty-panel">No subfeatures for this selection yet.<button className="primary-button" disabled={busy || !features.length} onClick={() => generateRules()}>Generate subfeatures<Icon name="spark" size={16} /></button></div>}{visibleGroups.length > 0 && <div className={`live-controls-status status-${controlsStatus}`} role="status"><span className="status-dot" />{controlsStatus === "live" ? "Live · controls update code & visual" : controlsStatus === "changed" ? "Implementation changed · update code to connect" : generated ? "Connect widgets to your current code" : "Generate code to enable live controls"}</div>}{visibleGroups.length > 0 && <button className="primary-button rules-generate-button" disabled={busy} onClick={() => generateCode()}>{generated && controlsStatus !== "live" ? "Connect live controls" : "Generate code"}<Icon name="code" size={17} /></button>}{visibleGroups.map(group => <SubfeatureControls key={group.featureId} group={group} name={featureName(group.featureId)} busy={busy} onMethod={(subId, methodId) => { void changeImplementation(group.featureId, subId, methodId); }} onParameter={(subId, methodId, parameterId, value) => { setRemovedControls([]); setGroups(current => updateParameter(current, group.featureId, subId, methodId, parameterId, value)); }} onAlternative={() => generateRules(group.featureId, true)} onMakePen={subId => generateAlgorithmPen(group.featureId, subId)} onRegenerate={subId => regenerateSubfeature(group.featureId, subId)} onRemove={(subId, methodId, parameterId) => deleteControl(group.featureId, subId, methodId, parameterId)} />)}</>}
          {stage === "code" && <><div className="section-kicker">MAKE ROOM FOR THE UNEXPECTED</div><h2>{generationMode === "compose" ? <>See your sketch<br />become a system.</> : <>See your rules<br />come to life.</>}</h2>{!generated ? <div className="empty-panel">Generate a rule set, then translate it into p5.js.<button className="primary-button" onClick={() => setStage("rules")}>Explore rules<Icon name="arrow" size={16} /></button></div> : <><p className="section-description">{generated.title}</p><div className="preview-tabs"><button onClick={() => workspaceCanvas.current?.focus(resultFrameId(activeSketch))}><Icon name="grid" size={13} />Focus result frame</button><span>p5.js</span></div><textarea className="live-code-editor" spellCheck={false} aria-label="Generated p5.js code" value={codeDraft} onChange={e => setCodeDraft(e.target.value)} /><button className="alternative-button" onClick={async () => { if (generated.code === codeDraft) await prepare(codeDraft); else setGenerated({ ...generated, code: codeDraft }); setRenderRevision(r => r + 1); }}>Run edited code<Icon name="play" size={14} /></button>{runtimeError && <div className="runtime-error" role="alert">{runtimeError}<button disabled={busy} onClick={() => generationMode === "compose" ? composeSketch(true) : generateCode(true)}>Fix with AI</button></div>}<p className="chosen-feature-description">{generated.explanation}</p><button className="primary-button" disabled={busy} onClick={() => generationMode === "compose" ? composeSketch() : generateCode()}>{generationMode === "compose" ? "Recompose sketch" : "Regenerate from rules"}<Icon name="spark" size={16} /></button><button className="copy-button" onClick={() => downloadFile(`${generated.title}.js`, codeDraft)}>Download p5.js code<Icon name="download" size={14} /></button><button className="copy-button" onClick={async () => { try { await navigator.clipboard.writeText(codeDraft); setToast("p5.js 코드를 복사했습니다."); } catch { setError("클립보드에 접근하지 못했습니다. 다운로드를 이용해주세요."); } }}>Copy code<Icon name="copy" size={14} /></button></>}</>}
          {stage === "brush" && <><div className="section-kicker">FROM FEATURE TO GESTURE</div><h2>A little logic.<br />A living brush.</h2><p className="section-description">Generate a drawing tool from your visual ingredients.</p><div className="brush-origin"><span>PRIMARY FEATURE</span><strong>{chosen?.label || "All sketch features"}</strong></div>{features.length > 0 && <div className="brush-blend"><span className="brush-section-label">BLEND FEATURES</span><div>{features.filter(f => f.id !== selected).map(f => <button key={f.id} className={blend.includes(f.id) ? "active" : ""} aria-pressed={blend.includes(f.id)} onClick={() => setBlend(b => b.includes(f.id) ? b.filter(id => id !== f.id) : [...b, f.id])}><span>{blend.includes(f.id) ? "✓" : "+"}</span>{f.label}</button>)}</div></div>}<div className="sample-paths">{["curve", "wave", "line"].map(path => <button key={path} className={gesture === path ? "active" : ""} disabled={!brush} onClick={() => applyGesture(path)}>{path}</button>)}</div>{savedBrushes.length > 0 && <div className="saved-brush-library"><span className="eyebrow">BRUSH LIBRARY</span><div>{savedBrushes.map((item, i) => <button key={i} onClick={() => { setBrush(structuredClone(item)); applyGesture(gesture, item); }}>{item.name}</button>)}</div></div>}<label className="refinement-input brush-description-input"><span>BRUSH DESCRIPTION <small>optional</small></span><textarea aria-label="Brush description" placeholder="예: 작은 파란 잎이 성기게 반복되고, 끝으로 갈수록 가늘어지는 브러시" value={brushDescription} maxLength={2000} rows={4} onChange={e => setBrushDescription(e.target.value)} /><span className="brush-description-help">원하는 모양·색상·반복 방식을 설명하면 선택한 특징과 함께 반영됩니다.</span></label><button className="alternative-button" disabled={busy || !features.length} onClick={() => generateBrush(Boolean(brush))}><Icon name="spark" size={15} />{brush ? "Generate another brush" : "Generate brush"}</button>{brush && <><p className="chosen-feature-description">{brush.description}</p><div className="brush-controls-heading"><span className="brush-section-label">SHAPE THE BRUSH</span><strong>{brush.name}</strong></div><div className="brush-controls">{([{ key: "spacing", label: "Spacing", min: 5, max: 80, unit: "px" }, { key: "size", label: "Size", min: 8, max: 100, unit: "px" }, { key: "spread", label: "Spread", min: 0, max: 90, unit: "°" }, { key: "variation", label: "Variation", min: 0, max: 80, unit: "%" }, { key: "taper", label: "Taper", min: 0, max: 100, unit: "%" }] as const).map(control => <label className="brush-control" key={control.key}><span><strong>{control.label}</strong><output>{Math.round(brush.settings[control.key])}{control.unit}</output></span><input aria-label={`Brush ${control.label.toLowerCase()}`} type="range" min={control.min} max={control.max} value={brush.settings[control.key]} onChange={e => setBrush(b => b ? { ...b, settings: { ...b.settings, [control.key]: +e.target.value } } : b)} /></label>)}<label className="brush-palette">Ink color<input aria-label="Brush ink color" type="color" value={brush.settings.color} onChange={e => setBrush(b => b ? { ...b, settings: { ...b.settings, color: e.target.value } } : b)} /></label></div><button className="primary-button" onClick={() => useBrush()}>Use on sketch<Icon name="brush" size={16} /></button><button className="alternative-button" onClick={saveBrush}>Save brush<Icon name="plus" size={15} /></button><button className="copy-button" onClick={() => downloadFile(`${brush.name}.json`, JSON.stringify(brush, null, 2), "application/json")}>Download brush recipe<Icon name="download" size={14} /></button><button className="copy-button" onClick={() => downloadFile(`${brush.name}.js`, brushCode(brush))}>Download p5.js brush<Icon name="code" size={14} /></button></>}</>}
          {features.length > 0 && stage !== "brush" && <label className="refinement-input"><span>YOUR DIRECTION <small>optional</small></span><textarea aria-label="Generation direction" placeholder="예: 더 유기적으로, 반복은 적게, 파란색으로…" value={instruction} maxLength={2000} onChange={e => setInstruction(e.target.value)} /></label>}
        </div><div className="inspector-footer"><span className="tiny-dot" />Built for exploration, not perfection.</div></aside>
    </div>{toast && <div className="toast" role="status"><Icon name="spark" size={17} /><span>{toast}</span><button aria-label="Dismiss notification" onClick={() => setToast("")}><Icon name="close" size={15} /></button></div>}
    {exportOpen && <div className="modal-backdrop" onClick={() => setExportOpen(false)}><div className="modal project-export-modal" role="dialog" aria-modal="true" aria-labelledby="export-title" onClick={e => e.stopPropagation()}><button className="modal-close" aria-label="Close export dialog" onClick={() => setExportOpen(false)}><Icon name="close" /></button><div className="section-kicker">KEEP YOUR EXPLORATION</div><h2 id="export-title">Take your project with you.</h2><p>스케치·사진·특징·규칙·코드·브러시가 함께 저장됩니다. JSON 파일로 다운로드하거나 복사할 수 있어요.</p><textarea aria-label="Exported project JSON" className="project-json-preview" readOnly value={JSON.stringify(projectData(), null, 2)} /><button className="primary-button" onClick={() => downloadFile(`${artwork.name}.rulegen.json`, JSON.stringify(projectData(), null, 2), "application/json")}>Download project JSON<Icon name="download" /></button><button className="alternative-button" onClick={async () => { try { await navigator.clipboard.writeText(JSON.stringify(projectData(), null, 2)); setToast("프로젝트 JSON을 복사했습니다."); } catch { setError("JSON 내용을 선택해 복사하거나 다운로드해주세요."); } }}>Copy project JSON<Icon name="copy" size={15} /></button></div></div>}
    {modal && <div className="modal-backdrop" onClick={() => setModal(false)}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="new-title" onClick={e => e.stopPropagation()}><button className="modal-close" aria-label="Close dialog" onClick={() => setModal(false)}><Icon name="close" /></button><div className="section-kicker">A FRESH PERSPECTIVE</div><h2 id="new-title">What will you explore?</h2><p>새 탐색을 시작하면 현재 로컬 초안이 교체됩니다. JSON으로 내보내면 언제든 다시 열 수 있어요.</p><label>Exploration name<input autoFocus value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === "Enter" && newProject()} /></label><button className="primary-button" onClick={newProject}>Start exploring<Icon name="arrow" /></button></div></div>}
  </div>;
}
