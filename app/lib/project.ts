import { brushSchema, MAX_BRUSHES } from "./brushes";
import { z } from "zod";
import { pointSchema, imageSchema, semanticPenSchema, type Stroke } from "./schema";
import { createInteractionPen } from "./algorithm-pens";
import { ensureFramePositions, workspaceSchema } from "./workspace";
import { sketchPanelSchema } from "./sketch-panels";
const strokeSchema = z.object({ points: z.array(pointSchema).max(6000), color: z.string(), width: z.number().min(.1).max(100), opacity: z.number().min(0).max(1), tool: z.enum(["pen", "eraser"]), semanticPen: semanticPenSchema.optional() });
const artworkSchema = z.object({ strokes: z.array(strokeSchema).max(500), photo: imageSchema.nullable(), name: z.string(), revision: z.number() });
export const sketchFrameSchema = z.object({ id: z.string().regex(/^sketch-[a-zA-Z0-9-]+$/).max(80), artwork: artworkSchema });
export type SketchFrame = z.infer<typeof sketchFrameSchema>;
export const projectSchema = z.object({ version: z.literal(2), name: z.string().max(200), artwork: artworkSchema, sketchFrames: z.array(sketchFrameSchema).max(24).default([]), activeSketchId: z.string().max(80).default("source"), sketchPanels: z.record(z.string(), sketchPanelSchema).default({}), semanticPens: z.array(semanticPenSchema).max(32).default([]), interactionPen: semanticPenSchema.default(createInteractionPen), activeSemanticPenId: z.string().max(80).nullable().default(null), brushes: z.array(brushSchema).max(MAX_BRUSHES).default([]), workspace: workspaceSchema.default(() => workspaceSchema.parse({})) }).superRefine((project, ctx) => {
  const ids = project.sketchFrames.map(f => f.id);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", message: "스케치 프레임 ID와 위치를 확인해주세요." });
  if (project.interactionPen.kind !== "interaction") ctx.addIssue({ code: "custom", message: "Interaction pen을 확인해주세요." });
}).transform(project => {
  const ids = ["source", ...project.sketchFrames.map(f => f.id)];
  const sketchPanels = Object.fromEntries(ids.map(id => [id, project.sketchPanels[id] || sketchPanelSchema.parse({})]));
  return { ...project, sketchPanels, activeSemanticPenId: [...project.semanticPens, project.interactionPen].some(p => p.id === project.activeSemanticPenId) ? project.activeSemanticPenId : null,
    activeSketchId: ids.includes(project.activeSketchId) ? project.activeSketchId : "source", workspace: { ...project.workspace, frames: ensureFramePositions(project.workspace.frames, ids) } };
});
export function exampleStrokes(): Stroke[] {
  const strokes: Stroke[] = [];
  function branch(x: number, y: number, length: number, angle: number, depth: number, seed: number) {
    if (depth === 0) return;
    const nx = x + Math.cos(angle) * length, ny = y + Math.sin(angle) * length;
    strokes.push({ points: Array.from({ length: 10 }, (_, i) => { const t = i / 9; return { x: x + (nx - x) * t + Math.sin(t * Math.PI) * Math.sin(seed * 8) * 4, y: y + (ny - y) * t }; }), color: "#75664e", width: depth * .6 + .5, opacity: .8, tool: "pen" });
    branch(nx, ny, length * .71, angle - .47 + Math.sin(seed) * .07, depth - 1, seed + 1.3);
    branch(nx, ny, length * .69, angle + .49 + Math.cos(seed) * .08, depth - 1, seed + 2.7);
  }
  branch(450, 540, 145, -Math.PI / 2, 6, 2); return strokes;
}
export function downloadFile(name: string, contents: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([contents], { type })); const a = document.createElement("a"); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function readPhoto(file: File) {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error("PNG, JPG, WebP 사진을 첨부해주세요.");
  if (file.size > 20_000_000) throw new Error("20MB 이하의 사진을 첨부해주세요.");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image(); image.src = url; await image.decode();
    const canvas = document.createElement("canvas"); const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight)); canvas.width = Math.round(image.naturalWidth * scale); canvas.height = Math.round(image.naturalHeight * scale);
    const ctx = canvas.getContext("2d")!; ctx.fillStyle = "#fffefa"; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", .9);
  } finally { URL.revokeObjectURL(url); }
}
