import { semanticPenSchema, type SemanticPen } from "../schema";
import type { Algorithm, AlgorithmCall, Scene } from "./schema";
import { algorithmClosure, algorithmRefs, findAlgorithm, importAlgorithms, instantiate, remapValue } from "./algorithms";
import { findNode } from "./graph";
import { findParam, findConstraint } from "./constraints";
import { isAlgorithm, valueAt } from "./values";

export type PenSource = { nodeId: string; paramId: string; path?: string[] } | { algorithmId: string };

/** Copy an algorithm (with its current arguments and dependencies) into a semantic pen. No AI call. */
export function makeAlgorithmPen(scene: Scene, source: PenSource, sourceSketchId: string, id: string, color: string): SemanticPen {
  const node = "nodeId" in source ? findNode(scene, source.nodeId) : undefined;
  const param = node && "paramId" in source ? findParam(node, source.paramId) : undefined;
  const slot = param && valueAt(param.value, "path" in source ? source.path || [] : []);
  const call: AlgorithmCall | null = param ? (slot && isAlgorithm(slot) ? slot : null) : "algorithmId" in source ? instantiate(scene.algorithms, source.algorithmId) : null;
  if (!call) throw new Error("A pen can only hold a param that contains an algorithm.");
  const algorithm = findAlgorithm(scene.algorithms, call.algorithmId)!;
  return semanticPenSchema.parse({
    id, name: `${algorithm.name} pen`.slice(0, 100), color, sourceSketchId,
    source: { nodeId: node?.id || "", label: (node ? `${node.name}${param ? ` · ${param.label}` : ""}` : algorithm.name).slice(0, 200) },
    meaning: algorithm.description.slice(0, 2000),
    algorithm: { call, library: algorithmClosure(scene.algorithms, algorithmRefs(call)) },
  });
}

/** Copy a node's constraint (its params as they are, and the algorithms they use) into a pen. No AI call. */
export function makeConstraintPen(scene: Scene, nodeId: string, constraintId: string, sourceSketchId: string, id: string, color: string): SemanticPen {
  const node = findNode(scene, nodeId), constraint = node && findConstraint(node, constraintId);
  if (!node || !constraint) throw new Error("Could not find the constraint to put in the pen.");
  const refs = constraint.params.flatMap(param => algorithmRefs(param.value));
  return semanticPenSchema.parse({
    kind: "constraint", id, name: `${constraint.property || "Constraint"} pen`.slice(0, 100), color, sourceSketchId,
    source: { nodeId: node.id, label: `${node.name} · ${constraint.property}`.slice(0, 200) },
    meaning: (constraint.description || constraint.property).slice(0, 2000),
    constraint: { label: constraint.property, description: constraint.description, params: structuredClone(constraint.params).map(({ handle: _handle, ...param }) => param).slice(0, 12), library: algorithmClosure(scene.algorithms, refs).slice(0, 24) },
  });
}

/** The algorithm carried by a pen (none for the interaction pen). */
export const penAlgorithm = (pen: SemanticPen): { call: AlgorithmCall; library: Algorithm[] } | null => pen.kind === "algorithm" ? pen.algorithm : null;

/** Insert an algorithm from a pen or another sketch, returning the remapped call. */
export function importAlgorithmCall(scene: Scene, source: { call: AlgorithmCall; library: Algorithm[] }) {
  const { library, ids } = importAlgorithms(scene.algorithms, algorithmClosure(source.library, algorithmRefs(source.call)));
  return { scene: { ...scene, algorithms: library }, call: remapValue(source.call, ids) as AlgorithmCall };
}
