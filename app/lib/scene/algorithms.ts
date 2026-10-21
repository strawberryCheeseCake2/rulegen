import { MAX_VALUE_DEPTH, type Algorithm, type AlgorithmCall, type Scene, type Value } from "./schema";
import { nodeProperties } from "./transformations";
import { isAlgorithm } from "./values";

export const findAlgorithm = (library: Algorithm[], id: string) => library.find(algorithm => algorithm.id === id);

/** A new call of an algorithm using its parameter defaults (recursively). */
export function instantiate(library: Algorithm[], algorithmId: string, depth = 1, stack: string[] = []): AlgorithmCall {
  const algorithm = findAlgorithm(library, algorithmId);
  if (!algorithm) throw new Error(`알고리즘 ${algorithmId}을 찾지 못했습니다.`);
  if (stack.includes(algorithmId)) throw new Error("알고리즘이 자기 자신을 파라미터로 참조합니다.");
  if (depth > MAX_VALUE_DEPTH) throw new Error(`알고리즘은 최대 ${MAX_VALUE_DEPTH}단계까지 중첩할 수 있습니다.`);
  return { type: "algorithm", algorithmId, args: algorithm.params.map(param => ({ id: param.id, value: isAlgorithm(param.value) ? instantiate(library, param.value.algorithmId, depth + 1, [...stack, algorithmId]) : structuredClone(param.value) })) };
}

export function algorithmRefs(value: Value): string[] {
  return isAlgorithm(value) ? [value.algorithmId, ...value.args.flatMap(arg => algorithmRefs(arg.value))] : [];
}
/** Definitions needed to evaluate the given ids, including those referenced by defaults. */
export function algorithmClosure(library: Algorithm[], ids: string[]): Algorithm[] {
  const wanted = new Set<string>(), queue = [...ids];
  while (queue.length) {
    const id = queue.pop()!;
    if (wanted.has(id)) continue;
    const algorithm = findAlgorithm(library, id);
    if (!algorithm) continue;
    wanted.add(id);
    queue.push(...algorithm.params.flatMap(param => algorithmRefs(param.value)));
  }
  return library.filter(algorithm => wanted.has(algorithm.id));
}

export function sceneAlgorithmUsage(scene: Scene) {
  const usage = new Map<string, { nodeId: string; propertyId: string }[]>();
  for (const node of scene.nodes) for (const property of nodeProperties(node)) {
    const refs = new Set([property.value, ...(node.machine?.states.flatMap(state => state.values.filter(item => item.propertyId === property.id).map(item => item.value)) || [])].flatMap(algorithmRefs));
    for (const id of refs) usage.set(id, [...(usage.get(id) || []), { nodeId: node.id, propertyId: property.id }]);
  }
  return usage;
}

export function remapValue(value: Value, ids: Map<string, string>): Value {
  return isAlgorithm(value) ? { ...value, algorithmId: ids.get(value.algorithmId) || value.algorithmId, args: value.args.map(arg => ({ ...arg, value: remapValue(arg.value, ids) })) } : value;
}

/**
 * Bring definitions from another sketch or a pen into a library. Identical
 * definitions are reused; colliding ids with different content are renamed.
 */
export function importAlgorithms(library: Algorithm[], incoming: Algorithm[]) {
  const ids = new Map<string, string>(), taken = new Set(library.map(algorithm => algorithm.id));
  for (const algorithm of incoming) {
    const same = findAlgorithm(library, algorithm.id);
    if (same && JSON.stringify(same) === JSON.stringify(algorithm)) { ids.set(algorithm.id, algorithm.id); continue; }
    let id = algorithm.id, suffix = 2;
    while (taken.has(id)) id = `${algorithm.id.slice(0, 72)}-${suffix++}`;
    taken.add(id); ids.set(algorithm.id, id);
  }
  const added = incoming.filter(algorithm => !(findAlgorithm(library, algorithm.id) && ids.get(algorithm.id) === algorithm.id))
    .map(algorithm => ({ ...algorithm, id: ids.get(algorithm.id)!, params: algorithm.params.map(param => ({ ...param, value: remapValue(param.value, ids) })) }));
  return { library: [...library, ...added], ids };
}

/** Reject dangling references, mismatched arguments and self-referencing defaults. */
export function validateAlgorithms(library: Algorithm[]) {
  const ids = library.map(algorithm => algorithm.id);
  if (new Set(ids).size !== ids.length) throw new Error("알고리즘 ID가 중복되었습니다.");
  for (const algorithm of library) {
    const params = algorithm.params.map(param => param.id);
    if (new Set(params).size !== params.length) throw new Error(`${algorithm.name}의 파라미터 ID가 중복되었습니다.`);
    for (const param of algorithm.params) validateCall(library, param.value);
    instantiate(library, algorithm.id);
  }
}
export function validateCall(library: Algorithm[], value: Value, depth = 0) {
  if (!isAlgorithm(value)) return;
  if (depth >= MAX_VALUE_DEPTH) throw new Error(`알고리즘은 최대 ${MAX_VALUE_DEPTH}단계까지 중첩할 수 있습니다.`);
  const algorithm = findAlgorithm(library, value.algorithmId);
  if (!algorithm) throw new Error(`알고리즘 ${value.algorithmId}을 라이브러리에서 찾지 못했습니다.`);
  const args = value.args.map(arg => arg.id);
  if (new Set(args).size !== args.length || args.length !== algorithm.params.length || algorithm.params.some(param => !args.includes(param.id))) throw new Error(`${algorithm.name}의 인자가 정의와 맞지 않습니다.`);
  for (const arg of value.args) validateCall(library, arg.value, depth + 1);
}

/** Put arguments in definition order and fill missing ones from defaults. */
export function normalizeCall(library: Algorithm[], value: Value, depth = 1): Value {
  if (!isAlgorithm(value)) return value;
  const algorithm = findAlgorithm(library, value.algorithmId);
  if (!algorithm) return value;
  return { ...value, args: algorithm.params.map(param => {
    const arg = value.args.find(item => item.id === param.id);
    return { id: param.id, value: arg ? normalizeCall(library, arg.value, depth + 1) : isAlgorithm(param.value) ? instantiate(library, param.value.algorithmId, depth + 1) : structuredClone(param.value) };
  }) };
}

export function uniqueAlgorithmId(library: Algorithm[], base: string) {
  const root = base.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "").slice(0, 70) || "algorithm";
  let id = root, suffix = 2;
  while (findAlgorithm(library, id)) id = `${root}-${suffix++}`;
  return id;
}

/** Insert an algorithm from another sketch, returning the remapped call. */
export function importAlgorithmCall(scene: Scene, source: { call: AlgorithmCall; library: Algorithm[] }) {
  const { library, ids } = importAlgorithms(scene.algorithms, algorithmClosure(source.library, algorithmRefs(source.call)));
  return { scene: { ...scene, algorithms: library }, call: remapValue(source.call, ids) as AlgorithmCall };
}
