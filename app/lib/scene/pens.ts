import { semanticPenSchema, type SemanticPen } from "../schema";
import type { Algorithm, AlgorithmCall, Scene } from "./schema";
import { algorithmClosure, algorithmRefs, findAlgorithm, importAlgorithms, instantiate, remapValue } from "./algorithms";
import { findNode } from "./graph";
import { findProperty } from "./transformations";
import { isAlgorithm, valueAt } from "./values";

export type PenSource = { nodeId: string; propertyId: string; path?: string[] } | { algorithmId: string };

/** Copy an algorithm (with its current arguments and dependencies) into a semantic pen. No AI call. */
export function makeAlgorithmPen(scene: Scene, source: PenSource, sourceSketchId: string, id: string, color: string): SemanticPen {
  const node = "nodeId" in source ? findNode(scene, source.nodeId) : undefined;
  const property = node && "propertyId" in source ? findProperty(node, source.propertyId) : undefined;
  const slot = property && valueAt(property.value, "path" in source ? source.path || [] : []);
  const call: AlgorithmCall | null = property ? (slot && isAlgorithm(slot) ? slot : null) : "algorithmId" in source ? instantiate(scene.algorithms, source.algorithmId) : null;
  if (!call) throw new Error("펜에는 알고리즘이 들어 있는 property만 담을 수 있습니다.");
  const algorithm = findAlgorithm(scene.algorithms, call.algorithmId)!;
  return semanticPenSchema.parse({
    id, name: `${algorithm.name} pen`.slice(0, 100), color, sourceSketchId,
    source: { nodeId: node?.id || "", label: (node ? `${node.name}${property ? ` · ${property.label}` : ""}` : algorithm.name).slice(0, 200) },
    meaning: algorithm.description.slice(0, 2000),
    algorithm: { call, library: algorithmClosure(scene.algorithms, algorithmRefs(call)) },
  });
}

/** The algorithm carried by a pen (none for the interaction pen). */
export const penAlgorithm = (pen: SemanticPen): { call: AlgorithmCall; library: Algorithm[] } | null => pen.kind === "interaction" ? null : pen.algorithm;

/** Insert an algorithm from a pen or another sketch, returning the remapped call. */
export function importAlgorithmCall(scene: Scene, source: { call: AlgorithmCall; library: Algorithm[] }) {
  const { library, ids } = importAlgorithms(scene.algorithms, algorithmClosure(source.library, algorithmRefs(source.call)));
  return { scene: { ...scene, algorithms: library }, call: remapValue(source.call, ids) as AlgorithmCall };
}
