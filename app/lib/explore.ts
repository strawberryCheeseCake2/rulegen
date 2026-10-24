import { z } from "zod";
import { applyParameterEdits, moduleKeyOf } from "./hidden-parameters";
import { overlaySchema, type InspectionStep, type InspectResult, type Recommendation, type Scalar } from "./inspection";
export { PATH_ROOT } from "./inspection";
import { findNode } from "./scene/graph";
import { addHostParams, programModules, sceneInstances } from "./scene/machines";
import { idSchema, numberValueSchema, toggleValueSchema, type Scene } from "./scene/schema";
import { bindingKey } from "./scene/values";

// Exploration frames: from a targeted inspection's cause or one of its
// recommendations, a new frame on the board shows the same brush marks (the step
// the inspection holds) and lets the user try one thing there, nothing else changes:
// - "execution": a direct manipulation handle, designed as a metaphor for the
//   process the concern is about, runs the brush's execution forward and back:
//   its code's own run (checkpoints AI puts in the algorithm, m.trace, and every
//   drawing call, in order), how much of the recorded input has been executed, or
//   which recorded step;
// - "parameters": the recommendation's key values as handles on overlays, dragged to
//   see what they do. A recommendation not applied yet runs as a preview: AI edits the
//   brush's module for it (in this frame only), reading its key values.

export const EXPLORE_MODES = ["execution", "parameters"] as const;
export type ExploreMode = (typeof EXPLORE_MODES)[number];
/** The value an execution handle changes: how far execution has gone (0..1 along the axis). */
export const EXEC_KEY = "@execution";
export const MAX_EXPLORE_FRAMES = 8;

const editSchema = z.object({ nodeId: z.string().max(80), find: z.string().min(1).max(1500), replace: z.string().min(1).max(4000) });
/** A value a preview reads that the scene does not have (the recommendation's new quantity), with its range. */
export const previewValueSchema = z.object({ nodeId: z.string().max(80), id: idSchema, label: z.string().min(1).max(80), value: z.union([numberValueSchema, toggleValueSchema]) });
export type PreviewValue = z.infer<typeof previewValueSchema>;
export const exploreResultSchema = z.object({
  /** What the frame lets the user see and how the handle maps onto it (Korean). */
  summary: z.string().min(1).max(1200),
  /**
   * What execution means here: one run of the brush's code, its internal operations and drawing calls in order ("run"),
   * the recorded input executed so far ("input"), or the recorded steps ("steps").
   */
  axis: z.enum(["run", "input", "steps"]),
  /** Where along the axis the process happens (0..1): the execution handle moves within it. */
  from: z.number().min(0).max(1), to: z.number().min(0).max(1),
  /** Exact edits of the brush's module, in this frame only: checkpoints (m.trace) of its execution, and a recommendation not applied yet. */
  edits: z.array(editSchema).max(6),
  /** The values the edits read that do not exist yet. */
  values: z.array(previewValueSchema).max(4),
  overlays: z.array(overlaySchema).max(8),
  /**
   * Execution on a run: the kinds of internal operation its steps are (a checkpoint's `data.op`), each named and
   * explained (the principle of that operation), so each step reads as one of them. `[]` otherwise.
   */
  stages: z.array(z.object({ op: z.number().int().min(1).max(9), name: z.string().min(1).max(40), explain: z.string().max(300),
    /** One gesture of this operation's handle may run several steps (one continuous motion through many items); otherwise one gesture is one step. */
    many: z.boolean() })).max(6),
});
export type ExploreResult = z.infer<typeof exploreResultSchema>;

export type ExploreSource = { kind: "cause" } | { kind: "recommendation"; index: number; title: string; key: string; applied: boolean };
/** What the frame started from: the step the inspection held (its runtime has the brush marks) and every recorded step. */
export type ExploreBase = { runtime: unknown; values: Record<string, Scalar>; steps: Pick<InspectionStep, "runtime" | "values">[];
  /** Values the frame is drawn with over the recorded ones (a value recommendation not applied yet). */
  params: Record<string, Scalar> };
export type ExploreFrame = {
  id: `explore-${string}`; targetFrameId: string; brushId: string; toolId: string; mode: ExploreMode; source: ExploreSource; name: string;
  /** The brush's nodes in the target frame (their values are what handles change). */
  nodeIds: string[];
  base: ExploreBase;
  /** The prepared program it runs ("" while a preview is prepared). */
  executable: string;
  status: "loading" | "ready" | "error"; error: string;
  result: ExploreResult | null;
  /** How far execution has gone (0..1 along the axis). */
  progress: number;
  /** Values dragged in this frame. */
  values: Record<string, Scalar>;
  /** What AI was asked with (asked again on retry): the concern, the inspection as shown in the target frame, the recommendation. */
  request: { concern: string; inspection: InspectResult; recommendation: (Recommendation & { applied: boolean }) | null };
};
export const isExploreFrame = (id: string): id is `explore-${string}` => id.startsWith("explore-");
export const sameExplore = (frame: Pick<ExploreFrame, "targetFrameId" | "toolId" | "mode" | "source">, other: Pick<ExploreFrame, "targetFrameId" | "toolId" | "mode" | "source">) =>
  frame.targetFrameId === other.targetFrameId && frame.toolId === other.toolId && frame.mode === other.mode
  && (frame.source.kind === "cause" ? other.source.kind === "cause" : other.source.kind === "recommendation" && other.source.key === frame.source.key);

type Gesture = { id?: number; rev?: number; points: { x: number; y: number; t?: number }[]; done?: boolean };
const historyOf = (runtime: unknown): Gesture[] => {
  const history = runtime && typeof runtime === "object" ? (runtime as { history?: unknown }).history : undefined;
  return Array.isArray(history) ? history.filter((g): g is Gesture => Boolean(g && typeof g === "object" && Array.isArray((g as Gesture).points))) : [];
};
/** Every recorded input point, gesture after gesture (the order they were executed in). */
export const inputPath = (runtime: unknown) => historyOf(runtime).flatMap(g => g.points.filter(point => Number.isFinite(point?.x) && Number.isFinite(point?.y)).map(point => ({ x: point.x, y: point.y })));
/** How many input points are executed at `progress` (of `total`). */
export const executedPoints = (progress: number, total: number) => Math.max(0, Math.min(total, Math.round(Math.max(0, Math.min(1, progress)) * total)));

/**
 * The runtime with its input executed only up to `progress`: the gestures before
 * that point whole, the one it falls in cut there (still being drawn: not done) and
 * none after. The modules derive what they draw from the input, so the brush marks
 * are drawn as they were at that moment of execution. A cut gesture gets a rev of its
 * own, so nothing computed from the whole gesture is reused for it.
 */
export function executedRuntime(runtime: unknown, progress: number) {
  const history = historyOf(runtime), total = history.reduce((n, g) => n + g.points.length, 0), k = executedPoints(progress, total);
  if (!runtime || typeof runtime !== "object" || k >= total) return runtime;
  const kept: Gesture[] = [];
  let left = k;
  for (const g of history) {
    if (left <= 0) break;
    if (g.points.length <= left) { kept.push(g); left -= g.points.length; continue; }
    kept.push({ ...g, points: g.points.slice(0, left), done: false, rev: -1 - left }); left = 0;
  }
  return { ...(runtime as object), history: kept };
}

/**
 * The steps of a run, executed one at a time: its checkpoints (one per internal operation of the code,
 * m.trace), or its drawing calls when the code has none.
 */
export function runSteps<T extends { kind: string }>(run: { events: T[] }) {
  const checkpoints = run.events.filter(event => event.kind === "trace");
  return checkpoints.length ? checkpoints : run.events;
}
/** How many steps are done at a progress (0..1) of `count` steps. */
export const stepsDone = (progress: number, count: number) => Math.round(Math.max(0, Math.min(1, progress)) * count);
/** The events executed when `done` steps are: everything before the next step (null: all of the run). */
export const stepBudget = (done: number, steps: { index: number }[]) => done >= steps.length ? null : steps[Math.max(0, done)].index;

/**
 * The moment the frame draws now: within one run of the code (step by step, once the run is known),
 * along the input, or one of the recorded steps.
 */
export function exploreStep(frame: Pick<ExploreFrame, "base" | "progress" | "result">, run: { total: number; events: { index: number; kind: string }[] } | null = null) {
  const steps = frame.base.steps;
  if (frame.result?.axis === "run") {
    if (!run) return { key: "run-all", runtime: frame.base.runtime, values: frame.base.values, budget: null, done: null as number | null, count: null as number | null };
    const list = runSteps(run), done = stepsDone(frame.progress, list.length);
    return { key: `run${done}`, runtime: frame.base.runtime, values: frame.base.values, budget: stepBudget(done, list), done, count: list.length };
  }
  if (frame.result?.axis === "steps" && steps.length > 1) {
    const index = Math.round(Math.max(0, Math.min(1, frame.progress)) * (steps.length - 1));
    return { key: `step${index}`, runtime: steps[index].runtime, values: steps[index].values, budget: null, done: null, count: null };
  }
  const total = inputPath(frame.base.runtime).length;
  return { key: `in${executedPoints(frame.progress, total)}`, runtime: frame.result ? executedRuntime(frame.base.runtime, frame.progress) : frame.base.runtime, values: frame.base.values, budget: null, done: null, count: null };
}

/**
 * The run as overlays read it, `done` steps executed: every event (`@run`), every step (`@steps`, with
 * `step`, `done`, and its operation `op`), the step about to execute (`@next`) and the one just executed
 * (`@last`), each with `done` and `total` (and `none` 1 when there is none), and the path through the steps.
 */
export const RUN_ROOT = "@run", STEPS_ROOT = "@steps", NEXT_ROOT = "@next", LAST_ROOT = "@last";
type RunEvent = { index: number; kind: string; label: string; x?: number; y?: number; w?: number; h?: number; data?: unknown };
const opOf = (data: unknown) => { const op = data && typeof data === "object" ? Number((data as { op?: unknown }).op) : NaN; return Number.isInteger(op) ? op : 0; };
export function runStores(run: { total: number; events: RunEvent[] }, done: number) {
  // An event with no place on the canvas is at its middle (so something there can still be grabbed).
  const place = (event: RunEvent) => ({ ...event, trace: event.kind === "trace" ? 1 : 0, op: opOf(event.data),
    cx: Number.isFinite(event.x) ? event.x! + (event.w ?? 0) / 2 : 450, cy: Number.isFinite(event.y) ? event.y! + (event.h ?? 0) / 2 : 300 });
  const list = runSteps(run), budget = stepBudget(done, list), total = list.length;
  // `trace`: 1 for a checkpoint, 0 for a drawing call (expressions read numbers, not names).
  const events = run.events.map(event => ({ ...place(event), done: budget === null || event.index < budget ? 1 : 0 }));
  const steps = list.map((event, step) => ({ ...place(event), step, done: step < done ? 1 : 0 }));
  const at = (step: number) => steps[step] ? { ...steps[step], none: 0, done, total } : { none: 1, step, done, total };
  return { [RUN_ROOT]: events, [STEPS_ROOT]: steps, [NEXT_ROOT]: at(done), [LAST_ROOT]: at(done - 1), path: steps.map(step => ({ x: step.cx, y: step.cy })) };
}
/** Each operation of the run (by `op`, as AI named it): how many of its steps there are and how many are done. */
export function stageCounts(run: { events: RunEvent[] }, done: number) {
  const counts = new Map<number, { count: number; done: number; first: number }>();
  runSteps(run).forEach((event, step) => { const op = opOf(event.data), entry = counts.get(op) ?? { count: 0, done: 0, first: step }; entry.count++; if (step < done) entry.done++; counts.set(op, entry); });
  return counts;
}
/**
 * The steps one operation's handle may execute or take back in one drag: the run of consecutive steps of the
 * same operation as the next step (`done` steps executed), as [first, last] in steps done. A drag never runs on
 * into another operation (the same operation later, e.g. for the next stroke, is a run of its own).
 */
export function stepBlock(run: { events: RunEvent[] }, done: number): [number, number] {
  const ops = runSteps(run).map(event => opOf(event.data));
  if (done >= ops.length) return [ops.length, ops.length];
  const op = ops[done];
  let first = done, last = done + 1;
  while (first > 0 && ops[first - 1] === op) first--;
  while (last < ops.length && ops[last] === op) last++;
  return [first, last];
}
/**
 * What one drag of an operation's handle may reach, `done` steps executed when it starts: one step forward or
 * back (or, for an operation that is one continuous motion, `many`, anywhere in its run), never past its run.
 */
export function gestureRange(run: { events: RunEvent[] }, done: number, many: boolean): [number, number] {
  const [first, last] = stepBlock(run, done);
  return many ? [first, last] : [Math.max(first, done - 1), Math.min(last, done + 1)];
}
/** The operation of a step (0: not named). */
export const stepOp = (run: { events: RunEvent[] }, step: number) => opOf(runSteps(run)[step]?.data);

/**
 * An edit that only adds checkpoints: without its m.trace(…) calls it is the code it replaces (a one-statement
 * body may get braces to hold one).
 */
export function traceOnly(edit: { find: string; replace: string }) {
  const squash = (text: string) => text.replace(/[\s{}]+/g, "");
  return edit.replace.includes("m.trace(") && squash(withoutTraces(edit.replace)) === squash(edit.find);
}
/**
 * The code with its m.trace(…) calls (and their semicolons) taken out, with the conditions that only guard
 * a checkpoint (`if (…) m.trace(…);`, `if (…) { m.trace(…); }`): a checkpoint may be taken only when it applies.
 */
export function withoutTraces(code: string) {
  let out = "", i = 0;
  for (let at = code.indexOf("m.trace(", i); at >= 0; at = code.indexOf("m.trace(", i)) {
    out += code.slice(i, at);
    const close = closing(code, at + "m.trace".length);
    if (close < 0) return code;
    i = close + 1; if (code[i] === ";") i++;
    // `if (…) m.trace(…);`: the condition goes with it.
    const guard = guardStart(out);
    if (guard >= 0) out = out.slice(0, guard);
  }
  out += code.slice(i);
  // `if (…) { }` left by guarded checkpoints in braces.
  for (let at = out.search(/\bif\s*\(/); at >= 0;) {
    const open = out.indexOf("(", at), close = closing(out, open), rest = close < 0 ? "" : out.slice(close + 1);
    const empty = /^\s*\{\s*\}/.exec(rest);
    if (empty) { out = out.slice(0, at) + rest.slice(empty[0].length); at = out.search(/\bif\s*\(/); continue; }
    const next = out.slice(at + 2).search(/\bif\s*\(/);
    at = next < 0 ? -1 : at + 2 + next;
  }
  return out;
}
/** The index of the parenthesis closing the one at `open` (strings skipped); -1 when there is none. */
function closing(code: string, open: number) {
  let depth = 0, quote = "";
  for (let j = open; j < code.length; j++) {
    const char = code[j];
    if (quote) { if (char === "\\") j++; else if (char === quote) quote = ""; continue; }
    if (char === "\"" || char === "'" || char === "`") quote = char;
    else if (char === "(") depth++;
    else if (char === ")" && --depth === 0) return j;
  }
  return -1;
}
/** Where a trailing `if (…)` (nothing after it) starts in `text`; -1 when it does not end with one. */
function guardStart(text: string) {
  const end = text.trimEnd();
  if (!end.endsWith(")")) return -1;
  let depth = 0, j = end.length - 1;
  for (; j >= 0; j--) { if (end[j] === ")") depth++; else if (end[j] === "(" && --depth === 0) break; }
  if (j < 0) return -1;
  const head = /\bif\s*$/.exec(end.slice(0, j));
  return head ? head.index : -1;
}

/** The value keys the program has for a preview value: one per stamp the module draws (its node there). */
export function previewKeys(scene: Scene, value: Pick<PreviewValue, "nodeId" | "id">) {
  const node = findNode(scene, value.nodeId), module = moduleKeyOf(scene, value.nodeId);
  if (!node || !module) return [];
  const codeId = node.codeId ?? node.id;
  return sceneInstances(scene).filter(instance => instance.module === module).map(instance => instance.map[codeId]).filter(Boolean).map(id => bindingKey([id, value.id]));
}
/** The key a preview value is read with in overlays and handles (the node in this frame). */
export const previewKey = (value: Pick<PreviewValue, "nodeId" | "id">) => bindingKey([value.nodeId, value.id]);

/** The program with a preview's edits in the brush's modules and its new values in the host block, or why it cannot be made. */
export function exploreProgram(code: string, scene: Scene, result: Pick<ExploreResult, "edits" | "values">): { code: string } | { error: string } {
  let next = code;
  const modules = new Map<string, string>();
  for (const edit of result.edits) {
    const key = moduleKeyOf(scene, edit.nodeId);
    if (!key) return { error: "노드의 코드 모듈을 찾지 못했습니다" };
    const module = modules.get(key) ?? programModules(next).get(key);
    if (!module) return { error: "노드의 코드 모듈을 찾지 못했습니다" };
    const edited = applyParameterEdits(module, [edit]);
    if ("error" in edited) return edited;
    modules.set(key, edited.module);
  }
  for (const [key, module] of modules) { const old = programModules(next).get(key)!; next = next.replace(old, () => module); }
  const params = Object.fromEntries(result.values.flatMap(value => previewKeys(scene, value).map(key => [key, value.value.value])));
  return { code: addHostParams(next, params) };
}
