import type { SemanticPen } from "../lib/schema";
import { describeValue, valueLeaves } from "../lib/scene/values";
import { Icon } from "./icons";

export function AlgorithmPenSettings({ pen, onChange, onClose, onRemove }: { pen: SemanticPen; onChange: (pen: SemanticPen) => void; onClose: () => void; onRemove?: () => void }) {
  const interaction = pen.kind === "interaction", transformation = pen.kind === "transformation" ? pen.transformation : null;
  const call = pen.algorithm?.call, names = (id: string) => (pen.algorithm?.library ?? transformation?.library)?.find(item => item.id === id)?.name || id;
  return <div className="algorithm-pen-popover" role="group" aria-label={interaction ? "Interaction pen settings" : "Algorithm pen settings"}>
    <div className="pencil-popover-heading"><span>{pen.name}</span><button aria-label={interaction ? "Close Interaction pen settings" : "Close algorithm pen settings"} onClick={onClose}><Icon name="close" size={14} /></button></div>
    <p className="algorithm-pen-hint">{interaction ? "Sketch where to click, hover areas, drag directions, and where to drop. Describe the behavior you want in the pen meaning, and the AI prompt and state machine will interpret user input and responses together." : transformation ? "Draw freely, like a regular pencil in a different color. Each stroke carries this transformation (its property and values as-is), and on Compose the node drawn by that mark gets this transformation." : "Draw freely, like a regular pencil in a different color. Each stroke carries this algorithm's meaning and is interpreted together with other marks on Compose."}</p>
    <div className="algorithm-origin"><strong>{transformation ? transformation.label : call ? names(call.algorithmId) : "User interaction"}</strong><span>{interaction ? "DEFAULT PEN" : transformation ? "TRANSFORMATION" : "ALGORITHM BLOCK"}</span></div>
    <p className="algorithm-source">{pen.source.label}</p>
    <label className="semantic-meaning"><span>{interaction ? "INTERACTION SEMANTIC" : "PEN SEMANTIC"}</span><textarea aria-label={interaction ? "Interaction pen semantic" : "Algorithm pen semantic"} rows={4} maxLength={2000} value={pen.meaning} onChange={e => onChange({ ...pen, meaning: e.target.value })} /></label>
    {transformation && transformation.properties.length > 0 && <dl className="semantic-parameter-snapshot">{transformation.properties.slice(0, 8).map(property => <div key={property.id}><dt>{property.label}</dt><dd>{describeValue(property.value, names)}</dd></div>)}</dl>}
    {call && call.args.length > 0 && <dl className="semantic-parameter-snapshot">{valueLeaves(call).slice(0, 8).map(leaf => <div key={leaf.path.join("/")}><dt>{leaf.path.join(" · ")}</dt><dd>{describeValue(leaf.value, names)}</dd></div>)}</dl>}
    <label className="semantic-color"><span>Pen color</span><input aria-label={interaction ? "Interaction pen ink color" : "Algorithm pen ink color"} type="color" value={pen.color} onChange={e => onChange({ ...pen, color: e.target.value })} /></label>
    <p className="algorithm-pen-hint">{interaction ? "Annotations already drawn keep the meaning they had when drawn. This color and its marks describe user actions and are not drawn into the final artwork." : "Marks already drawn keep the meaning they had when drawn. The pen color tells algorithms apart."}</p>
    {onRemove && <button className="copy-button" onClick={onRemove}>Remove pen from toolbar<Icon name="close" size={12} /></button>}
  </div>;
}
