import { useEffect, useMemo, useState } from "react";
import { CodePreview } from "./code-preview";
import { exploreProgram, previewKeys } from "../lib/explore";
import { prepareProgram } from "../lib/prepared";
import type { Recommendation, RecommendationPreview as Preview } from "../lib/inspection";
import type { Scene } from "../lib/scene/schema";

type Props = {
  /** The frame's program (live values) and scene. */
  code: string; scene: Scene;
  /** The held step's runtime: the brush marks the preview is drawn on. */
  runtime: unknown;
  recommendation: Pick<Recommendation, "kind" | "changes">; preview: Preview | null | undefined;
};

/**
 * A recommendation's quick visual preview in the inspection panel: the brush marks of the
 * held step drawn by a copy of the program with the preview's edits (or, for a value
 * recommendation, with its values). Nothing is applied.
 */
export function RecommendationPreview({ code, scene, runtime, recommendation, preview }: Props) {
  const value = recommendation.kind === "value";
  const program = useMemo(() => value ? { code } : preview ? exploreProgram(code, scene, preview) : null, [value, code, scene, preview]);
  const params = useMemo(() => value ? Object.fromEntries(recommendation.changes.filter(change => !change.stateId).map(change => [change.key, change.value]))
    : Object.fromEntries((preview?.values ?? []).flatMap(item => previewKeys(scene, item).map(key => [key, item.value.value]))), [value, recommendation.changes, preview, scene]);
  const [executable, setExecutable] = useState(""), [error, setError] = useState("");
  const source = program && "code" in program ? program.code : "";
  useEffect(() => {
    if (!source) return;
    let live = true; setExecutable(""); setError("");
    prepareProgram(source).then(prepared => { if (live) setExecutable(prepared); }, failure => { if (live) setError(failure instanceof Error ? failure.message : "미리보기를 실행하지 못했습니다."); });
    return () => { live = false; };
  }, [source]);
  const restoreId = useMemo(() => `preview:${source.length}:${JSON.stringify(params)}`, [source, params]);
  if (!program) return null;
  return <figure className="recommendation-preview">
    <div className="recommendation-preview-view">
      {"error" in program || error ? <span className="recommendation-preview-status">미리보기를 그리지 못했습니다{"error" in program ? `: ${program.error}` : ""}</span>
        : executable ? <div className="recommendation-preview-stage"><CodePreview executable={executable} onError={setError} restore={{ id: restoreId, runtime, params }} /></div>
        : <span className="recommendation-preview-status"><span className="loading-spinner" />미리보기 준비 중…</span>}
    </div>
    <figcaption><b>PREVIEW</b>{preview?.caption || (value ? "이 값으로 그린 모습" : "")}</figcaption>
  </figure>;
}
