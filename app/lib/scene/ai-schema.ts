import { z } from "zod";
import { colorValueSchema, effectSchema, idSchema, MAX_ALGORITHM_PARAMS, MAX_NODE_STATES, MAX_NODE_TRANSITIONS, MAX_PROPERTIES, nodeKindSchema, nodeTransitionSchema, numberValueSchema, regionSchema, selectValueSchema, toggleValueSchema } from "./schema";

// Structured-output schemas sent to the model. They are deliberately
// non-recursive (strict JSON schema friendly): nested algorithms are given by
// reference and expanded with their defaults on the client.

const aiScalar = z.union([numberValueSchema, colorValueSchema, selectValueSchema, toggleValueSchema]);
export const aiAlgorithmRefSchema = z.object({ type: z.literal("algorithm-ref"), algorithmId: idSchema });
const aiArgValue = z.union([numberValueSchema, colorValueSchema, selectValueSchema, toggleValueSchema, aiAlgorithmRefSchema]);
export const aiCallSchema = z.object({ type: z.literal("algorithm"), algorithmId: idSchema, args: z.array(z.object({ id: idSchema, value: aiArgValue })).max(MAX_ALGORITHM_PARAMS) });
export const aiValueSchema = z.union([numberValueSchema, colorValueSchema, selectValueSchema, toggleValueSchema, aiCallSchema]);
export type AIValue = z.infer<typeof aiValueSchema>;
export type AIArgValue = z.infer<typeof aiArgValue>;
export { aiScalar as aiScalarSchema };

export const aiAlgorithmSchema = z.object({
  id: idSchema, name: z.string().min(1).max(100), description: z.string().max(1500),
  params: z.array(z.object({ id: idSchema, label: z.string().min(1).max(80), description: z.string().max(600), value: aiArgValue })).max(MAX_ALGORITHM_PARAMS),
});
export const aiPropertySchema = z.object({ id: idSchema, label: z.string().min(1).max(80), effect: effectSchema, description: z.string().max(600), value: aiValueSchema });
export const aiTransformationSchema = z.object({ id: idSchema, label: z.string().max(100), description: z.string().max(1000), properties: z.array(aiPropertySchema).max(MAX_PROPERTIES) });
/** Semantic transformations a model may stack on one node. */
export const MAX_AI_TRANSFORMATIONS = 10;
export const aiMachineSchema = z.object({
  initialState: idSchema,
  states: z.array(z.object({ id: idSchema, label: z.string().min(1).max(100), description: z.string().max(1000), values: z.array(z.object({ propertyId: idSchema, value: aiValueSchema })).max(MAX_PROPERTIES) })).min(1).max(MAX_NODE_STATES),
  transitions: z.array(nodeTransitionSchema).max(MAX_NODE_TRANSITIONS),
});
export const aiNodeSchema = z.object({
  id: idSchema, kind: nodeKindSchema, parentId: idSchema.nullable(), name: z.string().min(1).max(100), description: z.string().max(600),
  primitive: z.string().max(40), region: regionSchema, transformations: z.array(aiTransformationSchema).max(MAX_AI_TRANSFORMATIONS), machine: aiMachineSchema.nullable(),
});
export type AIAlgorithm = z.infer<typeof aiAlgorithmSchema>;
export type AINode = z.infer<typeof aiNodeSchema>;
export type AIMachine = z.infer<typeof aiMachineSchema>;
export type AITransformation = z.infer<typeof aiTransformationSchema>;

const algorithms = z.array(aiAlgorithmSchema).max(24);
/** Composed scenes generate repetition procedurally, so they stay small. */
export const MAX_AI_SCENE_NODES = 24;
/** A scene as the model writes it. */
export const aiSceneSchema = z.object({ algorithms, nodes: z.array(aiNodeSchema).min(1).max(MAX_AI_SCENE_NODES) });
/** transform: one new or regenerated semantic transformation for one node. */
export const aiTransformSchema = z.object({ algorithms, transformation: aiTransformationSchema });
/** Independent transformations one sketch is decomposed into (each becomes a minimal example and a pen). */
export const MAX_DECOMPOSED = 10;
const subject = z.object({ name: z.string().min(1).max(100), description: z.string().max(600), primitive: z.string().max(40) });
/** decompose: the sketch as a list of independent semantic transformations, each with the subject it acts on. */
export const aiDecompositionSchema = z.object({ algorithms, transformations: z.array(aiTransformationSchema.extend({
  /** What it acts on: one object, or a collection (with the plain member it arranges/varies). */
  subject: subject.extend({ kind: nodeKindSchema }), member: subject.nullable(),
  /** Where the evidence is in the sketch (normalized), so the example keeps its proportions. */
  region: regionSchema,
})).min(1).max(MAX_DECOMPOSED) });
export type AIDecomposition = z.infer<typeof aiDecompositionSchema>;
/** compose: a scene whose nodes take transformations from pens (by pen id, in order) before their own. */
export const aiComposeSchema = z.object({ algorithms, nodes: z.array(aiNodeSchema.extend({ pens: z.array(z.string().max(80)).max(MAX_AI_TRANSFORMATIONS) })).min(1).max(MAX_AI_SCENE_NODES) });
export type AICompose = z.infer<typeof aiComposeSchema>;
export type AIScene = z.infer<typeof aiSceneSchema>;
