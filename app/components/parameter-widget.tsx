import { useState } from "react";
import type { Parameter } from "../lib/schema";
export function NumberWidget({ parameter: p, label, onChange }: { parameter: Extract<Parameter, { type: "number" }>; label: string; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => { if (draft !== null && draft.trim() !== "" && Number.isFinite(Number(draft))) onChange(Number(draft)); setDraft(null); };
  return <div className="number-widget"><input type="range" aria-label={label} min={p.min} max={p.max} step={p.step} value={p.value} onChange={e => { setDraft(null); onChange(e.currentTarget.valueAsNumber); }} /><div><input type="number" aria-label={`${label} value`} min={p.min} max={p.max} step={p.step} value={draft ?? p.value} onFocus={() => setDraft(String(p.value))} onChange={e => { const value = e.target.value; setDraft(value); const number = Number(value); if (value.trim() && Number.isFinite(number) && number >= p.min && number <= p.max) onChange(number); }} onBlur={commit} onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { setDraft(null); e.preventDefault(); } }} /><span>{p.unit}</span></div></div>;
}
