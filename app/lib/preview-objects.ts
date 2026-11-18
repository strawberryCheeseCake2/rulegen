// Parts of a picture handled by hand: a freeform outline drawn around them (canvas pixels),
// then moved, scaled or rotated about its center.

export type Box = { x: number; y: number; w: number; h: number };
type Point = { x: number; y: number };
/** Where a part is: the box around its outline where it was made, then moved (its center), scaled and rotated (degrees, clockwise). */
export type Placement = { box: Box; dx: number; dy: number; scale: number; rotate: number };
/** Points kept of an outline (canvas pixels). */
export const MAX_CROP_POINTS = 64;

/** SVG path of an outline (closed), or of a line (`closed` false). */
export const outlinePath = (outline: Point[], closed = true) => outline.length ? `M${outline.map(p => `${p.x},${p.y}`).join("L")}${closed ? "Z" : ""}` : "";

export const centerOf = (box: Box) => ({ x: box.x + box.w / 2, y: box.y + box.h / 2 });
/** Where a part's box is now: its center, half size and rotation (radians). */
export function placed(item: Placement) {
  const c = centerOf(item.box);
  return { cx: c.x + item.dx, cy: c.y + item.dy, hw: item.box.w / 2 * item.scale, hh: item.box.h / 2 * item.scale, angle: item.rotate * Math.PI / 180 };
}
/** A point of the part's box given in its own frame (u, v from -1 to 1), in canvas pixels. */
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
/** A point (canvas pixels) back where the part was made (undoing its move, scale and rotation). */
function unplaced(item: Placement, point: Point) {
  const { cx, cy, angle } = placed(item), c = centerOf(item.box), x = point.x - cx, y = point.y - cy;
  return { x: c.x + (x * Math.cos(-angle) - y * Math.sin(-angle)) / item.scale, y: c.y + (x * Math.sin(-angle) + y * Math.cos(-angle)) / item.scale };
}
/** Whether a point (canvas pixels) is on the part where it is now: inside its outline (a few pixels of slack). */
export function onCrop(item: Placement & { outline: Point[] }, point: Point, slack = 4) {
  const at = unplaced(item, point), c = centerOf(item.box), outline = item.outline;
  if (outline.length < 3) return Math.abs(at.x - c.x) <= item.box.w / 2 + slack && Math.abs(at.y - c.y) <= item.box.h / 2 + slack;
  let inside = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const a = outline[i], b = outline[j];
    if ((a.y > at.y) !== (b.y > at.y) && at.x < (b.x - a.x) * (at.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside || nearPath(item, point, slack, true);
}
/** Whether a point is within `slack` pixels of the part's outline (a line when not `closed`) where it is now. */
export function nearPath(item: Placement & { outline: Point[] }, point: Point, slack = 4, closed = false) {
  const at = unplaced(item, point), outline = item.outline, segments = closed ? outline.length : outline.length - 1;
  for (let i = 0; i < segments; i++) {
    const a = outline[i], b = outline[(i + 1) % outline.length], dx = b.x - a.x, dy = b.y - a.y, t = Math.max(0, Math.min(1, ((at.x - a.x) * dx + (at.y - a.y) * dy) / Math.max(1e-9, dx * dx + dy * dy)));
    if (Math.hypot(at.x - a.x - t * dx, at.y - a.y - t * dy) * item.scale <= slack) return true;
  }
  return false;
}

/** Dragging the part (move), its corner (scale about its center) or its rotate grip, from where it was when the drag began. */
export function dragManipulation<T extends Placement>(start: T, part: "move" | "scale" | "rotate", from: Point, to: Point): T {
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
