import type { ResultAnnotation } from "./schema";

// The feature/rule diff that used to live here is replaced by lib/scene/revisions.
export async function annotatedResultImage(image: string, annotations: ResultAnnotation[]) {
  const source = new Image(); source.src = image; await source.decode();
  const canvas = document.createElement("canvas"); canvas.width = 900; canvas.height = 600;
  const ctx = canvas.getContext("2d")!; ctx.drawImage(source, 0, 0, 900, 600);
  annotations.forEach(a => {
    ctx.strokeStyle = "#db624a"; ctx.lineWidth = 3; ctx.beginPath();
    a.points.forEach((p, j) => j ? ctx.lineTo(p.x * 900, p.y * 600) : ctx.moveTo(p.x * 900, p.y * 600)); ctx.stroke();
  });
  return canvas.toDataURL("image/png");
}
