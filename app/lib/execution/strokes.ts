// Direct manipulation strokes: drawn on the Execution frame's picture (canvas pixels, 900×600) with the brush or the
// pencil, then moved, scaled and rotated with the select tool (about the center of what was drawn). What a stroke
// shows is measured generically (box, length, area, direction, the region painted…) so the code that turns it into a
// value of the brush is written for the concern, not for a kind of stroke.

export type Point = { x: number; y: number };
export type StrokeTool = "brush" | "pencil";
export type ManipStroke = { id: string; tool: StrokeTool; points: Point[]; width: number; dx: number; dy: number; scale: number; rotate: number };
export type Bounds = { x: number; y: number; w: number; h: number };
/** What the code measuring a demonstration gets for each stroke. */
export type StrokeFeatures = {
  tool: StrokeTool;
  /** The stroke as placed (moved, scaled, rotated), at most 64 points. */
  points: [number, number][];
  /** Painted width (pixels). */
  width: number;
  box: Bounds; center: [number, number];
  length: number;
  /** Whether it comes back to where it started (a shape drawn around something). */
  closed: boolean;
  /** The area it encloses when closed, else 0. */
  area: number;
  /** Direction of its long axis (degrees, 0 = to the right, clockwise). */
  angle: number;
  /** How much it was scaled and rotated (degrees) with the select tool. */
  scale: number; rotate: number;
};

export const STROKE_WIDTH: Record<StrokeTool, number> = { brush: 26, pencil: 3 };
export const CANVAS_W = 900, CANVAS_H = 600;
const MAX_POINTS = 400;

export function bounds(points: Point[]): Bounds {
  if (!points.length) return { x: 0, y: 0, w: 0, h: 0 };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of points) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
/** The point a stroke is scaled and rotated about: the center of what was drawn. */
export function pivot(stroke: ManipStroke): Point {
  const box = bounds(stroke.points);
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
}
/** The stroke's points as placed. */
export function placedPoints(stroke: ManipStroke): Point[] {
  const c = pivot(stroke), cos = Math.cos(stroke.rotate), sin = Math.sin(stroke.rotate);
  return stroke.points.map(p => {
    const x = p.x - c.x, y = p.y - c.y;
    return { x: c.x + (x * cos - y * sin) * stroke.scale + stroke.dx, y: c.y + (x * sin + y * cos) * stroke.scale + stroke.dy };
  });
}
export const newStroke = (id: string, tool: StrokeTool, at: Point): ManipStroke => ({ id, tool, points: [at], width: STROKE_WIDTH[tool], dx: 0, dy: 0, scale: 1, rotate: 0 });
/** A point added while drawing (close points skipped, at most MAX_POINTS). */
export function extend(stroke: ManipStroke, at: Point): ManipStroke {
  const last = stroke.points[stroke.points.length - 1];
  if (stroke.points.length >= MAX_POINTS || (last && Math.hypot(at.x - last.x, at.y - last.y) < 2)) return stroke;
  return { ...stroke, points: [...stroke.points, at] };
}

const round = (n: number) => Math.round(n * 100) / 100;
function sample(points: Point[], max: number) {
  if (points.length <= max) return points;
  return Array.from({ length: max }, (_, i) => points[Math.round(i * (points.length - 1) / (max - 1))]);
}
export function strokeFeatures(stroke: ManipStroke): StrokeFeatures {
  const points = placedPoints(stroke), box = bounds(points), n = points.length;
  let length = 0, twice = 0;
  for (let i = 1; i < n; i++) length += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  const gap = n > 2 ? Math.hypot(points[0].x - points[n - 1].x, points[0].y - points[n - 1].y) : Infinity;
  const closed = n > 2 && gap <= Math.max(12, .25 * Math.max(box.w, box.h)) && length > 2 * gap;
  if (closed) for (let i = 0; i < n; i++) { const a = points[i], b = points[(i + 1) % n]; twice += a.x * b.y - b.x * a.y; }
  // The long axis: the main direction of the points' spread.
  const mx = points.reduce((s, p) => s + p.x, 0) / (n || 1), my = points.reduce((s, p) => s + p.y, 0) / (n || 1);
  let xx = 0, yy = 0, xy = 0;
  for (const p of points) { xx += (p.x - mx) ** 2; yy += (p.y - my) ** 2; xy += (p.x - mx) * (p.y - my); }
  const angle = n > 1 ? .5 * Math.atan2(2 * xy, xx - yy) * 180 / Math.PI : 0;
  return {
    tool: stroke.tool, points: sample(points, 64).map(p => [round(p.x), round(p.y)]), width: round(stroke.width * stroke.scale),
    box: { x: round(box.x), y: round(box.y), w: round(box.w), h: round(box.h) }, center: [round(box.x + box.w / 2), round(box.y + box.h / 2)],
    length: round(length), closed, area: round(Math.abs(twice) / 2), angle: round(angle), scale: round(stroke.scale), rotate: round(stroke.rotate * 180 / Math.PI),
  };
}

const segmentDistance = (p: Point, a: Point, b: Point) => {
  const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
};
export function distanceTo(stroke: ManipStroke, p: Point) {
  const points = placedPoints(stroke);
  if (points.length === 1) return Math.hypot(p.x - points[0].x, p.y - points[0].y);
  let best = Infinity;
  for (let i = 1; i < points.length; i++) best = Math.min(best, segmentDistance(p, points[i - 1], points[i]));
  return best;
}
/** The stroke under a point (the newest first), if any. */
export function hitStroke(strokes: ManipStroke[], p: Point, slack = 6): string | null {
  for (let i = strokes.length - 1; i >= 0; i--) if (distanceTo(strokes[i], p) <= strokes[i].width * strokes[i].scale / 2 + slack) return strokes[i].id;
  return null;
}
/** Points along the strokes as placed, about `spacing` px apart (where what they show is read). */
export function strokeSpots(strokes: ManipStroke[], spacing = 30, max = 80): Point[] {
  const out: Point[] = [];
  for (const stroke of strokes) {
    let last: Point | null = null;
    for (const point of placedPoints(stroke)) if (!last || Math.hypot(point.x - last.x, point.y - last.y) >= spacing) { out.push(point); last = point; }
  }
  return out.length > max ? out.filter((_, i) => i % Math.ceil(out.length / max) === 0) : out;
}
/** The items inspected at points clicked on the picture: for each point, the item placed nearest to it (within `reach` px). */
export function probedItems<T extends Point>(points: Point[], items: T[], reach = 60): T[] {
  const out = new Set<T>();
  for (const point of points) {
    let best: T | null = null, distance = reach;
    for (const item of items) { const d = Math.hypot(item.x - point.x, item.y - point.y); if (d <= distance) { best = item; distance = d; } }
    if (best) out.add(best);
  }
  return [...out];
}
/** Points clicked to inspect: a click near one removes it, else it is added (the newest few kept). */
export function toggleProbe(points: Point[], at: Point, max = 8, near = 14): Point[] {
  const kept = points.filter(point => Math.hypot(point.x - at.x, point.y - at.y) > near);
  return kept.length < points.length ? kept : [...points, at].slice(-max);
}
/** Whether a point is under a stroke (within its width, and `slack` px). */
export const underStrokes = (strokes: ManipStroke[], p: Point, slack = 12) => hitStroke(strokes, p, slack) !== null;
/** The region painted with the brush: rows × cols cells of the canvas, how many brush strokes cover each cell's center (its coats). */
export function paintedMask(strokes: ManipStroke[], cols = 45, rows = 30): number[][] {
  const painted = strokes.filter(stroke => stroke.tool === "brush");
  const cw = CANVAS_W / cols, ch = CANVAS_H / rows;
  // Coats, as with paint: each brush stroke over a cell adds one (0: unpainted).
  return Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => {
    const p = { x: (c + .5) * cw, y: (r + .5) * ch };
    return painted.filter(stroke => distanceTo(stroke, p) <= stroke.width * stroke.scale / 2).length;
  }));
}
