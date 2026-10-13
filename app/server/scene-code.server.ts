import { parse } from "@babel/parser";
import traverseImport, { type NodePath } from "@babel/traverse";
import * as t from "@babel/types";
import type { GeneratedCode } from "../lib/schema";
import type { Scene } from "../lib/scene/schema";
import { LAYOUT_FIELDS, layoutKey, sceneBindings } from "../lib/scene/values";
import { sceneBlock, SCENE_DRIVER, SCENE_DRIVER_MARK, SCENE_RUNTIME, SCENE_START } from "../lib/scene/machines";
import { machineSignature } from "../lib/scene/live";

const traverse = (traverseImport as unknown as { default?: typeof traverseImport }).default || traverseImport;
// Host blocks of the earlier feature/rule runtime must not be smuggled in either.
const HOST_NAMES = new Set(["rulegenParams", "rulegenMachines", "rulegenState", "rulegenBase", "rulegenPlaying", "rulegenApply", "rulegenJumpState", "rulegenEmit", "rulegenTickState", "rulegenResetStates", "rulegenSetup", "rulegenDraw"]);

const literal = (node: t.Node | null | undefined) => t.isStringLiteral(node) ? node.value : null;
function rootName(node: t.Node): string | null {
  while (t.isMemberExpression(node)) node = node.object;
  return t.isIdentifier(node) ? node.name : null;
}
function isWrite(path: NodePath<t.MemberExpression>) {
  let current: NodePath = path;
  while (current.parentPath?.isMemberExpression() && current.parentPath.node.object === current.node) current = current.parentPath;
  const parent = current.parentPath;
  return Boolean(parent && ((parent.isAssignmentExpression() && current.key === "left") || parent.isUpdateExpression() || (parent.isUnaryExpression() && parent.node.operator === "delete")));
}

/**
 * Validate a model-written sketch against the scene and prepend the host block.
 * Every scalar property must be read as rulegenParams["literal key"]; node
 * layout keys are optional. Machine nodes are addressed by literal ids too.
 */
export function connectScene(result: { title: string; explanation: string; code: string }, scene: Scene): GeneratedCode {
  const bindings = sceneBindings(scene), required = new Set(bindings.map(binding => binding.key));
  const allowed = new Set([...required, ...scene.nodes.flatMap(node => LAYOUT_FIELDS.map(field => layoutKey(node.id, field)))]);
  const machines = new Map(scene.nodes.filter(node => node.machine).map(node => [node.id, new Set(node.machine!.transitions.map(transition => transition.id))]));
  const used = new Set<string>();
  let hasDraw = false;
  for (const marker of [SCENE_START, SCENE_DRIVER_MARK]) if (result.code.includes(marker)) throw new Error("호스트 연결 블록은 서버에서 생성합니다. 다시 생성해주세요.");
  traverse(parse(result.code, { sourceType: "script" }), {
    Identifier(path) {
      const self: t.Node = path.node, name = path.node.name;
      if (!HOST_NAMES.has(name)) return;
      const binding = path.isBindingIdentifier(), referenced = path.isReferencedIdentifier(), parent = path.parentPath as NodePath | null;
      if (binding) throw new Error("생성 코드가 호스트 연결 이름을 덮어썼습니다. 다시 생성해주세요.");
      if (!referenced) return;
      const asObject = parent?.isMemberExpression() && parent.node.object === self;
      if ((name === "rulegenParams" || name === "rulegenState") && !asObject) throw new Error(`${name}은 리터럴 키로만 읽을 수 있습니다.`);
      if (name === "rulegenEmit" && !(parent?.isCallExpression() && parent.node.callee === self)) throw new Error("rulegenEmit은 직접 호출해야 합니다.");
      if (!["rulegenParams", "rulegenState", "rulegenEmit"].includes(name)) throw new Error(`생성 코드는 ${name}에 접근할 수 없습니다.`);
    },
    MemberExpression(path) {
      const node = path.node;
      if (t.isIdentifier(node.object, { name: "p" }) && t.isIdentifier(node.property, { name: "draw" }) && path.parentPath.isAssignmentExpression()) hasDraw = true;
      const root = rootName(node);
      if (root !== "rulegenParams" && root !== "rulegenState") return;
      if (isWrite(path)) throw new Error("생성 코드는 property 값이나 상태를 직접 변경할 수 없습니다.");
      if (!t.isIdentifier(node.object)) return;
      const key = node.computed ? literal(node.property) : null;
      if (root === "rulegenParams") {
        if (!key || !allowed.has(key)) throw new Error("생성 코드의 property 연결이 올바르지 않습니다. 다시 생성해주세요.");
        used.add(key);
      } else if (!key || !machines.has(key)) throw new Error("rulegenState는 state machine이 있는 노드 ID로만 읽을 수 있습니다.");
    },
    CallExpression(path) {
      const { callee, arguments: args } = path.node;
      if (t.isMemberExpression(callee) && t.isIdentifier(callee.object, { name: "p" }) && t.isIdentifier(callee.property, { name: "noLoop" }) && machines.size) throw new Error("상태가 있는 장면은 p.draw에서 계속 렌더링되어야 합니다.");
      if (!t.isIdentifier(callee, { name: "rulegenEmit" })) return;
      const nodeId = literal(args[0] as t.Node), transitionId = literal(args[1] as t.Node);
      if (!nodeId || !transitionId || !machines.get(nodeId)?.has(transitionId)) throw new Error("rulegenEmit의 노드 또는 전이 ID가 올바르지 않습니다.");
    },
  });
  if ([...required].some(key => !used.has(key))) throw new Error("일부 property를 코드에 연결하지 못했습니다. 다시 생성해주세요.");
  if (machines.size && !hasDraw) throw new Error("상태가 있는 장면에는 p.draw가 필요합니다.");
  const code = `${sceneBlock(scene)}\n${SCENE_RUNTIME}\n${result.code}\n${machines.size ? SCENE_DRIVER : ""}`;
  return { ...result, code, sceneBindings: bindings, machineSignature: machineSignature(scene) };
}
