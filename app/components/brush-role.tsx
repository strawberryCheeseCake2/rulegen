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
/** Above the selected node's properties: which brush it belongs to, as its master or an instance. */
export function BrushRoleBanner({ role, nodeName, masterFrame, onMaster, onDetach, onAdopt, onDelete }: BannerProps) {
  const { brush, master } = role;
  return <div className={`brush-role-banner ${master ? "master" : "instance"}`} role="note" aria-label={`${brush.name} brush ${master ? "master" : "instance"}`}>
    <div className="brush-role-heading"><BrushRoleBadge role={role} /><strong>{brush.name}</strong><i style={{ background: brush.color }} /></div>
    {master ? <span>{nodeName === brush.name ? "이 노드가" : `「${nodeName}」가 속한 collection이`} brush의 원본입니다. 여기서 바꾼 semantic transformation과 state machine은 앞으로 찍는 brush에 쓰입니다.</span>
      : <span>{masterFrame ? <>이 brush의 instance입니다. Semantic transformation과 state machine은 master(<b>{masterFrame}</b>)에서 바꾸거나, detach해서 새 brush로 만든 뒤 바꾸세요.</>
        : <>이 brush의 master가 있던 프레임이 삭제되었습니다. 이 instance를 master로 지정하거나 detach해서 새 brush로 만든 뒤 바꾸세요.</>}</span>}
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
    <h2 id="detach-title">Instance는 brush를 따릅니다.</h2>
    <p>「{prompt.nodeName}」는 <b>{brushName}</b> brush의 instance라서 <b>{prompt.what}</b>을(를) 여기서 바꾸면 brush와 달라집니다.
      Detach하면 이 instance가 <b>새 brush의 master</b>가 되고, 방금 한 변경이 적용됩니다. 원래 brush와 다른 instance는 그대로입니다.</p>
    <button className="primary-button" autoFocus onClick={onDetach}>Detach and create new brush<Icon name="brush" /></button>
    {masterFrame ? <button className="alternative-button" onClick={onMaster}>Edit the master in {masterFrame}<Icon name="arrow" size={15} /></button>
      : <button className="alternative-button" onClick={onAdopt}>Make this instance the master and apply</button>}
    <button className="alternative-button" onClick={onCancel}>Cancel</button>
  </div></div>;
}
