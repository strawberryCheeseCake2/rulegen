import type { StateMachine, GeneratedCode } from "./schema";
import { getBindings, parameterValues, syncParameters } from "./live-parameters";

export const MACHINE_START = "// @rulegen-state-machine:start";
export const MACHINE_END = "// @rulegen-state-machine:end";

export function machineValues(machine: StateMachine) {
  return { initialState: machine.initialState, transitions: machine.transitions, states: machine.states.map(state => ({
    id: state.id, label: state.label, features: state.features, params: parameterValues(state.groups, getBindings(state.groups)),
  })) };
}

export function machineBlock(machine: StateMachine, previous?: ReturnType<typeof machineValues>) {
  const values = machineValues(machine);
  // Keep old keys until an edited implementation has been regenerated.
  for (const state of values.states) state.params = { ...previous?.states.find(item => item.id === state.id)?.params, ...state.params };
  return `${MACHINE_START}\nconst rulegenMachine = ${JSON.stringify(values, null, 2)};\n${MACHINE_END}`;
}

export function syncStateMachine(source: string, machine: StateMachine | null) {
  if (!machine) return source;
  const start = source.indexOf(MACHINE_START), endMarker = source.indexOf(`\n${MACHINE_END}`, start);
  const end = endMarker < 0 ? -1 : endMarker + 1;
  if (start < 0 || end < 0) return source;
  const block = source.slice(start + MACHINE_START.length, end).trim();
  const match = /^const rulegenMachine\s*=\s*(\{[\s\S]*\});$/.exec(block);
  if (!match) return source;
  let previous: ReturnType<typeof machineValues>;
  try { previous = JSON.parse(match[1]); } catch { return source; }
  if (!Array.isArray(previous.states)) return source;
  return source.slice(0, start) + machineBlock(machine, previous) + source.slice(end + MACHINE_END.length);
}

export function generatedSource(generated: GeneratedCode, groups: Parameters<typeof syncParameters>[1]) {
  return syncStateMachine(syncParameters(generated.code, groups, generated.bindings), generated.stateMachine);
}

// This portable controller is included in downloaded source as well as the sandbox.
export const STATE_RUNTIME = `
const rulegenState = { id: rulegenMachine.initialState, elapsed: 0, params: {}, features: [], playing: true };
function rulegenJumpState(id) {
  const state = rulegenMachine.states.find(state => state.id === id);
  if (!state) return false;
  rulegenState.id = id;
  rulegenState.elapsed = 0;
  rulegenState.params = state.params;
  rulegenState.features = state.features;
  if (typeof p.stateEntered === 'function') p.stateEntered(id);
  return true;
}
function rulegenEmit(id) {
  const transition = rulegenMachine.transitions.find(transition => transition.id === id && transition.from === rulegenState.id && transition.trigger === 'event');
  return transition ? rulegenJumpState(transition.to) : false;
}
function rulegenTickState(delta) {
  if (!rulegenState.playing) return;
  rulegenState.elapsed += Math.max(0, Math.min(Number.isFinite(delta) ? delta : 0, 250));
  const transition = rulegenMachine.transitions.filter(transition => transition.from === rulegenState.id && transition.trigger === 'after' && rulegenState.elapsed >= transition.afterMs).sort((a, b) => a.afterMs - b.afterMs)[0];
  if (transition) rulegenJumpState(transition.to);
}
rulegenJumpState(rulegenMachine.initialState);
`;

export const STATE_DRIVER = `
// @rulegen-state-driver
const rulegenSetup = p.setup, rulegenDraw = p.draw;
p.setup = () => { rulegenSetup(); rulegenJumpState(rulegenMachine.initialState); };
p.draw = () => { rulegenTickState(p.deltaTime); if (rulegenDraw) rulegenDraw(); };
`;
