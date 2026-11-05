import { z } from "zod";
import { applyParameterEdits, moduleKeyOf } from "./hidden-parameters";
import { overlaySchema, targetedResultSchema, type InspectionStep, type InspectResult, type Recommendation, type Scalar } from "./inspection";
export { PATH_ROOT } from "./inspection";
import { findNode } from "./scene/graph";
import { addHostMachines, addHostParams, programModules, sceneInstances } from "./scene/machines";
import { applyMachineChange, machineChangeSchema, type MachineChange } from "./machine-change";
import { SKETCH_SHAPES } from "./sketch-gestures";
import { idSchema, numberValueSchema, toggleValueSchema, type Scene } from "./scene/schema";
import { bindingKey } from "./scene/values";
import type { PictureEdit } from "./preview-objects";

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
export const MAX_EXPLORE_FRAMES = 16;

// Room for a recommendation's preview, which may rewrite a whole rule (an output cut at a limit loses everything after it).
const editSchema = z.object({ nodeId: z.string().max(80), find: z.string().min(1).max(3000), replace: z.string().min(1).max(12000) });
/** A value a preview reads that the scene does not have (the recommendation's new quantity), with its range. */
export const previewValueSchema = z.object({ nodeId: z.string().max(80), id: idSchema, label: z.string().min(1).max(80), value: z.union([numberValueSchema, toggleValueSchema]) });
export type PreviewValue = z.infer<typeof previewValueSchema>;
/** What part of the brush an execution (or one operation of it) belongs to: a semantic transformation, a state or a transition of a node. */
export const executionPartSchema = z.object({ kind: z.enum(["transformation", "state", "transition"]), nodeId: z.string().max(80), id: z.string().max(80) });
export type ExecutionPart = z.infer<typeof executionPartSchema>;
export const exploreResultSchema = z.object({
  /** What the frame lets the user see and how the handle maps onto it (English). */
  summary: z.string().min(1).max(1200),
  /**
   * What execution means here: one run of the brush's code, its internal operations and drawing calls in order ("run"),
   * the recorded input executed so far ("input"), or the recorded steps ("steps").
   */
  axis: z.enum(["run", "input", "steps"]),
  /** Where along the axis the process happens (0..1): the execution handle moves within it. */
  from: z.number().min(0).max(1), to: z.number().min(0).max(1),
  /** Exact edits of the brush's module, in this frame only: checkpoints (m.trace) and inner terms (m.term) of its execution, and a recommendation not applied yet. */
  edits: z.array(editSchema).max(10),
  /** The values the edits read that do not exist yet. */
  values: z.array(previewValueSchema).max(4),
  /** A recommendation's preview that makes the brush react to something it meets: the states and transitions it brings to the machine. */
  machine: machineChangeSchema.nullable().default(null),
  overlays: z.array(overlaySchema).max(8),
  /**
   * Execution on a run: the kinds of internal operation its steps are (a checkpoint's `data.op`), each named and
   * explained (the principle of that operation), so each step reads as one of them. `[]` otherwise.
   */
  stages: z.array(z.object({ op: z.number().int().min(1).max(9), name: z.string().min(1).max(40), explain: z.string().max(300),
    /** One gesture of this operation's handle may run several steps (one continuous motion through many items); otherwise one gesture is one step. */
    many: z.boolean(),
    /** The semantic transformations, states or transitions of the brush this operation is part of. */
    of: z.array(executionPartSchema).max(3).default([]) })).max(6),
  /** Execution: the semantic transformations, states or transitions of the brush the execution shown runs (all of it). */
  of: z.array(executionPartSchema).max(4).default([]),
  /**
   * Operations performed by drawing a mark instead of (or as well as) dragging a handle: the mark (`shape`), where it
   * goes (`x`, `y`, `w`, `h`: expressions like an overlay's, on what the next step works on) and what it means (`hint`).
   * An arrow's target (`toX`, `toY`), the point list a trace follows (`path`, "<root>:<path>" as `each` reads it) and a
   * custom mark's own shape (`template`, points in any units) are given when the shape uses them ("" / [] otherwise).
   * Drawing it there and submitting it executes the next step of that operation.
   */
  sketches: z.array(z.object({ op: z.number().int().min(1).max(9), shape: z.enum(SKETCH_SHAPES),
    x: z.string().max(400), y: z.string().max(400), w: z.string().max(400), h: z.string().max(400),
    toX: z.string().max(400), toY: z.string().max(400), path: z.string().max(200),
    template: z.array(z.object({ x: z.number(), y: z.number() })).max(64), hint: z.string().max(80) })).max(6),
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
  /**
   * "queued": made with its targeted tool, waiting for its turn (the AI requests go one after another);
   * "idle": placed only (Execution frames made later): AI makes it when its Generate is pressed.
   */
  status: "idle" | "queued" | "loading" | "ready" | "error"; error: string;
  result: ExploreResult | null;
  /** How far execution has gone (0..1 along the axis). */
  progress: number;
  /** Values dragged in this frame. */
  values: Record<string, Scalar>;
  /** What the user showed on its picture at one moment of execution, for a new recommendation (Execution only). */
  edit?: ExploreEdit;
  /** What AI was asked with (asked again on retry): the concern, the inspection as shown in the target frame, the recommendation. */
  request: { concern: string; inspection: InspectResult; recommendation: (Recommendation & { applied: boolean }) | null };
};
/** What an Execution frame shows at one moment: what it is about, how far execution is, the step just executed and the next, the kind of operation now. */
export type ExecutionMoment = { summary: string; axis: "run" | "input" | "steps"; done: number | null; count: number | null; progress: number; last: string; next: string; stage: { name: string; explain: string } | null };
/**
 * Annotation and crops moved, scaled or rotated on an Execution frame's picture, made at one moment (`at`: the step's
 * key, how far execution was, and that moment; they are drawn only there), and the recommendation asked for from them.
 */
export type ExploreEdit = PictureEdit & { at: { key: string; progress: number; moment: ExecutionMoment } | null; making: boolean; reply: string; error: string };
export const emptyExploreEdit = (): ExploreEdit => ({ mode: "run", marks: [], manipulations: [], image: "", note: "", at: null, making: false, reply: "", error: "" });
const scalar = z.union([z.number(), z.string().max(2000), z.boolean()]);
/**
 * An exploration frame as saved with the project: what AI made in it and where it is, without the program it runs
 * (prepared again from its frame's code after loading) or what was being shown on it. One that was being made is
 * saved as placed only (made again with its Generate).
 */
export const savedExploreFrameSchema = z.object({
  id: z.string().regex(/^explore-/).max(80), targetFrameId: z.string().max(80), brushId: z.string().max(80), toolId: z.string().max(80), mode: z.enum(EXPLORE_MODES),
  source: z.union([z.object({ kind: z.literal("cause") }), z.object({ kind: z.literal("recommendation"), index: z.number().int().min(0), title: z.string().max(200), key: z.string().max(400), applied: z.boolean() })]),
  name: z.string().max(200), nodeIds: z.array(z.string().max(80)).max(40),
  base: z.object({ runtime: z.unknown(), values: z.record(z.string().max(1200), scalar), steps: z.array(z.object({ runtime: z.unknown(), values: z.record(z.string().max(1200), scalar) })).max(20), params: z.record(z.string().max(1200), scalar) }),
  status: z.enum(["idle", "ready", "error"]), error: z.string().max(2000), result: exploreResultSchema.nullable(), progress: z.number().min(0).max(1), values: z.record(z.string().max(1200), scalar),
  request: z.object({ concern: z.string().max(4000), inspection: targetedResultSchema, recommendation: targetedResultSchema.shape.recommendations.element.extend({ applied: z.boolean() }).nullable() }),
});
/** What of an exploration frame is saved (see savedExploreFrameSchema); the recorded steps only when it moves through them. */
export function savedExplore(frame: ExploreFrame): z.input<typeof savedExploreFrameSchema> {
  const made = frame.status === "ready" || (frame.status === "error" && frame.result);
  return { id: frame.id, targetFrameId: frame.targetFrameId, brushId: frame.brushId, toolId: frame.toolId, mode: frame.mode, source: frame.source, name: frame.name, nodeIds: frame.nodeIds,
    base: { ...frame.base, steps: frame.result?.axis === "steps" ? frame.base.steps : [] }, status: made ? "ready" : frame.status === "error" ? "error" : "idle", error: made ? "" : frame.error,
    result: made ? frame.result : null, progress: frame.progress, values: frame.values, request: frame.request };
}
/** A saved exploration frame on the board again: its program is prepared again (empty until then). */
export const restoredExplore = (saved: z.infer<typeof savedExploreFrameSchema>): ExploreFrame => ({ ...saved, id: saved.id as ExploreFrame["id"], executable: "" });
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
type RunEvent = { index: number; kind: string; label: string; x?: number; y?: number; w?: number; h?: number; data?: unknown; item?: string;
  /** A checkpoint's inner terms (m.term) computed in its step: each one's last value, mean size and how often. */ terms?: Record<string, StepTerm>;
  /** The decisions (m.test) made in its step: what was tested, where, and how it came out. */ tests?: StepTest[] };
export type StepTerm = { last: unknown; mean: number | null; n: number };
/** A decision a step made (m.test): its name, how it came out, the geometry it tested and what each outcome means. */
export type StepTest = { name: string; pass: boolean; shape: unknown; yes?: string; no?: string };
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
/**
 * The moments of the run that draw at a point of the canvas (canvas pixels), in order: for every step that makes a
 * drawing call (or passes a checkpoint) whose box holds the point (a few pixels of slack), the steps done once that
 * call is drawn, with the smallest such call. When none holds it, the nearest one close by. A box covering most of
 * the canvas (a background) is no part of anything.
 */
export function stepsAt(run: { events: RunEvent[] }, point: { x: number; y: number }, slack = 6, reach = 30) {
  const starts = runSteps(run).map(step => step.index);
  // Steps done when the event is drawn: every step that starts at or before it (an event before the first is drawn at 0).
  const doneAt = (index: number) => { let n = 0; for (const start of starts) { if (start > index) break; n++; } return n; };
  const area = (event: RunEvent) => (event.w ?? 0) * (event.h ?? 0);
  const placed = run.events.filter(event => Number.isFinite(event.x) && Number.isFinite(event.y) && area(event) < 900 * 600 * .5);
  const gap = (event: RunEvent) => Math.hypot(Math.max(event.x! - point.x, 0, point.x - event.x! - (event.w ?? 0)), Math.max(event.y! - point.y, 0, point.y - event.y! - (event.h ?? 0)));
  const holding = placed.filter(event => gap(event) <= slack);
  const nearest = holding.length ? holding : placed.filter(event => gap(event) <= reach).sort((a, b) => gap(a) - gap(b)).slice(0, 1);
  const byDone = new Map<number, RunEvent>();
  for (const event of nearest) { const done = doneAt(event.index), kept = byDone.get(done); if (!kept || area(event) < area(kept)) byDone.set(done, event); }
  return [...byDone.entries()].sort((a, b) => a[0] - b[0]).map(([done, event]) => ({ done, event }));
}
/** Where pressing there goes from `done` steps: the next moment after it that draws there, else the first (pressing again goes on). */
export function jumpTarget<T extends { done: number }>(moments: T[], done: number) {
  return moments.find(moment => moment.done > done) ?? moments[0] ?? null;
}
/**
 * The KEY steps of a long run (the ones execution stops at; everything between them runs at once): the first round
 * of its operations in full (one item through every operation, up to half the stops), then the rest in even chunks
 * that end where an operation's run of steps ends, and always the end. Given as steps done (0 … count), with `keep`
 * (e.g. a step jumped to) among them. A run short enough keeps every step.
 */
export function keySteps(run: { events: RunEvent[] }, limit = KEY_STEPS, keep: number[] = []) {
  const ops = runSteps(run).map(event => opOf(event.data)), count = ops.length, stops = new Set<number>([0, count]);
  for (const done of keep) if (done >= 0 && done <= count) stops.add(done);
  if (count <= limit) return Array.from({ length: count + 1 }, (_, i) => i);
  // The first round: until the first operation comes round again after another one (or one step, for a run of one operation).
  let round = 1;
  while (round < count && !(ops[round] === ops[0] && ops.slice(1, round).some(op => op !== ops[0]))) round++;
  if (round >= count || ops.every(op => op === ops[0])) round = 1;
  for (let done = 1; done <= Math.min(round, Math.floor(limit / 2)); done++) stops.add(done);
  // Then chunks spread evenly over the rest, each ending where a round of the operations ends (the first operation comes
  // again), or, for a run without rounds, where a run of one operation ends.
  const ends: number[] = [];
  for (let step = round; step < count; step++) {
    const end = step === count - 1 || (round > 1 ? ops[step + 1] === ops[0] && ops[step] !== ops[0] : ops[step + 1] !== ops[step]);
    if (end) ends.push(step + 1);
  }
  const room = Math.max(1, limit - stops.size), pool = ends.length > 1 ? ends : Array.from({ length: count - round }, (_, i) => round + i + 1);
  for (let k = 1; k <= Math.min(room, pool.length); k++) stops.add(pool[Math.min(pool.length - 1, Math.round(k * pool.length / Math.min(room, pool.length)) - 1)]);
  return [...stops].sort((a, b) => a - b);
}
/**
 * The steps where one mark changes, as steps done once each is executed: the steps whose checkpoint or drawing calls
 * belong to its item (m.focus), or, for a mark without one, the step of its own drawing call (`index`).
 */
export function markSteps(run: { events: (RunEvent & { item?: string })[] }, mark: { item: string | null; index: number }) {
  const starts = runSteps(run).map(event => event.index), out: number[] = [];
  const mine = (event: RunEvent & { item?: string }) => mark.item !== null ? event.item === mark.item : event.index === mark.index;
  for (let k = 0; k < starts.length; k++) {
    const end = k + 1 < starts.length ? starts[k + 1] : Infinity;
    if (run.events.some(event => event.index >= starts[k] && event.index < end && mine(event))) out.push(k + 1);
  }
  return out;
}
type Point = { x: number; y: number };
const isPoint = (value: unknown): value is Point => Boolean(value) && typeof value === "object" && Number.isFinite((value as Point).x) && Number.isFinite((value as Point).y);
const onCanvas = (point: Point) => point.x >= -100 && point.x <= 1000 && point.y >= -100 && point.y <= 700;
/**
 * The geometry a step's data holds, to draw where the step works (canvas pixels), by the name it has there: every
 * list of points as a path (thinned to 200), every single point; the step's own place (its `x`, `y`) is not one of them.
 */
export function dataShapes(data: unknown, limit = 12) {
  const out: { key: string; points: Point[] }[] = [];
  const walk = (value: unknown, key: string, depth: number) => {
    if (out.length >= limit || depth > 3 || !value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      const points = value.filter(isPoint).filter(onCanvas);
      if (points.length >= 2) { const step = Math.ceil(points.length / 200); out.push({ key, points: points.filter((_, i) => i % step === 0 || i === points.length - 1) }); return; }
      value.slice(0, 20).forEach((item, i) => walk(item, `${key}.${i}`, depth + 1)); return;
    }
    if (depth > 0 && isPoint(value)) { if (onCanvas(value)) out.push({ key, points: [{ x: value.x, y: value.y }] }); return; }
    for (const [name, child] of Object.entries(value)) walk(child, key ? `${key}.${name}` : name, depth + 1);
  };
  walk(data, "", 0);
  return out;
}
/** A step's inner terms split by what they are: vectors (drawn as arrows) and numbers (drawn as signed bars), with their mean size. */
export function termGlyphs(terms: Record<string, StepTerm> | undefined) {
  const vectors: { name: string; v: [number, number] }[] = [], scalars: { name: string; value: number }[] = [];
  for (const [name, term] of Object.entries(terms ?? {})) {
    const last = term.last;
    if (typeof last === "number" && Number.isFinite(last)) scalars.push({ name, value: last });
    else if (Array.isArray(last) && Number.isFinite(last[0]) && Number.isFinite(last[1])) vectors.push({ name, v: [Number(last[0]), Number(last[1])] });
    else if (isPoint(last)) vectors.push({ name, v: [last.x, last.y] });
  }
  return { vectors, scalars };
}
type Box = { x: number; y: number; w: number; h: number };
/** A shape a decision tested, as drawn: a reach (circle), a region (rect), a distance (line) or a point. */
export type TestShape = { kind: "circle"; x: number; y: number; r: number } | { kind: "rect"; x: number; y: number; w: number; h: number }
  | { kind: "line"; x1: number; y1: number; x2: number; y2: number } | { kind: "point"; x: number; y: number };
const finite = (...values: unknown[]) => values.every(value => typeof value === "number" && Number.isFinite(value));
function testShape(value: unknown): TestShape | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (finite(v.x, v.y, v.r) && Number(v.r) >= 0) return { kind: "circle", x: Number(v.x), y: Number(v.y), r: Number(v.r) };
  if (finite(v.x, v.y, v.w, v.h)) return { kind: "rect", x: Number(v.x), y: Number(v.y), w: Number(v.w), h: Number(v.h) };
  if (finite(v.x1, v.y1, v.x2, v.y2)) return { kind: "line", x1: Number(v.x1), y1: Number(v.y1), x2: Number(v.x2), y2: Number(v.y2) };
  if (finite(v.x, v.y)) return { kind: "point", x: Number(v.x), y: Number(v.y) };
  return null;
}
const shapeBox = (shape: TestShape): Box => shape.kind === "circle" ? { x: shape.x - shape.r, y: shape.y - shape.r, w: shape.r * 2, h: shape.r * 2 }
  : shape.kind === "rect" ? { x: Math.min(shape.x, shape.x + shape.w), y: Math.min(shape.y, shape.y + shape.h), w: Math.abs(shape.w), h: Math.abs(shape.h) }
  : shape.kind === "line" ? { x: Math.min(shape.x1, shape.x2), y: Math.min(shape.y1, shape.y2), w: Math.abs(shape.x2 - shape.x1), h: Math.abs(shape.y2 - shape.y1) } : { x: shape.x, y: shape.y, w: 0, h: 0 };
/**
 * A step's decisions as drawn: the shapes each tested (up to 3; a list of shapes, e.g. both items' reaches), how it
 * came out and its verdict (what the outcome means there, or the test's name with ✓ / ✗), placed above what it tested.
 */
export function testGlyphs(tests: StepTest[] | undefined) {
  return (tests ?? []).flatMap(test => {
    const shapes = (Array.isArray(test.shape) ? test.shape : [test.shape]).map(testShape).filter((shape): shape is TestShape => Boolean(shape)).slice(0, 3);
    if (!shapes.length) return [];
    const boxes = shapes.map(shapeBox), left = Math.min(...boxes.map(b => b.x)), top = Math.min(...boxes.map(b => b.y)), right = Math.max(...boxes.map(b => b.x + b.w));
    const said = (test.pass ? test.yes : test.no)?.trim();
    return [{ name: test.name, pass: test.pass, shapes, verdict: said || `${test.pass ? "" : "not "}${test.name}`, at: { x: (left + right) / 2, y: top } }];
  });
}
/** Most key steps a run is shown in before "All steps". */
export const KEY_STEPS = 24;
/** The key step before or after `done` (or `done` itself at an end). */
export const keyStep = (keys: number[], done: number, way: 1 | -1) => way > 0 ? keys.find(stop => stop > done) ?? keys.at(-1) ?? done : [...keys].reverse().find(stop => stop < done) ?? 0;

/** The operation of a step (0: not named). */
export const stepOp = (run: { events: RunEvent[] }, step: number) => opOf(runSteps(run)[step]?.data);

/**
 * An edit that only adds checkpoints and names inner terms, decisions (m.test) and kept runtime state (m.runtime): without its m.trace(…) calls, and with each
 * m.term("<name>", expression) back to its expression, it is the code it replaces (a one-statement body may get
 * braces to hold a checkpoint; a term may get parentheses around its expression).
 */
export function traceOnly(edit: { find: string; replace: string }) {
  const squash = (text: string) => text.replace(/[\s{}]+/g, ""), bare = (text: string) => squash(text).replace(/[()]/g, "");
  const terms = withoutTerms(withoutTraces(edit.replace)), tests = terms === null ? null : withoutTests(terms), plain = tests === null ? null : withoutRuntime(tests);
  const wraps = ["m.term(", "m.test(", "m.runtime("].some(call => edit.replace.includes(call));
  if (!(edit.replace.includes("m.trace(") || wraps) || plain === null) return false;
  // Parentheses only matter where a term or a test was unwrapped (its expression may have had them or not).
  return squash(plain) === squash(edit.find) || (wraps && bare(plain) === bare(edit.find) && squash(plain).length >= squash(edit.find).length);
}
/** The arguments of a call between `open` (its "(") and `close` (its ")"), split at the commas outside brackets and strings. */
function callArgs(code: string, open: number, close: number) {
  const args: string[] = []; let depth = 0, quote = "", start = open + 1;
  for (let i = open + 1; i < close; i++) {
    const c = code[i];
    if (quote) { if (c === "\\") i++; else if (c === quote) quote = ""; continue; }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    else if (c === "," && depth === 0) { args.push(code.slice(start, i)); start = i + 1; }
  }
  return [...args, code.slice(start, close)];
}
/**
 * The code with every m.test("<name>", condition, shape, outcomes) back to (condition); null when one is not written
 * that way. Its shape and outcomes only describe the decision (they are read, never change anything).
 */
export function withoutTests(code: string): string | null {
  let out = "", i = 0;
  for (let at = code.indexOf("m.test(", i); at >= 0; at = code.indexOf("m.test(", i)) {
    out += code.slice(i, at);
    const open = at + "m.test".length, close = closing(code, open);
    if (close < 0) return null;
    const args = callArgs(code, open, close);
    if (args.length < 2 || args.length > 4 || !/^\s*(["'])[a-z0-9-]{1,40}\1\s*$/.test(args[0]) || !args[1].trim()) return null;
    out += `(${args[1].trim()})`; i = close + 1;
  }
  return out + code.slice(i);
}
/** The code with every m.runtime("<name>", id, expression) back to (expression); null when one is not written that way. */
export function withoutRuntime(code: string): string | null {
  let out = "", i = 0;
  for (let at = code.indexOf("m.runtime(", i); at >= 0; at = code.indexOf("m.runtime(", i)) {
    out += code.slice(i, at);
    const open = at + "m.runtime".length, close = closing(code, open);
    if (close < 0) return null;
    const args = callArgs(code, open, close);
    if (args.length !== 3 || !/^\s*(["'])[a-z0-9-]{1,40}\1\s*$/.test(args[0]) || !args[1].trim() || !args[2].trim()) return null;
    out += `(${args[2].trim()})`; i = close + 1;
  }
  return out + code.slice(i);
}
/** The code with every m.term("<name>", expression) back to (expression); null when one is not written that way. */
export function withoutTerms(code: string): string | null {
  let out = "", i = 0;
  for (let at = code.indexOf("m.term(", i); at >= 0; at = code.indexOf("m.term(", i)) {
    out += code.slice(i, at);
    const open = at + "m.term".length, close = closing(code, open);
    if (close < 0) return null;
    const head = /^\(\s*(["'])[a-z0-9-]{1,40}\1\s*,/.exec(code.slice(open, close));
    if (!head) return null;
    out += `(${code.slice(open + head[0].length, close).trim()})`; i = close + 1;
  }
  return out + code.slice(i);
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
export function exploreProgram(code: string, scene: Scene, result: Pick<ExploreResult, "edits" | "values"> & { machine?: MachineChange | null }): { code: string } | { error: string } {
  let next = code;
  const modules = new Map<string, string>();
  for (const edit of result.edits) {
    const key = moduleKeyOf(scene, edit.nodeId);
    if (!key) return { error: "Could not find the node's code module" };
    const module = modules.get(key) ?? programModules(next).get(key);
    if (!module) return { error: "Could not find the node's code module" };
    const edited = applyParameterEdits(module, [edit]);
    if ("error" in edited) return edited;
    modules.set(key, edited.module);
  }
  for (const [key, module] of modules) { const old = programModules(next).get(key)!; next = next.replace(old, () => module); }
  // The states and transitions it emits are in the program's machines (the rest of the host block as it was).
  if (result.machine) { const changed = applyMachineChange(scene, result.machine); if (changed !== scene) next = addHostMachines(next, changed); }
  const params = Object.fromEntries(result.values.flatMap(value => previewKeys(scene, value).map(key => [key, value.value.value])));
  return { code: addHostParams(next, params) };
}
