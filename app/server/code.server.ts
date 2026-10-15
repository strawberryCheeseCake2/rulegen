import { parse } from "@babel/parser";
import traverseImport from "@babel/traverse";
import generateImport from "@babel/generator";
import * as t from "@babel/types";
const traverse = (traverseImport as unknown as { default?: typeof traverseImport }).default || traverseImport;
const generate = (generateImport as unknown as { default?: typeof generateImport }).default || generateImport;
export function prepareCode(source: string) {
  const ast = parse(source, { sourceType: "script" });
  const blocked = new Set(["window", "document", "fetch", "XMLHttpRequest", "WebSocket", "localStorage", "sessionStorage", "parent", "top", "opener", "location", "navigator", "eval", "Function", "importScripts", "setTimeout", "setInterval", "Worker", "globalThis", "constructor", "__proto__", "prototype"]);
  const reserved = new Set(["eval", "Function", "constructor", "__proto__", "prototype"]);
  const guard = () => t.expressionStatement(t.callExpression(t.identifier("__rulegenGuard"), []));
  traverse(ast, {
    Identifier(path) {
      const name = path.node.name;
      if (!blocked.has(name)) return;
      // Coordinates such as `const top = 28` are local data, not window.top.
      // Property access and dangerous reflection/evaluation names remain blocked.
      const binding = path.isBindingIdentifier(), reference = path.isReferencedIdentifier();
      if (!reserved.has(name) && (binding || reference) && path.scope.getBinding(name)) return;
      // Plain object keys (`{ top: 5 }`) are data too.
      const parent = path.parent;
      if (!reserved.has(name) && (t.isObjectProperty(parent) || t.isObjectMethod(parent)) && parent.key === path.node && !parent.computed) return;
      // `rect.top` is a number; only the global window (`top`, `self.top`, `frames.top`, …) is blocked.
      const globals = ["self", "frames", "window", "globalThis", "parent", "top", "opener"];
      if (name === "top" && (t.isMemberExpression(parent) || t.isOptionalMemberExpression(parent)) && parent.property === path.node && !parent.computed
        && !(t.isIdentifier(parent.object) && globals.includes(parent.object.name)) && !t.isThisExpression(parent.object)) return;
      throw new Error(`코드에서 지원하지 않는 API: ${name}`);
    },
    // Strings are data (`alignment === "top"`), except as a computed key (`p["top"]`) or a reflection name anywhere.
    StringLiteral(path) {
      const value = path.node.value, parent = path.parent;
      const computedKey = (t.isMemberExpression(parent) || t.isOptionalMemberExpression(parent)) && parent.computed && parent.property === path.node;
      if (reserved.has(value) || (blocked.has(value) && computedKey)) throw new Error("지원하지 않는 동적 API 접근입니다.");
    },
    TemplateLiteral(path) {
      const parent = path.parent;
      if ((t.isMemberExpression(parent) || t.isOptionalMemberExpression(parent)) && parent.computed && parent.property === path.node && path.node.quasis.some(part => blocked.has(part.value.cooked ?? ""))) throw new Error("지원하지 않는 동적 API 접근입니다.");
    },
    CallExpression(path) { if (t.isImport(path.node.callee)) throw new Error("생성 코드는 외부 모듈을 불러올 수 없습니다."); },
    ImportExpression() { throw new Error("생성 코드는 외부 모듈을 불러올 수 없습니다."); },
    "ForStatement|WhileStatement|DoWhileStatement|ForInStatement|ForOfStatement"(path) {
      const node = path.node as t.ForStatement;
      if (!t.isBlockStatement(node.body)) node.body = t.blockStatement([node.body]);
      node.body.body.unshift(guard());
    },
    Function(path) {
      if (t.isBlockStatement(path.node.body)) path.node.body.body.unshift(guard());
      else if (t.isArrowFunctionExpression(path.node)) path.node.body = t.blockStatement([guard(), t.returnStatement(path.node.body)]);
    },
  });
  if (!/p\.setup\s*=/.test(source) || !source.includes("createCanvas")) throw new Error("p.setup과 p.createCanvas가 있는 p5 코드를 입력해주세요.");
  return generate(ast).code;
}
