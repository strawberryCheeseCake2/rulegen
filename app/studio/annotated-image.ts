import { boxOf, mergeOf, PAPER, placedOutline, type IdealObject, type IdealState } from "../lib/alignment";

/** Normalized (0..1) annotation strokes over the frame. */
export type Marks = { x: number; y: number }[][];

/** Draw annotation strokes over an image (a frame capture) for AI to look at; `styles` (by index) give each its color, width (900-wide canvas pixels) and opacity. */
export async function annotatedImage(image: string, marks: Marks, color = "#7c3aed", styles: { color: string; width: number; opacity: number }[] = []) {
  if (!marks.length) return image;
  const base = new Image(); base.src = image; await base.decode();
  const canvas = document.createElement("canvas"); canvas.width = base.naturalWidth; canvas.height = base.naturalHeight;
  const ctx = canvas.getContext("2d")!; ctx.drawImage(base, 0, 0);
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  marks.forEach((mark, index) => {
    const style = styles[index];
    ctx.strokeStyle = style?.color ?? color; ctx.globalAlpha = style?.opacity ?? 1;
    ctx.lineWidth = style ? Math.max(2, style.width * canvas.width / 900) : Math.max(3, canvas.width / 260);
    ctx.beginPath(); mark.forEach((p, i) => i ? ctx.lineTo(p.x * canvas.width, p.y * canvas.height) : ctx.moveTo(p.x * canvas.width, p.y * canvas.height)); ctx.stroke();
  });
  return canvas.toDataURL("image/png");
}

/** Thin long strokes so the request stays small. */
export const compactMarks = (marks: Marks, max = 64) => marks.slice(-max).map(mark => mark.filter((_, i) => i % Math.max(1, Math.ceil(mark.length / 64)) === 0).slice(0, 64));

/**
 * The state the user drew over a picture, for AI: erased parts and where lifted parts were painted with the paper
 * (their outline dashed), lifted parts drawn where they were put, forms with their outline (merged forms as one
 * outline: every outline stroked, then every inside painted over), lines, and the names given.
 */
export async function idealImage(image: string, state: IdealState) {
  if (!state.objects.length) return image;
  const base = new Image(); base.src = image; await base.decode();
  const canvas = document.createElement("canvas"); canvas.width = base.naturalWidth; canvas.height = base.naturalHeight;
  const ctx = canvas.getContext("2d")!, k = canvas.width / 900; ctx.drawImage(base, 0, 0);
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  const trace = (points: { x: number; y: number }[], closed = true) => { ctx.beginPath(); points.forEach((p, i) => i ? ctx.lineTo(p.x * k, p.y * k) : ctx.moveTo(p.x * k, p.y * k)); if (closed) ctx.closePath(); };
  const of = (kind: IdealObject["kind"]) => state.objects.filter(item => item.kind === kind);
  for (const item of [...of("erase"), ...of("crop")]) {
    trace(item.outline); ctx.fillStyle = PAPER; ctx.fill();
    ctx.save(); ctx.strokeStyle = item.color; ctx.globalAlpha = .7; ctx.lineWidth = Math.max(1.5, 1.5 * k); ctx.setLineDash([6 * k, 5 * k]); ctx.stroke(); ctx.restore();
  }
  for (const item of of("crop")) {
    const c = { x: item.box.x + item.box.w / 2, y: item.box.y + item.box.h / 2 };
    ctx.save(); ctx.translate((c.x + item.dx) * k, (c.y + item.dy) * k); ctx.rotate(item.rotate * Math.PI / 180); ctx.scale(item.scale, item.scale); ctx.translate(-c.x * k, -c.y * k);
    trace(item.outline); ctx.save(); ctx.clip(); ctx.drawImage(base, 0, 0); ctx.restore();
    ctx.strokeStyle = item.color; ctx.lineWidth = Math.max(2, 2 * k) / item.scale; ctx.stroke(); ctx.restore();
  }
  const groups = [...state.merges.map(merge => of("shape").filter(item => merge.members.includes(item.id))).filter(items => items.length > 1),
    ...of("shape").filter(item => !mergeOf(state, item.id)).map(item => [item])];
  for (const items of groups) {
    const outlines = items.map(placedOutline);
    ctx.strokeStyle = items[0].color; ctx.lineWidth = (items.length > 1 ? 7 : 3.5) * k;
    for (const points of outlines) { trace(points); ctx.stroke(); }
    if (items.length > 1) for (const points of outlines) { trace(points); ctx.fillStyle = PAPER; ctx.fill(); }
    ctx.save(); ctx.globalAlpha = .14; ctx.fillStyle = items[0].color; for (const points of outlines) { trace(points); ctx.fill(); } ctx.restore();
  }
  for (const item of of("line")) { trace(placedOutline(item), false); ctx.strokeStyle = item.color; ctx.lineWidth = 4 * k; ctx.stroke(); }
  // Items of the picture pointed at as they are: a dashed outline around each.
  for (const item of of("item")) { trace(item.outline); ctx.save(); ctx.strokeStyle = item.color; ctx.lineWidth = 2.5 * k; ctx.setLineDash([7 * k, 4 * k]); ctx.stroke(); ctx.restore(); }
  // Names on what they name.
  ctx.font = `600 ${Math.round(17 * k)}px Inter, Arial, sans-serif`; ctx.textAlign = "center";
  const named = [...state.objects.filter(item => item.label && !mergeOf(state, item.id)?.label).map(item => ({ text: item.label, color: item.color, points: placedOutline(item) })),
    ...state.merges.filter(merge => merge.label).map(merge => ({ text: merge.label, color: state.objects.find(item => merge.members.includes(item.id))?.color ?? "#1f2328", points: state.objects.filter(item => merge.members.includes(item.id)).flatMap(placedOutline) }))];
  for (const label of named) {
    if (!label.points.length) continue;
    const box = boxOf(label.points), x = Math.min(880, Math.max(20, box.x + box.w / 2)) * k, y = Math.max(18, box.y - 8) * k;
    ctx.lineWidth = 4 * k; ctx.strokeStyle = PAPER; ctx.strokeText(label.text, x, y); ctx.fillStyle = label.color; ctx.fillText(label.text, x, y);
  }
  return canvas.toDataURL("image/png");
}
