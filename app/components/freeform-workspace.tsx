import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from "react";
import { ensureFramePositions, fitFrames, zoomAt, type FrameId, type WorkspaceLayout } from "../lib/workspace";
import { Icon } from "./icons";
export type WorkspaceHandle = { fit: () => void; focus: (id: FrameId) => void; zoom: (amount: number) => void };
type Frame = { id: FrameId; title: string; subtitle: string; content: ReactNode | ((zoom: number) => ReactNode); actions?: ReactNode };
type Props = { layout: WorkspaceLayout; onChange: (layout: WorkspaceLayout) => void; onActivateFrame?: (id: FrameId) => void; activeFrame?: FrameId; tool: string; frames: Frame[]; onDrop: (file: File) => void; onBackground: () => void };
export const FreeformWorkspace = forwardRef<WorkspaceHandle, Props>(function FreeformWorkspace(props, ref) {
  const positions = ensureFramePositions(props.layout.frames, props.frames.map(f => f.id));
  const layout = positions === props.layout.frames ? props.layout : { ...props.layout, frames: positions };
  const board = useRef<HTMLDivElement>(null), current = useRef(props); current.current = { ...props, layout };
  const drag = useRef<{ pointer: number; x: number; y: number; frame?: FrameId } | null>(null);
  const [space, setSpace] = useState(false), [dragging, setDragging] = useState(false);
  const camera = layout.camera || { zoom: .4, x: 40, y: 110 };
  useEffect(() => { if (layout !== props.layout) props.onChange(layout); }, [layout, props.layout, props.onChange]);
  function fit(ids?: FrameId[]) { const p = current.current, el = board.current; if (!el) return; const frames = p.frames.filter(f => !ids || ids.includes(f.id)).map(f => p.layout.frames[f.id]); p.onChange({ ...p.layout, camera: fitFrames(frames, el.clientWidth, el.clientHeight) }); }
  function zoom(amount: number) { const p = current.current, el = board.current; if (!el) return; const c = p.layout.camera || camera; p.onChange({ ...p.layout, camera: zoomAt(c, c.zoom + amount, { x: el.clientWidth / 2, y: el.clientHeight / 2 }) }); }
  useImperativeHandle(ref, () => ({ fit: () => fit(), focus: id => fit([id]), zoom }));
  useEffect(() => { const el = board.current!; const observer = new ResizeObserver(() => { if (!current.current.layout.camera) fit(); }); observer.observe(el); return () => observer.disconnect(); }, []);
  useEffect(() => { if (!props.layout.camera) fit(); }, [props.layout.camera]);
  useEffect(() => {
    const down = (e: KeyboardEvent) => { if ((e.target as Element).closest("input,textarea,select,[contenteditable]")) return; if (e.code === "Space") { e.preventDefault(); setSpace(true); } if (e.key === "Home") { e.preventDefault(); fit(); } };
    const up = (e: KeyboardEvent) => { if (e.code === "Space") setSpace(false); };
    const blur = () => { setSpace(false); drag.current = null; setDragging(false); };
    window.addEventListener("keydown", down); window.addEventListener("keyup", up); window.addEventListener("blur", blur);
    const wheel = (e: WheelEvent) => { if ((e.target as Element).closest("button")) return; e.preventDefault(); const p = current.current, c = p.layout.camera || camera; const bounds = board.current!.getBoundingClientRect(); const factor = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? bounds.height : 1; p.onChange({ ...p.layout, camera: e.ctrlKey || e.metaKey ? zoomAt(c, c.zoom * Math.exp(-e.deltaY * .008), { x: e.clientX - bounds.left, y: e.clientY - bounds.top }) : { ...c, x: c.x - e.deltaX * factor, y: c.y - e.deltaY * factor } }); };
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
    const d = drag.current; if (!d || d.pointer !== e.pointerId) return; const p = current.current, c = p.layout.camera || camera, dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (d.frame) p.onChange({ ...p.layout, frames: { ...p.layout.frames, [d.frame]: { x: p.layout.frames[d.frame].x + dx / c.zoom, y: p.layout.frames[d.frame].y + dy / c.zoom } } });
    else p.onChange({ ...p.layout, camera: { ...c, x: c.x + dx, y: c.y + dy } });
    d.x = e.clientX; d.y = e.clientY;
  }} onPointerUp={finish} onPointerCancel={finish}>
    <div className="board-top-hint"><span className="eyebrow">FREEFORM WORKSPACE</span><span>Sketch → features → a new frame</span></div>
    <div className="world-layer" style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})` }}>{props.frames.map(f => <section key={f.id} className={`world-frame ${f.id === props.activeFrame ? "active-frame" : ""} ${f.id.startsWith("sketch-") ? "frame-sketch" : f.id.startsWith("result-") ? "frame-result" : `frame-${f.id}`}`} aria-label={`${f.title} frame`} aria-current={f.id === props.activeFrame ? true : undefined} style={{ left: positions[f.id].x, top: positions[f.id].y }}>{typeof f.content === "function" ? f.content(camera.zoom) : f.content}</section>)}</div>
    {props.frames.map(f => <div key={f.id} className={`world-frame-header ${f.id === props.activeFrame ? "active-frame-header" : ""}`} data-frame-handle={f.id} style={{ left: camera.x + positions[f.id].x * camera.zoom, top: camera.y + positions[f.id].y * camera.zoom - 35, width: 900 * camera.zoom }}><div><strong>{f.title}</strong><span>{f.subtitle}</span></div><div className="frame-actions">{f.actions}<button aria-label={`Focus ${f.title} frame`} title="Focus frame" onClick={e => { e.stopPropagation(); props.onActivateFrame?.(f.id); fit([f.id]); }}><Icon name="grid" size={13} /></button></div></div>)}
    <div className="board-bottom-hint"><span>Space + drag to pan · ⌘ / Ctrl + scroll to zoom</span><button onClick={e => { e.stopPropagation(); fit(); }}>Fit frames <Icon name="grid" size={12} /></button></div>
  </div>;
});
