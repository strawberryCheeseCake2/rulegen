import { z } from "zod";
import type { Viewport } from "./schema";

// Frames on the board are sketch frames (drawn on, rendering their own result)
// and proxy frames (running the direct manipulation handles of a node of a sketch frame).

const position = z.object({ x: z.number().finite(), y: z.number().finite() });
export const defaultFrames = () => ({ source: { x: 0, y: 0 } });
export const workspaceSchema = z.object({
  camera: position.extend({ zoom: z.number().min(.15).max(3) }).nullable().default(null),
  hiddenFrames: z.array(z.literal("source")).max(1).default([]),
  frames: z.object({ source: position.default(() => defaultFrames().source) }).catchall(position).default(defaultFrames),
});
export type WorkspaceLayout = z.infer<typeof workspaceSchema>;
export type FrameId = "source" | `sketch-${string}` | `proxy-${string}`;
export const FRAME_WIDTH = 900, FRAME_HEIGHT = 600, FRAME_GAP_X = 140, FRAME_GAP_Y = 140;

export function removeWorkspaceFrame(layout: WorkspaceLayout, id: FrameId): WorkspaceLayout {
  if (id === "source") return { ...layout, hiddenFrames: [...new Set([...layout.hiddenFrames, "source" as const])] };
  const frames = { ...layout.frames };
  delete frames[id];
  return { ...layout, frames };
}
export function showWorkspaceFrame(layout: WorkspaceLayout, id: "source"): WorkspaceLayout {
  return layout.hiddenFrames.includes(id) ? { ...layout, hiddenFrames: layout.hiddenFrames.filter(frame => frame !== id) } : layout;
}
export function ensureFramePositions(frames: WorkspaceLayout["frames"], ids: readonly string[]): WorkspaceLayout["frames"] {
  let resolved = frames;
  if (!resolved.source) resolved = { ...resolved, source: defaultFrames().source };
  for (const id of ids) if (!resolved[id]) resolved = { ...resolved, [id]: nextSketchPosition(resolved) };
  return resolved;
}
const sketchPositions = (frames: WorkspaceLayout["frames"]) => Object.values(frames);
export function nextSketchPosition(frames: WorkspaceLayout["frames"]) {
  return { x: Math.max(...sketchPositions(frames).map(f => f.x)) + FRAME_WIDTH + FRAME_GAP_X, y: frames.source?.y ?? 0 };
}
/** A free spot right of `fromId` (then below it), for frames derived from another frame. */
export function besideFramePosition(frames: WorkspaceLayout["frames"], fromId: string) {
  const origin = frames[fromId] || frames.source || { x: 0, y: 0 };
  const taken = sketchPositions(frames);
  const candidate = { x: origin.x + FRAME_WIDTH + FRAME_GAP_X, y: origin.y };
  while (taken.some(f => Math.abs(f.x - candidate.x) < FRAME_WIDTH && Math.abs(f.y - candidate.y) < FRAME_HEIGHT)) candidate.y += FRAME_HEIGHT + FRAME_GAP_Y;
  return candidate;
}
export function zoomAt(camera: Viewport, zoom: number, anchor: { x: number; y: number }): Viewport {
  const next = Math.max(.15, Math.min(3, zoom));
  return { zoom: next, x: anchor.x - (anchor.x - camera.x) * next / camera.zoom, y: anchor.y - (anchor.y - camera.y) * next / camera.zoom };
}
export function fitFrames(frames: { x: number; y: number }[], width: number, height: number): Viewport {
  if (!frames.length) return { zoom: .4, x: 40, y: 110 };
  const left = Math.min(...frames.map(f => f.x)), top = Math.min(...frames.map(f => f.y));
  const right = Math.max(...frames.map(f => f.x + FRAME_WIDTH)), bottom = Math.max(...frames.map(f => f.y + FRAME_HEIGHT));
  const zoom = Math.max(.15, Math.min(1, (width - 80) / (right - left), (height - 130) / (bottom - top)));
  return { zoom, x: (width - (right - left) * zoom) / 2 - left * zoom, y: (height - (bottom - top) * zoom) / 2 - top * zoom + 10 };
}
