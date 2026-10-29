import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from "react";
import { ensureFramePositions, fitFrames, framesInBox, FRAME_HEIGHT, FRAME_WIDTH, zoomAt, type FrameId, type WorkspaceLayout } from "../lib/workspace";
import { Icon } from "./icons";
export type WorkspaceHandle = { fit: () => void; focus: (id: FrameId) => void; zoom: (amount: number) => void };
type Frame = { id: FrameId; title: string; subtitle: string; content: ReactNode | ((zoom: number) => ReactNode); actions?: ReactNode };
/** A relation drawn between two frames (a proxy frame → the frame it controls). */
export type FrameLink = { from: FrameId; to: FrameId; label: string };
type Props = { links?: FrameLink[]; /** A frame shown as linked (e.g. while its link is hovered). */ highlight?: FrameId | null; layout: WorkspaceLayout; /** Always given an update of the latest layout (never a whole layout from a render that may be older). */ onChange: (update: (current: WorkspaceLayout) => WorkspaceLayout) => void; onActivateFrame?: (id: FrameId) => void; onDeleteFrame?: (id: FrameId) => void; deleteDisabled?: boolean; activeFrame?: FrameId; tool: string; frames: Frame[]; onDrop: (file: File) => void; onBackground: () => void; /** Frames picked together (a box dragged with the select tool, or shift-clicked headers). */ selectedFrames?: FrameId[]; onSelectFrames?: (ids: FrameId[]) => void };
export const FreeformWorkspace = forwardRef<WorkspaceHandle, Props>(function FreeformWorkspace(props, ref) {
  const positions = ensureFramePositions(props.layout.frames, props.frames.map(f => f.id));
  const layout = positions === props.layout.frames ? props.layout : { ...props.layout, frames: positions };
  const board = useRef<HTMLDivElement>(null), current = useRef(props); current.current = { ...props, layout };
  const drag = useRef<{ pointer: number; x: number; y: number; frames?: FrameId[]; box?: { x: number; y: number; add: boolean } } | null>(null);
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const selected = props.selectedFrames ?? [];
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
    const blur = () => { setSpace(false); drag.current = null; setDragging(false); setBox(null); };
    window.addEventListener("keydown", down); window.addEventListener("keyup", up); window.addEventListener("blur", blur);
    const wheel = (e: WheelEvent) => { if ((e.target as Element).closest("button")) return; e.preventDefault(); const p = current.current; const bounds = board.current!.getBoundingClientRect(); const factor = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? bounds.height : 1;
      const zooming = e.ctrlKey || e.metaKey, scale = Math.exp(-e.deltaY * .008), anchor = { x: e.clientX - bounds.left, y: e.clientY - bounds.top }, dx = e.deltaX * factor, dy = e.deltaY * factor;
      p.onChange(current => { const c = cameraOf(current); return { ...current, camera: zooming ? zoomAt(c, c.zoom * scale, anchor) : { ...c, x: c.x - dx, y: c.y - dy } }; }); };
    board.current!.addEventListener("wheel", wheel, { passive: false });
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); window.removeEventListener("blur", blur); board.current?.removeEventListener("wheel", wheel); };
  }, []);
  function finish(e: React.PointerEvent) {
    const d = drag.current; if (d?.pointer !== e.pointerId) return; drag.current = null; setDragging(false); if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (d.box) {
      // A box picks the frames it touches (shift adds to them); a click on the empty board drops the pick.
      const p = current.current, c = cameraOf(p.layout), bounds = board.current!.getBoundingClientRect(), x = e.clientX - bounds.left, y = e.clientY - bounds.top;
      const hit = Math.hypot(x - d.box.x, y - d.box.y) < 4 ? [] : framesInBox(p.layout.frames, p.frames.map(f => f.id), { x: (d.box.x - c.x) / c.zoom, y: (d.box.y - c.y) / c.zoom, w: (x - d.box.x) / c.zoom, h: (y - d.box.y) / c.zoom }) as FrameId[];
      p.onSelectFrames?.(d.box.add ? [...new Set([...(p.selectedFrames ?? []), ...hit])] : hit);
      setBox(null);
    }
  }
  return <div ref={board} className={`freeform-board ${space || props.tool === "hand" ? "pan-ready" : ""} ${dragging ? "board-dragging" : ""}`} aria-label="Infinite canvas workspace" style={{ backgroundSize: `${24 * camera.zoom}px ${24 * camera.zoom}px`, backgroundPosition: `${camera.x}px ${camera.y}px` }} onContextMenu={e => e.preventDefault()} onClick={props.onBackground} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (e.dataTransfer.files[0]) props.onDrop(e.dataTransfer.files[0]); }} onPointerDownCapture={e => {
    if ((e.target as Element).closest("button,input,textarea")) return;
    const header = (e.target as Element).closest<HTMLElement>("[data-frame-handle]");
    const headerId = header?.dataset.frameHandle as FrameId | undefined;
    if (headerId) {
      props.onActivateFrame?.(headerId);
      // Shift-click adds or removes a frame from the pick; a frame outside the pick drops it.
      if (e.shiftKey) props.onSelectFrames?.(selected.includes(headerId) ? selected.filter(id => id !== headerId) : [...selected, headerId]);
      else if (selected.length && !selected.includes(headerId)) props.onSelectFrames?.([]);
    }
    const inFrame = !header && (e.target as Element).closest(".world-frame");
    if (inFrame && selected.length) props.onSelectFrames?.([]);
    if (inFrame && !space && props.tool !== "hand" && !e.altKey && e.button !== 1) return;
    if (e.button !== 0 && e.button !== 1) return;
    e.preventDefault(); e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId);
    const bounds = e.currentTarget.getBoundingClientRect(), x = e.clientX - bounds.left, y = e.clientY - bounds.top;
    // With the select tool a drag on the empty board draws a box that picks frames; otherwise it pans. A picked header drags the whole pick.
    const boxing = !header && !inFrame && props.tool === "select" && !space && !e.altKey && e.button === 0;
    const moved = headerId ? (selected.includes(headerId) && !e.shiftKey ? selected : [headerId]) : undefined;
    drag.current = { pointer: e.pointerId, x: e.clientX, y: e.clientY, ...(moved ? { frames: moved } : {}), ...(boxing ? { box: { x, y, add: e.shiftKey } } : {}) };
    if (boxing) setBox({ x, y, w: 0, h: 0 }); else setDragging(true);
  }} onPointerMove={e => {
    const d = drag.current; if (!d || d.pointer !== e.pointerId) return; const p = current.current, dx = e.clientX - d.x, dy = e.clientY - d.y, moved = d.frames;
    if (d.box) { const bounds = e.currentTarget.getBoundingClientRect(), start = d.box; setBox({ x: start.x, y: start.y, w: e.clientX - bounds.left - start.x, h: e.clientY - bounds.top - start.y }); return; }
    if (moved) p.onChange(current => { const c = cameraOf(current), frames = { ...current.frames }; for (const id of moved) { const at = frames[id] ?? positions[id]; if (at) frames[id] = { x: at.x + dx / c.zoom, y: at.y + dy / c.zoom }; } return { ...current, frames }; });
    else p.onChange(current => { const c = cameraOf(current); return { ...current, camera: { ...c, x: c.x + dx, y: c.y + dy } }; });
    d.x = e.clientX; d.y = e.clientY;
  }} onPointerUp={finish} onPointerCancel={finish}>
    <div className="board-top-hint"><span className="eyebrow">FREEFORM WORKSPACE</span><span>Sketch → features → a new frame</span></div>
    <div className="world-layer" style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})` }}>
      {props.frames.map(f => <section key={f.id} className={`world-frame ${f.id === props.highlight ? "link-highlight" : ""} ${f.id === props.activeFrame ? "active-frame" : ""} ${selected.includes(f.id) ? "picked-frame" : ""} ${f.id.startsWith("sketch-") ? "frame-sketch" : f.id.startsWith("proxy-") ? "frame-proxy" : f.id.startsWith("explore-") ? "frame-explore" : `frame-${f.id}`}`} aria-label={`${f.title} frame`} aria-current={f.id === props.activeFrame ? true : undefined} style={{ left: positions[f.id].x, top: positions[f.id].y }}>{typeof f.content === "function" ? f.content(camera.zoom) : f.content}</section>)}
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
    {props.frames.map(f => <div key={f.id} className={`world-frame-header ${f.id === props.activeFrame ? "active-frame-header" : ""} ${selected.includes(f.id) ? "picked-frame-header" : ""} ${f.id === props.highlight ? "link-highlight-header" : ""}`} data-frame-handle={f.id} style={{ left: camera.x + positions[f.id].x * camera.zoom, top: camera.y + positions[f.id].y * camera.zoom - 35, width: 900 * camera.zoom }}><div><strong>{f.title}</strong><span>{f.subtitle}</span></div><div className="frame-actions">{f.actions}{props.onDeleteFrame && <button className="delete-frame-button" aria-label={`Delete ${f.title} frame`} title="Delete frame" disabled={props.deleteDisabled} onClick={e => { e.stopPropagation(); props.onDeleteFrame?.(f.id); }}><Icon name="trash" size={13} /></button>}<button aria-label={`Focus ${f.title} frame`} title="Focus frame" onClick={e => { e.stopPropagation(); props.onActivateFrame?.(f.id); fit([f.id]); }}><Icon name="grid" size={13} /></button></div></div>)}
    {box && <div className="frame-pick-box" style={{ left: Math.min(box.x, box.x + box.w), top: Math.min(box.y, box.y + box.h), width: Math.abs(box.w), height: Math.abs(box.h) }} />}
    <div className="board-bottom-hint"><span>{props.tool === "select" ? "Drag to select frames · " : ""}Space + drag to pan · ⌘ / Ctrl + scroll to zoom</span><button onClick={e => { e.stopPropagation(); fit(); }}>Fit frames <Icon name="grid" size={12} /></button></div>
  </div>;
});
