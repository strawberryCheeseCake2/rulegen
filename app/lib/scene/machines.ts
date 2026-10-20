import type { NodeMachine, Property, Scene, SceneNode, SemanticTransformation, Value } from "./schema";
import { nodeProperties } from "./transformations";
import { leafValues, sceneValues, valueLeaves, valueShape } from "./values";

/** Transformations as seen in one state: the state's values override the base values. */
export function stateTransformations(node: SceneNode, stateId: string | null | undefined): SemanticTransformation[] {
  const state = node.machine?.states.find(item => item.id === stateId);
  if (!state) return node.transformations;
  return node.transformations.map(transformation => ({ ...transformation, properties: transformation.properties.map(property => {
    const override = state.values.find(item => item.propertyId === property.id);
    return override && valueShape(override.value) === valueShape(property.value) ? { ...property, value: override.value } : property;
  }) }));
}
/** Every property as seen in one state. */
export const stateProperties = (node: SceneNode, stateId: string | null | undefined): Property[] => stateTransformations(node, stateId).flatMap(transformation => transformation.properties);

/** Drop state values whose structure no longer matches the base property (e.g. after swapping a number for an algorithm). */
export function conformMachine(node: SceneNode): SceneNode {
  if (!node.machine) return node;
  const shapes = new Map(nodeProperties(node).map(property => [property.id, valueShape(property.value)]));
  return { ...node, machine: { ...node.machine, states: node.machine.states.map(state => ({ ...state, values: state.values.filter(item => shapes.get(item.propertyId) === valueShape(item.value)) })) } };
}

export function setStateValue(node: SceneNode, stateId: string, propertyId: string, value: Value): SceneNode {
  if (!node.machine) return node;
  return { ...node, machine: { ...node.machine, states: node.machine.states.map(state => state.id !== stateId ? state : { ...state, values: [...state.values.filter(item => item.propertyId !== propertyId), { propertyId, value }] }) } };
}

export function validateMachine(node: SceneNode, machine: NodeMachine) {
  const ids = machine.states.map(state => state.id), duplicate = (values: string[]) => new Set(values).size !== values.length;
  const properties = new Map(nodeProperties(node).map(property => [property.id, property]));
  if (duplicate(ids) || !ids.includes(machine.initialState) || duplicate(machine.transitions.map(t => t.id))) throw new Error(`${node.name}의 상태 또는 전이 ID를 확인해주세요.`);
  if (machine.transitions.some(t => !ids.includes(t.from) || !ids.includes(t.to))) throw new Error(`${node.name}의 전이가 없는 상태를 가리킵니다.`);
  for (const state of machine.states) {
    if (duplicate(state.values.map(item => item.propertyId))) throw new Error(`${node.name} · ${state.label}의 property 값이 중복되었습니다.`);
    for (const item of state.values) {
      const property = properties.get(item.propertyId);
      if (!property) throw new Error(`${node.name} · ${state.label}이 없는 property를 참조합니다.`);
      if (valueShape(property.value) !== valueShape(item.value)) throw new Error(`${node.name} · ${state.label}의 ${property.label} 구조가 기본 property와 다릅니다.`);
    }
  }
}

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

export function machineValues(scene: Scene) {
  return Object.fromEntries(scene.nodes.filter(node => node.machine).map(node => [node.id, {
    initialState: node.machine!.initialState, transitions: node.machine!.transitions,
    states: node.machine!.states.map(state => ({ id: state.id, label: state.label, params: leafValues(stateProperties(node, state.id).flatMap(property => valueLeaves(property.value, [node.id, property.id]))) })),
  }]));
}

type Block = { params: Record<string, unknown>; machines: ReturnType<typeof machineValues>; instances: SceneInstance[] };
export function sceneBlock(scene: Scene, previous?: Block) {
  // Old keys stay until code is regenerated, so a structural edit cannot break a running sketch.
  const params = { ...previous?.params, ...sceneValues(scene) };
  const machines = machineValues(scene);
  for (const [id, machine] of Object.entries(machines)) for (const state of machine.states) state.params = { ...previous?.machines[id]?.states.find(item => item.id === state.id)?.params, ...state.params };
  return `${SCENE_START}\nconst rulegenParams = ${JSON.stringify(params, null, 2)};\nconst rulegenMachines = ${JSON.stringify(machines, null, 2)};\nconst rulegenInstances = ${JSON.stringify(sceneInstances(scene), null, 2)};\n${SCENE_END}`;
}

function readBlock(source: string) {
  const start = source.indexOf(SCENE_START), endMarker = source.indexOf(`\n${SCENE_END}`, start);
  if (start < 0 || endMarker < 0) return null;
  const body = source.slice(start + SCENE_START.length, endMarker + 1).trim();
  const match = /^const rulegenParams\s*=\s*(\{[\s\S]*?\});\nconst rulegenMachines\s*=\s*(\{[\s\S]*?\});\nconst rulegenInstances\s*=\s*(\[[\s\S]*\]);$/.exec(body);
  if (!match) return null;
  try { return { start, end: endMarker + 1 + SCENE_END.length, block: { params: JSON.parse(match[1]), machines: JSON.parse(match[2]), instances: JSON.parse(match[3]) } as Block }; } catch { return null; }
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
export const hasSceneBlock = (source: string) => Boolean(readBlock(source));
/** Current live values of a source's host block (what the sandbox can receive without a reload). */
export const readSceneValues = (source: string) => readBlock(source)?.block ?? null;
/** The source with its host block blanked: equal keys mean only live values differ. */
export function sceneStructureKey(source: string) {
  const found = readBlock(source);
  return found ? source.slice(0, found.start) + SCENE_START + source.slice(found.end) : source;
}

// Portable per-node controller, shipped in downloads as well as in the sandbox.
export const SCENE_RUNTIME = `
const rulegenModules = {};
function rulegenModule(key, factory) { rulegenModules[key] = factory; }
const rulegenBase = Object.assign({}, rulegenParams);
const rulegenState = {};
let rulegenPlaying = true;
function rulegenApply() {
  Object.assign(rulegenParams, rulegenBase);
  for (const nodeId of Object.keys(rulegenMachines)) {
    const state = rulegenMachines[nodeId].states.find(item => item.id === rulegenState[nodeId].id);
    if (state) Object.assign(rulegenParams, state.params);
  }
}
function rulegenJumpState(nodeId, id) {
  const machine = rulegenMachines[nodeId];
  if (!machine || !machine.states.some(state => state.id === id)) return false;
  rulegenState[nodeId] = { id, elapsed: 0 };
  rulegenApply();
  if (typeof p.stateEntered === 'function') p.stateEntered(nodeId, id);
  return true;
}
function rulegenEmit(nodeId, transitionId) {
  const machine = rulegenMachines[nodeId], current = rulegenState[nodeId];
  const transition = machine && current && machine.transitions.find(item => item.id === transitionId && item.from === current.id && item.trigger === 'event');
  return transition ? rulegenJumpState(nodeId, transition.to) : false;
}
function rulegenTickState(delta) {
  if (!rulegenPlaying) return;
  const step = Math.max(0, Math.min(Number.isFinite(delta) ? delta : 0, 250));
  for (const nodeId of Object.keys(rulegenMachines)) {
    const current = rulegenState[nodeId];
    current.elapsed += step;
    const next = rulegenMachines[nodeId].transitions.filter(item => item.from === current.id && item.trigger === 'after' && current.elapsed >= item.afterMs).sort((a, b) => a.afterMs - b.afterMs)[0];
    if (next) rulegenJumpState(nodeId, next.to);
  }
}
function rulegenResetStates() { for (const nodeId of Object.keys(rulegenMachines)) rulegenJumpState(nodeId, rulegenMachines[nodeId].initialState); }
for (const nodeId of Object.keys(rulegenMachines)) rulegenState[nodeId] = { id: rulegenMachines[nodeId].initialState, elapsed: 0 };
rulegenApply();
`;

// The host owns the canvas, the loop and input; each root node is an instance of
// a code module that only draws and reacts for its own nodes.
export const SCENE_DRIVER = `
${SCENE_DRIVER_MARK}
let rulegenLive = [], rulegenStarted = false;
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
  const cut = key.indexOf('/'), actual = cut > 0 ? inst.entry.map[decodeURIComponent(key.slice(0, cut))] : undefined;
  if (actual === undefined) throw new Error('Unknown value key: ' + key);
  return encodeURIComponent(actual) + key.slice(cut);
}
function rulegenInstance(entry) {
  // reads: value keys read while setup runs (setup re-runs only when one of them changes).
  // memo: results a module computes once per key (not part of m.store, so not copied into inspection steps).
  // memoStack: the m.memo computations running now; each records the values it reads (a value change recomputes it).
  const inst = { entry, handlers: {}, store: {}, reads: null, setupReads: null, usesHistory: false, memo: new Map(), memoStack: [] };
  const node = id => { const actual = inst.entry.map[id]; if (actual === undefined) throw new Error('Unknown node: ' + id); return actual; };
  const m = {
    p,
    v(key) { const k = rulegenKey(inst, key); if (!(k in rulegenParams)) throw new Error('Unknown value: ' + key); if (inst.reads) inst.reads.add(k); for (const deps of inst.memoStack) deps.set(k, rulegenParams[k]); return rulegenParams[k]; },
    box(id) { const a = encodeURIComponent(node(id)); if (inst.reads) for (const f of ['@x', '@y', '@w', '@h', '@visible']) inst.reads.add(a + '/' + f); return { x: rulegenParams[a + '/@x'], y: rulegenParams[a + '/@y'], w: rulegenParams[a + '/@w'], h: rulegenParams[a + '/@h'], visible: rulegenParams[a + '/@visible'] !== false }; },
    state(id) { return rulegenState[node(id)] || { id: null, elapsed: 0 }; },
    emit(id, transitionId) { return rulegenEmit(node(id), transitionId); },
    history() { inst.usesHistory = true; return rulegenGestures; },
    memo(key, compute) {
      const k = typeof key === 'string' ? key : JSON.stringify(key);
      if (k.length > 2000) throw new Error('m.memo key is too long: build it from gesture ids/revs and values, never from the points.');
      const hit = inst.memo.get(k);
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
 * property): its running instances take the new code and keep their m.store, so
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
/** Everything a step needs to come back: each instance's store, the machine states and the random seed. */
function rulegenSnapshot() {
  const seed = Math.floor(Math.random() * 2147483647);
  if (typeof p.randomSeed === 'function') p.randomSeed(seed);
  if (typeof p.noiseSeed === 'function') p.noiseSeed(seed);
  const states = {}, stores = {};
  for (const nodeId of Object.keys(rulegenState)) states[nodeId] = { id: rulegenState[nodeId].id, elapsed: rulegenState[nodeId].elapsed };
  for (const inst of rulegenLive) stores[inst.entry.root] = rulegenPlain(inst.store, 0);
  return { seed, states, stores, history: rulegenPlain(rulegenGestures, 0) };
}
/** Put a snapshot back (with the current values): stores are refilled in place, objects that are not plain data are kept. */
function rulegenRestore(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return;
  for (const nodeId of Object.keys(snapshot.states || {})) {
    const saved = snapshot.states[nodeId], machine = rulegenMachines[nodeId];
    if (machine && saved && machine.states.some(state => state.id === saved.id)) rulegenState[nodeId] = { id: saved.id, elapsed: Number(saved.elapsed) || 0 };
  }
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
    for (const g of snapshot.history) if (g && Array.isArray(g.points)) {
      const id = Number.isInteger(g.id) && g.id > 0 ? g.id : ++rulegenGestureIds;
      rulegenGestureIds = Math.max(rulegenGestureIds, id);
      rulegenGestures.push({ id, rev: Number.isInteger(g.rev) ? g.rev : 0, points: g.points.filter(q => q && Number.isFinite(q.x) && Number.isFinite(q.y)).map(q => ({ x: q.x, y: q.y, t: Number(q.t) || 0 })), done: true });
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
  rulegenTickState(p.deltaTime);
  p.clear();
  rulegenFrameNo++;
  for (const inst of rulegenLive) {
    if (!inst.handlers.draw || rulegenParams[encodeURIComponent(inst.entry.root) + '/@visible'] === false) continue;
    p.push(); try { inst.handlers.draw(); } finally { p.pop(); }
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
