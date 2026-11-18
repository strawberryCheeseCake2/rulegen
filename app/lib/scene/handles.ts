import { z } from "zod";
import { idSchema, MAX_HANDLE_CODE, MAX_VALUE_DEPTH, type Param, type ParamHandle, type ScalarValue, type Scene, type SceneNode, type Constraint } from "./schema";
import { findNode, updateNode } from "./graph";
import { findParam, findConstraint, mapParams, nodeParams, updateParam } from "./constraints";
import { valueAt, valueLeaves } from "./values";

// Direct manipulation handles: each param can carry one widget made for it
// (p5 code, `rulegenHandle(function (h) { … })`). Widgets run in a proxy frame
// beside the target frame; dragging one sets the param's scalars there.

export const pathKey = (path: string[]) => path.join("/");
const samePath = (a: string[], b: string[]) => pathKey(a) === pathKey(b);
/** The scalars of a param a widget can drive. */
export const handleLeaves = (param: Param) => valueLeaves(param.value);
/** Whether every scalar the handle drives is still there (same path, a scalar). */
export function handleFits(param: Param, handle: ParamHandle | undefined = param.handle) {
  return Boolean(handle && handle.paths.every(path => valueAt(param.value, path)));
}

export function setHandle(scene: Scene, nodeId: string, paramId: string, handle: ParamHandle | null): Scene {
  return updateNode(scene, nodeId, node => updateParam(node, paramId, param => {
    if (!handle) { const { handle: _removed, ...rest } = param; return rest; }
    return { ...param, handle };
  }));
}
/** Handles survive a param being regenerated or revised, as long as their scalars are still there. */
export function keepHandles(before: SceneNode, after: SceneNode): SceneNode {
  if (!nodeParams(before).some(param => param.handle)) return after;
  return mapParams(after, param => {
    const old = findParam(before, param.id)?.handle;
    return param.handle || !old || !handleFits(param, old) ? param : { ...param, handle: old };
  });
}

// ── Proxy frame layout ─────────────────────────────────────────────────────

const W = 900, H = 600, GAP = 14;
/** Room above each widget for its name and hint. */
export const CELL_HEADER = 34;
export type Box = { x: number; y: number; w: number; h: number };
/** Widget cells of a proxy frame: a grid filled row by row, in param order. */
export function proxyCells(count: number): Box[] {
  if (!count) return [];
  const cols = count <= 1 ? 1 : count <= 4 ? 2 : count <= 9 ? 3 : 4, rows = Math.ceil(count / cols);
  const w = (W - GAP * (cols + 1)) / cols, h = (H - GAP * (rows + 1)) / rows;
  return Array.from({ length: count }, (_, i) => ({ x: GAP + (i % cols) * (w + GAP), y: GAP + Math.floor(i / cols) * (h + GAP), w, h }));
}
/** Params a proxy frame shows: those with a handle, in constraint order. */
export const proxyParams = (constraints: Constraint[]) => constraints.flatMap(item => item.params).filter(param => param.handle);
/** Constraints a proxy frame shows (those with a widget), each with its params that have one; `hidden` ones left out. */
export const proxyGroups = (constraints: Constraint[], hidden: string[] = []) => constraints.filter(item => !hidden.includes(item.id))
  .map(constraint => ({ constraint, params: proxyParams([constraint]) })).filter(group => group.params.length);

/** Room above each constraint's section for its name. */
export const SECTION_HEADER = 24;
const INNER = 8;
/**
 * A proxy frame laid out by constraint: one section per constraint (a grid of sections, the last row
 * stretched to the width), its widgets in a grid inside it shaped to the section. `counts`: widgets per section.
 */
export function proxySections(counts: number[]): { box: Box; cells: Box[] }[] {
  const g = counts.length; if (!g) return [];
  const cols = g <= 3 ? 1 : g <= 8 ? 2 : 3, rows = Math.ceil(g / cols), h = (H - GAP * (rows + 1)) / rows;
  return counts.map((count, i) => {
    const row = Math.floor(i / cols), inRow = Math.min(cols, g - row * cols), w = (W - GAP * (inRow + 1)) / inRow;
    const box = { x: GAP + (i % cols) * (w + GAP), y: GAP + row * (h + GAP), w, h };
    const inner = { x: box.x + INNER, y: box.y + SECTION_HEADER, w: box.w - INNER * 2, h: box.h - SECTION_HEADER - INNER };
    const n = Math.max(1, count), sub = Math.max(1, Math.min(n, Math.round(Math.sqrt(n * inner.w / Math.max(1, inner.h))))), subRows = Math.ceil(n / sub);
    const cw = (inner.w - INNER * (sub - 1)) / sub, ch = (inner.h - INNER * (subRows - 1)) / subRows;
    return { box, cells: Array.from({ length: count }, (_, k) => ({ x: inner.x + (k % sub) * (cw + INNER), y: inner.y + Math.floor(k / sub) * (ch + INNER), w: cw, h: ch })) };
  });
}

/** What a widget can read: each driven scalar's spec and value, keyed by its path ("a/b"; "" = the param's own value). */
export type HandleSpec = { type: ScalarValue["type"]; value: ScalarValue["value"]; min?: number; max?: number; step?: number; unit?: string; options?: string[] };
export function handleSpecs(param: Param): Record<string, HandleSpec> {
  return Object.fromEntries(handleLeaves(param).map(({ path, value }) => [pathKey(path), value.type === "number" ? { type: value.type, value: value.value, min: value.min, max: value.max, step: value.step, unit: value.unit }
    : value.type === "select" ? { type: value.type, value: value.value, options: value.options } : { type: value.type, value: value.value }]));
}

// ── AI design ───────────────────────────────────────────────────────────────

/** What the model returns for the `handles` intent. */
export const aiHandlesSchema = z.object({
  handles: z.array(z.object({
    paramId: idSchema,
    paths: z.array(z.array(idSchema).max(MAX_VALUE_DEPTH)).max(8),
    hint: z.string().max(120),
    code: z.string().max(MAX_HANDLE_CODE),
  })).max(32),
});
export type AIHandles = z.infer<typeof aiHandlesSchema>;
const storedHandleSchema = z.object({ code: z.string().min(1).max(MAX_HANDLE_CODE), prepared: z.string().min(1).max(MAX_HANDLE_CODE * 4), paths: z.array(z.array(idSchema).max(MAX_VALUE_DEPTH)).min(1).max(8), hint: z.string().max(120) });
export const handleSuggestionsSchema = z.object({
  handles: z.array(z.object({ paramId: idSchema, handle: storedHandleSchema })).max(32),
  /** Widgets that were left out (their code could not run), with why. */
  skipped: z.array(z.object({ paramId: z.string().max(80), reason: z.string().max(300) })).max(32).default([]),
});
export type HandleSuggestion = z.infer<typeof handleSuggestionsSchema>["handles"][number];
export type HandleTarget = { constraintId?: string; paramId?: string };

/** The params a request designs: one param, or one constraint's (never the whole node at once). */
export function handleTargetParams(node: SceneNode, target: HandleTarget): Param[] {
  if (target.paramId) { const param = findParam(node, target.paramId); return param ? [param] : []; }
  return (target.constraintId ? findConstraint(node, target.constraintId)?.params ?? [] : []).filter(param => handleLeaves(param).length);
}
/** The node's constraints that have a param a widget can drive (what a proxy frame can design for). */
export const handleConstraints = (node: SceneNode) => node.constraints.filter(item => item.params.some(param => handleLeaves(param).length));
/** Keep one widget per requested param; paths must name its scalars (none given or none valid: all of them). */
export function settleHandles(node: SceneNode, output: AIHandles, target: HandleTarget, prepare: (code: string) => string) {
  const allowed = new Set(handleTargetParams(node, target).map(param => param.id));
  const seen = new Set<string>(), handles: HandleSuggestion[] = [], skipped: { paramId: string; reason: string }[] = [];
  for (const item of output.handles) {
    const param = findParam(node, item.paramId);
    if (!param || !allowed.has(param.id) || seen.has(param.id)) continue;
    const leaves = handleLeaves(param);
    if (!leaves.length) continue;
    const valid = item.paths.filter(path => leaves.some(leaf => samePath(leaf.path, path)));
    const paths = [...new Map((valid.length ? valid : leaves.map(leaf => leaf.path)).slice(0, 8).map(path => [pathKey(path), path])).values()];
    seen.add(param.id);
    try { handles.push({ paramId: param.id, handle: { code: item.code, prepared: prepare(item.code), paths, hint: item.hint.trim().slice(0, 120) } }); }
    catch (error) { skipped.push({ paramId: param.id, reason: (error as Error).message.slice(0, 300) }); }
  }
  return { handles, skipped };
}
export function applyHandles(scene: Scene, nodeId: string, suggestions: HandleSuggestion[]): Scene {
  const node = findNode(scene, nodeId);
  if (!node) return scene;
  return suggestions.filter(item => findParam(node, item.paramId)).reduce((next, item) => setHandle(next, nodeId, item.paramId, item.handle), scene);
}
/** What the model is told about each param it designs for: meaning and its scalar (with its range). */
export function handleTargets(node: SceneNode, target: HandleTarget) {
  return handleTargetParams(node, target).map(param => {
    const owner = node.constraints.find(item => item.params.some(entry => entry.id === param.id));
    return { paramId: param.id, label: param.label, effect: param.effect, description: param.description, constraint: owner ? { label: owner.property, description: owner.description } : null,
      scalars: Object.entries(handleSpecs(param)).map(([key, spec]) => ({ path: key ? key.split("/") : [], ...spec })),
      current: param.handle ? { hint: param.handle.hint, code: param.handle.code } : null };
  });
}
