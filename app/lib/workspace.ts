import { z } from "zod";
import type { Viewport } from "./schema";
const position = z.object({ x: z.number().finite(), y: z.number().finite() });
export const defaultFrames = () => ({ source: { x: 0, y: 0 }, result: { x: 1040, y: 0 }, brush: { x: 0, y: 780 } });
export const workspaceSchema = z.object({ camera: position.extend({ zoom: z.number().min(.15).max(3) }).nullable().default(null), hiddenFrames: z.array(z.enum(["source", "result"])).max(2).default([]), frames: z.object({ source: position.default(() => defaultFrames().source), result: position.default(() => defaultFrames().result), brush: position.default(() => defaultFrames().brush) }).catchall(position).default(defaultFrames) });
export type WorkspaceLayout = z.infer<typeof workspaceSchema>;
export type FrameId = "source" | "result" | "brush" | `sketch-${string}` | `result-${string}`;
export const resultFrameId = (sketchId: string): FrameId => sketchId === "source" ? "result" : `result-${sketchId}`;
export const resultSketchId = (frameId: FrameId): string | null => frameId === "result" ? "source" : frameId.startsWith("result-") ? frameId.slice(7) : null;
export function removeWorkspaceFrame(layout: WorkspaceLayout, id: FrameId): WorkspaceLayout {
  if (id === "source" || id === "result") {
    const hidden = id === "source" ? ["source", "result"] as const : ["result"] as const;
    return { ...layout, hiddenFrames: [...new Set([...layout.hiddenFrames, ...hidden])] };
  }
  const frames = { ...layout.frames };
  delete frames[id];
  if (id.startsWith("sketch-")) delete frames[resultFrameId(id)];
  return { ...layout, frames };
}
export function showWorkspaceFrame(layout: WorkspaceLayout, id: "source" | "result"): WorkspaceLayout {
  return layout.hiddenFrames.includes(id) ? { ...layout, hiddenFrames: layout.hiddenFrames.filter(frame => frame !== id) } : layout;
}
export function ensureResultFramePositions(frames: WorkspaceLayout["frames"], sketchIds: readonly string[]) {
  let resolved = ensureFramePositions(frames, sketchIds);
  for (const id of sketchIds) {
    const resultId = resultFrameId(id);
    if (!resolved[resultId]) resolved = { ...resolved, [resultId]: { x: resolved[id].x, y: resolved[id].y + 740 } };
  }
  return resolved;
}
export function ensureFramePositions(frames: WorkspaceLayout["frames"], ids: readonly string[]): WorkspaceLayout["frames"] {
  let resolved = frames;
  for (const [id, fallback] of Object.entries(defaultFrames())) {
    if (!resolved[id]) resolved = { ...resolved, [id]: fallback };
  }
  for (const id of ids) {
    if (!resolved[id]) resolved = { ...resolved, [id]: nextSketchPosition(resolved) };
  }
  return resolved;
}
export function nextSketchPosition(frames: WorkspaceLayout["frames"]) {
  return { x: Math.max(...Object.values(frames).map(f => f.x)) + 1040, y: frames.source.y };
}
export function zoomAt(camera: Viewport, zoom: number, anchor: { x: number; y: number }): Viewport {
  const next = Math.max(.15, Math.min(3, zoom));
  return { zoom: next, x: anchor.x - (anchor.x - camera.x) * next / camera.zoom, y: anchor.y - (anchor.y - camera.y) * next / camera.zoom };
}
export function fitFrames(frames: { x: number; y: number }[], width: number, height: number): Viewport {
  if (!frames.length) return { zoom: .4, x: 40, y: 110 };
  const left = Math.min(...frames.map(f => f.x)), top = Math.min(...frames.map(f => f.y));
  const right = Math.max(...frames.map(f => f.x + 900)), bottom = Math.max(...frames.map(f => f.y + 600));
  const zoom = Math.max(.15, Math.min(1, (width - 80) / (right - left), (height - 130) / (bottom - top)));
  return { zoom, x: (width - (right - left) * zoom) / 2 - left * zoom, y: (height - (bottom - top) * zoom) / 2 - top * zoom + 10 };
}
