import { parse } from "@babel/parser";
import traverseImport, { type NodePath } from "@babel/traverse";
import * as t from "@babel/types";
import type { GeneratedCode } from "../lib/schema";
import type { Scene } from "../lib/scene/schema";
import { sceneBindings } from "../lib/scene/values";
import { assembleProgram, moduleSource } from "../lib/scene/machines";
import { machineSignature } from "../lib/scene/live";

const traverse = (traverseImport as unknown as { default?: typeof traverseImport }).default || traverseImport;
// Host names the modules must not touch (only rulegenModule, as the top-level call).
const HOST_NAMES = new Set(["rulegenParams", "rulegenMachines", "rulegenInstances", "rulegenState", "rulegenBase", "rulegenPlaying", "rulegenApply", "rulegenJumpState", "rulegenEmit", "rulegenTickState",
  "rulegenResetStates", "rulegenSetup", "rulegenDraw", "rulegenModule", "rulegenModules", "rulegenLive", "rulegenStarted", "rulegenKey", "rulegenInstance", "rulegenSync", "rulegenDispatch", "rulegenPlain", "rulegenSnapshot", "rulegenRestore"]);
/** The module context: m.v / m.box / m.state / m.emit read the module's own nodes; m.history() is the input given so far; m.p is the shared p5 instance; m.store holds the instance's state. */
const CONTEXT = new Set(["v", "box", "state", "emit", "history", "memo", "p", "store"]);
/** The host owns the canvas and the loop. */
const HOST_CALLS = new Set(["background", "clear", "createCanvas", "resizeCanvas", "noCanvas", "noLoop", "loop", "redraw", "frameRate", "pixelDensity", "remove"]);

const literal = (node: t.Node | null | undefined) => t.isStringLiteral(node) ? node.value : t.isTemplateLiteral(node) && !node.expressions.length ? node.quasis[0].value.cooked ?? null : null;
/** A constant the factory may keep outside m.store: no objects, arrays, instances or calls (other than Math.*). */
const constant = (node: t.Node | null | undefined): boolean => {
  if (!node) return false;
  if (t.isFunctionExpression(node) || t.isArrowFunctionExpression(node)) return true;
  let ok = true;
  t.traverseFast(node, child => {
    if (t.isObjectExpression(child) || t.isArrayExpression(child) || t.isNewExpression(child) || t.isFunction(child) || t.isAssignmentExpression(child) || t.isUpdateExpression(child)) ok = false;
    else if (t.isCallExpression(child) && !(t.isMemberExpression(child.callee) && t.isIdentifier(child.callee.object, { name: "Math" }))) ok = false;
  });
  return ok;
};
/**
 * A factory's own scope holds only functions and constants, and returns the
 * handlers: everything that changes between frames lives in m.store, so the host
 * can save a step's state and restore it.
 */
function checkFactory(factory: t.FunctionExpression | t.ArrowFunctionExpression) {
  if (!t.isBlockStatement(factory.body)) return;
  for (const statement of factory.body.body) {
    if (t.isFunctionDeclaration(statement) || t.isReturnStatement(statement) || t.isEmptyStatement(statement)) continue;
    if (t.isVariableDeclaration(statement) && statement.kind === "const" && statement.declarations.every(item => t.isIdentifier(item.id) && constant(item.init))) continue;
    throw new Error("모듈 함수 바로 안에는 함수와 상수만 둘 수 있습니다. 프레임 사이에 바뀌는 값(위치, 배열, 객체 등)은 m.store에 두세요.");
  }
}
const isP = (node: t.Node) => t.isIdentifier(node, { name: "p" }) || (t.isMemberExpression(node) && !node.computed && t.isIdentifier(node.object, { name: "m" }) && t.isIdentifier(node.property, { name: "p" }));

/**
 * Validate model-written code against the scene and assemble the program.
 * The code is one `rulegenModule("<root id>", function (m) { … })` per root node
 * and nothing else; each module reads only its own nodes through `m`, so any
 * module can be lifted into another frame (a brush stamp) without regenerating.
 */
export function connectScene(result: { title: string; explanation: string; code: string }, scene: Scene): GeneratedCode {
  const bindings = sceneBindings(scene), required = new Set(bindings.map(binding => binding.key));
  const children = new Map<string, string[]>();
  for (const node of scene.nodes) if (node.parentId) children.set(node.parentId, [...(children.get(node.parentId) || []), node.id]);
  const below = (id: string): string[] => [id, ...(children.get(id) || []).flatMap(below)];
  const roots = scene.nodes.filter(node => !node.parentId).map(node => node.id);
  const subtree = new Map(roots.map(id => [id, new Set(below(id))]));
  const machines = new Map(scene.nodes.filter(node => node.machine).map(node => [node.id, node.machine!]));
  if (result.code.includes("@rulegen-")) throw new Error("호스트 연결 블록은 서버에서 생성합니다. 다시 생성해주세요.");
  const ast = parse(result.code, { sourceType: "script" });
  // Top level: only one rulegenModule call per root node.
  const modules = new Map<string, string>(), owner = new Map<t.Node, string>(), factories = new Set<t.Node>();
  for (const statement of ast.program.body) {
    const call = t.isExpressionStatement(statement) && t.isCallExpression(statement.expression) ? statement.expression : null;
    if (!call || !t.isIdentifier(call.callee, { name: "rulegenModule" })) throw new Error("모든 코드는 루트 노드마다 하나씩인 rulegenModule(...) 안에 있어야 합니다. 다시 생성해주세요.");
    const key = literal(call.arguments[0]), factory = call.arguments[1];
    if (!key || !subtree.has(key)) throw new Error(`rulegenModule의 이름은 루트 노드 ID여야 합니다${key ? `: ${key}` : ""}.`);
    if (modules.has(key)) throw new Error(`${key} 모듈이 두 번 정의되었습니다.`);
    if (call.arguments.length !== 2 || !(t.isFunctionExpression(factory) || t.isArrowFunctionExpression(factory)) || factory.params.length !== 1 || !t.isIdentifier(factory.params[0], { name: "m" }))
      throw new Error("rulegenModule은 (\"노드 ID\", function (m) { … }) 형태여야 합니다.");
    checkFactory(factory);
    modules.set(key, result.code.slice(factory.start!, factory.end!));
    owner.set(statement, key); factories.add(factory);
  }
  const missing = roots.filter(id => !modules.has(id));
  if (missing.length) throw new Error(`루트 노드마다 모듈이 필요합니다: ${missing.join(", ")}`);
  const moduleOf = (path: NodePath) => { let current: NodePath | null = path; while (current && !current.parentPath?.isProgram()) current = current.parentPath; return current ? owner.get(current.node)! : ""; };
  const used = new Set<string>();
  const nodeOf = (path: NodePath, id: string | null, what: string) => {
    if (!id || !subtree.get(moduleOf(path))!.has(id)) throw new Error(`${what}는 이 모듈의 노드 ID를 문자열로 받아야 합니다${id ? `: ${id}` : ""}.`);
    return id;
  };
  traverse(ast, {
    Identifier(path) {
      const name = path.node.name, self: t.Node = path.node;
      // Type guards are read once: narrowing on them would make later checks unreachable for TypeScript.
      const binding = path.isBindingIdentifier(), referenced = path.isReferencedIdentifier(), parent = path.parentPath as NodePath, listKey = path.listKey;
      if (HOST_NAMES.has(name)) {
        if (binding) throw new Error("생성 코드가 호스트 연결 이름을 덮어썼습니다. 다시 생성해주세요.");
        const top = name === "rulegenModule" && parent.isCallExpression() && parent.node.callee === self && Boolean(parent.parentPath?.parentPath?.isProgram());
        if (referenced && !top) throw new Error(`생성 코드는 ${name}에 접근할 수 없습니다. 값과 상태는 m으로 읽어주세요.`);
        return;
      }
      if (name !== "m") return;
      if (binding) { if (!(listKey === "params" && factories.has(parent.node))) throw new Error("m은 모듈 문맥 이름이라 다시 선언할 수 없습니다."); return; }
      if (!referenced) return;
      const member = parent;
      if (!member.isMemberExpression() || member.node.object !== self || member.node.computed || !t.isIdentifier(member.node.property) || !CONTEXT.has(member.node.property.name))
        throw new Error("m은 m.v / m.box / m.state / m.emit / m.history / m.memo / m.p / m.store로만 쓸 수 있습니다.");
      const field = (member.node.property as t.Identifier).name;
      if (field === "store") {
        const use = member.parentPath as NodePath;
        if ((use.isAssignmentExpression() && use.node.left === member.node) || use.isUpdateExpression() || (use.isCallExpression() && use.node.callee === member.node)) throw new Error("m.store는 바꿔 끼울 수 없습니다. m.store.x = … 처럼 안의 값을 바꿔주세요.");
        return;
      }
      if (field === "p") return;
      const call = member.parentPath as NodePath | null;
      if (!call?.isCallExpression() || call.node.callee !== member.node) throw new Error(`m.${field}는 직접 호출해야 합니다.`);
      const args = call.node.arguments;
      if (field === "history") { if (args.length) throw new Error("m.history()는 인자 없이 호출합니다."); return; }
      if (field === "memo") { if (args.length !== 2) throw new Error("m.memo(key, () => 값) 형태로 호출합니다."); return; }
      if (field === "v") {
        const key = literal(args[0]);
        if (!key || !required.has(key) || !subtree.get(moduleOf(path))!.has(decodeURIComponent(key.slice(0, key.indexOf("/"))))) throw new Error("생성 코드의 property 연결이 올바르지 않습니다. 다시 생성해주세요.");
        used.add(key);
      } else if (field === "box") nodeOf(path, literal(args[0]), "m.box");
      else if (field === "state") { if (!machines.has(nodeOf(path, literal(args[0]), "m.state"))) throw new Error("m.state는 state machine이 있는 노드 ID로만 읽을 수 있습니다."); }
      else {
        const nodeId = literal(args[0]), transitionId = literal(args[1]);
        if (!nodeId || !transitionId || !subtree.get(moduleOf(path))!.has(nodeId) || !machines.get(nodeId)?.transitions.some(item => item.id === transitionId)) throw new Error("m.emit의 노드 또는 전이 ID가 올바르지 않습니다.");
      }
    },
    MemberExpression(path) {
      // p.setup = …, p.draw = … and other writes to p belong to the host.
      if (!t.isIdentifier(path.node.object, { name: "p" }) && !isP(path.node.object)) return;
      const parent = path.parentPath;
      if ((parent.isAssignmentExpression() && parent.node.left === path.node) || parent.isUpdateExpression()) throw new Error("모듈은 p.setup·p.draw 같은 p의 속성을 바꿀 수 없습니다. 모듈이 돌려주는 setup/draw/입력 함수를 써주세요.");
    },
    CallExpression(path) {
      const callee = path.node.callee;
      if (t.isMemberExpression(callee) && !callee.computed && t.isIdentifier(callee.property) && HOST_CALLS.has(callee.property.name) && isP(callee.object))
        throw new Error(`모듈은 p.${callee.property.name}()을 호출할 수 없습니다. 캔버스와 루프는 호스트가 관리합니다.`);
    },
    AssignmentExpression(path) {
      // Undeclared globals would be state shared between modules.
      if (t.isIdentifier(path.node.left) && !path.scope.hasBinding(path.node.left.name)) throw new Error(`선언하지 않은 전역 변수 ${path.node.left.name}에 쓸 수 없습니다. 모듈 안에서 선언해주세요.`);
    },
  });
  if ([...required].some(key => !used.has(key))) throw new Error("일부 property를 코드에 연결하지 못했습니다. 다시 생성해주세요.");
  const code = assembleProgram(scene, [...modules].map(([key, factory]) => moduleSource(key, factory)));
  return { ...result, code, sceneBindings: bindings, machineSignature: machineSignature(scene) };
}
