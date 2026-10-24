import { z } from "zod";
import type { GeneratedCode } from "./schema";
import { findNode } from "./scene/graph";
import { readsPerItem } from "./item-values";
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
// A quantity set by several constants together (a curve's control offsets) is
// suggested as a scale instead: the module multiplies them by the new value, 1 now.
// Before it is accepted the overlays already read it, at the value the code uses.

export const MAX_PARAMETER_SUGGESTIONS = 4;
const editSchema = z.object({
  /** An exact snippet of the module source, found exactly once. */
  find: z.string().min(1).max(1500),
  /** The same snippet reading the new property with m.v("<key>") where the constant was. */
  // Long enough for a loop that records each part of an item: a cut-off edit is not valid code and is dropped.
  replace: z.string().min(1).max(4000),
});
export const parameterSuggestionSchema = z.object({
  nodeId: z.string().max(80), transformationId: z.string().max(80),
  id: idSchema, label: z.string().min(1).max(80), effect: effectSchema, description: z.string().max(600),
  /** "constant": the value replaces one constant. "scale": it multiplies several constants (a number, 1 now). */
  form: z.enum(["constant", "scale"]).default("constant"),
  /** The value the code uses now, with a sensible range. */
  value: scalarValueSchema,
  /** Why it matters for the concern (Korean). */
  reason: z.string().max(400),
  edits: z.array(editSchema).min(1).max(4),
});
/** A suggestion as given (older ones have no `form`). */
export type ParameterSuggestion = z.input<typeof parameterSuggestionSchema>;

/** The value key the module reads for a property of this node (the code's node id). */
export const exposedKey = (node: SceneNode, propertyId: string) => bindingKey([node.codeId ?? node.id, propertyId]);
/** The value key a suggestion has in a frame (its node id there): overlays read it with p("…") before and after it is accepted. */
export const suggestionKey = (item: Pick<ParameterSuggestion, "nodeId" | "id">) => bindingKey([item.nodeId, item.id]);
/**
 * The value each suggested parameter has where no step records it: the value the
 * code uses (a pending or rejected one is still that constant; an accepted one had
 * it at steps recorded before it was added, and after Undo apply).
 */
export const suggestedValues = (items: ParameterSuggestion[]) => Object.fromEntries(items.map(item => [suggestionKey(item), item.value.value]));
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
  // A scale leaves the picture as it is at 1, and must be able to go both ways.
  if (item.form === "scale" && !(value.type === "number" && value.value === 1 && value.min < 1 && value.max > 1)) return "배율은 지금 값 1을 사이에 둔 숫자여야 합니다";
  const key = exposedKey(node, item.id);
  // Plainly, or per drawn item (m.v("<key>", id)).
  const reads = new RegExp(`m\\.v\\(\\s*(["'])${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\1\\s*[,)]`);
  if (!item.edits.some(edit => reads.test(edit.replace))) return `코드가 m.v("${key}")를 읽지 않습니다`;
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
  /** The record fields the edits add, e.g. ["speed", "tips"] (and "id", for a value read per item). */
  fields: z.array(z.string().regex(/^[A-Za-z_$][\w$]*$/).max(40)).max(6),
  /** Value keys the edits make the module read per drawn item (m.v("<key>", id)), so a handle changes one item. */
  perItem: z.array(z.string().max(200)).max(6).default([]),
  /** Which items and why (Korean). */
  reason: z.string().max(400),
  edits: z.array(editSchema).min(1).max(6),
});
/** Records as given (older ones have no `perItem`). */
export type Recording = z.input<typeof recordingSchema>;

/**
 * The records with every read of a suggested parameter made safe: `m.v("<key>")` →
 * `m.opt(<its value now>, "<key>")`. The records are applied at once, but the value
 * exists only after the suggestion is accepted (never, if it is rejected): read
 * plainly, the program stops with "Unknown value". It reads the code's value until then.
 */
export function guardSuggestedReads(item: Recording, suggestions: ParameterSuggestion[]): Recording {
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const guard = (text: string) => suggestions.reduce((source, suggestion) => source.replace(new RegExp(`m\\.v\\(\\s*(["'])((?:[^"'/]*/)?${escape(suggestion.id)})\\1`, "g"),
    (_all, quote: string, key: string) => `m.opt(${JSON.stringify(suggestion.value.value)}, ${quote}${key}${quote}`), text);
  return { ...item, edits: item.edits.map(edit => ({ find: edit.find, replace: guard(edit.replace) })) };
}

/** Why the recording edits cannot apply to this program (null: they can). */
export function recordingProblem(scene: Scene, code: string, item: Recording, parses: (module: string) => boolean = () => true): string | null {
  if (!findNode(scene, item.nodeId)) return "노드를 찾지 못했습니다";
  // Each field is written by some edit: it is named more often after it than before.
  const count = (text: string, field: string) => text.split(new RegExp(`(?<![\\w$])${field.replace(/\$/g, "\\$")}(?![\\w$])`)).length - 1;
  const missing = item.fields.filter(field => !item.edits.some(edit => count(edit.replace, field) > count(edit.find, field)));
  if (missing.length) return `코드가 ${missing.join(", ")}을(를) 기록하지 않습니다`;
  if (!item.fields.length && !item.perItem?.length) return "기록할 것이 없습니다";
  const moduleKey = moduleKeyOf(scene, item.nodeId), module = moduleKey ? programModules(code).get(moduleKey) : undefined;
  if (!module) return "노드의 코드 모듈을 찾지 못했습니다";
  const edited = applyParameterEdits(module, item.edits);
  if ("error" in edited) return edited.error;
  const flat = (item.perItem ?? []).filter(key => !readsPerItem(edited.module, key));
  if (flat.length) return `코드가 ${flat.join(", ")}을(를) 항목별로 읽지 않습니다`;
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
