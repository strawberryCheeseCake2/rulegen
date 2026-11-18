import type { SemanticPen } from "../lib/schema";
import { describeValue } from "../lib/scene/values";
import { Icon } from "./icons";

export function PenSettings({ pen, onChange, onClose, onRemove }: { pen: SemanticPen; onChange: (pen: SemanticPen) => void; onClose: () => void; onRemove?: () => void }) {
  const interaction = pen.kind === "interaction", constraint = pen.kind === "constraint" ? pen.constraint : null;
  return <div className="semantic-pen-popover" role="group" aria-label={interaction ? "Interaction pen settings" : "Constraint pen settings"}>
    <div className="pencil-popover-heading"><span>{pen.name}</span><button aria-label={interaction ? "Close Interaction pen settings" : "Close constraint pen settings"} onClick={onClose}><Icon name="close" size={14} /></button></div>
    <p className="semantic-pen-hint">{interaction ? "Sketch where to click, hover areas, drag directions, and where to drop. Describe the behavior you want in the pen meaning, and the AI prompt and state machine will interpret user input and responses together." : "Draw freely, like a regular pencil in a different color. Each stroke carries this constraint (its params and values as-is), and on Compose the node drawn by that mark gets this constraint."}</p>
    <div className="semantic-pen-origin"><strong>{constraint ? constraint.label : "User interaction"}</strong><span>{interaction ? "DEFAULT PEN" : "CONSTRAINT"}</span></div>
    <p className="semantic-pen-source">{pen.source.label}</p>
    <label className="semantic-meaning"><span>{interaction ? "INTERACTION SEMANTIC" : "PEN SEMANTIC"}</span><textarea aria-label={interaction ? "Interaction pen semantic" : "Constraint pen semantic"} rows={4} maxLength={2000} value={pen.meaning} onChange={e => onChange({ ...pen, meaning: e.target.value })} /></label>
    {constraint && constraint.params.length > 0 && <dl className="semantic-parameter-snapshot">{constraint.params.slice(0, 8).map(param => <div key={param.id}><dt>{param.label}</dt><dd>{describeValue(param.value)}</dd></div>)}</dl>}
    <label className="semantic-color"><span>Pen color</span><input aria-label={interaction ? "Interaction pen ink color" : "Constraint pen ink color"} type="color" value={pen.color} onChange={e => onChange({ ...pen, color: e.target.value })} /></label>
    <p className="semantic-pen-hint">{interaction ? "Annotations already drawn keep the meaning they had when drawn. This color and its marks describe user actions and are not drawn into the final artwork." : "Marks already drawn keep the meaning they had when drawn. The pen color tells constraints apart."}</p>
    {onRemove && <button className="copy-button" onClick={onRemove}>Remove pen from toolbar<Icon name="close" size={12} /></button>}
  </div>;
}
