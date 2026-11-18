import { z } from "zod";

// Collection / Object scene model, as declarative FSMs.
// A scene is a flat list of nodes linked by parentId (Figma-like layers). Each collection and object has its own FSM: states
// that list, in evaluation order, the constraints that determine its properties
// (each constraint controls one property), and event transitions between them.
// A constraint is tuned by params, each one slider (number, color, option or toggle).

export const MAX_SCENE_NODES = 48;
/** Layer levels, root = 1 (e.g. scene → tree → crown → branch cluster → leaves). */
export const MAX_NESTING_DEPTH = 5;
/** Params of one constraint. */
export const MAX_PARAMS = 8;
/** Constraints of one node. */
export const MAX_CONSTRAINTS = 16;
/** Params across a node's constraints (their ids are unique per node, so live keys are `nodeId/paramId/…`). */
export const MAX_NODE_PARAMS = 32;
/** Scalar paths inside a param: a param is one scalar, so its path is always empty. */
export const MAX_VALUE_DEPTH = 0;
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

/** A param's value: one slider. */
export type Value = ScalarValue;
export const valueSchema = scalarValueSchema;

export const effectSchema = z.enum(["spatial", "stylistic", "temporal"]);
export type Effect = z.infer<typeof effectSchema>;
/**
 * A direct manipulation interface made for one param: a small p5 widget,
 * written for what the param means, shown in a proxy frame. Dragging it
 * sets the param's scalars on the target node. UI only, never seen by the code.
 */
export const MAX_HANDLE_CODE = 8000;
export const paramHandleSchema = z.object({
  /** The widget as written (`rulegenHandle(function (h) { … })`). */
  code: z.string().min(1).max(MAX_HANDLE_CODE),
  /** The same code with the runtime guards in place, as it runs. */
  prepared: z.string().min(1).max(MAX_HANDLE_CODE * 4),
  /** The scalars it drives: always the param's own value (`[[]]`). */
  paths: z.array(z.array(idSchema).max(MAX_VALUE_DEPTH)).min(1).max(8),
  /** What the gesture does, shown above the widget ("Drag to spread the branches"). */
  hint: z.string().max(120).default(""),
});
export type ParamHandle = z.infer<typeof paramHandleSchema>;
/**
 * A parameter a constraint is tuned by: one slider (number, color, option, toggle). Its id is unique across the node,
 * so its live key is `nodeId/paramId`.
 */
export const paramSchema = z.object({ id: idSchema, label: z.string().min(1).max(80), effect: effectSchema, description: z.string().max(600), value: valueSchema,
  /** Its direct manipulation interface (absent: none; a handle that does not parse, e.g. an older kind, is dropped). */
  handle: paramHandleSchema.optional().catch(undefined) });
export type Param = z.infer<typeof paramSchema>;
/** What of the user's pointer (mouse or touch) a constraint reads, in canvas pixels / ms. */
export const POINTER_SOURCES = {
  x: "mouse x", y: "mouse y", dx: "mouse Δx (movement)", dy: "mouse Δy (movement)", speed: "mouse speed", direction: "drag direction",
  distance: "drag distance", duration: "press duration", pressed: "mouse pressed",
} as const;
export type PointerSource = keyof typeof POINTER_SOURCES;
export const pointerSourceSchema = z.enum(Object.keys(POINTER_SOURCES) as [PointerSource, ...PointerSource[]]);
export const MAX_CONSTRAINT_INPUTS = 6;
/**
 * A pointer attribute a constraint reads, and which of its values it drives: `paramId` is one of the constraint's own
 * params (empty: the computed property itself, e.g. a position that follows the mouse); `how` says how in a few words
 * ("scales the stroke width").
 */
export const pointerInputSchema = z.object({ source: pointerSourceSchema, paramId: z.string().max(80), how: z.string().max(160) });
export type PointerInput = z.infer<typeof pointerInputSchema>;
/**
 * What of the mouse, while the user drags on the drawn object, moves a value: its x (left → right), its y (down → up)
 * or its speed (slow → fast). Every value of the object mapped to one moves at once, each by its own attribute.
 */
export const DRAG_SOURCES = ["x", "y", "speed"] as const;
export type DragSource = (typeof DRAG_SOURCES)[number];
/**
 * How far mouse x or y moves the value: "direct" by the pixels dragged, for a value in pixels; "ratio" in proportion
 * (dragged the object's size: twice the value); "range" across the value's min–max over the object's size. Speed always
 * spans the value's range from still to a fast stroke.
 */
export const DRAG_MODES = ["direct", "ratio", "range"] as const;
export type DragMode = (typeof DRAG_MODES)[number];
export const MAX_CONSTRAINT_DRAGS = 2;
/**
 * A value of the constraint that dragging on its object adjusts: one of its number params (`paramId`), the mouse attribute that moves it (`source`), how far, whether it runs the
 * other way (`invert`: left, down or slow makes it larger), and what it does in a few words. The user can turn it off
 * (`off`): the value is then adjusted by its slider only.
 */
export const valueDragSchema = z.object({ paramId: z.string().max(80), source: z.enum(DRAG_SOURCES), mode: z.enum(DRAG_MODES), invert: z.boolean(), how: z.string().max(160),
  off: z.boolean().optional() });
export type ValueDrag = z.infer<typeof valueDragSchema>;
/**
 * A constraint (as in a declarative FSM): the relationship that determines ONE property of its node ("position",
 * "size", "rotation", "color" …). `property` is exactly the name of the property it controls (the code computes it
 * with the constraint's compute function and stores it in the owner's data under that name); `description` says how
 * the property depends on other nodes, the input or time. Its `params` (sliders) tune the
 * computation. The states of the node's FSM list which constraints apply, in evaluation order (dependencies first).
 */
export const constraintSchema = z.object({ id: idSchema, property: z.string().min(1).max(80), description: z.string().max(1000), params: z.array(paramSchema).max(MAX_PARAMS),
  /** The pointer attributes it reads (absent or empty: it does not follow the pointer). */
  inputs: z.array(pointerInputSchema).max(MAX_CONSTRAINT_INPUTS).optional().catch(undefined),
  /** The values a mouse drag on its object adjusts (absent or empty: none). */
  drags: z.array(valueDragSchema).max(MAX_CONSTRAINT_DRAGS).optional().catch(undefined) });
export type Constraint = z.infer<typeof constraintSchema>;

/**
 * One phase of a node's behavior. Its constraints (ids of the node's constraints) are evaluated in this order whenever
 * the code evaluates the node's FSM in this state, each result stored before the next one is computed.
 */
export const nodeStateSchema = z.object({
  id: idSchema, label: z.string().min(1).max(100), description: z.string().max(1000),
  constraintIds: z.array(idSchema).max(MAX_CONSTRAINTS),
});
/** A transition the code takes by dispatching `event` while the node is in `from`. `label` says why ("pointer enters the circle"). */
export const nodeTransitionSchema = z.object({
  id: idSchema, from: idSchema, to: idSchema, event: idSchema, label: z.string().trim().min(1).max(100),
});
/**
 * A node's FSM: an initial state, its states and the transitions between them. A node without one (`machine: null`)
 * behaves as a single implicit state that evaluates all its constraints in order (see `nodeMachine`).
 */
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
  /** The relationships that determine its properties (one property each); its FSM's states order them. */
  constraints: z.array(constraintSchema).max(MAX_CONSTRAINTS).default([]),
  visible: z.boolean().default(true), machine: nodeMachineSchema.nullable().default(null),
  /** The brush (reusable collection) this node is, or was stamped from. */
  brushId: z.string().max(80).optional(),
  /** The node id its code module uses (a copy stamped from a brush keeps the brush's id). Absent = its own id. */
  codeId: z.string().max(80).optional(),
  /** Root nodes: the code module that draws it. Absent = the module named after its own id. */
  codeModule: z.string().max(120).optional(),
});
export type SceneNode = z.infer<typeof sceneNodeSchema>;

export const sceneShapeSchema = z.object({ nodes: z.array(sceneNodeSchema).max(MAX_SCENE_NODES).default([]) });
export type Scene = z.infer<typeof sceneShapeSchema>;
export const emptyScene = (): Scene => ({ nodes: [] });

/** Live code bindings: one per param of every node (`path` = [paramId]). */
export const sceneBindingSchema = z.object({ key: z.string().max(1200), nodeId: idSchema, path: z.array(idSchema).min(1).max(MAX_VALUE_DEPTH + 1), type: z.enum(["number", "color", "select", "toggle"]) });
export type SceneBinding = z.infer<typeof sceneBindingSchema>;
