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
 * example frame shows it, with the subject it acts on and the algorithms it calls.
 * While that frame exists the pen follows it (its latest values and code); this
 * copy is what is left when it is gone.
 */
export const penTransformationSchema = z.object({
  /** The minimal example frame, and the node there that carries the transformation. */
  frameId: z.string().max(80), nodeId: idSchema,
  /** What it acts on: one object (its look), or a collection (how its members are arranged and vary) with its plain member. */
  subject: z.object({ kind: nodeKindSchema, name: z.string().min(1).max(100), description: z.string().max(600), primitive: z.string().max(40) }),
  member: z.object({ name: z.string().min(1).max(100), description: z.string().max(600), primitive: z.string().max(40) }).nullable().default(null),
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
export const AI_INTENTS = ["decompose", "compose", "compose-prompt", "transform", "code"] as const;
/** A working implementation of a semantic transformation: the code module of its minimal example (for the code of a composition that uses it). */
export const codeReferenceSchema = z.object({ transformationId: idSchema, label: z.string().max(100), code: z.string().max(40000) });
export type CodeReference = z.infer<typeof codeReferenceSchema>;
export const requestSchema = z.object({ intent: z.enum(AI_INTENTS), scene: sceneSchema.nullable().default(null),
  targetNodeId: idSchema.or(z.literal("")).default(""), targetTransformationId: idSchema.or(z.literal("")).default(""), targetPropertyId: idSchema.or(z.literal("")).default(""),
  image: imageSchema.optional(), alternative: z.boolean().default(false), previous: z.string().max(MAX_CODE_LENGTH).default(""), instruction: z.string().max(2000).default(""),
  compositionPens: z.array(semanticPenSchema).max(64).default([]), compositionStrokes: z.array(compositionStrokeSchema).max(500).default([]),
  /** Annotation strokes the user drew on the frame for a transform request (normalized; also drawn on the image). */
  transformMarks: z.array(z.array(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })).min(1).max(64)).max(64).default([]),
  /** Code: the minimal example modules of the transformations the scene took from pens. */
  references: z.array(codeReferenceSchema).max(12).default([]),
}).superRefine((input, ctx) => {
  const ids = input.compositionPens.map(p => p.id);
  if (new Set(ids).size !== ids.length || input.compositionStrokes.some(s => (s.tool === "semantic" || s.tool === "interaction") && (!s.semanticPenId || !ids.includes(s.semanticPenId)))) ctx.addIssue({ code: "custom", message: "펜 의미와 획을 연결하지 못했습니다." });
  if (input.compositionStrokes.some(s => s.tool === "interaction" && input.compositionPens.find(p => p.id === s.semanticPenId)?.kind !== "interaction")) ctx.addIssue({ code: "custom", message: "Interaction annotation과 펜 의미를 확인해주세요." });
});
export type GeneratedCode = z.infer<typeof generatedSchema>;
export type Stroke = { points: Point[]; color: string; width: number; opacity: number; tool: "pen" | "eraser"; semanticPen?: SemanticPen };
export type Artwork = { strokes: Stroke[]; photo: string | null; name: string; revision: number };
export type Viewport = { zoom: number; x: number; y: number };
export const ART_WIDTH = 900, ART_HEIGHT = 600;
