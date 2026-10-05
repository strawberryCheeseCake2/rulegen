import { parse } from "@babel/parser";
import traverseImport from "@babel/traverse";
import * as t from "@babel/types";
import type { RuleGroup, GeneratedCode } from "../lib/schema";
import { getBindings, parameterValues, parameterBlock, PARAM_START } from "../lib/live-parameters";
const traverse = (traverseImport as unknown as { default?: typeof traverseImport }).default || traverseImport;
export function connectParameters(result: { title: string; explanation: string; code: string }, groups: RuleGroup[]): GeneratedCode {
  const bindings = getBindings(groups), keys = new Set(bindings.map(b => b.key)), used = new Set<string>();
  const ast = parse(result.code, { sourceType: "script" });
  traverse(ast, {
    Identifier(path) {
      if (path.node.name === "rulegenParams" && path.isBindingIdentifier()) throw new Error("생성 코드가 파라미터 연결을 덮어썼습니다. 다시 생성해주세요.");
    },
    MemberExpression(path) {
      if (!t.isIdentifier(path.node.object, { name: "rulegenParams" })) return;
      if (!path.node.computed || !t.isStringLiteral(path.node.property) || !keys.has(path.node.property.value)) throw new Error("생성 코드의 파라미터 연결이 올바르지 않습니다. 다시 생성해주세요.");
      if ((path.parentPath.isAssignmentExpression() && path.key === "left") || path.parentPath.isUpdateExpression()) throw new Error("생성 코드는 위젯 값을 변경할 수 없습니다.");
      used.add(path.node.property.value);
    },
  });
  if (bindings.some(b => !used.has(b.key))) throw new Error("일부 위젯을 코드에 연결하지 못했습니다. 다시 생성해주세요.");
  if (result.code.includes(PARAM_START)) throw new Error("파라미터 블록은 서버에서 생성합니다. 다시 시도해주세요.");
  return { ...result, bindings, code: `${parameterBlock(parameterValues(groups, bindings))}\n\n${result.code}` };
}
