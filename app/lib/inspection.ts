import { z } from "zod";
import { MAX_PARAMETER_SUGGESTIONS, parameterSuggestionSchema, recordingSchema, suggestionKey, type ParameterSuggestion } from "./hidden-parameters";
import { findNode } from "./scene/graph";
export { readsPerItem } from "./item-values";
import { idSchema, numberValueSchema, toggleValueSchema, type ScalarValue, type Scene, type SceneBinding } from "./scene/schema";
import { findProperty, propertyOwner } from "./scene/transformations";
import { bindingKey, nodeLeaves, sceneBindings, layoutKey } from "./scene/values";
import { machineChangeSchema } from "./machine-change";
import { editRuntime, isRuntimeKey, moveValue, parseMove, runtimeTarget, STORE_KEY, targetNumber, targetPoint } from "./runtime-edits";

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
  /** What-if values set at this step only (a handle dragged while looking at it): the step is drawn with them; nothing else changes. */
  edits?: Record<string, Scalar>;
  /** What-if values of single drawn items at this step (by the item's `id` in the store): only that item is drawn with them. */
  itemEdits?: Record<string, Record<string, Scalar>>;
  /** The running sketch's state at that moment (module stores, machine states, random seed); selecting the step restores it. */
  runtime: unknown;
};
/**
 * What an overlay, row or recommendation points at (a transformation only from
 * recommendations; a parameter is a hidden constant the inspection suggests exposing,
 * `id` = the property id it gets).
 */
export type InspectionFocus = { kind: "constraint" | "state" | "transition" | "transformation" | "parameter"; nodeId: string; id: string };
/** Whether two foci point at the same thing: a suggested parameter is the constraint it becomes once accepted (same property id). */
export function sameFocus(a: InspectionFocus | null, b: InspectionFocus) {
  const value = (kind: string) => kind === "parameter" ? "constraint" : kind;
  return Boolean(a && value(a.kind) === value(b.kind) && a.nodeId === b.nodeId && a.id === b.id);
}
/** How an annotation mark is drawn: color, width (canvas pixels of the 900×600 frame) and opacity. */
export const markStyleSchema = z.object({ color: z.string().regex(/^#[0-9a-fA-F]{6}$/), width: z.number().min(1).max(30), opacity: z.number().min(.1).max(1) });
export type MarkStyle = z.infer<typeof markStyleSchema>;
export const DEFAULT_MARK_STYLE: MarkStyle = { color: "#7c3aed", width: 6, opacity: .85 };
/** How many strokes one inspection annotation (and a targeted tool) keeps; the oldest go first. */
export const MAX_MARKS = 128;
export const MARK_COLORS = ["#7c3aed", "#e0457b", "#e07b00", "#1f8a5b", "#2563eb", "#1f2328"];
export type InspectionState = {
  /** The step looked at (the result is held there); null: the latest one. */
  brushId: string; steps: InspectionStep[]; cursor: number | null;
  /** The inspection annotation being drawn (normalized 0..1) and its concern; they become a targeted tool. */
  marks: { x: number; y: number }[][]; concern: string;
  /** The style of each mark, by index (a missing one is the default). */
  markStyles: MarkStyle[];
  focus: InspectionFocus | null;
};
/** The step an inspection holds the result at: the one picked, else the latest (null when nothing is recorded). */
export const heldIndex = (state: Pick<InspectionState, "steps" | "cursor">) => state.steps.length ? Math.min(state.cursor ?? state.steps.length - 1, state.steps.length - 1) : null;
export const emptyInspection = (brushId = ""): InspectionState => ({ brushId, steps: [], cursor: null, marks: [], markStyles: [], concern: "", focus: null });
export const markStyleAt = (styles: MarkStyle[] | undefined, index: number) => styles?.[index] ?? DEFAULT_MARK_STYLE;

/** A step's values as it is looked at: as recorded, with its what-if values over them. */
export const stepValues = (step: Pick<InspectionStep, "values" | "edits"> | undefined): Record<string, Scalar> | undefined => step && (step.edits ? { ...step.values, ...step.edits } : step.values);
/**
 * Set (or with null, take back) a what-if value of one step: of the whole step, or of
 * one drawn item there (`itemId`). With null and no item, every item's value of that key goes too.
 */
export function editStep(state: InspectionState, index: number, key: string, value: Scalar | null, itemId?: string): InspectionState {
  const step = state.steps[index]; if (!step) return state;
  const edits = { ...step.edits }, items: Record<string, Record<string, Scalar>> = { ...step.itemEdits };
  if (itemId !== undefined) {
    const own = { ...items[itemId] };
    if (value === null) delete own[key]; else own[key] = value;
    if (Object.keys(own).length) items[itemId] = own; else delete items[itemId];
  } else if (value === null) {
    delete edits[key];
    for (const id of Object.keys(items)) { const { [key]: _gone, ...rest } = items[id]; if (Object.keys(rest).length) items[id] = rest; else delete items[id]; }
  } else edits[key] = value;
  return { ...state, steps: state.steps.map((item, i) => i === index ? { ...item, edits: Object.keys(edits).length ? edits : undefined, itemEdits: Object.keys(items).length ? items : undefined } : item) };
}
/** The id of a drawn item as its store record names it (null: it has none). */
export const itemIdOf = (item: unknown) => item && typeof item === "object" && ["string", "number"].includes(typeof (item as { id?: unknown }).id) ? String((item as { id: string | number }).id) : null;

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
  const step = stepValues(steps[index]), previous = stepValues(steps[index - 1]);
  if (!step || !previous) return new Set<string>();
  return new Set(Object.keys(step).filter(key => step[key] !== previous[key]));
}
export const formatScalar = (value: Scalar | undefined) => value === undefined ? "—" : typeof value === "number" ? String(Math.round(value * 100) / 100) : String(value);

// ── Targeted inspection result (AI) ─────────────────────────────────────────

/** "parameter": a hidden constant suggested in the same result (`id` = the suggested property id). */
const link = z.object({ kind: z.enum(["constraint", "state", "transition", "parameter"]), nodeId: z.string().max(80), id: z.string().max(80) });
const scalar = z.union([z.number(), z.string().max(200), z.boolean()]);
/**
 * A direct manipulation handle on an overlay: a grip the user drags on the frame
 * to change one value (a constraint, or a suggested parameter). Where the grip sits
 * and how a drag maps to the value are expressions chosen for the concern (drag a
 * leaf tip to bend it, rotate an arm to open an angle, slide along a row to add
 * items), so the result and the overlay follow the value as it is dragged.
 */
export const HANDLE_GESTURES = ["drag", "rotate", "slide", "move"] as const;
/** What the `value` expression may read besides the overlay readers (canvas pixels; angles in radians). */
export const HANDLE_VARIABLES = ["hx", "hy", "sx", "sy", "dx", "dy", "start", "px", "py", "angle", "startAngle", "dist", "startDist"] as const;
export const handleSchema = z.object({
  /** The value it changes: a key from `constraints` (number or toggle) or a suggested parameter's key; or the running state
   * at the step (runtime-edits: `@input:…` the recorded input, `@store:…` a module's store), `${…}` parts read per item. */
  key: z.string().max(1200),
  /** drag: the grip follows the pointer; rotate: it turns around the pivot; slide: it moves along the line from the pivot through it;
   * move: it carries a point of the running state (an `@input:` or `@store:` key) where the pointer goes. */
  gesture: z.enum(HANDLE_GESTURES),
  /** Where the grip sits (reads the key, so it follows the value). On an `each` overlay, on every item (up to a few). */
  x: z.string().max(400), y: z.string().max(400),
  /** The pivot of a rotate, the start of a slide's track ("" = where the grip was when the drag began). */
  pivotX: z.string().max(400), pivotY: z.string().max(400),
  /** The new value from the pointer: hx, hy (pointer), sx, sy (pointer at the start), dx, dy, start (the value at the start), px, py (pivot), angle, startAngle, dist, startDist (around the pivot). */
  value: z.string().max(600),
  /** What the gesture does, in plain words (Korean, about 20 characters), e.g. "끝을 끌어 휘게". */
  hint: z.string().max(80),
});
export type OverlayHandle = z.infer<typeof handleSchema>;
export const overlaySchema = z.object({
  id: z.string().min(1).max(80), kind: z.enum(["rect", "ellipse", "line", "label"]),
  /** What this color shows, in plain words (the legend). */
  name: z.string().max(60).default(""),
  /** Expressions in canvas pixels; may read values with p("key") (also the keys of suggested parameters). For a line, w/h are the end offset. */
  x: z.string().max(400), y: z.string().max(400), w: z.string().max(400), h: z.string().max(400),
  /** Text with ${expression} parts, e.g. "w=${p(\"star/size\")}". */
  label: z.string().max(300), color: z.string().regex(/^#[0-9a-fA-F]{6}$/), link,
  /** Shown only at steps where this expression is non-zero (empty: every step). */
  when: z.string().max(400).default(""),
  /** "<root id>:<store path>": draw once per item of that array in the module's m.store (item("…"), i). Empty: once. */
  each: z.string().max(200).default(""),
  /** A handle to change what it shows by dragging it on the frame (null: none). */
  handle: handleSchema.nullable().default(null),
});
const change = z.object({ key: z.string().max(1200), stateId: z.string().max(80), value: scalar });
/** "add-transformation": nothing existing is related, so a NEW semantic transformation is stacked on node `nodeId` (targetId ""). */
export const recommendationSchema = z.object({ kind: z.enum(["value", "transformation", "add-transformation", "state", "transition"]), nodeId: z.string().max(80), targetId: z.string().max(80),
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
export const MAX_PREVIEW_MARKS = 4, MAX_PREVIEW_HANDLES = 3;
/** What a preview mark is: an overlay shape (canvas-pixel expressions) with a short label saying what changes there. */
export const previewMarkSchema = overlaySchema.omit({ link: true, handle: true });
export type PreviewMark = z.input<typeof previewMarkSchema>;
/**
 * A quick visual preview of a recommendation (asked with the inspection when previews are on): small edits to
 * the brush's module that make it draw roughly as it would with the recommendation, and the new values those
 * edits read. Run on the held step's marks in the panel; nothing is applied.
 */
export const recommendationPreviewSchema = z.object({ caption: z.string().max(160),
  edits: z.array(z.object({ nodeId: z.string().max(80), find: z.string().min(1).max(1500), replace: z.string().min(1).max(4000) })).max(4),
  values: z.array(z.object({ nodeId: z.string().max(80), id: idSchema, label: z.string().min(1).max(80), value: z.union([numberValueSchema, toggleValueSchema]) })).max(3),
  /** The states and transitions the change brings to the brush's state machine (the edits emit its event transitions). */
  machine: machineChangeSchema.nullable().default(null),
  /** Simple marks drawn over the preview where it differs from now (what changes there), read like overlays. */
  marks: z.array(previewMarkSchema).max(MAX_PREVIEW_MARKS).default([]),
  /** Handles on the preview for what the recommendation hinges on (a value of the brush or one the preview brings): dragging one redraws the preview with it. */
  handles: z.array(overlaySchema).max(MAX_PREVIEW_HANDLES).default([]) });
export type RecommendationPreview = z.infer<typeof recommendationPreviewSchema>;
/** A mark as an overlay (no link, no handle), so the overlay layer draws it. */
export const previewMarkOverlay = (mark: PreviewMark, nodeId = ""): Overlay => ({ ...mark, link: { kind: "constraint", nodeId, id: "" }, handle: null });
/** What the model returns with previews on: each recommendation with its preview (null for value ones: their values are the preview). */
export const inspectPreviewResultSchema = inspectResultSchema.extend({ recommendations: z.array(recommendationSchema.extend({ preview: recommendationPreviewSchema.nullable() })).max(6) });
/** Recommendations a targeted tool keeps: the inspection's (6 at most) and ones made later from its Execution frames. */
export const MAX_LISTED_RECOMMENDATIONS = 12;
export const targetedResultSchema = inspectResultSchema.extend({ recommendations: z.array(recommendationSchema.extend({ addedId: z.string().max(80).optional(), preview: recommendationPreviewSchema.nullable().optional() })).max(MAX_LISTED_RECOMMENDATIONS),
  /** A suggested parameter the user turned down keeps `rejected`. */
  parameters: z.array(parameterSuggestionSchema.extend({ rejected: z.boolean().optional() })).max(MAX_PARAMETER_SUGGESTIONS).default([]) });
export type InspectResult = z.infer<typeof targetedResultSchema>;
/**
 * The user's direct manipulation of one part of a recommendation's preview, cropped by hand: the freeform `outline`
 * drawn around it and its box (canvas pixels), and how it was moved (canvas pixels, its center), scaled and rotated
 * (degrees, clockwise, about its center). `object` / `label` name the crop.
 */
export const previewManipulationSchema = z.object({ object: z.string().max(200), label: z.string().max(80),
  box: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }), outline: z.array(z.object({ x: z.number(), y: z.number() })).max(64).default([]),
  dx: z.number(), dy: z.number(), scale: z.number().min(.05).max(20), rotate: z.number().min(-360).max(360) });
export type PreviewManipulation = z.infer<typeof previewManipulationSchema>;
/** A recommendation revised at its preview (annotation and/or direct manipulation): the same recommendation, changed, with its preview, and what changed. */
export const revisedRecommendationSchema = recommendationSchema.extend({ preview: recommendationPreviewSchema.nullable(), reply: z.string().max(400) });
export type RevisedRecommendation = z.infer<typeof revisedRecommendationSchema>;

// Overlays after an applied recommendation: the user rebuilds a targeted tool's
// overlays for what was applied ("Update overlays"). The parts it replaced are kept
// with the applied entries they follow, so Undo apply brings them back.
const overlayPartSchema = targetedResultSchema.pick({ summary: true, overlays: true, valueFixes: true, parameters: true, records: true });
export type OverlayPart = z.infer<typeof overlayPartSchema>;
export const overlayUpdateSchema = z.object({
  /** The applied entries it follows: the recommendation's, then the item records the update applied (if any). */
  appliedIds: z.array(z.string().max(80)).min(1).max(4),
  before: overlayPartSchema, after: overlayPartSchema,
});
export type OverlayUpdate = z.infer<typeof overlayUpdateSchema>;
export const MAX_OVERLAY_UPDATES = 10;
/** The parts of a result an overlay update replaces (the recommendations stay the list the user works from). */
export const overlayPart = (result: OverlayPart): OverlayPart => ({ summary: result.summary, overlays: result.overlays, valueFixes: result.valueFixes, parameters: result.parameters, records: result.records });
const samePart = (a: OverlayPart, b: OverlayPart) => JSON.stringify(overlayPart(a)) === JSON.stringify(overlayPart(b));
/**
 * The tool after an applied entry was undone or redone: undoing any entry an update
 * follows brings back the overlays before it; redoing the last one brings the updated
 * ones back. Only while the tool still shows the other side (an Inspect again since is kept).
 */
export function overlaysAfterApplied<T extends { result: InspectResult; overlayUpdates: OverlayUpdate[] }>(tool: T, appliedId: string, direction: "undo" | "redo"): T {
  const update = [...tool.overlayUpdates].reverse().find(item => direction === "undo" ? item.appliedIds.includes(appliedId) : item.appliedIds.at(-1) === appliedId);
  if (!update) return tool;
  const [from, to] = direction === "undo" ? [update.after, update.before] : [update.before, update.after];
  return samePart(tool.result, from) ? { ...tool, result: { ...tool.result, ...to } } : tool;
}
/** Whether the tool shows overlays updated for this applied entry. */
export const overlaysUpdatedFor = (tool: { result: InspectResult; overlayUpdates?: OverlayUpdate[] }, appliedId: string) =>
  (tool.overlayUpdates ?? []).some(item => item.appliedIds.includes(appliedId) && samePart(tool.result, item.after));
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
// and i inside `each`, step/steps for the position in the history; in an exploration
// frame pathX(t)/pathY(t)/nearest(x, y) relate execution progress to the path execution goes
// along, and nearestStep(x, y) is how many steps are done once the step nearest (x, y) is.

/** What an overlay reads at one step. `fallback`: values for keys a step does not record (suggested parameters, at the value the code uses). */
export type OverlayContext = {
  values: Record<string, Scalar>; previous?: Record<string, Scalar>; fallback?: Record<string, Scalar>;
  /** What-if values of single items (by item id): an `each` item with its own value reads it. */
  itemValues?: Record<string, Record<string, Scalar>>;
  stores: Record<string, unknown>; states: Record<string, { id: string; elapsed: number }>;
  step: number; steps: number; item?: unknown; itemIndex?: number;
  /** Named numbers (a handle's drag: hx, hy, start, …). */
  vars?: Record<string, number>;
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
/** The whole recorded input path ({ x, y } points, gesture after gesture) in an exploration frame, read by pathX, pathY and nearest. */
export const PATH_ROOT = "@path";
const pathPoints = (context: OverlayContext) => { const path = context.stores[PATH_ROOT]; return Array.isArray(path) ? path.filter(isPoint) : []; };
/** The input point executed last at progress t (0..1): with n points, point j is executed from t = (j + 1) / n. */
const pathPoint = (context: OverlayContext, t: number) => { const path = pathPoints(context); return path.length && Number.isFinite(t) ? path[Math.max(0, Math.min(path.length - 1, Math.ceil(t * path.length) - 1))] : undefined; };
/** The progress at which the input point nearest (x, y) is executed. */
function nearestProgress(context: OverlayContext, x: number, y: number) {
  const path = pathPoints(context); if (!path.length || !Number.isFinite(x) || !Number.isFinite(y)) return NaN;
  let best = 0; for (let j = 1; j < path.length; j++) if (Math.hypot(path[j].x - x, path[j].y - y) < Math.hypot(path[best].x - x, path[best].y - y)) best = j;
  return (best + 1) / path.length;
}

/** Evaluate an overlay expression at one step; NaN when a value is missing or not a number. */
export function evaluate(source: string, input: Record<string, Scalar> | OverlayContext): number {
  const context: OverlayContext = "values" in input && "stores" in input ? input as OverlayContext : { values: input as Record<string, Scalar>, stores: {}, states: {}, step: 0, steps: 1 };
  const tokens = tokenize(source); let index = 0;
  const peek = () => tokens[index], take = () => tokens[index++];
  const isOp = (...values: string[]) => peek()?.type === "op" && values.includes(peek()!.value as string);
  const expect = (value: string) => { const token = take(); if (token?.type !== "op" || token.value !== value) throw new Error(`'${value}'가 필요합니다.`); };
  const text = (what: string) => { const token = take(); if (token?.type !== "str") throw new Error(`${what}에는 문자열이 필요합니다.`); return token.value; };
  const own = context.itemValues && context.item !== undefined ? context.itemValues[itemIdOf(context.item) ?? ""] : undefined;
  const read = (values: Record<string, Scalar> | undefined, key: string) => values ? numeric((values === context.values ? own?.[key] : undefined) ?? values[key] ?? context.fallback?.[key]) : NaN;
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
    else if (name === "pathX" || name === "pathY") { const point = pathPoint(context, or()); value = point ? (name === "pathX" ? point.x : point.y) : NaN; }
    else if (name === "nearest") { const x = or(); expect(","); value = nearestProgress(context, x, or()); }
    else if (name === "nearestStep") { const x = or(); expect(","); value = Math.round(nearestProgress(context, x, or()) * pathPoints(context).length); }
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
      if (context.vars && Object.hasOwn(context.vars, token.value)) return context.vars[token.value];
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

/**
 * The context of step `index` (live values when there is no step yet); `fallback` fills keys the step does not record,
 * and a step's what-if values (`edits`) are drawn with it.
 */
export function stepContext(steps: InspectionStep[], index: number, live: Record<string, Scalar> = {}, drawn?: Record<string, unknown> | null, fallback?: Record<string, Scalar>): OverlayContext {
  // The step's state as its what-if values move it (the recorded input bent, a store value changed).
  const step = steps[index], runtime = editRuntime(runtimeOf(step), step?.edits);
  // `drawn`: the stores as the running code draws this step now (restored), newer than the recording (e.g. after the code records more per item).
  return { values: stepValues(step) ?? live, previous: stepValues(steps[index - 1]), itemValues: step?.itemEdits, fallback, stores: { ...(runtime.stores ?? {}), ...(drawn ?? {}), [INPUT_ROOT]: runtime.history ?? [] }, states: runtime.states ?? {}, step: Math.max(0, index), steps: steps.length };
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
      const cut = overlay.each?.indexOf(":") ?? -1;
      const each = overlay.each ?? "", list = cut > 0 ? pathValue(context.stores[each.slice(0, cut)], each.slice(cut + 1)) : undefined;
      const items: (OverlayContext | null)[] = cut > 0 ? (Array.isArray(list) ? list.slice(0, maxItems).map((item, itemIndex) => ({ ...context, item, itemIndex })) : []) : [null];
      // A label that is the same for every item (property values, thresholds) is shown once, on the first.
      const perItem = cut <= 0 || labelReadsItem(overlay.label);
      return items.flatMap((itemContext, n) => {
        const scope = itemContext ?? context;
        // The condition is per item too (it may read the item, e.g. item("side") == 0).
        if (overlay.when?.trim() && !evaluate(overlay.when, scope)) return [];
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
 * One step badge per spot: each overlay's first item at every recorded step
 * (not left out where it repeats another step, as ghosts are). Steps whose item
 * sits at the same spot share one badge, so every step stays reachable on the
 * canvas: the badge shows the step being looked at (or the nearest one) and how
 * many more share it, and clicking it goes to the next of them.
 */
export type StepBadge = { key: string; overlay: Overlay; x: number; y: number; steps: number[]; shown: number; next: number; current: boolean };
export function stepBadges(overlays: Overlay[], steps: InspectionStep[], index: number, spotOf: (item: PlacedOverlay) => { x: number; y: number }, live: Record<string, Scalar> = {}, drawn?: Record<string, unknown> | null, fallback?: Record<string, Scalar>): StepBadge[] {
  const groups = new Map<string, Omit<StepBadge, "shown" | "next" | "current">>();
  for (const overlay of overlays) for (let j = 0; j < steps.length; j++) {
    const [item] = placeOverlays([overlay], stepContext(steps, j, live, j === index ? drawn : null, fallback), j - index, 1);
    if (!item) continue;
    const spot = spotOf(item), key = `${overlay.id}|${Math.round(spot.x)},${Math.round(spot.y)}`;
    const group = groups.get(key) ?? { key, overlay, ...spot, steps: [] };
    group.steps.push(j); groups.set(key, group);
  }
  return [...groups.values()].map(group => {
    const current = group.steps.includes(index);
    const shown = current ? index : group.steps.reduce((best, j) => Math.abs(j - index) < Math.abs(best - index) ? j : best, group.steps[0]);
    // The next step sharing this spot after the one looked at (wrapping), so repeated clicks walk through them.
    const next = current ? group.steps.find(j => j > index) ?? group.steps[0] : shown;
    return { ...group, shown, next, current };
  });
}

/**
 * Every overlay at the step being looked at, plus faint ghosts of the same overlay
 * at every other recorded step, earlier and later, each computed from that step's
 * values and stores. A ghost that would sit exactly where a nearer step already
 * draws is left out. Ghosts come first, farthest first, so nearer ones are on top.
 */
export function historyOverlays(overlays: Overlay[], steps: InspectionStep[], index: number, live: Record<string, Scalar> = {}, drawn?: Record<string, unknown> | null, fallback?: Record<string, Scalar>): PlacedOverlay[] {
  const current = placeOverlays(overlays, stepContext(steps, index, live, drawn, fallback));
  const taken = new Set(current.map(where)), ghosts: PlacedOverlay[] = [];
  const order = steps.map((_, j) => j).filter(j => j !== index).sort((a, b) => Math.abs(a - index) - Math.abs(b - index) || a - b);
  for (const j of order) for (const item of placeOverlays(overlays, stepContext(steps, j, live, null, fallback), j - index, GHOST_ITEMS)) {
    const spot = where(item); if (taken.has(spot)) continue;
    taken.add(spot); ghosts.push(item);
  }
  return [...ghosts.reverse(), ...current];
}

// ── Handles: drag an overlay to change the value it shows ───────────────────

/** A handle's grip at the step looked at: where it sits, and the scope (item) its expressions read. */
export type HandleGrip = { key: string; overlay: Overlay; handle: OverlayHandle; x: number; y: number; scope: OverlayContext };
export const MAX_GRIPS = 8;
/** The grips of every overlay with a handle at one step context (on an `each` overlay, its first items whose condition holds). */
export function handleGrips(overlays: Overlay[], context: OverlayContext, max = MAX_GRIPS): HandleGrip[] {
  return overlays.flatMap(overlay => {
    const handle = overlay.handle; if (!handle) return [];
    const cut = overlay.each?.indexOf(":") ?? -1, list = cut > 0 ? pathValue(context.stores[overlay.each!.slice(0, cut)], overlay.each!.slice(cut + 1)) : undefined;
    const scopes: OverlayContext[] = cut > 0 ? (Array.isArray(list) ? list.slice(0, MAX_EACH).map((item, itemIndex) => ({ ...context, item, itemIndex })) : []) : [context];
    const grips: HandleGrip[] = [];
    for (const [n, scope] of scopes.entries()) {
      if (grips.length >= max) break;
      try {
        if (overlay.when?.trim() && !evaluate(overlay.when, scope)) continue;
        // A key with ${…} parts names the state of this item (e.g. the input point it was made from).
        const key = handle.key.includes("${") ? fillLabel(handle.key, scope) : handle.key; if (!key) continue;
        // A move grip sits on the point it moves, unless the handle says where.
        const at = handle.gesture === "move" && !handle.x.trim() ? targetPoint(key, scope.stores, scope.stores[INPUT_ROOT]) : null;
        const x = at ? at.x : evaluate(handle.x, scope), y = at ? at.y : evaluate(handle.y, scope);
        if (Number.isFinite(x) && Number.isFinite(y)) grips.push({ key: `${overlay.id}:handle:${n}`, overlay, handle: key === handle.key ? handle : { ...handle, key }, x, y, scope });
      } catch { /* not placeable here */ }
    }
    return grips;
  });
}
/** The value a key has in a context (a toggle as 0/1); NaN when it has none. */
export function contextValue(context: OverlayContext, key: string) {
  const own = context.itemValues && context.item !== undefined ? context.itemValues[itemIdOf(context.item) ?? ""] : undefined;
  return numeric(own?.[key] ?? context.values[key] ?? context.fallback?.[key]);
}
/** Where a drag started: the pointer, the grip's value and the pivot (the grip itself when the handle names none). */
export type HandleDrag = { sx: number; sy: number; start: number; px: number; py: number; /** A move's offset when the drag began. */ offset: { x: number; y: number } };
export function startDrag(grip: HandleGrip, pointer: { x: number; y: number }): HandleDrag {
  const read = (source: string, otherwise: number) => { if (!source.trim()) return otherwise; try { const value = evaluate(source, grip.scope); return Number.isFinite(value) ? value : otherwise; } catch { return otherwise; } };
  const key = grip.handle.key, own = contextValue(grip.scope, key);
  // A store number not changed yet starts at what the store holds.
  const start = Number.isFinite(own) || !key.startsWith(STORE_KEY) ? own : targetNumber(key, grip.scope.stores);
  return { sx: pointer.x, sy: pointer.y, start, px: read(grip.handle.pivotX, grip.x), py: read(grip.handle.pivotY, grip.y), offset: parseMove(grip.scope.values[key]) };
}
/** The value for the pointer during a drag (raw: not yet clamped); NaN when it cannot be computed. */
export function dragValue(grip: HandleGrip, drag: HandleDrag, pointer: { x: number; y: number }) {
  const vars = { hx: pointer.x, hy: pointer.y, sx: drag.sx, sy: drag.sy, dx: pointer.x - drag.sx, dy: pointer.y - drag.sy, start: drag.start, px: drag.px, py: drag.py,
    angle: Math.atan2(pointer.y - drag.py, pointer.x - drag.px), startAngle: Math.atan2(drag.sy - drag.py, drag.sx - drag.px),
    dist: Math.hypot(pointer.x - drag.px, pointer.y - drag.py), startDist: Math.hypot(drag.sx - drag.px, drag.sy - drag.py) };
  try { return evaluate(grip.handle.value, { ...grip.scope, vars }); } catch { return NaN; }
}
/** A move's value for the pointer: the offset it had plus how far the pointer went. */
export const moveDrag = (drag: HandleDrag, pointer: { x: number; y: number }) => moveValue(drag.offset.x + pointer.x - drag.sx, drag.offset.y + pointer.y - drag.sy);
/** A dragged value made valid for its spec: a number clamped to its range and rounded to its step, a toggle on from 0.5. */
export function clampValue(spec: ScalarValue | undefined, raw: number): number | boolean | null {
  if (!Number.isFinite(raw)) return null;
  if (spec?.type === "toggle") return raw >= .5;
  if (spec && spec.type !== "number") return null;
  if (!spec) return raw;
  const stepped = spec.step > 0 ? spec.min + Math.round((raw - spec.min) / spec.step) * spec.step : raw;
  const decimals = Math.min(6, Math.max(0, -Math.floor(Math.log10(spec.step > 0 ? spec.step : 1)) + 1));
  return Number(Math.min(spec.max, Math.max(spec.min, stepped)).toFixed(decimals));
}
/** The spec (type, range, step) of every value a handle of the brush may change: its constraints and the parameters suggested for it. */
export function valueSpecs(scene: Scene, nodeIds: string[], parameters: ParameterSuggestion[] = []): Record<string, ScalarValue> {
  const ids = new Set(nodeIds);
  return { ...Object.fromEntries(parameters.map(item => [suggestionKey(item), item.value])),
    ...Object.fromEntries(scene.nodes.filter(node => ids.has(node.id)).flatMap(nodeLeaves).map(leaf => [bindingKey(leaf.path), leaf.value])) };
}
/** Whether a handle can be used as given: a number or toggle value it may change, and expressions that read only what they may. */
export function handleProblem(handle: OverlayHandle, spec: { type: string } | undefined): string | null {
  // The running state: a move carries an input point or a store point; a store number takes a value like any other.
  const runtime = isRuntimeKey(handle.key), move = handle.gesture === "move";
  if (runtime) {
    const target = handle.key.includes("${") ? { kind: handle.key.startsWith(STORE_KEY) ? "store" : "input" } : runtimeTarget(handle.key);
    if (!target) return `실행 상태를 가리키지 못했습니다: ${handle.key.slice(0, 60)}`;
    if (!move && target.kind !== "store") return "입력 경로는 move로만 옮길 수 있습니다";
  } else if (move) return "move는 실행 상태(@input, @store)만 옮깁니다";
  else if (!spec || (spec.type !== "number" && spec.type !== "toggle")) return "숫자나 토글 값만 조절할 수 있습니다";
  const vars = Object.fromEntries(HANDLE_VARIABLES.map(name => [name, 1]));
  const check: OverlayContext = { values: {}, stores: {}, states: {}, step: 0, steps: 1, item: {}, itemIndex: 0, vars };
  for (const source of [handle.x, handle.y, handle.value, handle.pivotX, handle.pivotY]) {
    // A move needs no value (it is where the pointer goes), nor a place (it sits on its point).
    if (move && (source === handle.value || !source.trim())) continue;
    if (!source.trim() && (source === handle.pivotX || source === handle.pivotY)) continue;
    try { evaluate(source, check); } catch { return `수식을 읽지 못했습니다: ${source.slice(0, 60)}`; }
  }
  return null;
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
  // A store of the running state is named by its root.
  if (key.startsWith(STORE_KEY)) { const rest = key.slice(STORE_KEY.length), at = rest.indexOf(":"); return at > 0 ? `${STORE_KEY}${map(rest.slice(0, at))}${rest.slice(at)}` : key; }
  const cut = key.indexOf("/");
  return cut < 0 ? key : `${encodeURIComponent(map(decodeURIComponent(key.slice(0, cut))))}${key.slice(cut)}`;
};
/** The value keys an overlay reads with p, prev or delta (in its geometry, condition and label). */
export function overlayKeys(overlay: Pick<Overlay, "x" | "y" | "w" | "h" | "label" | "when">) {
  const keys = new Set<string>();
  for (const source of [overlay.x, overlay.y, overlay.w, overlay.h, overlay.label, overlay.when ?? ""])
    for (const [, name, , arg] of source.matchAll(READERS)) if (name === "p" || name === "prev" || name === "delta") keys.add(arg);
  return keys;
}
/** The store path parts an overlay reads (its `each` array, item(…), s(…), len(…)), handle included. */
export function overlayStoreFields(overlay: Pick<Overlay, "x" | "y" | "w" | "h" | "label" | "when" | "each"> & { handle?: Overlay["handle"] }) {
  const parts = new Set<string>(), add = (path: string) => path.split(".").filter(part => part && !part.startsWith("@") && !/^\d+$/.test(part)).forEach(part => parts.add(part));
  add(overlay.each?.split(":").slice(1).join(":") ?? "");
  const handle = overlay.handle ? [overlay.handle.x, overlay.handle.y, overlay.handle.pivotX, overlay.handle.pivotY, overlay.handle.value] : [];
  for (const source of [overlay.x, overlay.y, overlay.w, overlay.h, overlay.label, overlay.when ?? "", ...handle]) {
    for (const [, path] of source.matchAll(/\bitem\(\s*["']([^"']*)["']/g)) add(path);
    for (const [, path] of source.matchAll(/\b(?:s|len)\(\s*["'][^"']*["']\s*,\s*["']([^"']*)["']/g)) add(path);
  }
  return parts;
}
/** An overlay expression (or label template) with the node ids it reads translated. */
export function remapExpression(source: string, map: (id: string) => string) {
  return source.replace(READERS, (_all, name: string, quote: string, arg: string) => `${name}(${quote}${name === "p" || name === "prev" || name === "delta" ? remapKey(arg, map) : map(arg)}${quote}`);
}
/** The same result with every node id passed through `map` (ids it does not know stay as they are). */
export function remapResult(result: InspectResultInput, ids: Map<string, string>, suffix = ""): InspectResult {
  const map = (id: string) => ids.get(id) ?? id, expression = (source: string) => remapExpression(source, map);
  const remapOverlay = (overlay: InspectResultInput["overlays"][number]) => {
      const cut = overlay.each.indexOf(":");
      return { ...overlay, id: `${overlay.id}${suffix}`, x: expression(overlay.x), y: expression(overlay.y), w: expression(overlay.w), h: expression(overlay.h), label: expression(overlay.label), when: expression(overlay.when),
        each: cut < 0 ? overlay.each : `${map(overlay.each.slice(0, cut))}${overlay.each.slice(cut)}`, link: { ...overlay.link, nodeId: map(overlay.link.nodeId) },
        handle: overlay.handle ? { ...overlay.handle, key: remapKey(overlay.handle.key, map), x: expression(overlay.handle.x), y: expression(overlay.handle.y), pivotX: expression(overlay.handle.pivotX), pivotY: expression(overlay.handle.pivotY), value: expression(overlay.handle.value) } : null };
  };
  return {
    summary: result.summary,
    overlays: result.overlays.map(remapOverlay),
    valueFixes: result.valueFixes.map(fix => ({ ...fix, key: remapKey(fix.key, map) })),
    recommendations: result.recommendations.map(item => ({ ...item, nodeId: map(item.nodeId), changes: item.changes.map(change => ({ ...change, key: remapKey(change.key, map) })),
      // Asked with previews: the key stays (null for none), so the panel knows to show the value ones too.
      ...("preview" in item ? { preview: item.preview ? { ...item.preview, edits: item.preview.edits.map(edit => ({ ...edit, nodeId: map(edit.nodeId) })), values: item.preview.values.map(value => ({ ...value, nodeId: map(value.nodeId) })),
        machine: item.preview.machine ? { ...item.preview.machine, nodeId: map(item.preview.machine.nodeId) } : null,
        marks: (item.preview.marks ?? []).map(mark => { const cut = (mark.each ?? "").indexOf(":");
          return { ...mark, x: expression(mark.x), y: expression(mark.y), w: expression(mark.w), h: expression(mark.h), label: expression(mark.label), when: expression(mark.when ?? ""), each: cut < 0 ? mark.each ?? "" : `${map(mark.each!.slice(0, cut))}${mark.each!.slice(cut)}` }; }),
        handles: (item.preview.handles ?? []).map(overlay => remapOverlay({ ...overlay, each: overlay.each ?? "", when: overlay.when ?? "", name: overlay.name ?? "", handle: overlay.handle ?? null })) } : null } : {}) })),
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
