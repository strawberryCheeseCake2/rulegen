import { z } from "zod";
import { MAX_NESTING_DEPTH, MAX_NODE_PARAMS, sceneShapeSchema, type Scene } from "./schema";
import { nodeParams } from "./constraints";
import { ancestorIds, findNode, sceneDepth } from "./graph";
import { validateMachine } from "./machines";
import { scalarProblem, valueLeaves } from "./values";

/** Structural rules zod cannot express: hierarchy, references, ranges and machines. */
export function validateScene(scene: Scene) {
  const ids = scene.nodes.map(node => node.id);
  if (new Set(ids).size !== ids.length) throw new Error("Duplicate Collection/Object ID.");
  if (sceneDepth(scene) > MAX_NESTING_DEPTH) throw new Error(`Collections can be nested at most ${MAX_NESTING_DEPTH} levels deep.`);
  for (const node of scene.nodes) {
    if (node.parentId) {
      const parent = findNode(scene, node.parentId);
      if (!parent || parent.kind !== "collection") throw new Error(`Could not find the parent Collection of ${node.name}.`);
      if (ancestorIds(scene, node.id).includes(node.id)) throw new Error("A Collection contains itself.");
    }
    const constraints = node.constraints.map(constraint => constraint.id);
    if (new Set(constraints).size !== constraints.length) throw new Error(`${node.name} has duplicate constraint IDs.`);
    const params = nodeParams(node).map(param => param.id);
    if (new Set(params).size !== params.length) throw new Error(`${node.name} has duplicate param IDs.`);
    if (params.length > MAX_NODE_PARAMS) throw new Error(`${node.name} can have at most ${MAX_NODE_PARAMS} params.`);
    for (const param of nodeParams(node)) {
      for (const leaf of valueLeaves(param.value)) { const problem = scalarProblem(leaf.value); if (problem) throw new Error(`${node.name} · ${param.label}: ${problem}`); }
    }
    if (node.machine) validateMachine(node, node.machine);
  }
  return scene;
}

/** Saved-project schema: shape plus structural validation. */
export const sceneSchema = sceneShapeSchema.superRefine((scene, ctx) => {
  try { validateScene(scene); } catch (error) { ctx.addIssue({ code: "custom", message: (error as Error).message }); }
});

/** An AI suggestion the user reviews before it replaces the scene. */
export const sceneProposalSchema = z.object({ summary: z.string().min(1).max(1500), scene: sceneSchema });
