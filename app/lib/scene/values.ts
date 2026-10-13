import type { AlgorithmCall, NumberValue, ScalarValue, Scene, SceneBinding, SceneNode, Value } from "./schema";
import { nodeProperties } from "./transformations";

export const isAlgorithm = (value: Value): value is AlgorithmCall => value.type === "algorithm";
export const bindingKey = (path: string[]) => path.map(encodeURIComponent).join("/");
export const LAYOUT_FIELDS = ["x", "y", "w", "h", "visible"] as const;
export const layoutKey = (nodeId: string, field: (typeof LAYOUT_FIELDS)[number]) => `${encodeURIComponent(nodeId)}/@${field}`;

/** Every editable scalar inside a value, addressed by the argument ids leading to it. */
export function valueLeaves(value: Value, prefix: string[] = []): { path: string[]; value: ScalarValue }[] {
  if (!isAlgorithm(value)) return [{ path: prefix, value }];
  return value.args.flatMap(arg => valueLeaves(arg.value, [...prefix, arg.id]));
}
export function nodeLeaves(node: SceneNode) {
  return nodeProperties(node).flatMap(property => valueLeaves(property.value, [node.id, property.id]));
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
export function valueShape(value: Value): string {
  return isAlgorithm(value) ? `${value.algorithmId}(${value.args.map(arg => `${arg.id}:${valueShape(arg.value)}`).join(",")})` : value.type;
}
export function valueDepth(value: Value): number {
  return isAlgorithm(value) ? 1 + Math.max(0, ...value.args.map(arg => valueDepth(arg.value))) : 0;
}

export function valueAt(value: Value, path: string[]): Value | undefined {
  if (!path.length) return value;
  if (!isAlgorithm(value)) return undefined;
  const arg = value.args.find(item => item.id === path[0]);
  return arg && valueAt(arg.value, path.slice(1));
}
export function replaceAt(value: Value, path: string[], next: (current: Value) => Value): Value {
  if (!path.length) return next(value);
  if (!isAlgorithm(value)) return value;
  return { ...value, args: value.args.map(arg => arg.id === path[0] ? { ...arg, value: replaceAt(arg.value, path.slice(1), next) } : arg) };
}

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
export const setScalarAt = (value: Value, path: string[], raw: ScalarValue["value"]) => replaceAt(value, path, current => isAlgorithm(current) ? current : coerceScalar(current, raw));

export const defaultNumber = (): NumberValue => ({ type: "number", value: 1, min: 0, max: 10, step: .1, unit: "" });

export function scalarProblem(value: ScalarValue) {
  if (value.type === "number" && (value.min >= value.max || value.value < value.min || value.value > value.max || value.step > value.max - value.min)) return "숫자 슬라이더 범위가 올바르지 않습니다.";
  if (value.type === "select" && !value.options.includes(value.value)) return "선택값이 옵션에 없습니다.";
  return "";
}

export function describeValue(value: Value, names: (algorithmId: string) => string = id => id): string {
  if (isAlgorithm(value)) return `${names(value.algorithmId)}(${value.args.map(arg => `${arg.id}=${describeValue(arg.value, names)}`).join(", ")})`;
  if (value.type === "number") return `${value.value}${value.unit ? ` ${value.unit}` : ""} [${value.min}–${value.max}]`;
  if (value.type === "toggle") return value.value ? "On" : "Off";
  return String(value.value);
}
