import type { ConfirmAnswer, ConfirmPrompt } from "../studio/deps";
import { Icon } from "./icons";

/** A change the app asks about first: what it is, the items it touches, accept (or its alternative) or decline (closing declines). */
export function ConfirmDialog({ prompt, onAnswer }: { prompt: ConfirmPrompt; onAnswer: (answer: ConfirmAnswer) => void }) {
  return <div className="modal-backdrop" onClick={() => onAnswer(false)}><div className="modal detach-dialog confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title" onClick={e => e.stopPropagation()}>
    <button className="modal-close" aria-label="Close dialog" onClick={() => onAnswer(false)}><Icon name="close" /></button>
    <div className="section-kicker">{prompt.kicker}</div>
    <h2 id="confirm-title">{prompt.title}</h2>
    <p>{prompt.body}</p>
    {prompt.items.length > 0 && <ul className="confirm-items">{prompt.items.map((item, i) => <li key={i}><b>{item.label}</b><span>{item.detail}</span></li>)}</ul>}
    <button className="primary-button" autoFocus onClick={() => onAnswer(true)}>{prompt.accept}</button>
    {prompt.alternative && <button className="alternative-button" onClick={() => onAnswer("alternative")}>{prompt.alternative}</button>}
    <button className="alternative-button" onClick={() => onAnswer(false)}>{prompt.decline}</button>
  </div></div>;
}
