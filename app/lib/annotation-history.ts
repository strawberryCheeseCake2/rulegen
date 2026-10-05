import { MAX_RESULT_STROKES, ART_WIDTH as W, ART_HEIGHT as H, type Point, type ResultAnnotation } from "./schema";

export type AnnotationHistory = { present: ResultAnnotation[]; past: ResultAnnotation[][]; future: ResultAnnotation[][] };
type Action = { type: "add"; annotation: ResultAnnotation } | { type: "remove"; ids: string[] } | { type: "clear" | "undo" | "redo" | "reset" };
export const emptyAnnotationHistory = (): AnnotationHistory => ({ present: [], past: [], future: [] });
export function annotationHistoryReducer(state: AnnotationHistory, action: Action): AnnotationHistory {
  if (action.type === "reset") return emptyAnnotationHistory();
  if (action.type === "undo") {
    if (!state.past.length) return state;
    return { present: state.past[state.past.length - 1], past: state.past.slice(0, -1), future: [...state.future, state.present] };
  }
  if (action.type === "redo") {
    if (!state.future.length) return state;
    return { present: state.future[state.future.length - 1], past: [...state.past, state.present], future: state.future.slice(0, -1) };
  }
  const present = action.type === "add"
    ? state.present.length < MAX_RESULT_STROKES ? [...state.present, action.annotation] : state.present
    : action.type === "remove" ? state.present.filter(a => !action.ids.includes(a.id)) : [];
  if (present === state.present || (present.length === state.present.length && present.every((a, i) => a === state.present[i]))) return state;
  return { present, past: [...state.past.slice(-39), state.present], future: [] };
}

function distanceToSegment(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
function segmentDistance(a: Point, b: Point, c: Point, d: Point) {
  const cross = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) return 0;
  return Math.min(distanceToSegment(a, c, d), distanceToSegment(b, c, d), distanceToSegment(c, a, b), distanceToSegment(d, a, b));
}
// Convert to artwork pixels so hit distance remains circular on a 3:2 canvas.
export function annotationsHitByEraser(annotations: ResultAnnotation[], from: Point, to: Point, zoom: number): string[] {
  const pixels = (p: Point) => ({ x: p.x * W, y: p.y * H });
  const a = pixels(from), b = pixels(to), radius = 10 / zoom;
  return annotations.filter(note => {
    const points = note.points.map(pixels);
    return points.slice(1).some((p, i) => segmentDistance(a, b, points[i], p) <= radius);
  }).map(note => note.id);
}
