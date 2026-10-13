import { useEffect, useRef } from "react";
import { CodePreview, type CodePreviewHandle } from "./code-preview";
import { ResultAnnotations } from "./result-annotations";
import { liveSceneSource } from "../lib/scene/live";
import { syncScene } from "../lib/scene/machines";
import { annotationHistoryReducer } from "../lib/annotation-history";
import { clearedResultAnnotations, type SketchPanel } from "../lib/sketch-panels";
import { markLogged } from "../lib/error-report";

type Patch = Partial<SketchPanel> | ((panel: SketchPanel) => Partial<SketchPanel>);
type Props = { owner: string; panel: SketchPanel; documentRevision: number; onPatch: (patch: Patch) => void; onPreview: (preview: CodePreviewHandle | null) => void };

/**
 * The generated result of a sketch frame, rendered *inside* that frame beneath
 * its strokes and layer boxes. Widget edits and layer moves update it in place.
 */
export function FrameRender(props: Props) {
  const current = useRef(props); current.current = props;
  const { panel, owner } = props;
  const source = liveSceneSource(panel.generated, panel.scene);
  // Widget edits patch only the host block, so the prepared executable is reused.
  const executable = panel.generated && panel.executable ? syncScene(panel.executable, panel.scene) : "";
  const machineEnabled = Boolean(panel.generated?.machineSignature && panel.generated.machineSignature !== "[]");
  useEffect(() => {
    const code = panel.generated?.code;
    if (!code || (panel.preparedCode === code && panel.executable)) return;
    const controller = new AbortController();
    // The previous executable keeps rendering until the new program is ready.
    props.onPatch({ runtimeError: "" });
    void fetch("/api/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ intent: "prepare", code }), signal: controller.signal })
      .then(async response => { const result = await response.json(); if (!response.ok || result.error) { if (result.logged) markLogged(result.error); throw new Error(result.error || "코드를 실행하지 못했습니다."); } return result; })
      .then(result => { if (!controller.signal.aborted) current.current.onPatch({ executable: result.executable, preparedCode: code }); })
      .catch(error => { if (!controller.signal.aborted) current.current.onPatch({ runtimeError: error instanceof Error ? error.message : "코드를 실행하지 못했습니다." }); });
    return () => controller.abort();
  }, [panel.generated?.code, panel.preparedCode, props.documentRevision]);
  useEffect(() => {
    if (panel.annotationImage && (panel.annotationSource !== source || panel.annotationRenderRevision !== panel.renderRevision)) props.onPatch(clearedResultAnnotations());
  }, [source, panel.annotationImage, panel.renderRevision]);
  if (!panel.generated) return panel.pendingResult ? <div className="frame-render frame-render-status" role="status"><span className="loading-spinner" /><strong>Generating this frame's result…</strong><span>{panel.loading}</span></div> : null;
  return <div className={`frame-render ${panel.pendingResult ? "frame-render-updating" : ""}`} data-render-owner={owner}>
    {executable ? <CodePreview ref={props.onPreview} key={`${props.documentRevision}-${owner}-${panel.renderRevision}`} executable={executable} onError={error => props.onPatch({ runtimeError: error })}
      machineEnabled={machineEnabled} jump={panel.stateJump} playing={panel.machinePlaying} onStatesChange={states => props.onPatch({ runtimeStates: states })} />
      : <div className="frame-render-status"><strong>{panel.runtimeError ? "This code needs a correction." : "Preparing p5.js…"}</strong></div>}
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
