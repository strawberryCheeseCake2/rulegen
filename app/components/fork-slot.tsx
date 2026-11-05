import { useRef, useState, type ComponentProps } from "react";
import { Icon } from "./icons";
import { EditSheet, EditTools, pictureEdited, type PictureEdit } from "./picture-edit";
import { RecommendationPreview } from "./recommendation-preview";
import { formatScalar, type Scalar } from "../lib/inspection";

export type ForkSlotStatus = "waiting" | "paused" | "ready" | "making" | "error";
/**
 * Revising the recommendation at its preview: parts of it cropped by hand (a freeform outline drawn around them) and
 * moved, scaled or rotated (always at hand: the "select" mode; cut from `image`, the preview as it was at the first
 * crop), annotation strokes drawn on it (normalized; the "annotate" mode), and a note.
 */
export type SlotEdit = PictureEdit & {
  /** Values changed with the preview's handles (by key). */
  adjusted: Record<string, Scalar>; revising: boolean; reply: string; error: string };
export const emptySlotEdit = (): SlotEdit => ({ mode: "select", marks: [], manipulations: [], image: "", note: "", adjusted: {}, revising: false, reply: "", error: "" });
/** A fork slot on the board (not saved): recommendation `index` of targeted tool `toolId` of brush `brushId`, as it reads in `targetFrameId`. */
export type ForkSlotFrame = { id: `slot-${string}`; targetFrameId: string; brushId: string; toolId: string; index: number; key: string; title: string; detail: string; making: boolean; error: string; edit: SlotEdit };
export const isSlotFrame = (id: string): id is `slot-${string}` => id.startsWith("slot-");
type Props = {
  title: string; detail: string;
  /** waiting: its Execution and key parameter frames are being made; paused: they wait for "Continue generating"; ready: it can be accepted. */
  status: ForkSlotStatus; message: string;
  /** The version the fork will be (the recommendation's preview on the held step's marks), or null while it cannot be drawn. */
  preview: Omit<ComponentProps<typeof RecommendationPreview>, "large" | "plain" | "onCapture" | "onDrawn" | "adjusted" | "onAdjust"> | null;
  /** Its Execution and key parameter frames were placed only: make them now. */
  paused: boolean; onContinue: () => void;
  edit: SlotEdit; onEdit: (patch: Partial<SlotEdit>) => void;
  /** Ask AI to revise the recommendation from the edit, on this picture of the preview. */
  onRevise: (image: string) => void; onCancelRevise: () => void;
  onAccept: () => void; onActivate: () => void;
};

/**
 * Where a recommendation's fork goes, in its frame group beside the fork's Execution and key
 * parameter frames: the version it would be, and under the frame its menu: Accept, which makes the
 * fork here without AI (from the code those frames run), making those frames, and revising the
 * recommendation at its preview: cropping any part of it by drawing around it, then moving, scaling and
 * rotating that crop, always at hand; annotation on it; its handles.
 */
export function ForkSlot({ title, detail, status, message, preview, paused, onContinue, edit, onEdit, onRevise, onCancelRevise, onAccept, onActivate }: Props) {
  // The picture of the held step as the preview draws it, which crops are cut from.
  // (A picture may come just before or after the step is drawn: the latest one a little after it is drawn is taken.)
  const [shot, setShot] = useState(""), wantShot = useRef(true), latest = useRef("");
  const take = (image: string) => { if (!wantShot.current || !image) return; wantShot.current = false; setShot(image); };
  const [selected, setSelected] = useState<number | null>(null);
  const editable = Boolean(preview) && !edit.revising;
  const changed = pictureEdited(edit) || Object.keys(edit.adjusted).length > 0;
  // What each preview handle changes, by its key (for the list of values changed).
  const handleName = (key: string) => { const overlay = preview?.preview?.handles?.find(item => item.handle?.key === key); return overlay?.name || overlay?.handle?.hint || preview?.preview?.values.find(item => `${item.nodeId}/${item.id}` === key)?.label || key; };
  const picture = edit.image || shot;
  return <div className={`fork-slot ${edit.mode}`} onPointerDown={onActivate}
    onKeyDown={e => { if (e.key === "Escape" && selected !== null) { e.stopPropagation(); setSelected(null); } }}>
    <div className="fork-slot-view">
      {preview ? <RecommendationPreview {...preview} large onCapture={image => { latest.current = image; take(image); }} onDrawn={() => { wantShot.current = true; setTimeout(() => take(latest.current), 300); }}
        adjusted={edit.adjusted} onAdjust={edit.revising ? undefined : (key, value) => { const adjusted = { ...edit.adjusted }; if (value === null) delete adjusted[key]; else adjusted[key] = value; onEdit({ adjusted }); }} />
        : <div className="frame-render-status"><span className="loading-spinner" /><strong>Preparing the changed version…</strong></div>}
    </div>
    {/* What the user did on the preview: annotation strokes, and the crops carried where they were moved, scaled and rotated. */}
    <EditSheet edit={edit} onEdit={onEdit} shot={shot || latest.current} editable={editable} selected={selected} onSelect={setSelected} />
    <div className="fork-slot-bar" onPointerDown={e => e.stopPropagation()}>
      <span className="section-kicker">FORK · Not generated yet</span>
      <strong>{title}</strong>
      <span className="fork-slot-detail">{detail}</span>
      <span className={`fork-slot-message ${status}`} role="status">{status === "waiting" || status === "making" ? <span className="loading-spinner" /> : null}{message}</span>
      <div className="fork-slot-actions">
        <button className="primary" disabled={status !== "ready" || edit.revising} onClick={onAccept}><Icon name="spark" size={14} />Accept · Fork with this version</button>
        {paused && <button onClick={onContinue} disabled={edit.revising} title="Generates the adjacent Execution and key parameter frames with AI">▶ Continue generating (Execution · Key parameters)</button>}
      </div>
      {/* Revising the recommendation before it is applied. */}
      <div className="fork-slot-revise">
        <span className="section-kicker">Fix in preview · show it by cropping to move, scale, rotate, with annotation, or with the handles on the preview</span>
        <EditTools edit={edit} onEdit={onEdit} editable={editable} busy={edit.revising} selected={selected} onSelect={setSelected} />
        {Object.keys(edit.adjusted).length > 0 && <ul className="fork-slot-manipulations">
          {Object.entries(edit.adjusted).map(([key, value]) => <li key={key}><b>{handleName(key)}</b><span>→ {formatScalar(value)}</span>
            <button aria-label="Back" title="Reset" disabled={edit.revising} onClick={() => { const adjusted = { ...edit.adjusted }; delete adjusted[key]; onEdit({ adjusted }); }}>×</button></li>)}
        </ul>}
        <textarea value={edit.note} rows={2} maxLength={2000} placeholder="How to fix it (optional) · e.g. only the overlapping ones bigger, rotated along the stroke" disabled={edit.revising} onChange={e => onEdit({ note: e.target.value })}
          onKeyDown={e => { e.stopPropagation(); if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && changed) onRevise(picture); }} />
        <div className="fork-slot-actions">
          {edit.revising ? <><span className="fork-slot-message waiting"><span className="loading-spinner" />The AI is revising the recommendation and preview…</span><button onClick={onCancelRevise}>Cancel</button></>
            : <button className="primary" disabled={!changed || !preview} onClick={() => onRevise(picture)}><Icon name="spark" size={14} />Revise recommendation</button>}
        </div>
        {edit.reply && <span className="fork-slot-message">{edit.reply}</span>}
        {edit.error && <span className="fork-slot-message error" role="alert">{edit.error}</span>}
      </div>
    </div>
  </div>;
}
