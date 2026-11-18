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
const HOST_NAMES = new Set(["rulegenParams", "rulegenMachines", "rulegenInstances", "rulegenState", "rulegenBase", "rulegenPlaying", "rulegenApply", "rulegenJumpState", "rulegenEmit", "rulegenOwners",
  "rulegenFrozen", "rulegenOnTransition", "rulegenTransit", "rulegenEvaluate", "rulegenRecordOf", "rulegenShown", "rulegenFsmEvent", "rulegenLocal",
  "rulegenResetStates", "rulegenSetup", "rulegenDraw", "rulegenModule", "rulegenModules", "rulegenLive", "rulegenStarted", "rulegenKey", "rulegenInstance", "rulegenSync", "rulegenDispatch", "rulegenPlain", "rulegenSnapshot", "rulegenRestore", "rulegenCycleKey", "rulegenVisitOpen", "__rgRec"]);
/** The module context: m.v / m.box read the module's own nodes; m.fsm(id, key?) is the owner of a node's FSM (owner.evaluate(...inputs) computes its current state's constraints in order, owner.dispatch(event) takes a transition); m.owners(id) lists a node's owners; m.history() is the input given so far; m.memo(key, compute) caches a result; m.p is the shared p5 instance; m.store holds the instance's state. */
const CONTEXT = new Set(["v", "box", "fsm", "owners", "history", "memo", "p", "store"]);
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
  if (!t.isBlockStatement(factory.body)) throw new Error("The module function needs a body that returns its handlers and constraints.");
  for (const statement of factory.body.body) {
    if (t.isFunctionDeclaration(statement) || t.isReturnStatement(statement) || t.isEmptyStatement(statement)) continue;
    if (t.isVariableDeclaration(statement) && statement.kind === "const" && statement.declarations.every(item => t.isIdentifier(item.id) && constant(item.init))) continue;
    throw new Error("Only functions and constants can sit directly inside the module function. Keep values that change between frames (positions, arrays, objects, etc.) in m.store.");
  }
}
const keyName = (key: t.Node, computed: boolean) => computed ? literal(key) : t.isIdentifier(key) ? key.name : literal(key);
/**
 * The compute function of every constraint, by the module's node id and the constraint id, from what the module returns:
 * `return { setup, draw, …, constraints: { "<node id>": { "<constraint id>": computeX, … }, … } }` (each a function, or the
 * name of a function declared in the module).
 */
function computeFunctions(factory: t.FunctionExpression | t.ArrowFunctionExpression) {
  const body = t.isBlockStatement(factory.body) ? factory.body.body : [];
  const declared = new Set(body.flatMap(statement => t.isFunctionDeclaration(statement) && statement.id ? [statement.id.name]
    : t.isVariableDeclaration(statement) ? statement.declarations.flatMap(item => t.isIdentifier(item.id) && (t.isFunctionExpression(item.init) || t.isArrowFunctionExpression(item.init)) ? [item.id.name] : []) : []));
  const returned = body.filter((statement): statement is t.ReturnStatement => t.isReturnStatement(statement));
  if (returned.length !== 1 || !t.isObjectExpression(returned[0].argument)) throw new Error("The module function must end with one `return { …handlers, constraints: { … } }` object.");
  const found = new Map<string, Set<string>>();
  const field = returned[0].argument.properties.find((item): item is t.ObjectProperty => t.isObjectProperty(item) && keyName(item.key, item.computed) === "constraints");
  if (!field) return found;
  if (!t.isObjectExpression(field.value)) throw new Error("`constraints` must be an object literal: { \"<node id>\": { \"<constraint id>\": computeFunction } }.");
  for (const entry of field.value.properties) {
    const nodeId = t.isObjectProperty(entry) ? keyName(entry.key, entry.computed) : null;
    if (!nodeId || !t.isObjectProperty(entry) || !t.isObjectExpression(entry.value)) throw new Error("Each entry of `constraints` is a node ID with an object literal of compute functions.");
    const own = found.get(nodeId) ?? new Set<string>(); found.set(nodeId, own);
    for (const item of entry.value.properties) {
      const id = t.isObjectProperty(item) || t.isObjectMethod(item) ? keyName(item.key, item.computed) : null;
      const fn = t.isObjectMethod(item) || (t.isObjectProperty(item) && (t.isFunctionExpression(item.value) || t.isArrowFunctionExpression(item.value) || (t.isIdentifier(item.value) && declared.has(item.value.name))));
      if (!id || !fn) throw new Error(`The compute function of ${nodeId}/${id ?? "?"} must be a function (or the name of one declared in the module).`);
      own.add(id);
    }
  }
  return found;
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
  const nodes = new Map(scene.nodes.map(node => [node.id, node]));
  const computes = new Map<string, Map<string, Set<string>>>(), fsmNodes = new Set<string>(), dispatched = new Map<string, Set<string>>();
  if (result.code.includes("@rulegen-")) throw new Error("Host connection blocks are generated by the server. Please generate again.");
  const ast = parse(result.code, { sourceType: "script" });
  // Top level: only one rulegenModule call per root node.
  const modules = new Map<string, string>(), owner = new Map<t.Node, string>(), factories = new Set<t.Node>();
  for (const statement of ast.program.body) {
    const call = t.isExpressionStatement(statement) && t.isCallExpression(statement.expression) ? statement.expression : null;
    if (!call || !t.isIdentifier(call.callee, { name: "rulegenModule" })) throw new Error("All code must be inside rulegenModule(...), one per root node. Please generate again.");
    const key = literal(call.arguments[0]), factory = call.arguments[1];
    if (!key || !subtree.has(key)) throw new Error(`The rulegenModule name must be a root node ID${key ? `: ${key}` : ""}.`);
    if (modules.has(key)) throw new Error(`The ${key} module is defined twice.`);
    if (call.arguments.length !== 2 || !(t.isFunctionExpression(factory) || t.isArrowFunctionExpression(factory)) || factory.params.length !== 1 || !t.isIdentifier(factory.params[0], { name: "m" }))
      throw new Error("rulegenModule must take the form (\"node ID\", function (m) { … }).");
    checkFactory(factory);
    computes.set(key, computeFunctions(factory));
    modules.set(key, result.code.slice(factory.start!, factory.end!));
    owner.set(statement, key); factories.add(factory);
  }
  const missing = roots.filter(id => !modules.has(id));
  if (missing.length) throw new Error(`Each root node needs a module: ${missing.join(", ")}`);
  const moduleOf = (path: NodePath) => { let current: NodePath | null = path; while (current && !current.parentPath?.isProgram()) current = current.parentPath; return current ? owner.get(current.node)! : ""; };
  const used = new Set<string>();
  const nodeOf = (path: NodePath, id: string | null, what: string) => {
    if (!id || !subtree.get(moduleOf(path))!.has(id)) throw new Error(`${what} must take a node ID of this module as a string${id ? `: ${id}` : ""}.`);
    return id;
  };
  traverse(ast, {
    Identifier(path) {
      const name = path.node.name, self: t.Node = path.node;
      // Type guards are read once: narrowing on them would make later checks unreachable for TypeScript.
      const binding = path.isBindingIdentifier(), referenced = path.isReferencedIdentifier(), parent = path.parentPath as NodePath, listKey = path.listKey;
      if (HOST_NAMES.has(name)) {
        if (binding) throw new Error("The generated code overwrote a host connection name. Please generate again.");
        const top = name === "rulegenModule" && parent.isCallExpression() && parent.node.callee === self && Boolean(parent.parentPath?.parentPath?.isProgram());
        if (referenced && !top) throw new Error(`Generated code cannot access ${name}. Read values and state through m.`);
        return;
      }
      if (name !== "m") return;
      if (binding) { if (!(listKey === "params" && factories.has(parent.node))) throw new Error("m is the module context name and cannot be redeclared."); return; }
      if (!referenced) return;
      const member = parent;
      if (!member.isMemberExpression() || member.node.object !== self || member.node.computed || !t.isIdentifier(member.node.property) || !CONTEXT.has(member.node.property.name))
        throw new Error("m can only be used as m.v / m.box / m.fsm / m.owners / m.history / m.memo / m.p / m.store.");
      const field = (member.node.property as t.Identifier).name;
      if (field === "store") {
        const use = member.parentPath as NodePath;
        if ((use.isAssignmentExpression() && use.node.left === member.node) || use.isUpdateExpression() || (use.isCallExpression() && use.node.callee === member.node)) throw new Error("m.store cannot be replaced. Change the values inside it instead, like m.store.x = ….");
        return;
      }
      if (field === "p") return;
      const call = member.parentPath as NodePath | null;
      if (!call?.isCallExpression() || call.node.callee !== member.node) throw new Error(`m.${field} must be called directly.`);
      const args = call.node.arguments;
      if (field === "history") { if (args.length) throw new Error("m.history() is called without arguments."); return; }
      if (field === "memo") { if (args.length !== 2) throw new Error("m.memo is called as m.memo(key, () => value)."); return; }
      if (field === "v") {
        const key = literal(args[0]);
        if (args.length !== 1) throw new Error('m.v is called as m.v("<node id>/<param id>").');
        if (!key || !required.has(key) || !subtree.get(moduleOf(path))!.has(decodeURIComponent(key.slice(0, key.indexOf("/"))))) throw new Error("The param connections in the generated code are invalid. Please generate again.");
        used.add(key);
      } else if (field === "box") {
        // A node ID given as a string is checked here; one passed through a variable (a shared helper) is checked by the runtime (Unknown node).
        if (args.length !== 1) throw new Error('m.box is called as m.box("<node id>").');
        if (literal(args[0]) !== null) nodeOf(path, literal(args[0]), "m.box");
      }
      else if (field === "owners") nodeOf(path, literal(args[0]), "m.owners");
      else { if (args.length > 2) throw new Error('m.fsm is called as m.fsm("<node id>") or m.fsm("<node id>", itemKey).'); fsmNodes.add(nodeOf(path, literal(args[0]), "m.fsm")); }
    },
    MemberExpression(path) {
      // p.setup = …, p.draw = … and other writes to p belong to the host.
      if (!t.isIdentifier(path.node.object, { name: "p" }) && !isP(path.node.object)) return;
      const parent = path.parentPath;
      if ((parent.isAssignmentExpression() && parent.node.left === path.node) || parent.isUpdateExpression()) throw new Error("A module cannot change properties of p such as p.setup or p.draw. Use the setup/draw/input functions the module returns.");
    },
    CallExpression(path) {
      const callee = path.node.callee;
      // owner.dispatch("<event>"): an event declared by a transition of one of this module's nodes.
      if (t.isMemberExpression(callee) && !callee.computed && t.isIdentifier(callee.property, { name: "dispatch" })) {
        const event = literal(path.node.arguments[0]), module = moduleOf(path), events = [...subtree.get(module) ?? []].flatMap(id => nodes.get(id)?.machine?.transitions.map(item => item.event) ?? []);
        if (path.node.arguments.length !== 1 || !event) throw new Error('owner.dispatch takes one event name as a string literal: owner.dispatch("<event>").');
        if (!events.includes(event)) throw new Error(`owner.dispatch("${event}") is not an event of a transition of this module's nodes.`);
        dispatched.set(module, (dispatched.get(module) ?? new Set()).add(event));
      }
      if (t.isMemberExpression(callee) && !callee.computed && t.isIdentifier(callee.property) && HOST_CALLS.has(callee.property.name) && isP(callee.object))
        throw new Error(`A module cannot call p.${callee.property.name}(). The host manages the canvas and the loop.`);
    },
    AssignmentExpression(path) {
      // Undeclared globals would be state shared between modules.
      if (t.isIdentifier(path.node.left) && !path.scope.hasBinding(path.node.left.name)) throw new Error(`Cannot write to the undeclared global variable ${path.node.left.name}. Declare it inside the module.`);
    },
  });
  if ([...required].some(key => !used.has(key))) throw new Error("Some params could not be connected to the code. Please generate again.");
  // Every constraint has its compute function, every node with constraints is evaluated, every declared event is dispatched.
  for (const [module, members] of subtree) {
    const own = computes.get(module)!;
    for (const nodeId of own.keys()) if (!members.has(nodeId)) throw new Error(`constraints["${nodeId}"] is not a node of the ${module} module.`);
    for (const nodeId of members) {
      const node = nodes.get(nodeId)!, given = own.get(nodeId) ?? new Set<string>();
      const missingCompute = node.constraints.filter(constraint => !given.has(constraint.id)).map(constraint => constraint.id);
      if (missingCompute.length) throw new Error(`Each constraint needs its compute function in constraints["${nodeId}"]: ${missingCompute.join(", ")}.`);
      const extra = [...given].filter(id => !node.constraints.some(constraint => constraint.id === id));
      if (extra.length) throw new Error(`constraints["${nodeId}"] has functions for constraints that do not exist: ${extra.join(", ")}.`);
      if (node.constraints.length && !fsmNodes.has(nodeId)) throw new Error(`${nodeId} has constraints but its FSM is never evaluated: call m.fsm("${nodeId}"…).evaluate(…) where they apply.`);
      const silent = (node.machine?.transitions ?? []).filter(item => !dispatched.get(module)?.has(item.event)).map(item => item.event);
      if (silent.length) throw new Error(`Declared transitions are never taken: dispatch ${[...new Set(silent)].map(event => `"${event}"`).join(", ")} for ${nodeId} when they happen.`);
    }
  }
  const code = assembleProgram(scene, [...modules].map(([key, factory]) => moduleSource(key, factory)));
  return { ...result, code, sceneBindings: bindings, machineSignature: machineSignature(scene) };
}
