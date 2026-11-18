import { z } from "zod";
import { applyParameterEdits, moduleKeyOf } from "./hidden-parameters";
import { overlaySchema, targetedResultSchema, type InspectionStep, type InspectResult, type Scalar } from "./inspection";
export { PATH_ROOT } from "./inspection";
import { nodeMachine, programModules, withBlockParams } from "./scene/machines";
import { constraintName } from "./scene/constraints";
import { SKETCH_SHAPES } from "./sketch-gestures";
import type { Scene } from "./scene/schema";
import { alignKitSchema, behaviorFallbacks, emptyIdeal, readsBehavior, type AlignKit, type AlignTool, type IdealMode, type IdealState, type TagWidget } from "./alignment";

// Execution frames: from a targeted inspection, a new frame on the board shows the
// same brush marks (the step the inspection holds) and runs the brush's execution
// forward and back with a direct manipulation handle designed as a metaphor for the
// process the concern is about: its code's own run (checkpoints AI puts in the
// algorithm, m.trace, and every drawing call, in order), how much of the recorded input
// has been executed, or which recorded step. Nothing else changes. At the moment the
// concern is about, the user draws the state they want there (see alignment.ts).

export const EXPLORE_MODES = ["execution"] as const;
export type ExploreMode = (typeof EXPLORE_MODES)[number];
/** How far execution has gone (steps done on a run, else 0..1 along the axis): overlays read it with p("@execution"). */
export const EXEC_KEY = "@execution";
export const MAX_EXPLORE_FRAMES = 16;

const editSchema = z.object({ nodeId: z.string().max(80), find: z.string().min(1).max(3000), replace: z.string().min(1).max(12000) });
/** What part of the brush an execution (or one operation of it) belongs to: a constraint, a state or a transition of a node. */
export const executionPartSchema = z.object({ kind: z.enum(["constraint", "state", "transition"]), nodeId: z.string().max(80), id: z.string().max(80) });
export type ExecutionPart = z.infer<typeof executionPartSchema>;
export const exploreResultSchema = z.object({
  /** What the frame lets the user see and what to watch as the steps go (English). */
  summary: z.string().min(1).max(1200),
  /**
   * What execution means here: one run of the brush's code, its internal operations and drawing calls in order ("run"),
   * the recorded input executed so far ("input"), or the recorded steps ("steps").
   */
  axis: z.enum(["run", "input", "steps"]),
  /** Where along the axis the process happens (0..1): execution moves within it. */
  from: z.number().min(0).max(1), to: z.number().min(0).max(1),
  /** Exact edits of the brush's module, in this frame only: checkpoints (m.trace) and inner terms (m.term) of its execution. */
  edits: z.array(editSchema).max(10),
  /** What explains each step on the picture (no handles: execution goes by the buttons, the keys and pressing a part). */
  overlays: z.array(overlaySchema.omit({ handle: true })).max(8),
  /**
   * Execution on a run: the kinds of internal operation its steps are (a checkpoint's `data.op`), each named and
   * explained (the principle of that operation), so each step reads as one of them. `[]` otherwise.
   */
  stages: z.array(z.object({ op: z.number().int().min(1).max(9), name: z.string().min(1).max(40), explain: z.string().max(300),
    /** The constraints, states or transitions of the brush this operation is part of. */
    of: z.array(executionPartSchema).max(3).default([]) })).max(6),
  /** Execution: the constraints, states or transitions of the brush the execution shown runs (all of it). */
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

/** What the frame started from: the step the inspection held (its runtime has the brush marks) and every recorded step. */
export type ExploreBase = { runtime: unknown; values: Record<string, Scalar>; steps: Pick<InspectionStep, "runtime" | "values">[] };
export type ExploreFrame = {
  id: `explore-${string}`; targetFrameId: string; brushId: string; toolId: string; mode: ExploreMode; name: string;
  /** The brush's nodes in the target frame (their values are what handles change). */
  nodeIds: string[];
  base: ExploreBase;
  /** The prepared program it runs ("" while it is prepared). */
  executable: string;
  /**
   * The brush's modules as they were when AI wrote its checkpoints (by module key): its own copy, run when the
   * frame's code changed since (the targeted inspection made with it records on the items while it is made).
   */
  modules?: Record<string, string>;
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
  /** The state the user draws at one moment of execution, and the tools AI made for it. */
  edit?: ExploreEdit;
  /** What AI was asked with (asked again on retry): the concern and the inspection as shown in the target frame. */
  request: { concern: string; inspection: InspectResult };
};
/** What an Execution frame shows at one moment: what it is about, how far execution is, the step just executed and the next, the kind of operation now. */
export type ExecutionMoment = { summary: string; axis: "run" | "input" | "steps"; done: number | null; count: number | null; progress: number; last: string; next: string; stage: { name: string; explain: string } | null };
/**
 * The state the user draws on an Execution frame's picture at one moment (`at`: the step's key, how far execution
 * was, and that moment; it is drawn only there): objects made with the tools (`ideal`), notes (`marks`, normalized)
 * and a note in words; `image` is the picture parts are lifted from (as drawn when the first was lifted).
 * The tools AI made for the concern (`kit`, at the moment `kitAt`), the preset loaded last, and fixing the brush to
 * what was drawn: under way, what AI said it changed, the fork it was applied to, or why it could not be.
 * The widgets AI made on drawn objects' tags (by object), the one open, the object one is being made for, and why one could not be.
 */
export type ExploreEdit = { mode: IdealMode; ideal: IdealState; marks: { x: number; y: number }[][]; note: string; image: string;
  at: { key: string; progress: number; moment: ExecutionMoment } | null;
  kit: AlignKit | null; kitAt: string; preset: string; kitting: boolean; kitError: string;
  making: boolean; reply: string; forkId: string; error: string;
  widgets: Record<string, TagWidget>; widgetOn: string; widgeting: string; widgetError: string };
export const emptyExploreEdit = (kit: AlignKit | null = null): ExploreEdit => ({ mode: "run", ideal: emptyIdeal(), marks: [], note: "", image: "", at: null,
  kit, kitAt: "", preset: "", kitting: false, kitError: "", making: false, reply: "", forkId: "", error: "", widgets: {}, widgetOn: "", widgeting: "", widgetError: "" });
const scalar = z.union([z.number(), z.string().max(2000), z.boolean()]);
/**
 * An exploration frame as saved with the project: what AI made in it and where it is, without the program it runs
 * (prepared again from its frame's code after loading) or what was being shown on it. One that was being made is
 * saved as placed only (made again with its Generate).
 */
export const savedExploreFrameSchema = z.object({
  id: z.string().regex(/^explore-/).max(80), targetFrameId: z.string().max(80), brushId: z.string().max(80), toolId: z.string().max(80), mode: z.enum(EXPLORE_MODES),
  /** Frames saved before were also made for recommendations: only the cause's (the Execution frame) is read. */
  source: z.object({ kind: z.literal("cause") }).optional(),
  name: z.string().max(200), nodeIds: z.array(z.string().max(80)).max(40),
  base: z.object({ runtime: z.unknown(), values: z.record(z.string().max(1200), scalar), steps: z.array(z.object({ runtime: z.unknown(), values: z.record(z.string().max(1200), scalar) })).max(20) }),
  status: z.enum(["idle", "ready", "error"]), error: z.string().max(2000), result: exploreResultSchema.nullable(), progress: z.number().min(0).max(1), values: z.record(z.string().max(1200), scalar),
  request: z.object({ concern: z.string().max(4000), inspection: targetedResultSchema }),
  /** The tools AI made for drawing the state wanted (what was drawn is not kept). */
  kit: alignKitSchema.nullable().default(null),
  modules: z.record(z.string().max(80), z.string().max(400000)).default({}),
});
/** What of an exploration frame is saved (see savedExploreFrameSchema); the recorded steps only when it moves through them. */
export function savedExplore(frame: ExploreFrame): z.input<typeof savedExploreFrameSchema> {
  const made = frame.status === "ready" || (frame.status === "error" && frame.result);
  return { id: frame.id, targetFrameId: frame.targetFrameId, brushId: frame.brushId, toolId: frame.toolId, mode: frame.mode, name: frame.name, nodeIds: frame.nodeIds,
    base: { ...frame.base, steps: frame.result?.axis === "steps" ? frame.base.steps : [] }, status: made ? "ready" : frame.status === "error" ? "error" : "idle", error: made ? "" : frame.error,
    result: made ? frame.result : null, progress: frame.progress, values: frame.values, request: frame.request, kit: frame.edit?.kit ?? null, modules: made ? frame.modules ?? {} : {} };
}
/** A saved exploration frame on the board again: its program is prepared again (empty until then). */
export function restoredExplore(saved: z.infer<typeof savedExploreFrameSchema>): ExploreFrame {
  const { kit, source: _source, ...frame } = saved;
  return { ...frame, id: saved.id as ExploreFrame["id"], executable: "", ...(kit ? { edit: emptyExploreEdit(kit) } : {}) };
}
export const isExploreFrame = (id: string): id is `explore-${string}` => id.startsWith("explore-");
export const sameExplore = (frame: Pick<ExploreFrame, "targetFrameId" | "toolId" | "mode">, other: Pick<ExploreFrame, "targetFrameId" | "toolId" | "mode">) =>
  frame.targetFrameId === other.targetFrameId && frame.toolId === other.toolId && frame.mode === other.mode;

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
 * The steps of a run, executed one at a time: its state machine steps (each FSM state visit, each constraint the
 * visited state computes, in order, and each transition), or its drawing calls when the code evaluates no FSM.
 */
export function runSteps<T extends { kind: string }>(run: { events: T[] }) {
  const checkpoints = run.events.filter(event => event.kind === "trace");
  return checkpoints.length ? checkpoints : run.events;
}

/** One FSM step of a run, as the runtime records it (see rulegenFsmEvent). */
export type FsmStep = { fsm: "state" | "constraint" | "transition"; nodeId: string; node: string; key: string; state: string;
  constraint?: string; property?: string; value?: unknown; reads?: Record<string, unknown>; inputs?: unknown; to?: string; event?: string; transition?: string };
export function fsmOf(data: unknown): FsmStep | null {
  const item = data && typeof data === "object" ? data as Partial<FsmStep> : null;
  return item && (item.fsm === "state" || item.fsm === "constraint" || item.fsm === "transition") && typeof item.nodeId === "string" && typeof item.state === "string" ? item as FsmStep : null;
}
/** Which operation a step is: the same state of the same node, the same constraint, the same transition (numbered by `ops`). */
const opKey = (data: unknown) => { const step = fsmOf(data); return step ? [step.fsm, step.nodeId, step.state, step.constraint ?? step.transition ?? ""].join("|") : ""; };
/** Each operation of a run numbered (1 …) in the order it first runs. */
function runOps(run: { events: { kind: string; data?: unknown }[] }) {
  const ops = new Map<string, number>();
  for (const event of runSteps(run)) { const key = opKey(event.data); if (key && !ops.has(key)) ops.set(key, ops.size + 1); }
  return (data: unknown) => ops.get(opKey(data)) ?? opOf(data);
}
/**
 * The state machine steps of a run: each one starts where an owner enters or evaluates a state, or takes a transition,
 * and holds the constraint steps that follow it (`steps`: indices among the run's steps, its own first).
 */
export function fsmVisits(run: { events: { kind: string; data?: unknown }[] }) {
  const visits: { start: number; head: FsmStep; steps: number[] }[] = [];
  runSteps(run).forEach((event, index) => {
    const step = fsmOf(event.data); if (!step) return;
    const open = visits.at(-1);
    if (step.fsm === "constraint" && open && open.head.fsm === "state" && open.head.nodeId === step.nodeId && open.head.key === step.key) open.steps.push(index);
    else visits.push({ start: index, head: step, steps: [index] });
  });
  return visits;
}
/** The state machine step a run's step belongs to (by its index among the run's steps); -1 when it has none. */
export function visitOf(visits: ReturnType<typeof fsmVisits>, step: number) { let found = -1; visits.forEach((visit, i) => { if (visit.start <= step) found = i; }); return found; }
/** A part of the brush, with what the scene calls it and says about it. */
export type FsmName = { name: string; explain: string; of: ExecutionPart[] };
/** What a step does in the brush's own words: the owner and its state, the constraint's property and description, or the transition. */
export function fsmName(scene: Scene, data: unknown): FsmName | null {
  const step = fsmOf(data), node = step && scene.nodes.find(item => item.id === step.nodeId);
  if (!step || !node) return null;
  const owner = `${node.name}${step.key ? ` #${step.key}` : ""}`, machine = nodeMachine(node), state = machine.states.find(item => item.id === step.state);
  const stateName = state?.label ?? step.state;
  if (step.fsm === "constraint") {
    const constraint = node.constraints.find(item => item.id === step.constraint);
    return { name: `${owner} · ${stateName} · ${constraint ? constraintName(constraint) : step.property ?? step.constraint}`, explain: constraint?.description ?? "", of: [{ kind: "constraint", nodeId: node.id, id: step.constraint ?? "" }] };
  }
  if (step.fsm === "transition") {
    const transition = machine.transitions.find(item => item.id === step.transition), to = machine.states.find(item => item.id === step.to)?.label ?? step.to;
    return { name: `${owner} · ${stateName} → ${to}`, explain: transition ? `${transition.label} (event “${transition.event}”)` : `event “${step.event}”`, of: [{ kind: "transition", nodeId: node.id, id: step.transition ?? "" }] };
  }
  return { name: `${owner} · ${stateName}`, explain: state?.description ?? "", of: [{ kind: "state", nodeId: node.id, id: step.state }] };
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
  const op = runOps(run);
  // `is`: what a state machine step is, as numbers overlays can gate on: `is.state`, `is.constraint`, `is.transition`
  // (1 for that kind) and `is.<id>` (1 for the state, constraint, property, transition or event of that id).
  const is = (data: unknown) => { const step = fsmOf(data); if (!step) return {};
    return Object.fromEntries([step.fsm, step.fsm === "constraint" ? step.constraint : step.fsm === "transition" ? step.transition : step.state, step.property, step.event].filter((id): id is string => Boolean(id)).map(id => [id, 1])); };
  const place = (event: RunEvent) => ({ ...event, trace: event.kind === "trace" ? 1 : 0, op: op(event.data), is: is(event.data),
    cx: Number.isFinite(event.x) ? event.x! + (event.w ?? 0) / 2 : 450, cy: Number.isFinite(event.y) ? event.y! + (event.h ?? 0) / 2 : 300 });
  const list = runSteps(run), budget = stepBudget(done, list), total = list.length;
  // `trace`: 1 for a checkpoint, 0 for a drawing call (expressions read numbers, not names).
  const events = run.events.map(event => ({ ...place(event), done: budget === null || event.index < budget ? 1 : 0 }));
  const steps = list.map((event, step) => ({ ...place(event), step, done: step < done ? 1 : 0 }));
  const at = (step: number) => steps[step] ? { ...steps[step], none: 0, done, total } : { none: 1, step, done, total };
  return { [RUN_ROOT]: events, [STEPS_ROOT]: steps, [NEXT_ROOT]: at(done), [LAST_ROOT]: at(done - 1), path: steps.map(step => ({ x: step.cx, y: step.cy })) };
}
/** Each operation of the run (a state of a node, one constraint, one transition): how many of its steps there are and how many are done. */
export function stageCounts(run: { events: RunEvent[] }, done: number) {
  const counts = new Map<number, { count: number; done: number; first: number }>(), opAt = runOps(run);
  runSteps(run).forEach((event, step) => { const op = opAt(event.data), entry = counts.get(op) ?? { count: 0, done: 0, first: step }; entry.count++; if (step < done) entry.done++; counts.set(op, entry); });
  return counts;
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
 * The KEY steps of a run (the ones execution stops at when it goes by state machine steps): where each state machine
 * step starts (an owner enters or evaluates a state, or takes a transition), so one step forward runs a whole visit with
 * its constraints in order, and always the end. Given as steps done (0 … count), with `keep` (e.g. a step jumped to)
 * among them. A run of more state machine steps than `limit` keeps an even spread of them (the first ones in full).
 */
export function keySteps(run: { events: RunEvent[] }, limit = KEY_STEPS, keep: number[] = []) {
  const count = runSteps(run).length, stops = new Set<number>([0, count]);
  for (const done of keep) if (done >= 0 && done <= count) stops.add(done);
  const starts = fsmVisits(run).map(visit => visit.start).filter(start => start > 0);
  // No FSM steps (code that evaluates none): every step is a stop.
  if (!starts.length && !fsmVisits(run).length) return count <= limit ? Array.from({ length: count + 1 }, (_, i) => i) : [...stops, ...Array.from({ length: limit - 1 }, (_, k) => Math.round((k + 1) * count / limit))].filter((v, i, all) => all.indexOf(v) === i).sort((a, b) => a - b);
  const room = Math.max(1, limit - stops.size), first = Math.min(starts.length, Math.floor(room / 2));
  starts.slice(0, first).forEach(start => stops.add(start));
  const rest = starts.slice(first), spread = Math.min(rest.length, room - first);
  for (let k = 1; k <= spread; k++) stops.add(rest[Math.min(rest.length - 1, Math.round(k * rest.length / spread) - 1)]);
  return [...stops].sort((a, b) => a - b);
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

/** The operation of a step (0: none). */
export const stepOp = (run: { events: RunEvent[] }, step: number) => runOps(run)(runSteps(run)[step]?.data);

/**
 * An edit that only names inner terms, decisions (m.test) and kept runtime state (m.runtime) of the steps (it adds no
 * m.trace checkpoint: the steps are the state machine steps the runtime records): without m.trace(…) calls, and with each
 * m.term("<name>", expression) back to its expression, it is the code it replaces (a one-statement body may get
 * braces to hold a checkpoint; a term may get parentheses around its expression). Wrappers the code already has
 * (e.g. m.runtime from an inspection's records) are read the same way on both sides, and none of them goes.
 */
export function traceOnly(edit: { find: string; replace: string }) {
  const squash = (text: string) => text.replace(/[\s{}]+/g, ""), bare = (text: string) => squash(text).replace(/[()]/g, "");
  const unwrap = (code: string) => { const terms = withoutTerms(withoutTraces(code)), tests = terms === null ? null : withoutTests(terms); return tests === null ? null : withoutRuntime(tests); };
  const calls = ["m.trace(", "m.term(", "m.test(", "m.runtime("], count = (text: string, call: string) => text.split(call).length - 1;
  const plain = unwrap(edit.replace), was = unwrap(edit.find), wraps = calls.slice(1).some(call => count(edit.replace, call) > count(edit.find, call));
  // Checkpoints are not added any more: the runtime records the state machine steps itself.
  if (count(edit.replace, "m.trace(") > count(edit.find, "m.trace(")) return false;
  if (!wraps || plain === null || was === null || calls.some(call => count(edit.replace, call) < count(edit.find, call))) return false;
  // Parentheses only matter where a term or a test was unwrapped (its expression may have had them or not).
  return squash(plain) === squash(was) || (wraps || was !== edit.find) && bare(plain) === bare(was) && squash(plain).length >= squash(was).length;
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

/**
 * The program with an Execution frame's edits (its checkpoints) in the brush's modules, or why it cannot be made.
 * `base`: the modules the edits were written for (by key), used instead of the program's own.
 */
export function exploreProgram(code: string, scene: Scene, result: Pick<ExploreResult, "edits">, base: Record<string, string> = {}, tolerant = false): { code: string; skipped?: number } | { error: string } {
  let next = code, skipped = 0;
  const modules = new Map<string, string>(), current = programModules(code);
  for (const edit of result.edits) {
    const key = moduleKeyOf(scene, edit.nodeId);
    if (!key || !current.has(key)) { if (tolerant) { skipped++; continue; } return { error: "Could not find the node's code module" }; }
    const module = modules.get(key) ?? base[key] ?? current.get(key)!;
    const edited = applyParameterEdits(module, [edit]);
    // `tolerant`: a checkpoint whose code is no longer there (the module was changed first) is left out.
    if ("error" in edited) { if (tolerant) { skipped++; continue; } return edited; }
    modules.set(key, edited.module);
  }
  for (const [key, module] of modules) next = next.replace(current.get(key)!, () => module);
  return { code: next, skipped };
}

/**
 * The program with the kit's behavior tools in it (in an Execution frame only): each tool's patch applied to its node's
 * module, and its values in the scene block at their fallbacks (the brush as it is until something is drawn), so the
 * frame's values set them. A tool whose patch does not apply, or does not read its values, is left out (`failed`).
 */
export function behaviorProgram(code: string, scene: Scene, tools: AlignTool[]): { code: string; failed: string[]; reasons: Record<string, string> } {
  const failed: string[] = [], kept: AlignTool[] = [], reasons: Record<string, string> = {}, original = programModules(code);
  let next = code;
  for (const tool of tools.filter(item => item.kind === "behavior")) {
    const key = tool.patch ? moduleKeyOf(scene, tool.patch.nodeId) : null, module = key ? programModules(next).get(key) : undefined;
    const edited = module && tool.patch!.edits.length && readsBehavior(tool) ? applyParameterEdits(module, tool.patch!.edits) : null;
    if (!module || !edited || "error" in edited) {
      failed.push(tool.id);
      // It would go into the code as it was: another behavior already changed the same code.
      const alone = key && original.get(key) && tool.patch ? applyParameterEdits(original.get(key)!, tool.patch.edits) : null, before = kept.filter(other => other.patch?.nodeId && key === moduleKeyOf(scene, other.patch.nodeId));
      reasons[tool.id] = alone && !("error" in alone) && before.length ? `it changes the same code as ${before.map(other => `“${other.name}”`).join(", ")}` : "its code is not in this frame's program";
      continue;
    }
    next = next.replace(module, () => edited.module); kept.push(tool);
  }
  if (!kept.length) return { code, failed, reasons };
  const withValues = withBlockParams(next, behaviorFallbacks(kept));
  return withValues ? { code: withValues, failed, reasons } : { code, failed: tools.filter(item => item.kind === "behavior").map(item => item.id), reasons };
}
