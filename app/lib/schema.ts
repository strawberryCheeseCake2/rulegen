import { z } from "zod";
import { algorithmCallSchema, algorithmSchema, idSchema, propertySchema, sceneBindingSchema, transformationSchema } from "./scene/schema";
import { sceneSchema } from "./scene/validate";
import { markStyleSchema, MAX_MARKS, overlaySchema } from "./inspection";
export const pointSchema = z.object({ x: z.number(), y: z.number() });
export type Point = z.infer<typeof pointSchema>;
export const MAX_CODE_LENGTH = 120000;
export const codeSchema = z.object({ title: z.string().max(150), explanation: z.string().max(1000), code: z.string().min(1).max(MAX_CODE_LENGTH) });
export const generatedSchema = codeSchema.extend({ sceneBindings: z.array(sceneBindingSchema).max(4096).default([]), machineSignature: z.string().max(200000).default("") });
/** A pen whose marks carry an algorithm (copied from a property), a whole semantic transformation (from a minimal example frame) or the built-in interaction meaning. */
export const semanticPenSchema = z.object({
  kind: z.enum(["algorithm", "interaction", "transformation"]).default("algorithm"),
  id: z.string().min(1).max(80), name: z.string().min(1).max(100), color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  sourceSketchId: z.string().max(80),
  /** Where the algorithm came from, e.g. "Tree · Branching". */
  source: z.object({ nodeId: z.string().max(80), label: z.string().max(200) }),
  meaning: z.string().max(2000),
  algorithm: z.object({ call: algorithmCallSchema, library: z.array(algorithmSchema).max(24) }).nullable().default(null),
  /** A transformation pen: the transformation as it is (its properties and values) and the algorithms they use. */
  transformation: z.object({ label: z.string().max(100), description: z.string().max(1000), properties: z.array(propertySchema).max(12), library: z.array(algorithmSchema).max(24) }).nullable().default(null),
}).refine(pen => pen.kind === "interaction" || (pen.kind === "transformation" ? pen.transformation : pen.algorithm), { message: "펜에 담긴 알고리즘이나 transformation이 없습니다." });
export type SemanticPen = z.infer<typeof semanticPenSchema>;
export const compositionStrokeSchema = z.object({ id: z.string().min(1).max(80), tool: z.enum(["pencil", "semantic", "interaction", "eraser"]), color: z.string().max(80), width: z.number().min(.1).max(100), opacity: z.number().min(0).max(1), points: z.array(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })).min(1).max(128), semanticPenId: z.string().max(80).nullable() });
export const imageSchema = z.string().max(8_000_000).regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/);
export const MAX_RESULT_STROKES = 128;
export const annotationSchema = z.object({ id: z.string().min(1).max(80), points: z.array(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })).min(2).max(600) });
export const clarificationSchema = z.object({ clarification: z.string().trim().min(1).max(2000) });
export const compositionPromptSchema = z.object({ prompt: z.string().trim().min(1).max(2000) });
/** machine-refine result: the scene with the refined machine plus the updated Compose prompt. */
export const machineRefineResultSchema = z.object({ scene: sceneSchema, composePrompt: z.string().max(2000) });
/** split, as the app takes it: the parts of a transformation (each a transformation of its own) and the algorithms they use. */
export const splitResultSchema = z.object({ divisible: z.boolean(), reason: z.string().max(400), algorithms: z.array(algorithmSchema).max(64), parts: z.array(transformationSchema).max(5) });
export type ResultAnnotation = z.infer<typeof annotationSchema>;
export const AI_INTENTS = ["extract", "transform", "state-machine", "machine-refine", "code", "compose", "compose-prompt", "clarification", "revision", "inspect", "handles", "concern", "explore", "split"] as const;
const inspectScalar = z.union([z.number(), z.string().max(200), z.boolean()]);
/** Targeted inspection input: the brush's nodes, its constraint rows and the recorded steps. */
export const inspectionInputSchema = z.object({
  brushName: z.string().max(100), nodeIds: z.array(idSchema).min(1).max(48),
  constraints: z.array(z.object({ key: z.string().max(1200), nodeId: idSchema, transformationId: z.string().max(80), transformation: z.string().max(100), propertyId: idSchema, property: z.string().max(100), path: z.string().max(400), type: z.string().max(20) })).max(400),
  steps: z.array(z.object({ id: z.number().int(), nodeId: z.string().max(80).nullable(), from: z.string().max(80).nullable(), to: z.string().max(80).nullable(), transitionId: z.string().max(80).nullable(), values: z.record(z.string().max(1200), inspectScalar),
    /** Machine states and the brush roots' m.store at that step. */
    runtime: z.object({ states: z.record(z.string().max(80), z.object({ id: z.string().max(80), elapsed: z.number() })), stores: z.record(z.string().max(80), z.unknown()) }).nullable().default(null) })).max(20),
  cursor: z.number().int().nullable(),
  marks: z.array(z.array(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })).min(1).max(64)).max(MAX_MARKS),
  /** Each mark's color, width and opacity, by index. */
  markStyles: z.array(markStyleSchema).max(MAX_MARKS).default([]),
  /** Also write a quick visual preview (code edits) for each recommendation. */
  previews: z.boolean().default(false),
  /**
   * Rebuilding a targeted inspection's overlays after one of its recommendations was applied: what was applied
   * (its kind, target, value changes; the transformation it added, if any), and the summary and overlays so far.
   */
  update: z.object({ kind: z.enum(["value", "transformation", "add-transformation", "state", "transition"]).default("add-transformation"), title: z.string().max(160), detail: z.string().max(800), nodeId: idSchema,
    targetId: z.string().max(80).default(""), transformationId: z.string().max(80).default(""),
    changes: z.array(z.object({ key: z.string().max(1200), stateId: z.string().max(80), value: inspectScalar })).max(12).default([]),
    summary: z.string().max(1500), overlays: z.array(overlaySchema).max(12) }).nullable().default(null),
});
export type InspectionInput = z.infer<typeof inspectionInputSchema>;
/**
 * Exploration frame: what to explore (execution with a metaphoric handle, or a recommendation's key values),
 * from the targeted inspection's cause or one of its recommendations (and whether it is applied already).
 */
export const exploreInputSchema = z.object({
  mode: z.enum(["execution", "parameters"]),
  summary: z.string().max(1500),
  overlays: z.array(z.object({ name: z.string().max(60), label: z.string().max(300), link: z.object({ kind: z.string().max(20), nodeId: z.string().max(80), id: z.string().max(80) }) })).max(12).default([]),
  recommendation: z.object({ kind: z.enum(["value", "transformation", "add-transformation", "state", "transition"]), nodeId: idSchema, targetId: z.string().max(80), targetIds: z.array(z.string().max(80)).max(6).default([]),
    title: z.string().max(160), detail: z.string().max(800), changes: z.array(z.object({ key: z.string().max(1200), stateId: z.string().max(80), value: inspectScalar })).max(12).default([]), applied: z.boolean() }).nullable().default(null),
  /** The recorded input at the step the frame starts from: how many gestures and points. */
  input: z.object({ gestures: z.number().int().min(0), points: z.number().int().min(0) }),
});
export type ExploreInput = z.infer<typeof exploreInputSchema>;
/** The state or transition a machine refinement is focused on (none = the whole machine). */
export const machineTargetSchema = z.object({ kind: z.enum(["state", "transition"]), id: idSchema });
export type MachineTarget = z.infer<typeof machineTargetSchema>;
/** An annotation stroke drawn on the state machine graph, with the graph items it touches. */
export const machineMarkSchema = z.object({ points: z.array(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })).min(1).max(64), targets: z.array(z.string().max(200)).max(16) });
export type MachineMark = z.infer<typeof machineMarkSchema>;
export const requestSchema = z.object({ intent: z.enum(AI_INTENTS), scene: sceneSchema.nullable().default(null), targetNodeId: idSchema.or(z.literal("")).default(""), targetTransformationId: idSchema.or(z.literal("")).default(""), targetPropertyId: idSchema.or(z.literal("")).default(""), image: imageSchema.optional(), resultImage: imageSchema.optional(), annotations: z.array(annotationSchema).max(MAX_RESULT_STROKES).default([]), revisionSummary: z.string().max(1500).default(""), alternative: z.boolean().default(false), previous: z.string().max(MAX_CODE_LENGTH).default(""), instruction: z.string().max(6000).default(""), compositionPens: z.array(semanticPenSchema).max(500).default([]), compositionStrokes: z.array(compositionStrokeSchema).max(500).default([]), machineTarget: machineTargetSchema.nullable().default(null), machineImage: imageSchema.optional(), machineMarks: z.array(machineMarkSchema).max(64).default([]), composePrompt: z.string().max(2000).default(""),
  /** Annotation strokes the user drew on the frame for a transform request (normalized; also drawn on the image). */
  transformMarks: z.array(z.array(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })).min(1).max(64)).max(64).default([]), inspection: inspectionInputSchema.nullable().default(null), explore: exploreInputSchema.nullable().default(null), }).superRefine((input, ctx) => {
  const ids = input.compositionPens.map(p => p.id);
  if (new Set(ids).size !== ids.length || input.compositionStrokes.some(s => (s.tool === "semantic" || s.tool === "interaction") && (!s.semanticPenId || !ids.includes(s.semanticPenId)))) ctx.addIssue({ code: "custom", message: "펜 의미와 획을 연결하지 못했습니다." });
  if (input.compositionStrokes.some(s => s.tool === "interaction" && input.compositionPens.find(p => p.id === s.semanticPenId)?.kind !== "interaction")) ctx.addIssue({ code: "custom", message: "Interaction annotation과 펜 의미를 확인해주세요." });
});
export type GeneratedCode = z.infer<typeof generatedSchema>;
export type Stroke = { points: Point[]; color: string; width: number; opacity: number; tool: "pen" | "eraser"; semanticPen?: SemanticPen };
export type Artwork = { strokes: Stroke[]; photo: string | null; name: string; revision: number };
export type Viewport = { zoom: number; x: number; y: number };
export const ART_WIDTH = 900, ART_HEIGHT = 600;
