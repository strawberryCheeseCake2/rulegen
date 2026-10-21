import { z } from "zod";
import { algorithmSchema, idSchema, nodeKindSchema, sceneBindingSchema, transformationSchema } from "./scene/schema";
import { sceneSchema } from "./scene/validate";
export const pointSchema = z.object({ x: z.number(), y: z.number() });
export type Point = z.infer<typeof pointSchema>;
export const MAX_CODE_LENGTH = 120000;
export const codeSchema = z.object({ title: z.string().max(150), explanation: z.string().max(1000), code: z.string().min(1).max(MAX_CODE_LENGTH) });
export const generatedSchema = codeSchema.extend({ sceneBindings: z.array(sceneBindingSchema).max(4096).default([]), machineSignature: z.string().max(200000).default("") });
/**
 * What a transformation pen carries: ONE semantic transformation as its minimal
 * example frame shows it, the kind of node it applies to, and the algorithms it calls (not the stand-in shapes it was shown on).
 * While that frame exists the pen follows it (its latest values and code); this
 * copy is what is left when it is gone.
 */
export const penTransformationSchema = z.object({
  /** The minimal example frame, and the node there that carries the transformation. */
  frameId: z.string().max(80), nodeId: idSchema,
  /** What kind of node it was applied to in its example: a collection (its members as a whole) or an object (its shape). */
  target: nodeKindSchema.catch("object").default("object"),
  transformation: transformationSchema,
  library: z.array(algorithmSchema).max(24),
});
export type PenTransformation = z.infer<typeof penTransformationSchema>;
/** A pen whose marks carry one semantic transformation (made from its minimal example), or the built-in interaction meaning. */
export const semanticPenSchema = z.object({
  kind: z.enum(["transformation", "interaction"]),
  id: z.string().min(1).max(80), name: z.string().min(1).max(100), color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  meaning: z.string().max(2000),
  transformation: penTransformationSchema.nullable().default(null),
}).refine(pen => pen.kind === "interaction" || pen.transformation, { message: "Transformation 펜에 transformation이 없습니다." });
export type SemanticPen = z.infer<typeof semanticPenSchema>;
export const compositionStrokeSchema = z.object({ id: z.string().min(1).max(80), tool: z.enum(["pencil", "semantic", "interaction", "eraser"]), color: z.string().max(80), width: z.number().min(.1).max(100), opacity: z.number().min(0).max(1), points: z.array(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })).min(1).max(128), semanticPenId: z.string().max(80).nullable() });
export const imageSchema = z.string().max(8_000_000).regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/);
export const compositionPromptSchema = z.object({ prompt: z.string().trim().min(1).max(2000) });
export const AI_INTENTS = ["decompose", "compose", "compose-prompt", "clarify", "transform", "code"] as const;
/**
 * clarify: before a transformation is added or modified from a frame annotation (and text), what the AI
 * understood, what it will add or change where, and what it still needs to know. Nothing changes until
 * the user applies it.
 */
export const clarificationSchema = z.object({
  understanding: z.string().max(1000), action: z.enum(["add", "modify"]),
  /** The node it applies to; the transformation it modifies ("" to add one); one property of it ("" for the whole transformation). */
  nodeId: idSchema, transformationId: z.string().max(80), propertyId: z.string().max(80),
  /** A transformation pen the user drew with: added exactly as its example has it ("add"), or the reference for the change ("modify"); "" for none. */
  penId: z.string().max(80),
  plan: z.string().max(1500), questions: z.array(z.string().max(300)).max(3),
});
export type Clarification = z.infer<typeof clarificationSchema>;
/** A working implementation of a semantic transformation: the code module of its minimal example (for the code of a composition that uses it). */
export const codeReferenceSchema = z.object({ transformationId: idSchema, label: z.string().max(100), code: z.string().max(40000) });
export type CodeReference = z.infer<typeof codeReferenceSchema>;
export const requestSchema = z.object({ intent: z.enum(AI_INTENTS), scene: sceneSchema.nullable().default(null),
  targetNodeId: idSchema.or(z.literal("")).default(""), targetTransformationId: idSchema.or(z.literal("")).default(""), targetPropertyId: idSchema.or(z.literal("")).default(""),
  image: imageSchema.optional(), alternative: z.boolean().default(false), previous: z.string().max(MAX_CODE_LENGTH).default(""), instruction: z.string().max(4000).default(""),
  compositionPens: z.array(semanticPenSchema).max(64).default([]), compositionStrokes: z.array(compositionStrokeSchema).max(500).default([]),
  /** Annotation strokes the user drew on the frame for a transform request (normalized; also drawn on the image). */
  transformMarks: z.array(z.array(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })).min(1).max(64)).max(64).default([]),
  /** For each annotation stroke, the transformation pen it was drawn with ("" for a plain mark); the pens are in `compositionPens`. */
  transformMarkPens: z.array(z.string().max(80)).max(64).default([]),
  /** Clarify: the previous clarification the user is answering (its questions), if any. */
  clarification: clarificationSchema.nullable().default(null),
  /** Code: the minimal example modules of the transformations the scene took from pens. */
  references: z.array(codeReferenceSchema).max(12).default([]),
}).superRefine((input, ctx) => {
  const ids = input.compositionPens.map(p => p.id);
  if (new Set(ids).size !== ids.length || input.compositionStrokes.some(s => (s.tool === "semantic" || s.tool === "interaction") && (!s.semanticPenId || !ids.includes(s.semanticPenId)))) ctx.addIssue({ code: "custom", message: "펜 의미와 획을 연결하지 못했습니다." });
  if (input.compositionStrokes.some(s => s.tool === "interaction" && input.compositionPens.find(p => p.id === s.semanticPenId)?.kind !== "interaction")) ctx.addIssue({ code: "custom", message: "Interaction annotation과 펜 의미를 확인해주세요." });
  if (input.transformMarkPens.some(id => id && input.compositionPens.find(p => p.id === id)?.kind !== "transformation")) ctx.addIssue({ code: "custom", message: "Annotation에 쓴 transformation 펜을 찾지 못했습니다." });
});
export type GeneratedCode = z.infer<typeof generatedSchema>;
export type Stroke = { points: Point[]; color: string; width: number; opacity: number; tool: "pen" | "eraser"; semanticPen?: SemanticPen };
export type Artwork = { strokes: Stroke[]; photo: string | null; name: string; revision: number };
export type Viewport = { zoom: number; x: number; y: number };
export const ART_WIDTH = 900, ART_HEIGHT = 600;
