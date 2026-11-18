import type { BrushRole } from "../lib/brushes";
import { Icon } from "./icons";

/** An edit an instance could not take: what it changes, and the edit itself (run after detach / adopt). */
export type DetachPrompt = { frameId: string; rootId: string; brushId: string; nodeName: string; what: string; apply: () => void };

/** Master (◆) or instance (◇) of a brush, as a short badge. */
export function BrushRoleBadge({ role }: { role: Pick<BrushRole, "master"> & { brush: { name: string; color: string } } }) {
  return <span className={`brush-role-badge ${role.master ? "master" : "instance"}`} style={{ color: role.brush.color }} title={`${role.brush.name} brush · ${role.master ? "master" : "instance"}`}>
    {role.master ? "◆" : "◇"}<span>{role.master ? "Master" : "Instance"}</span></span>;
}

type BannerProps = { role: BrushRole; nodeName: string; masterFrame: string | null; onMaster: () => void; onDetach: () => void; onAdopt: () => void;
  /** Delete this brush stamp (the whole collection) from the frame. */
  onDelete?: () => void };
/** Above the selected node's params: which brush it belongs to, as its master or an instance. */
export function BrushRoleBanner({ role, nodeName, masterFrame, onMaster, onDetach, onAdopt, onDelete }: BannerProps) {
  const { brush, master } = role;
  return <div className={`brush-role-banner ${master ? "master" : "instance"}`} role="note" aria-label={`${brush.name} brush ${master ? "master" : "instance"}`}>
    <div className="brush-role-heading"><BrushRoleBadge role={role} /><strong>{brush.name}</strong><i style={{ background: brush.color }} /></div>
    {master ? <span>{nodeName === brush.name ? "This node is" : `The collection “${nodeName}” belongs to is`} the brush's original. constraints and state machines changed here are used by brushes you stamp from now on.</span>
      : <span>{masterFrame ? <>This is an instance of the brush. Change constraints and state machines on the master (<b>{masterFrame}</b>), or detach it into a new brush and change them there.</>
        : <>The frame that held this brush's master was deleted. Make this instance the master, or detach it into a new brush and change it there.</>}</span>}
    <div className="brush-role-actions">
      {!master && (masterFrame ? <button onClick={onMaster}><Icon name="arrow" size={12} />Go to master</button> : <button onClick={onAdopt}>◆ Make master</button>)}
      {!master && <button onClick={onDetach}><Icon name="brush" size={12} />Detach as new brush</button>}
      {onDelete && <button className="brush-role-delete" title={master ? "Delete the master from this frame (the brush keeps a saved copy and its instances stay)" : "Delete this brush stamp from the frame"} onClick={onDelete}><Icon name="trash" size={12} />{master ? "Delete master" : "Delete stamp"}</button>}</div>
  </div>;
}

type DialogProps = { prompt: DetachPrompt; brushName: string; masterFrame: string | null; onDetach: () => void; onMaster: () => void; onAdopt: () => void; onCancel: () => void };
/** An instance was about to change: explain, and offer detach (then apply), the master, or cancel. */
export function DetachDialog({ prompt, brushName, masterFrame, onDetach, onMaster, onAdopt, onCancel }: DialogProps) {
  return <div className="modal-backdrop" onClick={onCancel}><div className="modal detach-dialog" role="dialog" aria-modal="true" aria-labelledby="detach-title" onClick={e => e.stopPropagation()}>
    <button className="modal-close" aria-label="Close dialog" onClick={onCancel}><Icon name="close" /></button>
    <div className="section-kicker">◇ BRUSH INSTANCE</div>
    <h2 id="detach-title">Instances follow their brush.</h2>
    <p>“{prompt.nodeName}” is an instance of the <b>{brushName}</b> brush, so changing <b>{prompt.what}</b> here makes it differ from the brush.
      Detaching makes this instance <b>the master of a new brush</b> and applies the change you just made. The original brush and its other instances stay as they are.</p>
    <button className="primary-button" autoFocus onClick={onDetach}>Detach and create new brush<Icon name="brush" /></button>
    {masterFrame ? <button className="alternative-button" onClick={onMaster}>Edit the master in {masterFrame}<Icon name="arrow" size={15} /></button>
      : <button className="alternative-button" onClick={onAdopt}>Make this instance the master and apply</button>}
    <button className="alternative-button" onClick={onCancel}>Cancel</button>
  </div></div>;
}
