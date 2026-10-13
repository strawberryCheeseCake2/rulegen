import { z } from "zod";
import { algorithmCallSchema, algorithmSchema, idSchema, sceneBindingSchema } from "./scene/schema";
import { sceneSchema } from "./scene/validate";
export const pointSchema = z.object({ x: z.number(), y: z.number() });
export type Point = z.infer<typeof pointSchema>;
export const MAX_CODE_LENGTH = 120000;
export const codeSchema = z.object({ title: z.string().max(150), explanation: z.string().max(1000), code: z.string().min(1).max(MAX_CODE_LENGTH) });
export const generatedSchema = codeSchema.extend({ sceneBindings: z.array(sceneBindingSchema).max(512).default([]), machineSignature: z.string().max(200000).default("") });
/** A pen whose marks carry an algorithm (copied from a property) or the built-in interaction meaning. */
export const semanticPenSchema = z.object({
  kind: z.enum(["algorithm", "interaction"]).default("algorithm"),
  id: z.string().min(1).max(80), name: z.string().min(1).max(100), color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  sourceSketchId: z.string().max(80),
  /** Where the algorithm came from, e.g. "Tree · Branching". */
  source: z.object({ nodeId: z.string().max(80), label: z.string().max(200) }),
  meaning: z.string().max(2000),
  algorithm: z.object({ call: algorithmCallSchema, library: z.array(algorithmSchema).max(24) }).nullable().default(null),
}).refine(pen => pen.kind === "interaction" || pen.algorithm, { message: "알고리즘 펜에 알고리즘이 없습니다." });
export type SemanticPen = z.infer<typeof semanticPenSchema>;
export const compositionStrokeSchema = z.object({ id: z.string().min(1).max(80), tool: z.enum(["pencil", "semantic", "interaction", "eraser"]), color: z.string().max(80), width: z.number().min(.1).max(100), opacity: z.number().min(0).max(1), points: z.array(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })).min(1).max(128), semanticPenId: z.string().max(80).nullable() });
export const imageSchema = z.string().max(8_000_000).regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/);
export const MAX_RESULT_STROKES = 128;
export const annotationSchema = z.object({ id: z.string().min(1).max(80), points: z.array(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })).min(2).max(600) });
export const clarificationSchema = z.object({ clarification: z.string().trim().min(1).max(2000) });
export const compositionPromptSchema = z.object({ prompt: z.string().trim().min(1).max(2000) });
export type ResultAnnotation = z.infer<typeof annotationSchema>;
export const AI_INTENTS = ["extract", "transform", "state-machine", "code", "compose", "compose-prompt", "clarification", "revision"] as const;
export const requestSchema = z.object({ intent: z.enum(AI_INTENTS), scene: sceneSchema.nullable().default(null), targetNodeId: idSchema.or(z.literal("")).default(""), targetTransformationId: idSchema.or(z.literal("")).default(""), targetPropertyId: idSchema.or(z.literal("")).default(""), image: imageSchema.optional(), resultImage: imageSchema.optional(), annotations: z.array(annotationSchema).max(MAX_RESULT_STROKES).default([]), revisionSummary: z.string().max(1500).default(""), alternative: z.boolean().default(false), previous: z.string().max(MAX_CODE_LENGTH).default(""), instruction: z.string().max(2000).default(""), compositionPens: z.array(semanticPenSchema).max(500).default([]), compositionStrokes: z.array(compositionStrokeSchema).max(500).default([]) }).superRefine((input, ctx) => {
  const ids = input.compositionPens.map(p => p.id);
  if (new Set(ids).size !== ids.length || input.compositionStrokes.some(s => (s.tool === "semantic" || s.tool === "interaction") && (!s.semanticPenId || !ids.includes(s.semanticPenId)))) ctx.addIssue({ code: "custom", message: "펜 의미와 획을 연결하지 못했습니다." });
  if (input.compositionStrokes.some(s => s.tool === "interaction" && input.compositionPens.find(p => p.id === s.semanticPenId)?.kind !== "interaction")) ctx.addIssue({ code: "custom", message: "Interaction annotation과 펜 의미를 확인해주세요." });
});
export type GeneratedCode = z.infer<typeof generatedSchema>;
export type Stroke = { points: Point[]; color: string; width: number; opacity: number; tool: "pen" | "eraser"; semanticPen?: SemanticPen };
export type Artwork = { strokes: Stroke[]; photo: string | null; name: string; revision: number };
export type Viewport = { zoom: number; x: number; y: number };
export const ART_WIDTH = 900, ART_HEIGHT = 600;
