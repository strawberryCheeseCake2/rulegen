import { useEffect, useMemo, useState } from "react";
import { CodePreview } from "./code-preview";
import { InspectionOverlay } from "./inspection-overlay";
import { exploreProgram, previewKey, previewKeys } from "../lib/explore";
import { prepareProgram } from "../lib/prepared";
import { previewMarkOverlay, type InspectionState, type InspectResult, type Recommendation, type RecommendationPreview as Preview, type Scalar } from "../lib/inspection";
import type { ScalarValue, Scene } from "../lib/scene/schema";

type Props = {
  /** The frame's program (live values) and scene. */
  code: string; scene: Scene;
  /** The held step's runtime: the brush marks the preview is drawn on; and its values (what the marks' expressions read). */
  runtime: unknown; values?: Record<string, Scalar>;
  recommendation: Pick<Recommendation, "kind" | "changes" | "nodeId">; preview: Pick<Preview, "edits" | "values"> & { caption?: string; marks?: Preview["marks"]; handles?: Preview["handles"]; machine?: Preview["machine"] } | null | undefined;
  /** Values changed with the preview's handles (the preview is drawn with them), and changing one (null: back); without it the handles are not shown. */
  adjusted?: Record<string, Scalar>; onAdjust?: (key: string, value: Scalar | null) => void;
  /** The spec (range, step) of each brush value a handle may change. */
  specs?: Record<string, ScalarValue>;
  /** Drawn at the frame's full size (a fork slot) instead of as a thumbnail. */
  large?: boolean; zoom?: number;
  /** Hide the marks of what changes (e.g. while the preview is being edited by hand). */
  plain?: boolean;
  /** Every picture the preview shows, and the stores as it draws the held step (what can be picked in it). */
  onCapture?: (image: string) => void; onDrawn?: (stores: Record<string, unknown>) => void;
};

/**
 * A recommendation's quick visual preview in the inspection panel: the brush marks of the
 * held step drawn by a copy of the program with the preview's edits (or, for a value
 * recommendation, with its values), with simple marks of what changes. Nothing is applied.
 */
export function RecommendationPreview({ code, scene, runtime, values, recommendation, preview, large, zoom, plain, adjusted, onAdjust, specs, onCapture, onDrawn }: Props) {
  const value = recommendation.kind === "value";
  const program = useMemo(() => value ? { code } : preview ? exploreProgram(code, scene, preview) : null, [value, code, scene, preview]);
  const params = useMemo(() => value ? Object.fromEntries(recommendation.changes.filter(change => !change.stateId).map(change => [change.key, change.value]))
    : Object.fromEntries([...(preview?.values ?? []).flatMap(item => previewKeys(scene, item).map(key => [key, item.value.value])),
      // A handle dragged: a value the preview brings is drawn on every stamp of the brush, a brush value as it is.
      ...Object.entries(adjusted ?? {}).flatMap(([key, to]) => { const item = preview?.values.find(entry => previewKey(entry) === key); return item ? previewKeys(scene, item).map(each => [each, to]) : [[key, to]]; })]),
    [value, recommendation.changes, preview, scene, adjusted]);
  const [executable, setExecutable] = useState(""), [error, setError] = useState("");
  const source = program && "code" in program ? program.code : "";
  useEffect(() => {
    if (!source) return;
    let live = true; setExecutable(""); setError("");
    prepareProgram(source).then(prepared => { if (live) setExecutable(prepared); }, failure => { if (live) setError(failure instanceof Error ? failure.message : "미리보기를 실행하지 못했습니다."); });
    return () => { live = false; };
  }, [source]);
  const restoreId = useMemo(() => `preview:${source.length}:${JSON.stringify(params)}`, [source, params]);
  // The stores as the preview draws the held step: its marks read them.
  const [drawn, setDrawn] = useState<{ restore: string; stores: Record<string, unknown> } | null>(null);
  const marks = preview?.marks ?? [];
  const handles = onAdjust ? preview?.handles ?? [] : [];
  const overlays = plain ? [] : [...marks.map(mark => previewMarkOverlay(mark, recommendation.nodeId)), ...handles];
  const shown: InspectResult | null = overlays.length ? { summary: "", overlays: overlays as InspectResult["overlays"], valueFixes: [], recommendations: [], parameters: [], records: null } : null;
  const state: InspectionState = { brushId: "", cursor: 0, marks: [], markStyles: [], concern: "", focus: null,
    steps: [{ id: 1, at: 0, nodeId: null, from: null, to: null, transitionId: null, values: { ...values, ...params, ...Object.fromEntries((preview?.values ?? []).map(item => [previewKey(item), item.value.value])), ...adjusted }, runtime }] };
  const allSpecs: Record<string, ScalarValue> = { ...specs, ...Object.fromEntries((preview?.values ?? []).map(item => [previewKey(item), item.value])) };
  if (!program) return null;
  return <figure className={`recommendation-preview ${large ? "large" : ""}`}>
    <div className="recommendation-preview-view">
      {"error" in program || error ? <span className="recommendation-preview-status">미리보기를 그리지 못했습니다{"error" in program ? `: ${program.error}` : ""}</span>
        : executable ? <div className="recommendation-preview-stage"><CodePreview executable={executable} onError={setError} restore={{ id: restoreId, runtime, params }} onCapture={onCapture}
            onDrawn={(restore, stores) => { setDrawn({ restore, stores }); onDrawn?.(stores); }} />
          {shown && drawn?.restore === restoreId && <InspectionOverlay state={state} marks={[]} result={shown} drawn={drawn.stores} liveValues={{}} clickable={handles.length > 0} focusable={false} zoom={zoom ?? (large ? 1 : 240 / 900)} onFocus={() => {}} plain specs={allSpecs}
            onHandle={(phase, key, to) => { if (phase !== "start" && to !== null && typeof to !== "string") onAdjust?.(key, to); }} />}</div>
        : <span className="recommendation-preview-status"><span className="loading-spinner" />미리보기 준비 중…</span>}
    </div>
    <figcaption><b>PREVIEW</b>{preview?.caption || (value ? "이 값으로 그린 모습" : "")}{shown ? <i className="recommendation-preview-legend">{marks.map(mark => mark.name || mark.label).filter(Boolean).slice(0, 3).join(" · ")}</i> : null}</figcaption>
  </figure>;
}
