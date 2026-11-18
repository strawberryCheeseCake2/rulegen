import { z } from "zod";
import { idSchema, paramSchema, sceneBindingSchema, constraintSchema } from "./scene/schema";
import { sceneSchema } from "./scene/validate";
import { composeTagSchema, MAX_COMPOSE_TAGS, tagTargetSchema } from "./compose-tags";
import { choiceSchema } from "./execution/manipulate";
export const pointSchema = z.object({ x: z.number(), y: z.number() });
export type Point = z.infer<typeof pointSchema>;
export const MAX_CODE_LENGTH = 120000;
export const codeSchema = z.object({ title: z.string().max(150), explanation: z.string().max(1000), code: z.string().min(1).max(MAX_CODE_LENGTH) });
export const generatedSchema = codeSchema.extend({ sceneBindings: z.array(sceneBindingSchema).max(4096).default([]), machineSignature: z.string().max(200000).default("") });
/** A pen whose marks carry a whole constraint (from a minimal example frame) or the built-in interaction meaning. */
export const semanticPenSchema = z.object({
  kind: z.enum(["interaction", "constraint"]).default("constraint"),
  id: z.string().min(1).max(80), name: z.string().min(1).max(100), color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  sourceSketchId: z.string().max(80),
  /** Where the constraint came from, e.g. "Tree · branches". */
  source: z.object({ nodeId: z.string().max(80), label: z.string().max(200) }),
  meaning: z.string().max(2000),
  /** A constraint pen: the constraint as it is (its params and values). */
  constraint: z.object({ label: z.string().max(100), description: z.string().max(1000), params: z.array(paramSchema).max(12) }).nullable().default(null),
}).refine(pen => pen.kind === "interaction" || pen.constraint, { message: "The pen holds no constraint." });
export type SemanticPen = z.infer<typeof semanticPenSchema>;
export const compositionStrokeSchema = z.object({ id: z.string().min(1).max(80), tool: z.enum(["pencil", "semantic", "interaction", "eraser"]), color: z.string().max(80), width: z.number().min(.1).max(100), opacity: z.number().min(0).max(1), points: z.array(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })).min(1).max(128), semanticPenId: z.string().max(80).nullable() });
export const imageSchema = z.string().max(8_000_000).regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/);
export const MAX_RESULT_STROKES = 128;
export const annotationSchema = z.object({ id: z.string().min(1).max(80), points: z.array(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })).min(2).max(600) });
export const clarificationSchema = z.object({ clarification: z.string().trim().min(1).max(2000) });
/** compose-prompt, as the app takes it: the prompt and the tags of what it read in the sketch. */
export const compositionPromptSchema = z.object({ prompt: z.string().trim().min(1).max(2000), tags: z.array(composeTagSchema).max(MAX_COMPOSE_TAGS).default([]) });
/** machine-refine result: the scene with the refined machine plus the updated Compose prompt. */
export const machineRefineResultSchema = z.object({ scene: sceneSchema, composePrompt: z.string().max(2000) });
/** split, as the app takes it: the parts of a constraint, each a constraint of its own. */
export const splitResultSchema = z.object({ divisible: z.boolean(), reason: z.string().max(400), parts: z.array(constraintSchema).max(5) });
export type ResultAnnotation = z.infer<typeof annotationSchema>;
export const AI_INTENTS = ["extract", "transform", "state-machine", "machine-refine", "code", "compose", "compose-prompt", "clarification", "revision", "handles", "split", "tag-revise", "trace-analyze", "trace-overlay", "trace-clarify"] as const;
/** The state or transition a machine refinement is focused on (none = the whole machine). */
export const machineTargetSchema = z.object({ kind: z.enum(["state", "transition"]), id: idSchema });
export type MachineTarget = z.infer<typeof machineTargetSchema>;
/** An annotation stroke drawn on the state machine graph, with the graph items it touches. */
export const machineMarkSchema = z.object({ points: z.array(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })).min(1).max(64), targets: z.array(z.string().max(200)).max(16) });
export type MachineMark = z.infer<typeof machineMarkSchema>;
export const requestSchema = z.object({ intent: z.enum(AI_INTENTS), scene: sceneSchema.nullable().default(null), targetNodeId: idSchema.or(z.literal("")).default(""), targetConstraintId: idSchema.or(z.literal("")).default(""), targetParamId: idSchema.or(z.literal("")).default(""), image: imageSchema.optional(), resultImage: imageSchema.optional(), annotations: z.array(annotationSchema).max(MAX_RESULT_STROKES).default([]), revisionSummary: z.string().max(1500).default(""), alternative: z.boolean().default(false), previous: z.string().max(MAX_CODE_LENGTH).default(""), instruction: z.string().max(6000).default(""), compositionPens: z.array(semanticPenSchema).max(500).default([]), compositionStrokes: z.array(compositionStrokeSchema).max(500).default([]), machineTarget: machineTargetSchema.nullable().default(null), machineImage: imageSchema.optional(), machineMarks: z.array(machineMarkSchema).max(64).default([]), composePrompt: z.string().max(2000).default(""),
  /** Compose from the tags on the sketch (what the AI read there) in place of, or with, the text prompt. */
  composeTags: z.array(composeTagSchema).max(MAX_COMPOSE_TAGS).default([]),
  /**
   * trace-analyze / trace-overlay / trace-clarify: an inspection of a brush's recorded execution — the concern, the brush's nodes,
   * every recorded site with every variable seen there (analyze), the chosen sites with sample steps (overlay).
   */
  trace: z.object({ concern: z.string().min(1).max(2000), nodeIds: z.array(idSchema).min(1).max(64), cycles: z.number().int().min(0).max(1000),
    sites: z.array(z.record(z.string(), z.unknown())).max(200),
    /** Marks the user drew on the picture with the inspection annotation tool (canvas pixels), pointing at what the concern is about. */
    marks: z.array(z.array(z.object({ x: z.number(), y: z.number() })).max(400)).max(24).default([]), analysis: z.record(z.string(), z.unknown()).nullable().default(null),
    /** trace-clarify: the rule the user picked from its question (the tools are then made for it). */
    choice: choiceSchema.nullable().default(null) }).nullable().default(null),
  /** tag-revise: the tag and which of its constraints to change. */
  tagTarget: tagTargetSchema.nullable().default(null),
  /** Annotation strokes the user drew on the frame for a transform request (normalized; also drawn on the image). */
  transformMarks: z.array(z.array(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })).min(1).max(64)).max(64).default([]) }).superRefine((input, ctx) => {
  const ids = input.compositionPens.map(p => p.id);
  if (new Set(ids).size !== ids.length || input.compositionStrokes.some(s => (s.tool === "semantic" || s.tool === "interaction") && (!s.semanticPenId || !ids.includes(s.semanticPenId)))) ctx.addIssue({ code: "custom", message: "Could not link the strokes to their pen meanings." });
  if (input.compositionStrokes.some(s => s.tool === "interaction" && input.compositionPens.find(p => p.id === s.semanticPenId)?.kind !== "interaction")) ctx.addIssue({ code: "custom", message: "Check the interaction annotations and pen meanings." });
});
export type GeneratedCode = z.infer<typeof generatedSchema>;
export type Stroke = { points: Point[]; color: string; width: number; opacity: number; tool: "pen" | "eraser"; semanticPen?: SemanticPen };
export type Artwork = { strokes: Stroke[]; photo: string | null; name: string; revision: number };
export type Viewport = { zoom: number; x: number; y: number };
export const ART_WIDTH = 900, ART_HEIGHT = 600;
