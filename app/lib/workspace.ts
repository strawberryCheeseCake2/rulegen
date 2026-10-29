import { z } from "zod";
import type { Viewport } from "./schema";

// Frames on the board are sketch frames (drawn on, rendering their own result),
// proxy frames (running the direct manipulation handles of a node of a sketch frame)
// and exploration frames (a brush's marks to try execution or values on; not saved).

const position = z.object({ x: z.number().finite(), y: z.number().finite() });
export const defaultFrames = () => ({ source: { x: 0, y: 0 } });
/** How many sketch frames a project holds at most. */
export const MAX_SKETCH_FRAMES = 60;
export const workspaceSchema = z.object({
  camera: position.extend({ zoom: z.number().min(.15).max(3) }).nullable().default(null),
  hiddenFrames: z.array(z.literal("source")).max(1).default([]),
  frames: z.object({ source: position.default(() => defaultFrames().source) }).catchall(position).default(defaultFrames),
  /** Frame groups: frames kept together on the board under a title (moved and deleted together). */
  groups: z.array(z.object({ id: z.string().min(1).max(80), title: z.string().max(200), frames: z.array(z.string().max(80)).max(12) })).max(48).default([]),
  /** Minimal example frames hidden from the board (not drawn, their result not running); shown again from the frame they came from. */
  hiddenExamples: z.array(z.string().max(80)).max(MAX_SKETCH_FRAMES).default([]),
});
export type FrameGroup = WorkspaceLayout["groups"][number];
export type WorkspaceLayout = z.infer<typeof workspaceSchema>;
export type FrameId = "source" | `sketch-${string}` | `proxy-${string}` | `explore-${string}` | `slot-${string}`;
export const FRAME_WIDTH = 900, FRAME_HEIGHT = 600, FRAME_GAP_X = 140, FRAME_GAP_Y = 140;
/** Room an exploration frame's controls take under it. */
export const EXPLORE_BAR_HEIGHT = 260;
/** Room a frame group's title takes above its frames (frame headers sit between). */
export const GROUP_TITLE_HEIGHT = 110, GROUP_PADDING = 36;
const frameHeight = (id: string) => id.startsWith("explore-") ? FRAME_HEIGHT + EXPLORE_BAR_HEIGHT : FRAME_HEIGHT;

/** The box a group takes on the board (title included), from its frames' spots. */
export function groupBox(frames: WorkspaceLayout["frames"], members: readonly string[]) {
  const spots = members.filter(id => frames[id]).map(id => ({ ...frames[id], h: frameHeight(id) }));
  if (!spots.length) return null;
  const left = Math.min(...spots.map(f => f.x)), top = Math.min(...spots.map(f => f.y)), right = Math.max(...spots.map(f => f.x + FRAME_WIDTH)), bottom = Math.max(...spots.map(f => f.y + f.h));
  return { x: left - GROUP_PADDING, y: top - GROUP_TITLE_HEIGHT, w: right - left + GROUP_PADDING * 2, h: bottom - top + GROUP_TITLE_HEIGHT + GROUP_PADDING };
}
/**
 * Spots for `count` frames side by side in a new group right of `fromId` (then lower), clear of every frame and group
 * already on the board (exploration frames with their controls under them).
 */
export function groupRow(layout: Pick<WorkspaceLayout, "frames" | "groups">, fromId: string, count: number, tall = true) {
  const origin = layout.frames[fromId] || layout.frames.source || { x: 0, y: 0 };
  const taken = [...Object.entries(layout.frames).map(([id, at]) => ({ x: at.x, y: at.y, w: FRAME_WIDTH, h: frameHeight(id) })),
    ...layout.groups.map(group => groupBox(layout.frames, group.frames)).filter((box): box is NonNullable<typeof box> => Boolean(box))];
  const w = count * FRAME_WIDTH + (count - 1) * FRAME_GAP_X + GROUP_PADDING * 2, h = (tall ? FRAME_HEIGHT + EXPLORE_BAR_HEIGHT : FRAME_HEIGHT) + GROUP_TITLE_HEIGHT + GROUP_PADDING;
  const at = { x: origin.x + FRAME_WIDTH + FRAME_GAP_X, y: origin.y };
  const overlaps = () => taken.some(f => f.x < at.x + w && f.x + f.w > at.x - GROUP_PADDING && f.y < at.y - GROUP_TITLE_HEIGHT + h && f.y + f.h > at.y - GROUP_TITLE_HEIGHT);
  while (overlaps()) at.y += 120;
  return Array.from({ length: count }, (_, i) => ({ x: at.x + i * (FRAME_WIDTH + FRAME_GAP_X), y: at.y }));
}
/** Groups with only the frames still on the board (empty ones go). */
export function liveGroups(groups: FrameGroup[], ids: ReadonlySet<string>) {
  return groups.map(group => ({ ...group, frames: group.frames.filter(id => ids.has(id)) })).filter(group => group.frames.length > 0);
}

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
  const taken = Object.entries(frames).map(([id, at]) => ({ ...at, h: frameHeight(id) }));
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
