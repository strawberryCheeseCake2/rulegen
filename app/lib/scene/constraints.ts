import type { PointerInput, Param, SceneNode, Constraint, ValueDrag } from "./schema";
import { DRAG_MODES, DRAG_SOURCES, MAX_CONSTRAINT_DRAGS, POINTER_SOURCES } from "./schema";
import { valueAt } from "./values";
import { MAX_NODE_PARAMS, MAX_PARAMS, MAX_CONSTRAINTS } from "./schema";

// A node's constraints: each determines one property of the node (its `property`), tuned by its params (sliders and
// algorithm blocks). The node's FSM states list which constraints apply, in evaluation order (see machines.ts), so
// adding, removing or moving a constraint keeps the states' lists in step. Param ids are unique across the whole node,
// so live keys stay `nodeId/paramId/…`.

/** What a constraint is called on screen: the property it controls. */
export const constraintName = (constraint: Pick<Constraint, "property" | "id">) => constraint.property || constraint.id;

/** Every param of a node, in constraint order. */
export const nodeParams = (node: SceneNode): Param[] => node.constraints.flatMap(constraint => constraint.params);
export const findParam = (node: SceneNode, paramId: string) => nodeParams(node).find(param => param.id === paramId);
export const paramOwner = (node: SceneNode, paramId: string) => node.constraints.find(constraint => constraint.params.some(param => param.id === paramId));
export const findConstraint = (node: SceneNode, constraintId: string | null | undefined) => node.constraints.find(constraint => constraint.id === constraintId);

/**
 * A constraint's pointer inputs that still drive something of it: one of its params (ids renamed by `renames`)
 * or the constraint itself (empty `paramId`); each pointer attribute → value once.
 */
export function keptInputs(constraint: Constraint, renames: ReadonlyMap<string, string> = new Map()): PointerInput[] {
  const own = new Set(constraint.params.map(param => param.id)), seen = new Set<string>();
  return (constraint.inputs ?? []).flatMap(input => {
    const paramId = input.paramId ? renames.get(input.paramId) ?? input.paramId : "", key = `${input.source}\n${paramId}`;
    if (!(input.source in POINTER_SOURCES) || (paramId && !own.has(paramId)) || seen.has(key)) return [];
    seen.add(key); return [{ source: input.source, paramId, how: input.how.trim() }];
  });
}
/**
 * A constraint's value drags that still adjust a number of it: one of its params (ids renamed by `renames`) and
 * the argument path into it, each value once and each mouse attribute once.
 * `previous`: the drags it had before it was made again, whose being turned off is kept for the same value.
 */
export function keptDrags(constraint: Constraint, renames: ReadonlyMap<string, string> = new Map(), previous: ValueDrag[] = []): ValueDrag[] {
  const values = new Set<string>(), sources = new Set<string>();
  return (constraint.drags ?? []).flatMap(drag => {
    const paramId = renames.get(drag.paramId) ?? drag.paramId, path = drag.path.split("/").map(part => part.trim()).filter(Boolean);
    const param = constraint.params.find(item => item.id === paramId), value = param && valueAt(param.value, path), key = `${paramId}\n${path.join("/")}`;
    if (!value || value.type !== "number" || !DRAG_SOURCES.includes(drag.source) || !DRAG_MODES.includes(drag.mode) || values.has(key) || sources.has(drag.source)) return [];
    values.add(key); sources.add(drag.source);
    const off = drag.off ?? previous.find(old => old.paramId === paramId && old.path === path.join("/"))?.off;
    return [{ paramId, path: path.join("/"), source: drag.source, mode: drag.mode, invert: Boolean(drag.invert), how: drag.how.trim(), ...(off ? { off: true } : {}) }];
  }).slice(0, MAX_CONSTRAINT_DRAGS);
}
/** A value drag of a node, where it lives: its constraint, its place there, and what it is called. */
export type DragLink = ValueDrag & { constraintId: string; constraintIndex: number; dragIndex: number; constraint: string; param: string };
/**
 * The value drags of a node's stack, in order. `active`: only those on (not turned off), one per mouse attribute (the
 * first constraint's: a drag on the object moves one value by its x, one by its y, one by its speed).
 */
export function dragLinks(constraints: Constraint[], active = false): DragLink[] {
  const all = constraints.flatMap((constraint, constraintIndex) => keptDrags(constraint).map((drag, dragIndex) => {
    const param = constraint.params.find(item => item.id === drag.paramId), arg = drag.path ? ` · ${drag.path.split("/").join(" · ")}` : "";
    return { ...drag, constraintId: constraint.id, constraintIndex, dragIndex, constraint: constraintName(constraint), param: `${param?.label ?? drag.paramId}${arg}` }; }));
  return active ? all.filter((drag, i, list) => !drag.off && list.findIndex(other => !other.off && other.source === drag.source) === i) : all;
}
/** Turn a value drag of a constraint off (its value is then adjusted by its param only) or on again. */
export const setDragOff = (node: SceneNode, constraintId: string, dragIndex: number, off: boolean): SceneNode => updateConstraint(node, constraintId, constraint => ({ ...constraint,
  drags: keptDrags(constraint).map((drag, i) => i !== dragIndex ? drag : off ? { ...drag, off: true } : (({ off: _off, ...rest }) => rest)(drag)) }));
/** Where the pointer goes in a node's stack: each pointer attribute, the constraint (and its value) it drives. */
export type PointerLink = PointerInput & { constraintId: string; index: number; constraint: string; param: string };
export function pointerLinks(constraints: Constraint[]): PointerLink[] {
  return constraints.flatMap((constraint, index) => keptInputs(constraint).map(input => ({ ...input, constraintId: constraint.id, index,
    constraint: constraintName(constraint), param: constraint.params.find(param => param.id === input.paramId)?.label ?? "" })));
}

/** Edit or drop (return null) params wherever they live. */
export function mapParams(node: SceneNode, edit: (param: Param, constraint: Constraint) => Param | null): SceneNode {
  return { ...node, constraints: node.constraints.map(constraint => ({ ...constraint,
    params: constraint.params.flatMap(param => { const next = edit(param, constraint); return next ? [next] : []; }) })) };
}
export const updateParam = (node: SceneNode, paramId: string, edit: (param: Param) => Param) => mapParams(node, param => param.id === paramId ? edit(param) : param);
export function updateConstraint(node: SceneNode, constraintId: string, edit: (constraint: Constraint) => Constraint): SceneNode {
  return { ...node, constraints: node.constraints.map(constraint => constraint.id === constraintId ? edit(constraint) : constraint) };
}

const slug = (base: string, fallback: string) => base.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "").slice(0, 70) || fallback;
export function uniqueParamId(node: SceneNode, base: string) {
  const root = slug(base, "param"); let id = root, suffix = 2;
  while (findParam(node, id)) id = `${root}-${suffix++}`;
  return id;
}
export function uniqueConstraintId(node: SceneNode, base: string) {
  const root = slug(base, "constraint"); let id = root, suffix = 2;
  while (findConstraint(node, id)) id = `${root}-${suffix++}`;
  return id;
}

export const canAddConstraint = (node: SceneNode) => node.constraints.length < MAX_CONSTRAINTS;
/** Room for one more param in this constraint (or, without one, anywhere new). */
export function canAddParam(node: SceneNode, constraintId?: string | null) {
  if (nodeParams(node).length >= MAX_NODE_PARAMS) return false;
  const target = findConstraint(node, constraintId);
  return target ? target.params.length < MAX_PARAMS : canAddConstraint(node) || node.constraints.some(item => item.params.length < MAX_PARAMS);
}

/**
 * Add a constraint (its id made unique) before `beforeId` (none: at the end of the node's constraints). With a machine it
 * joins the state `stateId` at the same place in that state's order, or, without one, every state (it applies everywhere).
 */
export function addConstraint(node: SceneNode, constraint: Partial<Constraint> = {}, options: { stateId?: string | null; beforeId?: string | null } = {}): { node: SceneNode; id: string } {
  if (!canAddConstraint(node)) throw new Error(`A node can have at most ${MAX_CONSTRAINTS} constraints.`);
  const id = uniqueConstraintId(node, constraint.id || constraint.property || "constraint");
  const placed: Constraint = { property: "property", description: "", params: [], ...constraint, id };
  const insert = <T,>(list: T[], at: number, item: T) => { const next = [...list]; next.splice(at < 0 ? next.length : at, 0, item); return next; };
  const constraints = insert(node.constraints, node.constraints.findIndex(item => item.id === options.beforeId), placed);
  const machine = node.machine && { ...node.machine, states: node.machine.states.map(state => !options.stateId || state.id === options.stateId
    ? { ...state, constraintIds: insert(state.constraintIds, options.beforeId ? state.constraintIds.indexOf(options.beforeId) : -1, id) } : state) };
  return { node: { ...node, constraints, machine }, id };
}
/** Drop a constraint: it leaves every state of the machine too. */
export function removeConstraint(node: SceneNode, constraintId: string): SceneNode {
  return { ...node, constraints: node.constraints.filter(item => item.id !== constraintId),
    machine: node.machine && { ...node.machine, states: node.machine.states.map(state => ({ ...state, constraintIds: state.constraintIds.filter(id => id !== constraintId) })) } };
}
/** Reorder: in the evaluation order of the state `stateId`, else in the node's declaration order. */
export function moveConstraint(node: SceneNode, constraintId: string, offset: number, stateId?: string | null): SceneNode {
  const move = <T,>(list: T[], from: number) => { const to = from + offset; if (from < 0 || to < 0 || to >= list.length) return list; const next = [...list]; const [moved] = next.splice(from, 1); next.splice(to, 0, moved); return next; };
  const state = stateId ? node.machine?.states.find(item => item.id === stateId) : undefined;
  if (state) return { ...node, machine: { ...node.machine!, states: node.machine!.states.map(item => item.id === state.id ? { ...item, constraintIds: move(item.constraintIds, item.constraintIds.indexOf(constraintId)) } : item) } };
  return { ...node, constraints: move(node.constraints, node.constraints.findIndex(item => item.id === constraintId)) };
}

/** Room in `node` for `constraint` brought over from another node. */
export const canTakeConstraint = (node: SceneNode, constraint: Constraint) =>
  canAddConstraint(node) && nodeParams(node).length + constraint.params.length <= MAX_NODE_PARAMS;
/**
 * A constraint brought over from another node, put before `beforeId` (none: at the end). Its id and its
 * param ids are made unique in this node, since state values and live keys address params by id.
 */
export function takeConstraint(node: SceneNode, constraint: Constraint, beforeId?: string | null): SceneNode {
  if (!canTakeConstraint(node, constraint)) throw new Error(`“${node.name}” has no room for “${constraintName(constraint)}”.`);
  const used = new Set(nodeParams(node).map(param => param.id));
  const params = constraint.params.map(param => {
    let id = param.id, suffix = 2; while (used.has(id)) id = `${param.id}-${suffix++}`;
    used.add(id); return { ...param, id };
  });
  // It joins every state of this node (at the same place before `beforeId`).
  return addConstraint(node, { ...constraint, params }, { beforeId }).node;
}

/**
 * Add a param (its id made unique for the node) to a constraint; without
 * a target it goes to the last constraint with room, or a new one.
 */
export function appendParam(node: SceneNode, param: Param, constraintId?: string | null, newProperty = "property"): { node: SceneNode; paramId: string } {
  if (nodeParams(node).length >= MAX_NODE_PARAMS) throw new Error(`A node can have at most ${MAX_NODE_PARAMS} params.`);
  let next = node, target = findConstraint(node, constraintId) || [...node.constraints].reverse().find(item => !constraintId && item.params.length < MAX_PARAMS);
  if (!target) {
    if (constraintId) throw new Error("Could not find the constraint to add the param to.");
    const added = addConstraint(node, { property: newProperty }); next = added.node; target = findConstraint(next, added.id)!;
  }
  if (target.params.length >= MAX_PARAMS) throw new Error(`A constraint can have at most ${MAX_PARAMS} params.`);
  const paramId = uniqueParamId(next, param.id);
  return { node: updateConstraint(next, target.id, item => ({ ...item, params: [...item.params, { ...param, id: paramId }] })), paramId };
}

/**
 * Place an AI-generated constraint: replace one param (`paramId`), replace one constraint keeping its id and where the
 * states have it (`constraintId`), or add it as a new one (to the state `stateId`, else to every state).
 */
export function placeConstraint(node: SceneNode, generated: Constraint, target: { constraintId?: string; paramId?: string; stateId?: string | null }): SceneNode {
  if (target.paramId) {
    const replacement = generated.params.find(param => param.id === target.paramId);
    if (!replacement || generated.params.length !== 1 || !findParam(node, target.paramId)) throw new Error("The generated param does not match the selection. Try again.");
    // What of the pointer drives it comes with it; the rest of its constraint's inputs stay.
    const owner = paramOwner(node, target.paramId)!, inputs = [...(owner.inputs ?? []).filter(input => input.paramId !== target.paramId), ...keptInputs(generated).filter(input => input.paramId === target.paramId)];
    // So does how a drag adjusts it (the param's other drags stay, a mouse attribute taken by another of its values stays with that one).
    const drags = [...(owner.drags ?? []).filter(drag => drag.paramId !== target.paramId), ...keptDrags(generated).filter(drag => drag.paramId === target.paramId)];
    return updateConstraint(updateParam(node, target.paramId, () => replacement), owner.id, constraint => ({ ...constraint, inputs: keptInputs({ ...constraint, inputs }),
      drags: keptDrags({ ...constraint, drags }, new Map(), owner.drags) }));
  }
  if (target.constraintId && !findConstraint(node, target.constraintId)) throw new Error("Could not find the constraint to regenerate.");
  const others = node.constraints.filter(item => item.id !== target.constraintId);
  const taken = new Set(others.flatMap(item => item.params.map(param => param.id)));
  const renames = new Map<string, string>();
  const params = generated.params.map(param => {
    let id = param.id, suffix = 2;
    while (taken.has(id)) id = `${param.id.slice(0, 70)}-${suffix++}`;
    taken.add(id); if (!renames.has(param.id)) renames.set(param.id, id); return { ...param, id };
  });
  if (others.flatMap(item => item.params).length + params.length > MAX_NODE_PARAMS) throw new Error(`A node can have at most ${MAX_NODE_PARAMS} params.`);
  const before = findConstraint(node, target.constraintId)?.drags ?? [];
  const placed = { ...generated, params, inputs: keptInputs({ ...generated, params }, renames), drags: keptDrags({ ...generated, params }, renames, before) };
  if (target.constraintId) return { ...node, constraints: node.constraints.map(item => item.id === target.constraintId ? { ...placed, id: item.id } : item) };
  return addConstraint(node, placed, { stateId: target.stateId }).node;
}
