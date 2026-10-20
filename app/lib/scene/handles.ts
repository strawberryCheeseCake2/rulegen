import { z } from "zod";
import { idSchema, MAX_HANDLE_CODE, MAX_VALUE_DEPTH, type Algorithm, type Property, type PropertyHandle, type ScalarValue, type Scene, type SceneNode, type SemanticTransformation } from "./schema";
import { findNode, updateNode } from "./graph";
import { findProperty, findTransformation, mapProperties, nodeProperties, updateProperty } from "./transformations";
import { isAlgorithm, valueAt, valueLeaves } from "./values";

// Direct manipulation handles: each property can carry one widget made for it
// (p5 code, `rulegenHandle(function (h) { … })`). Widgets run in a proxy frame
// beside the target frame; dragging one sets the property's scalars there.

export const pathKey = (path: string[]) => path.join("/");
const samePath = (a: string[], b: string[]) => pathKey(a) === pathKey(b);
/** The scalars of a property a widget can drive. */
export const handleLeaves = (property: Property) => valueLeaves(property.value);
/** Whether every scalar the handle drives is still there (same path, a scalar). */
export function handleFits(property: Property, handle: PropertyHandle | undefined = property.handle) {
  return Boolean(handle && handle.paths.every(path => { const value = valueAt(property.value, path); return value && !isAlgorithm(value); }));
}

export function setHandle(scene: Scene, nodeId: string, propertyId: string, handle: PropertyHandle | null): Scene {
  return updateNode(scene, nodeId, node => updateProperty(node, propertyId, property => {
    if (!handle) { const { handle: _removed, ...rest } = property; return rest; }
    return { ...property, handle };
  }));
}
/** Handles survive a property being regenerated or revised, as long as their scalars are still there. */
export function keepHandles(before: SceneNode, after: SceneNode): SceneNode {
  if (!nodeProperties(before).some(property => property.handle)) return after;
  return mapProperties(after, property => {
    const old = findProperty(before, property.id)?.handle;
    return property.handle || !old || !handleFits(property, old) ? property : { ...property, handle: old };
  });
}

// ── Proxy frame layout ─────────────────────────────────────────────────────

const W = 900, H = 600, GAP = 14;
/** Room above each widget for its name and hint. */
export const CELL_HEADER = 34;
export type Box = { x: number; y: number; w: number; h: number };
/** Widget cells of a proxy frame: a grid filled row by row, in property order. */
export function proxyCells(count: number): Box[] {
  if (!count) return [];
  const cols = count <= 1 ? 1 : count <= 4 ? 2 : count <= 9 ? 3 : 4, rows = Math.ceil(count / cols);
  const w = (W - GAP * (cols + 1)) / cols, h = (H - GAP * (rows + 1)) / rows;
  return Array.from({ length: count }, (_, i) => ({ x: GAP + (i % cols) * (w + GAP), y: GAP + Math.floor(i / cols) * (h + GAP), w, h }));
}
/** Properties a proxy frame shows: those with a handle, in transformation order. */
export const proxyProperties = (transformations: SemanticTransformation[]) => transformations.flatMap(item => item.properties).filter(property => property.handle);

/** What a widget can read: each driven scalar's spec and value, keyed by its path ("a/b"; "" = the property's own value). */
export type HandleSpec = { type: ScalarValue["type"]; value: ScalarValue["value"]; min?: number; max?: number; step?: number; unit?: string; options?: string[] };
export function handleSpecs(property: Property): Record<string, HandleSpec> {
  return Object.fromEntries(handleLeaves(property).map(({ path, value }) => [pathKey(path), value.type === "number" ? { type: value.type, value: value.value, min: value.min, max: value.max, step: value.step, unit: value.unit }
    : value.type === "select" ? { type: value.type, value: value.value, options: value.options } : { type: value.type, value: value.value }]));
}

// ── AI design ───────────────────────────────────────────────────────────────

/** What the model returns for the `handles` intent. */
export const aiHandlesSchema = z.object({
  handles: z.array(z.object({
    propertyId: idSchema,
    paths: z.array(z.array(idSchema).max(MAX_VALUE_DEPTH)).max(8),
    hint: z.string().max(120),
    code: z.string().max(MAX_HANDLE_CODE),
  })).max(32),
});
export type AIHandles = z.infer<typeof aiHandlesSchema>;
const storedHandleSchema = z.object({ code: z.string().min(1).max(MAX_HANDLE_CODE), prepared: z.string().min(1).max(MAX_HANDLE_CODE * 4), paths: z.array(z.array(idSchema).max(MAX_VALUE_DEPTH)).min(1).max(8), hint: z.string().max(120) });
export const handleSuggestionsSchema = z.object({
  handles: z.array(z.object({ propertyId: idSchema, handle: storedHandleSchema })).max(32),
  /** Widgets that were left out (their code could not run), with why. */
  skipped: z.array(z.object({ propertyId: z.string().max(80), reason: z.string().max(300) })).max(32).default([]),
});
export type HandleSuggestion = z.infer<typeof handleSuggestionsSchema>["handles"][number];
export type HandleTarget = { transformationId?: string; propertyId?: string };

/** The properties a request designs: one property, or one transformation's (never the whole node at once). */
export function handleTargetProperties(node: SceneNode, target: HandleTarget): Property[] {
  if (target.propertyId) { const property = findProperty(node, target.propertyId); return property ? [property] : []; }
  return (target.transformationId ? findTransformation(node, target.transformationId)?.properties ?? [] : []).filter(property => handleLeaves(property).length);
}
/** The node's transformations that have a property a widget can drive (what a proxy frame can design for). */
export const handleTransformations = (node: SceneNode) => node.transformations.filter(item => item.properties.some(property => handleLeaves(property).length));
/** Keep one widget per requested property; paths must name its scalars (none given or none valid: all of them). */
export function settleHandles(node: SceneNode, output: AIHandles, target: HandleTarget, prepare: (code: string) => string) {
  const allowed = new Set(handleTargetProperties(node, target).map(property => property.id));
  const seen = new Set<string>(), handles: HandleSuggestion[] = [], skipped: { propertyId: string; reason: string }[] = [];
  for (const item of output.handles) {
    const property = findProperty(node, item.propertyId);
    if (!property || !allowed.has(property.id) || seen.has(property.id)) continue;
    const leaves = handleLeaves(property);
    if (!leaves.length) continue;
    const valid = item.paths.filter(path => leaves.some(leaf => samePath(leaf.path, path)));
    const paths = [...new Map((valid.length ? valid : leaves.map(leaf => leaf.path)).slice(0, 8).map(path => [pathKey(path), path])).values()];
    seen.add(property.id);
    try { handles.push({ propertyId: property.id, handle: { code: item.code, prepared: prepare(item.code), paths, hint: item.hint.trim().slice(0, 120) } }); }
    catch (error) { skipped.push({ propertyId: property.id, reason: (error as Error).message.slice(0, 300) }); }
  }
  return { handles, skipped };
}
export function applyHandles(scene: Scene, nodeId: string, suggestions: HandleSuggestion[]): Scene {
  const node = findNode(scene, nodeId);
  if (!node) return scene;
  return suggestions.filter(item => findProperty(node, item.propertyId)).reduce((next, item) => setHandle(next, nodeId, item.propertyId, item.handle), scene);
}
/** What the model is told about each property it designs for: meaning, scalars (with ranges) and the algorithms behind it. */
export function handleTargets(node: SceneNode, algorithms: Algorithm[], target: HandleTarget) {
  return handleTargetProperties(node, target).map(property => {
    const owner = node.transformations.find(item => item.properties.some(entry => entry.id === property.id));
    const used = new Set<string>();
    const walk = (value: Property["value"]) => { if (isAlgorithm(value)) { used.add(value.algorithmId); value.args.forEach(arg => walk(arg.value)); } };
    walk(property.value);
    return { propertyId: property.id, label: property.label, effect: property.effect, description: property.description, transformation: owner ? { label: owner.label, description: owner.description } : null,
      scalars: Object.entries(handleSpecs(property)).map(([key, spec]) => ({ path: key ? key.split("/") : [], ...spec })),
      algorithms: algorithms.filter(algorithm => used.has(algorithm.id)).map(algorithm => ({ id: algorithm.id, name: algorithm.name, description: algorithm.description, params: algorithm.params.map(param => ({ id: param.id, label: param.label, description: param.description })) })),
      current: property.handle ? { hint: property.handle.hint, code: property.handle.code } : null };
  });
}
