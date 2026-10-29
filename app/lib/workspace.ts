import { z } from "zod";
import type { Viewport } from "./schema";

// Frames on the board are sketch frames (drawn on, rendering their own result),
// proxy frames (running the direct manipulation handles of a node of a sketch frame)
// and exploration frames (a brush's marks to try execution or values on; not saved).

const position = z.object({ x: z.number().finite(), y: z.number().finite() });
export const defaultFrames = () => ({ source: { x: 0, y: 0 } });
export const workspaceSchema = z.object({
  camera: position.extend({ zoom: z.number().min(.15).max(3) }).nullable().default(null),
  hiddenFrames: z.array(z.literal("source")).max(1).default([]),
  frames: z.object({ source: position.default(() => defaultFrames().source) }).catchall(position).default(defaultFrames),
});
export type WorkspaceLayout = z.infer<typeof workspaceSchema>;
export type FrameId = "source" | `sketch-${string}` | `proxy-${string}` | `explore-${string}`;
export const FRAME_WIDTH = 900, FRAME_HEIGHT = 600, FRAME_GAP_X = 140, FRAME_GAP_Y = 140;
/** Room an exploration frame's controls take under it. */
export const EXPLORE_BAR_HEIGHT = 260;

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
  // An exploration frame has its controls under it: that space is taken too.
  const taken = Object.entries(frames).map(([id, at]) => ({ ...at, h: id.startsWith("explore-") ? FRAME_HEIGHT + EXPLORE_BAR_HEIGHT : FRAME_HEIGHT }));
  const candidate = { x: origin.x + FRAME_WIDTH + FRAME_GAP_X, y: origin.y };
  while (taken.some(f => Math.abs(f.x - candidate.x) < FRAME_WIDTH && (f.y <= candidate.y ? candidate.y - f.y < f.h : f.y - candidate.y < FRAME_HEIGHT))) candidate.y += FRAME_HEIGHT + FRAME_GAP_Y;
  return candidate;
}
/** The frames a box drawn on the board (in board coordinates) touches. */
export function framesInBox(frames: WorkspaceLayout["frames"], ids: readonly string[], box: { x: number; y: number; w: number; h: number }) {
  const left = Math.min(box.x, box.x + box.w), top = Math.min(box.y, box.y + box.h), right = Math.max(box.x, box.x + box.w), bottom = Math.max(box.y, box.y + box.h);
  return ids.filter(id => { const at = frames[id]; return at && at.x < right && at.x + FRAME_WIDTH > left && at.y < bottom && at.y + FRAME_HEIGHT > top; });
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
