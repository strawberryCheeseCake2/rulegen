import type { ReactNode } from "react";
import { Icon } from "./icons";

export type ForkSlotStatus = "waiting" | "ready" | "making" | "error";
/** A fork slot on the board (not saved): recommendation `index` of targeted tool `toolId` of brush `brushId`, as it reads in `targetFrameId`. */
export type ForkSlotFrame = { id: `slot-${string}`; targetFrameId: string; brushId: string; toolId: string; index: number; key: string; title: string; detail: string; making: boolean; error: string };
export const isSlotFrame = (id: string): id is `slot-${string}` => id.startsWith("slot-");
type Props = {
  title: string; detail: string;
  /** waiting: its Execution and key parameter frames are still being made; ready: it can be accepted. */
  status: ForkSlotStatus; message: string;
  /** The version the fork will be (the recommendation's preview on the held step's marks). */
  preview: ReactNode;
  onAccept: () => void; onActivate: () => void;
};

/**
 * Where a recommendation's fork goes, in its frame group beside the fork's Execution and key
 * parameter frames: the version it would be, and Accept, which makes the fork here without AI
 * (from the code those frames run).
 */
export function ForkSlot({ title, detail, status, message, preview, onAccept, onActivate }: Props) {
  return <div className="fork-slot" onPointerDown={onActivate}>
    {preview || <div className="frame-render-status"><span className="loading-spinner" /><strong>바뀐 버전을 준비하고 있습니다…</strong></div>}
    <div className="fork-slot-bar" onPointerDown={e => e.stopPropagation()}>
      <span className="section-kicker">FORK · 아직 만들지 않음</span>
      <strong>{title}</strong>
      <span className="fork-slot-detail">{detail}</span>
      <span className={`fork-slot-message ${status}`} role="status">{status === "waiting" || status === "making" ? <span className="loading-spinner" /> : null}{message}</span>
      <button className="primary" disabled={status !== "ready"} onClick={onAccept}><Icon name="spark" size={14} />Accept · 이 버전으로 fork 만들기</button>
    </div>
  </div>;
}
