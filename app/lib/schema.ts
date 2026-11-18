import { z } from "zod";
import { idSchema, paramSchema, sceneBindingSchema, constraintSchema } from "./scene/schema";
import { sceneSchema } from "./scene/validate";
import { composeTagSchema, MAX_COMPOSE_TAGS, tagTargetSchema } from "./compose-tags";
import { markStyleSchema, MAX_MARKS, overlaySchema } from "./inspection";
import { alignToolSchema, emptyIdeal, idealStateSchema, MAX_KIT_TOOLS, MAX_SPECS, MAX_VARS, runtimeVarSchema, tagWidgetSchema } from "./alignment";
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
export const AI_INTENTS = ["extract", "transform", "state-machine", "machine-refine", "code", "compose", "compose-prompt", "clarification", "revision", "inspect", "handles", "concern", "explore", "split", "align-kit", "align", "tag-revise", "tag-widget"] as const;
const inspectScalar = z.union([z.number(), z.string().max(200), z.boolean()]);
/** Targeted inspection input: the brush's nodes, its param rows and the recorded steps. */
export const inspectionInputSchema = z.object({
  brushName: z.string().max(100), nodeIds: z.array(idSchema).min(1).max(48),
  params: z.array(z.object({ key: z.string().max(1200), nodeId: idSchema, constraintId: z.string().max(80), constraint: z.string().max(100), paramId: idSchema, param: z.string().max(100), type: z.string().max(20) })).max(400),
  steps: z.array(z.object({ id: z.number().int(), nodeId: z.string().max(80).nullable(), from: z.string().max(80).nullable(), to: z.string().max(80).nullable(), transitionId: z.string().max(80).nullable(), values: z.record(z.string().max(1200), inspectScalar),
    /** Machine states and the brush roots' m.store at that step. */
    runtime: z.object({ states: z.record(z.string().max(80), z.object({ id: z.string().max(80), elapsed: z.number() })), stores: z.record(z.string().max(80), z.unknown()) }).nullable().default(null) })).max(20),
  cursor: z.number().int().nullable(),
  marks: z.array(z.array(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })).min(1).max(64)).max(MAX_MARKS),
  /** Each mark's color, width and opacity, by index. */
  markStyles: z.array(markStyleSchema).max(MAX_MARKS).default([]),
  /**
   * Rebuilding a targeted inspection's overlays after a fix was applied: what was applied
   * (its kind, target, value changes; the constraint it added, if any), and the summary and overlays so far.
   */
  update: z.object({ kind: z.enum(["value", "constraint", "add-constraint", "state", "transition"]).default("add-constraint"), title: z.string().max(160), detail: z.string().max(800), nodeId: idSchema,
    targetId: z.string().max(80).default(""), constraintId: z.string().max(80).default(""),
    changes: z.array(z.object({ key: z.string().max(1200), stateId: z.string().max(80), value: inspectScalar })).max(12).default([]),
    summary: z.string().max(1500), overlays: z.array(overlaySchema).max(12) }).nullable().default(null),
  /**
   * Debugging intent alignment on an Execution frame (`marks` are then notes on its picture): the concern, the
   * inspection's summary, the moment of execution the frame shows, and for "align" the state the user drew there
   * with the tools AI made for it (its reading of the intent, the tools, the preset it started from, if any) and the
   * execution state set by hand.
   */
  align: z.object({ concern: z.string().max(2000).default(""), summary: z.string().max(1500).default(""),
    execution: z.object({ summary: z.string().max(1200), axis: z.enum(["run", "input", "steps"]), done: z.number().int().nullable(), count: z.number().int().nullable(), progress: z.number(),
      last: z.string().max(200).default(""), next: z.string().max(200).default(""), stage: z.object({ name: z.string().max(40), explain: z.string().max(300) }).nullable().default(null) }),
    reading: z.string().max(600).default(""), tools: z.array(alignToolSchema).max(MAX_KIT_TOOLS).default([]),
    /** The runtime state the kit refers to (align-kit, a tool asked for: those there are). */
    variables: z.array(runtimeVarSchema).max(MAX_VARS).default([]),
    /** The runtime state what was drawn and said refers to (`@id.field`): each with its fields' expressions and values at the moment. */
    refs: z.array(z.object({ id: z.string().max(24), name: z.string().max(40), means: z.string().max(160),
      fields: z.array(z.object({ ref: z.string().max(40), expr: z.string().max(300), code: z.string().max(400).default(""), now: z.number().nullable() })).max(6) })).max(MAX_VARS).default([]),
    preset: z.object({ title: z.string().max(80), detail: z.string().max(400) }).nullable().default(null),
    ideal: idealStateSchema.default(emptyIdeal),
    /**
     * A widget asked for on the tag of one drawn object (tag-widget): which, where it is now, the rules on its tag with
     * what each reads now, and the widget it has (to change it, when the user says how).
     */
    widget: z.object({ object: z.string().max(40), box: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }),
      rules: z.array(z.object({ aspect: z.string().max(30), expr: z.string().max(300), now: z.number().nullable() })).max(MAX_SPECS),
      current: tagWidgetSchema.nullable().default(null) }).nullable().default(null),
    /** The execution state set by hand with state tools: each key, what it was at the moment and what it is now. */
    state: z.array(z.object({ key: z.string().max(1200), tool: z.string().max(60), name: z.string().max(1200), kind: z.enum(["number", "move"]),
      was: z.unknown(), now: z.unknown(), moved: z.object({ dx: z.number(), dy: z.number() }).optional() })).max(16).default([]) }).nullable().default(null),
});
export type InspectionInput = z.infer<typeof inspectionInputSchema>;
/** Execution frame: the targeted inspection it runs the execution of (its summary and what its overlays show). */
export const exploreInputSchema = z.object({
  summary: z.string().max(1500),
  overlays: z.array(z.object({ name: z.string().max(60), label: z.string().max(300), link: z.object({ kind: z.string().max(20), nodeId: z.string().max(80), id: z.string().max(80) }) })).max(12).default([]),
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
export const requestSchema = z.object({ intent: z.enum(AI_INTENTS), scene: sceneSchema.nullable().default(null), targetNodeId: idSchema.or(z.literal("")).default(""), targetConstraintId: idSchema.or(z.literal("")).default(""), targetParamId: idSchema.or(z.literal("")).default(""), image: imageSchema.optional(), resultImage: imageSchema.optional(), annotations: z.array(annotationSchema).max(MAX_RESULT_STROKES).default([]), revisionSummary: z.string().max(1500).default(""), alternative: z.boolean().default(false), previous: z.string().max(MAX_CODE_LENGTH).default(""), instruction: z.string().max(6000).default(""), compositionPens: z.array(semanticPenSchema).max(500).default([]), compositionStrokes: z.array(compositionStrokeSchema).max(500).default([]), machineTarget: machineTargetSchema.nullable().default(null), machineImage: imageSchema.optional(), machineMarks: z.array(machineMarkSchema).max(64).default([]), composePrompt: z.string().max(2000).default(""),
  /** Compose from the tags on the sketch (what the AI read there) in place of, or with, the text prompt. */
  composeTags: z.array(composeTagSchema).max(MAX_COMPOSE_TAGS).default([]),
  /** tag-revise: the tag and which of its constraints to change. */
  tagTarget: tagTargetSchema.nullable().default(null),
  /** Annotation strokes the user drew on the frame for a transform request (normalized; also drawn on the image). */
  transformMarks: z.array(z.array(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })).min(1).max(64)).max(64).default([]), inspection: inspectionInputSchema.nullable().default(null), explore: exploreInputSchema.nullable().default(null), }).superRefine((input, ctx) => {
  const ids = input.compositionPens.map(p => p.id);
  if (new Set(ids).size !== ids.length || input.compositionStrokes.some(s => (s.tool === "semantic" || s.tool === "interaction") && (!s.semanticPenId || !ids.includes(s.semanticPenId)))) ctx.addIssue({ code: "custom", message: "Could not link the strokes to their pen meanings." });
  if (input.compositionStrokes.some(s => s.tool === "interaction" && input.compositionPens.find(p => p.id === s.semanticPenId)?.kind !== "interaction")) ctx.addIssue({ code: "custom", message: "Check the interaction annotations and pen meanings." });
});
export type GeneratedCode = z.infer<typeof generatedSchema>;
export type Stroke = { points: Point[]; color: string; width: number; opacity: number; tool: "pen" | "eraser"; semanticPen?: SemanticPen };
export type Artwork = { strokes: Stroke[]; photo: string | null; name: string; revision: number };
export type Viewport = { zoom: number; x: number; y: number };
export const ART_WIDTH = 900, ART_HEIGHT = 600;
