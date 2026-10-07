import { z } from "zod";
import { pointSchema, featureSchema, brushSchema, generatedSchema, imageSchema, semanticPenSchema, type Stroke } from "./schema";
import { legacySemanticPen } from "./algorithm-pens";
import { savedGroupSchema } from "./subfeatures";
import { ensureFramePositions, ensureResultFramePositions, workspaceSchema } from "./workspace";
import { sketchPanelSchema } from "./sketch-panels";
const strokeSchema = z.object({ points: z.array(pointSchema).max(6000), color: z.string(), width: z.number().min(.1).max(100), opacity: z.number().min(0).max(1), tool: z.enum(["pen", "eraser", "brush"]), brush: brushSchema.optional(), semanticPen: semanticPenSchema.optional() }).transform(stroke => {
  if (!stroke.semanticPen && stroke.brush?.algorithm) { const pen = legacySemanticPen(stroke.brush)!; return { ...stroke, tool: "pen" as const, color: pen.color, semanticPen: pen, brush: undefined }; }
  return stroke;
});
const artworkSchema = z.object({ strokes: z.array(strokeSchema).max(500), photo: imageSchema.nullable(), name: z.string(), revision: z.number() });
export const sketchFrameSchema = z.object({ id: z.string().regex(/^sketch-[a-zA-Z0-9-]+$/).max(80), artwork: artworkSchema });
export type SketchFrame = z.infer<typeof sketchFrameSchema>;
export const projectSchema = z.object({ version: z.literal(1), name: z.string().max(200), artwork: artworkSchema, sourceVisible: z.boolean().default(true), sketchFrames: z.array(sketchFrameSchema).max(24).default([]), featureSourceId: z.string().max(80).default("source"), activeSketchId: z.string().max(80).default(""), sketchPanels: z.record(z.string(), sketchPanelSchema).default({}), features: z.array(featureSchema).max(8), groups: z.array(savedGroupSchema).max(8), analysisRevision: z.number(), generated: generatedSchema.nullable(), brush: brushSchema.nullable(), savedBrushes: z.array(brushSchema).max(32), drawingBrush: brushSchema.nullable().default(null), semanticPens: z.array(semanticPenSchema).max(32).default([]), activeSemanticPenId: z.string().max(80).nullable().default(null), brushDescription: z.string().max(2000).default(""), workspace: workspaceSchema.default(() => workspaceSchema.parse({})) }).superRefine((project, ctx) => {
  const ids = project.sketchFrames.map(f => f.id);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", message: "스케치 프레임 ID와 위치를 확인해주세요." });
  if (project.featureSourceId !== "source" && !ids.includes(project.featureSourceId)) ctx.addIssue({ code: "custom", message: "분석한 스케치 프레임을 찾지 못했습니다." });
}).transform(project => {
  const ids = ["source", ...project.sketchFrames.map(f => f.id)];
  const visibleIds = ids.filter(id => id !== "source" || project.sourceVisible);
  const sketchPanels = Object.fromEntries(ids.map(id => [id, project.sketchPanels[id] || sketchPanelSchema.parse(id === project.featureSourceId ? { features: project.features, groups: project.groups, analysisRevision: project.analysisRevision, generated: project.generated, brush: project.brush, brushDescription: project.brushDescription } : {})]));
  if (!project.sourceVisible) sketchPanels.source = sketchPanelSchema.parse({});
  const recovered = [project.brush, project.drawingBrush, ...project.savedBrushes, ...Object.values(sketchPanels).map(p => p.brush)].filter(recipe => recipe?.algorithm).map(recipe => legacySemanticPen(recipe!)!);
  const semanticPens = [...new Map([...project.semanticPens, ...recovered].map(pen => [pen.id, pen])).values()].slice(0, 32);
  for (const panel of Object.values(sketchPanels)) if (panel.brush?.algorithm) panel.brush = null;
  const previousPen = project.drawingBrush?.algorithm ? legacySemanticPen(project.drawingBrush)?.id : null;
  const wantedPen = project.activeSemanticPenId || previousPen;
  const resultOwners = visibleIds.filter(id => id === "source" || sketchPanels[id].generated);
  const activeSketchId = visibleIds.includes(project.activeSketchId) ? project.activeSketchId : visibleIds.includes(project.featureSourceId) ? project.featureSourceId : visibleIds[0] || "source";
  const frames = { ...project.workspace.frames };
  for (const id of Object.keys(frames)) {
    if (id.startsWith("sketch-") && !visibleIds.includes(id) || id.startsWith("result-sketch-") && !resultOwners.includes(id.slice(7))) delete frames[id];
  }
  return { ...project, sketchPanels, semanticPens, activeSemanticPenId: semanticPens.some(p => p.id === wantedPen) ? wantedPen! : null, savedBrushes: project.savedBrushes.filter(b => !b.algorithm), brush: project.brush?.algorithm ? null : project.brush, drawingBrush: project.drawingBrush?.algorithm ? null : project.drawingBrush, activeSketchId, workspace: { ...project.workspace, frames: ensureResultFramePositions(ensureFramePositions(frames, visibleIds), resultOwners) } };
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
