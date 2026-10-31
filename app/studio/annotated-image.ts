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
 * Direct manipulations of a preview's objects drawn over its picture for AI: each object's region carried where the
 * user moved, scaled and rotated it, its box before dashed and after solid (in `color`).
 */
export async function manipulatedImage(image: string, items: { box: { x: number; y: number; w: number; h: number }; outline?: { x: number; y: number }[]; dx: number; dy: number; scale: number; rotate: number }[], color = "#0e7490") {
  if (!items.length) return image;
  const base = new Image(); base.src = image; await base.decode();
  const canvas = document.createElement("canvas"); canvas.width = base.naturalWidth; canvas.height = base.naturalHeight;
  const ctx = canvas.getContext("2d")!, k = canvas.width / 900; ctx.drawImage(base, 0, 0);
  for (const item of items) {
    const { x, y, w, h } = item.box, cx = (x + w / 2) * k, cy = (y + h / 2) * k, outline = item.outline ?? [];
    // The crop's outline (its box when it has none), around its center.
    const trace = (dx: number, dy: number) => { ctx.beginPath(); if (outline.length > 2) { outline.forEach((p, i) => i ? ctx.lineTo(p.x * k + dx, p.y * k + dy) : ctx.moveTo(p.x * k + dx, p.y * k + dy)); ctx.closePath(); } else ctx.rect(x * k + dx, y * k + dy, w * k, h * k); };
    ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = Math.max(2, 2 * k); ctx.setLineDash([6 * k, 5 * k]); trace(0, 0); ctx.stroke(); ctx.restore();
    ctx.save(); ctx.translate(cx + item.dx * k, cy + item.dy * k); ctx.rotate(item.rotate * Math.PI / 180); ctx.scale(item.scale, item.scale);
    trace(-cx, -cy); ctx.save(); ctx.clip(); ctx.drawImage(base, -cx, -cy); ctx.restore();
    ctx.strokeStyle = color; ctx.lineWidth = Math.max(2, 2.5 * k) / item.scale; ctx.stroke(); ctx.restore();
  }
  return canvas.toDataURL("image/png");
}
