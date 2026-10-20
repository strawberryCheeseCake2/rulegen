import { z } from "zod";
import type { GeneratedCode } from "./schema";
import { findNode } from "./scene/graph";
import { programModules, sceneInstances, syncScene } from "./scene/machines";
import { effectSchema, idSchema, MAX_NODE_PROPERTIES, MAX_PROPERTIES, scalarValueSchema, type Scene, type SceneNode } from "./scene/schema";
import { nodeProperties } from "./scene/transformations";
import { bindingKey, sceneBindings } from "./scene/values";

// Hidden parameters: a targeted inspection may find that its concern depends on a
// number (or color, toggle, option) the code hard-codes, not a property the user
// can change. It suggests exposing it: a new property on the semantic transformation
// it belongs to, plus small edits to the node's module so it reads the property
// (`m.v("<node>/<property>")`) instead of the constant. Accepting adds both, so the
// value can be adjusted at once; nothing is regenerated.

export const MAX_PARAMETER_SUGGESTIONS = 4;
const editSchema = z.object({
  /** An exact snippet of the module source, found exactly once. */
  find: z.string().min(1).max(600),
  /** The same snippet reading the new property with m.v("<key>") where the constant was. */
  replace: z.string().min(1).max(800),
});
export const parameterSuggestionSchema = z.object({
  nodeId: z.string().max(80), transformationId: z.string().max(80),
  id: idSchema, label: z.string().min(1).max(80), effect: effectSchema, description: z.string().max(600),
  /** The value the code uses now, with a sensible range. */
  value: scalarValueSchema,
  /** Why it matters for the concern (Korean). */
  reason: z.string().max(400),
  edits: z.array(editSchema).min(1).max(4),
});
export type ParameterSuggestion = z.infer<typeof parameterSuggestionSchema>;

/** The value key the module reads for a property of this node (the code's node id). */
export const exposedKey = (node: SceneNode, propertyId: string) => bindingKey([node.codeId ?? node.id, propertyId]);
const rootOf = (scene: Scene, id: string) => { let node = findNode(scene, id); while (node?.parentId) node = findNode(scene, node.parentId); return node; };
/** The module that draws a node (its root's). */
export const moduleKeyOf = (scene: Scene, nodeId: string) => { const root = rootOf(scene, nodeId); return root ? root.codeModule ?? root.id : null; };

/** The module source after the edits, or why they cannot apply. */
export function applyParameterEdits(module: string, edits: ParameterSuggestion["edits"]): { module: string } | { error: string } {
  let text = module;
  for (const edit of edits) {
    const at = text.indexOf(edit.find);
    if (at < 0) return { error: "바꿀 코드 부분을 찾지 못했습니다" };
    if (text.indexOf(edit.find, at + 1) >= 0) return { error: "바꿀 코드 부분이 여러 곳에 있습니다" };
    text = text.slice(0, at) + edit.replace + text.slice(at + edit.find.length);
  }
  return { module: text };
}

/** Why a suggestion cannot be exposed in this scene and program (null: it can). `parses` checks the edited module is valid code. */
export function parameterProblem(scene: Scene, code: string, item: ParameterSuggestion, parses: (module: string) => boolean = () => true): string | null {
  const node = findNode(scene, item.nodeId);
  if (!node) return "노드를 찾지 못했습니다";
  const transformation = node.transformations.find(entry => entry.id === item.transformationId);
  if (!transformation) return "semantic transformation을 찾지 못했습니다";
  if (nodeProperties(node).some(property => property.id === item.id)) return "같은 id의 property가 이미 있습니다";
  if (transformation.properties.length >= MAX_PROPERTIES || nodeProperties(node).length >= MAX_NODE_PROPERTIES) return "property를 더 넣을 수 없습니다";
  const value = item.value;
  if (value.type === "number" && !(value.min <= value.value && value.value <= value.max && value.min < value.max)) return "값의 범위가 맞지 않습니다";
  if (value.type === "select" && !value.options.includes(value.value)) return "선택지에 없는 값입니다";
  const key = exposedKey(node, item.id);
  if (!item.edits.some(edit => edit.replace.includes(`m.v(${JSON.stringify(key)})`) || edit.replace.includes(`m.v('${key}')`))) return `코드가 m.v("${key}")를 읽지 않습니다`;
  const moduleKey = moduleKeyOf(scene, node.id), module = moduleKey ? programModules(code).get(moduleKey) : undefined;
  if (!module) return "노드의 코드 모듈을 찾지 못했습니다";
  const edited = applyParameterEdits(module, item.edits);
  if ("error" in edited) return edited.error;
  return parses(edited.module) ? null : "고친 코드가 올바르지 않습니다";
}

/**
 * Expose a hidden parameter: the property goes on the transformation of every
 * stamp in the frame drawn by the same code (same code id), the module reads it,
 * and the program stays live (no regeneration).
 */
export function exposeParameter(scene: Scene, generated: GeneratedCode, item: ParameterSuggestion): { scene: Scene; generated: GeneratedCode } | { error: string } {
  const problem = parameterProblem(scene, generated.code, item);
  if (problem) return { error: problem };
  const node = findNode(scene, item.nodeId)!, codeId = node.codeId ?? node.id, moduleKey = moduleKeyOf(scene, node.id)!;
  // Every stamp the module runs (its instances) reads the value through its own copy of the node.
  const ids = new Set(sceneInstances(scene).filter(instance => instance.module === moduleKey).map(instance => instance.map[codeId]).filter(Boolean));
  const property = { id: item.id, label: item.label, effect: item.effect, description: item.description, value: item.value };
  const sharing = scene.nodes.filter(entry => ids.has(entry.id));
  const missing = sharing.filter(entry => !entry.transformations.some(transformation => transformation.id === item.transformationId) || nodeProperties(entry).some(existing => existing.id === item.id));
  if (missing.length) return { error: `같은 코드를 쓰는 ${missing.map(entry => entry.name).join(", ")}에는 그 transformation이 없거나 같은 id가 있습니다` };
  const next = { ...scene, nodes: scene.nodes.map(entry => !ids.has(entry.id) ? entry : { ...entry, transformations: entry.transformations.map(transformation =>
    transformation.id === item.transformationId ? { ...transformation, properties: [...transformation.properties, property] } : transformation) }) };
  const module = programModules(generated.code).get(moduleKey)!;
  const edited = applyParameterEdits(module, item.edits) as { module: string };
  // The host block gets the new value too, so the program runs as it is.
  return { scene: next, generated: { ...generated, code: syncScene(generated.code.replace(module, () => edited.module), next), sceneBindings: sceneBindings(next) } };
}

/** Whether a suggestion was taken (its property is on the node), turned down, or still open. */
export function parameterStatus(item: ParameterSuggestion & { rejected?: boolean }, scene: Scene): "accepted" | "rejected" | "pending" {
  const node = findNode(scene, item.nodeId);
  if (node?.transformations.some(entry => entry.id === item.transformationId && entry.properties.some(property => property.id === item.id))) return "accepted";
  return item.rejected ? "rejected" : "pending";
}

// Recorded fields: the concern is about a per-item quantity (an item's speed, its
// count, its size) that the module computes but does not keep on the item records in
// m.store, so overlays cannot show it per item. The inspection then adds edits that
// put it on each record (`{ x, y, …, speed, tips }`); nothing drawn changes.

export const recordingSchema = z.object({
  /** A node of the module (the root drawing the items). */
  nodeId: z.string().max(80),
  /** The record fields the edits add, e.g. ["speed", "tips"]. */
  fields: z.array(z.string().regex(/^[A-Za-z_$][\w$]*$/).max(40)).min(1).max(6),
  /** Which items and why (Korean). */
  reason: z.string().max(400),
  edits: z.array(editSchema).min(1).max(4),
});
export type Recording = z.infer<typeof recordingSchema>;

/** Why the recording edits cannot apply to this program (null: they can). */
export function recordingProblem(scene: Scene, code: string, item: Recording, parses: (module: string) => boolean = () => true): string | null {
  if (!findNode(scene, item.nodeId)) return "노드를 찾지 못했습니다";
  // Each field is written by some edit: it is named more often after it than before.
  const count = (text: string, field: string) => text.split(new RegExp(`(?<![\\w$])${field.replace(/\$/g, "\\$")}(?![\\w$])`)).length - 1;
  const missing = item.fields.filter(field => !item.edits.some(edit => count(edit.replace, field) > count(edit.find, field)));
  if (missing.length) return `코드가 ${missing.join(", ")}을(를) 기록하지 않습니다`;
  const moduleKey = moduleKeyOf(scene, item.nodeId), module = moduleKey ? programModules(code).get(moduleKey) : undefined;
  if (!module) return "노드의 코드 모듈을 찾지 못했습니다";
  const edited = applyParameterEdits(module, item.edits);
  if ("error" in edited) return edited.error;
  return parses(edited.module) ? null : "고친 코드가 올바르지 않습니다";
}
/** Whether the program already records them (every edit's result is in the module). */
export function recordingApplied(scene: Scene, code: string, item: Recording) {
  const moduleKey = moduleKeyOf(scene, item.nodeId), module = moduleKey ? programModules(code).get(moduleKey) : undefined;
  return Boolean(module && item.edits.every(edit => module.includes(edit.replace)));
}
/** The program with the module recording the fields (the scene is unchanged). */
export function recordFields(scene: Scene, generated: GeneratedCode, item: Recording): { generated: GeneratedCode } | { error: string } {
  const problem = recordingProblem(scene, generated.code, item);
  if (problem) return { error: problem };
  const module = programModules(generated.code).get(moduleKeyOf(scene, item.nodeId)!)!;
  const edited = applyParameterEdits(module, item.edits) as { module: string };
  return { generated: { ...generated, code: generated.code.replace(module, () => edited.module) } };
}
