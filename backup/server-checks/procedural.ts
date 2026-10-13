import type { Algorithm, Property, Region, Scene, SceneNode } from "./schema";
import { MAX_NODE_PROPERTIES } from "./schema";
import { addTransformation, canAddTransformation, nodeProperties, uniquePropertyId } from "./transformations";
import { findAlgorithm, uniqueAlgorithmId } from "./algorithms";
import { childrenOf, fitCollections, removeNodes, unionRegion, updateNode } from "./graph";
import { valueShape } from "./values";

// Procedural economy: elements that share their features are ONE node whose
// semantic transformation generates the instances, never one node per instance.
// `repeatedSiblings` finds violations; `collapseRepeats` fixes them deterministically.

/** "The same kind of thing": kind, primitive, property effects/structures (ids and values ignored) and children. */
export function nodeFingerprint(scene: Scene, node: SceneNode): string {
  const properties = nodeProperties(node).map(property => `${property.effect}:${valueShape(property.value)}`).sort();
  const children = childrenOf(scene, node.id).map(child => nodeFingerprint(scene, child)).sort();
  return JSON.stringify([node.kind, node.primitive.trim().toLowerCase(), properties, children]);
}
/** A name without instance numbering: "Petal 3" and "petal-1" → "petal". */
export const nameStem = (name: string) => name.toLowerCase().replace(/[#№()[\]_\-.,:]+/g, " ").replace(/\d+/g, " ").replace(/\s+/g, " ").trim();

export type RepeatGroup = { parentId: string | null; ids: string[]; names: string[] };
/**
 * Sibling groups that should be one procedural node: three or more structurally
 * identical siblings, or two that differ only by numbering. Nodes with their own
 * state machine stay separate (they need independent states).
 * `among` limits the result to groups touching those node ids (e.g. newly added ones).
 */
export function repeatedSiblings(scene: Scene, among?: Set<string>): RepeatGroup[] {
  const groups = new Map<string, SceneNode[]>();
  for (const node of scene.nodes) {
    if (node.machine) continue;
    const key = JSON.stringify([node.parentId, nodeFingerprint(scene, node)]);
    groups.set(key, [...(groups.get(key) || []), node]);
  }
  return [...groups.values()].filter(nodes => (nodes.length >= 3 || (nodes.length === 2 && nameStem(nodes[0].name) === nameStem(nodes[1].name) && Boolean(nameStem(nodes[0].name))))
    && (!among || nodes.some(node => among.has(node.id))))
    .map(nodes => ({ parentId: nodes[0].parentId, ids: nodes.map(node => node.id), names: nodes.map(node => node.name) }));
}

/** Feedback for the model when its scene enumerates instances instead of generating them. */
export function repeatFeedback(groups: RepeatGroup[]) {
  return [
    "PROCEDURAL ECONOMY VIOLATION. Your scene lists repeated elements as separate nodes:",
    ...groups.map(group => `- ${group.names.join(", ")} (ids: ${group.ids.join(", ")})`),
    "Rewrite the COMPLETE response. Replace each group by ONE node (object, or collection if the instances have parts) whose region covers all instances and one of whose semantic transformations generates them procedurally: a count property plus a distribution/layout algorithm (row, grid, radial, scatter, along-path, recursive …) and algorithm-driven variation (size, rotation, color, phase over the instance index or noise). Reuse shared algorithms by id. Keep every other node as it was.",
  ].join("\n");
}

const REPEAT_ALGORITHM: Algorithm = {
  id: "repeat-layout", name: "Repeat layout",
  description: "노드 region 안에 count개의 인스턴스를 arrangement에 따라 배치하고, 각 인스턴스는 노드의 나머지 property로 똑같이 그립니다. row: 왼쪽에서 오른쪽으로 spacing(px) 간격, column: 위에서 아래로 spacing 간격, grid: ceil(sqrt(count))열 격자에 spacing 간격, radial: region 중심에서 반지름 spacing인 원 위에 균등한 각도, scatter: 고정 seed로 region 안에 서로 최소 spacing 떨어지게 흩뿌림. size는 인스턴스 하나의 크기(px), jitter는 각 인스턴스 위치를 seed 기반 무작위로 흔드는 최대 거리(px)입니다.",
  params: [
    { id: "count", label: "Count", description: "인스턴스 수", value: { type: "number", value: 3, min: 1, max: 24, step: 1, unit: "" } },
    { id: "arrangement", label: "Arrangement", description: "배치 방식", value: { type: "select", value: "row", options: ["row", "column", "grid", "radial", "scatter"] } },
    { id: "spacing", label: "Spacing", description: "간격 또는 반지름(px)", value: { type: "number", value: 60, min: 0, max: 600, step: 1, unit: "px" } },
    { id: "size", label: "Size", description: "인스턴스 크기(px)", value: { type: "number", value: 40, min: 2, max: 600, step: 1, unit: "px" } },
    { id: "jitter", label: "Jitter", description: "위치 흔들림(px)", value: { type: "number", value: 0, min: 0, max: 120, step: 1, unit: "px" } },
  ],
};

const px = (region: Region) => ({ x: (region.x + region.w / 2) * 900, y: (region.y + region.h / 2) * 600, size: Math.max(region.w * 900, region.h * 600) });
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
const clampNumber = (value: number, min: number, max: number) => Math.round(Math.max(min, Math.min(max, value)));

/** Infer how the observed instances are laid out. */
export function inferLayout(regions: Region[]) {
  const points = regions.map(px), xs = points.map(p => p.x), ys = points.map(p => p.y);
  const spanX = Math.max(...xs) - Math.min(...xs), spanY = Math.max(...ys) - Math.min(...ys);
  const size = clampNumber(mean(points.map(p => p.size)), 2, 600);
  const gaps = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); return mean(sorted.slice(1).map((value, i) => value - sorted[i])); };
  if (spanY <= spanX * .25) return { arrangement: "row", spacing: clampNumber(gaps(xs), 0, 600), size };
  if (spanX <= spanY * .25) return { arrangement: "column", spacing: clampNumber(gaps(ys), 0, 600), size };
  const center = { x: mean(xs), y: mean(ys) }, distances = points.map(p => Math.hypot(p.x - center.x, p.y - center.y)), radius = mean(distances);
  const spread = Math.sqrt(mean(distances.map(d => (d - radius) ** 2)));
  if (points.length >= 3 && radius > 0 && spread / radius < .25) return { arrangement: "radial", spacing: clampNumber(radius, 0, 600), size };
  return { arrangement: "scatter", spacing: clampNumber(Math.sqrt(spanX * spanY / points.length), 0, 600), size };
}

/** Replace every repeated group by its first node, generating the instances with `repeat-layout`. */
export function collapseRepeats(scene: Scene, groups = repeatedSiblings(scene)): Scene {
  let next = scene;
  for (const group of groups) {
    const nodes = group.ids.map(id => next.nodes.find(node => node.id === id)).filter((node): node is SceneNode => Boolean(node));
    const keeper = nodes[0];
    if (nodes.length < 2 || !canAddTransformation(keeper) || nodeProperties(keeper).length >= MAX_NODE_PROPERTIES) continue;
    let algorithmId = REPEAT_ALGORITHM.id;
    const existing = findAlgorithm(next.algorithms, algorithmId);
    if (existing && JSON.stringify(existing) !== JSON.stringify(REPEAT_ALGORITHM)) algorithmId = uniqueAlgorithmId(next.algorithms, REPEAT_ALGORITHM.id);
    if (!findAlgorithm(next.algorithms, algorithmId)) next = { ...next, algorithms: [...next.algorithms, { ...REPEAT_ALGORITHM, id: algorithmId }] };
    const layout = inferLayout(nodes.map(node => node.region)), count = nodes.length;
    const repeat: Property = { id: uniquePropertyId(keeper, "repeat"), label: "Repeat", effect: "spatial", description: `${count}개 인스턴스의 배치`, value: { type: "algorithm", algorithmId, args: [
      { id: "count", value: { type: "number", value: count, min: 1, max: Math.max(24, count * 3), step: 1, unit: "" } },
      { id: "arrangement", value: { type: "select", value: layout.arrangement, options: ["row", "column", "grid", "radial", "scatter"] } },
      { id: "spacing", value: { type: "number", value: layout.spacing, min: 0, max: 600, step: 1, unit: "px" } },
      { id: "size", value: { type: "number", value: layout.size, min: 2, max: 600, step: 1, unit: "px" } },
      { id: "jitter", value: { type: "number", value: 0, min: 0, max: 120, step: 1, unit: "px" } },
    ] } };
    const stem = keeper.name.replace(/[\s#№_-]*\d+\s*$/, "").trim() || keeper.name;
    const region = unionRegion(nodes.map(node => node.region))!;
    next = removeNodes(next, nodes.slice(1).map(node => node.id));
    next = updateNode(next, keeper.id, node => ({ ...node, region, name: `${stem} ×${count}`.slice(0, 100),
      description: `${node.description} (${count}개를 하나의 procedural 노드로 생성)`.trim().slice(0, 600),
      // Repetition is its own semantic transformation, stacked last: it repeats the styled unit.
      transformations: addTransformation(node, { id: "repetition", label: "Repetition", description: `노드를 ${count}개 인스턴스로 반복 배치합니다.`, properties: [repeat] }).node.transformations }));
  }
  return fitCollections(next);
}
