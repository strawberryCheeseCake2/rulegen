import { ART_HEIGHT, ART_WIDTH } from "../schema";
import type { DragSource, NumberValue, Scene, SceneNode, Constraint } from "./schema";
import { dragLinks, type DragLink } from "./constraints";

// Adjusting values by dragging the drawn object (the Adjust tool): each constraint says which of its numbers the
// mouse's x, y or speed moves while the user drags on its object, a metaphor of what the value does to the picture (see
// ValueDrag). All of the object's mappings move at once: x and y from where the drag started (by the pixels, in
// proportion, or over the value's range across the object), speed from still to a fast stroke across the value's range.

type Point = { x: number; y: number };
export type Box = { x: number; y: number; w: number; h: number };
/** Where a node is drawn on the canvas (canvas pixels). */
export const nodeBox = (node: Pick<SceneNode, "region">): Box => ({ x: node.region.x * ART_WIDTH, y: node.region.y * ART_HEIGHT, w: node.region.w * ART_WIDTH, h: node.region.h * ART_HEIGHT });
export const boxCenter = (box: Box): Point => ({ x: box.x + box.w / 2, y: box.y + box.h / 2 });

/** A node's drags that are on, with the number each moves as the node shows it now (`stack`: its constraints as inspected). */
export type DragTarget = DragLink & { nodeId: string; value: NumberValue };
export function dragTargets(node: SceneNode, stack: Constraint[] = node.constraints): DragTarget[] {
  return dragLinks(node.constraints, true).flatMap(link => {
    const param = stack.find(item => item.id === link.constraintId)?.params.find(item => item.id === link.paramId);
    const value = param?.value;
    return value?.type === "number" ? [{ ...link, nodeId: node.id, value }] : [];
  });
}
/** The node a press at `at` adjusts: the smallest visible one there that has drags on (null: none). */
export function nodeToAdjust(scene: Scene, at: Point, has: (node: SceneNode) => boolean = node => dragTargets(node).length > 0): SceneNode | null {
  const inside = scene.nodes.filter(node => node.visible !== false && has(node)).filter(node => { const box = nodeBox(node); return at.x >= box.x && at.x <= box.x + box.w && at.y >= box.y && at.y <= box.y + box.h; });
  return inside.sort((a, b) => a.region.w * a.region.h - b.region.w * b.region.h)[0] ?? null;
}

/** Mouse speed (canvas pixels per ms) that gives a speed-mapped value its full range. */
export const FULL_SPEED = 1.5;
/** The mouse speed smoothed as it moves (canvas pixels per ms): `previous` blended with the step from `last` to `now`. */
export function smoothedSpeed(previous: number, last: Point & { t: number }, now: Point & { t: number }) {
  const ms = Math.max(1, now.t - last.t), instant = Math.hypot(now.x - last.x, now.y - last.y) / ms;
  return previous + (instant - previous) * Math.min(1, ms / 60);
}

/**
 * The value one mouse attribute gives while dragging (before it is kept to its range and step): x and y from the value
 * at the press (`start`) by how far the mouse went from `from` (right, up), against the object's size (`box`); speed
 * (canvas px/ms) across the value's range, still at one end and a fast stroke (FULL_SPEED) at the other.
 */
export function draggedValue(drag: Pick<DragLink, "source" | "mode" | "invert">, start: NumberValue, box: Box, from: Point, now: Point, speed: number) {
  const sign = drag.invert ? -1 : 1, span = Math.max(1e-9, start.max - start.min);
  if (drag.source === "speed") { const t = Math.max(0, Math.min(1, speed / FULL_SPEED)); return drag.invert ? start.max - t * span : start.min + t * span; }
  // Right is more; up is more (the canvas runs down). Measured against the object's width or height.
  const measure = drag.source === "x" ? now.x - from.x : from.y - now.y, size = drag.source === "x" ? Math.max(60, box.w) : Math.max(60, box.h);
  if (drag.mode === "direct") return start.value + sign * measure;
  if (drag.mode === "ratio") { const base = Math.abs(start.value) > 1e-9 ? start.value : start.min + span * .05 || span * .05; return base * Math.pow(2, sign * measure / size); }
  return start.value + sign * measure / size * span;
}
/** What each mouse attribute is called on the picture. */
export const SOURCE_NAMES: Record<DragSource, { sign: string; name: string }> = { x: { sign: "↔", name: "mouse x" }, y: { sign: "↕", name: "mouse y" }, speed: { sign: "≋", name: "mouse speed" } };
