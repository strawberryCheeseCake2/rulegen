import { z } from "zod";

// The execution record of a running brush, kept by cycle. A cycle is one drawing of the frame (one run of every
// module's draw) recorded whole: every FSM step it takes — a state visit, each constraint the state computes (in
// order) and each transition — with every variable the code has at that step (see scene/instrument.ts): the
// variables of the compute function and the helpers it called, of the code that called evaluate/dispatch (the item
// loop around it), of the module's top level, and the owner's FSM values ($data, $state, $value, $event).
// A frame is recorded only when something it is drawn from changed (input, values, states, what the code keeps),
// so cycles are the moments that matter. The newest cycles are kept: at most MAX_CYCLES, MAX_CYCLE_STEPS steps in
// one cycle, and MAX_TRACE_BYTES in all (the oldest cycles go first).

export const MAX_CYCLES = 40;
export const MAX_CYCLE_STEPS = 1500;
export const MAX_TRACE_BYTES = 24_000_000;

/** The FSM values every step has besides the code's variables. */
export const FSM_VARIABLES = { $data: "data", $state: "state", $value: "value", $event: "event" } as const;

export type StepKind = "state" | "constraint" | "transition";
export type ExecStep = {
  /** Unique over the recording. */ id: number;
  cycle: number;
  /** Its event number in the cycle's run (drawing up to it shows the picture as execution had made it there). */ index: number;
  kind: StepKind;
  nodeId: string; root: string;
  /** The item of the node it is about ("" for the node itself). */ key: string;
  state: string;
  constraintId?: string; property?: string;
  to?: string; event?: string; transitionId?: string;
  label: string;
  /** Every variable at the step, by name (previews of large values). */
  variables: Record<string, unknown>;
  /** Visit number of its site within the cycle (1-based). */ visit: number;
};
export type ExecCycle = {
  id: number; at: number;
  /** The running sketch's state at the start of the cycle: restoring it and drawing again redraws the cycle. */
  runtime: unknown;
  params: Record<string, unknown>;
  steps: ExecStep[];
  /** More steps were taken than kept. */ truncated: boolean;
  bytes: number;
};
export type ExecTrace = { cycles: ExecCycle[]; bytes: number };
export const emptyTrace = (): ExecTrace => ({ cycles: [], bytes: 0 });

/** Where a step happens in the code: a constraint, a state or a transition of a node. */
export const siteOf = (step: Pick<ExecStep, "kind" | "nodeId" | "constraintId" | "state" | "transitionId">) =>
  step.kind === "constraint" ? `constraint:${step.nodeId}/${step.constraintId}` : step.kind === "transition" ? `transition:${step.nodeId}/${step.transitionId}` : `state:${step.nodeId}/${step.state}`;

const text = (value: unknown, max = 120) => typeof value === "string" ? value.slice(0, max) : "";
/** A cycle as the running sketch reported it, checked; null when it is not one. */
export function readCycle(raw: unknown, id: number, firstStepId: number): ExecCycle | null {
  if (!raw || typeof raw !== "object") return null;
  const cycle = raw as Record<string, unknown>;
  if (!Array.isArray(cycle.steps)) return null;
  const visits = new Map<string, number>();
  const steps: ExecStep[] = [];
  for (const item of cycle.steps.slice(0, MAX_CYCLE_STEPS)) {
    if (!item || typeof item !== "object") continue;
    const s = item as Record<string, unknown>;
    const kind = s.kind === "state" || s.kind === "constraint" || s.kind === "transition" ? s.kind : null;
    if (!kind || typeof s.nodeId !== "string") continue;
    const step: ExecStep = {
      id: firstStepId + steps.length, cycle: id, index: Number.isInteger(s.index) ? s.index as number : steps.length, kind,
      nodeId: text(s.nodeId, 80), root: text(s.root, 80), key: text(s.key, 80), state: text(s.state, 80), label: text(s.label, 160),
      variables: s.variables && typeof s.variables === "object" ? s.variables as Record<string, unknown> : {}, visit: 0,
      ...(kind === "constraint" ? { constraintId: text(s.constraintId, 80), property: text(s.property, 80) } : {}),
      ...(kind === "transition" ? { to: text(s.to, 80), event: text(s.event, 80), transitionId: text(s.transitionId, 80) } : {}),
    };
    const site = siteOf(step), visit = (visits.get(site) ?? 0) + 1;
    visits.set(site, visit); step.visit = visit;
    steps.push(step);
  }
  const bytes = JSON.stringify(cycle).length;
  return { id, at: Number.isFinite(cycle.at) ? cycle.at as number : Date.now(), runtime: cycle.runtime ?? null,
    params: cycle.params && typeof cycle.params === "object" ? cycle.params as Record<string, unknown> : {},
    steps, truncated: cycle.truncated === true || cycle.steps.length > steps.length, bytes };
}
/** The trace with one more cycle, the oldest dropped past the limits. */
export function addCycle(trace: ExecTrace, cycle: ExecCycle): ExecTrace {
  const cycles = [...trace.cycles, cycle];
  let bytes = trace.bytes + cycle.bytes;
  while (cycles.length > 1 && (cycles.length > MAX_CYCLES || bytes > MAX_TRACE_BYTES)) bytes -= cycles.shift()!.bytes;
  return { cycles, bytes };
}
export const traceSteps = (trace: ExecTrace) => trace.cycles.flatMap(cycle => cycle.steps);
export const nextIds = (trace: ExecTrace) => {
  const last = trace.cycles.at(-1);
  return { cycle: (last?.id ?? 0) + 1, step: (last?.steps.at(-1)?.id ?? last?.id ?? 0) + 1 };
};

// Paths. "@name" or "@name.field.0" read a variable of the step (a name the code declared, or $data, $state, $value,
// $event); the step's own fields are read without "@" (state, key, property, event).
/** The value at a path of a step (undefined when it has none). */
export function readPath(step: ExecStep, path: string): unknown {
  if (!path.startsWith("@")) return (step as unknown as Record<string, unknown>)[path];
  const [name, ...rest] = path.slice(1).split(".");
  let value: unknown = step.variables[name];
  for (const part of rest) {
    if (value === null || typeof value !== "object") return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}
/** How a path is shown: `@$data.position` → `data.position`, `@g.x` → `g.x`. */
export function pathLabel(path: string) {
  const bare = path.replace(/^@/, "");
  const [name, ...rest] = bare.split(".");
  const shown = name in FSM_VARIABLES ? FSM_VARIABLES[name as keyof typeof FSM_VARIABLES] : name;
  return [shown, ...rest].join(".").replace(/\.(\d+)(?=\.|$)/g, "[$1]");
}
/** A value in a few characters. */
export function formatValue(value: unknown, max = 80): string {
  const round = (n: number) => Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
  const out = typeof value === "number" ? round(value) : typeof value === "string" ? JSON.stringify(value)
    : value === undefined ? "—" : JSON.stringify(value, (_key, item) => typeof item === "number" ? Math.round(item * 100) / 100 : item);
  return out.length > max ? out.slice(0, max - 1) + "…" : out;
}

// What a concern selects: sites (with the variables that explain it there) and how many recent cycles.
export const MAX_ANALYSIS_SITES = 8, MAX_ANALYSIS_PATHS = 8, MAX_MATCHES = 120;
export const analysisSchema = z.object({
  /** What the selection shows about the concern (the user's language). */
  summary: z.string().max(800),
  /** How many of the most recent cycles to show (1 to the number recorded). */
  cycleCount: z.number().int().min(1).max(MAX_CYCLES),
  sites: z.array(z.object({
    site: z.string().max(200),
    /** Why this step matters for the concern. */
    note: z.string().max(300),
    /** The variables shown on the picture: only those that directly answer the concern, most relevant first ("@name.field"). */
    show: z.array(z.string().max(160)).max(MAX_ANALYSIS_PATHS),
    /** Variables only used to place or identify the item on the picture (positions, ids, boxes); never shown. */
    locate: z.array(z.string().max(160)).max(MAX_ANALYSIS_PATHS),
    /** Which visits of the site in each cycle (1-based, inclusive); null: all. */
    range: z.object({ start: z.number().int().min(1), end: z.number().int().min(1) }).nullable(),
  })).max(MAX_ANALYSIS_SITES),
});
export type Analysis = z.infer<typeof analysisSchema>;
/** The recorded steps a concern's analysis selects, oldest first (at most MAX_MATCHES, the newest kept). */
export function matchSteps(trace: ExecTrace, analysis: Analysis): ExecStep[] {
  const bySite = new Map(analysis.sites.map(site => [site.site, site]));
  const cycles = trace.cycles.slice(-Math.max(1, analysis.cycleCount));
  const out = cycles.flatMap(cycle => cycle.steps.filter(step => {
    const site = bySite.get(siteOf(step));
    return Boolean(site) && (!site!.range || (step.visit >= site!.range.start && step.visit <= site!.range.end));
  }));
  return out.slice(-MAX_MATCHES);
}
/** The paths shown at each site of an analysis. */
export const shownPaths = (analysis: Analysis | null): Record<string, string[]> => Object.fromEntries((analysis?.sites ?? []).map(site => [site.site, site.show]));
/** Whether a field is one of the shown paths (or a part of one, or holds one). */
export const isShown = (shown: string[], path: string) => shown.some(item => item === path || path.startsWith(item + ".") || item.startsWith(path + "."));

/**
 * Every variable recorded at each site (names, and a sample value of the newest step), for AI to choose from:
 * the candidates are all the variables of the code, not a chosen few.
 */
export function variableCatalog(trace: ExecTrace, maxSample = 160) {
  const sites = new Map<string, { site: string; label: string; visits: number; variables: Record<string, string> }>();
  for (const cycle of trace.cycles) for (const step of cycle.steps) {
    const site = siteOf(step), entry = sites.get(site) ?? { site, label: step.label.replace(/ #\S+/, ""), visits: 0, variables: {} };
    entry.visits++;
    for (const [name, value] of Object.entries(step.variables)) entry.variables[name] = formatValue(value, maxSample);
    sites.set(site, entry);
  }
  return [...sites.values()];
}
