import { z } from "zod";
import { ART_HEIGHT, ART_WIDTH } from "../schema";
import { algorithmClosure, algorithmRefs } from "./algorithms";
import type { AIDecomposition } from "./ai-schema";
import { convertTransformations, mergeAIAlgorithms } from "./convert";
import { clampRegion, findNode } from "./graph";
import { algorithmSchema, idSchema, nodeKindSchema, regionSchema, transformationSchema, type Region, type Scene, type SceneNode } from "./schema";
import { findTransformation } from "./transformations";
import { validateScene } from "./validate";

// Decompose: a sketch becomes a list of semantic transformations, each as
// independent as possible and each with the subject it acts on. Every one is
// then rendered alone in a minimal example frame: a plain collection and one
// plain object, carrying only that transformation (no machines).

const subjectSchema = z.object({ name: z.string().min(1).max(100), description: z.string().max(600), primitive: z.string().max(40) });
export const decomposedItemSchema = z.object({
  transformation: transformationSchema,
  subject: subjectSchema.extend({ kind: nodeKindSchema }), member: subjectSchema.nullable(), region: regionSchema,
});
export type DecomposedItem = z.infer<typeof decomposedItemSchema>;
/** The decompose result: shared algorithm definitions and the transformations (ids unique across all of them). */
export const decompositionSchema = z.object({ algorithms: z.array(algorithmSchema).max(48), items: z.array(decomposedItemSchema).min(1).max(12) });
export type Decomposition = z.infer<typeof decompositionSchema>;

/** Model output → transformations with expanded algorithm values; ids unique across the whole decomposition. */
export function convertDecomposition(output: AIDecomposition): Decomposition {
  const { library, ids } = mergeAIAlgorithms([], output.algorithms), seen = new Set<string>();
  const items = output.transformations.map(({ subject, member, region, ...rest }) => {
    const [transformation] = convertTransformations([rest], library, ids);
    let id = transformation.id, suffix = 2;
    while (seen.has(id)) id = `${transformation.id.slice(0, 70)}-${suffix++}`;
    seen.add(id);
    return { transformation: { ...transformation, id }, subject, member: subject.kind === "collection" ? member : null, region: clampRegion(region) };
  });
  return decompositionSchema.parse({ algorithms: library, items });
}

/** The largest box with the evidence's on-screen aspect that fits the middle of the frame. */
function centered(region: Region): Region {
  const aspect = Math.min(6, Math.max(1 / 6, (region.w * ART_WIDTH) / Math.max(1e-6, region.h * ART_HEIGHT)));
  const maxW = .6, maxH = .7;
  let w = maxW, h = (w * ART_WIDTH) / aspect / ART_HEIGHT;
  if (h > maxH) { h = maxH; w = (h * ART_HEIGHT * aspect) / ART_WIDTH; }
  return { x: (1 - w) / 2, y: (1 - h) / 2, w: Math.max(.05, w), h: Math.max(.05, h) };
}
const slug = (text: string, fallback: string) => text.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || fallback;

/** Which example a minimal example frame is: the sketch it was decomposed from and the node carrying the transformation. */
export const exampleSchema = z.object({ sourceFrameId: z.string().max(80).nullable(), nodeId: idSchema, transformationId: idSchema });
export type Example = z.infer<typeof exampleSchema>;

/** The scene of one transformation's minimal example, and which node carries it. */
export function exampleScene(decomposition: Decomposition, item: DecomposedItem): { scene: Scene; example: Omit<Example, "sourceFrameId"> } {
  const region = centered(item.region), transformation = structuredClone(item.transformation);
  const refs = transformation.properties.flatMap(property => algorithmRefs(property.value));
  const plain = (node: Pick<SceneNode, "id" | "kind" | "parentId" | "name" | "description" | "primitive" | "region">): SceneNode => ({ ...node, transformations: [], visible: true, machine: null });
  let nodes: SceneNode[], carrier: string;
  if (item.subject.kind === "collection") {
    // The transformation arranges / varies the members of a collection: one plain member is what it repeats.
    const root = slug(item.subject.name, "subject"), member = item.member ?? { name: "Element", description: "", primitive: "shape" };
    let memberId = slug(member.name, "member"); if (memberId === root) memberId = `${root}-member`;
    nodes = [{ ...plain({ id: root, kind: "collection", parentId: null, name: item.subject.name, description: item.subject.description, primitive: "group", region }), transformations: [transformation] },
      plain({ id: memberId, kind: "object", parentId: root, name: member.name, description: member.description, primitive: member.primitive || "shape",
        region: { x: region.x + region.w * .35, y: region.y + region.h * .35, w: region.w * .3, h: region.h * .3 } })];
    carrier = root;
  } else {
    // The transformation shapes one object: it sits alone in a plain collection.
    let id = slug(item.subject.name, "subject"); if (id === "example") id = "subject";
    nodes = [plain({ id: "example", kind: "collection", parentId: null, name: `${item.subject.name} example`, description: "", primitive: "group", region }),
      { ...plain({ id, kind: "object", parentId: "example", name: item.subject.name, description: item.subject.description, primitive: item.subject.primitive || "shape", region }), transformations: [transformation] }];
    carrier = id;
  }
  return { scene: validateScene({ algorithms: algorithmClosure(decomposition.algorithms, refs), nodes }), example: { nodeId: carrier, transformationId: transformation.id } };
}

/** The code instruction for a minimal example frame (with what the user added). */
export function exampleInstruction(scene: Scene, example: Pick<Example, "nodeId" | "transformationId">, extra = "") {
  const node = findNode(scene, example.nodeId), transformation = node && findTransformation(node, example.transformationId);
  if (!node || !transformation) return extra;
  return [
    `This frame is a minimal example of ONE semantic transformation, "${transformation.label}" of "${node.name}", shown on its own.`,
    transformation.description && `What it does: ${transformation.description}`,
    node.kind === "collection"
      ? "Draw the collection's single member as a plain, neutral shape and let ONLY this transformation decide how many instances there are, where they go and how they vary."
      : "Draw the object (inside its plain collection) as a neutral instance of its primitive and apply ONLY this transformation to it.",
    "Make its effect obvious and every property's slider visibly change the result. No background decoration, extra elements, colors or motion that this transformation does not define. Keep it inside the node's box.",
    "Write the transformation's logic as self-contained functions in the module (named after what they do), so it can be reused when this transformation is composed with others.",
    extra.trim() && `User direction: ${extra.trim()}`,
  ].filter(Boolean).join("\n").slice(0, 2000);
}
