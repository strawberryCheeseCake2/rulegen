import type { SemanticPen } from "../lib/schema";
import { Icon } from "./icons";

export function AlgorithmPenSettings({ pen, onChange, onClose, onRemove }: { pen: SemanticPen; onChange: (pen: SemanticPen) => void; onClose: () => void; onRemove: () => void }) {
  return <div className="algorithm-pen-popover" role="group" aria-label="Algorithm pen settings">
    <div className="pencil-popover-heading"><span>{pen.name}</span><button aria-label="Close algorithm pen settings" onClick={onClose}><Icon name="close" size={14} /></button></div>
    <p className="algorithm-pen-hint">색이 다른 일반 연필처럼 자유롭게 그리세요. 각 선에 이 알고리즘의 의미가 담기며, Compose할 때 다른 자국과 함께 해석됩니다.</p>
    <div className="algorithm-origin"><strong>{pen.implementation.label}</strong><span>FROM RULE</span></div>
    <p className="algorithm-source">{pen.feature.label} · {pen.subfeatureLabel}</p>
    <label className="semantic-meaning"><span>PEN SEMANTIC</span><textarea aria-label="Algorithm pen semantic" rows={4} maxLength={2000} value={pen.meaning} onChange={e => onChange({ ...pen, meaning: e.target.value })} /></label>
    {pen.implementation.parameters.length > 0 && <dl className="semantic-parameter-snapshot">{pen.implementation.parameters.map(p => <div key={p.id}><dt>{p.label}</dt><dd>{String(p.value)}{p.type === "number" ? ` ${p.unit}` : ""}</dd></div>)}</dl>}
    <label className="semantic-color"><span>Pen color</span><input aria-label="Algorithm pen ink color" type="color" value={pen.color} onChange={e => onChange({ ...pen, color: e.target.value })} /></label>
    <p className="algorithm-pen-hint">이미 그린 자국은 그릴 때의 의미를 유지합니다. 펜 색은 알고리즘을 구분하는 표시입니다.</p>
    <button className="copy-button" onClick={onRemove}>Remove pen from toolbar<Icon name="close" size={12} /></button>
  </div>;
}
