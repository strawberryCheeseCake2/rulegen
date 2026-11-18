import { z } from "zod";
import { colorValueSchema, MAX_CONSTRAINT_INPUTS, MAX_CONSTRAINT_DRAGS, MAX_PARAMS, pointerInputSchema, valueDragSchema, effectSchema, idSchema, MAX_NODE_STATES, MAX_NODE_TRANSITIONS, MAX_SCENE_NODES, nodeKindSchema, nodeTransitionSchema, numberValueSchema, regionSchema, selectValueSchema, toggleValueSchema } from "./schema";

// Structured-output schemas sent to the model (strict JSON schema friendly).

const aiScalar = z.union([numberValueSchema, colorValueSchema, selectValueSchema, toggleValueSchema]);
export { aiScalar as aiScalarSchema };

/** A param: one slider (number, color, option or toggle). */
export const aiParamSchema = z.object({ id: idSchema, label: z.string().min(1).max(80), effect: effectSchema, description: z.string().max(600), value: aiScalar });
/**
 * A constraint: the relationship that determines one property of the node (`property`: exactly the property's name),
 * how it depends on the others (`description`), the params it is tuned by (sliders), the pointer
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
export type AINode = z.infer<typeof aiNodeSchema>;
export type AIMachine = z.infer<typeof aiMachineSchema>;
export type AIParam = z.infer<typeof aiParamSchema>;
export type AIConstraint = z.infer<typeof aiConstraintSchema>;

/** Extracted/composed scenes generate repetition procedurally, so they stay small. */
export const MAX_AI_SCENE_NODES = 24;
/** extract / compose: the scene found in (or composed from) a sketch. */
export const aiSceneSchema = z.object({ nodes: z.array(aiNodeSchema).min(1).max(MAX_AI_SCENE_NODES) });
/** transform: one new or regenerated constraint (or one param of it) for one node. */
export const aiTransformSchema = z.object({ constraint: aiConstraintSchema });
/** split: one constraint divided into the meaningful computations inside it, each a constraint of its own (or why it cannot be). */
export const aiSplitSchema = z.object({ divisible: z.boolean(), reason: z.string().max(400), parts: z.array(aiConstraintSchema).max(5) });
/**
 * state-machine: one node's FSM, with the constraints its states need that the node does not have yet (new ids; a
 * state may evaluate the node's existing constraints and these, in its own order).
 */
export const aiNodeMachineSchema = z.object({ constraints: z.array(aiConstraintSchema).max(MAX_AI_CONSTRAINTS), machine: aiMachineSchema });
/** machine-refine: the refined machine and the Compose prompt rewritten to describe it. */
export const aiMachineRefineSchema = aiNodeMachineSchema.extend({ composePrompt: z.string().max(2000) });
/** revision: a complete proposed scene. */
export const aiRevisionSchema = z.object({ summary: z.string().min(1).max(1500), nodes: z.array(aiNodeSchema).min(1).max(MAX_SCENE_NODES) });
export type AIScene = z.infer<typeof aiSceneSchema>;
