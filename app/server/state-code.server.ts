import { parse } from "@babel/parser";
import traverseImport from "@babel/traverse";
import * as t from "@babel/types";
import type { StateMachine } from "../lib/schema";
import { getBindings } from "../lib/live-parameters";
import { machineBlock, MACHINE_START, STATE_RUNTIME, STATE_DRIVER } from "../lib/state-machine";

const traverse = (traverseImport as unknown as { default?: typeof traverseImport }).default || traverseImport;
export function connectStateMachine(source: string, machine: StateMachine) {
  const keys = new Set(machine.states.flatMap(state => getBindings(state.groups).map(binding => binding.key)));
  const used = new Set<string>();
  const reserved = new Set(["rulegenMachine", "rulegenState", "rulegenJumpState", "rulegenTickState", "rulegenEmit", "rulegenSetup", "rulegenDraw"]);
  const ast = parse(source, { sourceType: "script" });
  let readsState = false, hasDraw = false;
  traverse(ast, {
    CallExpression(path) {
      if (t.isMemberExpression(path.node.callee) && t.isIdentifier(path.node.callee.object, { name: "p" }) && t.isIdentifier(path.node.callee.property, { name: "noLoop" })) throw new Error("상태 장면은 p.draw에서 계속 렌더링되어야 합니다.");
    },
    Identifier(path) {
      if (reserved.has(path.node.name) && path.isBindingIdentifier()) throw new Error("생성 코드가 상태 연결을 덮어썼습니다. 다시 생성해주세요.");
    },
    MemberExpression(path) {
      const node = path.node;
      if (t.isIdentifier(node.object, { name: "p" }) && t.isIdentifier(node.property, { name: "draw" }) && path.parentPath.isAssignmentExpression()) hasDraw = true;
      const params = t.isMemberExpression(node.object) && t.isIdentifier(node.object.object, { name: "rulegenState" }) && t.isIdentifier(node.object.property, { name: "params" });
      if (t.isIdentifier(node.object, { name: "rulegenState" }) || params) {
        readsState = true;
        if ((path.parentPath.isAssignmentExpression() && path.key === "left") || path.parentPath.isUpdateExpression()) throw new Error("생성 코드는 상태와 constraint 값을 직접 변경할 수 없습니다.");
      }
      if (params) {
        if (!node.computed || !t.isStringLiteral(node.property) || !keys.has(node.property.value)) throw new Error("상태 constraint의 파라미터 연결이 올바르지 않습니다.");
        used.add(node.property.value);
      }
    },
  });
  if (!hasDraw || !readsState || [...keys].some(key => !used.has(key))) throw new Error("각 상태의 constraint를 동적 장면에 연결하지 못했습니다. 다시 생성해주세요.");
  if (source.includes(MACHINE_START) || source.includes("@rulegen-state-driver")) throw new Error("상태 제어 코드는 서버에서 생성합니다.");
  return `${machineBlock(machine)}\n${STATE_RUNTIME}\n${source}\n${STATE_DRIVER}`;
}
