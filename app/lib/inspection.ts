import { z } from "zod";
import { MAX_PARAMETER_SUGGESTIONS, parameterSuggestionSchema, recordingSchema } from "./hidden-parameters";
import { findNode } from "./scene/graph";
import type { Scene, SceneBinding } from "./scene/schema";
import { findProperty, propertyOwner } from "./scene/transformations";
import { sceneBindings, layoutKey } from "./scene/values";

// Inspection of one brush in one frame: the running result records a step at
// every state change (up to MAX_STEPS), with the brush's live values and the
// runtime state, so the user can step through states, transitions and constraint
// (semantic transformation) values. Targeted inspection adds AI overlays.

export const MAX_STEPS = 20;
export type Scalar = number | string | boolean;
export type InspectionStep = {
  id: number; at: number;
  /** null for the start of recording. */
  nodeId: string | null; from: string | null; to: string | null; transitionId: string | null;
  values: Record<string, Scalar>;
  /** The running sketch's state at that moment (module stores, machine states, random seed); selecting the step restores it. */
  runtime: unknown;
};
/** What an overlay, row or recommendation points at (a transformation only from recommendations). */
export type InspectionFocus = { kind: "constraint" | "state" | "transition" | "transformation"; nodeId: string; id: string };
/** How an annotation mark is drawn: color, width (canvas pixels of the 900×600 frame) and opacity. */
export const markStyleSchema = z.object({ color: z.string().regex(/^#[0-9a-fA-F]{6}$/), width: z.number().min(1).max(30), opacity: z.number().min(.1).max(1) });
export type MarkStyle = z.infer<typeof markStyleSchema>;
export const DEFAULT_MARK_STYLE: MarkStyle = { color: "#7c3aed", width: 6, opacity: .85 };
/** How many strokes one inspection annotation (and a targeted tool) keeps; the oldest go first. */
export const MAX_MARKS = 128;
export const MARK_COLORS = ["#7c3aed", "#e0457b", "#e07b00", "#1f8a5b", "#2563eb", "#1f2328"];
export type InspectionState = {
  brushId: string; steps: InspectionStep[]; cursor: number | null;
  /** The inspection annotation being drawn (normalized 0..1) and its concern; they become a targeted tool. */
  marks: { x: number; y: number }[][]; concern: string;
  /** The style of each mark, by index (a missing one is the default). */
  markStyles: MarkStyle[];
  focus: InspectionFocus | null;
};
export const emptyInspection = (brushId = ""): InspectionState => ({ brushId, steps: [], cursor: null, marks: [], markStyles: [], concern: "", focus: null });
export const markStyleAt = (styles: MarkStyle[] | undefined, index: number) => styles?.[index] ?? DEFAULT_MARK_STYLE;

/** Keep the newest MAX_STEPS steps. */
export function addStep(state: InspectionState, step: Omit<InspectionStep, "id">): InspectionState {
  const id = (state.steps.at(-1)?.id ?? 0) + 1;
  const steps = [...state.steps, { ...step, id }].slice(-MAX_STEPS);
  const cursor = state.cursor === null ? null : Math.min(state.cursor, steps.length - 1);
  return { ...state, steps, cursor };
}

const prefixOf = (nodeId: string) => `${encodeURIComponent(nodeId)}/`;
/** Values of the given nodes only: their constraint keys and layout boxes. */
export function filterValues(values: Record<string, unknown>, nodeIds: string[]) {
  const prefixes = nodeIds.map(prefixOf);
  return Object.fromEntries(Object.entries(values).filter(([key, value]) => prefixes.some(prefix => key.startsWith(prefix)) && ["number", "string", "boolean"].includes(typeof value))) as Record<string, Scalar>;
}

export type ConstraintRow = { key: string; binding: SceneBinding; node: string; transformation: string; transformationId: string; property: string; path: string };
/** Constraint (semantic transformation) rows of the brush, in node/transformation order. */
export function constraintRows(scene: Scene, nodeIds: string[]): ConstraintRow[] {
  const ids = new Set(nodeIds);
  return sceneBindings(scene).filter(binding => ids.has(binding.nodeId)).map(binding => {
    const node = findNode(scene, binding.nodeId)!, property = findProperty(node, binding.path[0]), owner = propertyOwner(node, binding.path[0]);
    return { key: binding.key, binding, node: node.name, transformation: owner?.label || "", transformationId: owner?.id || "",
      property: property?.label || binding.path[0], path: binding.path.slice(1).join(" › ") };
  });
}
export const layoutKeys = (nodeIds: string[]) => nodeIds.flatMap(id => (["x", "y", "w", "h"] as const).map(field => layoutKey(id, field)));

export function changedKeys(steps: InspectionStep[], index: number) {
  const step = steps[index], previous = steps[index - 1];
  if (!step || !previous) return new Set<string>();
  return new Set(Object.keys(step.values).filter(key => step.values[key] !== previous.values[key]));
}
export const formatScalar = (value: Scalar | undefined) => value === undefined ? "—" : typeof value === "number" ? String(Math.round(value * 100) / 100) : String(value);

// ── Targeted inspection result (AI) ─────────────────────────────────────────

const link = z.object({ kind: z.enum(["constraint", "state", "transition"]), nodeId: z.string().max(80), id: z.string().max(80) });
const scalar = z.union([z.number(), z.string().max(200), z.boolean()]);
export const overlaySchema = z.object({
  id: z.string().min(1).max(80), kind: z.enum(["rect", "ellipse", "line", "label"]),
  /** What this color shows, in plain words (the legend). */
  name: z.string().max(60).default(""),
  /** Expressions in canvas pixels; may read values with p("key"). For a line, w/h are the end offset. */
  x: z.string().max(400), y: z.string().max(400), w: z.string().max(400), h: z.string().max(400),
  /** Text with ${expression} parts, e.g. "w=${p(\"star/size\")}". */
  label: z.string().max(300), color: z.string().regex(/^#[0-9a-fA-F]{6}$/), link,
  /** Shown only at steps where this expression is non-zero (empty: every step). */
  when: z.string().max(400).default(""),
  /** "<root id>:<store path>": draw once per item of that array in the module's m.store (item("…"), i). Empty: once. */
  each: z.string().max(200).default(""),
});
const change = z.object({ key: z.string().max(1200), stateId: z.string().max(80), value: scalar });
/** "add-transformation": nothing existing is related, so a NEW semantic transformation is stacked on node `nodeId` (targetId ""). */
const recommendationSchema = z.object({ kind: z.enum(["value", "transformation", "add-transformation", "state", "transition"]), nodeId: z.string().max(80), targetId: z.string().max(80),
  /** A transformation fix that needs other transformations of the node changed too: those ids (targetId is the main one). */
  targetIds: z.array(z.string().max(80)).max(6).default([]),
  title: z.string().min(1).max(160), detail: z.string().max(800), changes: z.array(change).max(12) });
export const inspectResultSchema = z.object({
  summary: z.string().min(1).max(1500),
  overlays: z.array(overlaySchema).max(12),
  /** Value-only fixes for the concern, applied with one click. */
  valueFixes: z.array(change.extend({ reason: z.string().max(400) })).max(12),
  /** Other ways to resolve it: values, or changing a transformation, state or transition. */
  recommendations: z.array(recommendationSchema).max(6),
  /** Constants the code hard-codes that the concern depends on, suggested as new properties (accept / reject). */
  parameters: z.array(parameterSuggestionSchema).max(MAX_PARAMETER_SUGGESTIONS).default([]),
  /** Fields added to the module's item records so overlays can read a per-item quantity it computes but did not keep (applied with the result). */
  records: recordingSchema.nullable().default(null),
});
/**
 * A targeted tool's stored result. A new-transformation recommendation that was
 * applied remembers the transformation it added (`addedId`), so it then reads as
 * that transformation (while it exists).
 */
export const targetedResultSchema = inspectResultSchema.extend({ recommendations: z.array(recommendationSchema.extend({ addedId: z.string().max(80).optional() })).max(6),
  /** A suggested parameter the user turned down keeps `rejected`. */
  parameters: z.array(parameterSuggestionSchema.extend({ rejected: z.boolean().optional() })).max(MAX_PARAMETER_SUGGESTIONS).default([]) });
export type InspectResult = z.infer<typeof targetedResultSchema>;
export type Recommendation = InspectResult["recommendations"][number];
/** A result as given (older results have no `parameters` or `records`). */
export type InspectResultInput = Omit<InspectResult, "parameters" | "records"> & { parameters?: InspectResult["parameters"]; records?: InspectResult["records"] };
/** A recommendation as it reads in `scene`: a new transformation that was added (and is still there) is that transformation. */
export function currentRecommendation(item: Recommendation, scene: Scene): Recommendation {
  if (item.kind !== "add-transformation" || !item.addedId || !findNode(scene, item.nodeId)?.transformations.some(entry => entry.id === item.addedId)) return item;
  return { ...item, kind: "transformation", targetId: item.addedId, targetIds: [] };
}
/**
 * Concern autocomplete: from the inspection annotation (and what the user has
 * typed so far), AI suggests up to three concerns to inspect. Each is a whole
 * concern; one that starts with the typed text completes it.
 */
export const concernSuggestionsSchema = z.object({ suggestions: z.array(z.string().min(1).max(300)).min(1).max(3) });
export type ConcernSuggestions = z.infer<typeof concernSuggestionsSchema>;
/** What a suggestion adds after the typed text (empty when it does not continue it). */
export function concernCompletion(typed: string, suggestion: string) {
  if (!typed.trim() || typed.length >= suggestion.length) return "";
  return suggestion.startsWith(typed) ? suggestion.slice(typed.length) : "";
}
/** Every transformation a recommendation changes (the main target first); none for other kinds. */
export const recommendationTransformations = (item: Pick<InspectResult["recommendations"][number], "kind" | "targetId" | "targetIds">) =>
  item.kind === "transformation" ? [...new Set([item.targetId, ...(item.targetIds ?? [])].filter(Boolean))] : [];
/** Overlays written before when/each existed lack them. */
export type Overlay = z.input<typeof overlaySchema>;

// ── Overlay expressions, evaluated per step ─────────────────────────────────
// Numbers, + - * / %, comparisons, && || !, parentheses, a few functions, and
// readers for the step: p("key") values, s("root", "path") the module's m.store,
// prev/delta against the previous step, in/elapsed for machine states, item("path")
// and i inside `each`, step/steps for the position in the history.

/** What an overlay reads at one step. */
export type OverlayContext = {
  values: Record<string, Scalar>; previous?: Record<string, Scalar>;
  stores: Record<string, unknown>; states: Record<string, { id: string; elapsed: number }>;
  step: number; steps: number; item?: unknown; itemIndex?: number;
};
type Runtime = { stores?: Record<string, unknown>; states?: Record<string, { id: string; elapsed: number }>; history?: unknown[] };
const runtimeOf = (step: InspectionStep | undefined): Runtime => step?.runtime && typeof step.runtime === "object" ? step.runtime as Runtime : {};

type Token = { type: "num"; value: number } | { type: "str"; value: string } | { type: "id"; value: string } | { type: "op"; value: string };
function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  for (let i = 0; i < source.length;) {
    const char = source[i];
    if (/\s/.test(char)) { i++; continue; }
    const number = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(source.slice(i));
    if (number) { tokens.push({ type: "num", value: Number(number[0]) }); i += number[0].length; continue; }
    if (char === "\"" || char === "'") {
      const end = source.indexOf(char, i + 1); if (end < 0) throw new Error("문자열이 닫히지 않았습니다.");
      tokens.push({ type: "str", value: source.slice(i + 1, end) }); i = end + 1; continue;
    }
    const word = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(i));
    if (word) { tokens.push({ type: "id", value: word[0] }); i += word[0].length; continue; }
    const pair = source.slice(i, i + 2);
    if (["<=", ">=", "==", "!=", "&&", "||"].includes(pair)) { tokens.push({ type: "op", value: pair }); i += 2; continue; }
    if ("+-*/%(),<>!".includes(char)) { tokens.push({ type: "op", value: char }); i++; continue; }
    throw new Error(`수식에 쓸 수 없는 문자: ${char}`);
  }
  return tokens;
}
const FUNCTIONS: Record<string, (...args: number[]) => number> = { min: Math.min, max: Math.max, abs: Math.abs, sqrt: Math.sqrt, round: Math.round, floor: Math.floor, ceil: Math.ceil, sin: Math.sin, cos: Math.cos, atan2: Math.atan2, pow: Math.pow,
  if: (condition, a, b) => condition ? a : b };
const numeric = (value: unknown) => typeof value === "number" ? value : typeof value === "boolean" ? Number(value) : Array.isArray(value) ? value.length : NaN;
/** Follow "a.b.0.c" into plain data ("" is the value itself). */
export function pathValue(value: unknown, path: string): unknown {
  for (const part of path.split(".").filter(Boolean)) {
    if (part.startsWith("@") && Array.isArray(value)) { value = pointsBox(value)?.[part as keyof PointsBox]; continue; }
    if (value === null || typeof value !== "object") return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}
// A list of points ({ x, y }) — a drawn outline, a path, a gesture — read as its box:
// "@x", "@y" (top-left), "@w", "@h", "@cx", "@cy" (center) and "@n" (how many points).
type PointsBox = { "@x": number; "@y": number; "@w": number; "@h": number; "@cx": number; "@cy": number; "@n": number };
const isPoint = (item: unknown): item is { x: number; y: number } => Boolean(item && typeof item === "object" && Number.isFinite((item as { x: unknown }).x) && Number.isFinite((item as { y: unknown }).y));
// A bare point (only the x, y and the input's time t) is geometry: a list of them is an
// outline or a path. A record with more fields (an item's size, speed, count, …) is not.
const isBarePoint = (item: unknown) => isPoint(item) && Object.keys(item).every(key => key === "x" || key === "y" || key === "t");
export function pointsBox(list: unknown[]): PointsBox | undefined {
  if (!list.length || !list.every(isPoint)) return undefined;
  const xs = list.map(point => point.x), ys = list.map(point => point.y);
  const x = Math.min(...xs), y = Math.min(...ys), w = Math.max(...xs) - x, h = Math.max(...ys) - y;
  return { "@x": x, "@y": y, "@w": w, "@h": h, "@cx": x + w / 2, "@cy": y + h / 2, "@n": list.length };
}
/** The recorded input (m.history() gestures) is read by overlays as the store of this pseudo root. */
export const INPUT_ROOT = "@input";

/** Evaluate an overlay expression at one step; NaN when a value is missing or not a number. */
export function evaluate(source: string, input: Record<string, Scalar> | OverlayContext): number {
  const context: OverlayContext = "values" in input && "stores" in input ? input as OverlayContext : { values: input as Record<string, Scalar>, stores: {}, states: {}, step: 0, steps: 1 };
  const tokens = tokenize(source); let index = 0;
  const peek = () => tokens[index], take = () => tokens[index++];
  const isOp = (...values: string[]) => peek()?.type === "op" && values.includes(peek()!.value as string);
  const expect = (value: string) => { const token = take(); if (token?.type !== "op" || token.value !== value) throw new Error(`'${value}'가 필요합니다.`); };
  const text = (what: string) => { const token = take(); if (token?.type !== "str") throw new Error(`${what}에는 문자열이 필요합니다.`); return token.value; };
  const read = (values: Record<string, Scalar> | undefined, key: string) => values ? numeric(values[key]) : NaN;
  function call(name: string): number {
    expect("(");
    let value: number;
    if (name === "p" || name === "prev" || name === "delta") {
      const key = text(`${name}()`);
      value = name === "p" ? read(context.values, key) : name === "prev" ? read(context.previous, key) : read(context.values, key) - read(context.previous, key);
    } else if (name === "s" || name === "len") {
      const root = text(`${name}()`); expect(","); const path = text(`${name}()`);
      const found = pathValue(context.stores[root], path);
      value = name === "len" ? (Array.isArray(found) ? found.length : NaN) : numeric(found);
    } else if (name === "item") value = numeric(pathValue(context.item, text("item()")));
    else if (name === "in") { const node = text("in()"); expect(","); value = Number(context.states[node]?.id === text("in()")); }
    else if (name === "elapsed") value = context.states[text("elapsed()")]?.elapsed ?? NaN;
    else {
      const fn = FUNCTIONS[name]; if (!fn) throw new Error(`알 수 없는 함수: ${name}`);
      const args = [or()];
      while (isOp(",")) { take(); args.push(or()); }
      expect(")"); return fn(...args);
    }
    expect(")"); return value;
  }
  function primary(): number {
    const token = take();
    if (!token) throw new Error("수식이 끝났습니다.");
    if (token.type === "num") return token.value;
    if (token.type === "op" && token.value === "(") { const value = or(); expect(")"); return value; }
    if (token.type === "op" && token.value === "-") return -primary();
    if (token.type === "op" && token.value === "+") return primary();
    if (token.type === "op" && token.value === "!") return Number(!primary());
    if (token.type === "id") {
      if (token.value === "PI") return Math.PI;
      if (token.value === "i") return context.itemIndex ?? 0;
      if (token.value === "step") return context.step;
      if (token.value === "steps") return context.steps;
      return call(token.value);
    }
    throw new Error("수식을 읽지 못했습니다.");
  }
  function product(): number {
    let value = primary();
    while (isOp("*", "/", "%")) { const op = take()!.value, right = primary(); value = op === "*" ? value * right : op === "/" ? value / right : value % right; }
    return value;
  }
  function sum(): number {
    let value = product();
    while (isOp("+", "-")) { const op = take()!.value, right = product(); value = op === "+" ? value + right : value - right; }
    return value;
  }
  function compare(): number {
    let value = sum();
    while (isOp("<", ">", "<=", ">=", "==", "!=")) {
      const op = take()!.value, right = sum();
      value = Number(op === "<" ? value < right : op === ">" ? value > right : op === "<=" ? value <= right : op === ">=" ? value >= right : op === "==" ? value === right : value !== right);
    }
    return value;
  }
  function and(): number { let value = compare(); while (isOp("&&")) { take(); const right = compare(); value = Number(Boolean(value) && Boolean(right)); } return value; }
  function or(): number { let value = and(); while (isOp("||")) { take(); const right = and(); value = Number(Boolean(value) || Boolean(right)); } return value; }
  const value = or();
  if (index < tokens.length) throw new Error("수식 뒤에 남은 내용이 있습니다.");
  return value;
}

/** Fill ${expression} parts of a label; "" when one cannot be read there (a value or field that step does not have), never a "?". */
export function fillLabel(template: string, input: Record<string, Scalar> | OverlayContext) {
  let missing = false;
  const text = template.replace(/\$\{([^}]*)\}/g, (_, source: string) => {
    let value = NaN;
    try { value = evaluate(source, input); } catch { /* unreadable */ }
    if (!Number.isFinite(value)) { missing = true; return ""; }
    return String(Math.round(value * 10) / 10);
  });
  return missing ? "" : text;
}

/** The context of step `index` (live values when there is no step yet). */
export function stepContext(steps: InspectionStep[], index: number, live: Record<string, Scalar> = {}, drawn?: Record<string, unknown> | null): OverlayContext {
  const step = steps[index], runtime = runtimeOf(step);
  // `drawn`: the stores as the running code draws this step now (restored), newer than the recording (e.g. after the code records more per item).
  return { values: step?.values ?? live, previous: steps[index - 1]?.values, stores: { ...(runtime.stores ?? {}), ...(drawn ?? {}), [INPUT_ROOT]: runtime.history ?? [] }, states: runtime.states ?? {}, step: Math.max(0, index), steps: steps.length };
}

/** Shorten plain data for AI: arrays keep their first items (and say how long they were). */
function trimData(value: unknown, items: number, depth = 0): unknown {
  if (value === null || typeof value !== "object") return typeof value === "string" ? value.slice(0, 120) : typeof value === "number" ? Math.round(value * 10) / 10 : value;
  const round = (box: PointsBox) => Object.entries(box).map(([key, number]) => [key, Math.round(number * 10) / 10] as const);
  // A long outline or path is sent as where it is (its box, read the same way with "@x" … in overlays).
  if (Array.isArray(value) && value.length > 4 && value.every(isBarePoint)) return { ...Object.fromEntries(round(pointsBox(value)!)), "@points": "…" };
  if (depth > 6) return "…";
  // Records keep their fields (the first ones are shown), so per-item values can be read with item("…").
  if (Array.isArray(value)) {
    const head = value.slice(0, items).map(item => trimData(item, items, depth + 1));
    if (value.length <= items) return head;
    const box = pointsBox(value);
    return [...head, box ? `…(${value.length} items; all in box ${round(box).filter(([key]) => key !== "@n").map(([key, number]) => `${key}=${number}`).join(" ")})` : `…(${value.length} items)`];
  }
  return Object.fromEntries(Object.entries(value).slice(0, 40).map(([key, item]) => [key, trimData(item, items, depth + 1)]));
}
/** A step's runtime for AI: machine states and the m.store of the brush's own roots, kept small. */
export function runtimeForAI(step: InspectionStep, nodeIds: string[]) {
  const runtime = runtimeOf(step), ids = new Set(nodeIds);
  const states = Object.fromEntries(Object.entries(runtime.states ?? {}).filter(([id]) => ids.has(id)).map(([id, state]) => [id, { id: String(state.id), elapsed: Math.round(Number(state.elapsed) || 0) }]));
  const own = { ...Object.fromEntries(Object.entries(runtime.stores ?? {}).filter(([id]) => ids.has(id))), ...(runtime.history?.length ? { [INPUT_ROOT]: runtime.history } : {}) };
  for (const items of [6, 2, 0]) { const stores = trimData(own, items) as Record<string, unknown>; if (JSON.stringify(stores).length < 4000 || !items) return { states, stores }; }
  return { states, stores: {} };
}

/** Whether a label template reads the item it is drawn for (item(…) or i); one that does not says the same on every item. */
export function labelReadsItem(template: string) {
  return [...template.matchAll(/\$\{([^}]*)\}/g)].some(([, source]) => {
    try { return tokenize(source).some(token => token.type === "id" && (token.value === "item" || token.value === "i")); } catch { return false; }
  });
}

export const MAX_EACH = 200;
export type PlacedOverlay = { overlay: Overlay; key: string; x: number; y: number; w: number; h: number; label: string;
  /** The step it was computed from, and its offset from the step being looked at (0: that step; ±n: a faint ghost n steps earlier/later). */
  step: number; ghost: number };
/** Overlays placed for one step context; ones whose condition fails or geometry cannot be computed are left out. */
export function placeOverlays(overlays: Overlay[], input: Record<string, Scalar> | OverlayContext, ghost = 0, maxItems = MAX_EACH): PlacedOverlay[] {
  const context: OverlayContext = "values" in input && "stores" in input ? input as OverlayContext : { values: input as Record<string, Scalar>, stores: {}, states: {}, step: 0, steps: 1 };
  return overlays.flatMap(overlay => {
    try {
      if (overlay.when?.trim() && !evaluate(overlay.when, context)) return [];
      const cut = overlay.each?.indexOf(":") ?? -1;
      const each = overlay.each ?? "", list = cut > 0 ? pathValue(context.stores[each.slice(0, cut)], each.slice(cut + 1)) : undefined;
      const items: (OverlayContext | null)[] = cut > 0 ? (Array.isArray(list) ? list.slice(0, maxItems).map((item, itemIndex) => ({ ...context, item, itemIndex })) : []) : [null];
      // A label that is the same for every item (property values, thresholds) is shown once, on the first.
      const perItem = cut <= 0 || labelReadsItem(overlay.label);
      return items.flatMap((itemContext, n) => {
        const scope = itemContext ?? context;
        const [x, y, w, h] = [overlay.x, overlay.y, overlay.w, overlay.h].map(source => evaluate(source || "0", scope));
        if (![x, y, w, h].every(Number.isFinite)) return [];
        return [{ overlay, key: `${overlay.id}:${ghost}:${n}`, x, y, w, h, label: ghost || (n > 0 && !perItem) ? "" : fillLabel(overlay.label, scope), step: context.step, ghost }];
      });
    } catch { return []; }
  });
}

const GHOST_ITEMS = 40;
const where = (item: PlacedOverlay) => `${item.overlay.id}|${item.key.split(":").at(-1)}|${[item.x, item.y, item.w, item.h].map(value => Math.round(value)).join(",")}`;
/**
 * Every overlay at the step being looked at, plus faint ghosts of the same overlay
 * at every other recorded step, earlier and later, each computed from that step's
 * values and stores. A ghost that would sit exactly where a nearer step already
 * draws is left out. Ghosts come first, farthest first, so nearer ones are on top.
 */
export function historyOverlays(overlays: Overlay[], steps: InspectionStep[], index: number, live: Record<string, Scalar> = {}, drawn?: Record<string, unknown> | null): PlacedOverlay[] {
  const current = placeOverlays(overlays, stepContext(steps, index, live, drawn));
  const taken = new Set(current.map(where)), ghosts: PlacedOverlay[] = [];
  const order = steps.map((_, j) => j).filter(j => j !== index).sort((a, b) => Math.abs(a - index) - Math.abs(b - index) || a - b);
  for (const j of order) for (const item of placeOverlays(overlays, stepContext(steps, j, live), j - index, GHOST_ITEMS)) {
    const spot = where(item); if (taken.has(spot)) continue;
    taken.add(spot); ghosts.push(item);
  }
  return [...ghosts.reverse(), ...current];
}

// ── Label placement: labels of the step being looked at never overlap ────────

export type LabelRequest = { key: string; text: string; anchor: { x: number; y: number }; shape: { x: number; y: number; w: number; h: number } };
export type PlacedLabel = { key: string; text: string; x: number; y: number; width: number; height: number; leader: boolean };
/** Rough text width: CJK and other wide glyphs take about a full em, Latin about 0.6. */
export const textWidth = (text: string, size: number) => Array.from(text).reduce((sum, char) => sum + (/[\u0000-ɏ]/.test(char) ? .6 : 1) * size, 0);
const overlaps = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/**
 * Place labels (text baseline at x, y) so none overlap each other or leave the
 * canvas or cover an obstacle (step badges): first beside their shape (above, below, right, left), then farther away
 * with a leader line to the shape. A label with no free spot is left out.
 */
export function layoutLabels(requests: LabelRequest[], size: number, bounds = { width: 900, height: 600 }, obstacles: { x: number; y: number; width: number; height: number }[] = []): PlacedLabel[] {
  const placed: PlacedLabel[] = [], height = size * 1.25, gap = size * .35;
  for (const request of requests) {
    const width = textWidth(request.text, size), { shape } = request;
    const left = Math.min(shape.x, shape.x + shape.w), top = Math.min(shape.y, shape.y + shape.h), right = Math.max(shape.x, shape.x + shape.w), bottom = Math.max(shape.y, shape.y + shape.h);
    const near = [
      { x: request.anchor.x, y: request.anchor.y }, { x: left, y: top - gap }, { x: left, y: bottom + height }, { x: right + gap, y: (top + bottom) / 2 + height / 3 },
      { x: left - gap - width, y: (top + bottom) / 2 + height / 3 }, { x: right - width, y: top - gap }, { x: right - width, y: bottom + height },
    ];
    const far = Array.from({ length: 10 }, (_, n) => n + 1).flatMap(n => [{ x: left, y: top - gap - n * height }, { x: left, y: bottom + height + n * height }]);
    const fits = (spot: { x: number; y: number }) => {
      const box = { x: spot.x, y: spot.y - height * .8, width, height };
      return box.x >= 0 && box.y >= 0 && box.x + width <= bounds.width && box.y + height <= bounds.height && !placed.some(other => overlaps(box, { x: other.x, y: other.y - height * .8, width: other.width, height })) && !obstacles.some(other => overlaps(box, other));
    };
    const spot = near.find(fits) ?? far.find(fits);
    if (spot) placed.push({ key: request.key, text: request.text, x: spot.x, y: spot.y, width, height, leader: !near.includes(spot) });
  }
  return placed;
}

// ── One targeted inspection for every stamp of a brush ──────────────────────
// A targeted tool keeps its result in the brush's shared node ids (the ids its
// code uses), so the same overlays, value fixes and recommendations work on the
// master and on every instance: they are translated to a frame's ids when shown.

const READERS = /\b(p|prev|delta|s|len|in|elapsed)\(\s*(["'])(.*?)\2/g;
/** A value key ("<node id>/…") with its node id translated. */
const remapKey = (key: string, map: (id: string) => string) => {
  const cut = key.indexOf("/");
  return cut < 0 ? key : `${encodeURIComponent(map(decodeURIComponent(key.slice(0, cut))))}${key.slice(cut)}`;
};
/** An overlay expression (or label template) with the node ids it reads translated. */
export function remapExpression(source: string, map: (id: string) => string) {
  return source.replace(READERS, (_all, name: string, quote: string, arg: string) => `${name}(${quote}${name === "p" || name === "prev" || name === "delta" ? remapKey(arg, map) : map(arg)}${quote}`);
}
/** The same result with every node id passed through `map` (ids it does not know stay as they are). */
export function remapResult(result: InspectResultInput, ids: Map<string, string>, suffix = ""): InspectResult {
  const map = (id: string) => ids.get(id) ?? id, expression = (source: string) => remapExpression(source, map);
  return {
    summary: result.summary,
    overlays: result.overlays.map(overlay => {
      const cut = overlay.each.indexOf(":");
      return { ...overlay, id: `${overlay.id}${suffix}`, x: expression(overlay.x), y: expression(overlay.y), w: expression(overlay.w), h: expression(overlay.h), label: expression(overlay.label), when: expression(overlay.when),
        each: cut < 0 ? overlay.each : `${map(overlay.each.slice(0, cut))}${overlay.each.slice(cut)}`, link: { ...overlay.link, nodeId: map(overlay.link.nodeId) } };
    }),
    valueFixes: result.valueFixes.map(fix => ({ ...fix, key: remapKey(fix.key, map) })),
    recommendations: result.recommendations.map(item => ({ ...item, nodeId: map(item.nodeId), changes: item.changes.map(change => ({ ...change, key: remapKey(change.key, map) })) })),
    // The edits are module code: it uses the code's node ids, the same in every frame.
    parameters: (result.parameters ?? []).map(item => ({ ...item, nodeId: map(item.nodeId) })),
    records: result.records ? { ...result.records, nodeId: map(result.records.nodeId) } : null,
  };
}
/**
 * A stored (shared-id) result shown in one frame: overlays for every root of the
 * brush there (master or instances), fixes and recommendations for `primary`.
 */
export function resultInFrame(result: InspectResultInput, rootIds: Map<string, string>[], primary = 0): InspectResult {
  if (!rootIds.length) return { ...result, parameters: result.parameters ?? [], records: result.records ?? null };
  const main = remapResult(result, rootIds[Math.min(primary, rootIds.length - 1)]);
  return { ...main, overlays: rootIds.length === 1 ? main.overlays : rootIds.flatMap((ids, i) => remapResult(result, ids, i ? `~${i + 1}` : "").overlays) };
}

/**
 * What an inspection points at in one node's state machine: the state the node
 * was in at the inspected step (and where it came from, by which transition when
 * the step was this node's), and the states/transitions the inspection is about
 * (the focused one, targeted overlays' links and conditions, recommendations).
 */
export function machineInspection(state: InspectionState, result: InspectResult | null, nodeId: string) {
  const step = state.steps[state.cursor ?? state.steps.length - 1];
  const own = step?.nodeId === nodeId, runtime = step ? runtimeOf(step).states?.[nodeId]?.id ?? null : null;
  const states = new Set<string>(), transitions = new Set<string>();
  const add = (kind: string, id: string) => { if (kind === "state") states.add(id); else if (kind === "transition") transitions.add(id); };
  if (state.focus?.nodeId === nodeId) add(state.focus.kind, state.focus.id);
  for (const overlay of result?.overlays ?? []) {
    if (overlay.link.nodeId === nodeId) add(overlay.link.kind, overlay.link.id);
    for (const source of [overlay.when, overlay.x, overlay.y, overlay.w, overlay.h, overlay.label])
      for (const match of source.matchAll(/\bin\(\s*(["'])(.*?)\1\s*,\s*(["'])(.*?)\3/g)) if (match[2] === nodeId) states.add(match[4]);
  }
  for (const item of result?.recommendations ?? []) if (item.nodeId === nodeId) add(item.kind, item.targetId);
  return { state: own ? step!.to : runtime, from: own ? step!.from : null, transition: own ? step!.transitionId : null, states: [...states], transitions: [...transitions] };
}

/** Add a mark drawn with `style` (the oldest go beyond `max`). */
export function addMark(state: Pick<InspectionState, "marks" | "markStyles">, mark: { x: number; y: number }[], style: MarkStyle, max = MAX_MARKS) {
  const styles = state.marks.map((_, i) => markStyleAt(state.markStyles, i));
  return { marks: [...state.marks, mark].slice(-max), markStyles: [...styles, style].slice(-max) };
}
/** The marks (and their styles) left after an eraser passes these canvas points; a mark's own width widens what touches it. */
export function eraseStyledMarks(state: Pick<InspectionState, "marks" | "markStyles">, points: { x: number; y: number }[], radius = 14) {
  const kept = state.marks.map((_, i) => i).filter(i => eraseMarks([state.marks[i]], points, radius + markStyleAt(state.markStyles, i).width / 2).length);
  return { marks: kept.map(i => state.marks[i]), markStyles: kept.map(i => markStyleAt(state.markStyles, i)) };
}
/** Annotation marks (normalized) left after an eraser passes these canvas points: a mark within `radius` canvas pixels goes as a whole. */
export function eraseMarks<T extends { x: number; y: number }[]>(marks: T[], points: { x: number; y: number }[], radius = 14, size = { w: 900, h: 600 }) {
  return marks.filter(mark => !mark.some(at => points.some(point => Math.hypot(at.x * size.w - point.x, at.y * size.h - point.y) < radius)));
}
