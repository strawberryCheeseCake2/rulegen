import { valueText } from "../lib/scene/propagation";
import type { Constraint } from "../lib/scene/schema";
import type { SandboxLogic } from "../lib/execution/concern-sandbox";
import type { SandboxRestructure } from "../lib/sketch-panels";
import { useRestructureThumbs } from "../studio/use-restructure-thumbs";

// Under a proxy frame of a mini sandbox (made from an inspection concern): how the sandbox's program works, and what
// it does with each param the handles above change.

type Restructuring = { state: SandboxRestructure | null; busy: boolean; onSuggest: () => void; onPick: (optionId: string) => void; onClose: () => void };
export function SandboxLogicPanel({ logic, constraints, restructure }: { logic: SandboxLogic & { concern: string }; constraints: Constraint[]; restructure?: Restructuring }) {
  const params = constraints.flatMap(item => item.params);
  // The params of this proxy frame first; what the logic says about params it does not show is left out.
  const rows = params.flatMap(param => { const row = logic.params.find(item => item.id === param.id); return row ? [{ param, how: row.how }] : []; });
  return <div className="propagate-panel sandbox-logic" onPointerDown={event => event.stopPropagation()}>
    <header><span className="section-kicker">HOW THIS SANDBOX WORKS</span><strong>{logic.summary}</strong></header>
    {rows.length > 0 && <ul className="sandbox-logic-params">
      {rows.map(({ param, how }) => <li key={param.id}><b>{param.label || param.id}</b><em>{valueText(param.value)}</em><span>{how}</span></li>)}
    </ul>}
    <p className="propagate-note">Made for: “{logic.concern.slice(0, 200)}”</p>
    {restructure && <RestructureChoice {...restructure} />}
  </div>;
}

/**
 * When the handles alone may not give what the sandbox is for: AI's structural changes of its part, as a multiple
 * choice, each option previewed over the sandbox's faded picture with its rule written on it.
 */
function RestructureChoice({ state, busy, onSuggest, onPick, onClose }: Restructuring) {
  const thumbs = useRestructureThumbs(state?.options);
  if (!state) return <footer><button className="exec-button" disabled={busy} title="AI offers ways to change how this part computes, when changing its values alone may not give what you want; pick one by its preview"
    onClick={onSuggest}>Suggest structural changes</button></footer>;
  if (state.busy) return <p className="propagate-note restructure-busy"><span className="loading-spinner" />{state.busy}</p>;
  return <section className="restructure" aria-label="Structural changes">
    <header><span className="section-kicker">STRUCTURAL CHANGE · PICK ONE</span><strong>{state.question}</strong></header>
    {state.options.length > 0 && <div className="manip-options restructure-options">{state.options.map(option => { const thumb = thumbs[option.id];
      return <button key={option.id} disabled={busy} title={`Apply “${option.label}” to the sandbox: its part is rewritten to this rule and its handles made again`} onClick={() => onPick(option.id)}>
        <span className="restructure-thumb">
          {state.picture && <img src={state.picture} alt="" className="restructure-picture" />}
          {thumb?.src && <img src={thumb.src} alt="" />}
          <span className="restructure-caption"><b>{option.label}</b><code>{option.logic}</code></span>
          {!thumb && option.thumbnail && <em>Drawing the preview…</em>}
          {thumb?.note && <em>{thumb.note}</em>}
        </span>
        <small>{option.change}</small>
        <small className="restructure-params">{option.constraint.params.map(param => param.label).join(" · ")}</small>
      </button>; })}</div>}
    <footer><button className="exec-button" disabled={busy} onClick={onSuggest}>Other options</button><button className="exec-button" onClick={onClose}>Close</button></footer>
  </section>;
}
