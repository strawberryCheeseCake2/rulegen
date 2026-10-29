import { z } from "zod";
import { descendantIds, findNode, subScene } from "./scene/graph";
import type { Scene } from "./scene/schema";
import { sceneSchema } from "./scene/validate";
import { markStyleSchema, MAX_MARKS, MAX_OVERLAY_UPDATES, overlayUpdateSchema, targetedResultSchema } from "./inspection";

// A Brush is a reusable collection or object ("Brush Stamp"). Every root node AI
// creates (but a background) becomes a brush tool group in the toolbar: its brush tool stamps the
// collection into a sketch frame, and its inspection tools debug that brush only.

/** A targeted inspection tool: made from one inspection annotation + concern, reusable afterwards. */
export const targetedToolSchema = z.object({
  id: z.string().min(1).max(80), name: z.string().min(1).max(100), concern: z.string().max(2000),
  marks: z.array(z.array(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })).max(2000)).max(MAX_MARKS),
  markStyles: z.array(markStyleSchema).max(MAX_MARKS).default([]),
  result: targetedResultSchema,
  /** Overlays rebuilt for an applied recommendation (see overlayUpdateSchema), newest last. */
  overlayUpdates: z.array(overlayUpdateSchema).max(MAX_OVERLAY_UPDATES).default([]),
  /** How long the inspection that made this tool took, and whether it also wrote recommendation previews (to compare). */
  timing: z.object({ ms: z.number().nonnegative(), previews: z.boolean() }).optional(),
});
export type TargetedTool = z.infer<typeof targetedToolSchema>;
export const MAX_TARGETED = 12;

export const brushSchema = z.object({
  id: z.string().min(1).max(80), name: z.string().min(1).max(100), color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  /** Where the collection lives; stamping copies the live node when it still exists. */
  sourceFrameId: z.string().max(80), nodeId: z.string().max(80),
  /** The collection with its members, kept for when the source is gone. */
  scene: sceneSchema,
  /** Its code module (as stored in a program), kept for when the source frame or its code is gone. */
  code: z.string().max(120000).default(""),
  /** Targeted inspection tools created with the inspection annotation tool. */
  targeted: z.array(targetedToolSchema).max(MAX_TARGETED).default([]),
  /** A sub brush (a minimal example of one of its transformations) lives inside this brush's tool group ("" = a group of its own). */
  parentId: z.string().max(80).default(""),
  /** A small picture of the brush: its master's box cut from the master frame's result (shown in the Brush panel). */
  thumbnail: z.string().max(200000).regex(/^data:image\/(jpeg|png);base64,/).optional(),
  /** A fork: a copy of brush `brushId` (stamped in frame `frameId`) that a recommendation (`key`, `title`) was applied to instead of that brush. */
  fork: z.object({ brushId: z.string().max(80), frameId: z.string().max(80), key: z.string().max(400), title: z.string().max(200) }).optional(),
// A fork is a brush of its own (its own tools, targeted tools and sub brushes), not inside the group it came from.
}).transform(brush => brush.fork && brush.parentId ? { ...brush, parentId: "" } : brush);
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
export const brushColor = (count: number) => COLORS[count % COLORS.length];

/** The tool group a brush shows in: its parent's for a sub brush (while the parent exists), else its own. */
export const brushGroup = (brushes: Brush[], id: string) => { const brush = brushes.find(item => item.id === id); return brush?.parentId && brushes.some(item => item.id === brush.parentId) ? brush.parentId : id; };
/** Brushes that are a tool group of their own (sub brushes show inside their parent's). */
export const groupBrushes = (brushes: Brush[]) => brushes.filter(brush => brushGroup(brushes, brush.id) === brush.id);
export const subBrushes = (brushes: Brush[], parentId: string) => brushes.filter(brush => brush.parentId === parentId && brush.id !== parentId);
/** A sub brush for a minimal example frame: its root collection, in the parent's group and color (a group of its own without a parent). */
export function subBrushFor(scene: Scene, frameId: string, name: string, parent: Brush | undefined, existing: Brush[], id: string): Brush | null {
  const root = scene.nodes.find(node => !node.parentId && node.kind === "collection") ?? scene.nodes.find(node => !node.parentId);
  if (!root || existing.length >= MAX_BRUSHES) return null;
  return { id, name: name.slice(0, 100), color: parent?.color ?? brushColor(existing.length), sourceFrameId: frameId, nodeId: root.id, scene: subScene(scene, [root.id]), code: "", targeted: [], parentId: parent?.id ?? "" };
}

/**
 * A root node that only fills the canvas behind everything and does nothing (a still background): not something
 * to stamp. Anything interactive (with a state machine) is a brush, a background too.
 */
export const isBackdrop = (node: Pick<Scene["nodes"][number], "kind" | "region" | "machine">) => node.kind === "object" && !node.machine && node.region.w >= .95 && node.region.h >= .95;
/**
 * One brush per root node of an AI-generated scene: a collection (its nested nodes are parts of it), or an object
 * standing alone at the root (a single drawn form is kept as one object); every interactive one, only a still
 * backdrop filling the canvas is left out.
 */
export function brushesFor(scene: Scene, frameId: string, existing: Brush[], newId: () => string): Brush[] {
  const made: Brush[] = [];
  for (const node of scene.nodes) {
    if (node.parentId || isBackdrop(node) || existing.length + made.length >= MAX_BRUSHES) continue;
    made.push({ id: newId(), name: node.name, color: brushColor(existing.length + made.length), sourceFrameId: frameId, nodeId: node.id,
      scene: subScene(scene, [node.id]), code: "", targeted: [], parentId: "" });
  }
  return made;
}

/** Mark each brush's collection in the scene (copies keep the mark, so stamps stay inspectable). */
export function markBrushes(scene: Scene, brushes: Brush[]): Scene {
  const byNode = new Map(brushes.map(brush => [brush.nodeId, brush.id]));
  return { ...scene, nodes: scene.nodes.map(node => byNode.has(node.id) ? { ...node, brushId: byNode.get(node.id) } : node) };
}

/**
 * The collection to stamp: the live node in its source frame, else the saved copy
 * (the source frame was deleted). Either way its root carries the brush mark, so
 * every stamp stays inspectable as this brush.
 */
export function brushSource(brush: Brush, liveScene: Scene | undefined): Scene {
  const scene = liveScene && findNode(liveScene, brush.nodeId) ? subScene(liveScene, [brush.nodeId]) : brush.scene;
  return { ...scene, nodes: scene.nodes.map(node => node.id === brush.nodeId ? { ...node, brushId: brush.id } : node) };
}

/**
 * The nodes of a frame that belong to a brush: its marked roots (or the source
 * node) with their members. Stamps made from a deleted source frame before the
 * saved copy carried the mark are recognised by the brush's node id.
 */
export function brushNodeIds(scene: Scene, brush: Brush, frameId: string) {
  return [...new Set(brushRoots(scene, brush, frameId).flatMap(id => [id, ...descendantIds(scene, id)]))];
}
/** The roots of a brush in a frame: its master (in the source frame) and its instances. */
export function brushRoots(scene: Scene, brush: Brush, frameId: string) {
  const roots = scene.nodes.filter(node => node.brushId === brush.id || (frameId === brush.sourceFrameId && node.id === brush.nodeId)).map(node => node.id);
  return roots.length ? roots : scene.nodes.filter(node => !node.parentId && !node.brushId && (node.id === brush.nodeId || node.codeId === brush.nodeId)).map(node => node.id);
}

// ── Master and instances ─────────────────────────────────────────────────────
// The master of a brush is its collection in the source frame; every stamp of it
// (in any frame) is an instance. Instances follow the brush: their semantic
// transformations and state machines are changed on the master, or the instance
// is detached into a brush of its own first.

export type BrushRole = { brush: Brush; rootId: string; master: boolean };
/** The brush a node belongs to (as its root or a member), and whether that is the master or an instance. */
export function brushRole(scene: Scene, frameId: string, nodeId: string, brushes: Brush[]): BrushRole | null {
  for (let node = findNode(scene, nodeId); node; node = node.parentId ? findNode(scene, node.parentId) : undefined) {
    const master = brushes.find(brush => brush.sourceFrameId === frameId && brush.nodeId === node!.id);
    if (master) return { brush: master, rootId: node.id, master: true };
    const brush = node.brushId ? brushes.find(item => item.id === node!.brushId) : undefined;
    if (brush) return { brush, rootId: node.id, master: false };
  }
  return null;
}

/**
 * Nodes of a brush in different frames have different ids; they share the id the
 * code uses (`codeId`, else the id). These are a frame's ids → those shared ids …
 */
export function sharedIds(scene: Scene, roots: string[]) {
  return new Map(roots.flatMap(root => [root, ...descendantIds(scene, root)]).map(id => [id, findNode(scene, id)!.codeId ?? id]));
}
/** … and the shared ids → one root's ids in this frame. */
export function frameIds(scene: Scene, root: string) {
  return new Map([root, ...descendantIds(scene, root)].map(id => [findNode(scene, id)!.codeId ?? id, id]));
}

/**
 * The tool group a minimal example of node `nodeId` (of frame `frameId`) goes into: the group of the brush
 * the node belongs to there, else of the brush whose master is the same node (its root's shared code id).
 */
export function sourceBrushGroup(scene: Scene, frameId: string, nodeId: string, brushes: Brush[]): Brush | undefined {
  let root = findNode(scene, nodeId); while (root?.parentId) root = findNode(scene, root.parentId);
  const role = brushRole(scene, frameId, nodeId, brushes), key = root && (root.codeId ?? root.id);
  const brush = role?.brush ?? brushes.find(item => item.nodeId === key || item.scene.nodes.some(node => node.id === item.nodeId && (node.codeId ?? node.id) === key));
  return brush && brushes.find(item => item.id === brushGroup(brushes, brush.id));
}

/** Detach an instance: it becomes the master of a new brush (keeping the old brush's targeted inspection tools). */
export function detachedBrush(scene: Scene, frameId: string, rootId: string, from: Brush, brushes: Brush[], id: string, code: string): Brush {
  const root = findNode(scene, rootId)!, taken = new Set(brushes.map(brush => brush.name));
  let name = root.name.slice(0, 90);
  for (let n = 2; taken.has(name); n++) name = `${root.name.slice(0, 90)} ${n}`;
  return { id, name, color: brushColor(brushes.length), sourceFrameId: frameId, nodeId: rootId, scene: subScene(scene, [rootId]), code, targeted: from.targeted, parentId: "" };
}
