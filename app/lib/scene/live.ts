import type { GeneratedCode } from "../schema";
import type { Scene } from "./schema";
import { hasSceneBlock, syncScene } from "./machines";
import { sceneBindings } from "./values";

/** Which machine structure a generated sketch was written for. */
export function machineSignature(scene: Scene) {
  return JSON.stringify(scene.nodes.filter(node => node.machine).map(node => [node.id, node.machine!.states.map(state => state.id), node.machine!.transitions.map(t => [t.id, t.from, t.to])]));
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
