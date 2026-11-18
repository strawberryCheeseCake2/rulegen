import { semanticPenSchema, type SemanticPen } from "../schema";
import type { Scene } from "./schema";
import { findNode } from "./graph";
import { findConstraint } from "./constraints";

/** Copy a node's constraint (its params as they are) into a pen. No AI call. */
export function makeConstraintPen(scene: Scene, nodeId: string, constraintId: string, sourceSketchId: string, id: string, color: string): SemanticPen {
  const node = findNode(scene, nodeId), constraint = node && findConstraint(node, constraintId);
  if (!node || !constraint) throw new Error("Could not find the constraint to put in the pen.");
  return semanticPenSchema.parse({
    kind: "constraint", id, name: `${constraint.property || "Constraint"} pen`.slice(0, 100), color, sourceSketchId,
    source: { nodeId: node.id, label: `${node.name} · ${constraint.property}`.slice(0, 200) },
    meaning: (constraint.description || constraint.property).slice(0, 2000),
    constraint: { label: constraint.property, description: constraint.description, params: structuredClone(constraint.params).map(({ handle: _handle, ...param }) => param).slice(0, 12) },
  });
}
