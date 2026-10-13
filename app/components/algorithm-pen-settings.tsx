import type { SemanticPen } from "../lib/schema";
import { describeValue, valueLeaves } from "../lib/scene/values";
import { Icon } from "./icons";

export function AlgorithmPenSettings({ pen, onChange, onClose, onRemove }: { pen: SemanticPen; onChange: (pen: SemanticPen) => void; onClose: () => void; onRemove?: () => void }) {
  const interaction = pen.kind === "interaction";
  const call = pen.algorithm?.call, names = (id: string) => pen.algorithm?.library.find(item => item.id === id)?.name || id;
  return <div className="algorithm-pen-popover" role="group" aria-label={interaction ? "Interaction pen settings" : "Algorithm pen settings"}>
    <div className="pencil-popover-heading"><span>{pen.name}</span><button aria-label={interaction ? "Close Interaction pen settings" : "Close algorithm pen settings"} onClick={onClose}><Icon name="close" size={14} /></button></div>
    <p className="algorithm-pen-hint">{interaction ? "클릭할 곳, 호버 영역, 드래그 방향과 놓을 위치를 스케치로 표시하세요. 펜 의미에 원하는 동작을 적으면 AI prompt와 state machine이 사용자 입력과 반응을 함께 해석합니다." : "색이 다른 일반 연필처럼 자유롭게 그리세요. 각 선에 이 알고리즘의 의미가 담기며, Compose할 때 다른 자국과 함께 해석됩니다."}</p>
    <div className="algorithm-origin"><strong>{call ? names(call.algorithmId) : "User interaction"}</strong><span>{interaction ? "DEFAULT PEN" : "ALGORITHM BLOCK"}</span></div>
    <p className="algorithm-source">{pen.source.label}</p>
    <label className="semantic-meaning"><span>{interaction ? "INTERACTION SEMANTIC" : "PEN SEMANTIC"}</span><textarea aria-label={interaction ? "Interaction pen semantic" : "Algorithm pen semantic"} rows={4} maxLength={2000} value={pen.meaning} onChange={e => onChange({ ...pen, meaning: e.target.value })} /></label>
    {call && call.args.length > 0 && <dl className="semantic-parameter-snapshot">{valueLeaves(call).slice(0, 8).map(leaf => <div key={leaf.path.join("/")}><dt>{leaf.path.join(" · ")}</dt><dd>{describeValue(leaf.value, names)}</dd></div>)}</dl>}
    <label className="semantic-color"><span>Pen color</span><input aria-label={interaction ? "Interaction pen ink color" : "Algorithm pen ink color"} type="color" value={pen.color} onChange={e => onChange({ ...pen, color: e.target.value })} /></label>
    <p className="algorithm-pen-hint">{interaction ? "이미 그린 annotation은 그릴 때의 의미를 유지합니다. 이 색과 자국은 사용자 동작을 설명하며 최종 작품에 그대로 그려지지 않습니다." : "이미 그린 자국은 그릴 때의 의미를 유지합니다. 펜 색은 알고리즘을 구분하는 표시입니다."}</p>
    {onRemove && <button className="copy-button" onClick={onRemove}>Remove pen from toolbar<Icon name="close" size={12} /></button>}
  </div>;
}
