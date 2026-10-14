import { ART_HEIGHT, ART_WIDTH } from "../schema";
import { algorithmClosure, algorithmRefs } from "./algorithms";
import { descendantIds, findNode } from "./graph";
import type { Region, Scene, SceneNode } from "./schema";
import { findTransformation } from "./transformations";

// A minimal example is an ordinary sketch frame with one collection and one
// object, carrying only the chosen semantic transformation (no machines): a
// collection's transformation acts on one plain member object, an object's
// transformation sits on the object inside a plain collection.

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

export function minimalExampleScene(scene: Scene, nodeId: string, transformationId: string): Scene {
  const node = findNode(scene, nodeId), transformation = node && findTransformation(node, transformationId);
  if (!node || !transformation) throw new Error("Transformation을 찾지 못했습니다.");
  const region = centered(node.region);
  const main: SceneNode = { ...node, parentId: null, region, visible: true, machine: null, transformations: [structuredClone(transformation)] };
  const nodes = [main];
  if (node.kind === "object") {
    const id = node.id === "collection" ? "example-collection" : "collection";
    nodes.unshift({ id, kind: "collection", parentId: null, name: `${node.name} collection`, description: "", primitive: "group", region, transformations: [], visible: true, machine: null });
    main.parentId = id;
  } else {
    // One plain member: the first object below it (or the first child), without its own transformations.
    const below = descendantIds(scene, node.id).map(id => findNode(scene, id)!).filter(Boolean);
    const member = below.find(item => item.kind === "object") || below[0];
    if (member) nodes.push({ ...member, kind: "object", primitive: member.primitive || "shape", parentId: node.id, region: within(member.region, node.region, region), visible: true, machine: null, transformations: [] });
    else nodes.push({ id: node.id === "object" ? "example-object" : "object", kind: "object", parentId: node.id, name: "Object", description: "", primitive: "shape",
      region: { x: region.x + region.w * .4, y: region.y + region.h * .4, w: region.w * .2, h: region.h * .2 }, transformations: [], visible: true, machine: null });
  }
  const refs = transformation.properties.flatMap(property => algorithmRefs(property.value));
  return { algorithms: algorithmClosure(scene.algorithms, refs), nodes };
}

/** The code instruction for a minimal example frame. */
export function minimalExampleInstruction(node: SceneNode, transformationId: string) {
  const transformation = findTransformation(node, transformationId)!;
  return [
    `This frame is a minimal example for trying the semantic transformation "${transformation.label}" of "${node.name}" on its own.`,
    transformation.description && `What it does: ${transformation.description}`,
    node.kind === "collection"
      ? "Draw the collection's single member as a plain, neutral shape and let ONLY this transformation decide how many instances there are and how they vary."
      : "Draw the object (inside its plain collection) as a neutral instance of its primitive and apply ONLY this transformation to it.",
    "Make its effect obvious and every property's slider visibly change the result. No background decoration, extra elements, colors or motion that this transformation does not define. Keep it inside the node's box.",
  ].filter(Boolean).join("\n").slice(0, 2000);
}
