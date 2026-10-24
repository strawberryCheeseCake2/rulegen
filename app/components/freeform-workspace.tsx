import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from "react";
import { ensureFramePositions, fitFrames, FRAME_HEIGHT, FRAME_WIDTH, zoomAt, type FrameId, type WorkspaceLayout } from "../lib/workspace";
import { Icon } from "./icons";
export type WorkspaceHandle = { fit: () => void; focus: (id: FrameId) => void; zoom: (amount: number) => void };
type Frame = { id: FrameId; title: string; subtitle: string; content: ReactNode | ((zoom: number) => ReactNode); actions?: ReactNode };
/** A relation drawn between two frames (a proxy frame → the frame it controls). */
export type FrameLink = { from: FrameId; to: FrameId; label: string };
type Props = { links?: FrameLink[]; /** A frame shown as linked (e.g. while its link is hovered). */ highlight?: FrameId | null; layout: WorkspaceLayout; /** Always given an update of the latest layout (never a whole layout from a render that may be older). */ onChange: (update: (current: WorkspaceLayout) => WorkspaceLayout) => void; onActivateFrame?: (id: FrameId) => void; onDeleteFrame?: (id: FrameId) => void; deleteDisabled?: boolean; activeFrame?: FrameId; tool: string; frames: Frame[]; onDrop: (file: File) => void; onBackground: () => void };
export const FreeformWorkspace = forwardRef<WorkspaceHandle, Props>(function FreeformWorkspace(props, ref) {
  const positions = ensureFramePositions(props.layout.frames, props.frames.map(f => f.id));
  const layout = positions === props.layout.frames ? props.layout : { ...props.layout, frames: positions };
  const board = useRef<HTMLDivElement>(null), current = useRef(props); current.current = { ...props, layout };
  const drag = useRef<{ pointer: number; x: number; y: number; frame?: FrameId } | null>(null);
  const [space, setSpace] = useState(false), [dragging, setDragging] = useState(false);
  const camera = layout.camera || { zoom: .4, x: 40, y: 110 };
  // Every change is an update of the latest layout: a callback from an older render (a resize right after the
  // project loads) must not put back that render's layout and drop the frames' saved positions.
  const ids = props.frames.map(f => f.id).join("|");
  useEffect(() => { if (layout !== props.layout) props.onChange(current => { const frames = ensureFramePositions(current.frames, ids.split("|")); return frames === current.frames ? current : { ...current, frames }; }); }, [layout, props.layout, props.onChange, ids]);
  const cameraOf = (current: WorkspaceLayout) => current.camera || { zoom: .4, x: 40, y: 110 };
  /** Fit the camera to the frames (`unset`: only when there is no camera yet, e.g. on the first layout). */
  function fit(only?: FrameId[], unset = false) {
    const p = current.current, el = board.current; if (!el) return;
    const { clientWidth: width, clientHeight: height } = el, shown = p.frames.map(f => f.id).filter(id => !only || only.includes(id));
    p.onChange(current => unset && current.camera ? current : { ...current, camera: fitFrames(shown.map(id => current.frames[id]).filter(Boolean), width, height) });
  }
  function zoom(amount: number) { const p = current.current, el = board.current; if (!el) return; const anchor = { x: el.clientWidth / 2, y: el.clientHeight / 2 }; p.onChange(current => { const c = cameraOf(current); return { ...current, camera: zoomAt(c, c.zoom + amount, anchor) }; }); }
  useImperativeHandle(ref, () => ({ fit: () => fit(), focus: id => fit([id]), zoom }));
  useEffect(() => { const el = board.current!; const observer = new ResizeObserver(() => fit(undefined, true)); observer.observe(el); return () => observer.disconnect(); }, []);
  useEffect(() => { if (!props.layout.camera) fit(undefined, true); }, [props.layout.camera]);
  useEffect(() => {
    const down = (e: KeyboardEvent) => { if ((e.target as Element).closest("input,textarea,select,[contenteditable]")) return; if (e.code === "Space") { e.preventDefault(); setSpace(true); } if (e.key === "Home") { e.preventDefault(); fit(); } };
    const up = (e: KeyboardEvent) => { if (e.code === "Space") setSpace(false); };
    const blur = () => { setSpace(false); drag.current = null; setDragging(false); };
    window.addEventListener("keydown", down); window.addEventListener("keyup", up); window.addEventListener("blur", blur);
    const wheel = (e: WheelEvent) => { if ((e.target as Element).closest("button")) return; e.preventDefault(); const p = current.current; const bounds = board.current!.getBoundingClientRect(); const factor = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? bounds.height : 1;
      const zooming = e.ctrlKey || e.metaKey, scale = Math.exp(-e.deltaY * .008), anchor = { x: e.clientX - bounds.left, y: e.clientY - bounds.top }, dx = e.deltaX * factor, dy = e.deltaY * factor;
      p.onChange(current => { const c = cameraOf(current); return { ...current, camera: zooming ? zoomAt(c, c.zoom * scale, anchor) : { ...c, x: c.x - dx, y: c.y - dy } }; }); };
    board.current!.addEventListener("wheel", wheel, { passive: false });
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); window.removeEventListener("blur", blur); board.current?.removeEventListener("wheel", wheel); };
  }, []);
  function finish(e: React.PointerEvent) { if (drag.current?.pointer !== e.pointerId) return; drag.current = null; setDragging(false); if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }
  return <div ref={board} className={`freeform-board ${space || props.tool === "hand" ? "pan-ready" : ""} ${dragging ? "board-dragging" : ""}`} aria-label="Infinite canvas workspace" style={{ backgroundSize: `${24 * camera.zoom}px ${24 * camera.zoom}px`, backgroundPosition: `${camera.x}px ${camera.y}px` }} onContextMenu={e => e.preventDefault()} onClick={props.onBackground} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (e.dataTransfer.files[0]) props.onDrop(e.dataTransfer.files[0]); }} onPointerDownCapture={e => {
    if ((e.target as Element).closest("button,input,textarea")) return;
    const header = (e.target as Element).closest<HTMLElement>("[data-frame-handle]");
    if (header) props.onActivateFrame?.(header.dataset.frameHandle as FrameId);
    if (!header && !space && props.tool !== "hand" && !e.altKey && e.button !== 1 && (e.target as Element).closest(".world-frame")) return;
    if (e.button !== 0 && e.button !== 1) return;
    e.preventDefault(); e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); drag.current = { pointer: e.pointerId, x: e.clientX, y: e.clientY, ...(header ? { frame: header.dataset.frameHandle as FrameId } : {}) }; setDragging(true);
  }} onPointerMove={e => {
    const d = drag.current; if (!d || d.pointer !== e.pointerId) return; const p = current.current, dx = e.clientX - d.x, dy = e.clientY - d.y, frame = d.frame;
    if (frame) p.onChange(current => { const c = cameraOf(current), at = current.frames[frame] ?? positions[frame]; return at ? { ...current, frames: { ...current.frames, [frame]: { x: at.x + dx / c.zoom, y: at.y + dy / c.zoom } } } : current; });
    else p.onChange(current => { const c = cameraOf(current); return { ...current, camera: { ...c, x: c.x + dx, y: c.y + dy } }; });
    d.x = e.clientX; d.y = e.clientY;
  }} onPointerUp={finish} onPointerCancel={finish}>
    <div className="board-top-hint"><span className="eyebrow">FREEFORM WORKSPACE</span><span>Sketch → features → a new frame</span></div>
    <div className="world-layer" style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})` }}>
      {props.frames.map(f => <section key={f.id} className={`world-frame ${f.id === props.highlight ? "link-highlight" : ""} ${f.id === props.activeFrame ? "active-frame" : ""} ${f.id.startsWith("sketch-") ? "frame-sketch" : f.id.startsWith("proxy-") ? "frame-proxy" : `frame-${f.id}`}`} aria-label={`${f.title} frame`} aria-current={f.id === props.activeFrame ? true : undefined} style={{ left: positions[f.id].x, top: positions[f.id].y }}>{typeof f.content === "function" ? f.content(camera.zoom) : f.content}</section>)}
      {props.links && props.links.length > 0 && <svg className="frame-links" aria-hidden="true"><defs><marker id="frame-link-arrow" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto"><path d="M0 0L10 5L0 10z" /></marker></defs>
        {props.links.filter(link => positions[link.from] && positions[link.to]).map(link => {
          // From the side of one frame that faces the other, to the facing side of the other.
          const a = positions[link.from], b = positions[link.to], right = b.x >= a.x;
          const x1 = right ? a.x + FRAME_WIDTH : a.x, y1 = a.y + FRAME_HEIGHT / 2, x2 = right ? b.x : b.x + FRAME_WIDTH, y2 = b.y + FRAME_HEIGHT / 2, bend = Math.max(60, Math.abs(x2 - x1) / 2) * (right ? 1 : -1);
          const on = props.highlight === link.to || props.highlight === link.from;
          return <g key={`${link.from}-${link.to}`} className={`frame-link ${on ? "highlighted" : ""}`}>
            <path d={`M${x1} ${y1}C${x1 + bend} ${y1} ${x2 - bend} ${y2} ${x2} ${y2}`} markerEnd="url(#frame-link-arrow)" />
            <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 14} textAnchor="middle">{link.label}</text></g>;
        })}</svg>}</div>
    {props.frames.map(f => <div key={f.id} className={`world-frame-header ${f.id === props.activeFrame ? "active-frame-header" : ""} ${f.id === props.highlight ? "link-highlight-header" : ""}`} data-frame-handle={f.id} style={{ left: camera.x + positions[f.id].x * camera.zoom, top: camera.y + positions[f.id].y * camera.zoom - 35, width: 900 * camera.zoom }}><div><strong>{f.title}</strong><span>{f.subtitle}</span></div><div className="frame-actions">{f.actions}{props.onDeleteFrame && <button className="delete-frame-button" aria-label={`Delete ${f.title} frame`} title="Delete frame" disabled={props.deleteDisabled} onClick={e => { e.stopPropagation(); props.onDeleteFrame?.(f.id); }}><Icon name="trash" size={13} /></button>}<button aria-label={`Focus ${f.title} frame`} title="Focus frame" onClick={e => { e.stopPropagation(); props.onActivateFrame?.(f.id); fit([f.id]); }}><Icon name="grid" size={13} /></button></div></div>)}
    <div className="board-bottom-hint"><span>Space + drag to pan · ⌘ / Ctrl + scroll to zoom</span><button onClick={e => { e.stopPropagation(); fit(); }}>Fit frames <Icon name="grid" size={12} /></button></div>
  </div>;
});
