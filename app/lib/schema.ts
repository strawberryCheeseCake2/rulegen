import { z } from "zod";
export const pointSchema = z.object({ x: z.number(), y: z.number() });
export type Point = z.infer<typeof pointSchema>;
export const featureSchema = z.object({
  id: z.string().max(80), label: z.string().min(1).max(100), description: z.string().max(600),
  region: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), w: z.number().min(.01).max(1), h: z.number().min(.01).max(1) }),
});
export const analysisSchema = z.object({ features: z.array(featureSchema).min(2).max(6) });
const parameterBase = { id: z.string().min(1).max(80), label: z.string().min(1).max(80) };
export const parameterSchema = z.union([
  z.object({ ...parameterBase, type: z.literal("number"), value: z.number().finite(), min: z.number().finite(), max: z.number().finite(), step: z.number().min(.00000001), unit: z.string().max(20) }),
  z.object({ ...parameterBase, type: z.literal("color"), value: z.string().regex(/^#[0-9a-fA-F]{6}$/) }),
  z.object({ ...parameterBase, type: z.literal("select"), value: z.string().max(80), options: z.array(z.string().min(1).max(80)).min(2).max(8) }),
  z.object({ ...parameterBase, type: z.literal("toggle"), value: z.boolean() }),
]);
export const implementationSchema = z.object({ id: z.string().min(1).max(80), label: z.string().min(1).max(80), description: z.string().max(1500), parameters: z.array(parameterSchema).max(8) });
export const subfeatureSchema = z.object({ id: z.string().min(1).max(80), label: z.string().min(1).max(80), selectedImplementation: z.string().min(1).max(80), implementations: z.array(implementationSchema).min(1).max(4) });
export const groupSchema = z.object({ featureId: z.string().max(80), title: z.string().max(120), subfeatures: z.array(subfeatureSchema).min(1).max(6) });
export type Parameter = z.infer<typeof parameterSchema>;
export type Subfeature = z.infer<typeof subfeatureSchema>;
export const rulesSchema = z.object({ groups: z.array(groupSchema).min(1).max(8) });
export const MAX_CODE_LENGTH = 120000;
export const codeSchema = z.object({ title: z.string().max(150), explanation: z.string().max(1000), code: z.string().min(1).max(MAX_CODE_LENGTH) });
export const bindingSchema = z.object({ featureId: z.string().max(80), subfeatureId: z.string().max(80), implementationId: z.string().max(80), parameterId: z.string().max(80), key: z.string().max(1200), type: z.enum(["number", "color", "select", "toggle"]) });
export const MAX_MACHINE_STATES = 32;
export const MAX_MACHINE_TRANSITIONS = 128;
export const sceneStateSchema = z.object({
  id: z.string().min(1).max(80), label: z.string().min(1).max(100), description: z.string().max(1000),
  features: z.array(featureSchema).min(1).max(8), groups: z.array(groupSchema).max(8),
});
export const stateTransitionSchema = z.object({
  id: z.string().min(1).max(80), from: z.string().min(1).max(80), to: z.string().min(1).max(80),
  label: z.string().trim().min(1).max(100), trigger: z.enum(["after", "event"]), afterMs: z.number().int().min(100).max(60000),
});
export const stateMachineSchema = z.object({
  initialState: z.string().min(1).max(80), states: z.array(sceneStateSchema).min(1).max(MAX_MACHINE_STATES), transitions: z.array(stateTransitionSchema).max(MAX_MACHINE_TRANSITIONS),
}).superRefine((machine, ctx) => {
  const ids = machine.states.map(state => state.id);
  const invalid = () => ctx.addIssue({ code: "custom", message: "상태와 전이, constraint의 연결 또는 파라미터 범위를 확인해주세요." });
  const duplicate = (values: string[]) => new Set(values).size !== values.length;
  if (duplicate(ids) || !ids.includes(machine.initialState) || duplicate(machine.transitions.map(t => t.id))) invalid();
  if (machine.transitions.some(t => !ids.includes(t.from) || !ids.includes(t.to))) invalid();
  for (const state of machine.states) {
    const featureIds = state.features.map(feature => feature.id);
    if (duplicate(featureIds) || duplicate(state.groups.map(group => group.featureId)) || state.groups.some(group => !featureIds.includes(group.featureId))) invalid();
    if (state.features.some(f => f.region.x + f.region.w > 1.000001 || f.region.y + f.region.h > 1.000001)) invalid();
    for (const group of state.groups) {
      if (duplicate(group.subfeatures.map(sub => sub.id))) invalid();
      for (const sub of group.subfeatures) {
        if (duplicate(sub.implementations.map(method => method.id)) || !sub.implementations.some(method => method.id === sub.selectedImplementation)) invalid();
        for (const method of sub.implementations) {
          if (duplicate(method.parameters.map(parameter => parameter.id))) invalid();
          for (const parameter of method.parameters) {
            if (parameter.type === "number" && (parameter.min >= parameter.max || parameter.value < parameter.min || parameter.value > parameter.max || parameter.step > parameter.max - parameter.min)) invalid();
            if (parameter.type === "select" && !parameter.options.includes(parameter.value)) invalid();
          }
        }
      }
    }
  }
});
export type SceneState = z.infer<typeof sceneStateSchema>;
export type StateMachine = z.infer<typeof stateMachineSchema>;
export const generatedSchema = codeSchema.extend({ bindings: z.array(bindingSchema).max(384).default([]), stateMachine: stateMachineSchema.nullable().default(null) });
export type ParameterBinding = z.infer<typeof bindingSchema>;
export const settingsSchema = z.object({ spacing: z.number().min(5).max(80), size: z.number().min(8).max(100), spread: z.number().min(0).max(90), variation: z.number().min(0).max(80), taper: z.number().min(0).max(100), color: z.string().regex(/^#[0-9a-fA-F]{6}$/) });
export const primitiveSchema = z.object({ kind: z.enum(["line", "ellipse", "bezier", "triangle", "branch"]), coords: z.array(z.number().min(-2).max(2)).min(4).max(8), weight: z.number().min(.005).max(.2), filled: z.boolean(), depth: z.number().int().min(0).max(4) });
export const brushShapeSchema = z.object({ name: z.string().min(1).max(100), description: z.string().max(1000), settings: settingsSchema, primitives: z.array(primitiveSchema).min(1).max(16) });
// Accepted only to recover projects saved by the older procedural-pen workflow.
export const legacyPenAlgorithmSchema = z.object({ featureId: z.string().max(80), subfeatureId: z.string().max(80), implementationId: z.string().max(80), label: z.string().max(100), description: z.string().max(1500), parameters: z.array(parameterSchema).max(8), dynamics: z.record(z.string(), z.string()).optional(), reverse: z.boolean().optional(), penName: z.string().max(100).optional() });
export const brushSchema = brushShapeSchema.extend({ algorithm: legacyPenAlgorithmSchema.optional(), modifiers: z.array(legacyPenAlgorithmSchema).max(3).optional() });
export const semanticPenSchema = z.object({
  kind: z.enum(["algorithm", "interaction"]).default("algorithm"),
  id: z.string().min(1).max(80), name: z.string().min(1).max(100), color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  sourceSketchId: z.string().max(80), feature: featureSchema, subfeatureId: z.string().max(80), subfeatureLabel: z.string().max(80),
  implementation: implementationSchema, meaning: z.string().max(2000),
});
export type SemanticPen = z.infer<typeof semanticPenSchema>;
export const compositionStrokeSchema = z.object({ id: z.string().min(1).max(80), tool: z.enum(["pencil", "semantic", "interaction", "eraser", "brush"]), color: z.string().max(80), width: z.number().min(.1).max(100), opacity: z.number().min(0).max(1), points: z.array(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })).min(1).max(128), semanticPenId: z.string().max(80).nullable() });
export const imageSchema = z.string().max(8_000_000).regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/);
export const MAX_RESULT_STROKES = 128;
export const annotationSchema = z.object({ id: z.string().min(1).max(80), points: z.array(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })).min(2).max(600) });
export const revisionProposalSchema = z.object({ summary: z.string().min(1).max(1500), features: z.array(featureSchema).min(1).max(8), groups: z.array(groupSchema).min(1).max(8) });
export const clarificationSchema = z.object({ clarification: z.string().trim().min(1).max(2000) });
export const compositionPromptSchema = z.object({ prompt: z.string().trim().min(1).max(2000) });
export type ResultAnnotation = z.infer<typeof annotationSchema>;
export type RevisionProposal = z.infer<typeof revisionProposalSchema>;
export const requestSchema = z.object({ intent: z.enum(["analyze", "rules", "subfeature", "code", "brush", "compose", "compose-prompt", "revision", "clarification", "state-machine"]), withStateMachine: z.boolean().default(false), stateMachine: stateMachineSchema.nullable().default(null), image: imageSchema.optional(), resultImage: imageSchema.optional(), annotations: z.array(annotationSchema).max(MAX_RESULT_STROKES).default([]), revisionSummary: z.string().max(1500).default(""), features: z.array(featureSchema).max(8).default([]), groups: z.array(groupSchema).max(8).default([]), targetFeatureId: z.string().max(80).default(""), targetSubfeatureId: z.string().max(80).default(""), alternative: z.boolean().default(false), previous: z.string().max(MAX_CODE_LENGTH).default(""), instruction: z.string().max(2000).default(""), brushDescription: z.string().max(2000).default(""), compositionPens: z.array(semanticPenSchema).max(500).default([]), compositionStrokes: z.array(compositionStrokeSchema).max(500).default([]) }).superRefine((input, ctx) => {
  const ids = input.compositionPens.map(p => p.id);
  if (new Set(ids).size !== ids.length || input.compositionStrokes.some(s => (s.tool === "semantic" || s.tool === "interaction") && (!s.semanticPenId || !ids.includes(s.semanticPenId)))) ctx.addIssue({ code: "custom", message: "펜 의미와 획을 연결하지 못했습니다." });
  if (input.compositionStrokes.some(s => s.tool === "interaction" && input.compositionPens.find(p => p.id === s.semanticPenId)?.kind !== "interaction")) ctx.addIssue({ code: "custom", message: "Interaction annotation과 펜 의미를 확인해주세요." });
});
export type Feature = z.infer<typeof featureSchema>;
export type RuleGroup = z.infer<typeof groupSchema>;
export type GeneratedCode = z.infer<typeof generatedSchema>;
export type BrushSettings = z.infer<typeof settingsSchema>;
export type BrushRecipe = z.infer<typeof brushSchema>;
export type Stroke = { points: Point[]; color: string; width: number; opacity: number; tool: "pen" | "eraser" | "brush"; brush?: BrushRecipe; semanticPen?: SemanticPen };
export type Artwork = { strokes: Stroke[]; photo: string | null; name: string; revision: number };
export type Viewport = { zoom: number; x: number; y: number };
export const ART_WIDTH = 900, ART_HEIGHT = 600;
