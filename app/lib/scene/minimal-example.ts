import { z } from "zod";
import { ART_HEIGHT, ART_WIDTH } from "../schema";
import { algorithmClosure, algorithmRefs } from "./algorithms";
import { EXAMPLE_SHAPES, type AIDecomposition } from "./ai-schema";
import { convertTransformations, mergeAIAlgorithms } from "./convert";
import { clampRegion, findNode } from "./graph";
import { algorithmSchema, idSchema, MAX_NESTING_DEPTH, nodeKindSchema, regionSchema, type SemanticTransformation, transformationSchema, type Region, type Scene, type SceneNode } from "./schema";
import { findTransformation } from "./transformations";
import { validateScene } from "./validate";
import { valueLeaves } from "./values";

// Decompose: a sketch becomes its objects (its elements, what they ARE) and a list
// of semantic transformations, each as independent as possible and each an
// operation only (what an element is, e.g. a petal's shape, is never a
// transformation). Every object and every transformation is rendered alone in a
// minimal example frame. A transformation's example is the smallest
// collection/object structure that shows it (several objects, several or nested
// collections when it needs them), with the transformation on one node. Decomposed
// from a sketch, its objects are drawn as the sketch's elements, so it looks like
// the source; split from an example, they are plain stand-in shapes (circles,
// squares), fully independent of the sketch. No machines.

type Shape = (typeof EXAMPLE_SHAPES)[number];
const shapeOf = (value: unknown): Shape => value === "square" || value === "rect" ? "square" : "circle";
const exampleNodeSchema = z.object({ id: z.string().min(1).max(80), kind: nodeKindSchema, parentId: z.string().max(80).nullable(), shape: z.string().max(40).nullable().catch(null),
  count: z.number().int().min(1).max(48).nullable().catch(null).default(null), object: z.string().max(80).nullable().catch(null).default(null) });
export type ExampleNode = z.input<typeof exampleNodeSchema>;
/** A decomposed item as older logs wrote it (subject + member, collection + object, target + primitive, or one stand-in). */
const legacyItem = (item: any) => {
  if (!item || typeof item !== "object" || Array.isArray(item.nodes)) return item;
  if (typeof item.standIn === "string") return { ...item, nodes: [{ id: "shape", kind: "object", parentId: null, shape: shapeOf(item.standIn), count: null }], carrier: "shape" };
  const target = item.target ?? item.subject?.kind ?? "object";
  const shape = shapeOf(item.primitive ?? item.object?.primitive ?? (target === "collection" ? item.member?.primitive : item.subject?.primitive));
  // On a collection: copies of one shape. On an object: that shape alone (a group of one would be copies of it).
  return target === "collection" ? { ...item, nodes: [{ id: "group", kind: "collection", parentId: null, shape: null, count: null }, { id: "shape", kind: "object", parentId: "group", shape, count: null }], carrier: "group" }
    : { ...item, nodes: [{ id: "shape", kind: "object", parentId: null, shape, count: null }], carrier: "shape" };
};
/** One of the sketch's elements, as one plain instance: what it is (no transformation of it). */
export const sketchObjectSchema = z.object({ id: idSchema, name: z.string().min(1).max(80), description: z.string().max(600).catch(""), primitive: z.string().max(40).catch(""), region: regionSchema });
export type SketchObject = z.infer<typeof sketchObjectSchema>;
export const decomposedItemSchema = z.preprocess(legacyItem, z.object({
  transformation: transformationSchema, nodes: z.array(exampleNodeSchema).min(1).max(16), carrier: z.string().max(80), region: regionSchema,
}));
export type DecomposedItem = z.infer<typeof decomposedItemSchema>;
/** The decompose result: shared algorithm definitions, the sketch's objects (none when an example was split) and the transformations (ids unique across all of them). */
export const decompositionSchema = z.object({ algorithms: z.array(algorithmSchema).max(48), objects: z.array(sketchObjectSchema).max(12).catch([]).default([]), items: z.array(decomposedItemSchema).min(1).max(12),
  /** Why an example could not be split (one piece came back). */
  minimalReason: z.string().max(400).catch("").default("") });
export type Decomposition = z.infer<typeof decompositionSchema>;

/**
 * Model output → transformations with expanded algorithm values; ids unique across the whole decomposition.
 * Splitting an example (`split`) keeps nothing of the sketch: no objects, every object a stand-in shape.
 */
export function convertDecomposition(output: AIDecomposition, split = false): Decomposition {
  const { library, ids } = mergeAIAlgorithms([], output.algorithms), seen = new Set<string>();
  const objects = split ? [] : (output.objects ?? []).filter((object, i, all) => all.findIndex(other => other.id === object.id) === i).map(object => ({ ...object, region: clampRegion(object.region) }));
  const items = output.transformations.map(({ nodes: written, carrier, region, ...rest }) => {
    const nodes = written.map(node => ({ ...node, object: node.kind === "object" && objects.some(object => object.id === node.object) ? node.object : null }));
    const [transformation] = convertTransformations([rest], library, ids);
    let id = transformation.id, suffix = 2;
    while (seen.has(id)) id = `${transformation.id.slice(0, 70)}-${suffix++}`;
    seen.add(id);
    return { transformation: { ...transformation, id }, nodes, carrier, region: clampRegion(region) };
  });
  return decompositionSchema.parse({ algorithms: library, objects, items, minimalReason: items.length < 2 ? output.minimalReason ?? "" : "" });
}

/** The largest box with the evidence's on-screen aspect that fits the middle of the frame. */
function centered(region: Region): Region {
  const aspect = Math.min(6, Math.max(1 / 6, (region.w * ART_WIDTH) / Math.max(1e-6, region.h * ART_HEIGHT)));
  const maxW = .6, maxH = .7;
  let w = maxW, h = (w * ART_WIDTH) / aspect / ART_HEIGHT;
  if (h > maxH) { h = maxH; w = (h * ART_HEIGHT * aspect) / ART_WIDTH; }
  return { x: (1 - w) / 2, y: (1 - h) / 2, w: Math.max(.05, w), h: Math.max(.05, h) };
}
/**
 * Which example a minimal example frame is: the frame it was decomposed from, and either the
 * node carrying the transformation it shows, or (`kind: "object"`) the sketch object it shows.
 * `elements`: the nodes drawn as the source sketch's elements (none: plain stand-in shapes).
 */
export const exampleSchema = z.object({ sourceFrameId: z.string().max(80).nullable(), kind: z.enum(["transformation", "object"]).catch("transformation").default("transformation"),
  nodeId: idSchema, transformationId: z.string().max(80).default(""), elements: z.array(z.string().max(80)).max(16).catch([]).default([]) });
export type Example = z.infer<typeof exampleSchema>;

const DEFAULT_COPIES = 6;
const COUNT_WORD = /count|copies|instances|repeat|개수|갯수|^n$|^num(ber)?$/i;
const countValue = (count: number) => ({ type: "number" as const, value: count, min: 1, max: Math.max(24, count), step: 1, unit: "" });
/** Whether a transformation already lets the user set how many copies there are (a number property or algorithm argument named as a count). */
export function hasCountControl(transformation: SemanticTransformation) {
  return transformation.properties.some(property => valueLeaves(property.value, [property.id]).some(leaf => leaf.value.type === "number" && (leaf.path.some(part => COUNT_WORD.test(part)) || (leaf.path.length === 1 && COUNT_WORD.test(property.label)))));
}
/** The plain "Copies" transformation of a copies collection that is not the carrier: example structure only (no pen takes it). */
export const COPIES_ID = "example-copies";
function copiesTransformation(count: number): SemanticTransformation {
  return { id: COPIES_ID, label: "Copies", description: "예제 구조: 이 그룹이 담은 같은 평범한 도형의 개수입니다(보여주는 transformation이 아니며 펜에 들어가지 않습니다).",
    properties: [{ id: "count", label: "Count", effect: "spatial", description: "같은 도형의 개수", value: countValue(count) }] };
}

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "object";
/**
 * The model's structure made sound: unique ids, parents that are collections (no
 * cycles, nesting within the limit), no empty collection, a carrier that exists.
 * Ids and names are the app's: an object drawn as one of the sketch's `objects`
 * takes that object's name and description ("Petal"); everything else is named
 * after the stand-in shapes only ("Group", "Circle 2"), so nothing of the sketch
 * rides along in them.
 */
export function exampleStructure(input: ExampleNode[], carrierId: string, objects: SketchObject[] = []) {
  const nodes = input.filter((node, i) => input.findIndex(other => other.id === node.id) === i).slice(0, 12).map(node => ({ ...node, shape: node.kind === "object" ? shapeOf(node.shape) : null, count: node.kind === "collection" ? node.count ?? null : null,
    object: node.kind === "object" && objects.some(object => object.id === node.object) ? node.object! : null }));
  const byId = new Map(nodes.map(node => [node.id, node]));
  for (const node of nodes) if (node.parentId && (node.parentId === node.id || byId.get(node.parentId)?.kind !== "collection")) node.parentId = null;
  const depth = (node: ExampleNode) => { let level = 1; for (let at = node, seen = new Set([node.id]); at.parentId; level++) { const parent = byId.get(at.parentId)!; if (seen.has(parent.id)) return Infinity; seen.add(parent.id); at = parent; } return level; };
  for (const node of nodes) if (depth(node) > MAX_NESTING_DEPTH) node.parentId = null;
  for (const node of [...nodes]) if (node.kind === "collection" && !nodes.some(child => child.parentId === node.id)) nodes.push({ id: `${node.id}--member`, kind: "object", parentId: node.id, shape: "circle", count: null, object: null });
  // Depth-first, parents before their children.
  const ordered: ExampleNode[] = [], visit = (parent: string | null) => { for (const node of nodes.filter(item => item.parentId === parent)) { ordered.push(node); visit(node.id); } };
  visit(null);
  const keyOf = (node: ExampleNode) => node.kind === "collection" ? "group" : node.object ? `object:${node.object}` : node.shape!;
  const count = (key: string) => ordered.filter(node => keyOf(node) === key).length, used = new Map<string, number>(), taken = new Set<string>();
  const named = ordered.map(node => {
    const key = keyOf(node), n = (used.get(key) ?? 0) + 1; used.set(key, n);
    const element = node.object ? objects.find(object => object.id === node.object)! : null;
    const title = element?.name ?? { group: "Group", circle: "Circle", square: "Square" }[key]!, korean = { group: "그룹", circle: "원", square: "정사각형" }[key] ?? "";
    let id = `${element ? slug(element.id) : key}${n > 1 ? `-${n}` : ""}`, suffix = 2;
    while (taken.has(id)) id = `${element ? slug(element.id) : key}-${n}-${suffix++}`;
    taken.add(id);
    // A collection of ONE member is copies of it (the example's structure says so even when the model gave no count).
    const single = node.kind === "collection" && ordered.filter(child => child.parentId === node.id).length === 1;
    return { source: node.id, id, kind: node.kind, shape: node.shape, element, copies: node.kind === "collection" ? node.count ?? (single ? DEFAULT_COPIES : null) : null, name: count(key) > 1 ? `${title} ${n}` : title,
      description: element ? element.description || element.name : node.kind === "collection" ? `평범한 도형을 묶는 ${korean}` : `transformation을 보여주기 위한 평범한 ${korean}` };
  });
  const ids = new Map(named.map(node => [node.source, node.id]));
  const carrier = ids.get(carrierId) ?? named.find(node => node.kind === "object")?.id ?? named[0].id;
  return { carrier, nodes: named.map(({ source, ...node }) => ({ ...node, parentId: (() => { const parent = ordered.find(item => item.id === source)?.parentId; return parent ? ids.get(parent)! : null; })() })) };
}

/** The scene of one transformation's minimal example: its collection/object structure (the sketch's elements, or plain stand-ins), the transformation on its carrier. */
export function exampleScene(decomposition: Decomposition, item: DecomposedItem): { scene: Scene; example: Omit<Example, "sourceFrameId"> } {
  const transformation = structuredClone(item.transformation), refs = transformation.properties.flatMap(property => algorithmRefs(property.value));
  const structure = exampleStructure(item.nodes, item.carrier, decomposition.objects), regions = new Map<string, Region>();
  // Siblings share their parent's box side by side; an object repeated by others is one small instance, the carrier fills its slot.
  const place = (parent: string | null, box: Region) => {
    const children = structure.nodes.filter(node => node.parentId === parent), gap = children.length > 1 ? box.w * .06 : 0, w = (box.w - gap * (children.length - 1)) / Math.max(1, children.length);
    children.forEach((node, i) => {
      const slot = { x: box.x + i * (w + gap), y: box.y, w, h: box.h };
      const scale = node.kind === "collection" ? (parent ? .8 : 1) : node.id === structure.carrier ? .8 : parent ? .3 : .5;
      regions.set(node.id, { x: slot.x + slot.w * (1 - scale) / 2, y: slot.y + slot.h * (1 - scale) / 2, w: slot.w * scale, h: slot.h * scale });
      if (node.kind === "collection") place(node.id, regions.get(node.id)!);
    });
  };
  place(null, centered(item.region));
  // A copies collection always has its count: the transformation's own when it makes the copies (it has a count property or argument);
  // otherwise a plain "Copies" before it (example structure, so a transformation that only acts on copies, e.g. bending a row, does not take over the count).
  const carrierNode = structure.nodes.find(node => node.id === structure.carrier)!;
  const nodes: SceneNode[] = structure.nodes.map(node => ({ id: node.id, kind: node.kind, parentId: node.parentId, name: node.name, description: node.description,
    primitive: node.kind === "collection" ? "group" : node.element ? node.element.primitive || "shape" : node.shape === "square" ? "rect" : "circle", region: regions.get(node.id)!,
    transformations: node.id === structure.carrier ? carrierNode.copies && !hasCountControl(transformation) ? [copiesTransformation(carrierNode.copies), transformation] : [transformation] : node.copies ? [copiesTransformation(node.copies)] : [],
    visible: true, machine: null }));
  return { scene: validateScene({ algorithms: algorithmClosure(decomposition.algorithms, refs), nodes }),
    example: { kind: "transformation", nodeId: structure.carrier, transformationId: transformation.id, elements: structure.nodes.filter(node => node.element).map(node => node.id) } };
}

/** The scene of one of the sketch's objects alone: one plain instance, no transformation. */
export function objectScene(object: SketchObject): { scene: Scene; example: Omit<Example, "sourceFrameId"> } {
  const id = slug(object.id);
  const node: SceneNode = { id, kind: "object", parentId: null, name: object.name, description: object.description || object.name, primitive: object.primitive || "shape",
    region: centered(object.region), transformations: [], visible: true, machine: null };
  return { scene: validateScene({ algorithms: [], nodes: [node] }), example: { kind: "object", nodeId: id, transformationId: "", elements: [id] } };
}

/** Every example frame a decomposition makes, in board order: the sketch's objects, then the transformations (each of these also makes a pen). */
export function exampleFrames(decomposition: Decomposition) {
  return [
    ...decomposition.objects.map(object => ({ name: `${object.name} · object`, ...objectScene(object) })),
    ...decomposition.items.map(item => ({ name: `${item.transformation.label || item.transformation.id || "Transformation"} · example`, ...exampleScene(decomposition, item) })),
  ];
}

/** How many copies a collection of an example holds (its "Copies" count, or its transformation's count property), or null. */
export function collectionCount(node: SceneNode) {
  if (node.kind !== "collection") return null;
  for (const transformation of node.transformations) for (const property of transformation.properties)
    if (property.value.type === "number" && (property.id === "count" || COUNT_WORD.test(property.id) || COUNT_WORD.test(property.label))) return Math.max(1, Math.min(48, Math.round(property.value.value)));
  return null;
}
const hasCopies = (scene: Scene) => scene.nodes.some(node => node.transformations.some(item => item.id === COPIES_ID));
const userDirection = (extra: string) => extra.trim() && `User direction: ${extra.trim()}`;
/** The code instruction for a minimal example frame (with what the user added). */
export function exampleInstruction(scene: Scene, example: Pick<Example, "nodeId" | "transformationId"> & Partial<Pick<Example, "kind" | "elements">>, extra = "") {
  const node = findNode(scene, example.nodeId), elements = scene.nodes.filter(item => example.elements?.includes(item.id));
  if (node && example.kind === "object") return [
    `This frame is a minimal example of ONE object of the source sketch, "${node.name}", drawn alone: what it is, as one plain instance.`,
    node.description && `What it looks like: ${node.description}`,
    "The image is the source sketch: draw the object to look like this element there (its outline, proportions, line quality and its own color), once, filling the node's box.",
    "Draw nothing else of the sketch: no copies, arrangement, variation between copies, other elements, decoration or motion. Those are transformations and other objects, shown in their own examples.",
    "Write the object's drawing as a self-contained function in the module (named after what it draws), so it can be reused.",
    userDirection(extra),
  ].filter(Boolean).join("\n").slice(0, 4000);
  const transformation = node && findTransformation(node, example.transformationId);
  if (!node || !transformation) return extra;
  return [
    `This frame is a minimal example of ONE semantic transformation, "${transformation.label}", shown on its own.`,
    transformation.description && `What it does: ${transformation.description}`,
    `Apply ONLY this transformation, to ${node.kind === "collection" ? `the collection "${node.name}" (to its members as a whole: how many copies, where they go, how they vary)` : `the object "${node.name}" (to its shape)`}. Every other node is drawn plain and unchanged.`,
    hasCopies(scene) && `A collection's "Copies" transformation (id ${COPIES_ID}) only says how many plain copies of its one member it holds: lay them out plainly (evenly spaced in a straight row, or a plain grid for many) and let its Count slider change their number; it is example structure, not part of the transformation shown.${node.transformations.some(item => item.id === COPIES_ID) ? ` On "${node.name}" it comes first: the transformation then acts on those plain copies (it does not make them).` : ""}`,
    node.kind === "collection" && hasCountControl(transformation) && "The transformation's count property (or count argument) is how many copies of the collection's member it makes: read it, and let its slider change the number.",
    elements.length ? `The image is the source sketch this example was decomposed from. The object${elements.length > 1 ? "s" : ""} ${elements.map(item => `"${item.name}"`).join(", ")} ${elements.length > 1 ? "are" : "is"} drawn to look like ${elements.length > 1 ? "their elements" : "its element"} there (outline, proportions, line quality, own color; its description says what it is), one plain instance per copy, so the example resembles the source. Take nothing else from the image: its other effects (other arrangements, variations, colors, motion) are other transformations, not this one.${elements.length < scene.nodes.filter(item => item.kind === "object").length ? " The other objects are plain stand-in shapes (circle or square; thin neutral outline, no fill)." : ""} Collections only group them.`
      : "Objects are plain stand-in shapes (circle or square; thin neutral outline, no fill) and collections only group them. They are not the sketch's elements: do not draw a petal, a leaf or any subject the transformation's label or description may suggest, and add no other effect.",
    elements.length > 0 && "The transformation is the operation only: implement it so it works unchanged on any shape (it must not depend on what the element is); the element is drawn by its own function, which the transformation calls.",
    "Make its effect obvious and every property's slider visibly change the result. No background decoration, extra elements, colors or motion that this transformation does not define. Keep it inside the node's box.",
    "Write the transformation's logic as self-contained functions in the module (named after what they do), so it can be reused when this transformation is composed with others.",
    userDirection(extra),
  ].filter(Boolean).join("\n").slice(0, 4000);
}
