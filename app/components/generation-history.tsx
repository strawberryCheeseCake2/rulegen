import { useEffect, useState } from "react";
import { Icon } from "./icons";
import { recoveredGenerationSchema, type RecoveredGeneration } from "../lib/generation-recovery";
import { downloadFile } from "../lib/project";

type Entry = { key: string; intent: string; model: string; startedAt: string; status: string; durationMs?: number };
const labels: Record<string, string> = { extract: "Brush stamp extraction", transform: "Constraint regeneration", code: "Code", compose: "Sketch composition", "compose-prompt": "Compose prompt", "tag-revise": "Tag change", clarification: "Description draft", revision: "Change proposal", "state-machine": "Node states and transitions", "machine-refine": "State machine refinement", handles: "Direct manipulation handle" };
async function getHistory(query = "", signal?: AbortSignal) {
  const response = await fetch(`/api/generations${query}`, { signal });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error || "Couldn't load the AI logs.");
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
    catch (error) { setError(error instanceof Error ? error.message : "Couldn't restore."); }
    finally { setLoading(false); }
  }
  async function more() {
    if (!cursor) return; setLoading(true); setError("");
    try { const data = await getHistory(`?cursor=${encodeURIComponent(cursor)}`); setEntries(current => [...current, ...data.entries]); setCursor(data.nextCursor); }
    catch (error) { setError(error instanceof Error ? error.message : "Couldn't load the log."); }
    finally { setLoading(false); }
  }
  return <div className="modal-backdrop" onClick={onClose}><div className="modal generation-history-modal" role="dialog" aria-modal="true" aria-labelledby="generation-history-title" onClick={event => event.stopPropagation()}>
    <button className="modal-close" aria-label="Close AI history" onClick={onClose}><Icon name="close" /></button>
    <div className="section-kicker">AI GENERATION HISTORY</div><h2 id="generation-history-title">AI history and restore</h2>
    <p>The input, response, and result of each AI generation are saved to a server folder. Restoring replaces the current draft with the project as it was at that generation. Keep any draft you need with Export project first.</p>
    <button className="text-button" disabled={loading} onClick={() => { setSelected(null); setRefresh(value => value + 1); }}>Refresh</button>
    {error && <p role="alert" className="runtime-error">{error}</p>}
    <div className="generation-history-grid"><div className="generation-history-list" aria-label="AI generation logs">
      {!entries.length && <p role="status">{loading ? "Loading logs…" : "No saved AI generations yet."}</p>}
      {entries.map(entry => <button key={entry.key} className={selected?.key === entry.key ? "active" : ""} aria-pressed={selected?.key === entry.key} onClick={() => { setSelected(entry); setError(""); }}><strong>{labels[entry.intent] || entry.intent}</strong><span>{new Date(entry.startedAt).toLocaleString()} · {entry.status}</span><small>{entry.model}</small></button>)}
      {cursor && <button disabled={loading} onClick={() => { void more(); }}>Show older entries</button>}
    </div><div className="generation-history-details">
      {selected ? <><code>{selected.key}</code><textarea readOnly aria-label="AI generation log details" value={details ? JSON.stringify(details, null, 2) : "Loading logs…"} />
        <button className="primary-button" disabled={disabled || loading || selected.status !== "success" || !details} onClick={() => { void restore(); }}>Restore this generation<Icon name="undo" size={15} /></button>
        <button className="copy-button" disabled={!details} onClick={() => downloadFile(`${selected.intent}-log.json`, JSON.stringify(details, null, 2), "application/json")}>Download result log<Icon name="download" size={14} /></button>
      </> : <p>Select an entry to see its result and errors. Completed generations are restored without calling the AI again.</p>}
    </div></div>
  </div></div>;
}
