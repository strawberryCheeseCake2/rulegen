import { ART_HEIGHT as H, ART_WIDTH as W } from "../lib/schema";
import { brushSource, type Brush } from "../lib/brushes";
import { findNode, unionRegion } from "../lib/scene/graph";
import { moduleKey, programModules } from "../lib/scene/machines";
import type { Scene } from "../lib/scene/schema";
import * as ops from "../lib/scene/panel-ops";
import { stampModule } from "../lib/scene/stamp";
import type { FrameId } from "../lib/workspace";
import type { StudioDeps } from "./deps";

// Brushes run their own code module: using one copies the module into the
// frame's program and adds an instance of it. No AI is involved.

type GesturePoint = { x: number; y: number; t: number };
const MAX_STAMPS = 8;

const pathLength = (points: GesturePoint[]) => points.slice(1).reduce((sum, point, i) => sum + Math.hypot(point.x - points[i].x, point.y - points[i].y), 0);

/** Evenly spaced points along a path, `spacing` apart (canvas pixels). */
export function alongPath(points: GesturePoint[], spacing: number, max = MAX_STAMPS) {
  const out = [points[0]];
  let carried = 0;
  for (let i = 1; i < points.length && out.length < max; i++) {
    const a = points[i - 1], b = points[i], segment = Math.hypot(b.x - a.x, b.y - a.y);
    let along = spacing - carried;
    while (along <= segment && out.length < max) { const k = along / segment; out.push({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, t: a.t + (b.t - a.t) * k }); along += spacing; }
    carried = segment - (along - spacing);
  }
  return out;
}

/** Where a click or stroke stamps a brush: once, or (stamp brush dragged) along the stroke a collection apart. */
export function brushPlan(brush: Brush, source: Scene, points: GesturePoint[]) {
  const dragged = points.length > 1 && pathLength(points) > 12;
  if (!dragged || brush.gesture === "drag") return { stamps: [points[0]], replay: dragged && brush.gesture === "drag" };
  const bounds = unionRegion([brush.nodeId].map(id => findNode(source, id)!.region))!;
  const spacing = Math.max(24, Math.max(bounds.w * W, bounds.h * H) * 1.1);
  return { stamps: alongPath(points, spacing), replay: false };
}

const sourceScene = (deps: StudioDeps, brush: Brush) => brushSource(brush, deps.artwork(brush.sourceFrameId) ? deps.panel(brush.sourceFrameId).scene : undefined);

/** The brush's code module: from its source frame's program, else the copy it keeps. */
export function brushModule(deps: StudioDeps, brush: Brush) {
  const live = deps.artwork(brush.sourceFrameId) ? deps.panel(brush.sourceFrameId) : null;
  const root = live && findNode(live.scene, brush.nodeId), code = live?.generated?.code;
  if (root && code) {
    const key = root.codeModule ?? root.id, text = programModules(code).get(key);
    if (text) return { key, text };
  }
  const key = brush.code ? moduleKey(brush.code) : null;
  return key ? { key, text: brush.code } : null;
}

/** Copies of the brush's collection at these canvas points, drawn by its module right away. */
function stamp(deps: StudioDeps, brush: Brush, frameId: string, points: { x: number; y: number }[]) {
  const panel = deps.panel(frameId), module = brushModule(deps, brush), source = sourceScene(deps, brush);
  if (!findNode(source, brush.nodeId)) { deps.updatePanel(frameId, { error: `${brush.name} brush의 brush stamp를 찾지 못했습니다.` }); return null; }
  if (!module) { deps.updatePanel(frameId, { error: `${brush.name} brush의 코드가 아직 없습니다. 원본 프레임의 결과를 먼저 생성해주세요.` }); return null; }
  try {
    const result = stampModule(panel, source, brush.nodeId, module, points.map(point => ({ x: point.x / W, y: point.y / H })), brush.name);
    deps.activate(frameId);
    deps.updatePanel(frameId, current => ({ ...ops.commitScene(current, result.scene, []), generated: result.generated, codeDraft: result.generated.code, selectedNodeIds: result.roots, interacting: false, runtimeError: "" }));
    return result;
  } catch (error) { deps.updatePanel(frameId, { error: (error as Error).message }); return null; }
}

/** A click stamps once; a drag with a stamp brush stamps along the stroke. */
export function applyBrush(deps: StudioDeps, brush: Brush, frameId: string, points: GesturePoint[]) {
  if (deps.panel(frameId).loading || !points.length) return;
  const result = stamp(deps, brush, frameId, brushPlan(brush, sourceScene(deps, brush), points).stamps);
  if (result && result.roots.length > 1) deps.toast(`${brush.name}을 획을 따라 ${result.roots.length}번 찍었습니다.`);
}

type Pointer = { kind: "mousemove" | "mousedown" | "mouseup"; x: number; y: number };

/**
 * A drag brush: the collection appears where the drag starts and the drag itself
 * is fed to it as mouse input while the user moves, so its own interaction draws
 * the stroke. Events wait (briefly) until the frame runs the program with the module.
 */
export function startBrushDrag(deps: StudioDeps, brush: Brush, frameId: string, first: { x: number; y: number }) {
  if (deps.panel(frameId).loading || !stamp(deps, brush, frameId, [first])) return null;
  const queue: Pointer[] = [{ kind: "mousemove", ...first }, { kind: "mousedown", ...first }];
  let ready = false, finished = false, timer: ReturnType<typeof setInterval> | null = null;
  const started = Date.now();
  const running = () => {
    const panel = deps.panel(frameId), preview = deps.preview(frameId);
    return Boolean(panel.generated && panel.preparedCode === panel.generated.code && panel.executable && preview?.isReadyFor(panel.executable));
  };
  const stop = () => {
    if (timer) clearInterval(timer);
    timer = null;
    if (ready) { deps.updatePanel(frameId, { interacting: true, machinePlaying: true, annotating: false }); deps.focus(frameId as FrameId); }
    else deps.toast(`${brush.name} 결과가 준비되지 않아 드래그를 전달하지 못했습니다.`);
  };
  const flush = () => {
    if (!ready) ready = running();
    if (!ready) { if (Date.now() - started > 15000) { finished = true; stop(); } return; }
    const preview = deps.preview(frameId)!;
    while (queue.length) { const event = queue.shift()!; preview.pointer(event.kind, event.x, event.y); }
    if (finished) stop();
  };
  timer = setInterval(flush, 16);
  return {
    move(point: { x: number; y: number }) { if (finished) return; queue.push({ kind: "mousemove", ...point }); if (ready) flush(); },
    end(point: { x: number; y: number }) { if (finished) return; finished = true; queue.push({ kind: "mousemove", ...point }, { kind: "mouseup", ...point }); flush(); },
  };
}
