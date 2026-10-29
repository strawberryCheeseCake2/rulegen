import { exploreProgram } from "./explore";
import { applyMachineChange } from "./machine-change";
import type { Recommendation, RecommendationPreview } from "./inspection";
import type { GeneratedCode } from "./schema";
import { findNode } from "./scene/graph";
import { moduleKeyOf } from "./hidden-parameters";
import { sceneInstances, syncScene } from "./scene/machines";
import type { Property, Scene, SceneNode } from "./scene/schema";
import { MAX_PROPERTIES, MAX_TRANSFORMATIONS } from "./scene/schema";
import { addTransformation, findTransformation, nodeProperties, updateTransformation } from "./scene/transformations";
import { sceneSchema } from "./scene/validate";
import { sceneBindings } from "./scene/values";

// A fork made without AI: the recommendation's preview (the code an exploration frame
// or the inspection already wrote for it) becomes the fork's code, and the scene is
// told about it, so scene and code agree and its new values are properties that can
// be inspected: the transformation it changes (or a new one it adds) gets the
// recommendation's description and the preview's new values.

/** The fork's scene and code from a recommendation's preview, or why it cannot be made. */
export function previewFork(scene: Scene, generated: GeneratedCode, recommendation: Pick<Recommendation, "kind" | "nodeId" | "targetId" | "title" | "detail">, preview: Pick<RecommendationPreview, "edits" | "values"> & { machine?: RecommendationPreview["machine"] }): { scene: Scene; generated: GeneratedCode } | { error: string } {
  if (!preview.edits.length) return { error: "미리보기 코드가 없습니다" };
  const program = exploreProgram(generated.code, scene, preview);
  if ("error" in program) return program;
  // The values go on the nodes that read them: one transformation per node with the recommendation's name and
  // description (the one it changes, or a new one), on every stamp that runs the same module.
  const owners = new Map<string, Property[]>();
  if (recommendation.kind !== "state" && recommendation.kind !== "transition") owners.set(recommendation.nodeId, []);
  for (const value of preview.values) owners.set(value.nodeId, [...(owners.get(value.nodeId) ?? []), { id: value.id, label: value.label, effect: "spatial", description: "", value: value.value }]);
  let next = scene;
  for (const [nodeId, properties] of owners) {
    const node = findNode(next, nodeId); if (!node) return { error: "추천이 바꾸는 노드를 찾지 못했습니다" };
    const codeId = node.codeId ?? node.id, module = moduleKeyOf(next, nodeId);
    const ids = new Set([nodeId, ...sceneInstances(next).filter(instance => instance.module === module).map(instance => instance.map[codeId]).filter(Boolean)]);
    for (const id of ids) {
      const target = findNode(next, id)!, edited = describe(target, recommendation, properties);
      if ("error" in edited) return edited;
      next = { ...next, nodes: next.nodes.map(item => item.id === id ? edited.node : item) };
    }
  }
  // What it makes the brush react to is in its state machine too (the edits emit it).
  next = applyMachineChange(next, "machine" in preview ? preview.machine : null);
  try { next = sceneSchema.parse(next); } catch { return { error: "미리보기 값을 property로 넣지 못했습니다" }; }
  return { scene: next, generated: { ...generated, code: syncScene(program.code, next), sceneBindings: sceneBindings(next) } };
}

function describe(node: SceneNode, recommendation: Pick<Recommendation, "kind" | "targetId" | "title" | "detail">, properties: Property[]): { node: SceneNode } | { error: string } {
  const fresh = properties.filter(property => !nodeProperties(node).some(existing => existing.id === property.id));
  const changed = recommendation.kind === "transformation" ? findTransformation(node, recommendation.targetId) : undefined;
  if (changed) {
    if (changed.properties.length + fresh.length > MAX_PROPERTIES) return { error: "그 transformation에 property를 더 넣을 수 없습니다" };
    return { node: updateTransformation(node, changed.id, item => ({ ...item, description: `${item.description}\n${recommendation.title}: ${recommendation.detail}`.trim().slice(0, 1000), properties: [...item.properties, ...fresh] })) };
  }
  if (!fresh.length && recommendation.kind !== "add-transformation") return { node };
  if (node.transformations.length >= MAX_TRANSFORMATIONS) return { error: "노드에 transformation을 더 넣을 수 없습니다" };
  return { node: addTransformation(node, { label: recommendation.title.slice(0, 100), description: recommendation.detail.slice(0, 1000), properties: fresh.slice(0, MAX_PROPERTIES) }).node };
}
