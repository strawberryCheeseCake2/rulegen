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
