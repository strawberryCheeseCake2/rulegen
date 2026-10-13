import type { Region, Scene, SceneNode } from "./schema";

export const findNode = (scene: Scene, id: string | null | undefined) => scene.nodes.find(node => node.id === id);
export const childrenOf = (scene: Scene, parentId: string | null) => scene.nodes.filter(node => node.parentId === parentId);

export function descendantIds(scene: Scene, id: string): string[] {
  const result: string[] = [];
  const visit = (parent: string) => { for (const child of childrenOf(scene, parent)) { result.push(child.id); visit(child.id); } };
  visit(id); return result;
}
export function ancestorIds(scene: Scene, id: string): string[] {
  const result: string[] = [];
  let parent = findNode(scene, id)?.parentId;
  while (parent && !result.includes(parent)) { result.push(parent); parent = findNode(scene, parent)?.parentId; }
  return result;
}

/** Depth-first layer order, as shown in the layer panel. */
export function layerTree(scene: Scene) {
  const rows: { node: SceneNode; depth: number }[] = [];
  const visit = (parentId: string | null, depth: number) => { for (const node of childrenOf(scene, parentId)) { rows.push({ node, depth }); visit(node.id, depth + 1); } };
  visit(null, 0); return rows;
}

/** Layer level of a node: 1 at the root. */
export const nodeLevel = (scene: Scene, id: string) => ancestorIds(scene, id).length + 1;
/** Deepest layer level in the scene (0 when empty). */
export const sceneDepth = (scene: Scene) => Math.max(0, ...layerTree(scene).map(row => row.depth + 1));
/** Re-attach nodes nested deeper than `max` levels to their ancestor at level max-1. */
export function clampNesting(scene: Scene, max: number): Scene {
  return { ...scene, nodes: scene.nodes.map(node => {
    const ancestors = ancestorIds(scene, node.id);
    return ancestors.length + 1 > max ? { ...node, parentId: ancestors[ancestors.length - (max - 1)] } : node;
  }) };
}

export function unionRegion(regions: Region[]): Region | null {
  if (!regions.length) return null;
  const x = Math.min(...regions.map(r => r.x)), y = Math.min(...regions.map(r => r.y));
  const right = Math.max(...regions.map(r => r.x + r.w)), bottom = Math.max(...regions.map(r => r.y + r.h));
  return clampRegion({ x, y, w: right - x, h: bottom - y });
}
export function clampRegion(region: Region): Region {
  const w = Math.max(.01, Math.min(1, region.w)), h = Math.max(.01, Math.min(1, region.h));
  const round = (value: number) => Number(value.toFixed(5));
  return { x: round(Math.max(0, Math.min(1 - w, region.x))), y: round(Math.max(0, Math.min(1 - h, region.y))), w: round(w), h: round(h) };
}

/** Collections enclose their children, from the deepest level upwards. */
export function fitCollections(scene: Scene): Scene {
  const byDepth = [...layerTree(scene)].sort((a, b) => b.depth - a.depth);
  let nodes = scene.nodes;
  for (const { node } of byDepth) {
    if (node.kind !== "collection") continue;
    const children = nodes.filter(child => child.parentId === node.id).map(child => child.region);
    if (!children.length) continue;
    // A collection keeps its own extent (e.g. drawn branches) and grows to contain its members.
    const own = nodes.find(item => item.id === node.id)!.region;
    const region = unionRegion([own, ...children])!;
    if (JSON.stringify(region) !== JSON.stringify(own)) nodes = nodes.map(item => item.id === node.id ? { ...item, region } : item);
  }
  return { ...scene, nodes };
}

/** Topmost selected nodes: a selected descendant moves with its selected ancestor. */
export function selectionRoots(scene: Scene, ids: string[]) {
  return ids.filter(id => findNode(scene, id) && !ancestorIds(scene, id).some(ancestor => ids.includes(ancestor)));
}

export function moveNodes(scene: Scene, ids: string[], dx: number, dy: number): Scene {
  const roots = selectionRoots(scene, ids);
  const moving = new Set(roots.flatMap(id => [id, ...descendantIds(scene, id)]));
  if (!moving.size) return scene;
  // Move the selection as one rigid group so it stays inside the canvas together.
  const bounds = unionRegion(scene.nodes.filter(node => moving.has(node.id)).map(node => node.region))!;
  const sx = Math.max(-bounds.x, Math.min(1 - bounds.x - bounds.w, dx)), sy = Math.max(-bounds.y, Math.min(1 - bounds.y - bounds.h, dy));
  return fitCollections({ ...scene, nodes: scene.nodes.map(node => moving.has(node.id) ? { ...node, region: clampRegion({ ...node.region, x: node.region.x + sx, y: node.region.y + sy }) } : node) });
}

export function setParent(scene: Scene, id: string, parentId: string | null, beforeId?: string | null): Scene {
  const node = findNode(scene, id);
  if (!node || id === parentId) return scene;
  if (parentId && (findNode(scene, parentId)?.kind !== "collection" || descendantIds(scene, id).includes(parentId))) return scene;
  const rest = scene.nodes.filter(item => item.id !== id), moved = { ...node, parentId };
  let index = beforeId ? rest.findIndex(item => item.id === beforeId) : -1;
  if (index < 0) { const siblings = rest.map((item, i) => [item, i] as const).filter(([item]) => item.parentId === parentId); index = siblings.length ? siblings[siblings.length - 1][1] + 1 : parentId ? rest.findIndex(item => item.id === parentId) + 1 : rest.length; }
  return fitCollections({ ...scene, nodes: [...rest.slice(0, index), moved, ...rest.slice(index)] });
}

export function reorderNode(scene: Scene, id: string, direction: -1 | 1): Scene {
  const node = findNode(scene, id); if (!node) return scene;
  const siblings = childrenOf(scene, node.parentId), index = siblings.findIndex(item => item.id === id), target = siblings[index + direction];
  if (!target) return scene;
  if (direction < 0) return setParent(scene, id, node.parentId, target.id);
  const after = siblings[index + 2];
  return setParent(scene, id, node.parentId, after?.id ?? null);
}

export function groupNodes(scene: Scene, ids: string[], id: string, name = "Collection"): Scene {
  const roots = selectionRoots(scene, ids);
  if (!roots.length) return scene;
  const first = findNode(scene, roots[0])!;
  // Group into the shared parent when possible, as layer editors do.
  const parentId = roots.every(rootId => findNode(scene, rootId)!.parentId === first.parentId) ? first.parentId : null;
  const region = unionRegion(roots.map(rootId => findNode(scene, rootId)!.region))!;
  const collection: SceneNode = { id, kind: "collection", parentId, name, description: "", primitive: "group", region, transformations: [], visible: true, machine: null };
  const index = scene.nodes.findIndex(node => node.id === first.id);
  const nodes = scene.nodes.map(node => roots.includes(node.id) ? { ...node, parentId: id } : node);
  return fitCollections({ ...scene, nodes: [...nodes.slice(0, index), collection, ...nodes.slice(index)] });
}

export function ungroupNode(scene: Scene, id: string): Scene {
  const node = findNode(scene, id);
  if (!node || node.kind !== "collection") return scene;
  return fitCollections({ ...scene, nodes: scene.nodes.filter(item => item.id !== id).map(item => item.parentId === id ? { ...item, parentId: node.parentId } : item) });
}

export function removeNodes(scene: Scene, ids: string[]): Scene {
  const removed = new Set(ids.flatMap(id => [id, ...descendantIds(scene, id)]));
  return fitCollections({ ...scene, nodes: scene.nodes.filter(node => !removed.has(node.id)) });
}

export function updateNode(scene: Scene, id: string, edit: (node: SceneNode) => SceneNode): Scene {
  return { ...scene, nodes: scene.nodes.map(node => node.id === id ? edit(node) : node) };
}

export function uniqueNodeId(scene: Scene, base: string) {
  const root = base.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "").slice(0, 70) || "node";
  let id = root, suffix = 2;
  while (findNode(scene, id)) id = `${root}-${suffix++}`;
  return id;
}

/** Figma-like click: select the outermost unselected level containing the hit node. */
export function clickTarget(scene: Scene, hitId: string, selected: string[]) {
  const chain = [...ancestorIds(scene, hitId).reverse(), hitId];
  let deepestSelected = -1;
  chain.forEach((id, index) => { if (selected.includes(id)) deepestSelected = index; });
  return chain[Math.min(chain.length - 1, deepestSelected + 1)];
}

/** The given nodes with all descendants, re-rooted, for requests about part of a scene. */
export function subScene(scene: Scene, ids: string[]): Scene {
  const keep = new Set(ids.flatMap(id => [id, ...descendantIds(scene, id)]));
  return { algorithms: scene.algorithms, nodes: scene.nodes.filter(node => keep.has(node.id)).map(node => node.parentId && !keep.has(node.parentId) ? { ...node, parentId: null } : node) };
}
