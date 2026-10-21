import { useEffect, useRef } from "react";
import { CodePreview, type CodePreviewHandle } from "./code-preview";
import { syncScene } from "../lib/scene/machines";
import type { SketchPanel } from "../lib/sketch-panels";
import { markLogged } from "../lib/error-report";
import { preparedFor, rememberPrepared } from "../lib/prepared";

type Patch = Partial<SketchPanel> | ((panel: SketchPanel) => Partial<SketchPanel>);
type Props = { owner: string; panel: SketchPanel; interacting?: boolean;
  onEscape?: () => void; documentRevision: number; onPatch: (patch: Patch) => void; onPreview: (preview: CodePreviewHandle | null) => void };

/**
 * The generated result of a sketch frame, rendered *inside* that frame beneath
 * its strokes and layer boxes. Widget edits and layer moves update it in place.
 */
export function FrameRender(props: Props) {
  const current = useRef(props); current.current = props;
  const { panel, owner } = props;
  // Widget edits patch only the host block, so the prepared executable is reused.
  const executable = panel.generated && panel.executable ? syncScene(panel.executable, panel.scene) : "";
  const machineEnabled = Boolean(panel.generated?.machineSignature && panel.generated.machineSignature !== "[]");
  useEffect(() => {
    const code = panel.generated?.code;
    if (!code || (panel.preparedCode === code && panel.executable)) return;
    // Prepared before: no server round trip.
    const ready = preparedFor(code);
    if (ready) { props.onPatch({ executable: ready, preparedCode: code, runtimeError: "" }); return; }
    const controller = new AbortController();
    // The previous executable keeps rendering until the new program is ready.
    props.onPatch({ runtimeError: "" });
    void fetch("/api/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ intent: "prepare", code }), signal: controller.signal })
      .then(async response => { const result = await response.json(); if (!response.ok || result.error) { if (result.logged) markLogged(result.error); throw new Error(result.error || "코드를 실행하지 못했습니다."); } return result; })
      .then(result => { rememberPrepared(code, result.executable); if (!controller.signal.aborted) current.current.onPatch({ executable: result.executable, preparedCode: code }); })
      .catch(error => { if (!controller.signal.aborted) current.current.onPatch({ runtimeError: error instanceof Error ? error.message : "코드를 실행하지 못했습니다." }); });
    return () => controller.abort();
  }, [panel.generated?.code, panel.preparedCode, props.documentRevision]);
  if (!panel.generated) return panel.pendingResult ? <div className="frame-render frame-render-status" role="status"><span className="loading-spinner" /><strong>Generating this frame's result…</strong><span>{panel.loading}</span></div> : null;
  return <div className={`frame-render ${panel.pendingResult ? "frame-render-updating" : ""}`} data-render-owner={owner}>
    {executable ? <CodePreview ref={props.onPreview} key={`${props.documentRevision}-${owner}-${panel.renderRevision}`} executable={executable} onError={error => props.onPatch({ runtimeError: error })}
      machineEnabled={machineEnabled} onEscape={props.onEscape} interactive={props.interacting} jump={panel.stateJump} playing={panel.machinePlaying} onStatesChange={states => props.onPatch({ runtimeStates: states })} />
      : <div className="frame-render-status"><strong>{panel.runtimeError ? "This code needs a correction." : "Preparing p5.js…"}</strong></div>}
    {panel.pendingResult && <div className="frame-render-badge" role="status"><span className="loading-spinner" />Updating…</div>}
  </div>;
}
