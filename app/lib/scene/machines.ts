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

export function machineValues(scene: Scene) {
  return Object.fromEntries(scene.nodes.filter(node => node.machine).map(node => [node.id, {
    initialState: node.machine!.initialState, transitions: node.machine!.transitions,
    states: node.machine!.states.map(state => ({ id: state.id, label: state.label, params: leafValues(stateProperties(node, state.id).flatMap(property => valueLeaves(property.value, [node.id, property.id]))) })),
  }]));
}

type Block = { params: Record<string, unknown>; machines: ReturnType<typeof machineValues> };
export function sceneBlock(scene: Scene, previous?: Block) {
  // Old keys stay until code is regenerated, so a structural edit cannot break a running sketch.
  const params = { ...previous?.params, ...sceneValues(scene) };
  const machines = machineValues(scene);
  for (const [id, machine] of Object.entries(machines)) for (const state of machine.states) state.params = { ...previous?.machines[id]?.states.find(item => item.id === state.id)?.params, ...state.params };
  return `${SCENE_START}\nconst rulegenParams = ${JSON.stringify(params, null, 2)};\nconst rulegenMachines = ${JSON.stringify(machines, null, 2)};\n${SCENE_END}`;
}

function readBlock(source: string) {
  const start = source.indexOf(SCENE_START), endMarker = source.indexOf(`\n${SCENE_END}`, start);
  if (start < 0 || endMarker < 0) return null;
  const body = source.slice(start + SCENE_START.length, endMarker + 1).trim();
  const match = /^const rulegenParams\s*=\s*(\{[\s\S]*?\});\nconst rulegenMachines\s*=\s*(\{[\s\S]*\});$/.exec(body);
  if (!match) return null;
  try { return { start, end: endMarker + 1 + SCENE_END.length, block: { params: JSON.parse(match[1]), machines: JSON.parse(match[2]) } as Block }; } catch { return null; }
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

export const SCENE_DRIVER = `
${SCENE_DRIVER_MARK}
const rulegenSetup = p.setup, rulegenDraw = p.draw;
p.setup = () => { rulegenSetup(); rulegenResetStates(); };
p.draw = () => { rulegenTickState(p.deltaTime); if (rulegenDraw) rulegenDraw(); };
`;
