import { valueText } from "../lib/scene/propagation";
import type { Constraint } from "../lib/scene/schema";
import type { SandboxLogic } from "../lib/execution/concern-sandbox";

// Under a proxy frame of a mini sandbox (made from an inspection concern): how the sandbox's program works, and what
// it does with each param the handles above change.

export function SandboxLogicPanel({ logic, constraints }: { logic: SandboxLogic & { concern: string }; constraints: Constraint[] }) {
  const params = constraints.flatMap(item => item.params);
  // The params of this proxy frame first; what the logic says about params it does not show is left out.
  const rows = params.flatMap(param => { const row = logic.params.find(item => item.id === param.id); return row ? [{ param, how: row.how }] : []; });
  return <div className="propagate-panel sandbox-logic" onPointerDown={event => event.stopPropagation()}>
    <header><span className="section-kicker">HOW THIS SANDBOX WORKS</span><strong>{logic.summary}</strong></header>
    {rows.length > 0 && <ul className="sandbox-logic-params">
      {rows.map(({ param, how }) => <li key={param.id}><b>{param.label || param.id}</b><em>{valueText(param.value)}</em><span>{how}</span></li>)}
    </ul>}
    <p className="propagate-note">Made for: “{logic.concern.slice(0, 200)}”</p>
  </div>;
}
