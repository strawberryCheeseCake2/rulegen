import { useState } from "react";
import type { NumberValue, ScalarValue } from "../../lib/scene/schema";

export function NumberWidget({ value: v, label, onChange }: { value: Pick<NumberValue, "value" | "min" | "max" | "step" | "unit">; label: string; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => { if (draft !== null && draft.trim() !== "" && Number.isFinite(Number(draft))) onChange(Number(draft)); setDraft(null); };
  return <div className="number-widget"><input type="range" aria-label={label} min={v.min} max={v.max} step={v.step} value={v.value} onChange={e => { setDraft(null); onChange(e.currentTarget.valueAsNumber); }} /><div><input type="number" aria-label={`${label} value`} min={v.min} max={v.max} step={v.step} value={draft ?? v.value} onFocus={() => setDraft(String(v.value))} onChange={e => { const value = e.target.value; setDraft(value); const number = Number(value); if (value.trim() && Number.isFinite(number) && number >= v.min && number <= v.max) onChange(number); }} onBlur={commit} onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { setDraft(null); e.preventDefault(); } }} /><span>{v.unit}</span></div></div>;
}

/** Slider, color picker, select or switch for one scalar. */
export function ScalarWidget({ value, label, onChange }: { value: ScalarValue; label: string; onChange: (value: ScalarValue["value"]) => void }) {
  if (value.type === "number") return <NumberWidget value={value} label={label} onChange={onChange} />;
  if (value.type === "color") return <label className="color-widget"><input type="color" aria-label={label} value={value.value} onChange={e => onChange(e.target.value)} /><span>{value.value.toUpperCase()}</span></label>;
  if (value.type === "select") return <select aria-label={label} value={value.value} onChange={e => onChange(e.target.value)}>{value.options.map(option => <option key={option} value={option}>{option}</option>)}</select>;
  return <button type="button" role="switch" aria-label={label} aria-checked={value.value} className={`parameter-switch ${value.value ? "on" : ""}`} onClick={() => onChange(!value.value)}><span /></button>;
}
