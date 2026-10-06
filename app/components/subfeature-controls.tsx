import { useState } from "react";
import type { RuleGroup, Parameter } from "../lib/schema";
import { Icon } from "./icons";
type Props = { group: RuleGroup; name: string; busy: boolean; onMethod: (subId: string, methodId: string) => void; onParameter: (subId: string, methodId: string, parameterId: string, value: Parameter["value"]) => void; onAlternative: () => void; onRegenerate: (subId: string) => void; onMakePen: (subId: string) => void; onRemove: (subId: string, methodId?: string, parameterId?: string) => void };
export function NumberWidget({ parameter: p, label, onChange }: { parameter: Extract<Parameter, { type: "number" }>; label: string; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => { if (draft !== null && draft.trim() !== "" && Number.isFinite(Number(draft))) onChange(Number(draft)); setDraft(null); };
  return <div className="number-widget"><input type="range" aria-label={label} min={p.min} max={p.max} step={p.step} value={p.value} onChange={e => { setDraft(null); onChange(e.currentTarget.valueAsNumber); }} /><div><input type="number" aria-label={`${label} value`} min={p.min} max={p.max} step={p.step} value={draft ?? p.value} onFocus={() => setDraft(String(p.value))} onChange={e => { const value = e.target.value; setDraft(value); const number = Number(value); if (value.trim() && Number.isFinite(number) && number >= p.min && number <= p.max) onChange(number); }} onBlur={commit} onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { setDraft(null); e.preventDefault(); } }} /><span>{p.unit}</span></div></div>;
}
export function SubfeatureControls({ group, name, busy, onMethod, onParameter, onAlternative, onRegenerate, onMakePen, onRemove }: Props) {
  const legacy = group.subfeatures.every(s => s.implementations.every(m => m.id === "saved-recipe"));
  return <section className="feature-rule-group subfeature-group" aria-label={`Subfeatures for ${name}`}>
    <div className="feature-rule-group-heading"><Icon name="spark" size={18} /><div><strong>{name}</strong><span>{group.subfeatures.length} SUBFEATURES</span></div></div>
    {legacy && <div className="legacy-recipe-note">저장된 규칙을 불러왔습니다. 위젯으로 변환하면 구현 방식과 값을 직접 조절할 수 있어요.<button disabled={busy} onClick={onAlternative}>Create parameter widgets<Icon name="spark" size={13} /></button></div>}
    <fieldset disabled={busy} className="subfeature-list">{group.subfeatures.map((sub, i) => {
      const method = sub.implementations.find(m => m.id === sub.selectedImplementation)!;
      return <article key={sub.id} className="subfeature-card"><div className="subfeature-card-title"><span>{String(i + 1).padStart(2, "0")}</span><h3>{sub.label}</h3><button className="subfeature-regenerate" aria-label={`Regenerate ${name} · ${sub.label}`} title="Regenerate this subfeature" disabled={busy} onClick={() => onRegenerate(sub.id)}><Icon name="spark" size={12} /><span>Regenerate</span></button><button className="remove-control" aria-label={`Delete ${name} · ${sub.label} card`} title="Delete subfeature card" onClick={() => onRemove(sub.id)}><Icon name="close" size={13} /></button></div>
        <label className="implementation-control"><span>IMPLEMENT WITH</span><select aria-label={`${name} · ${sub.label} implementation`} value={sub.selectedImplementation} onChange={e => onMethod(sub.id, e.target.value)}>{sub.implementations.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
        <div className="parameter-widgets" key={method.id}>{method.parameters.map(p => {
          const label = `${name} · ${sub.label} · ${p.label}`;
          const change = (value: Parameter["value"]) => onParameter(sub.id, method.id, p.id, value);
          return <div key={p.id} className={`parameter-widget widget-${p.type}`}><div className="parameter-widget-heading"><span className="parameter-label">{p.label}</span><button className="remove-control" aria-label={`Delete ${label} widget`} title="Delete widget" onClick={() => onRemove(sub.id, method.id, p.id)}><Icon name="close" size={12} /></button></div>
            {p.type === "number" && <NumberWidget parameter={p} label={label} onChange={change} />}
            {p.type === "color" && <label className="color-widget"><input type="color" aria-label={label} value={p.value} onChange={e => change(e.target.value)} /><span>{p.value.toUpperCase()}</span></label>}
            {p.type === "select" && <select aria-label={label} value={p.value} onChange={e => change(e.target.value)}>{p.options.map(option => <option key={option} value={option}>{option}</option>)}</select>}
            {p.type === "toggle" && <button type="button" role="switch" aria-label={label} aria-checked={p.value} className={`parameter-switch ${p.value ? "on" : ""}`} onClick={() => change(!p.value)}><span /></button>}
          </div>;
        })}</div>
        <details className="implementation-details"><summary>How it works</summary><p>{method.description}</p></details>
        <button type="button" className="make-algorithm-pen" aria-label={`Make pen from ${name} · ${sub.label} · ${method.label}`} onClick={() => onMakePen(sub.id)}><Icon name="pen" size={15} /><span>Make pen<small>{method.label} → semantic pencil</small></span><Icon name="plus" size={14} /></button>
      </article>;
    })}</fieldset>
    {!legacy && <button className="alternative-button" disabled={busy} onClick={onAlternative}><Icon name="spark" size={14} />Explore other implementations</button>}
  </section>;
}
