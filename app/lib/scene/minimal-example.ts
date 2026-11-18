import { ART_HEIGHT, ART_WIDTH } from "../schema";
import { algorithmClosure, algorithmRefs } from "./algorithms";
import { descendantIds, findNode } from "./graph";
import type { Region, Scene, SceneNode } from "./schema";
import { findConstraint } from "./constraints";
import { stateConstraints } from "./machines";

// A minimal example is an ordinary sketch frame with one collection and one
// object, carrying only the chosen constraint (no machines): a
// collection's constraint acts on one plain member object, an object's
// constraint sits on the object inside a plain collection.
//
// Decompose goes one level at a time: a frame splits into its nodes, a node into
// its own constraints (as one group) and its child nodes (each whole, with their
// constraints and their own children), a group or a leaf object into its single
// constraints, and a single constraint into the algorithms inside it (AI).

/** What an example frame shows: one constraint, a node's own constraints together, or a node with everything below it. */
export type ExampleScope = "constraint" | "constraints" | "node";
export type ExampleTarget = { nodeId: string; scope: ExampleScope; constraintId: string };

/** The constraints a node runs in its base state (its machine's initial state; all of them without a machine). */
export const baseConstraints = (node: SceneNode) => stateConstraints(node, node.machine?.initialState);
const tunable = (node: SceneNode) => baseConstraints(node).filter(item => item.params.length);

/** The largest box with the node's on-screen aspect that fits the middle of the frame. */
function centered(region: Region): Region {
  const aspect = (region.w * ART_WIDTH) / (region.h * ART_HEIGHT);
  const maxW = .6, maxH = .7;
  let w = maxW, h = (w * ART_WIDTH) / aspect / ART_HEIGHT;
  if (h > maxH) { h = maxH; w = (h * ART_HEIGHT * aspect) / ART_WIDTH; }
  return { x: (1 - w) / 2, y: (1 - h) / 2, w: Math.max(.05, w), h: Math.max(.05, h) };
}

/** Where `child` sits inside `parent`, carried over to `next` (the parent's new box). */
function within(child: Region, parent: Region, next: Region): Region {
  const rx = (child.x - parent.x) / parent.w, ry = (child.y - parent.y) / parent.h;
  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
  const w = clamp(child.w / parent.w * next.w, .02, next.w), h = clamp(child.h / parent.h * next.h, .02, next.h);
  return { x: clamp(next.x + rx * next.w, next.x, next.x + next.w - w), y: clamp(next.y + ry * next.h, next.y, next.y + next.h - h), w, h };
}

export function minimalExampleScene(scene: Scene, nodeId: string, constraintId: string): Scene {
  const node = findNode(scene, nodeId), constraint = node && findConstraint(node, constraintId);
  if (!node || !constraint) throw new Error("Could not find the Constraint.");
  const region = centered(node.region);
  const main: SceneNode = { ...node, parentId: null, region, visible: true, machine: null, constraints: [structuredClone(constraint)] };
  const nodes = [main];
  if (node.kind === "object") {
    const id = node.id === "collection" ? "example-collection" : "collection";
    nodes.unshift({ id, kind: "collection", parentId: null, name: `${node.name} collection`, description: "", primitive: "group", region, constraints: [], visible: true, machine: null });
    main.parentId = id;
  } else {
    // One plain member: the first object below it (or the first child), without its own constraints.
    const below = descendantIds(scene, node.id).map(id => findNode(scene, id)!).filter(Boolean);
    const member = below.find(item => item.kind === "object") || below[0];
    if (member) nodes.push({ ...member, kind: "object", primitive: member.primitive || "shape", parentId: node.id, region: within(member.region, node.region, region), visible: true, machine: null, constraints: [] });
    else nodes.push({ id: node.id === "object" ? "example-object" : "object", kind: "object", parentId: node.id, name: "Object", description: "", primitive: "shape",
      region: { x: region.x + region.w * .4, y: region.y + region.h * .4, w: region.w * .2, h: region.h * .2 }, constraints: [], visible: true, machine: null });
  }
  const refs = constraint.params.flatMap(param => algorithmRefs(param.value));
  return { algorithms: algorithmClosure(scene.algorithms, refs), nodes };
}

/**
 * A node's own constraints together (one plain member under a collection), or the node with
 * everything below it as it is; both centered, in their base state, without machines.
 */
export function nodeExampleScene(scene: Scene, nodeId: string, scope: "constraints" | "node"): Scene {
  const node = findNode(scene, nodeId);
  if (!node) throw new Error("Could not find the node.");
  const region = centered(node.region), base = (item: SceneNode) => structuredClone(baseConstraints(item));
  const main: SceneNode = { ...node, parentId: null, region, visible: true, machine: null, constraints: base(node) };
  const below = descendantIds(scene, node.id).map(id => findNode(scene, id)!).filter(Boolean);
  let nodes: SceneNode[] = [main];
  if (scope === "node") nodes.push(...below.map(item => ({ ...item, region: within(item.region, node.region, region), visible: true, machine: null, constraints: base(item) })));
  else if (node.kind === "collection" || below.length) {
    const member = below.find(item => item.kind === "object" && item.parentId === node.id) || below.find(item => item.parentId === node.id);
    nodes.push(member ? { ...member, kind: "object", primitive: member.primitive || "shape", parentId: node.id, region: within(member.region, node.region, region), visible: true, machine: null, constraints: [] }
      : { id: node.id === "object" ? "example-object" : "object", kind: "object", parentId: node.id, name: "Object", description: "", primitive: "shape",
        region: { x: region.x + region.w * .4, y: region.y + region.h * .4, w: region.w * .2, h: region.h * .2 }, constraints: [], visible: true, machine: null });
  }
  if (node.kind === "object") {
    const id = nodes.some(item => item.id === "collection") ? "example-collection" : "collection";
    nodes = [{ id, kind: "collection", parentId: null, name: `${node.name} collection`, description: "", primitive: "group", region, constraints: [], visible: true, machine: null }, ...nodes];
    main.parentId = id;
  }
  const refs = nodes.flatMap(item => item.constraints.flatMap(constraint => constraint.params.flatMap(param => algorithmRefs(param.value))));
  return { algorithms: algorithmClosure(scene.algorithms, refs), nodes };
}

/** The scene of an example frame for a target. */
export const exampleScene = (scene: Scene, target: ExampleTarget) =>
  target.scope === "constraint" ? minimalExampleScene(scene, target.nodeId, target.constraintId) : nodeExampleScene(scene, target.nodeId, target.scope);

/**
 * The next level of a frame's decomposition, from what the frame shows (`shown`; null for an ordinary frame).
 * Empty when there is nothing below; one single constraint the frame already shows on its own means its
 * inner algorithms are next (that is the AI's split, not a frame of this kind).
 */
export function decomposeTargets(scene: Scene, shown: { nodeId: string; scope?: ExampleScope; constraintId: string } | null, keep: (node: SceneNode) => boolean = () => true): ExampleTarget[] {
  const single = (node: SceneNode) => tunable(node).map(item => ({ nodeId: node.id, scope: "constraint" as const, constraintId: item.id }));
  const parts = (node: SceneNode): ExampleTarget[] => {
    const children = scene.nodes.filter(item => item.parentId === node.id && keep(item));
    // A leaf object: its constraints one by one.
    if (!children.length && node.kind === "object") return single(node);
    const own = tunable(node);
    const group: ExampleTarget[] = own.length > 1 ? [{ nodeId: node.id, scope: "constraints", constraintId: "" }] : single(node);
    return [...group, ...children.filter(item => hasTunable(scene, item)).map(item => ({ nodeId: item.id, scope: "node" as const, constraintId: "" }))];
  };
  if (!shown) {
    const roots = scene.nodes.filter(node => !node.parentId && keep(node) && hasTunable(scene, node));
    // One root is the frame itself: go straight to its parts.
    return roots.length === 1 ? parts(roots[0]) : roots.map(node => ({ nodeId: node.id, scope: "node", constraintId: "" }));
  }
  const node = findNode(scene, shown.nodeId);
  if (!node) return [];
  if (shown.scope === "constraints") return single(node);
  if (shown.scope === "node") return parts(node);
  return [];
}
/** Whether a node or anything below it has a constraint with params. */
function hasTunable(scene: Scene, node: SceneNode) {
  return [node.id, ...descendantIds(scene, node.id)].some(id => { const item = findNode(scene, id); return Boolean(item && tunable(item).length); });
}
/** The name of what an example shows, for its frame and link. */
export function exampleLabel(node: SceneNode, scope: ExampleScope | undefined, constraintId: string) {
  if (scope === "node") return node.name || node.id;
  if (scope === "constraints") return `${node.name || node.id} constraints`;
  return findConstraint(node, constraintId)?.property || "Constraint";
}

/** The code instruction for a frame showing a node's constraints together or a whole node. */
export function nodeExampleInstruction(node: SceneNode, scope: "constraints" | "node") {
  const constraints = baseConstraints(node).map(item => `- ${item.property}: ${item.description}`).join("\n");
  return [
    scope === "node"
      ? `This frame is a decomposed part of a brush: the ${node.kind} "${node.name}" on its own, with everything below it and every constraint they have, as in the original.`
      : `This frame is a decomposed part of a brush: ONLY the constraints of the ${node.kind} "${node.name}" together, on ${node.kind === "collection" ? "a single plain, neutral member" : "the object drawn as a neutral instance of its primitive"}.`,
    constraints && `Its constraints:\n${constraints}`,
    "Whether it needs input: keep an interaction only where a constraint is ABOUT the input itself (what pressing, dragging, releasing or clicking does). Otherwise it must NOT need any input: where the original brush makes things from the user's input (a trail along a drag, stamps at clicks), make them here from a fixed sample laid out in the code (e.g. a gentle curve across the node's box), so the result is on the canvas from the first frame. The node descriptions describe the original brush; the part about an empty canvas waiting for input does not apply here.",
    "No background decoration or extra elements beyond these nodes. Keep it inside the node's box.",
  ].filter(Boolean).join("\n").slice(0, 2400);
}

/** The code instruction for a minimal example frame (given with every code generation of that frame). */
export function minimalExampleInstruction(node: SceneNode, constraintId: string) {
  const constraint = findConstraint(node, constraintId);
  if (!constraint) return "";
  return [
    `This frame is a minimal example for trying the constraint "${constraint.property}" of "${node.name}" on its own.`,
    constraint.description && `What it does: ${constraint.description}`,
    node.kind === "collection"
      ? "Draw the collection's single member as a plain, neutral shape and let ONLY this constraint decide how many instances there are and how they vary."
      : "Draw the object (inside its plain collection) as a neutral instance of its primitive and apply ONLY this constraint to it.",
    // Most constraints of an input-driven brush are not about the input: they must show without it.
    "Whether it needs input: only if this constraint is ABOUT the input itself (what pressing, dragging, releasing, clicking or a key does: emitting along a drag, freezing on release, following the pointer) keep exactly that interaction, since the user plays with this example as a brush. Otherwise it must NOT need any input: its effect is on the canvas from the first frame and stays there. Where the original brush makes things from the user's input (a trail along a drag, stamps at clicks), make them here from a fixed sample laid out in the code (e.g. a gentle curve across the node's box), without input handlers or m.history(). The node descriptions describe the original brush (e.g. that the canvas starts empty and things appear only after input); that part does not apply to this example.",
    "Make its effect obvious and every param's slider visibly change the result. No background decoration, extra elements, colors or motion that this constraint does not define. Keep it inside the node's box.",
  ].filter(Boolean).join("\n").slice(0, 2400);
}
