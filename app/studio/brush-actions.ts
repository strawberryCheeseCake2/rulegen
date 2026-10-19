import { ART_HEIGHT as H, ART_WIDTH as W } from "../lib/schema";
import { brushNodeIds, brushSource, type Brush } from "../lib/brushes";
import { findNode } from "../lib/scene/graph";
import { moduleKey, programModules, sceneStructureKey } from "../lib/scene/machines";
import { preparedFor, prepareProgram } from "../lib/prepared";
import * as ops from "../lib/scene/panel-ops";
import { stampModule } from "../lib/scene/stamp";
import type { StudioDeps } from "./deps";

// Brushes run their own code module: using one on a frame without it copies the
// module into the frame's program and adds one instance of it (no AI). On a frame
// that already has it, the brush just plays with it: the gesture is the input.

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

/** A copy of the brush's collection at this canvas point, drawn by its module right away. */
function stamp(deps: StudioDeps, brush: Brush, frameId: string, point: { x: number; y: number }) {
  const panel = deps.panel(frameId), module = brushModule(deps, brush), source = sourceScene(deps, brush);
  if (!findNode(source, brush.nodeId)) { deps.updatePanel(frameId, { error: `${brush.name} brush의 brush stamp를 찾지 못했습니다.` }); return null; }
  if (!module) { deps.updatePanel(frameId, { error: `${brush.name} brush의 코드가 아직 없습니다. 원본 프레임의 결과를 먼저 생성해주세요.` }); return null; }
  try {
    const result = stampModule(panel, source, brush.nodeId, module, [{ x: point.x / W, y: point.y / H }], brush.name);
    deps.activate(frameId);
    const code = result.generated.code, before = panel.generated?.code;
    const commit = (executable?: string) => deps.updatePanel(frameId, current => ({ ...ops.commitScene(current, result.scene, []), generated: result.generated, codeDraft: code, selectedNodeIds: result.roots, runtimeError: "",
      ...(executable ? { executable, preparedCode: code } : {}) }));
    // The module was there already: only host values change, and the running result just gains the instance.
    if (before && panel.executable && panel.preparedCode === before && sceneStructureKey(before) === sceneStructureKey(code)) { commit(panel.executable); return result; }
    // A running result takes the new module in place (no reload, nothing it runs is reset), so the brush reacts at once.
    const preview = deps.preview(frameId), live = Boolean(before && panel.executable && preview?.isReadyFor(panel.executable));
    const inject = (executable: string) => { const text = programModules(executable).get(result.key); if (live && text) preview!.inject(text, executable); };
    const ready = preparedFor(code);
    if (ready) { inject(ready); commit(ready); return result; }
    if (!live) { commit(); return result; }
    void prepareProgram(code).then(executable => { if (deps.panel(frameId).generated?.code === before) { inject(executable); commit(executable); } },
      () => { if (deps.panel(frameId).generated?.code === before) commit(); });
    return result;
  } catch (error) { deps.updatePanel(frameId, { error: (error as Error).message }); return null; }
}

/**
 * While the brush tool hovers a frame without the brush, prepare the program it
 * would make there, so adding it needs no server round trip (and no visible wait).
 */
export function prepareBrushFor(deps: StudioDeps, brush: Brush, frameId: string) {
  const panel = deps.panel(frameId), module = brushModule(deps, brush), source = sourceScene(deps, brush);
  if (panel.loading || !module || !findNode(source, brush.nodeId) || brushNodeIds(panel.scene, brush, frameId).length) return;
  try {
    const code = stampModule(panel, source, brush.nodeId, module, [{ x: .5, y: .5 }], brush.name).generated.code;
    if (!preparedFor(code) && !(panel.generated && sceneStructureKey(panel.generated.code) === sceneStructureKey(code))) void prepareProgram(code).catch(() => {});
  } catch { /* the gesture reports it */ }
}

/**
 * Brush on a frame: add the brush when the frame does not have it yet (one
 * instance, where the gesture starts). Returns whether the frame now has it and
 * can run it; a frame that has it but no result yet says so instead.
 */
export function placeBrush(deps: StudioDeps, brush: Brush, frameId: string, point: { x: number; y: number }) {
  const panel = deps.panel(frameId);
  if (panel.loading) return false;
  if (brushNodeIds(panel.scene, brush, frameId).length) {
    if (panel.generated) return true;
    deps.updatePanel(frameId, { error: `이 프레임에는 이미 ${brush.name} brush가 있습니다. 결과를 먼저 생성하면 brush로 바로 움직여 볼 수 있습니다.` });
    return false;
  }
  return Boolean(stamp(deps, brush, frameId, point));
}

type Pointer = { kind: "mousemove" | "mousedown" | "mouseup"; x: number; y: number };

/**
 * A brush gesture (click or drag): the brush is placed if the frame lacks it, and
 * the gesture itself is fed to the result as mouse input, so the brush reacts to
 * it right away. Events wait (briefly) until the frame runs the program with the
 * module. Afterwards the frame takes input directly (interaction).
 */
export function startBrushGesture(deps: StudioDeps, brush: Brush, frameId: string, first: { x: number; y: number }) {
  if (!placeBrush(deps, brush, frameId, first)) return null;
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
    if (ready) deps.updatePanel(frameId, { machinePlaying: true, annotating: false });
    else deps.toast(`${brush.name} 결과가 준비되지 않아 brush 입력을 전달하지 못했습니다.`);
  };
  const flush = () => {
    if (!ready) ready = running();
    if (!ready) { if (Date.now() - started > 15000) { finished = true; stop(); } return; }
    // Input that waited for the result is fed over a few frames, not in one burst, so the brush moves smoothly while it catches up.
    const preview = deps.preview(frameId)!;
    for (let n = Math.max(2, Math.ceil(queue.length / 6)); queue.length && n > 0; n--) { const event = queue.shift()!; preview.pointer(event.kind, event.x, event.y); }
    if (finished && !queue.length) stop();
  };
  timer = setInterval(flush, 16);
  return {
    move(point: { x: number; y: number }) { if (finished) return; queue.push({ kind: "mousemove", ...point }); if (ready && queue.length <= 2) flush(); },
    end(point: { x: number; y: number }) { if (finished) return; finished = true; queue.push({ kind: "mousemove", ...point }, { kind: "mouseup", ...point }); flush(); },
  };
}
