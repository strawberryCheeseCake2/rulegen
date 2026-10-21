import type { SemanticPen } from "../lib/schema";
import { describeValue, valueLeaves } from "../lib/scene/values";
import { Icon } from "./icons";

/** Settings of the pen in use: the interaction pen's meaning, or what a transformation pen carries (from its minimal example). */
export function AlgorithmPenSettings({ pen, onChange, onClose, onRemove, onExample }: { pen: SemanticPen; onChange: (pen: SemanticPen) => void; onClose: () => void; onRemove?: () => void; onExample?: () => void }) {
  const interaction = pen.kind === "interaction", source = pen.transformation;
  const names = (id: string) => source?.library.find(item => item.id === id)?.name || id;
  return <div className="algorithm-pen-popover" role="group" aria-label={interaction ? "Interaction pen settings" : "Transformation pen settings"}>
    <div className="pencil-popover-heading"><span>{pen.name}</span><button aria-label={interaction ? "Close Interaction pen settings" : "Close transformation pen settings"} onClick={onClose}><Icon name="close" size={14} /></button></div>
    <p className="algorithm-pen-hint">{interaction ? "클릭할 곳, 호버 영역, 드래그 방향과 놓을 위치를 스케치로 표시하세요. 펜 의미에 원하는 동작을 적으면 Compose가 사용자 입력과 반응을 함께 해석합니다."
      : "이 펜으로 그린 자국은 \"이 transformation을 여기에\"라는 뜻입니다. 연필로 형태와 배치를 그리고, 이 펜으로 그 transformation이 적용될 곳을 표시한 뒤 Compose하세요."}</p>
    {source && <>
      <div className="algorithm-origin"><strong>{source.transformation.label || source.transformation.id}</strong><span>SEMANTIC TRANSFORMATION</span></div>
      {source.transformation.description && <p className="algorithm-source">{source.transformation.description}</p>}
      {source.transformation.properties.length > 0 && <dl className="semantic-parameter-snapshot">{source.transformation.properties.flatMap(property => valueLeaves(property.value).slice(0, 3).map(leaf => <div key={`${property.id}/${leaf.path.join("/")}`}>
        <dt>{[property.label, ...leaf.path].join(" · ")}</dt><dd>{describeValue(leaf.value, names)}</dd></div>)).slice(0, 10)}</dl>}
      {onExample && <button className="alternative-button" onClick={onExample}><Icon name="arrow" size={13} />최소 예제 프레임 보기</button>}
      <p className="algorithm-pen-hint">펜은 최소 예제를 따라갑니다. 예제 프레임에서 값이나 transformation을 고치면 Compose할 때 그 최신 상태가 쓰입니다. 예제 프레임을 지우면 마지막 상태가 남습니다.</p>
    </>}
    {interaction && <label className="semantic-meaning"><span>INTERACTION SEMANTIC</span><textarea aria-label="Interaction pen semantic" rows={4} maxLength={2000} value={pen.meaning} onChange={e => onChange({ ...pen, meaning: e.target.value })} /></label>}
    <label className="semantic-color"><span>Pen color</span><input aria-label={interaction ? "Interaction pen ink color" : "Transformation pen ink color"} type="color" value={pen.color} onChange={e => onChange({ ...pen, color: e.target.value })} /></label>
    {interaction && <p className="algorithm-pen-hint">이미 그린 annotation은 그릴 때의 의미를 유지합니다. 이 색과 자국은 사용자 동작을 설명하며 최종 작품에 그대로 그려지지 않습니다.</p>}
    {onRemove && <button className="copy-button" onClick={onRemove}>Remove pen from toolbar<Icon name="close" size={12} /></button>}
  </div>;
}
