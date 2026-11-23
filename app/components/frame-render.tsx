import { useEffect, useRef, type ReactNode } from "react";
import { CodePreview, type CodePreviewHandle, type ExecutionRun, type RestorePoint, type TraceStep } from "./code-preview";
import { ResultAnnotations } from "./result-annotations";
import { liveSceneSource } from "../lib/scene/live";
import { syncScene, withBlockParams } from "../lib/scene/machines";
import { annotationHistoryReducer } from "../lib/annotation-history";
import { clearedResultAnnotations, type SketchPanel } from "../lib/sketch-panels";
import { markLogged } from "../lib/error-report";
import { preparedFor, rememberPrepared } from "../lib/prepared";

type Patch = Partial<SketchPanel> | ((panel: SketchPanel) => Partial<SketchPanel>);
type Props = { owner: string; panel: SketchPanel; interacting?: boolean;
  /** Show the running result itself (not its last capture) without taking input: a brush gesture is being fed to it. */
  live?: boolean;
  onEscape?: () => void; tracing?: boolean; onTrace?: (step: TraceStep) => void; onCycle?: (cycle: unknown) => void;
  /** Drawn over the result (the execution overlay). */ overlay?: ReactNode;
  /** Extra host values pushed into the running result live (a temporary fork's demonstration values, m.demo). */ hostValues?: Record<string, unknown>; restore?: RestorePoint; onDrawn?: (restoreId: string, stores: Record<string, unknown>, run?: ExecutionRun) => void; documentRevision: number; onPatch: (patch: Patch) => void; onPreview: (preview: CodePreviewHandle | null) => void };

/**
 * The generated result of a sketch frame, rendered *inside* that frame beneath
 * its strokes and layer boxes. Widget edits and layer moves update it in place.
 */
export function FrameRender(props: Props) {
  const current = useRef(props); current.current = props;
  const { panel, owner } = props;
  const source = liveSceneSource(panel.generated, panel.scene);
  // Widget edits patch only the host block, so the prepared executable is reused.
  const synced = panel.generated && panel.executable ? syncScene(panel.executable, panel.scene) : "";
  const executable = synced && props.hostValues && Object.keys(props.hostValues).length ? withBlockParams(synced, props.hostValues) ?? synced : synced;
  const machineEnabled = Boolean(panel.generated?.machineSignature && panel.generated.machineSignature !== "[]");
  useEffect(() => {
    const code = panel.generated?.code;
    if (!code || (panel.preparedCode === code && panel.executable)) return;
    // Prepared ahead (a brush about to be added) or before: no server round trip.
    const ready = preparedFor(code);
    if (ready) { props.onPatch({ executable: ready, preparedCode: code, runtimeError: "" }); return; }
    const controller = new AbortController();
    // The previous executable keeps rendering until the new program is ready.
    props.onPatch({ runtimeError: "" });
    void fetch("/api/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ intent: "prepare", code }), signal: controller.signal })
      .then(async response => { const result = await response.json(); if (!response.ok || result.error) { if (result.logged) markLogged(result.error); throw new Error(result.error || "Couldn't run the code."); } return result; })
      .then(result => { rememberPrepared(code, result.executable); if (!controller.signal.aborted) current.current.onPatch({ executable: result.executable, preparedCode: code }); })
      .catch(error => { if (!controller.signal.aborted) current.current.onPatch({ runtimeError: error instanceof Error ? error.message : "Couldn't run the code." }); });
    return () => controller.abort();
  }, [panel.generated?.code, panel.preparedCode, props.documentRevision]);
  useEffect(() => {
    if (panel.annotationImage && (panel.annotationSource !== source || panel.annotationRenderRevision !== panel.renderRevision)) props.onPatch(clearedResultAnnotations());
  }, [source, panel.annotationImage, panel.renderRevision]);
  if (!panel.generated) return panel.pendingResult ? <div className="frame-render frame-render-status" role="status"><span className="loading-spinner" /><strong>Generating this frame's result…</strong><span>{panel.loading}</span></div> : null;
  return <div className={`frame-render ${panel.pendingResult ? "frame-render-updating" : ""}`} data-render-owner={owner}>
    {executable ? <CodePreview ref={props.onPreview} key={`${props.documentRevision}-${owner}-${panel.renderRevision}`} executable={executable} onError={error => props.onPatch({ runtimeError: error })}
      machineEnabled={machineEnabled} visible={props.live} onEscape={props.onEscape} interactive={props.interacting} tracing={props.tracing} onTrace={props.onTrace} onCycle={props.onCycle} restore={props.restore} seed={panel.seed} onDrawn={props.onDrawn} jump={panel.stateJump} playing={panel.machinePlaying} onStatesChange={states => props.onPatch({ runtimeStates: states })} />
      : <div className="frame-render-status"><strong>{panel.runtimeError ? "This code needs a correction." : "Preparing p5.js…"}</strong></div>}
    {executable && props.overlay}
    {panel.pendingResult && <div className="frame-render-badge" role="status"><span className="loading-spinner" />Updating…</div>}
  </div>;
}

/** Annotation sketching over a frame's rendered result (feedback for AI revisions). */
export function FrameAnnotations({ panel, tool, zoom, onPatch }: { panel: SketchPanel; tool: string; zoom: number; onPatch: (patch: Patch) => void }) {
  if (!panel.annotating || !panel.annotationImage) return null;
  return <div className="frame-annotations">
    <img className="annotation-snapshot" src={panel.annotationImage} alt="Generated result captured for annotation" />
    <ResultAnnotations annotations={panel.annotationHistory.present} zoom={zoom} tool={tool} disabled={Boolean(panel.loading)}
      onErase={ids => onPatch(previous => ({ annotationHistory: annotationHistoryReducer(previous.annotationHistory, { type: "remove", ids }) }))}
      onAdd={points => onPatch(previous => ({ annotationHistory: annotationHistoryReducer(previous.annotationHistory, { type: "add", annotation: { id: crypto.randomUUID(), points } }) }))} />
  </div>;
}
