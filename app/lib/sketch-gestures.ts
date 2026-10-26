// Sketched gestures: in an exploration frame a step can be performed by drawing a
// mark on what it works on, as one would on paper, then submitting it: an X over what
// is removed, a circle around what is kept, an arrow carrying something to where it
// goes, a stroke cutting through, a line joining two things, a tap, a check, a scribble
// over what is erased, tracing along a path, or any mark AI draws as a template (a
// wave, a spiral, a bracket …). The mark is recognized from the strokes (canvas pixels)
// and must be where the step is.

export const SKETCH_SHAPES = ["x", "circle", "arrow", "cut", "line", "tap", "check", "scribble", "trace", "custom"] as const;
export type SketchShape = (typeof SKETCH_SHAPES)[number];
type Point = { x: number; y: number };
export type Area = { x: number; y: number; w: number; h: number };
export const SHAPE_NAMES: Record<SketchShape, string> = { x: "X 표시", circle: "동그라미", arrow: "화살표", cut: "가르는 선", line: "선", tap: "콕 찍기", check: "체크 표시", scribble: "덧칠", trace: "따라 그리기", custom: "표시" };
/** What a mark is checked against: the area it goes on, and for some shapes where it goes to, the path to follow, or the mark's own shape. */
export type MarkSpec = { shape: SketchShape; area: Area; to?: Point | null; path?: Point[]; template?: Point[] };

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const pathLength = (points: Point[]) => points.slice(1).reduce((sum, point, i) => sum + distance(points[i], point), 0);
/** 1 for a straight stroke, less the more it bends. */
const straightness = (points: Point[]) => points.length < 2 ? 0 : distance(points[0], points.at(-1)!) / Math.max(1, pathLength(points));
const box = (points: Point[]) => {
  const xs = points.map(point => point.x), ys = points.map(point => point.y), x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
};
const center = (area: Area) => ({ x: area.x + area.w / 2, y: area.y + area.h / 2 });
const normal = (area: Area) => ({ x: Math.min(area.x, area.x + area.w), y: Math.min(area.y, area.y + area.h), w: Math.abs(area.w), h: Math.abs(area.h) });
const margin = (area: Area) => Math.max(24, Math.max(Math.abs(area.w), Math.abs(area.h)) * .25);
const within = (point: Point, area: Area, room = margin(area)) => { const a = normal(area); return point.x >= a.x - room && point.x <= a.x + a.w + room && point.y >= a.y - room && point.y <= a.y + a.h + room; };
/** Whether the mark is on the area (its middle within the area, with some room around a small one). */
const onArea = (points: Point[], area: Area) => within(center(box(points)), area);
const crosses = (a: Point, b: Point, c: Point, d: Point) => {
  const side = (p: Point, q: Point, r: Point) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return side(a, b, c) !== side(a, b, d) && side(c, d, a) !== side(c, d, b);
};
const inside = (polygon: Point[], point: Point) => {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y || 1e-9) + a.x) hit = !hit;
  }
  return hit;
};
/** The stroke as `n` points evenly spaced along it. */
export function resample(points: Point[], n = 32): Point[] {
  const total = pathLength(points); if (points.length < 2 || total === 0) return Array.from({ length: n }, () => points[0] ?? { x: 0, y: 0 });
  const out = [points[0]], step = total / (n - 1); let carried = 0;
  for (let i = 1; i < points.length && out.length < n; i++) {
    let a = points[i - 1]; const b = points[i]; let gap = distance(a, b);
    while (carried + gap >= step && out.length < n) { const t = (step - carried) / gap, q = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; out.push(q); a = q; gap = distance(a, b); carried = 0; }
    carried += gap;
  }
  while (out.length < n) out.push(points.at(-1)!);
  return out;
}
/** A shape scaled into a unit box (keeping its proportions), so marks of any size compare. */
const unit = (points: Point[]) => { const b = box(points), size = Math.max(1, b.w, b.h); return points.map(point => ({ x: (point.x - b.x) / size, y: (point.y - b.y) / size })); };
/** How far apart two shapes are (0: the same), drawn either way round. */
function shapeDistance(a: Point[], b: Point[]) {
  const p = unit(resample(a)), q = unit(resample(b)), r = [...q].reverse();
  const mean = (other: Point[]) => p.reduce((sum, point, i) => sum + distance(point, other[i]), 0) / p.length;
  return Math.min(mean(q), mean(r));
}

/**
 * Whether the strokes drawn so far make the mark, and what to tell the user
 * (Korean): what is recognized, or what is still missing.
 */
export function recognizeMark(spec: MarkSpec, strokes: Point[][]): { ok: boolean; message: string } {
  const { shape, area } = spec;
  const drawn = strokes.filter(stroke => stroke.length > 0);
  const last = drawn.at(-1), name = SHAPE_NAMES[shape];
  if (!last) return { ok: false, message: `${name}를 그려주세요.` };
  const ok = { ok: true, message: `${name}를 알아봤습니다. 제출하면 이 단계가 실행됩니다.` };
  const where = (points: Point[]) => onArea(points, area) ? ok : { ok: false, message: `${name}를 표시된 자리 위에 그려주세요.` };
  if (shape === "tap") return pathLength(last) <= 12 ? (within(last[0], area, 12) ? ok : { ok: false, message: "표시된 자리를 콕 찍어주세요." }) : { ok: false, message: "끌지 말고 한 번 콕 찍어주세요." };
  if (pathLength(last) < 8) return { ok: false, message: `${name}를 그려주세요.` };
  if (shape === "x") {
    const lines = drawn.filter(stroke => pathLength(stroke) >= 8);
    if (lines.length < 2) return { ok: false, message: "두 번째 획을 그어 X를 완성하세요." };
    const [a, b] = lines.slice(-2);
    if (straightness(a) < .7 || straightness(b) < .7 || pathLength(a) < 16 || pathLength(b) < 16) return { ok: false, message: "X는 곧은 두 획으로 그어주세요." };
    if (!crosses(a[0], a.at(-1)!, b[0], b.at(-1)!)) return { ok: false, message: "두 획이 서로 교차하게 그어주세요." };
    const u = { x: a.at(-1)!.x - a[0].x, y: a.at(-1)!.y - a[0].y }, v = { x: b.at(-1)!.x - b[0].x, y: b.at(-1)!.y - b[0].y };
    const angle = Math.acos(Math.min(1, Math.abs(u.x * v.x + u.y * v.y) / Math.max(1e-9, Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y)))) * 180 / Math.PI;
    if (angle < 35) return { ok: false, message: "두 획이 엇갈리게(X 모양으로) 그어주세요." };
    return where([...a, ...b]);
  }
  if (shape === "circle") {
    const size = box(last), span = Math.max(size.w, size.h);
    if (span < 16 || pathLength(last) < 40) return { ok: false, message: "조금 더 크게 둘러 그려주세요." };
    if (distance(last[0], last.at(-1)!) > Math.max(20, span * .35)) return { ok: false, message: "처음 자리까지 이어서 둘러싸 주세요." };
    return inside(last, center(area)) || onArea(last, area) ? ok : { ok: false, message: "표시된 자리를 둘러싸 주세요." };
  }
  if (shape === "arrow" || shape === "line") {
    if (straightness(last) < (shape === "arrow" ? .75 : .85) || pathLength(last) < 30) return { ok: false, message: shape === "arrow" ? "한 번에 쭉 그어주세요." : "곧게 한 번에 그어주세요." };
    // An arrow starts on what moves and ends where it goes; a line joins the area's ends (or lies on it).
    if (shape === "arrow" && spec.to) {
      if (!within(last[0], area)) return { ok: false, message: "옮길 것에서 시작해 그어주세요." };
      return distance(last.at(-1)!, spec.to) <= Math.max(28, distance(last[0], spec.to) * .3) ? ok : { ok: false, message: "가야 할 자리까지 그어주세요." };
    }
    return where(last);
  }
  if (shape === "cut") {
    // Through it: from outside, across, to outside.
    const a = normal(area), corners = [{ x: a.x, y: a.y }, { x: a.x + a.w, y: a.y }, { x: a.x + a.w, y: a.y + a.h }, { x: a.x, y: a.y + a.h }];
    const through = corners.some((corner, i) => crosses(last[0], last.at(-1)!, corner, corners[(i + 1) % 4]));
    if (straightness(last) < .7) return { ok: false, message: "한 번에 곧게 그어 갈라주세요." };
    return through && !within(last[0], area, 0) && !within(last.at(-1)!, area, 0) ? ok : { ok: false, message: "바깥에서 시작해 표시된 것을 가로질러 반대편까지 그어주세요." };
  }
  if (shape === "check") {
    // Down to a lowest point partway, then up farther than it came down.
    let low = 0; last.forEach((point, i) => { if (point.y > last[low].y) low = i; });
    const fraction = low / Math.max(1, last.length - 1), down = last[low].y - last[0].y, up = last[low].y - last.at(-1)!.y;
    if (fraction < .1 || fraction > .8 || down < 6 || up < down * 1.1 || Math.sign(last[low].x - last[0].x) !== Math.sign(last.at(-1)!.x - last[low].x)) return { ok: false, message: "✓ 모양으로 짧게 내렸다가 길게 올려 그어주세요." };
    return where(last);
  }
  if (shape === "scribble") {
    const size = box(last);
    let turns = 0, before = 0;
    for (let i = 1; i < last.length; i++) { const dx = Math.sign(last[i].x - last[i - 1].x); if (dx && before && dx !== before) turns++; if (dx) before = dx; }
    if (turns < 3 || pathLength(last) < 2 * (size.w + size.h)) return { ok: false, message: "그 자리를 여러 번 왔다 갔다 덧칠해주세요." };
    return where(last);
  }
  if (shape === "trace") {
    // Along the path, close to it, most of the way.
    const path = spec.path ?? [];
    if (path.length < 2) return where(last);
    const near = (point: Point, points: Point[]) => Math.min(...points.map(other => distance(point, other)));
    const tolerance = Math.max(18, Math.max(box(path).w, box(path).h) * .12), drawnPoints = resample(last, 40), pathPoints = resample(path, 40);
    if (drawnPoints.reduce((sum, point) => sum + near(point, pathPoints), 0) / drawnPoints.length > tolerance) return { ok: false, message: "표시된 길을 따라 가깝게 그려주세요." };
    return pathPoints.filter(point => near(point, drawnPoints) <= tolerance * 1.5).length >= pathPoints.length * .7 ? ok : { ok: false, message: "길을 끝까지 따라 그려주세요." };
  }
  // custom: the mark AI drew as a template, at any size, on the area.
  const template = spec.template ?? [];
  if (template.length < 2) return where(last);
  return shapeDistance(drawn.length > 1 ? drawn.flat() : last, template) <= .2 ? where(drawn.flat()) : { ok: false, message: "보이는 모양처럼 그려주세요." };
}
