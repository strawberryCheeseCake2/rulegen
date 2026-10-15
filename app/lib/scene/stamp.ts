import type { GeneratedCode } from "../schema";
import { findNode, updateNode } from "./graph";
import { machineSignature, sceneLiveStatus } from "./live";
import { assembleProgram, hasModules, programModules, renameModule } from "./machines";
import type { Scene } from "./schema";
import { transplantNodes } from "./transfer";
import { sceneBindings } from "./values";

/**
 * Put copies of a node (a brush's collection) into a frame together with the
 * code module that draws it. No AI: the module is copied as is and each copy
 * becomes another instance of it, mapped to the copy's node ids.
 */
export function stampModule(target: { scene: Scene; generated: GeneratedCode | null }, source: Scene, nodeId: string, module: { key: string; text: string }, points: { x: number; y: number }[], name: string) {
  const code = target.generated?.code;
  if (code && !hasModules(code)) throw new Error("이 프레임의 코드는 brush를 받을 수 없는 이전 형식입니다. 먼저 Update로 코드를 다시 생성해주세요.");
  const modules = code ? programModules(code) : new Map<string, string>();
  // Same key and same code: reuse it. Same key, other code: add it under a free key.
  let key = module.key;
  for (let n = 2; modules.has(key) && modules.get(key) !== renameModule(module.text, module.key, key); n++) key = `${module.key}~${n}`;
  if (!modules.has(key)) modules.set(key, renameModule(module.text, module.key, key));
  let scene = target.scene;
  const roots: string[] = [];
  for (const point of points) {
    const result = transplantNodes(source, nodeId, scene, point);
    scene = updateNode(result.scene, result.rootId, node => ({ ...node, codeModule: key }));
    roots.push(result.rootId);
  }
  // A frame whose code was already out of date stays marked so; otherwise the program is live as is.
  const wasLive = !target.generated || sceneLiveStatus(target.generated, target.scene) === "live";
  const added = sceneBindings(scene).filter(binding => roots.some(root => binding.nodeId === root || isBelow(scene, binding.nodeId, root)));
  const generated: GeneratedCode = {
    title: target.generated?.title || name, explanation: target.generated?.explanation || `${name} brush`,
    code: assembleProgram(scene, [...modules.values()], code),
    sceneBindings: wasLive ? sceneBindings(scene) : [...target.generated!.sceneBindings, ...added],
    machineSignature: wasLive ? machineSignature(scene) : target.generated!.machineSignature,
  };
  return { scene, generated, roots, key };
}

function isBelow(scene: Scene, id: string, ancestor: string) {
  for (let node = findNode(scene, id); node?.parentId; node = findNode(scene, node.parentId)) if (node.parentId === ancestor) return true;
  return false;
}
