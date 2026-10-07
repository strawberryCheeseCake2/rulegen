import { z } from "zod";
export const pointSchema = z.object({ x: z.number(), y: z.number() });
export type Point = z.infer<typeof pointSchema>;
export const featureSchema = z.object({
  id: z.string().max(80), label: z.string().min(1).max(100), description: z.string().max(600),
  region: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), w: z.number().min(.01).max(1), h: z.number().min(.01).max(1) }),
});
export const imageSchema = z.string().max(8_000_000).regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/);
export const sceneBoxSchema = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), w: z.number().min(.01).max(1), h: z.number().min(.01).max(1) });
export const sceneReferenceSchema = z.object({ id: z.string().min(1).max(60), image: imageSchema, features: z.array(featureSchema).max(8) });
export type SceneReference = z.infer<typeof sceneReferenceSchema>;
export const analysisSchema = z.object({ features: z.array(featureSchema).min(2).max(6) });
const parameterBase = { id: z.string().min(1).max(80), label: z.string().min(1).max(80) };
export const parameterSchema = z.union([
  z.object({ ...parameterBase, type: z.literal("number"), value: z.number().finite(), min: z.number().finite(), max: z.number().finite(), step: z.number().min(.00000001), unit: z.string().max(20) }),
  z.object({ ...parameterBase, type: z.literal("color"), value: z.string().regex(/^#[0-9a-fA-F]{6}$/) }),
  z.object({ ...parameterBase, type: z.literal("select"), value: z.string().max(80), options: z.array(z.string().min(1).max(80)).min(2).max(8) }),
  z.object({ ...parameterBase, type: z.literal("toggle"), value: z.boolean() }),
]);
export const implementationSchema = z.object({ id: z.string().min(1).max(80), label: z.string().min(1).max(80), description: z.string().max(1500), parameters: z.array(parameterSchema).max(8) });
export const widgetKindSchema = z.enum(["spatial", "temporal", "stylistic", "object"]);
export const activeWidgetKindSchema = z.enum(["spatial", "stylistic", "object"]);
export const objectPrimitiveSchema = z.enum(["rectangle", "ellipse", "line", "triangle", "path"]);
export const subfeatureSchema = z.object({ region: sceneBoxSchema.optional(), parentSubfeatureId: z.string().max(80).nullable().optional(), targetSubfeatureIds: z.array(z.string().max(80)).max(6).optional(), kind: widgetKindSchema.optional(), primitive: objectPrimitiveSchema.nullable().optional(), id: z.string().min(1).max(80), label: z.string().min(1).max(80), selectedImplementation: z.string().min(1).max(80), implementations: z.array(implementationSchema).min(1).max(4) });
export const groupSchema = z.object({ featureId: z.string().max(80), title: z.string().max(120), subfeatures: z.array(subfeatureSchema).min(1).max(6) });
export type Parameter = z.infer<typeof parameterSchema>;
export type Subfeature = z.infer<typeof subfeatureSchema>;
export const rulesSchema = z.object({ groups: z.array(groupSchema).min(1).max(8) });
// Algorithms are independent assets; widgets store references, never pen snapshots.
export const sceneWidgetDragSchema = z.union([
  z.object({ type: z.literal("new"), kind: activeWidgetKindSchema, primitive: objectPrimitiveSchema.optional(), sourceOwner: z.string().max(80) }),
  z.object({ type: z.literal("node"), nodeId: z.string().max(60), sourceOwner: z.string().max(80) }),
]);
export const sceneNodeSchema = z.object({
  definitionId: z.string().max(60).nullable().optional(),
  source: z.object({ feature: featureSchema, box: sceneBoxSchema, referenceId: z.string().max(60).nullable() }).optional(),
  id: z.string().min(1).max(60), label: z.string().min(1).max(100), kind: widgetKindSchema,
  featureId: z.string().max(80).nullable(), sourceSubfeatureId: z.string().max(80).nullable(),
  box: sceneBoxSchema, parentId: z.string().max(60).nullable(), targetIds: z.array(z.string().max(60)).max(64),
  algorithmIds: z.array(z.string().max(60)).max(8), primitive: objectPrimitiveSchema.nullable(),
});
export const sceneAlgorithmSchema = z.object({
  id: z.string().min(1).max(60), featureId: z.string().max(80), subfeatureId: z.string().max(80),
  implementation: implementationSchema,
});
export const constraintSceneSchema = z.object({ references: z.array(sceneReferenceSchema).max(32).optional(), nodes: z.array(sceneNodeSchema).max(64), algorithms: z.array(sceneAlgorithmSchema).max(192) }).superRefine((scene, ctx) => {
  const nodes = new Map(scene.nodes.map(n => [n.id, n]));
  const algorithms = new Set(scene.algorithms.map(a => a.id));
  const issue = (message: string) => ctx.addIssue({ code: "custom", message });
  if (nodes.size !== scene.nodes.length || algorithms.size !== scene.algorithms.length) issue("중복된 위젯 또는 알고리즘 ID입니다.");
  for (const node of scene.nodes) {
    if (node.box.x + node.box.w > 1.000001 || node.box.y + node.box.h > 1.000001) issue("위젯 영역이 프레임을 벗어났습니다.");
    if (node.definitionId && (node.kind !== "object" || !algorithms.has(node.definitionId))) issue("object의 primitive 정의를 확인해주세요.");
    if (new Set(node.algorithmIds).size !== node.algorithmIds.length || node.algorithmIds.some(id => !algorithms.has(id))) issue("위젯의 알고리즘 연결을 확인해주세요.");
    if (new Set(node.targetIds).size !== node.targetIds.length || node.targetIds.some(id => !nodes.has(id) || id === node.id || !["object", "spatial"].includes(nodes.get(id)!.kind))) issue("constraint의 적용 대상을 확인해주세요.");
    if ((node.kind === "object") !== (node.primitive !== null) || (node.kind === "object" && (node.algorithmIds.length || node.targetIds.length))) issue("object는 알고리즘을 가진 constraint가 조절하는 primitive입니다.");
    if (node.kind === "spatial" && node.targetIds.length) issue("spatial constraint는 포함 관계로 적용 대상을 지정합니다.");
    if (node.parentId && (nodes.get(node.parentId)?.kind !== "spatial" || !["object", "spatial"].includes(node.kind))) issue("object와 spatial group만 spatial constraint에 포함할 수 있습니다.");
    const seen = new Set([node.id]); let parent = node.parentId;
    while (parent && nodes.has(parent)) { if (seen.has(parent)) { issue("spatial group의 순환 포함은 허용되지 않습니다."); break; } seen.add(parent); parent = nodes.get(parent)!.parentId; }
  }
  for (const algorithm of scene.algorithms) {
    const ids = algorithm.implementation.parameters.map(p => p.id);
    if (new Set(ids).size !== ids.length) issue("중복된 알고리즘 파라미터입니다.");
    for (const p of algorithm.implementation.parameters) {
      if (p.type === "number" && (p.min >= p.max || p.value < p.min || p.value > p.max || p.step > p.max - p.min)) issue("알고리즘 파라미터 범위가 올바르지 않습니다.");
      if (p.type === "select" && !p.options.includes(p.value)) issue("알고리즘 선택값이 올바르지 않습니다.");
    }
  }
});
export type WidgetKind = z.infer<typeof widgetKindSchema>;
export type SceneNode = z.infer<typeof sceneNodeSchema>;
export type SceneAlgorithm = z.infer<typeof sceneAlgorithmSchema>;
export type ConstraintScene = z.infer<typeof constraintSceneSchema>;
export type SceneBox = z.infer<typeof sceneBoxSchema>;
export const codeSchema = z.object({ title: z.string().max(150), explanation: z.string().max(1000), code: z.string().min(1).max(64000) });
export const bindingSchema = z.object({ featureId: z.string().max(80), subfeatureId: z.string().max(80), implementationId: z.string().max(80), parameterId: z.string().max(80), key: z.string().max(1200), type: z.enum(["number", "color", "select", "toggle"]) });
export const generatedSchema = codeSchema.extend({ code: z.string().min(1).max(200000), bindings: z.array(bindingSchema).max(4096).default([]) });
export type ParameterBinding = z.infer<typeof bindingSchema>;
export const settingsSchema = z.object({ spacing: z.number().min(5).max(80), size: z.number().min(8).max(100), spread: z.number().min(0).max(90), variation: z.number().min(0).max(80), taper: z.number().min(0).max(100), color: z.string().regex(/^#[0-9a-fA-F]{6}$/) });
export const primitiveSchema = z.object({ kind: z.enum(["line", "ellipse", "bezier", "triangle", "branch"]), coords: z.array(z.number().min(-2).max(2)).min(4).max(8), weight: z.number().min(.005).max(.2), filled: z.boolean(), depth: z.number().int().min(0).max(4) });
export const brushShapeSchema = z.object({ name: z.string().min(1).max(100), description: z.string().max(1000), settings: settingsSchema, primitives: z.array(primitiveSchema).min(1).max(16) });
// Accepted only to recover projects saved by the older procedural-pen workflow.
export const legacyPenAlgorithmSchema = z.object({ featureId: z.string().max(80), subfeatureId: z.string().max(80), implementationId: z.string().max(80), label: z.string().max(100), description: z.string().max(1500), parameters: z.array(parameterSchema).max(8), dynamics: z.record(z.string(), z.string()).optional(), reverse: z.boolean().optional(), penName: z.string().max(100).optional() });
export const brushSchema = brushShapeSchema.extend({ algorithm: legacyPenAlgorithmSchema.optional(), modifiers: z.array(legacyPenAlgorithmSchema).max(3).optional() });
export const semanticPenSchema = z.object({
  id: z.string().min(1).max(80), name: z.string().min(1).max(100), color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  sourceSketchId: z.string().max(80), feature: featureSchema, subfeatureId: z.string().max(80), subfeatureLabel: z.string().max(80),
  implementation: implementationSchema, meaning: z.string().max(2000),
});
export type SemanticPen = z.infer<typeof semanticPenSchema>;
export const compositionStrokeSchema = z.object({ id: z.string().min(1).max(80), tool: z.enum(["pencil", "semantic", "eraser", "brush"]), color: z.string().max(80), width: z.number().min(.1).max(100), opacity: z.number().min(0).max(1), points: z.array(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })).min(1).max(128), semanticPenId: z.string().max(80).nullable() });
export const MAX_RESULT_STROKES = 128;
export const annotationSchema = z.object({ id: z.string().min(1).max(80), points: z.array(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })).min(2).max(600) });
export const revisionProposalSchema = z.object({ summary: z.string().min(1).max(1500), features: z.array(featureSchema).min(1).max(8), groups: z.array(groupSchema).min(1).max(8) });
export const clarificationSchema = z.object({ clarification: z.string().trim().min(1).max(2000) });
export const compositionPromptSchema = z.object({ prompt: z.string().trim().min(1).max(2000) });
export type ResultAnnotation = z.infer<typeof annotationSchema>;
export type RevisionProposal = z.infer<typeof revisionProposalSchema>;
export const requestSchema = z.object({ widgetBudget: z.number().int().min(1).max(7).default(7), scene: constraintSceneSchema.optional(), intent: z.enum(["analyze", "rules", "subfeature", "code", "brush", "compose", "compose-prompt", "constraint-code", "revision", "clarification"]), image: imageSchema.optional(), resultImage: imageSchema.optional(), annotations: z.array(annotationSchema).max(MAX_RESULT_STROKES).default([]), revisionSummary: z.string().max(1500).default(""), features: z.array(featureSchema).max(8).default([]), groups: z.array(groupSchema).max(8).default([]), targetFeatureId: z.string().max(80).default(""), targetSubfeatureId: z.string().max(80).default(""), alternative: z.boolean().default(false), previous: z.string().max(200000).default(""), instruction: z.string().max(2000).default(""), brushDescription: z.string().max(2000).default(""), compositionPens: z.array(semanticPenSchema).max(500).default([]), compositionStrokes: z.array(compositionStrokeSchema).max(500).default([]) }).superRefine((input, ctx) => {
  const ids = input.compositionPens.map(p => p.id);
  if (new Set(ids).size !== ids.length || input.compositionStrokes.some(s => s.tool === "semantic" && (!s.semanticPenId || !ids.includes(s.semanticPenId)))) ctx.addIssue({ code: "custom", message: "펜 의미와 획을 연결하지 못했습니다." });
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
