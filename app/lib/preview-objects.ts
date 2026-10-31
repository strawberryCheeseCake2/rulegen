import type { PreviewManipulation } from "./inspection";

// Parts of a recommendation's preview the user crops by hand (a freeform outline drawn
// around them) and then moves, scales or rotates, to show how the preview should look.

export type Box = { x: number; y: number; w: number; h: number };
type Point = { x: number; y: number };
type Placement = Pick<PreviewManipulation, "box" | "dx" | "dy" | "scale" | "rotate">;
/** Points kept of a crop's outline (canvas pixels). */
export const MAX_CROP_POINTS = 64;

/** The area inside an outline (closed back to its first point). */
const area = (outline: Point[]) => Math.abs(outline.reduce((sum, p, i) => { const q = outline[(i + 1) % outline.length]; return sum + p.x * q.y - q.x * p.y; }, 0)) / 2;
/**
 * A freeform outline drawn on the preview as a crop to manipulate (the `n`th), its outline thinned to
 * MAX_CROP_POINTS, or null when it encloses too little to be one (a click, a line).
 */
export function cropFrom(points: Point[], n: number): Pick<PreviewManipulation, "object" | "label" | "box" | "outline"> | null {
  if (points.length < 3) return null;
  const outline = points.filter((_, i) => i % Math.max(1, Math.ceil(points.length / MAX_CROP_POINTS)) === 0).slice(0, MAX_CROP_POINTS).map(p => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 }));
  const xs = outline.map(p => p.x), ys = outline.map(p => p.y), box = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  if (outline.length < 3 || box.w < 8 || box.h < 8 || area(outline) < 100) return null;
  return { object: `crop:${n}`, label: `크롭 #${n + 1}`, box, outline };
}
/** SVG path of an outline (closed). */
export const outlinePath = (outline: Point[]) => outline.length ? `M${outline.map(p => `${p.x},${p.y}`).join("L")}Z` : "";

export const centerOf = (box: Box) => ({ x: box.x + box.w / 2, y: box.y + box.h / 2 });
/** Where a manipulated crop's box is now: its center, half size and rotation (radians). */
export function placed(item: Placement) {
  const c = centerOf(item.box);
  return { cx: c.x + item.dx, cy: c.y + item.dy, hw: item.box.w / 2 * item.scale, hh: item.box.h / 2 * item.scale, angle: item.rotate * Math.PI / 180 };
}
/** A point of the manipulated box given in its own frame (u, v from -1 to 1), in canvas pixels. */
export function boxPoint(item: Placement, u: number, v: number) {
  const { cx, cy, hw, hh, angle } = placed(item), x = u * hw, y = v * hh;
  return { x: cx + x * Math.cos(angle) - y * Math.sin(angle), y: cy + x * Math.sin(angle) + y * Math.cos(angle) };
}
/** The grip that rotates (above the top edge) is this far out, in canvas pixels. */
export const ROTATE_REACH = 26;
export function rotateGrip(item: Placement) {
  const { cx, cy, hh, angle } = placed(item), out = hh + ROTATE_REACH;
  return { x: cx + out * Math.sin(angle), y: cy - out * Math.cos(angle) };
}
/** Whether a point (canvas pixels) is on the crop where it is now: inside its outline as moved, scaled and rotated (a few pixels of slack). */
export function onCrop(item: Placement & Pick<PreviewManipulation, "outline">, point: Point, slack = 4) {
  const { cx, cy, angle } = placed(item), c = centerOf(item.box), x = point.x - cx, y = point.y - cy;
  // Back where it was cropped.
  const at = { x: c.x + (x * Math.cos(-angle) - y * Math.sin(-angle)) / item.scale, y: c.y + (x * Math.sin(-angle) + y * Math.cos(-angle)) / item.scale };
  const outline = item.outline;
  if (outline.length < 3) return Math.abs(at.x - c.x) <= item.box.w / 2 + slack && Math.abs(at.y - c.y) <= item.box.h / 2 + slack;
  let inside = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const a = outline[i], b = outline[j];
    if ((a.y > at.y) !== (b.y > at.y) && at.x < (b.x - a.x) * (at.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  if (inside) return true;
  // Near its edge.
  return outline.some((a, i) => { const b = outline[(i + 1) % outline.length], dx = b.x - a.x, dy = b.y - a.y, t = Math.max(0, Math.min(1, ((at.x - a.x) * dx + (at.y - a.y) * dy) / Math.max(1e-9, dx * dx + dy * dy)));
    return Math.hypot(at.x - a.x - t * dx, at.y - a.y - t * dy) * item.scale <= slack; });
}

type Manip = PreviewManipulation;
/** Dragging the crop (move), its corner (scale about its center) or its rotate grip, from the manipulation it had when the drag began. */
export function dragManipulation(start: Manip, part: "move" | "scale" | "rotate", from: Point, to: Point): Manip {
  const { cx, cy } = placed(start);
  if (part === "move") return { ...start, dx: round(start.dx + to.x - from.x), dy: round(start.dy + to.y - from.y) };
  if (part === "scale") {
    const before = Math.hypot(from.x - cx, from.y - cy), now = Math.hypot(to.x - cx, to.y - cy);
    return { ...start, scale: round(Math.max(.1, Math.min(10, start.scale * (before > 1 ? now / before : 1))), 100) };
  }
  const turn = (Math.atan2(to.y - cy, to.x - cx) - Math.atan2(from.y - cy, from.x - cx)) * 180 / Math.PI;
  let rotate = start.rotate + turn; rotate = ((rotate + 540) % 360) - 180;
  return { ...start, rotate: round(rotate) };
}
const round = (value: number, by = 10) => Math.round(value * by) / by;
/** Whether a manipulation changes anything. */
export const manipulated = (item: Pick<Manip, "dx" | "dy" | "scale" | "rotate">) => Math.abs(item.dx) >= .5 || Math.abs(item.dy) >= .5 || Math.abs(item.scale - 1) >= .01 || Math.abs(item.rotate) >= .5;
/** In plain words for the panel (Korean). */
export const manipulationText = (item: Manip) => [Math.abs(item.dx) >= .5 || Math.abs(item.dy) >= .5 ? `이동 ${Math.round(item.dx)}, ${Math.round(item.dy)}px` : "",
  Math.abs(item.scale - 1) >= .01 ? `크기 ×${item.scale.toFixed(2)}` : "", Math.abs(item.rotate) >= .5 ? `회전 ${Math.round(item.rotate)}°` : ""].filter(Boolean).join(" · ") || "그대로";

/**
 * Showing AI how a picture should look, on the picture itself: parts of it cropped by hand (a freeform outline drawn
 * around them) and moved, scaled or rotated ("select"; cut from `image`, the picture as it was at the first crop),
 * annotation strokes drawn on it (normalized; "annotate"), and a note. "run": the picture's own handles work instead
 * (what was shown stays drawn).
 */
export type EditMode = "run" | "select" | "annotate";
export type PictureEdit = { mode: EditMode; marks: { x: number; y: number }[][]; manipulations: PreviewManipulation[]; image: string; note: string };
/** Whether anything was shown on the picture (or written). */
export const pictureEdited = (edit: Pick<PictureEdit, "marks" | "manipulations" | "note">) => edit.marks.length > 0 || edit.manipulations.some(manipulated) || edit.note.trim().length > 0;
