import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type P5 from "p5";
import { ART_WIDTH as W, ART_HEIGHT as H, type Artwork, type Point, type Stroke, type SemanticPen, type Viewport } from "../lib/schema";
export type CanvasHandle = { capture: (full?: boolean, transparentBackground?: boolean) => { image: string; region: { x: number; y: number; w: number; h: number } }; clearSelection: () => void };
type Props = { artwork: Artwork; tool: string; color: string; width: number; opacity: number; viewport: Viewport; semanticPen?: SemanticPen; onStroke: (stroke: Stroke) => void; onViewport: (viewport: Viewport) => void; onSelection: (selected: boolean) => void; onError: (message: string) => void; transparent?: boolean; children?: React.ReactNode;
  /** Brush-group tools ("kind:brushId") record a gesture instead of a stroke: canvas pixels, ms since it started. Tools that only inspect get null. */
  onGesture?: (tool: string, points: { x: number; y: number; t: number }[]) => void; gestureTool?: (tool: string) => boolean;
  /** Live progress of a gesture (canvas pixels), before onGesture reports the whole path. */
  onGestureStep?: (tool: string, point: { x: number; y: number }, phase: "start" | "move") => void;
  /** Whether a gesture draws its path while it is made (default yes). */
  showGesture?: (tool: string) => boolean;
  /** The stroke style of the gesture path while drawing with a tool (none: the default dashed path). */
  gestureStyle?: (tool: string) => { color: string; width: number; opacity: number } | undefined };
export const SketchCanvas = forwardRef<CanvasHandle, Props>(function SketchCanvas(props, ref) {
  const host = useRef<HTMLDivElement>(null), surface = useRef<HTMLDivElement>(null), instance = useRef<P5 | null>(null);
  const current = useRef(props); current.current = props;
  const draft = useRef<Stroke | null>(null), lasso = useRef<Point[]>([]), pointer = useRef<{ mode: string; last: Point } | null>(null);
  const photo = useRef<HTMLImageElement | null>(null), render = useRef<(applyView?: boolean, transparentBackground?: boolean) => void>(() => {});
  const [ready, setReady] = useState(false), [selection, setSelection] = useState<Point[]>([]);
  const gesture = useRef<{ x: number; y: number; t: number }[] | null>(null), gestureStart = useRef(0), [gesturePath, setGesturePath] = useState<Point[]>([]);
  useEffect(() => {
    let disposed = false;
    let layer: P5.Graphics;
    import("p5").then(({ default: P5 }) => {
      if (disposed || !host.current) return;
      const p = new P5(p => {
        p.setup = () => { p.createCanvas(W, H); p.pixelDensity(1); layer = p.createGraphics(W, H); layer.pixelDensity(1); p.noLoop(); setReady(true); };
        p.draw = () => {
          if (!layer) return;
          const state = current.current;
          layer.clear();
          for (const stroke of [...state.artwork.strokes, ...(draft.current ? [draft.current] : [])]) {
            layer.push(); const ctx = layer.drawingContext as CanvasRenderingContext2D;
            ctx.globalCompositeOperation = stroke.tool === "eraser" ? "destination-out" : "source-over";
            { const ink = layer.color(stroke.color); ink.setAlpha(stroke.opacity * 255); layer.stroke(ink); layer.strokeWeight(stroke.width); layer.strokeCap(p.ROUND); layer.noFill();
              if (stroke.points.length === 1) { layer.point(stroke.points[0].x, stroke.points[0].y); }
              else for (let i = 1; i < stroke.points.length; i++) layer.line(stroke.points[i - 1].x, stroke.points[i - 1].y, stroke.points[i].x, stroke.points[i].y);
            }
            layer.pop();
          }
          render.current = (applyView = true, transparentBackground = false) => {
            if ((applyView && state.transparent) || transparentBackground) p.clear(); else p.background("#fffefa"); p.push();
            if (applyView) { p.translate(state.viewport.x, state.viewport.y); p.scale(state.viewport.zoom); }
            if (!transparentBackground && (!applyView || !state.transparent)) { p.noStroke(); p.fill("#fffefa"); p.rect(0, 0, W, H); }
            if (photo.current) { const img = photo.current; const scale = Math.min(W / img.naturalWidth, H / img.naturalHeight); (p.drawingContext as CanvasRenderingContext2D).drawImage(img, (W - img.naturalWidth * scale) / 2, (H - img.naturalHeight * scale) / 2, img.naturalWidth * scale, img.naturalHeight * scale); }
            p.image(layer, 0, 0); p.pop();
          };
          render.current();
        };
      }, host.current);
      instance.current = p;
    }).catch(() => current.current.onError("p5.js 엔진을 불러오지 못했습니다. 페이지를 새로고침해주세요."));
    return () => { disposed = true; instance.current?.remove(); instance.current = null; };
  }, []);
  useEffect(() => { instance.current?.redraw(); }, [props.artwork, props.viewport, ready]);
  useEffect(() => {
    photo.current = null;
    if (!props.artwork.photo) { instance.current?.redraw(); return; }
    let cancelled = false; const image = new Image();
    image.onload = () => { if (!cancelled) { photo.current = image; instance.current?.redraw(); } };
    image.onerror = () => current.current.onError("첨부 이미지를 열지 못했습니다.");
    image.src = props.artwork.photo;
    return () => { cancelled = true; };
  }, [props.artwork.photo]);
  useEffect(() => { lasso.current = []; setSelection([]); props.onSelection(false); }, [props.artwork.photo]);
  useImperativeHandle(ref, () => ({
    clearSelection() { lasso.current = []; setSelection([]); current.current.onSelection(false); },
    capture(full = false, transparentBackground = false) {
      const canvas = host.current?.querySelector("canvas");
      if (!canvas || !ready) throw new Error("캔버스가 준비될 때까지 잠시 기다려주세요.");
      if (current.current.artwork.photo && !photo.current) throw new Error("사진을 불러오는 중입니다. 잠시 후 분석해주세요.");
      instance.current?.redraw(); render.current(false, transparentBackground);
      try {
      const region = { x: 0, y: 0, w: 1, h: 1 };
      let image: string;
      if (!full && lasso.current.length >= 3) {
        const points = lasso.current;
        const x = Math.max(0, Math.floor(Math.min(...points.map(p => p.x)))), y = Math.max(0, Math.floor(Math.min(...points.map(p => p.y))));
        const width = Math.min(W - x, Math.ceil(Math.max(...points.map(p => p.x))) - x), height = Math.min(H - y, Math.ceil(Math.max(...points.map(p => p.y))) - y);
        if (width < 10 || height < 10) throw new Error("더 넓은 영역을 선택해주세요.");
        const crop = document.createElement("canvas"); crop.width = width; crop.height = height; const ctx = crop.getContext("2d")!;
        if (!transparentBackground) { ctx.fillStyle = "#fffefa"; ctx.fillRect(0, 0, width, height); } ctx.save(); ctx.beginPath(); points.forEach((point, i) => i ? ctx.lineTo(point.x - x, point.y - y) : ctx.moveTo(point.x - x, point.y - y)); ctx.closePath(); ctx.clip(); ctx.drawImage(canvas, -x, -y); ctx.restore();
        Object.assign(region, { x: x / W, y: y / H, w: width / W, h: height / H }); image = crop.toDataURL("image/png");
      } else image = canvas.toDataURL("image/png");
      return { image, region };
      } finally { render.current(true); }
    },
  }), [ready]);
  const coordinate = (event: React.PointerEvent) => { const bounds = surface.current!.getBoundingClientRect(); return { x: (event.clientX - bounds.left) * W / bounds.width, y: (event.clientY - bounds.top) * H / bounds.height }; };
  const world = (point: Point) => ({ x: Math.max(0, Math.min(W, (point.x - current.current.viewport.x) / current.current.viewport.zoom)), y: Math.max(0, Math.min(H, (point.y - current.current.viewport.y) / current.current.viewport.zoom)) });
  const finish = () => {
    if (pointer.current?.mode === "gesture" && gesture.current) { current.current.onGesture?.(current.current.tool, gesture.current); gesture.current = null; setGesturePath([]); pointer.current = null; return; }
    if (draft.current) current.current.onStroke(draft.current);
    if (pointer.current?.mode === "lasso") { if (lasso.current.length < 3) lasso.current = []; setSelection([...lasso.current]); current.current.onSelection(lasso.current.length >= 3); }
    draft.current = null; pointer.current = null; instance.current?.redraw();
  };
  return <div ref={surface} className={`p5-surface tool-${props.tool}`} onContextMenu={e => e.preventDefault()} onPointerDown={e => {
    if (!ready || (e.target as Element).closest("button")) return;
    const brushTool = props.gestureTool?.(props.tool) ?? false;
    if (props.tool.includes(":") && !brushTool && !(e.button === 1 || e.altKey)) return;
    e.currentTarget.setPointerCapture(e.pointerId); const point = coordinate(e); const mode = e.button === 1 || e.altKey ? "hand" : brushTool ? "gesture" : props.tool;
    if (mode === "gesture") { const at = world(point); gestureStart.current = performance.now(); gesture.current = [{ ...at, t: 0 }]; setGesturePath([at]); pointer.current = { mode, last: point }; props.onGestureStep?.(props.tool, at, "start"); return; }
    pointer.current = { mode, last: point };
    if (mode === "lasso") { lasso.current = [world(point)]; setSelection([...lasso.current]); }
    else if (mode !== "hand" && mode !== "select") draft.current = { points: [world(point)], tool: mode === "eraser" ? "eraser" : "pen", color: mode === "semantic" && props.semanticPen ? props.semanticPen.color : props.color, width: mode === "eraser" ? props.width * 5 : props.width, opacity: mode === "eraser" ? 1 : props.opacity / 100, ...(mode === "semantic" && props.semanticPen ? { semanticPen: structuredClone(props.semanticPen) } : {}) };
    instance.current?.redraw();
  }} onPointerMove={e => {
    const active = pointer.current; if (!active) return; const point = coordinate(e);
    if (active.mode === "hand") props.onViewport({ ...current.current.viewport, x: current.current.viewport.x + point.x - active.last.x, y: current.current.viewport.y + point.y - active.last.y });
    else if (active.mode === "gesture") { if (gesture.current && gesture.current.length < 2000) { const at = world(point); gesture.current.push({ ...at, t: performance.now() - gestureStart.current }); setGesturePath(path => [...path, at]); current.current.onGestureStep?.(current.current.tool, at, "move"); } }
    else if (active.mode === "lasso") { if (lasso.current.length < 2000) lasso.current.push(world(point)); setSelection([...lasso.current]); }
    else if (draft.current && draft.current.points.length < 6000) draft.current.points.push(world(point));
    active.last = point; instance.current?.redraw();
  }} onPointerUp={finish} onPointerCancel={finish}>
    <div ref={host} className="p5-host" />
    <svg className="artwork-overlay" viewBox={`0 0 ${W} ${H}`}><g transform={`translate(${props.viewport.x} ${props.viewport.y}) scale(${props.viewport.zoom})`}>{selection.length > 1 && <polygon className="lasso-region" points={selection.map(p => `${p.x},${p.y}`).join(" ")} />}{gesturePath.length > 0 && (props.showGesture?.(props.tool) ?? true) && <polyline className="gesture-path" points={gesturePath.map(p => `${p.x},${p.y}`).join(" ")} style={(style => style ? { stroke: style.color, strokeWidth: style.width, opacity: style.opacity, strokeDasharray: "none" } : undefined)(props.gestureStyle?.(props.tool))} />}{props.children}</g></svg>
    {!ready && <div className="engine-loading">Loading p5.js…</div>}
  </div>;
});
