import { useEffect, useState } from "react";
import { Icon } from "./icons";
import { recoveredGenerationSchema, type RecoveredGeneration } from "../lib/generation-recovery";
import { downloadFile } from "../lib/project";

type Entry = { key: string; intent: string; model: string; startedAt: string; status: string; durationMs?: number };
const labels: Record<string, string> = { extract: "Brush stamp 추출", transform: "Transformation 재생성", code: "코드", compose: "스케치 조합", "compose-prompt": "조합 prompt", clarification: "설명 초안", revision: "변경 제안", "state-machine": "노드 상태와 전이", "machine-refine": "상태 머신 다듬기", inspect: "Targeted inspection" };
async function getHistory(query = "", signal?: AbortSignal) {
  const response = await fetch(`/api/generations${query}`, { signal });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error || "AI 로그를 불러오지 못했습니다.");
  return data;
}
export function GenerationHistory({ onClose, onRestore, disabled }: { onClose: () => void; onRestore: (data: RecoveredGeneration) => void; disabled: boolean }) {
  const [entries, setEntries] = useState<Entry[]>([]), [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<Entry | null>(null), [details, setDetails] = useState<unknown>(null);
  const [loading, setLoading] = useState(false), [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError("");
    getHistory("", controller.signal).then(data => { setEntries(data.entries); setCursor(data.nextCursor); }).catch(error => { if (!controller.signal.aborted) setError(error.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [refresh]);
  useEffect(() => {
    setDetails(null); if (!selected) return;
    const controller = new AbortController();
    getHistory(`?key=${encodeURIComponent(selected.key)}`, controller.signal).then(setDetails).catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [selected]);
  async function restore() {
    if (!selected) return; setLoading(true); setError("");
    try { const data = recoveredGenerationSchema.parse(await getHistory(`?key=${encodeURIComponent(selected.key)}&restore=1`)); onRestore(data); }
    catch (error) { setError(error instanceof Error ? error.message : "복원하지 못했습니다."); }
    finally { setLoading(false); }
  }
  async function more() {
    if (!cursor) return; setLoading(true); setError("");
    try { const data = await getHistory(`?cursor=${encodeURIComponent(cursor)}`); setEntries(current => [...current, ...data.entries]); setCursor(data.nextCursor); }
    catch (error) { setError(error instanceof Error ? error.message : "로그를 불러오지 못했습니다."); }
    finally { setLoading(false); }
  }
  return <div className="modal-backdrop" onClick={onClose}><div className="modal generation-history-modal" role="dialog" aria-modal="true" aria-labelledby="generation-history-title" onClick={event => event.stopPropagation()}>
    <button className="modal-close" aria-label="Close AI history" onClick={onClose}><Icon name="close" /></button>
    <div className="section-kicker">AI GENERATION HISTORY</div><h2 id="generation-history-title">AI 기록과 복원</h2>
    <p>각 AI 생성의 입력·응답·결과가 서버 폴더에 저장됩니다. 복원하면 현재 초안을 해당 생성 시점의 프로젝트로 교체합니다. 필요한 초안은 먼저 Export project로 보관해주세요.</p>
    <button className="text-button" disabled={loading} onClick={() => { setSelected(null); setRefresh(value => value + 1); }}>새로고침</button>
    {error && <p role="alert" className="runtime-error">{error}</p>}
    <div className="generation-history-grid"><div className="generation-history-list" aria-label="AI generation logs">
      {!entries.length && <p role="status">{loading ? "로그를 불러오는 중…" : "아직 저장된 AI 생성이 없습니다."}</p>}
      {entries.map(entry => <button key={entry.key} className={selected?.key === entry.key ? "active" : ""} aria-pressed={selected?.key === entry.key} onClick={() => { setSelected(entry); setError(""); }}><strong>{labels[entry.intent] || entry.intent}</strong><span>{new Date(entry.startedAt).toLocaleString()} · {entry.status}</span><small>{entry.model}</small></button>)}
      {cursor && <button disabled={loading} onClick={() => { void more(); }}>이전 기록 더 보기</button>}
    </div><div className="generation-history-details">
      {selected ? <><code>{selected.key}</code><textarea readOnly aria-label="AI generation log details" value={details ? JSON.stringify(details, null, 2) : "로그를 불러오는 중…"} />
        <button className="primary-button" disabled={disabled || loading || selected.status !== "success" || !details} onClick={() => { void restore(); }}>이 생성 복원하기<Icon name="undo" size={15} /></button>
        <button className="copy-button" disabled={!details} onClick={() => downloadFile(`${selected.intent}-log.json`, JSON.stringify(details, null, 2), "application/json")}>결과 로그 다운로드<Icon name="download" size={14} /></button>
      </> : <p>기록을 선택하면 결과와 오류를 확인할 수 있습니다. 완료된 생성은 AI를 다시 호출하지 않고 복원합니다.</p>}
    </div></div>
  </div></div>;
}
