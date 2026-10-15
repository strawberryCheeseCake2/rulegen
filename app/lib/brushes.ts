import { z } from "zod";
import { descendantIds, findNode, subScene } from "./scene/graph";
import type { Scene } from "./scene/schema";
import { sceneSchema } from "./scene/validate";
import { inspectResultSchema } from "./inspection";

// A Brush is a reusable collection ("Brush Stamp"). Every root collection AI
// creates becomes a brush tool group in the toolbar: its brush tool stamps the
// collection into a sketch frame, and its inspection tools debug that brush only.

/** A targeted inspection tool: made from one inspection annotation + concern, reusable afterwards. */
export const targetedToolSchema = z.object({
  id: z.string().min(1).max(80), name: z.string().min(1).max(100), concern: z.string().max(2000),
  marks: z.array(z.array(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })).max(2000)).max(64),
  result: inspectResultSchema,
});
export type TargetedTool = z.infer<typeof targetedToolSchema>;
export const MAX_TARGETED = 12;

export const brushSchema = z.object({
  id: z.string().min(1).max(80), name: z.string().min(1).max(100), color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  /** Where the collection lives; stamping copies the live node when it still exists. */
  sourceFrameId: z.string().max(80), nodeId: z.string().max(80),
  /** The collection with its members, kept for when the source is gone. */
  scene: sceneSchema,
  /** "stamp": a click stamps once, a drag stamps along the path. "drag": a drag drives the collection's own interaction. */
  gesture: z.enum(["stamp", "drag"]).default("stamp"),
  /** Its code module (as stored in a program), kept for when the source frame or its code is gone. */
  code: z.string().max(120000).default(""),
  /** Targeted inspection tools created with the inspection annotation tool. */
  targeted: z.array(targetedToolSchema).max(MAX_TARGETED).default([]),
});
export type Brush = z.infer<typeof brushSchema>;
export const MAX_BRUSHES = 32;

/**
 * Tools of a brush tool group. The fixed ones have ids `<kind>:<brushId>`; each
 * targeted inspection tool is `targeted:<brushId>:<toolId>` and exists only once
 * it has been made from an inspection annotation.
 */
export const BRUSH_TOOLS = ["brush", "inspect", "inspect-annotate"] as const;
export type BrushToolKind = (typeof BRUSH_TOOLS)[number] | "targeted";
export const brushTool = (kind: BrushToolKind, brushId: string, targetedId?: string) => kind === "targeted" ? `targeted:${brushId}:${targetedId}` : `${kind}:${brushId}`;
export function parseBrushTool(tool: string): { kind: BrushToolKind; brushId: string; targetedId?: string } | null {
  const index = tool.indexOf(":"), kind = tool.slice(0, index) as BrushToolKind, rest = tool.slice(index + 1);
  if (kind === "targeted") { const cut = rest.lastIndexOf(":"); return cut > 0 ? { kind, brushId: rest.slice(0, cut), targetedId: rest.slice(cut + 1) } : null; }
  return index > 0 && (BRUSH_TOOLS as readonly string[]).includes(kind) ? { kind, brushId: rest } : null;
}
export const isInspectionTool = (kind: BrushToolKind | undefined) => kind === "inspect" || kind === "inspect-annotate" || kind === "targeted";

const COLORS = ["#c0563f", "#3b7bb8", "#7a5bb5", "#2f8f6b", "#c48a1d", "#b5487f", "#4e8a96", "#8a6a3b"];
const DRAG_WORDS = /drag|드래그|stroke|스트로크|trail|draw|그리|swipe|스와이프|brush|붓|path|경로|follow|따라/i;

/** Does any machine in the subtree react to the user dragging (rather than a click or time)? */
export function dragGesture(scene: Scene, nodeId: string) {
  return [nodeId, ...descendantIds(scene, nodeId)].some(id => findNode(scene, id)?.machine?.transitions.some(transition =>
    transition.trigger === "event" && (DRAG_WORDS.test(transition.id) || DRAG_WORDS.test(transition.label))));
}

/** One brush per root collection of an AI-generated scene (nested collections are parts of it). */
export function brushesFor(scene: Scene, frameId: string, existing: Brush[], newId: () => string): Brush[] {
  const made: Brush[] = [];
  for (const node of scene.nodes) {
    if (node.kind !== "collection" || node.parentId || existing.length + made.length >= MAX_BRUSHES) continue;
    made.push({ id: newId(), name: node.name, color: COLORS[(existing.length + made.length) % COLORS.length], sourceFrameId: frameId, nodeId: node.id,
      scene: subScene(scene, [node.id]), gesture: dragGesture(scene, node.id) ? "drag" : "stamp", code: "", targeted: [] });
  }
  return made;
}

/** Mark each brush's collection in the scene (copies keep the mark, so stamps stay inspectable). */
export function markBrushes(scene: Scene, brushes: Brush[]): Scene {
  const byNode = new Map(brushes.map(brush => [brush.nodeId, brush.id]));
  return { ...scene, nodes: scene.nodes.map(node => byNode.has(node.id) ? { ...node, brushId: byNode.get(node.id) } : node) };
}

/** The collection to stamp: the live node in its source frame, else the saved copy. */
export function brushSource(brush: Brush, liveScene: Scene | undefined): Scene {
  const live = liveScene && findNode(liveScene, brush.nodeId);
  return live ? { ...subScene(liveScene!, [brush.nodeId]), nodes: subScene(liveScene!, [brush.nodeId]).nodes.map(node => node.id === brush.nodeId ? { ...node, brushId: brush.id } : node) } : brush.scene;
}

/** The nodes of a frame that belong to a brush: its marked roots (or the source node) with their members. */
export function brushNodeIds(scene: Scene, brush: Brush, frameId: string) {
  const roots = scene.nodes.filter(node => node.brushId === brush.id || (frameId === brush.sourceFrameId && node.id === brush.nodeId)).map(node => node.id);
  return [...new Set(roots.flatMap(id => [id, ...descendantIds(scene, id)]))];
}
