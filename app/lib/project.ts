import { brushSchema, MAX_BRUSHES } from "./brushes";
import { z } from "zod";
import { pointSchema, imageSchema, semanticPenSchema, type Stroke } from "./schema";
import { createInteractionPen } from "./algorithm-pens";
import { ensureFramePositions, liveGroups, MAX_SKETCH_FRAMES, workspaceSchema } from "./workspace";
import { sketchPanelSchema } from "./sketch-panels";
import { MAX_PROXY_FRAMES, proxyFrameSchema } from "./proxy-frames";
import { MAX_EXPLORE_FRAMES, savedExploreFrameSchema } from "./explore";
const strokeSchema = z.object({ points: z.array(pointSchema).max(6000), color: z.string(), width: z.number().min(.1).max(100), opacity: z.number().min(0).max(1), tool: z.enum(["pen", "eraser"]), semanticPen: semanticPenSchema.optional() });
const artworkSchema = z.object({ strokes: z.array(strokeSchema).max(500), photo: imageSchema.nullable(), name: z.string(), revision: z.number() });
/** A recommendation's fork slot as saved (the version it would make is read again from its tool and frames). */
export const savedForkSlotSchema = z.object({ id: z.string().regex(/^slot-/).max(80), targetFrameId: z.string().max(80), brushId: z.string().max(80), toolId: z.string().max(80),
  index: z.number().int().min(0), key: z.string().max(400), title: z.string().max(200), detail: z.string().max(2000) });
export const MAX_FORK_SLOTS = 48;
/** A list of saved items where one that no longer reads is left out (not the whole project). */
const readable = <T extends z.ZodTypeAny>(item: T, max: number) => z.preprocess(value => Array.isArray(value) ? value.filter(entry => item.safeParse(entry).success) : value, z.array(item).max(max)).default([]);
export const sketchFrameSchema = z.object({ id: z.string().regex(/^sketch-[a-zA-Z0-9-]+$/).max(80), artwork: artworkSchema });
export type SketchFrame = z.infer<typeof sketchFrameSchema>;
export const projectSchema = z.object({ version: z.literal(2), name: z.string().max(200), artwork: artworkSchema, sketchFrames: z.array(sketchFrameSchema).max(MAX_SKETCH_FRAMES).default([]), activeSketchId: z.string().max(80).default("source"), sketchPanels: z.record(z.string(), sketchPanelSchema).default({}), semanticPens: z.array(semanticPenSchema).max(32).default([]), interactionPen: semanticPenSchema.default(createInteractionPen), activeSemanticPenId: z.string().max(80).nullable().default(null), brushes: z.array(brushSchema).max(MAX_BRUSHES).default([]), proxyFrames: z.preprocess(value => Array.isArray(value) ? value.filter(frame => !(frame && typeof frame === "object" && "kind" in frame && frame.kind !== "handles")) : value, z.array(proxyFrameSchema).max(MAX_PROXY_FRAMES)).default([]), workspace: workspaceSchema.default(() => workspaceSchema.parse({})),
  /** Exploration frames (Execution, key parameters) and fork slots: with their frame groups. */
  exploreFrames: readable(savedExploreFrameSchema, MAX_EXPLORE_FRAMES), forkSlots: readable(savedForkSlotSchema, MAX_FORK_SLOTS) }).superRefine((project, ctx) => {
  const ids = project.sketchFrames.map(f => f.id);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", message: "스케치 프레임 ID와 위치를 확인해주세요." });
  if (project.interactionPen.kind !== "interaction") ctx.addIssue({ code: "custom", message: "Interaction pen을 확인해주세요." });
}).transform(project => {
  const ids = ["source", ...project.sketchFrames.map(f => f.id)];
  const sketchPanels = Object.fromEntries(ids.map(id => [id, project.sketchPanels[id] || sketchPanelSchema.parse({})]));
  // A proxy frame goes with its target frame.
  const proxyFrames = [...new Map(project.proxyFrames.filter(frame => ids.includes(frame.targetFrameId)).map(frame => [frame.id, frame])).values()];
  // Exploration frames and fork slots go with the frame they were made from.
  const exploreFrames = [...new Map(project.exploreFrames.filter(frame => ids.includes(frame.targetFrameId)).map(frame => [frame.id, frame])).values()];
  const forkSlots = [...new Map(project.forkSlots.filter(slot => ids.includes(slot.targetFrameId)).map(slot => [slot.id, slot])).values()];
  const kept = [...ids, ...proxyFrames.map(frame => frame.id), ...exploreFrames.map(frame => frame.id), ...forkSlots.map(slot => slot.id)];
  return { ...project, sketchPanels, proxyFrames, exploreFrames, forkSlots, activeSemanticPenId: [...project.semanticPens, project.interactionPen].some(p => p.id === project.activeSemanticPenId) ? project.activeSemanticPenId : null,
    activeSketchId: ids.includes(project.activeSketchId) ? project.activeSketchId : "source", workspace: { ...project.workspace, frames: ensureFramePositions(withoutLost(project.workspace.frames, new Set(kept)), kept),
      // Groups keep the frames they hold that are still there.
      groups: liveGroups(project.workspace.groups, new Set(kept)) } };
});
/** Spots of exploration frames and fork slots that were not kept go too. */
const withoutLost = <T extends Record<string, unknown>>(frames: T, kept: Set<string>) => Object.fromEntries(Object.entries(frames).filter(([id]) => !(id.startsWith("explore-") || id.startsWith("slot-")) || kept.has(id))) as T;
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
