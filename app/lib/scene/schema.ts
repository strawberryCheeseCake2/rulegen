import { z } from "zod";

// Collection / Object scene model.
// A scene is a flat list of nodes linked by parentId (Figma-like layers) plus a
// reusable algorithm library. Each node stacks semantic transformations whose
// properties hold a scalar value (slider, color, …) or an algorithm call whose
// arguments can themselves be scalars or other algorithm calls.

export const MAX_SCENE_NODES = 48;
/** Layer levels, root = 1 (e.g. scene → tree → crown → branch cluster → leaves). */
export const MAX_NESTING_DEPTH = 5;
export const MAX_ALGORITHMS = 96;
/** Per semantic transformation. */
export const MAX_PROPERTIES = 8;
export const MAX_TRANSFORMATIONS = 12;
/** Across all of a node's transformations (property ids are unique per node). */
export const MAX_NODE_PROPERTIES = 32;
export const MAX_ALGORITHM_PARAMS = 8;
export const MAX_VALUE_DEPTH = 4;
export const MAX_NODE_STATES = 32;
export const MAX_NODE_TRANSITIONS = 128;

export const idSchema = z.string().min(1).max(80);
export const regionSchema = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), w: z.number().min(.01).max(1), h: z.number().min(.01).max(1) });
export type Region = z.infer<typeof regionSchema>;

export const numberValueSchema = z.object({ type: z.literal("number"), value: z.number().finite(), min: z.number().finite(), max: z.number().finite(), step: z.number().min(.00000001), unit: z.string().max(20) });
export const colorValueSchema = z.object({ type: z.literal("color"), value: z.string().regex(/^#[0-9a-fA-F]{6}$/) });
export const selectValueSchema = z.object({ type: z.literal("select"), value: z.string().max(80), options: z.array(z.string().min(1).max(80)).min(2).max(8) });
export const toggleValueSchema = z.object({ type: z.literal("toggle"), value: z.boolean() });
export const scalarValueSchema = z.union([numberValueSchema, colorValueSchema, selectValueSchema, toggleValueSchema]);
export type NumberValue = z.infer<typeof numberValueSchema>;
export type ScalarValue = z.infer<typeof scalarValueSchema>;
export type ScalarType = ScalarValue["type"];

export type AlgorithmArg = { id: string; value: Value };
export type AlgorithmCall = { type: "algorithm"; algorithmId: string; args: AlgorithmArg[] };
export type Value = ScalarValue | AlgorithmCall;
export const valueSchema: z.ZodType<Value> = z.lazy(() => z.union([numberValueSchema, colorValueSchema, selectValueSchema, toggleValueSchema, algorithmCallSchema]));
export const algorithmCallSchema: z.ZodType<AlgorithmCall> = z.object({
  type: z.literal("algorithm"), algorithmId: idSchema,
  args: z.array(z.object({ id: idSchema, value: valueSchema })).max(MAX_ALGORITHM_PARAMS),
});

/** A reusable implementation. Its parameter values are defaults for new calls. */
export const algorithmParamSchema = z.object({ id: idSchema, label: z.string().min(1).max(80), description: z.string().max(600), value: valueSchema });
export const algorithmSchema = z.object({ id: idSchema, name: z.string().min(1).max(100), description: z.string().max(1500), params: z.array(algorithmParamSchema).max(MAX_ALGORITHM_PARAMS) });
export type AlgorithmParam = z.infer<typeof algorithmParamSchema>;
export type Algorithm = z.infer<typeof algorithmSchema>;

export const effectSchema = z.enum(["spatial", "stylistic", "temporal"]);
export type Effect = z.infer<typeof effectSchema>;
/**
 * A direct manipulation interface made for one property: a small p5 widget,
 * written for what the property means, shown in a proxy frame. Dragging it
 * sets the property's scalars on the target node. UI only, never seen by the code.
 */
export const MAX_HANDLE_CODE = 8000;
export const propertyHandleSchema = z.object({
  /** The widget as written (`rulegenHandle(function (h) { … })`). */
  code: z.string().min(1).max(MAX_HANDLE_CODE),
  /** The same code with the runtime guards in place, as it runs. */
  prepared: z.string().min(1).max(MAX_HANDLE_CODE * 4),
  /** The scalars it drives: argument ids leading to each (empty: the property's own scalar). */
  paths: z.array(z.array(idSchema).max(MAX_VALUE_DEPTH)).min(1).max(8),
  /** What the gesture does, shown above the widget ("끌어서 가지를 벌리기"). */
  hint: z.string().max(120).default(""),
});
export type PropertyHandle = z.infer<typeof propertyHandleSchema>;
export const propertySchema = z.object({ id: idSchema, label: z.string().min(1).max(80), effect: effectSchema, description: z.string().max(600), value: valueSchema,
  /** Its direct manipulation interface (absent: none; a handle that does not parse, e.g. an older kind, is dropped). */
  handle: propertyHandleSchema.optional().catch(undefined) });
export type Property = z.infer<typeof propertySchema>;
/** One semantic layer of a node ("Radial growth", "Wave propagation" …). A node stacks several, applied in order. */
export const transformationSchema = z.object({ id: idSchema, label: z.string().max(100), description: z.string().max(1000), properties: z.array(propertySchema).max(MAX_PROPERTIES) });
export type SemanticTransformation = z.infer<typeof transformationSchema>;

export const nodeStateSchema = z.object({
  id: idSchema, label: z.string().min(1).max(100), description: z.string().max(1000),
  values: z.array(z.object({ propertyId: idSchema, value: valueSchema })).max(MAX_PROPERTIES),
});
export const nodeTransitionSchema = z.object({
  id: idSchema, from: idSchema, to: idSchema, label: z.string().trim().min(1).max(100),
  trigger: z.enum(["after", "event"]), afterMs: z.number().int().min(100).max(60000),
});
export const nodeMachineSchema = z.object({
  initialState: idSchema, states: z.array(nodeStateSchema).min(1).max(MAX_NODE_STATES), transitions: z.array(nodeTransitionSchema).max(MAX_NODE_TRANSITIONS),
});
export type NodeState = z.infer<typeof nodeStateSchema>;
export type NodeTransition = z.infer<typeof nodeTransitionSchema>;
export type NodeMachine = z.infer<typeof nodeMachineSchema>;

export const nodeKindSchema = z.enum(["collection", "object"]);
export type NodeKind = z.infer<typeof nodeKindSchema>;
export const sceneNodeSchema = z.object({
  id: idSchema, kind: nodeKindSchema, parentId: idSchema.nullable().default(null),
  name: z.string().min(1).max(100), description: z.string().max(600).default(""),
  primitive: z.string().max(40).default(""), region: regionSchema,
  transformations: z.array(transformationSchema).max(MAX_TRANSFORMATIONS).default([]),
  visible: z.boolean().default(true), machine: nodeMachineSchema.nullable().default(null),
  /** The brush (reusable collection) this node is, or was stamped from. */
  brushId: z.string().max(80).optional(),
  /** The node id its code module uses (a copy stamped from a brush keeps the brush's id). Absent = its own id. */
  codeId: z.string().max(80).optional(),
  /** Root nodes: the code module that draws it. Absent = the module named after its own id. */
  codeModule: z.string().max(120).optional(),
});
export type SceneNode = z.infer<typeof sceneNodeSchema>;

export const sceneShapeSchema = z.object({ nodes: z.array(sceneNodeSchema).max(MAX_SCENE_NODES).default([]), algorithms: z.array(algorithmSchema).max(MAX_ALGORITHMS).default([]) });
export type Scene = z.infer<typeof sceneShapeSchema>;
export const emptyScene = (): Scene => ({ nodes: [], algorithms: [] });

/** Live code bindings: one per scalar leaf of every node property. */
export const sceneBindingSchema = z.object({ key: z.string().max(1200), nodeId: idSchema, path: z.array(idSchema).min(1).max(MAX_VALUE_DEPTH + 1), type: z.enum(["number", "color", "select", "toggle"]) });
export type SceneBinding = z.infer<typeof sceneBindingSchema>;
