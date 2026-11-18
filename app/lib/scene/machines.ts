import type { NodeMachine, NodeState, Constraint, Scene, SceneNode } from "./schema";
import { constraintName } from "./constraints";
import { sceneValues } from "./values";

// Each collection and object has its own FSM (as in a declarative FSM sketch): states that list, in evaluation
// order, the constraints that determine its properties, and event transitions between them. The code evaluates a
// node's FSM (each constraint of the current state computes its property, in order, and stores it before the next one)
// and dispatches events to take transitions. A node without a machine is one implicit state with all its constraints.

export const IMPLICIT_STATE = "default";
/** The node's FSM: its own, or the implicit single state that evaluates every constraint in declaration order. */
export function nodeMachine(node: Pick<SceneNode, "machine" | "constraints">): NodeMachine {
  return node.machine ?? { initialState: IMPLICIT_STATE, states: [{ id: IMPLICIT_STATE, label: "Default", description: "", constraintIds: node.constraints.map(constraint => constraint.id) }], transitions: [] };
}
/** Whether the node has behavior phases of its own (a declared machine), not just the implicit state. */
export const hasMachine = (node: Pick<SceneNode, "machine">) => Boolean(node.machine);
export const findState = (node: Pick<SceneNode, "machine" | "constraints">, stateId: string | null | undefined): NodeState | undefined => nodeMachine(node).states.find(state => state.id === stateId);
/**
 * The constraints a state evaluates, in its order. Without a state (or for an unknown one): every constraint of the
 * node, in declaration order.
 */
export function stateConstraints(node: Pick<SceneNode, "machine" | "constraints">, stateId: string | null | undefined): Constraint[] {
  const state = node.machine?.states.find(item => item.id === stateId);
  if (!state) return node.constraints;
  return state.constraintIds.flatMap(id => node.constraints.filter(constraint => constraint.id === id));
}
/** The states that evaluate a constraint. */
export const statesOf = (node: Pick<SceneNode, "machine" | "constraints">, constraintId: string) => nodeMachine(node).states.filter(state => state.constraintIds.includes(constraintId));

/** Keep the machine consistent with the node's constraints: unknown or repeated constraint ids leave its states. */
export function conformMachine(node: SceneNode): SceneNode {
  if (!node.machine) return node;
  const ids = new Set(node.constraints.map(constraint => constraint.id));
  const states = node.machine.states.map(state => {
    const kept = state.constraintIds.filter((id, i, list) => ids.has(id) && list.indexOf(id) === i);
    return kept.length === state.constraintIds.length ? state : { ...state, constraintIds: kept };
  });
  return states.every((state, i) => state === node.machine!.states[i]) ? node : { ...node, machine: { ...node.machine, states } };
}
/** Include (or leave out) a constraint in a state's evaluation order (`beforeId`: where; none: at the end). */
export function setStateConstraint(node: SceneNode, stateId: string, constraintId: string, included: boolean, beforeId?: string | null): SceneNode {
  if (!node.machine || !node.constraints.some(constraint => constraint.id === constraintId)) return node;
  return { ...node, machine: { ...node.machine, states: node.machine.states.map(state => {
    if (state.id !== stateId) return state;
    const rest = state.constraintIds.filter(id => id !== constraintId);
    if (!included) return { ...state, constraintIds: rest };
    const at = beforeId ? rest.indexOf(beforeId) : -1; rest.splice(at < 0 ? rest.length : at, 0, constraintId);
    return { ...state, constraintIds: rest };
  }) } };
}

export function validateMachine(node: SceneNode, machine: NodeMachine) {
  const ids = machine.states.map(state => state.id), duplicate = (values: string[]) => new Set(values).size !== values.length;
  const constraints = new Set(node.constraints.map(constraint => constraint.id));
  if (duplicate(ids) || !ids.includes(machine.initialState) || duplicate(machine.transitions.map(t => t.id))) throw new Error(`Check the state and transition IDs of ${node.name}.`);
  if (machine.transitions.some(t => !ids.includes(t.from) || !ids.includes(t.to))) throw new Error(`A transition of ${node.name} points to a state that does not exist.`);
  if (duplicate(machine.transitions.map(t => `${t.from}\n${t.event}`))) throw new Error(`${node.name} has two transitions for the same event from one state.`);
  for (const state of machine.states) {
    if (duplicate(state.constraintIds)) throw new Error(`${node.name} · ${state.label} lists a constraint twice.`);
    if (state.constraintIds.some(id => !constraints.has(id))) throw new Error(`${node.name} · ${state.label} refers to a constraint that does not exist.`);
  }
}
/** One line per state: its constraints in evaluation order (for prompts and summaries). */
export const describeStateOrder = (node: SceneNode, state: NodeState) => `${state.label}: ${stateConstraints(node, state.id).map(constraintName).join(" → ") || "(no constraints)"}`;

export const SCENE_START = "// @rulegen-scene:start";
export const SCENE_END = "// @rulegen-scene:end";
export const SCENE_DRIVER_MARK = "// @rulegen-scene-driver";
export const MODULES_START = "// @rulegen-modules:start";
export const MODULES_END = "// @rulegen-modules:end";
const MODULE_END = "// @rulegen-module-end";

/**
 * One instance per root node: which code module draws it and how the node ids
 * written in that module map to this scene's node ids (a stamped copy keeps the
 * ids of the brush it came from in its code, so `codeId` differs from `id`).
 */
export function sceneInstances(scene: Scene) {
  const children = new Map<string, SceneNode[]>();
  for (const node of scene.nodes) if (node.parentId) children.set(node.parentId, [...(children.get(node.parentId) || []), node]);
  const subtree = (node: SceneNode): SceneNode[] => [node, ...(children.get(node.id) || []).flatMap(subtree)];
  return scene.nodes.filter(node => !node.parentId).map(root => ({ root: root.id, module: root.codeModule ?? root.id,
    map: Object.fromEntries(subtree(root).map(node => [node.codeId ?? node.id, node.id])) as Record<string, string> }));
}
export type SceneInstance = ReturnType<typeof sceneInstances>[number];

/** Code written by AI addresses every node by its own id: forget the ids copies borrowed from their brush. */
export function ownCodeIds(scene: Scene): Scene {
  return scene.nodes.some(node => node.codeId !== undefined || node.codeModule !== undefined)
    ? { ...scene, nodes: scene.nodes.map(({ codeId: _codeId, codeModule: _codeModule, ...node }) => node) } : scene;
}

/** A module as stored in a program: marked so it can be lifted out without parsing. */
export const moduleSource = (key: string, factory: string) => `// @rulegen-module ${JSON.stringify(key)}\nrulegenModule(${JSON.stringify(key)}, ${factory});\n${MODULE_END}`;
/** Every module of a program, by key (empty for code without module markers). */
export function programModules(code: string) {
  const start = code.indexOf(MODULES_START), end = code.indexOf(MODULES_END, start);
  const modules = new Map<string, string>();
  if (start < 0 || end < 0) return modules;
  for (const match of code.slice(start, end).matchAll(/\/\/ @rulegen-module ("(?:[^"\\\n]|\\.)*")\n[\s\S]*?\n\/\/ @rulegen-module-end/g)) modules.set(JSON.parse(match[1]) as string, match[0]);
  return modules;
}
export const hasModules = (code: string) => code.includes(MODULES_START) && code.includes(MODULES_END);
/** The same module under another key. */
export function renameModule(text: string, from: string, to: string) {
  return text.replace(`// @rulegen-module ${JSON.stringify(from)}`, `// @rulegen-module ${JSON.stringify(to)}`).replace(`rulegenModule(${JSON.stringify(from)},`, `rulegenModule(${JSON.stringify(to)},`);
}
/** A complete program: host values, runtime, the modules and the host driver. */
export function assembleProgram(scene: Scene, modules: string[], previous?: string) {
  return [sceneBlock(scene, previous ? readBlock(previous)?.block : undefined), SCENE_RUNTIME, MODULES_START, ...modules, MODULES_END, SCENE_DRIVER].join("\n");
}
/** The key a stored module registers under. */
export const moduleKey = (text: string) => { const match = /^\/\/ @rulegen-module ("(?:[^"\\\n]|\\.)*")/.exec(text); return match ? JSON.parse(match[1]) as string : null; };

/** Every node's FSM as the running code needs it (implicit machines included): state order of constraints and event transitions. */
export function machineValues(scene: Scene) {
  return Object.fromEntries(scene.nodes.map(node => { const machine = nodeMachine(node); return [node.id, {
    initialState: machine.initialState, transitions: machine.transitions.map(({ id, from, to, event, label }) => ({ id, from, to, event, label })),
    states: machine.states.map(state => ({ id: state.id, label: state.label, constraints: stateConstraints(node, state.id).map(constraint => ({ id: constraint.id, property: constraint.property })) })),
  }]; }));
}

type Block = { params: Record<string, unknown>; machines: ReturnType<typeof machineValues>; instances: SceneInstance[] };
export function sceneBlock(scene: Scene, previous?: Block) {
  // Old keys stay until code is regenerated, so a structural edit cannot break a running sketch.
  const params = { ...previous?.params, ...sceneValues(scene) };
  return blockText({ params, machines: machineValues(scene), instances: sceneInstances(scene) });
}
const blockText = (block: Block) => `${SCENE_START}\nconst rulegenParams = ${JSON.stringify(block.params, null, 2)};\nconst rulegenMachines = ${JSON.stringify(block.machines, null, 2)};\nconst rulegenInstances = ${JSON.stringify(block.instances, null, 2)};\n${SCENE_END}`;

function readBlock(source: string) {
  const start = source.indexOf(SCENE_START), endMarker = source.indexOf(`\n${SCENE_END}`, start);
  if (start < 0 || endMarker < 0) return null;
  const body = source.slice(start + SCENE_START.length, endMarker + 1).trim();
  const match = /^const rulegenParams\s*=\s*(\{[\s\S]*?\});\nconst rulegenMachines\s*=\s*(\{[\s\S]*?\});\nconst rulegenInstances\s*=\s*(\[[\s\S]*\]);$/.exec(body);
  if (!match) return null;
  try { return { start, end: endMarker + 1 + SCENE_END.length, block: { params: JSON.parse(match[1]), machines: JSON.parse(match[2]), instances: JSON.parse(match[3]) } as Block }; } catch { return null; }
}
/** The program with more values in its scene block (kept by later syncs, as old keys are); null when it has none. */
export function withBlockParams(source: string, params: Record<string, unknown>) {
  const found = readBlock(source);
  if (!found) return null;
  return source.slice(0, found.start) + blockText({ ...found.block, params: { ...found.block.params, ...params } }) + source.slice(found.end);
}
/**
 * A program assembled by an older version, with the current host runtime and
 * driver (they are host code, not the modules'); anything else is left as is.
 */
export function refreshProgram(source: string) {
  const found = readBlock(source), start = source.indexOf(MODULES_START), end = source.indexOf(MODULES_END, start), driver = end < 0 ? -1 : source.indexOf(SCENE_DRIVER_MARK, end);
  if (!found || start < 0 || end < 0 || driver < 0) return source;
  return [source.slice(0, found.end), SCENE_RUNTIME, source.slice(start, end + MODULES_END.length), SCENE_DRIVER].join("\n");
}
/** Patch only the host block: drawing code and hand edits stay intact. */
export function syncScene(source: string, scene: Scene) {
  const found = readBlock(source);
  if (!found) return source;
  return source.slice(0, found.start) + sceneBlock(scene, found.block) + source.slice(found.end);
}
/** The source with the scene's state machines in its host block (a preview's new states and transitions); its values stay. */
export function addHostMachines(source: string, scene: Scene) {
  const found = readBlock(source);
  if (!found) return source;
  return source.slice(0, found.start) + blockText({ ...found.block, machines: machineValues(scene) }) + source.slice(found.end);
}
/** The source with values the scene does not have added to its host block (a preview's new values); existing ones stay. */
export function addHostParams(source: string, params: Record<string, unknown>) {
  const found = readBlock(source);
  if (!found || !Object.keys(params).length) return source;
  return source.slice(0, found.start) + blockText({ ...found.block, params: { ...params, ...found.block.params } }) + source.slice(found.end);
}
export const hasSceneBlock = (source: string) => Boolean(readBlock(source));
/** Current live values of a source's host block (what the sandbox can receive without a reload). */
export const readSceneValues = (source: string) => readBlock(source)?.block ?? null;
/** The source with its host block blanked: equal keys mean only live values differ. */
export function sceneStructureKey(source: string) {
  const found = readBlock(source);
  return found ? source.slice(0, found.start) + SCENE_START + source.slice(found.end) : source;
}

// Portable FSM runtime, shipped in downloads as well as in the sandbox. Each node (collection or object) has an FSM;
// the code gets an owner of it with m.fsm(nodeId) — or m.fsm(nodeId, key) for one of the many items a node draws, each
// with its own current state and data. owner.evaluate(...inputs) computes the current state's constraints in order,
// each storing its result in owner.data[property] before the next one runs; owner.dispatch(event) takes the
// transition declared for that event from the current state. Owners are plain data (state, data), so a step can be
// saved and restored.
export const SCENE_RUNTIME = `
const rulegenModules = {};
function rulegenModule(key, factory) { rulegenModules[key] = factory; }
const rulegenBase = Object.assign({}, rulegenParams);
// The state each node shows (its own owner's, else the owner that changed last), for the State Machine panel.
const rulegenState = {};
// Owners by node id, then by key ("" for the node itself): { state, data }.
let rulegenOwners = {};
let rulegenPlaying = true;
// Set by the host: whether the running code may take transitions now (not while a held step is drawn).
let rulegenFrozen = () => false;
// Set by the host: called after every transition taken ({ nodeId, key, from, to, transitionId, event }).
let rulegenOnTransition = null;
function rulegenApply() { Object.assign(rulegenParams, rulegenBase); }
function rulegenShown(nodeId) {
  const machine = rulegenMachines[nodeId], own = rulegenOwners[nodeId], record = own && (own[''] || own[Object.keys(own)[Object.keys(own).length - 1]]);
  rulegenState[nodeId] = { id: record ? record.state : machine ? machine.initialState : null };
}
function rulegenRecordOf(nodeId, key) {
  const machine = rulegenMachines[nodeId]; if (!machine) throw new Error('Unknown node: ' + nodeId);
  const own = rulegenOwners[nodeId] || (rulegenOwners[nodeId] = {});
  let record = own[key];
  if (!record || !machine.states.some(state => state.id === record.state)) {
    record = own[key] = { state: machine.initialState, data: record && record.data && typeof record.data === 'object' ? record.data : {} };
    rulegenShown(nodeId);
    rulegenFsmEvent('state', nodeId, key, { state: record.state, entered: true });
  }
  return record;
}
/** Take the transition for an event (or a transition id) from the owner's current state; whether one was taken. */
function rulegenTransit(nodeId, key, event) {
  if (rulegenFrozen()) return false;
  const machine = rulegenMachines[nodeId], record = rulegenRecordOf(nodeId, key);
  const transition = machine.transitions.find(item => item.from === record.state && (item.event === event || item.id === event));
  if (!transition) return false;
  const from = record.state;
  rulegenFsmEvent('transition', nodeId, key, { state: from, to: transition.to, event: transition.event, transitionId: transition.id, label: transition.label });
  record.state = transition.to;
  rulegenShown(nodeId);
  rulegenFsmEvent('state', nodeId, key, { state: transition.to, entered: true });
  if (typeof rulegenOnTransition === 'function') rulegenOnTransition({ nodeId, key, from, to: transition.to, transitionId: transition.id, event: transition.event });
  if (typeof p.stateEntered === 'function') p.stateEntered(nodeId, transition.to, key);
  return true;
}
/** Evaluate the owner's current state: each constraint in order, its result stored before the next one is computed. */
function rulegenEvaluate(inst, localId, nodeId, key, owner, inputs) {
  const machine = rulegenMachines[nodeId], record = rulegenRecordOf(nodeId, key);
  const state = machine.states.find(item => item.id === record.state);
  rulegenFsmEvent('state', nodeId, key, { state: state.id });
  const own = inst.handlers.constraints && inst.handlers.constraints[localId];
  for (const constraint of state.constraints) {
    const compute = own && own[constraint.id];
    if (typeof compute !== 'function') throw new Error('No compute function for constraint ' + localId + '/' + constraint.id + ' (return it in constraints["' + localId + '"]["' + constraint.id + '"]).');
    // What the code computed before this constraint (terms, decisions) belongs to the step before it.
    if (typeof rulegenFlushTerms === 'function') rulegenFlushTerms();
    const reads = inst.constraintReads = {};
    let value;
    try { value = compute(owner, ...inputs); } finally { inst.constraintReads = null; }
    record.data[constraint.property] = value;
    rulegenFsmEvent('constraint', nodeId, key, { state: state.id, constraintId: constraint.id, property: constraint.property, value, reads, inputs });
  }
  return record.data;
}
/** UI: put every owner of a node (and the node's own) into a state. */
function rulegenJumpState(nodeId, id) {
  const machine = rulegenMachines[nodeId];
  if (!machine || !machine.states.some(state => state.id === id)) return false;
  const own = rulegenOwners[nodeId] || (rulegenOwners[nodeId] = {});
  if (!own['']) own[''] = { state: id, data: {} };
  for (const key of Object.keys(own)) own[key].state = id;
  rulegenShown(nodeId);
  if (typeof p.stateEntered === 'function') p.stateEntered(nodeId, id, '');
  return true;
}
/** UI: an event (or transition id) for every owner of a node that can take it; whether any did. */
function rulegenEmit(nodeId, event) {
  const own = rulegenOwners[nodeId] || {}, keys = Object.keys(own).length ? Object.keys(own) : [''];
  let taken = false; for (const key of keys) if (rulegenTransit(nodeId, key, event)) taken = true;
  return taken;
}
function rulegenResetStates() { rulegenOwners = {}; for (const nodeId of Object.keys(rulegenMachines)) rulegenShown(nodeId); }
for (const nodeId of Object.keys(rulegenMachines)) rulegenShown(nodeId);
rulegenApply();
`;

// The host owns the canvas, the loop and input; each root node is an instance of
// a code module that only draws and reacts for its own nodes.
export const SCENE_DRIVER = `
${SCENE_DRIVER_MARK}
let rulegenLive = [], rulegenStarted = false;
// What-if values of single drawn items (by item id), set only while an inspection draws a held step.
let rulegenItemValues = {};
const rulegenItemsActive = () => Object.keys(rulegenItemValues).length > 0;
// Fields the modules are driven by (m.field), by "<root>/<field id>": what-if combs of them, set only while an inspection
// draws a held step (each stroke pulls the field along its direction within its radius), and their signature (results
// computed with them are kept apart from the ones without).
let rulegenFieldEdits = {}, rulegenFieldSig = '';
function rulegenSetFieldEdits(edits) {
  const kept = {};
  for (const key of Object.keys(edits && typeof edits === 'object' ? edits : {})) {
    const strokes = (Array.isArray(edits[key]) ? edits[key] : []).filter(stroke => stroke && Array.isArray(stroke.points) && stroke.points.length > 1).slice(0, 24).map(stroke => {
      const points = stroke.points.filter(q => Array.isArray(q) && Number.isFinite(q[0]) && Number.isFinite(q[1])).slice(0, 200), xs = points.map(q => q[0]), ys = points.map(q => q[1]);
      return { points, radius: Math.max(4, Number(stroke.radius) || 60), strength: Math.max(0, Number(stroke.strength) || 1), box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
    }).filter(stroke => stroke.points.length > 1);
    if (strokes.length) kept[key] = strokes;
  }
  rulegenFieldEdits = kept;
  const text = JSON.stringify(kept);
  let hash = 5381; for (let i = 0; i < text.length; i++) hash = ((hash * 33) ^ text.charCodeAt(i)) >>> 0;
  rulegenFieldSig = text === '{}' ? '' : text.length + ':' + hash;
}
/** The direction (radians) and strength of a field's value: an angle, [vx, vy] or { x, y }. */
function rulegenFieldVector(value) {
  if (typeof value === 'number') return { kind: 'angle', angle: value, mag: 1 };
  if (Array.isArray(value)) return { kind: 'array', angle: Math.atan2(Number(value[1]), Number(value[0])), mag: Math.hypot(Number(value[0]), Number(value[1])) };
  if (value && typeof value === 'object' && Number.isFinite(value.x) && Number.isFinite(value.y)) return { kind: 'object', angle: Math.atan2(value.y, value.x), mag: Math.hypot(value.x, value.y) };
  return null;
}
/** A field's value at (x, y) in canvas pixels, combed by the what-if strokes on it; in the form the module's function gives. */
function rulegenFieldAt(key, fn, x, y) {
  const base = fn(x, y), strokes = rulegenFieldEdits[key];
  if (!strokes) return base;
  const v = rulegenFieldVector(base); if (!v || !Number.isFinite(v.angle)) return base;
  let sx = Math.cos(v.angle), sy = Math.sin(v.angle);
  for (const stroke of strokes) {
    const r = stroke.radius, b = stroke.box;
    if (x < b[0] - r || x > b[2] + r || y < b[1] - r || y > b[3] + r) continue;
    for (let i = 1; i < stroke.points.length; i++) {
      const a = stroke.points[i - 1], c = stroke.points[i], dx = c[0] - a[0], dy = c[1] - a[1], length = Math.hypot(dx, dy); if (length < 1e-6) continue;
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (length * length))), d = Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy);
      if (d >= r) continue;
      // Each piece of the stroke pulls in proportion to its length, strongest on the stroke.
      const w = stroke.strength * (1 - d / r) * (1 - d / r) * length / r * 2;
      sx += w * dx / length; sy += w * dy / length;
    }
  }
  const angle = Math.atan2(sy, sx);
  if (v.kind === 'angle') { let turn = angle - v.angle; turn -= Math.round(turn / (2 * Math.PI)) * 2 * Math.PI; return v.angle + turn; }
  const mag = v.mag || 1;
  return v.kind === 'array' ? [Math.cos(angle) * mag, Math.sin(angle) * mag] : { x: Math.cos(angle) * mag, y: Math.sin(angle) * mag };
}
/** Every field the modules drew with, sampled on a grid over the canvas (direction and strength per cell), by "<root>/<field id>". */
function rulegenFieldSamples() {
  const out = {}, w = p.width || 900, h = p.height || 600, cols = 36, rows = 24;
  for (const inst of rulegenLive) for (const [id, field] of inst.fields) {
    const cells = [];
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      let v = null; try { v = rulegenFieldVector(rulegenFieldAt(field.key, field.fn, (i + .5) * w / cols, (j + .5) * h / rows)); } catch (error) { v = null; }
      cells.push(v && Number.isFinite(v.angle) ? [Math.round(v.angle * 100) / 100, Math.round((Number.isFinite(v.mag) ? v.mag : 0) * 100) / 100] : [0, 0]);
    }
    out[field.key] = { root: inst.entry.root, id, cols, rows, w, h, cells, declared: field.declared || 1 };
  }
  return out;
}
// One run of the brush's code, recorded as its execution (only while an exploration frame draws a held moment):
// every FSM step the code takes — a state visit (an owner enters a state, or evaluates the one it is in), each
// constraint that state computes, in order, and each transition — and every drawing call, in the order they run.
// The FSM steps are the steps of the execution (kind 'trace', their data says which). With a budget, drawing calls
// after that many events are not drawn, so the picture is what execution has made up to there; steps are still
// recorded (what comes next). Only the brush explored is recorded (its roots): other brushes draw as usual.
let rulegenRun = null, rulegenShape = null, rulegenInOp = 0, rulegenRunRoot = null, rulegenShowing = false;
const RULEGEN_MAX_EVENTS = 3000;
const RULEGEN_SHAPES = ['ellipse', 'circle', 'rect', 'square', 'line', 'triangle', 'quad', 'arc', 'point', 'bezier', 'curve', 'text', 'image', 'endShape'];
const RULEGEN_VERTICES = { vertex: [0, 1], curveVertex: [0, 1], bezierVertex: [4, 5], quadraticVertex: [2, 3] };
// options.points: each drawing call also keeps a few points of what it draws (canvas pixels), to compare runs mark by mark.
// options.focus: the item followed (m.focus(item) is true for it alone instead of its fallback), so its own steps are taken.
// options.solo: { item, index }: drawing calls of other items (or, without items, other than that event) are drawn faint.
function rulegenRunStart(budget, roots, show, options) { const o = options && typeof options === 'object' ? options : {}, solo = o.solo && typeof o.solo === 'object' ? o.solo : null;
  rulegenRun = { budget: Number.isFinite(budget) ? Math.max(0, Math.round(budget)) : null, total: 0, events: [], label: '', roots: Array.isArray(roots) && roots.length ? roots.map(String) : null, show: Number.isInteger(show) ? show : null, traces: 0, points: Boolean(o.points), lastTrace: null, termsNow: null, testsNow: null, termNames: new Set(),
    focus: o.focus === null || o.focus === undefined ? null : String(o.focus), item: undefined, solo: solo && (solo.item !== null && solo.item !== undefined || Number.isInteger(solo.index)) ? { item: solo.item === null || solo.item === undefined ? null : String(solo.item), index: Number.isInteger(solo.index) ? solo.index : null } : null };
  rulegenShape = null; rulegenPath = []; rulegenWrapContext(p.drawingContext); }
/** Whether the drawing call just recorded is drawn faint: the run follows one mark (solo) and this call is not part of it. */
function rulegenFaint() { const run = rulegenRun, solo = run && run.solo; if (!solo) return false; return !((solo.item !== null && run.item === solo.item) || solo.index === run.total - 1); }
/** Draw with the context faint (or as it is). */
function rulegenDrawFaint(ctx, faint, draw) { if (!faint || !ctx) return draw(); const alpha = ctx.globalAlpha; ctx.globalAlpha = alpha * .12; try { return draw(); } finally { ctx.globalAlpha = alpha; } }
/** Whether the code running now is recorded (a run, and the module drawing is one of its roots). */
const rulegenRunOwn = () => Boolean(rulegenRun) && !rulegenShowing && (!rulegenRun.roots || rulegenRun.roots.includes(rulegenRunRoot));
function rulegenRunEnd() { rulegenFlushTerms(); const run = rulegenRun; rulegenRun = null; rulegenShape = null; return run && { total: run.total, events: run.events, terms: [...run.termNames] }; }
// Inner terms (m.term): what-if scales by "<root>/<name>" (1: as the code makes it; 0: without it), set only while a held step is drawn.
let rulegenTermScales = {};
function rulegenSetTermScales(scales) { const kept = {}; for (const key of Object.keys(scales && typeof scales === 'object' ? scales : {})) { const s = Number(scales[key]); if (Number.isFinite(s) && s !== 1) kept[key] = s; } rulegenTermScales = kept; }
/** A term's value scaled: a number, the numbers of a list, or the x, y of a point; anything else as it is. */
function rulegenScaleTerm(value, s) {
  if (typeof value === 'number') return value * s;
  if (Array.isArray(value)) return value.map(item => typeof item === 'number' ? item * s : item);
  if (value && typeof value === 'object' && Number.isFinite(value.x) && Number.isFinite(value.y)) return Object.assign({}, value, { x: value.x * s, y: value.y * s });
  return value;
}
/** How big a term's value is: |number|, or the length of a vector ([x, y] or { x, y }). */
function rulegenTermSize(value) {
  if (typeof value === 'number') return Math.abs(value);
  if (Array.isArray(value) && typeof value[0] === 'number') return Math.hypot(value[0], Number(value[1]) || 0);
  if (value && typeof value === 'object' && Number.isFinite(value.x) && Number.isFinite(value.y)) return Math.hypot(value.x, value.y);
  return NaN;
}
/** The terms computed during the step just finished go on its checkpoint: each one's last value, mean size and how often it was computed. */
function rulegenFlushTerms() {
  const run = rulegenRun; if (!run) return;
  // The decisions (m.test) made during the step go on it too (for a step of one item, only those about that item), at most 8.
  if (run.testsNow) { const own = run.lastTrace; if (own) { const mine = run.testsNow.filter(t => own.item === undefined || t.item === undefined || t.item === own.item); own.tests = mine.slice(0, 8).map(({ item, ...t }) => t); } run.testsNow = null; }
  if (!run.termsNow) return;
  if (run.lastTrace) { const out = {}; for (const name of Object.keys(run.termsNow)) { const t = run.termsNow[name]; out[name] = { last: t.last, mean: t.sized ? rulegenRound(t.sum / t.sized) : null, n: t.n }; } run.lastTrace.terms = out; }
  run.termsNow = null;
}
/** A few points (at most 12, the last kept) of what a drawing call draws, rounded. */
const rulegenSample = points => { if (!points.length) return []; const step = Math.max(1, Math.ceil(points.length / 11)), kept = points.filter((q, i) => i % step === 0); if (kept[kept.length - 1] !== points[points.length - 1]) kept.push(points[points.length - 1]); return kept.slice(0, 12).map(q => [rulegenRound(q[0]), rulegenRound(q[1])]); };
/**
 * How a run with one thing changed differs from the run as it is: how far the mark target (an event index of
 * the base run) moved (mean distance of its points; the same event, else the nearest of its kind) and whether it is gone,
 * and the steps (checkpoints, or drawing calls without any) whose data or drawing came out different.
 */
function rulegenCompareRuns(base, other, target) {
  const centre = e => [(e.x || 0) + (e.w || 0) / 2, (e.y || 0) + (e.h || 0) / 2];
  const gap = (a, b) => { const pa = a.pts && a.pts.length ? a.pts : [centre(a)], pb = b.pts && b.pts.length ? b.pts : [centre(b)], n = Math.min(pa.length, pb.length); if (!n) return 0;
    let sum = 0; for (let i = 0; i < n; i++) sum += Math.hypot(pa[Math.floor(i * pa.length / n)][0] - pb[Math.floor(i * pb.length / n)][0], pa[Math.floor(i * pa.length / n)][1] - pb[Math.floor(i * pb.length / n)][1]); return sum / n; };
  let moved = 0, gone = false;
  // A followed item: all its drawing calls, in order, against the other run's.
  if (target && typeof target === 'object' && target.item !== undefined && target.item !== null) {
    const of = run => run.events.filter(e => e.kind !== 'trace' && e.item === String(target.item)), a = of(base), b = of(other);
    if (a.length && !b.length) gone = true;
    else if (a.length) { let sum = 0; for (let k = 0; k < a.length; k++) sum += gap(a[k], b[Math.min(b.length - 1, Math.floor(k * b.length / a.length))]); moved = rulegenRound(sum / a.length); }
  }
  const mark = Number.isInteger(target) ? base.events.find(e => e.index === target) : null;
  if (mark) {
    let same = other.events.find(e => e.index === target && e.kind === mark.kind);
    if (!same) { const [mx, my] = centre(mark); same = other.events.filter(e => e.kind === mark.kind).sort((a, b) => Math.hypot(centre(a)[0] - mx, centre(a)[1] - my) - Math.hypot(centre(b)[0] - mx, centre(b)[1] - my))[0]; }
    if (same) moved = rulegenRound(gap(mark, same)); else gone = true;
  }
  // Steps, each with its checkpoint and the drawing calls until the next one.
  const split = run => { const traced = run.events.some(e => e.kind === 'trace'), out = []; for (const e of run.events) { if (e.kind === 'trace' || !traced) out.push({ head: e, draws: traced ? [] : [e] }); else if (out.length) out[out.length - 1].draws.push(e); } return out; };
  const a = split(base), b = split(other), steps = [];
  for (let i = 0; i < Math.max(a.length, b.length) && steps.length < 400; i++) {
    const x = a[i], y = b[i];
    if (!x || !y) { steps.push(i); continue; }
    const data = x.head.kind === 'trace' && JSON.stringify(x.head.data) !== JSON.stringify(y.head.data);
    const drawn = x.draws.length !== y.draws.length || x.draws.some((e, k) => gap(e, y.draws[k]) > .5);
    if (data || drawn) steps.push(i);
  }
  return { moved, gone, steps };
}
const rulegenRound = value => Math.round(value * 10) / 10;
/** Points (in the code's coordinates) as canvas pixels, through the current transform. */
function rulegenCanvas(points) {
  const ctx = p.drawingContext, matrix = ctx && typeof ctx.getTransform === 'function' ? ctx.getTransform() : null, density = typeof p.pixelDensity === 'function' ? p.pixelDensity() || 1 : 1;
  return points.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y)).map(([x, y]) => matrix ? [(matrix.a * x + matrix.c * y + matrix.e) / density, (matrix.b * x + matrix.d * y + matrix.f) / density] : [x, y]);
}
/** The box of points (in the code's coordinates) on the canvas, through the current transform. */
function rulegenBox(points) {
  const ctx = p.drawingContext, matrix = ctx && typeof ctx.getTransform === 'function' ? ctx.getTransform() : null, density = typeof p.pixelDensity === 'function' ? p.pixelDensity() || 1 : 1;
  const xs = [], ys = [];
  for (const [x, y] of points) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    xs.push(matrix ? (matrix.a * x + matrix.c * y + matrix.e) / density : x); ys.push(matrix ? (matrix.b * x + matrix.d * y + matrix.f) / density : y);
  }
  if (!xs.length) return null;
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x: rulegenRound(x), y: rulegenRound(y), w: rulegenRound(Math.max(...xs) - x), h: rulegenRound(Math.max(...ys) - y) };
}
function rulegenShapePoints(name, a) {
  const n = i => Number(a[i]);
  if (name === 'endShape') return rulegenShape || [];
  if (name === 'ellipse' || name === 'circle' || name === 'arc') { const w = n(2), h = name === 'circle' ? w : Number.isFinite(n(3)) ? n(3) : w; return [[n(0) - w / 2, n(1) - h / 2], [n(0) + w / 2, n(1) + h / 2]]; }
  if (name === 'rect' || name === 'square') { const w = n(2), h = name === 'square' ? w : Number.isFinite(n(3)) ? n(3) : w; return [[n(0), n(1)], [n(0) + w, n(1) + h]]; }
  if (name === 'text') return [[n(1), n(2)]];
  if (name === 'image') return [[n(1), n(2)], [n(1) + (Number.isFinite(n(3)) ? n(3) : 0), n(2) + (Number.isFinite(n(4)) ? n(4) : 0)]];
  const points = []; for (let i = 0; i + 1 < a.length; i += 2) points.push([n(i), n(i + 1)]); return points;
}
/** Record one event of the run; whether it is still within the budget (to be drawn). */
function rulegenEvent(event) {
  const run = rulegenRun; run.total++;
  if (run.events.length < RULEGEN_MAX_EVENTS) run.events.push(Object.assign({ index: run.total - 1, label: run.label }, run.item !== undefined ? { item: run.item } : {}, event));
  return run.budget === null || run.total <= run.budget;
}
for (const name of RULEGEN_SHAPES) {
  const base = p[name]; if (typeof base !== 'function') continue;
  p[name] = function (...args) {
    // Calls a drawing call makes itself (square → rect) are part of it.
    if (!rulegenRunOwn() || rulegenInOp) return base.apply(p, args);
    const points = rulegenShapePoints(name, args), box = rulegenBox(points); if (name === 'endShape') rulegenShape = null;
    if (!rulegenEvent(Object.assign({ kind: name }, box || {}, rulegenRun.points ? { pts: rulegenSample(rulegenCanvas(points)) } : {}))) return p;
    rulegenInOp++; try { return rulegenDrawFaint(p.drawingContext, rulegenFaint(), () => base.apply(p, args)); } finally { rulegenInOp--; }
  };
}
{ const begin = p.beginShape; if (typeof begin === 'function') p.beginShape = function (...args) { if (rulegenRunOwn()) rulegenShape = []; return begin.apply(p, args); }; }
for (const name of Object.keys(RULEGEN_VERTICES)) {
  const base = p[name]; if (typeof base !== 'function') continue;
  p[name] = function (...args) { if (rulegenRunOwn() && rulegenShape && rulegenShape.length < 4000) { const [i, j] = RULEGEN_VERTICES[name]; rulegenShape.push([Number(args[i]), Number(args[j])]); } return base.apply(p, args); };
}
// Code that paints on the canvas itself (p.drawingContext: beginPath … stroke) is executed the same way: each paint
// call is an event of the run (the box of the path it paints), not drawn past the budget. Paint calls p5 makes inside
// its own drawing calls are part of those.
// The context is wrapped (its own methods) when a run starts, once per context.
let rulegenPath = [], rulegenWrapContext = () => {};
{
  const wrapped = [];
  const tracking = () => rulegenRunOwn() && !rulegenInOp;
  /** Points (in the context's coordinates) as canvas pixels, through its transform now. */
  const onCanvas = (ctx, points) => {
    const matrix = typeof ctx.getTransform === 'function' ? ctx.getTransform() : null, density = typeof p.pixelDensity === 'function' ? p.pixelDensity() || 1 : 1;
    return points.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y)).map(([x, y]) => matrix ? [(matrix.a * x + matrix.c * y + matrix.e) / density, (matrix.b * x + matrix.d * y + matrix.f) / density] : [x, y]);
  };
  const boxOf = points => { if (!points.length) return null; const xs = points.map(q => q[0]), ys = points.map(q => q[1]), x = Math.min(...xs), y = Math.min(...ys);
    return { x: rulegenRound(x), y: rulegenRound(y), w: rulegenRound(Math.max(...xs) - x), h: rulegenRound(Math.max(...ys) - y) }; };
  const n = Number;
  const PATH = {
    moveTo: a => [[n(a[0]), n(a[1])]], lineTo: a => [[n(a[0]), n(a[1])]],
    bezierCurveTo: a => [[n(a[0]), n(a[1])], [n(a[2]), n(a[3])], [n(a[4]), n(a[5])]], quadraticCurveTo: a => [[n(a[0]), n(a[1])], [n(a[2]), n(a[3])]],
    arcTo: a => [[n(a[0]), n(a[1])], [n(a[2]), n(a[3])]],
    arc: a => [[n(a[0]) - n(a[2]), n(a[1]) - n(a[2])], [n(a[0]) + n(a[2]), n(a[1]) + n(a[2])]],
    ellipse: a => [[n(a[0]) - n(a[2]), n(a[1]) - n(a[3])], [n(a[0]) + n(a[2]), n(a[1]) + n(a[3])]],
    rect: a => [[n(a[0]), n(a[1])], [n(a[0]) + n(a[2]), n(a[1]) + n(a[3])]], roundRect: a => [[n(a[0]), n(a[1])], [n(a[0]) + n(a[2]), n(a[1]) + n(a[3])]],
  };
  const PAINT = {
    fill: () => null, stroke: () => null,
    fillRect: a => [[n(a[0]), n(a[1])], [n(a[0]) + n(a[2]), n(a[1]) + n(a[3])]], strokeRect: a => [[n(a[0]), n(a[1])], [n(a[0]) + n(a[2]), n(a[1]) + n(a[3])]],
    fillText: a => [[n(a[1]), n(a[2])]], strokeText: a => [[n(a[1]), n(a[2])]],
    drawImage: a => a.length >= 9 ? [[n(a[5]), n(a[6])], [n(a[5]) + n(a[7]), n(a[6]) + n(a[8])]] : a.length >= 5 ? [[n(a[1]), n(a[2])], [n(a[1]) + n(a[3]), n(a[2]) + n(a[4])]] : [[n(a[1]), n(a[2])]],
  };
  // Painting the whole canvas (a background) is not a step of the brush.
  for (const name of ['background', 'clear']) { const base = p[name]; if (typeof base === 'function') p[name] = function (...args) { rulegenInOp++; try { return base.apply(p, args); } finally { rulegenInOp--; } }; }
  rulegenWrapContext = ctx => {
    if (!ctx || typeof ctx !== 'object' || wrapped.includes(ctx)) return;
    wrapped.push(ctx);
    const begin = ctx.beginPath;
    if (typeof begin === 'function') ctx.beginPath = function (...args) { if (tracking()) rulegenPath = []; return begin.apply(ctx, args); };
    for (const name of Object.keys(PATH)) {
      const base = ctx[name]; if (typeof base !== 'function') continue;
      ctx[name] = function (...args) { if (tracking() && rulegenPath.length < 4000) rulegenPath.push(...onCanvas(ctx, PATH[name](args))); return base.apply(ctx, args); };
    }
    for (const name of Object.keys(PAINT)) {
      const base = ctx[name]; if (typeof base !== 'function') continue;
      ctx[name] = function (...args) {
        if (!tracking()) return base.apply(ctx, args);
        // A Path2D painted is somewhere the run cannot see: no box.
        const own = PAINT[name](args), points = own ? onCanvas(ctx, own) : args[0] && typeof args[0] === 'object' ? [] : rulegenPath;
        if (!rulegenEvent(Object.assign({ kind: name }, boxOf(points) || {}, rulegenRun.points ? { pts: rulegenSample(points) } : {}))) return;
        return rulegenDrawFaint(ctx, rulegenFaint(), () => base.apply(ctx, args));
      };
    }
  };
}
/** The root (module instance) and the module's own id of a node. */
function rulegenLocal(nodeId) {
  for (const inst of rulegenLive) for (const local of Object.keys(inst.entry.map)) if (inst.entry.map[local] === nodeId) return { root: inst.entry.root, local };
  return { root: rulegenRunRoot, local: nodeId };
}
/**
 * One FSM step of the run: 'state' (a visit: the owner entered the state, or evaluates it — an evaluation right after
 * entering is the same visit), 'constraint' (one constraint computed its property: the value, the values it read and
 * the inputs) or 'transition'. Each is a step of the execution, labeled with its owner.
 */
function rulegenFsmEvent(kind, nodeId, key, info) {
  const run = rulegenRun; if (!run || rulegenShowing) return;
  const where = rulegenLocal(nodeId); if (run.roots && !run.roots.includes(where.root)) return;
  const open = run.open || (run.open = {}), ownerKey = nodeId + '|' + key;
  if (kind === 'state' && !info.entered && open[ownerKey] === info.state) { delete open[ownerKey]; return; }
  if (kind === 'state' && info.entered) open[ownerKey] = info.state; else delete open[ownerKey];
  // Terms and decisions computed before a visit or a transition belong to the step before it; those computed inside a
  // constraint's compute function belong to that constraint's step (recorded once the function has returned).
  if (kind !== 'constraint') rulegenFlushTerms();
  const machine = rulegenMachines[nodeId], stateOf = id => { const state = machine && machine.states.find(item => item.id === id); return state ? state.label : id; };
  const owner = where.local + (key !== '' ? ' #' + key : '');
  const label = kind === 'transition' ? owner + ' · ' + stateOf(info.state) + ' → ' + stateOf(info.to) + ' · ' + info.event
    : kind === 'constraint' ? owner + ' · ' + stateOf(info.state) + ' · ' + info.property : owner + ' · ' + stateOf(info.state);
  run.label = label.slice(0, 120);
  if (key !== '') run.item = key;
  const thin = value => { const plain = rulegenThin(rulegenPlain(value, 0), 0); return plain === undefined ? null : JSON.stringify(plain).length > 20000 ? '[large]' : plain; };
  const data = Object.assign({ fsm: kind, nodeId, node: where.local, key, state: info.state },
    kind === 'constraint' ? { constraint: info.constraintId, property: info.property, value: thin(info.value), reads: thin(info.reads), inputs: thin(info.inputs) } : {},
    kind === 'transition' ? { to: info.to, event: info.event, transition: info.transitionId } : {});
  const last = run.events[run.events.length - 1], box = (kind === 'constraint' && rulegenDataBox(data.value)) || (last ? { x: last.x, y: last.y, w: last.w, h: last.h } : {});
  rulegenEvent(Object.assign({ kind: 'trace', root: where.root, data }, box));
  const own = run.events[run.events.length - 1]; run.lastTrace = own && own.index === run.total - 1 ? own : null;
  if (kind === 'constraint') rulegenFlushTerms();
}
/** Checkpoint data made small: lists of more than 200 items keep every k-th (and the last), numbers keep one decimal. */
function rulegenThin(value, depth) {
  if (typeof value === 'number') return Math.round(value * 10) / 10;
  if (!value || typeof value !== 'object' || depth > 6) return value;
  if (Array.isArray(value)) {
    const step = Math.ceil(value.length / 200), kept = step > 1 ? value.filter((item, i) => i % step === 0 || i === value.length - 1) : value;
    return kept.map(item => rulegenThin(item, depth + 1));
  }
  const out = {}; for (const key of Object.keys(value)) out[key] = rulegenThin(value[key], depth + 1); return out;
}
/** Where a checkpoint is: its data's x, y, or the box of the points in it. */
function rulegenDataBox(data) {
  if (!data || typeof data !== 'object') return null;
  if (Number.isFinite(data.x) && Number.isFinite(data.y)) return { x: rulegenRound(data.x), y: rulegenRound(data.y), w: Number.isFinite(data.w) ? rulegenRound(data.w) : 0, h: Number.isFinite(data.h) ? rulegenRound(data.h) : 0 };
  const points = [];
  const walk = (value, depth) => { if (points.length > 2000 || depth > 4 || !value || typeof value !== 'object') return; if (Number.isFinite(value.x) && Number.isFinite(value.y)) { points.push([value.x, value.y]); return; } for (const key of Object.keys(value)) walk(value[key], depth + 1); };
  walk(data, 0);
  if (!points.length) return null;
  const xs = points.map(q => q[0]), ys = points.map(q => q[1]), x = Math.min(...xs), y = Math.min(...ys);
  return { x: rulegenRound(x), y: rulegenRound(y), w: rulegenRound(Math.max(...xs) - x), h: rulegenRound(Math.max(...ys) - y) };
}
// Input history: every press-drag-release on the canvas, in canvas pixels with ms since its press,
// shared by all modules (m.history()). Modules derive what they draw from it with the current values,
// so changing a value adjusts what is already there instead of only what comes next.
// Each gesture has a stable id and a rev that changes whenever its points (or done) change,
// so what a module makes from one gesture is computed once per (id, rev, values) with m.memo.
const rulegenGestures = [];
let rulegenGesture = null, rulegenGestureStart = 0, rulegenGestureIds = 0;
const RULEGEN_MAX_GESTURES = 24, RULEGEN_MAX_POINTS = 4000;
function rulegenRecord(kind) {
  const touch = p.touches && p.touches[0], x = Math.round((touch ? touch.x : p.mouseX) * 10) / 10, y = Math.round((touch ? touch.y : p.mouseY) * 10) / 10;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  const now = typeof performance !== 'undefined' ? performance.now() : 0;
  if (kind === 'down') {
    rulegenGesture = { id: ++rulegenGestureIds, rev: 0, points: [{ x, y, t: 0 }], done: false }; rulegenGestureStart = now;
    rulegenGestures.push(rulegenGesture); if (rulegenGestures.length > RULEGEN_MAX_GESTURES) rulegenGestures.shift();
  } else if (rulegenGesture) {
    const last = rulegenGesture.points[rulegenGesture.points.length - 1];
    if (last.x !== x || last.y !== y) { rulegenGesture.points.push({ x, y, t: Math.round(now - rulegenGestureStart) }); rulegenGesture.rev++; }
    if (kind === 'up') { rulegenGesture.done = true; rulegenGesture.rev++; rulegenGesture = null; }
  }
  // Bounded: the oldest gestures are thinned out first.
  let total = rulegenGestures.reduce((n, g) => n + g.points.length, 0);
  for (let i = 0; total > RULEGEN_MAX_POINTS && i < rulegenGestures.length; i++) {
    const g = rulegenGestures[i]; if (g.points.length < 3) continue;
    const kept = g.points.filter((point, k) => k % 2 === 0 || k === g.points.length - 1); total -= g.points.length - kept.length; g.points.splice(0, g.points.length, ...kept); g.rev++;
  }
}
function rulegenInputReset() { rulegenGestures.length = 0; rulegenGesture = null; }
/** Whether a value change can only show by giving the input again: a module takes input but keeps what it made from it (not derived from m.history()). */
function rulegenNeedsReplay() {
  return rulegenLive.some(inst => !inst.usesHistory && ['mousePressed', 'mouseDragged', 'mouseReleased', 'mouseClicked', 'touchStarted', 'touchMoved', 'touchEnded'].some(name => inst.handlers[name]));
}
function rulegenKey(inst, key) {
  // A value an Execution frame's drawn behavior gives its own code ("@tool/<tool>/<value>"): one for every module.
  if (key.startsWith('@tool/')) return key;
  const cut = key.indexOf('/'), actual = cut > 0 ? inst.entry.map[decodeURIComponent(key.slice(0, cut))] : undefined;
  if (actual === undefined) throw new Error('Unknown value key: ' + key);
  return encodeURIComponent(actual) + key.slice(cut);
}
function rulegenInstance(entry) {
  // reads: value keys read while setup runs (setup re-runs only when one of them changes).
  // memo: results a module computes once per key (not part of m.store, so not copied into inspection steps).
  // memoStack: the m.memo computations running now; each records the values it reads (a value change recomputes it).
  const inst = { entry, handlers: {}, store: {}, reads: null, setupReads: null, usesHistory: false, memo: new Map(), memoStack: [], fields: new Map(), owners: new Map(), constraintReads: null };
  const node = id => { const actual = inst.entry.map[id]; if (actual === undefined) throw new Error('Unknown node: ' + id); return actual; };
  const m = {
    p,
    // v(key, item): the value as one drawn item (its id) has it: an inspection what-if may set it for that item only.
    v(key, item) {
      const k = rulegenKey(inst, key); if (!(k in rulegenParams)) throw new Error('Unknown value: ' + key); if (inst.reads) inst.reads.add(k);
      const own = item === undefined || item === null ? undefined : rulegenItemValues[String(item)], value = own && k in own ? own[k] : rulegenParams[k];
      for (const deps of inst.memoStack) deps.set(k, value);
      // Read while a constraint computes: shown on its step.
      if (inst.constraintReads && Object.keys(inst.constraintReads).length < 24) inst.constraintReads[key] = value;
      return value;
    },
    // opt(fallback, key, item): a value that may not exist yet (a suggested parameter an inspection's records read): the fallback until it does.
    opt(fallback, key, item) { try { return m.v(key, item); } catch (error) { return fallback; } },
    box(id) { const a = encodeURIComponent(node(id)); if (inst.reads) for (const f of ['@x', '@y', '@w', '@h', '@visible']) inst.reads.add(a + '/' + f); return { x: rulegenParams[a + '/@x'], y: rulegenParams[a + '/@y'], w: rulegenParams[a + '/@w'], h: rulegenParams[a + '/@h'], visible: rulegenParams[a + '/@visible'] !== false }; },
    // fsm(id, key): the owner of node id's FSM (key: one of the many items the node draws, each with its own state and
    // data; none: the node itself). owner.state, owner.data, owner.evaluate(...inputs), owner.dispatch(event), owner.remove().
    fsm(id, key) {
      const nodeId = node(id), k = key === undefined || key === null ? '' : String(key), cache = inst.owners, ok = id + '|' + k;
      let owner = cache.get(ok);
      if (!owner) {
        owner = {
          id, key: k,
          get state() { return rulegenRecordOf(nodeId, k).state; },
          get data() { return rulegenRecordOf(nodeId, k).data; },
          evaluate(...inputs) { return rulegenEvaluate(inst, id, nodeId, k, owner, inputs); },
          dispatch(event) { return rulegenTransit(nodeId, k, String(event)); },
          remove() { const own = rulegenOwners[nodeId]; if (own) delete own[k]; cache.delete(ok); rulegenShown(nodeId); },
        };
        cache.set(ok, owner);
      }
      return owner;
    },
    // owners(id): the owners of node id that exist now (the node's own and its items'), in creation order.
    owners(id) { const nodeId = node(id); return Object.keys(rulegenOwners[nodeId] || {}).map(k => m.fsm(id, k === '' ? undefined : k)); },
    history() { inst.usesHistory = true; return rulegenGestures; },
    // field(id, fn): a field the module is driven by (fn(x, y) in canvas pixels gives an angle, [vx, vy] or { x, y }); sample it only
    // through the function returned, which an inspection can show and comb.
    field(id, fn) {
      if (typeof fn !== 'function') throw new Error('m.field needs a function (x, y) => angle or [vx, vy].');
      // Declared again in the same frame (per mark): the arrows can show only one of them, so the inspection says so.
      const key = inst.entry.root + '/' + String(id), was = inst.fields.get(String(id));
      inst.fields.set(String(id), { key, fn, frame: rulegenFrameNo, declared: was && was.frame === rulegenFrameNo && was.fn !== fn ? was.declared + 1 : 1 });
      return (x, y) => rulegenFieldAt(key, fn, x, y);
    },
    // focus(item, fallback): whether the steps of this item are taken (its checkpoints recorded): the representative items
    // (the fallback), and the item the user follows in an Execution frame besides them (the run keeps its other steps).
    // Every drawing call after it belongs to item.
    focus(item, fallback) {
      const run = rulegenRun;
      if (!run || rulegenShowing || (run.roots && !run.roots.includes(inst.entry.root))) return Boolean(fallback);
      run.item = String(item);
      return Boolean(fallback) || (run.focus !== null && run.item === run.focus);
    },
    // term(name, value): one inner term of a computation (a pull, an offset, a noise contribution), returned as it is. An
    // Execution frame records it on the step that computes it and can scale it (0: without it) to show what it does.
    term(name, value) {
      const id = String(name), key = inst.entry.root + '/' + id, scale = rulegenTermScales[key];
      const out = scale === undefined ? value : rulegenScaleTerm(value, scale), run = rulegenRun;
      if (run && !rulegenShowing && (!run.roots || run.roots.includes(inst.entry.root))) {
        run.termNames.add(key);
        const now = run.termsNow || (run.termsNow = {}), entry = now[id] || (now[id] = { n: 0, sum: 0, sized: 0, last: null }), size = rulegenTermSize(out);
        entry.n++; if (Number.isFinite(size)) { entry.sum += size; entry.sized++; } entry.last = rulegenThin(rulegenPlain(out, 0), 0);
      }
      return out;
    },
    // runtime(name, id, value): one quantity of one item as the execution has it now (the reach it is tested with, the size
    // it is drawn at, its speed, its target), returned as it is. It is kept in the module's store ("@runtime", by name
    // and item id: { base, value }), so it is part of the execution state of every moment: changed there by hand, that item
    // alone goes on with the changed value, in every computation that reads it, until what it is computed from changes.
    runtime(name, id, value) {
      if (rulegenShowing || !inst.store || typeof inst.store !== 'object') return value;
      const all = inst.store['@runtime'] && typeof inst.store['@runtime'] === 'object' ? inst.store['@runtime'] : (inst.store['@runtime'] = {});
      const own = all[name] && typeof all[name] === 'object' ? all[name] : (all[name] = {}), key = String(id), base = rulegenPlain(value, 0), kept = own[key];
      const same = kept && typeof kept === 'object' && (typeof base === 'number' ? kept.base === base : JSON.stringify(kept.base) === JSON.stringify(base));
      if (!same) { own[key] = { base, value: base }; return value; }
      return kept.value;
    },
    // test(name, condition, shape, outcomes): a decision the code makes (things overlap, come within reach, cross a threshold, a
    // chance comes up), returned as it is. An Execution frame records it on the step that makes it, with the geometry tested
    // (shape: a reach { x, y, r }, a region { x, y, w, h }, a distance { x1, y1, x2, y2 }, a point, or a list of them) and what
    // each outcome means there (outcomes: [if true, if false], e.g. ["merged!", "not merged"]), and draws it on the picture.
    test(name, condition, shape, outcomes) {
      const run = rulegenRun;
      if (run && !rulegenShowing && (!run.roots || run.roots.includes(inst.entry.root))) {
        const list = run.testsNow || (run.testsNow = []), said = Array.isArray(outcomes) ? outcomes : [];
        if (list.length < 40) list.push({ name: String(name).slice(0, 40), pass: Boolean(condition), shape: shape === undefined ? null : rulegenThin(rulegenPlain(shape, 0), 0) ?? null,
          yes: typeof said[0] === 'string' ? said[0].slice(0, 40) : '', no: typeof said[1] === 'string' ? said[1].slice(0, 40) : '', item: run.item });
      }
      return condition;
    },
    memo(key, compute) {
      const named = typeof key === 'string' ? key : JSON.stringify(key);
      if (named.length > 2000) throw new Error('m.memo key is too long: build it from gesture ids/revs and values, never from the points.');
      // Computed with a combed field: kept apart from what is computed with the field as it is.
      const k = rulegenFieldSig ? named + '#field:' + rulegenFieldSig : named;
      // While some item has its own what-if value, results are computed afresh (a cached one may be another item's).
      // During a recorded run too: the run is the code executing, checkpoints included.
      const hit = rulegenItemsActive() || rulegenRun ? undefined : inst.memo.get(k);
      // A value read while computing (m.v) that changed since makes the entry stale, even if the key does not name it.
      if (hit && hit.deps.every(([dk, dv]) => rulegenParams[dk] === dv)) {
        hit.used = rulegenFrameNo;
        for (const outer of inst.memoStack) for (const [dk, dv] of hit.deps) outer.set(dk, dv);
        return hit.value;
      }
      const deps = new Map(); inst.memoStack.push(deps);
      let value;
      try { value = compute(); } finally { inst.memoStack.pop(); }
      for (const outer of inst.memoStack) for (const [dk, dv] of deps) outer.set(dk, dv);
      inst.memo.set(k, { value, used: rulegenFrameNo, deps: [...deps] });
      if (inst.memo.size > RULEGEN_MEMO_MAX) inst.memo.delete(inst.memo.keys().next().value);
      return value;
    },
    store: inst.store,
  };
  inst.handlers = rulegenModules[entry.module](m) || {};
  return inst;
}
/**
 * A module was replaced in place (its code edited, e.g. a constant exposed as a
 * param): its running instances take the new code and keep their m.store, so
 * nothing drawn or held is lost; cached results (m.memo) start over.
 */
function rulegenRefreshModule(key) {
  rulegenLive = rulegenLive.map(inst => {
    if (inst.entry.module !== key) return inst;
    const fresh = rulegenInstance(inst.entry);
    Object.assign(fresh.store, inst.store);
    fresh.usesHistory = inst.usesHistory; fresh.setupReads = inst.setupReads;
    return fresh;
  });
}
/** Create instances for new root nodes, keep running ones, drop removed ones. */
function rulegenSync() {
  const next = [];
  for (const entry of rulegenInstances) {
    if (!rulegenModules[entry.module]) continue;
    const found = rulegenLive.find(inst => inst.entry.root === entry.root && inst.entry.module === entry.module);
    if (found) { found.entry = entry; next.push(found); continue; }
    const inst = rulegenInstance(entry); next.push(inst);
    if (rulegenStarted) rulegenSetupOne(inst);
  }
  rulegenLive = next;
}
/** Plain data (numbers, strings, booleans, arrays, plain objects), deep-copied; anything else is left out. */
function rulegenPlain(value, depth) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'object' || depth > 12) return undefined;
  if (Array.isArray(value)) return value.map(item => { const copy = rulegenPlain(item, depth + 1); return copy === undefined ? null : copy; });
  const proto = Object.getPrototypeOf(value);
  if (proto !== null && proto !== Object.getPrototypeOf({})) return undefined;
  const out = {};
  for (const key of Object.keys(value)) { const copy = rulegenPlain(value[key], depth + 1); if (copy !== undefined) out[key] = copy; }
  return out;
}
/** Everything a step needs to come back: each instance's store, the FSM owners (state and data), the shown states and the random seed. */
function rulegenSnapshot() {
  const seed = Math.floor(Math.random() * 2147483647);
  if (typeof p.randomSeed === 'function') p.randomSeed(seed);
  if (typeof p.noiseSeed === 'function') p.noiseSeed(seed);
  const states = {}, stores = {};
  for (const nodeId of Object.keys(rulegenState)) states[nodeId] = { id: rulegenState[nodeId].id };
  for (const inst of rulegenLive) stores[inst.entry.root] = rulegenPlain(inst.store, 0);
  return { seed, states, owners: rulegenPlain(rulegenOwners, 0), stores, history: rulegenPlain(rulegenGestures, 0) };
}
/** Put a snapshot back (with the current values): stores are refilled in place, objects that are not plain data are kept. */
function rulegenRestore(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return;
  // Owners come back as they were (only those of known nodes, in states that still exist); without any saved, they start over.
  const owners = {}, saved = snapshot.owners && typeof snapshot.owners === 'object' ? snapshot.owners : {};
  for (const nodeId of Object.keys(saved)) {
    const machine = rulegenMachines[nodeId], own = saved[nodeId]; if (!machine || !own || typeof own !== 'object') continue;
    for (const key of Object.keys(own)) { const record = own[key]; if (record && machine.states.some(state => state.id === record.state)) (owners[nodeId] || (owners[nodeId] = {}))[key] = { state: record.state, data: rulegenPlain(record.data, 0) || {} }; }
  }
  rulegenOwners = owners;
  for (const nodeId of Object.keys(rulegenMachines)) rulegenShown(nodeId);
  rulegenApply();
  for (const inst of rulegenLive) {
    const saved = (snapshot.stores || {})[inst.entry.root];
    if (!saved || typeof saved !== 'object') continue;
    for (const key of Object.keys(inst.store)) if (rulegenPlain(inst.store[key], 0) !== undefined) delete inst.store[key];
    Object.assign(inst.store, rulegenPlain(saved, 0));
  }
  if (Array.isArray(snapshot.history)) {
    rulegenInputReset();
    // Restored gestures keep their id and rev (their memoized results stay valid); new ones get new ids.
    // One saved while it was still being drawn (done: false) comes back unfinished.
    for (const g of snapshot.history) if (g && Array.isArray(g.points)) {
      const id = Number.isInteger(g.id) && g.id > 0 ? g.id : ++rulegenGestureIds;
      rulegenGestureIds = Math.max(rulegenGestureIds, id);
      rulegenGestures.push({ id, rev: Number.isInteger(g.rev) ? g.rev : 0, points: g.points.filter(q => q && Number.isFinite(q.x) && Number.isFinite(q.y)).map(q => ({ x: q.x, y: q.y, t: Number(q.t) || 0 })), done: g.done !== false });
    }
  }
  if (typeof p.randomSeed === 'function') p.randomSeed(snapshot.seed);
  if (typeof p.noiseSeed === 'function') p.noiseSeed(snapshot.seed);
}
function rulegenSetupOne(inst) {
  if (!inst.handlers.setup) return;
  inst.reads = new Set();
  try { inst.handlers.setup(); } finally { inst.setupReads = inst.reads; inst.reads = null; }
}
/**
 * Run the modules' setup. Given the value keys that just changed, only modules
 * whose setup read one of them run it again; the others keep their state
 * (trails, particles, drags) and simply draw with the new values.
 */
function rulegenSetup(changed) {
  for (const inst of rulegenLive) if (!changed || !inst.setupReads || [...inst.setupReads].some(key => changed.has(key))) rulegenSetupOne(inst);
}
p.setup = () => { p.createCanvas(900, 600); rulegenResetStates(); rulegenSync(); rulegenSetup(); rulegenStarted = true; };
let rulegenFrameNo = 0;
const RULEGEN_MEMO_MAX = 4000, RULEGEN_MEMO_IDLE = 240;
p.draw = () => {
  p.clear();
  rulegenFrameNo++;
  for (const inst of rulegenLive) {
    if (!inst.handlers.draw || rulegenParams[encodeURIComponent(inst.entry.root) + '/@visible'] === false) continue;
    rulegenRunRoot = inst.entry.root;
    p.push(); try { inst.handlers.draw(); } finally { p.pop(); rulegenRunRoot = null; }
  }
  // Results not used for a while (old values, gestures that are gone) are dropped.
  if (rulegenFrameNo % 120 === 0) for (const inst of rulegenLive) for (const [k, entry] of inst.memo) if (rulegenFrameNo - entry.used > RULEGEN_MEMO_IDLE) inst.memo.delete(k);
};
const RULEGEN_INPUT = { mousePressed: 'down', mouseDragged: 'move', mouseReleased: 'up', touchStarted: 'down', touchMoved: 'move', touchEnded: 'up' };
function rulegenDispatch(name, fallback, touch) {
  return event => {
    if (RULEGEN_INPUT[name]) rulegenRecord(RULEGEN_INPUT[name]);
    let handled = false, result;
    for (const inst of rulegenLive) {
      const handler = inst.handlers[name] || (fallback && inst.handlers[fallback]);
      if (!handler) continue;
      handled = true; if (handler(event) === false) result = false;
    }
    return touch && handled ? false : result;
  };
}
for (const name of ['mousePressed', 'mouseReleased', 'mouseDragged', 'mouseMoved', 'mouseClicked', 'doubleClicked', 'mouseWheel', 'keyPressed', 'keyReleased', 'keyTyped']) p[name] = rulegenDispatch(name);
p.touchStarted = rulegenDispatch('touchStarted', 'mousePressed', true);
p.touchMoved = rulegenDispatch('touchMoved', 'mouseDragged', true);
p.touchEnded = rulegenDispatch('touchEnded', 'mouseReleased', true);
p.stateEntered = (nodeId, stateId) => {
  for (const inst of rulegenLive) {
    if (!inst.handlers.stateEntered) continue;
    const local = Object.keys(inst.entry.map).find(id => inst.entry.map[id] === nodeId);
    if (local !== undefined) inst.handlers.stateEntered(local, stateId);
  }
};
`;
