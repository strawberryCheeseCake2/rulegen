import { keepHandles } from "./handles";
import type { ResultAnnotation } from "../schema";
import type { Scene } from "./schema";
import { describeValue } from "./values";

export type SceneChange = { path: string; before: string; after: string; kind: "add" | "change" | "remove" };
export type SceneProposal = { summary: string; scene: Scene };

function entries(scene: Scene) {
  const values = new Map<string, { path: string; value: string }>();
  const add = (key: unknown[], path: string, value: unknown) => values.set(JSON.stringify(key), { path, value: typeof value === "string" ? value : JSON.stringify(value) });
  const names = (id: string) => scene.algorithms.find(algorithm => algorithm.id === id)?.name || id;
  for (const node of scene.nodes) {
    const kind = node.kind === "collection" ? "Collection" : "Object";
    const root = `${kind} · ${node.name}`;
    add(["node", node.id, "name"], `${root} · Name`, node.name);
    add(["node", node.id, "description"], `${root} · Description`, node.description);
    add(["node", node.id, "parent"], `${root} · Parent`, scene.nodes.find(item => item.id === node.parentId)?.name || "(root)");
    add(["node", node.id, "transformations"], `${root} · Transformation order`, node.transformations.map(transformation => transformation.label || transformation.id).join(" → "));
    for (const transformation of node.transformations) {
      const layer = `${root} · ${transformation.label || transformation.id}`;
      add(["transformation", node.id, transformation.id], `${layer} · Semantic transformation`, transformation.description);
      for (const property of transformation.properties) add(["property", node.id, property.id], `${layer} · ${property.label} (${property.effect})`, describeValue(property.value, names));
    }
    if (node.machine) add(["machine", node.id], `${root} · State machine`, node.machine.states.map(state => state.label).join(" → "));
  }
  for (const algorithm of scene.algorithms) add(["algorithm", algorithm.id], `Algorithm · ${algorithm.name}`, `${algorithm.description}\n${algorithm.params.map(param => `${param.label}: ${describeValue(param.value, names)}`).join("\n")}`);
  return values;
}

export function sceneChanges(before: Scene, after: Scene): SceneChange[] {
  const a = entries(before), b = entries(after);
  return [...new Set([...a.keys(), ...b.keys()])].flatMap(key => {
    const old = a.get(key), next = b.get(key);
    return old?.value === next?.value ? [] : [{ kind: (!old ? "add" : !next ? "remove" : "change") as SceneChange["kind"], path: next?.path || old!.path, before: old?.value ?? "없음", after: next?.value ?? "없음" }];
  });
}

/** Retained nodes keep their sketch regions: they locate evidence in the original drawing. */
export function settleProposal(current: Scene, proposed: Scene): Scene {
  return { ...proposed, nodes: proposed.nodes.map(node => { const old = current.nodes.find(item => item.id === node.id); return old ? keepHandles(old, { ...node, region: old.region }) : node; }) };
}
export function validateSceneProposal(current: Scene, proposed: Scene) {
  if (!sceneChanges(current, proposed).length) throw new Error("실제 변경 제안이 없습니다. 수정 요청을 구체적으로 입력해주세요.");
}

export const sceneRevisionSnapshot = (scene: Scene, code: string, annotations: ResultAnnotation[], instruction: string, image: string) => JSON.stringify({ scene, code, annotations, instruction, image });
