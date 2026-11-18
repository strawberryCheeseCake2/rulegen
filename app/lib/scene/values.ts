import type { NumberValue, ScalarValue, Scene, SceneBinding, SceneNode, Value } from "./schema";
import { nodeParams } from "./constraints";

export const bindingKey = (path: string[]) => path.map(encodeURIComponent).join("/");
export const LAYOUT_FIELDS = ["x", "y", "w", "h", "visible"] as const;
export const layoutKey = (nodeId: string, field: (typeof LAYOUT_FIELDS)[number]) => `${encodeURIComponent(nodeId)}/@${field}`;

/** The editable scalar of a value (a param is one slider), addressed by `prefix`. */
export function valueLeaves(value: Value, prefix: string[] = []): { path: string[]; value: ScalarValue }[] {
  return [{ path: prefix, value }];
}
export function nodeLeaves(node: SceneNode) {
  return nodeParams(node).flatMap(param => valueLeaves(param.value, [node.id, param.id]));
}
export function sceneBindings(scene: Scene): SceneBinding[] {
  return scene.nodes.flatMap(node => nodeLeaves(node).map(leaf => ({ key: bindingKey(leaf.path), nodeId: node.id, path: leaf.path.slice(1), type: leaf.value.type })));
}
export function leafValues(leaves: { path: string[]; value: ScalarValue }[]) {
  return Object.fromEntries(leaves.map(leaf => [bindingKey(leaf.path), leaf.value.value])) as Record<string, ScalarValue["value"]>;
}
/** Canvas-pixel layout and visibility; optional for generated code, live when nodes move or hide. */
export function layoutValues(scene: Scene) {
  return Object.fromEntries(scene.nodes.flatMap(node => LAYOUT_FIELDS.map(field => [layoutKey(node.id, field),
    field === "visible" ? node.visible : Number((node.region[field] * (field === "x" || field === "w" ? 900 : 600)).toFixed(2))])));
}
export function sceneValues(scene: Scene) {
  return { ...layoutValues(scene), ...leafValues(scene.nodes.flatMap(nodeLeaves)) };
}

/** Structural signature: equal signatures share the same bindings. */
export const valueShape = (value: Value): string => value.type;

/** The value at a path inside a param (only the empty path: a param is one scalar). */
export const valueAt = (value: Value, path: string[]): Value | undefined => path.length ? undefined : value;
export const replaceAt = (value: Value, path: string[], next: (current: Value) => Value): Value => path.length ? value : next(value);
/** Accept only a value valid for the scalar's own widget (step, bounds, options). */
export function coerceScalar(current: ScalarValue, raw: ScalarValue["value"]): ScalarValue {
  if (current.type === "number" && typeof raw === "number" && Number.isFinite(raw)) {
    const rounded = current.min + Math.round((raw - current.min) / current.step) * current.step;
    return { ...current, value: Number(Math.max(current.min, Math.min(current.max, rounded)).toFixed(8)) };
  }
  if (current.type === "color" && typeof raw === "string" && /^#[0-9a-fA-F]{6}$/.test(raw)) return { ...current, value: raw };
  if (current.type === "select" && typeof raw === "string" && current.options.includes(raw)) return { ...current, value: raw };
  if (current.type === "toggle" && typeof raw === "boolean") return { ...current, value: raw };
  return current;
}
export const setScalarAt = (value: Value, path: string[], raw: ScalarValue["value"]) => replaceAt(value, path, current => coerceScalar(current, raw));

export const defaultNumber = (): NumberValue => ({ type: "number", value: 1, min: 0, max: 10, step: .1, unit: "" });

export function scalarProblem(value: ScalarValue) {
  if (value.type === "number" && (value.min >= value.max || value.value < value.min || value.value > value.max || value.step > value.max - value.min)) return "The number slider range is invalid.";
  if (value.type === "select" && !value.options.includes(value.value)) return "The selected value is not among the options.";
  return "";
}

export function describeValue(value: Value): string {
  if (value.type === "number") return `${value.value}${value.unit ? ` ${value.unit}` : ""} [${value.min}–${value.max}]`;
  if (value.type === "toggle") return value.value ? "On" : "Off";
  return String(value.value);
}
