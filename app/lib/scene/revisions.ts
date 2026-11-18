import { keepHandles } from "./handles";
import type { ResultAnnotation } from "../schema";
import type { Scene } from "./schema";
import { describeValue } from "./values";

export type SceneChange = { path: string; before: string; after: string; kind: "add" | "change" | "remove" };
export type SceneProposal = { summary: string; scene: Scene };

function entries(scene: Scene) {
  const values = new Map<string, { path: string; value: string }>();
  const add = (key: unknown[], path: string, value: unknown) => values.set(JSON.stringify(key), { path, value: typeof value === "string" ? value : JSON.stringify(value) });
  for (const node of scene.nodes) {
    const kind = node.kind === "collection" ? "Collection" : "Object";
    const root = `${kind} · ${node.name}`;
    add(["node", node.id, "name"], `${root} · Name`, node.name);
    add(["node", node.id, "description"], `${root} · Description`, node.description);
    add(["node", node.id, "parent"], `${root} · Parent`, scene.nodes.find(item => item.id === node.parentId)?.name || "(root)");
    add(["node", node.id, "constraints"], `${root} · Constraint order`, node.constraints.map(constraint => constraint.property || constraint.id).join(" → "));
    for (const constraint of node.constraints) {
      const layer = `${root} · ${constraint.property || constraint.id}`;
      add(["constraint", node.id, constraint.id], `${layer} · constraint`, constraint.description);
      for (const param of constraint.params) add(["param", node.id, param.id], `${layer} · ${param.label} (${param.effect})`, describeValue(param.value));
    }
    if (node.machine) add(["machine", node.id], `${root} · State machine`, node.machine.states.map(state => state.label).join(" → "));
  }
  return values;
}

export function sceneChanges(before: Scene, after: Scene): SceneChange[] {
  const a = entries(before), b = entries(after);
  return [...new Set([...a.keys(), ...b.keys()])].flatMap(key => {
    const old = a.get(key), next = b.get(key);
    return old?.value === next?.value ? [] : [{ kind: (!old ? "add" : !next ? "remove" : "change") as SceneChange["kind"], path: next?.path || old!.path, before: old?.value ?? "none", after: next?.value ?? "none" }];
  });
}

/** Retained nodes keep their sketch regions: they locate evidence in the original drawing. */
export function settleProposal(current: Scene, proposed: Scene): Scene {
  return { ...proposed, nodes: proposed.nodes.map(node => { const old = current.nodes.find(item => item.id === node.id); return old ? keepHandles(old, { ...node, region: old.region }) : node; }) };
}
export function validateSceneProposal(current: Scene, proposed: Scene) {
  if (!sceneChanges(current, proposed).length) throw new Error("No actual changes were proposed. Make your edit request more specific.");
}

export const sceneRevisionSnapshot = (scene: Scene, code: string, annotations: ResultAnnotation[], instruction: string, image: string) => JSON.stringify({ scene, code, annotations, instruction, image });
