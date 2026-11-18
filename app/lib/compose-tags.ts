import { z } from "zod";
import { algorithmRefs } from "./scene/algorithms";
import { findNode } from "./scene/graph";
import type { Scene } from "./scene/schema";

// Compose prompt tags: the objects and collections the AI read in the sketch, each on the marks it is drawn
// with, and what goes into it (its constraints and their params). The AI names the marks (stroke ids);
// where a tag sits is taken from those marks, never from coordinates the AI writes.

export const MAX_COMPOSE_TAGS = 16;
const effectSchema = z.enum(["spatial", "stylistic", "temporal"]);
const aiParamSchema = z.object({ label: z.string().max(60), value: z.string().max(60), how: z.string().max(160) });
const aiConstraintSchema = z.object({ label: z.string().max(60), effect: effectSchema, how: z.string().max(200),
  /** The pen whose marks carry it ("" when none does). */
  penId: z.string().max(80), params: z.array(aiParamSchema).max(6) });
export const aiComposeTagSchema = z.object({ id: z.string().max(40), kind: z.enum(["collection", "object"]), label: z.string().max(60),
  /** The collection it belongs to ("" at the top). */
  parentId: z.string().max(40),
  /** The marks it is drawn with (compositionStrokes ids). */
  strokeIds: z.array(z.string().max(80)).max(64), summary: z.string().max(200),
  /** A collection's members: what repeats and about how many ("" for an object). */
  members: z.string().max(120), constraints: z.array(aiConstraintSchema).max(6) });
export const aiCompositionPromptSchema = z.object({ prompt: z.string().trim().min(1).max(2000), tags: z.array(aiComposeTagSchema).max(MAX_COMPOSE_TAGS) });

const unit = z.number().min(0).max(1);
/** The pen a tag's constraint is carried by, and where its pen was made (to find that constraint's minimal examples). */
const tagPenSchema = z.object({ name: z.string().max(100), color: z.string().max(20),
  /** The frame and node the pen was made from. */
  frameId: z.string().max(80).default(""), nodeId: z.string().max(80).default(""),
  /** A constraint pen's constraint (label); an algorithm pen's algorithm (id). */
  constraint: z.string().max(100).default(""), algorithmId: z.string().max(80).default("") });
export type ComposeTagPen = z.infer<typeof tagPenSchema>;
export const composeTagSchema = aiComposeTagSchema.omit({ constraints: true }).extend({
  /** Where its marks are (normalized to the canvas). */
  box: z.object({ x: unit, y: unit, w: unit, h: unit }),
  constraints: z.array(aiConstraintSchema.omit({ penId: true }).extend({ pen: tagPenSchema.nullable() })).max(6) });
export type ComposeTag = z.infer<typeof composeTagSchema>;
export type AIComposeTag = z.infer<typeof aiComposeTagSchema>;

type Stroke = { id: string; tool: string; points: { x: number; y: number }[] };
type Pen = { id: string; name: string; color: string; sourceSketchId?: string; source?: { nodeId: string }; constraint?: { label: string } | null; algorithm?: { call: { algorithmId: string } } | null };
const tagPen = (pen: Pen): ComposeTagPen => ({ name: pen.name, color: pen.color, frameId: pen.sourceSketchId ?? "", nodeId: pen.source?.nodeId ?? "",
  constraint: pen.constraint?.label ?? "", algorithmId: pen.algorithm?.call.algorithmId ?? "" });
const PAD = .012;
const union = (boxes: ComposeTag["box"][]) => {
  const x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(b => b.y));
  return { x, y, w: Math.max(...boxes.map(b => b.x + b.w)) - x, h: Math.max(...boxes.map(b => b.y + b.h)) - y };
};
function boxOf(points: { x: number; y: number }[]) {
  const x0 = Math.max(0, Math.min(...points.map(p => p.x)) - PAD), y0 = Math.max(0, Math.min(...points.map(p => p.y)) - PAD);
  const x1 = Math.min(1, Math.max(...points.map(p => p.x)) + PAD), y1 = Math.min(1, Math.max(...points.map(p => p.y)) + PAD);
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

type AIConstraint = z.infer<typeof aiConstraintSchema>;
export type ComposeTagConstraint = ComposeTag["constraints"][number];
/** A constraint as the app keeps it: its pen (by id) resolved to the pen and where it was made. */
export function settleConstraint({ penId, ...rest }: AIConstraint, pens: Pen[]): ComposeTagConstraint {
  const pen = pens.find(item => item.id === penId);
  return { ...rest, pen: pen ? tagPen(pen) : null };
}
/** The tags as the AI reads them: no boxes, each pen named by its id among `pens` (found by name and color; "" when it is not there). */
export const tagsForAI = (tags: ComposeTag[], pens: Pen[]) => tags.map(({ box: _box, ...tag }) => ({ ...tag, ...held(tags, tag),
  constraints: tag.constraints.map(({ pen, ...item }) => ({ ...item, penId: (pen && pens.find(entry => entry.name === pen.name && entry.color.toLowerCase() === pen.color.toLowerCase())?.id) || "" })) }));
/** The tags for Compose: no boxes, pens by name and color only, each collection with what it holds. */
export const tagsForCompose = (tags: ComposeTag[]) => tags.map(({ box: _box, ...tag }) => ({ ...tag, ...held(tags, tag),
  constraints: tag.constraints.map(item => ({ ...item, pen: item.pen && { name: item.pen.name, color: item.pen.color } })) }));
/** What a collection holds, said outright beside `parentId` (it is what the collection repeats, whatever its words still say after the user moved tags). */
const held = (tags: ComposeTag[], tag: Pick<ComposeTag, "id" | "kind">) => tag.kind !== "collection" ? {}
  : { holds: tags.filter(item => item.parentId === tag.id).map(item => ({ id: item.id, kind: item.kind, label: item.label })) };

/** tag-revise: one constraint of a tag changed as the user asked. */
export const aiTagRevisionSchema = z.object({ constraint: aiConstraintSchema,
  /** One short sentence on what changed. */
  note: z.string().max(200) });
export const tagTargetSchema = z.object({ tagId: z.string().max(40), index: z.number().int().min(0).max(5) });
export const tagRevisionSchema = tagTargetSchema.extend({ constraint: composeTagSchema.shape.constraints.element, note: z.string().max(200) });
export type TagRevision = z.infer<typeof tagRevisionSchema>;
/** The tags with a revised constraint in its place (unchanged when that tag or constraint is gone). */
export const reviseTag = (tags: ComposeTag[], revision: TagRevision) => tags.map(tag => tag.id === revision.tagId && tag.constraints[revision.index]
  ? { ...tag, constraints: tag.constraints.map((item, i) => i === revision.index ? revision.constraint : item) } : tag);

/**
 * The tags as the app keeps them: only marks that are drawn (not erasers), a tag with none dropped, ids unique,
 * a parent only when it is another collection (and no loop), pens resolved to their name and color.
 * A collection's box takes in its members' boxes.
 */
export function settleComposeTags(tags: AIComposeTag[], strokes: Stroke[], pens: Pen[]): ComposeTag[] {
  const drawn = new Map(strokes.filter(stroke => stroke.tool !== "eraser" && stroke.points.length).map(stroke => [stroke.id, stroke.points]));
  const seen = new Set<string>(), kept: ComposeTag[] = [];
  for (const tag of tags) {
    const id = tag.id.trim(), marks = [...new Set(tag.strokeIds)].filter(stroke => drawn.has(stroke));
    if (!id || seen.has(id) || !marks.length) continue;
    seen.add(id);
    kept.push({ ...tag, id, strokeIds: marks, box: boxOf(marks.flatMap(stroke => drawn.get(stroke)!)),
      members: tag.kind === "collection" ? tag.members : "",
      constraints: tag.constraints.map(item => settleConstraint(item, pens)) });
  }
  return fitBoxes(fixParents(kept), drawn);
}
/** A parent only when it is another collection, and no loop. */
function fixParents(kept: ComposeTag[]) {
  const byId = new Map(kept.map(tag => [tag.id, tag]));
  const ancestorOf = (id: string, of: string) => { for (let at = byId.get(of), n = 0; at && n < MAX_COMPOSE_TAGS; at = byId.get(at.parentId), n++) if (at.id === id) return true; return false; };
  for (const tag of kept) if (tag.parentId && (tag.parentId === tag.id || byId.get(tag.parentId)?.kind !== "collection")) tag.parentId = "";
  for (const tag of kept) if (tag.parentId && ancestorOf(tag.id, tag.parentId)) tag.parentId = "";
  return kept;
}
/** Each tag's box over its own marks (kept as it is when they are not drawn any more), a collection's taking in what it contains. */
function fitBoxes(kept: ComposeTag[], drawn: Map<string, { x: number; y: number }[]>) {
  const byId = new Map(kept.map(tag => [tag.id, tag]));
  for (const tag of kept) { const points = tag.strokeIds.flatMap(id => drawn.get(id) ?? []); if (points.length) tag.box = boxOf(points); }
  // Deepest first, so a collection's box already holds its nested collections when it takes them in.
  const depth = (tag: ComposeTag) => { let n = 0; for (let at = byId.get(tag.parentId); at && n < MAX_COMPOSE_TAGS; at = byId.get(at.parentId)) n++; return n; };
  for (const tag of [...kept].sort((a, b) => depth(b) - depth(a))) {
    const children = kept.filter(child => child.parentId === tag.id);
    if (children.length) tag.box = union([tag.box, ...children.map(child => child.box)]);
  }
  return kept;
}

/**
 * A tag's pen with where it was made: tags written before pens kept that know only its name and color, so the pen
 * is found among the sketch's pens (those its strokes keep) by them.
 */
export function placedPen(pen: ComposeTagPen | null, pens: Pen[]): ComposeTagPen | null {
  if (!pen || pen.frameId) return pen;
  const found = pens.find(item => item.name === pen.name && item.color.toLowerCase() === pen.color.toLowerCase());
  return found ? { ...tagPen(found), name: pen.name, color: pen.color } : pen;
}
type ExampleFrames = Record<string, { scene: Scene; exampleOf: { frameId: string; nodeId: string; constraintId: string } | null } | undefined>;
/**
 * The minimal example frames (made with Decompose) of the constraint a tag's pen carries: the pen's own frame
 * when it was made from an example, else the examples of the constraint it was taken from (a constraint pen:
 * the one with its label; an algorithm pen: the ones whose params use its algorithm) in the pen's frame.
 */
export function penExamples(pen: ComposeTagPen | null, frames: ExampleFrames): string[] {
  const own = pen?.frameId ? frames[pen.frameId] : undefined;
  if (!pen || !own) return [];
  if (own.exampleOf) return [pen.frameId];
  const node = findNode(own.scene, pen.nodeId); if (!node) return [];
  const ids = node.constraints.filter(item => pen.constraint ? item.property === pen.constraint
    : Boolean(pen.algorithmId) && item.params.some(param => algorithmRefs(param.value).includes(pen.algorithmId))).map(item => item.id);
  return Object.entries(frames).filter(([, frame]) => frame?.exampleOf && frame.exampleOf.frameId === pen.frameId && frame.exampleOf.nodeId === node.id && ids.includes(frame.exampleOf.constraintId)).map(([id]) => id);
}

/** The tags as a containment tree, depth first: each collection followed by what it contains (`depth`: how deep it is nested). */
export function tagTree(tags: ComposeTag[]): { tag: ComposeTag; depth: number }[] {
  const ids = new Set(tags.map(tag => tag.id)), out: { tag: ComposeTag; depth: number }[] = [], seen = new Set<string>();
  const visit = (tag: ComposeTag, depth: number) => {
    if (seen.has(tag.id)) return; seen.add(tag.id); out.push({ tag, depth });
    for (const child of tags) if (child.parentId === tag.id) visit(child, depth + 1);
  };
  for (const tag of tags) if (!tag.parentId || !ids.has(tag.parentId)) visit(tag, 0);
  for (const tag of tags) visit(tag, 0);
  return out;
}
/** Every tag inside a collection, nested ones too. */
export const tagsInside = (tags: ComposeTag[], id: string) => { const tree = tagTree(tags), at = tree.findIndex(entry => entry.tag.id === id); if (at < 0) return [];
  const inside: ComposeTag[] = []; for (let i = at + 1; i < tree.length && tree[i].depth > tree[at].depth; i++) inside.push(tree[i].tag); return inside; };

const drawnMarks = (strokes: Stroke[]) => new Map(strokes.filter(stroke => stroke.tool !== "eraser" && stroke.points.length).map(stroke => [stroke.id, stroke.points]));
/** Whether a tag can go into `parentId` ("" = the top): only into a collection that is not itself or inside it. */
export function canMoveTag(tags: ComposeTag[], id: string, parentId: string) {
  const tag = tags.find(item => item.id === id); if (!tag || tag.parentId === parentId) return false;
  if (!parentId) return true;
  const parent = tags.find(item => item.id === parentId);
  return Boolean(parent && parent.kind === "collection" && parent.id !== id && !tagsInside(tags, id).some(item => item.id === parentId));
}
/** The tags with one moved into another collection (or to the top), boxes fitted again over `strokes` (the sketch's marks); null when it cannot go there. */
export function moveTag(tags: ComposeTag[], id: string, parentId: string, strokes: Stroke[]): ComposeTag[] | null {
  if (!canMoveTag(tags, id, parentId)) return null;
  return fitBoxes(fixParents(tags.map(tag => ({ ...tag, parentId: tag.id === id ? parentId : tag.parentId }))), drawnMarks(strokes));
}
/** The tags with one made a collection or an object: an object holds nothing, so what the collection held goes to its parent. */
export function setTagKind(tags: ComposeTag[], id: string, kind: ComposeTag["kind"], strokes: Stroke[]): ComposeTag[] {
  const tag = tags.find(item => item.id === id); if (!tag || tag.kind === kind) return tags;
  return fitBoxes(fixParents(tags.map(item => item.id === id ? { ...item, kind, members: kind === "object" ? "" : item.members }
    : kind === "object" && item.parentId === id ? { ...item, parentId: tag.parentId } : { ...item })), drawnMarks(strokes));
}
/** The tags without one: what it held goes up to its parent. */
export function deleteTag(tags: ComposeTag[], id: string, strokes: Stroke[]): ComposeTag[] {
  const tag = tags.find(item => item.id === id); if (!tag) return tags;
  return fitBoxes(fixParents(tags.filter(item => item.id !== id).map(item => ({ ...item, parentId: item.parentId === id ? tag.parentId : item.parentId }))), drawnMarks(strokes));
}
/** The tags with a new empty one (in `parentId`, a collection, or at the top), over its collection's box while it names no marks; null when full. */
export function addTag(tags: ComposeTag[], kind: ComposeTag["kind"], parentId: string): { tags: ComposeTag[]; id: string } | null {
  if (tags.length >= MAX_COMPOSE_TAGS) return null;
  const parent = tags.find(item => item.id === parentId && item.kind === "collection");
  let n = tags.length + 1; while (tags.some(item => item.id === `t${n}`)) n++;
  const box = parent ? { x: parent.box.x + parent.box.w * .1, y: parent.box.y + parent.box.h * .1, w: parent.box.w * .8, h: parent.box.h * .8 } : { x: .35, y: .35, w: .3, h: .3 };
  const tag: ComposeTag = { id: `t${n}`, kind, label: kind === "collection" ? "New collection" : "New object", parentId: parent?.id ?? "", strokeIds: [], summary: "", members: "", constraints: [], box };
  return { tags: [...tags, tag], id: tag.id };
}
export const MAX_TAG_CONSTRAINTS = 6, MAX_TAG_PARAMS = 6;
export const emptyConstraint = (): ComposeTagConstraint => ({ label: "New constraint", effect: "spatial", how: "", pen: null, params: [] });
/** Where a dragged constraint comes from: its tag and its place in that tag's list. */
export type TagConstraintAt = { tagId: string; index: number };
/** The drag data type of a constraint, so tag chips and the tag tree can tell it from a dragged tag. */
export const TAG_CONSTRAINT_DRAG = "application/x-rulegen-tag-constraint";
/**
 * The tags with one constraint moved to another tag or another place in its own: before the constraint at
 * `before` in the target tag (none: at its end). Null when nothing would change or the target holds no more.
 */
export function moveConstraint(tags: ComposeTag[], from: TagConstraintAt, to: string, before?: number): ComposeTag[] | null {
  const source = tags.find(tag => tag.id === from.tagId), target = tags.find(tag => tag.id === to), moved = source?.constraints[from.index];
  if (!source || !target || !moved) return null;
  if (target.id !== source.id && target.constraints.length >= MAX_TAG_CONSTRAINTS) return null;
  const rest = (tag: ComposeTag) => tag.id === source.id ? tag.constraints.filter((_, at) => at !== from.index) : tag.constraints;
  // Within one tag, the places after the moved one shift up once it is taken out.
  const length = rest(target).length, at = before === undefined ? length : Math.max(0, Math.min(length, target.id === source.id && before > from.index ? before - 1 : before));
  if (target.id === source.id && at === from.index) return null;
  return tags.map(tag => tag.id === target.id ? { ...tag, constraints: [...rest(tag).slice(0, at), moved, ...rest(tag).slice(at)] }
    : tag.id === source.id ? { ...tag, constraints: rest(tag) } : tag);
}
/** The constraint a drag carries, or null when it carries something else. */
export function draggedConstraint(data: DataTransfer): TagConstraintAt | null {
  try { const at = JSON.parse(data.getData(TAG_CONSTRAINT_DRAG)); return typeof at?.tagId === "string" && Number.isInteger(at?.index) ? at : null; }
  catch { return null; }
}
