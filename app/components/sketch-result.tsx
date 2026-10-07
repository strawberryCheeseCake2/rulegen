import { useEffect, useRef } from "react";
import { CodePreview, type CodePreviewHandle } from "./code-preview";
import { ResultAnnotations } from "./result-annotations";
import { Icon } from "./icons";
import { syncParameters } from "../lib/live-parameters";
import { annotationHistoryReducer } from "../lib/annotation-history";
import { clearedResultAnnotations, panelLiveGroups, type SketchPanel } from "../lib/sketch-panels";

type Props = {
  owner: string; panel: SketchPanel; tool: string; zoom: number; documentRevision: number;
  onActivate: () => void; onPatch: (patch: Partial<SketchPanel> | ((panel: SketchPanel) => Partial<SketchPanel>)) => void;
  onPreview: (preview: CodePreviewHandle | null) => void; onOpenCode: () => void; onExplore: () => void;
};
export function SketchResult(props: Props) {
  const current = useRef(props); current.current = props;
  const { panel, owner, tool, zoom } = props;
  const source = panel.generated ? syncParameters(panel.generated.code, panelLiveGroups(panel), panel.generated.bindings) : "";
  const executable = panel.generated ? syncParameters(panel.executable, panelLiveGroups(panel), panel.generated.bindings) : "";
  useEffect(() => {
    const code = panel.generated?.code;
    if (!code || (panel.preparedCode === code && panel.executable)) return;
    const controller = new AbortController();
    props.onPatch({ executable: "", runtimeError: "" });
    void fetch("/api/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ intent: "prepare", code }), signal: controller.signal })
      .then(async response => { const result = await response.json(); if (!response.ok || result.error) throw new Error(result.error || "코드를 실행하지 못했습니다."); return result; })
      .then(result => { if (!controller.signal.aborted) current.current.onPatch({ executable: result.executable, preparedCode: code }); })
      .catch(error => { if (!controller.signal.aborted) current.current.onPatch({ runtimeError: error instanceof Error ? error.message : "코드를 실행하지 못했습니다." }); });
    return () => controller.abort();
  }, [panel.generated?.code, panel.preparedCode, props.documentRevision]);
  useEffect(() => {
    if (panel.annotationImage && (panel.annotationSource !== source || panel.annotationRenderRevision !== panel.renderRevision)) props.onPatch(clearedResultAnnotations());
  }, [source, panel.annotationImage, panel.renderRevision]);
  return <div className="sketch-result-surface" data-result-owner={owner} onPointerDownCapture={props.onActivate}>
    {panel.generated ? executable ? <>
      <CodePreview ref={props.onPreview} key={`${props.documentRevision}-${owner}-${panel.renderRevision}`} code={source} executable={executable} onError={error => props.onPatch({ runtimeError: error })} />
      {panel.annotating && panel.annotationImage && <>
        <img className="annotation-snapshot" src={panel.annotationImage} alt="Generated result captured for annotation" />
        <ResultAnnotations annotations={panel.annotationHistory.present} zoom={zoom} tool={tool} disabled={Boolean(panel.loading)}
          onErase={ids => props.onPatch(previous => ({ annotationHistory: annotationHistoryReducer(previous.annotationHistory, { type: "remove", ids }) }))}
          onAdd={points => props.onPatch(previous => ({ annotationHistory: annotationHistoryReducer(previous.annotationHistory, { type: "add", annotation: { id: crypto.randomUUID(), points } }) }))} />
      </>}
    </> : <div className="frame-empty"><strong>{panel.runtimeError ? "This code needs a correction." : "Preparing p5.js…"}</strong><button onClick={props.onOpenCode}>Open code<Icon name="code" size={14} /></button></div>
      : <div className="frame-empty"><Icon name="code" size={30} /><strong>A new possibility, in its own frame.</strong><span>Your generated p5.js output will appear here.</span><button onClick={props.onExplore}>Explore constraints<Icon name="arrow" size={14} /></button></div>}
  </div>;
}
