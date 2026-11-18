import type { Scene, Constraint } from "./schema";
import { MAX_SCENE_NODES } from "./schema";
import { clampRegion, descendantIds, findNode, fitCollections, moveNodes, unionRegion, uniqueNodeId } from "./graph";
import { canTakeConstraint, findConstraint, takeConstraint } from "./constraints";
import { validateScene } from "./validate";

/**
 * Copy a collection/object with all its members and machines into
 * another scene, centred on `at` (normalized). Ids that already exist are renamed.
 */
/**
 * Copy a node with its members into another scene. Copies remember the node ids
 * their code module uses (`codeId`, `codeModule`), so they can run the source's
 * module without new code.
 */
export function transplantNodes(source: Scene, nodeId: string, target: Scene, at?: { x: number; y: number }): { scene: Scene; rootId: string; ids: Map<string, string> } {
  const root = findNode(source, nodeId);
  if (!root) throw new Error("Could not find the Collection or Object to move.");
  const subtree = [nodeId, ...descendantIds(source, nodeId)].map(id => findNode(source, id)!);
  if (target.nodes.length + subtree.length > MAX_SCENE_NODES) throw new Error(`A sketch can have at most ${MAX_SCENE_NODES} nodes.`);
  const nodeIds = new Map<string, string>();
  let scratch: Scene = { ...target, nodes: [...target.nodes] };
  for (const node of subtree) {
    const id = uniqueNodeId(scratch, node.id);
    nodeIds.set(node.id, id);
    scratch = { ...scratch, nodes: [...scratch.nodes, { ...node, id }] };
  }
  const copies = subtree.map(node => ({ ...node, id: nodeIds.get(node.id)!, parentId: node.id === nodeId ? null : nodeIds.get(node.parentId!)!, codeId: node.codeId ?? node.id,
    ...(node.id === nodeId ? { codeModule: node.codeModule ?? node.id } : { codeModule: undefined }) }));
  let scene: Scene = { nodes: [...target.nodes, ...copies] };
  const rootId = nodeIds.get(nodeId)!;
  if (at) {
    const bounds = unionRegion(copies.map(node => node.region))!;
    scene = moveNodes(scene, [rootId], at.x - (bounds.x + bounds.w / 2), at.y - (bounds.y + bounds.h / 2));
  }
  scene = fitCollections({ ...scene, nodes: scene.nodes.map(node => ({ ...node, region: clampRegion(node.region) })) });
  return { scene: validateScene(scene), rootId, ids: nodeIds };
}

/** Move a node (with its members) so its bounds are centred on `at`. */
export function moveNodeTo(scene: Scene, nodeId: string, at: { x: number; y: number }): Scene {
  const ids = [nodeId, ...descendantIds(scene, nodeId)];
  const bounds = unionRegion(scene.nodes.filter(node => ids.includes(node.id)).map(node => node.region));
  return bounds ? moveNodes(scene, [nodeId], at.x - (bounds.x + bounds.w / 2), at.y - (bounds.y + bounds.h / 2)) : scene;
}

export const NODE_DRAG_TYPE = "application/x-rulegen-node";
export type NodeDragPayload = { sketchId: string; nodeId: string };
export function readNodeDrag(data: DataTransfer): NodeDragPayload | null {
  try { const value = JSON.parse(data.getData(NODE_DRAG_TYPE)); return typeof value?.sketchId === "string" && typeof value?.nodeId === "string" ? value : null; } catch { return null; }
}

/** What "Copy" on a constraint in Layers puts on the studio clipboard: the constraint. */
export type ConstraintClip = { constraint: Constraint; label: string };
export function copyConstraint(scene: Scene, nodeId: string, constraintId: string): ConstraintClip {
  const node = findNode(scene, nodeId), constraint = node && findConstraint(node, constraintId);
  if (!constraint) throw new Error("Could not find the constraint to copy.");
  return { constraint: structuredClone(constraint), label: constraint.property || constraint.id };
}
/**
 * Paste a copied constraint into a node (of this sketch or another): after `afterId` (none: at the end), its ids made
 * unique in the node.
 */
export function pasteConstraint(scene: Scene, nodeId: string, clip: ConstraintClip, afterId?: string | null): Scene {
  const node = findNode(scene, nodeId);
  if (!node) throw new Error("Could not find where to paste.");
  if (!canTakeConstraint(node, clip.constraint)) throw new Error(`“${node.name}” has no room for “${clip.label}”.`);
  const copy = clip.constraint;
  const after = node.constraints.findIndex(item => item.id === afterId), before = after < 0 ? null : node.constraints[after + 1]?.id ?? null;
  const next = takeConstraint(node, copy, before);
  return validateScene({ ...scene, nodes: scene.nodes.map(item => item.id === nodeId ? next : item) });
}
