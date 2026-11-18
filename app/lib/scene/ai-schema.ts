import { z } from "zod";
import { colorValueSchema, MAX_CONSTRAINT_INPUTS, MAX_CONSTRAINT_DRAGS, MAX_PARAMS, pointerInputSchema, valueDragSchema, effectSchema, idSchema, MAX_ALGORITHM_PARAMS, MAX_NODE_STATES, MAX_NODE_TRANSITIONS, MAX_SCENE_NODES, nodeKindSchema, nodeTransitionSchema, numberValueSchema, regionSchema, selectValueSchema, toggleValueSchema } from "./schema";

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
export const aiParamSchema = z.object({ id: idSchema, label: z.string().min(1).max(80), effect: effectSchema, description: z.string().max(600), value: aiValueSchema });
/**
 * A constraint: the relationship that determines one property of the node (`property`: exactly the property's name),
 * how it depends on the others (`description`), the params it is tuned by (sliders or algorithm blocks), the pointer
 * attributes it reads and the values a drag on the object adjusts.
 */
export const aiConstraintSchema = z.object({ id: idSchema, property: z.string().min(1).max(80), description: z.string().max(1000), params: z.array(aiParamSchema).max(MAX_PARAMS),
  inputs: z.array(pointerInputSchema).max(MAX_CONSTRAINT_INPUTS),
  /** The values a mouse drag on its object adjusts (`off` is the user's, never the model's). */
  drags: z.array(valueDragSchema.omit({ off: true })).max(MAX_CONSTRAINT_DRAGS) });
/** Constraints a model may give one node. */
export const MAX_AI_CONSTRAINTS = 10;
/** A node's FSM: states list the node's constraint ids in evaluation order; transitions are taken by dispatched events. */
export const aiMachineSchema = z.object({
  initialState: idSchema,
  states: z.array(z.object({ id: idSchema, label: z.string().min(1).max(100), description: z.string().max(1000), constraintIds: z.array(idSchema).max(MAX_AI_CONSTRAINTS) })).min(1).max(MAX_NODE_STATES),
  transitions: z.array(nodeTransitionSchema).max(MAX_NODE_TRANSITIONS),
});
export const aiNodeSchema = z.object({
  id: idSchema, kind: nodeKindSchema, parentId: idSchema.nullable(), name: z.string().min(1).max(100), description: z.string().max(600),
  primitive: z.string().max(40), region: regionSchema, constraints: z.array(aiConstraintSchema).max(MAX_AI_CONSTRAINTS), machine: aiMachineSchema.nullable(),
});
export type AIAlgorithm = z.infer<typeof aiAlgorithmSchema>;
export type AINode = z.infer<typeof aiNodeSchema>;
export type AIMachine = z.infer<typeof aiMachineSchema>;
export type AIParam = z.infer<typeof aiParamSchema>;
export type AIConstraint = z.infer<typeof aiConstraintSchema>;

const algorithms = z.array(aiAlgorithmSchema).max(24);
/** Extracted/composed scenes generate repetition procedurally, so they stay small. */
export const MAX_AI_SCENE_NODES = 24;
/** extract / compose: the scene found in (or composed from) a sketch. */
export const aiSceneSchema = z.object({ algorithms, nodes: z.array(aiNodeSchema).min(1).max(MAX_AI_SCENE_NODES) });
/** transform: one new or regenerated constraint (or one param of it) for one node. */
export const aiTransformSchema = z.object({ algorithms, constraint: aiConstraintSchema });
/** split: one constraint divided into the meaningful algorithms inside it, each a constraint of its own (or why it cannot be). */
export const aiSplitSchema = z.object({ divisible: z.boolean(), reason: z.string().max(400), algorithms, parts: z.array(aiConstraintSchema).max(5) });
/**
 * state-machine: one node's FSM, with the constraints its states need that the node does not have yet (new ids; a
 * state may evaluate the node's existing constraints and these, in its own order).
 */
export const aiNodeMachineSchema = z.object({ algorithms, constraints: z.array(aiConstraintSchema).max(MAX_AI_CONSTRAINTS), machine: aiMachineSchema });
/** machine-refine: the refined machine and the Compose prompt rewritten to describe it. */
export const aiMachineRefineSchema = aiNodeMachineSchema.extend({ composePrompt: z.string().max(2000) });
/** revision: a complete proposed scene. */
export const aiRevisionSchema = z.object({ summary: z.string().min(1).max(1500), algorithms, nodes: z.array(aiNodeSchema).min(1).max(MAX_SCENE_NODES) });
export type AIScene = z.infer<typeof aiSceneSchema>;
