/** Normalized (0..1) annotation strokes over the frame. */
export type Marks = { x: number; y: number }[][];

/** Draw annotation strokes over an image (a frame capture) for AI to look at. */
export async function annotatedImage(image: string, marks: Marks, color = "#7c3aed") {
  if (!marks.length) return image;
  const base = new Image(); base.src = image; await base.decode();
  const canvas = document.createElement("canvas"); canvas.width = base.naturalWidth; canvas.height = base.naturalHeight;
  const ctx = canvas.getContext("2d")!; ctx.drawImage(base, 0, 0);
  ctx.strokeStyle = color; ctx.lineWidth = Math.max(3, canvas.width / 260); ctx.lineCap = "round"; ctx.lineJoin = "round";
  for (const mark of marks) { ctx.beginPath(); mark.forEach((p, i) => i ? ctx.lineTo(p.x * canvas.width, p.y * canvas.height) : ctx.moveTo(p.x * canvas.width, p.y * canvas.height)); ctx.stroke(); }
  return canvas.toDataURL("image/png");
}

/** Thin long strokes so the request stays small. */
export const compactMarks = (marks: Marks) => marks.slice(0, 64).map(mark => mark.filter((_, i) => i % Math.max(1, Math.ceil(mark.length / 64)) === 0).slice(0, 64));
