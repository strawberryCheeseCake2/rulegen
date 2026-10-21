import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from "react";
import { ensureFramePositions, fitFrames, FRAME_HEIGHT, FRAME_WIDTH, zoomAt, type FrameId, type WorkspaceLayout } from "../lib/workspace";
import { Icon } from "./icons";
export type WorkspaceHandle = { fit: () => void; focus: (id: FrameId) => void; zoom: (amount: number) => void };
type Frame = { id: FrameId; title: string; subtitle: string; content: ReactNode | ((zoom: number) => ReactNode); actions?: ReactNode };
/** A relation drawn between two frames (a sketch → the example or composition made from it). */
export type FrameLink = { from: FrameId; to: FrameId; label: string };
type Props = { links?: FrameLink[]; /** A frame shown as linked (e.g. while its link is hovered). */ highlight?: FrameId | null; layout: WorkspaceLayout; /** Always an update of the latest layout (never a copy of a possibly stale one). */ onChange: (update: (layout: WorkspaceLayout) => WorkspaceLayout) => void; onActivateFrame?: (id: FrameId) => void; onDeleteFrame?: (id: FrameId) => void; deleteDisabled?: boolean; activeFrame?: FrameId; tool: string; frames: Frame[]; onDrop: (file: File) => void; onBackground: () => void;
  /** Frames picked together (a select-tool drag on the empty board, or ⇧-click on a header): moved together and deleted together. */
  selectedFrames?: FrameId[]; onSelectFrames?: (ids: FrameId[]) => void; onDeleteFrames?: (ids: FrameId[]) => void };
type Box = { x0: number; y0: number; x1: number; y1: number };
export const FreeformWorkspace = forwardRef<WorkspaceHandle, Props>(function FreeformWorkspace(props, ref) {
  const positions = ensureFramePositions(props.layout.frames, props.frames.map(f => f.id));
  const layout = positions === props.layout.frames ? props.layout : { ...props.layout, frames: positions };
  const board = useRef<HTMLDivElement>(null), current = useRef(props); current.current = { ...props, layout };
  const drag = useRef<{ pointer: number; x: number; y: number; frames?: FrameId[]; marquee?: { additive: boolean } } | null>(null);
  /** The selection rectangle being dragged, in board coordinates. */
  const [marquee, setMarquee] = useState<Box | null>(null);
  const selected = props.selectedFrames ?? [];
  const [space, setSpace] = useState(false), [dragging, setDragging] = useState(false);
  const camera = layout.camera || { zoom: .4, x: 40, y: 110 };
  // Every change is applied to the latest layout: a change computed from the layout of an earlier render
  // (e.g. the first fit while a saved project is being restored) would otherwise overwrite the restored one.
  const update = (edit: (layout: WorkspaceLayout) => WorkspaceLayout) => current.current.onChange(edit);
  const frameIds = props.frames.map(f => f.id).join(" ");
  useEffect(() => { if (layout !== props.layout) update(latest => { const frames = ensureFramePositions(latest.frames, frameIds.split(" ")); return frames === latest.frames ? latest : { ...latest, frames }; }); }, [layout, props.layout, frameIds]);
  /** Fit the camera to some frames (or every frame on the board); `onlyUnset` only when no camera was ever set. */
  function fit(ids?: FrameId[], onlyUnset = false) {
    const el = board.current; if (!el) return;
    const { clientWidth: width, clientHeight: height } = el;
    update(latest => {
      if (onlyUnset && latest.camera) return latest;
      const frames = Object.entries(latest.frames).filter(([id]) => ids ? ids.includes(id as FrameId) : !(id === "source" && latest.hiddenFrames.includes("source"))).map(([, position]) => position);
      return { ...latest, camera: fitFrames(frames, width, height) };
    });
  }
  function zoom(amount: number) { const el = board.current; if (!el) return; update(latest => { const c = latest.camera || camera; return { ...latest, camera: zoomAt(c, c.zoom + amount, { x: el.clientWidth / 2, y: el.clientHeight / 2 }) }; }); }
  useImperativeHandle(ref, () => ({ fit: () => fit(), focus: id => fit([id]), zoom }));
  useEffect(() => { const el = board.current!; const observer = new ResizeObserver(() => { if (!current.current.layout.camera) fit(undefined, true); }); observer.observe(el); return () => observer.disconnect(); }, []);
  useEffect(() => { if (!props.layout.camera) fit(undefined, true); }, [props.layout.camera]);
  useEffect(() => {
    const down = (e: KeyboardEvent) => { if ((e.target as Element).closest("input,textarea,select,[contenteditable]")) return; if (e.code === "Space") { e.preventDefault(); setSpace(true); } if (e.key === "Home") { e.preventDefault(); fit(); } };
    const up = (e: KeyboardEvent) => { if (e.code === "Space") setSpace(false); };
    const blur = () => { setSpace(false); drag.current = null; setDragging(false); };
    window.addEventListener("keydown", down); window.addEventListener("keyup", up); window.addEventListener("blur", blur);
    const wheel = (e: WheelEvent) => { if ((e.target as Element).closest("button")) return; e.preventDefault(); const bounds = board.current!.getBoundingClientRect(); const factor = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? bounds.height : 1;
      update(latest => { const c = latest.camera || camera; return { ...latest, camera: e.ctrlKey || e.metaKey ? zoomAt(c, c.zoom * Math.exp(-e.deltaY * .008), { x: e.clientX - bounds.left, y: e.clientY - bounds.top }) : { ...c, x: c.x - e.deltaX * factor, y: c.y - e.deltaY * factor } }; }); };
    board.current!.addEventListener("wheel", wheel, { passive: false });
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); window.removeEventListener("blur", blur); board.current?.removeEventListener("wheel", wheel); };
  }, []);
  /** The frames a board rectangle touches (in world coordinates). */
  function framesIn(box: Box) {
    const p = current.current, c = p.layout.camera || camera;
    const left = (Math.min(box.x0, box.x1) - c.x) / c.zoom, right = (Math.max(box.x0, box.x1) - c.x) / c.zoom, top = (Math.min(box.y0, box.y1) - c.y) / c.zoom, bottom = (Math.max(box.y0, box.y1) - c.y) / c.zoom;
    return p.frames.map(f => f.id).filter(id => { const at = p.layout.frames[id]; return at && at.x < right && at.x + FRAME_WIDTH > left && at.y < bottom && at.y + FRAME_HEIGHT > top; });
  }
  function finish(e: React.PointerEvent) {
    const d = drag.current; if (d?.pointer !== e.pointerId) return;
    if (d.marquee && marquee) {
      // A click (no real drag) on the empty board clears the selection; a drag selects what it touches.
      const moved = Math.abs(marquee.x1 - marquee.x0) > 4 || Math.abs(marquee.y1 - marquee.y0) > 4, picked = moved ? framesIn(marquee) : [];
      const base = d.marquee.additive ? current.current.selectedFrames ?? [] : [];
      if (moved || !d.marquee.additive) current.current.onSelectFrames?.([...new Set([...base, ...picked])]);
    }
    drag.current = null; setMarquee(null); setDragging(false); if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  }
  return <div ref={board} className={`freeform-board ${space || props.tool === "hand" ? "pan-ready" : ""} ${dragging ? "board-dragging" : ""}`} aria-label="Infinite canvas workspace" style={{ backgroundSize: `${24 * camera.zoom}px ${24 * camera.zoom}px`, backgroundPosition: `${camera.x}px ${camera.y}px` }} onContextMenu={e => e.preventDefault()} onClick={props.onBackground} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (e.dataTransfer.files[0]) props.onDrop(e.dataTransfer.files[0]); }} onPointerDownCapture={e => {
    if ((e.target as Element).closest("button,input,textarea,.frame-selection-bar")) return;
    const header = (e.target as Element).closest<HTMLElement>("[data-frame-handle]"), headerFrame = header?.dataset.frameHandle as FrameId | undefined;
    if (headerFrame && e.shiftKey && props.onSelectFrames) {
      // ⇧-click a header: add the frame to the selection, or take it out.
      e.preventDefault(); e.stopPropagation();
      props.onSelectFrames(selected.includes(headerFrame) ? selected.filter(id => id !== headerFrame) : [...selected, headerFrame]); return;
    }
    if (headerFrame) props.onActivateFrame?.(headerFrame);
    if (!header && !space && props.tool !== "hand" && !e.altKey && e.button !== 1 && (e.target as Element).closest(".world-frame")) return;
    if (e.button !== 0 && e.button !== 1) return;
    e.preventDefault(); e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId);
    // The select tool drags a selection rectangle on the empty board (Space, the hand tool or the middle button still pan).
    const selecting = !header && !space && props.tool === "select" && e.button === 0 && !e.altKey && Boolean(props.onSelectFrames);
    if (selecting) { const bounds = e.currentTarget.getBoundingClientRect(), x = e.clientX - bounds.left, y = e.clientY - bounds.top; setMarquee({ x0: x, y0: y, x1: x, y1: y }); }
    // Dragging a selected frame's header moves the whole selection; another frame's header moves it alone (and drops the selection).
    if (headerFrame && !selected.includes(headerFrame) && selected.length) props.onSelectFrames?.([]);
    const frames = headerFrame ? selected.includes(headerFrame) ? selected : [headerFrame] : undefined;
    drag.current = { pointer: e.pointerId, x: e.clientX, y: e.clientY, ...(frames ? { frames } : {}), ...(selecting ? { marquee: { additive: e.shiftKey } } : {}) }; setDragging(true);
  }} onPointerMove={e => {
    const d = drag.current; if (!d || d.pointer !== e.pointerId) return;
    if (d.marquee) { const bounds = e.currentTarget.getBoundingClientRect(); setMarquee(box => box && { ...box, x1: e.clientX - bounds.left, y1: e.clientY - bounds.top }); return; }
    const frames = d.frames, dx = e.clientX - d.x, dy = e.clientY - d.y;
    update(latest => {
      const c = latest.camera || camera;
      if (!frames) return { ...latest, camera: { ...c, x: c.x + dx, y: c.y + dy } };
      const moved = Object.fromEntries(frames.flatMap(id => latest.frames[id] ? [[id, { x: latest.frames[id].x + dx / c.zoom, y: latest.frames[id].y + dy / c.zoom }]] : []));
      return { ...latest, frames: { ...latest.frames, ...moved } };
    });
    d.x = e.clientX; d.y = e.clientY;
  }} onPointerUp={finish} onPointerCancel={finish}>
    <div className="board-top-hint"><span className="eyebrow">FREEFORM WORKSPACE</span><span>Sketch → Decompose → minimal examples &amp; pens → Compose</span></div>
    <div className="world-layer" style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`, "--board-zoom": camera.zoom } as React.CSSProperties}>
      {props.frames.map(f => <section key={f.id} className={`world-frame ${selected.includes(f.id) ? "selected-frame" : ""} ${f.id === props.highlight ? "link-highlight" : ""} ${f.id === props.activeFrame ? "active-frame" : ""} ${f.id.startsWith("sketch-") ? "frame-sketch" : f.id.startsWith("proxy-") ? "frame-proxy" : `frame-${f.id}`}`} aria-label={`${f.title} frame`} aria-current={f.id === props.activeFrame ? true : undefined} style={{ left: positions[f.id].x, top: positions[f.id].y }}>{typeof f.content === "function" ? f.content(camera.zoom) : f.content}</section>)}
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
    {props.frames.map(f => <div key={f.id} className={`world-frame-header ${selected.includes(f.id) ? "selected-frame-header" : ""} ${f.id === props.activeFrame ? "active-frame-header" : ""} ${f.id === props.highlight ? "link-highlight-header" : ""}`} data-frame-handle={f.id} style={{ left: camera.x + positions[f.id].x * camera.zoom, top: camera.y + positions[f.id].y * camera.zoom - 35, width: 900 * camera.zoom }}><div><strong>{f.title}</strong><span>{f.subtitle}</span></div><div className="frame-actions">{f.actions}{props.onDeleteFrame && <button className="delete-frame-button" aria-label={`Delete ${f.title} frame`} title="Delete frame" disabled={props.deleteDisabled} onClick={e => { e.stopPropagation(); props.onDeleteFrame?.(f.id); }}><Icon name="trash" size={13} /></button>}<button aria-label={`Focus ${f.title} frame`} title="Focus frame" onClick={e => { e.stopPropagation(); props.onActivateFrame?.(f.id); fit([f.id]); }}><Icon name="grid" size={13} /></button></div></div>)}
    {marquee && <div className="board-marquee" style={{ left: Math.min(marquee.x0, marquee.x1), top: Math.min(marquee.y0, marquee.y1), width: Math.abs(marquee.x1 - marquee.x0), height: Math.abs(marquee.y1 - marquee.y0) }} />}
    {selected.length > 0 && props.onDeleteFrames && <div className="frame-selection-bar" role="toolbar" aria-label="Selected frames">
      <span>{selected.length}개 프레임 선택됨</span>
      <button className="danger" disabled={props.deleteDisabled} onClick={e => { e.stopPropagation(); props.onDeleteFrames?.(selected); }}><Icon name="trash" size={12} />삭제</button>
      <button onClick={e => { e.stopPropagation(); props.onSelectFrames?.([]); }}>선택 해제</button></div>}
    <div className="board-bottom-hint"><span>{props.tool === "select" ? "Drag on the board to select frames · ⇧ add · Delete to remove · " : ""}Space + drag to pan · ⌘ / Ctrl + scroll to zoom</span><button onClick={e => { e.stopPropagation(); fit(); }}>Fit frames <Icon name="grid" size={12} /></button></div>
  </div>;
});
