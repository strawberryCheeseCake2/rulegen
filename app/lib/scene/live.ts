import type { GeneratedCode } from "../schema";
import type { Scene } from "./schema";
import { hasModules, hasSceneBlock, nodeMachine, programModules, syncScene } from "./machines";
import { findNode } from "./graph";
import { sceneBindings } from "./values";

/**
 * Which FSM structure a generated sketch was written for: per node, its constraints (each has a compute function in
 * the code), its state ids and the events the code dispatches. Which constraints a state evaluates and in what order,
 * where transitions lead and every label are host data, live without new code.
 */
export function machineSignature(scene: Scene) {
  return JSON.stringify(scene.nodes.map(node => { const machine = nodeMachine(node);
    return [node.id, node.constraints.map(constraint => constraint.id), machine.states.map(state => state.id), [...new Set(machine.transitions.map(t => t.event))].sort()]; }));
}

/** live: every control drives the code · changed: structure differs, regenerate · unlinked: no scene block. */
export function sceneLiveStatus(generated: GeneratedCode | null, scene: Scene): "live" | "changed" | "unlinked" {
  if (!generated || !hasSceneBlock(generated.code)) return "unlinked";
  const expected = sceneBindings(scene);
  const same = expected.length === generated.sceneBindings.length && expected.every(binding => generated.sceneBindings.some(item => item.key === binding.key && item.type === binding.type));
  return same && machineSignature(scene) === generated.machineSignature ? "live" : "changed";
}

/** Current source with the scene block patched to the latest widget values and machines. */
export const liveSceneSource = (generated: GeneratedCode | null, scene: Scene) => generated ? syncScene(generated.code, scene) : "";

/**
 * Whole brush stamps (root nodes run by a module of the program) added or removed
 * keep a live program live: the module runs a new root as it is, and a removed
 * root's instance simply stops. The program then covers the new scene; any other
 * structural change still needs new code.
 */
export function relinkStamps(generated: GeneratedCode | null, before: Scene, after: Scene): GeneratedCode | null {
  if (!generated || before === after || !hasModules(generated.code) || sceneLiveStatus(generated, after) === "live" || sceneLiveStatus(generated, before) !== "live") return generated;
  const modules = programModules(generated.code), known = new Set(generated.sceneBindings.map(binding => `${binding.key}|${binding.type}`));
  const existed = new Set(before.nodes.map(node => node.id));
  const rootOf = (id: string) => { let node = findNode(after, id); while (node?.parentId) node = findNode(after, node.parentId); return node; };
  // A node of a root that is new here and has its module in the program.
  const stamped = (id: string) => { const root = rootOf(id); return Boolean(root && !existed.has(root.id) && modules.has(root.codeModule ?? root.id)); };
  if (!sceneBindings(after).every(binding => known.has(`${binding.key}|${binding.type}`) || stamped(binding.nodeId))) return generated;
  const machines = new Map((JSON.parse(generated.machineSignature || "[]") as [string, ...unknown[]][]).map(entry => [entry[0], JSON.stringify(entry)]));
  if (!(JSON.parse(machineSignature(after)) as [string, ...unknown[]][]).every(entry => machines.get(entry[0]) === JSON.stringify(entry) || stamped(entry[0]))) return generated;
  return { ...generated, sceneBindings: sceneBindings(after), machineSignature: machineSignature(after) };
}
