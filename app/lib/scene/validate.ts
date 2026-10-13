import { z } from "zod";
import { MAX_NESTING_DEPTH, MAX_NODE_PROPERTIES, sceneShapeSchema, type Scene } from "./schema";
import { nodeProperties } from "./transformations";
import { validateAlgorithms, validateCall } from "./algorithms";
import { ancestorIds, findNode, sceneDepth } from "./graph";
import { validateMachine } from "./machines";
import { scalarProblem, valueLeaves } from "./values";

/** Structural rules zod cannot express: hierarchy, references, ranges and machines. */
export function validateScene(scene: Scene) {
  const ids = scene.nodes.map(node => node.id);
  if (new Set(ids).size !== ids.length) throw new Error("Collection/Object ID가 중복되었습니다.");
  validateAlgorithms(scene.algorithms);
  if (sceneDepth(scene) > MAX_NESTING_DEPTH) throw new Error(`Collection은 ${MAX_NESTING_DEPTH}단계까지만 중첩할 수 있습니다.`);
  for (const node of scene.nodes) {
    if (node.parentId) {
      const parent = findNode(scene, node.parentId);
      if (!parent || parent.kind !== "collection") throw new Error(`${node.name}의 상위 Collection을 찾지 못했습니다.`);
      if (ancestorIds(scene, node.id).includes(node.id)) throw new Error("Collection이 자기 자신을 포함합니다.");
    }
    const transformations = node.transformations.map(transformation => transformation.id);
    if (new Set(transformations).size !== transformations.length) throw new Error(`${node.name}의 semantic transformation ID가 중복되었습니다.`);
    const properties = nodeProperties(node).map(property => property.id);
    if (new Set(properties).size !== properties.length) throw new Error(`${node.name}의 property ID가 중복되었습니다.`);
    if (properties.length > MAX_NODE_PROPERTIES) throw new Error(`${node.name}에는 property를 ${MAX_NODE_PROPERTIES}개까지 둘 수 있습니다.`);
    for (const property of nodeProperties(node)) {
      validateCall(scene.algorithms, property.value);
      for (const leaf of valueLeaves(property.value)) { const problem = scalarProblem(leaf.value); if (problem) throw new Error(`${node.name} · ${property.label}: ${problem}`); }
    }
    if (node.machine) {
      validateMachine(node, node.machine);
      for (const state of node.machine.states) for (const item of state.values) for (const leaf of valueLeaves(item.value)) { const problem = scalarProblem(leaf.value); if (problem) throw new Error(`${node.name} · ${state.label}: ${problem}`); }
    }
  }
  return scene;
}

/** Saved-project schema: shape plus structural validation. */
export const sceneSchema = sceneShapeSchema.superRefine((scene, ctx) => {
  try { validateScene(scene); } catch (error) { ctx.addIssue({ code: "custom", message: (error as Error).message }); }
});

/** An AI suggestion the user reviews before it replaces the scene. */
export const sceneProposalSchema = z.object({ summary: z.string().min(1).max(1500), scene: sceneSchema });
