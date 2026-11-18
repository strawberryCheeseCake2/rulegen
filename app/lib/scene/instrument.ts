import { parse } from "@babel/parser";
import { programModules } from "./machines";

// Variable recording. A module's code is rewritten (only to be run while its execution is recorded) so that the
// running sketch can read every variable it has, not only what passes through `m`:
//  - at every `return <value>` (and every arrow function's expression body) inside the module, the variables visible
//    there: those of the constraint compute function returning (and of the helpers it calls) are its step's variables;
//  - at every `<owner>.evaluate(…)` / `<owner>.dispatch(…)` call, the variables visible at the call (the item loop
//    around it: which gesture, which index), the caller's variables of the steps it takes;
//  - at the start of the module's factory, its own top-level variables (constants, helpers, settings).
// Each is a reader `() => [[name, () => name], …]`: nothing is copied unless the recorder asks, and a variable read
// before its declaration ran is skipped by the recorder. Names are those declared in the module (shadowing respected);
// `m` and anything outside the module are not variables of it.

/** The recorder the rewritten code calls (defined by the scene driver). */
export const RECORDER = "__rgRec";

type Node = { type: string; start: number; end: number; [key: string]: unknown };
type Scope = { names: string[]; factory: boolean };
type Edit = { at: number; end: number; text: string; order: number };

const isNode = (value: unknown): value is Node => Boolean(value) && typeof value === "object" && typeof (value as Node).type === "string" && typeof (value as Node).start === "number";
const SKIP_KEYS = new Set(["loc", "start", "end", "extra", "leadingComments", "trailingComments", "innerComments", "range", "type"]);
function children(node: Node): Node[] {
  const out: Node[] = [];
  for (const key of Object.keys(node)) {
    if (SKIP_KEYS.has(key)) continue;
    const value = node[key];
    if (Array.isArray(value)) { for (const item of value) if (isNode(item)) out.push(item); }
    else if (isNode(value)) out.push(value);
  }
  return out;
}
const FUNCTIONS = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression", "ObjectMethod", "ClassMethod", "ClassPrivateMethod"]);

/** The names a binding pattern declares. */
function patternNames(pattern: Node | null | undefined, out: string[] = []): string[] {
  if (!pattern) return out;
  switch (pattern.type) {
    case "Identifier": out.push(pattern.name as string); break;
    case "ObjectPattern": for (const prop of pattern.properties as Node[]) patternNames(prop.type === "RestElement" ? prop.argument as Node : prop.value as Node, out); break;
    case "ArrayPattern": for (const element of pattern.elements as (Node | null)[]) patternNames(element, out); break;
    case "RestElement": patternNames(pattern.argument as Node, out); break;
    case "AssignmentPattern": patternNames(pattern.left as Node, out); break;
    case "TSParameterProperty": patternNames(pattern.parameter as Node, out); break;
  }
  return out;
}
/** `var` names declared anywhere in a function body (not inside nested functions): hoisted to the function. */
function hoistedVars(node: Node, out: string[] = []): string[] {
  for (const child of children(node)) {
    if (FUNCTIONS.has(child.type)) continue;
    if (child.type === "VariableDeclaration" && child.kind === "var") for (const declaration of child.declarations as Node[]) patternNames(declaration.id as Node, out);
    hoistedVars(child, out);
  }
  return out;
}
/** Names a statement list declares in its own block: let, const, class and function declarations. */
function lexicalNames(statements: Node[]): string[] {
  const out: string[] = [];
  for (const statement of statements) {
    const declaration = statement.type === "ExportNamedDeclaration" ? statement.declaration as Node : statement;
    if (!declaration) continue;
    if (declaration.type === "VariableDeclaration" && declaration.kind !== "var") for (const item of declaration.declarations as Node[]) patternNames(item.id as Node, out);
    if ((declaration.type === "FunctionDeclaration" || declaration.type === "ClassDeclaration") && declaration.id) out.push((declaration.id as Node).name as string);
  }
  return out;
}
/** The variables visible inside the module at this point (innermost first wins), not those of the factory itself. */
function visible(stack: Scope[]): string[] {
  const seen = new Set<string>(), out: string[] = [];
  for (let i = stack.length - 1; i >= 0 && !stack[i].factory; i--) for (const name of stack[i].names) if (!seen.has(name)) { seen.add(name); out.push(name); }
  return out;
}
const reader = (names: string[]) => `()=>[${names.map(name => `[${JSON.stringify(name)},()=>${name}]`).join(",")}]`;

/** The factory function of a module chunk: the second argument of `rulegenModule(key, factory)`. */
function factoryOf(program: Node): Node | null {
  let found: Node | null = null;
  const walk = (node: Node) => {
    if (found) return;
    if (node.type === "CallExpression" && (node.callee as Node).type === "Identifier" && (node.callee as Node).name === "rulegenModule") {
      const factory = (node.arguments as Node[])[1];
      if (factory && (factory.type === "FunctionExpression" || factory.type === "ArrowFunctionExpression")) { found = factory; return; }
    }
    for (const child of children(node)) walk(child);
  };
  walk(program);
  return found;
}

/** One module chunk (`rulegenModule(key, factory)`) rewritten to report its variables; unchanged if it cannot be parsed. */
export function instrumentModule(text: string): string {
  let ast: Node;
  try { ast = parse(text, { sourceType: "script", allowReturnOutsideFunction: true, errorRecovery: false }).program as unknown as Node; } catch { return text; }
  const factory = factoryOf(ast);
  if (!factory || (factory.body as Node).type !== "BlockStatement") return text;
  const edits: Edit[] = [];
  // Each return site has a number: the recorder keeps only the last values of a site (a helper called many times).
  let sites = 0;
  const open = (at: number, text: string, depth: number) => edits.push({ at, end: at, text, order: depth });
  const close = (at: number, text: string, depth: number) => edits.push({ at, end: at, text, order: -depth });

  const functionScope = (fn: Node, isFactory: boolean): Scope => {
    const names = (fn.params as Node[]).flatMap(param => patternNames(param));
    if (fn.type === "FunctionExpression" && fn.id) names.push((fn.id as Node).name as string);
    const body = fn.body as Node;
    if (body.type === "BlockStatement") names.push(...hoistedVars(body), ...lexicalNames(body.body as Node[]));
    // The factory's parameter is `m`: the module context, not a variable of it.
    return { names: isFactory ? names.filter(name => !(fn.params as Node[]).some(param => patternNames(param).includes(name))) : names, factory: isFactory };
  };

  const walk = (node: Node, stack: Scope[], depth: number) => {
    // Inside the module, a value returned, an arrow's value, an evaluate/dispatch call.
    if (node.type === "ReturnStatement" && node.argument) {
      const names = visible(stack);
      if (names.length) { const argument = node.argument as Node; open(argument.start, `${RECORDER}.ret((`, depth); close(argument.end, `),${reader(names)},${sites++})`, depth); }
    }
    if (node.type === "CallExpression") {
      const callee = node.callee as Node;
      if (callee.type === "MemberExpression" && !callee.computed && !callee.optional && (callee.property as Node).type === "Identifier" && ["evaluate", "dispatch"].includes((callee.property as Node).name as string)) {
        const object = callee.object as Node;
        open(callee.start, `${RECORDER}.call(`, depth);
        edits.push({ at: object.end, end: callee.end, text: `,${JSON.stringify((callee.property as Node).name)},${reader(visible(stack))})`, order: 0 });
      }
    }
    if (FUNCTIONS.has(node.type)) {
      const scope = functionScope(node, false), inner = [...stack, scope], body = node.body as Node;
      for (const param of node.params as Node[]) walk(param, inner, depth + 1);
      if (body.type === "BlockStatement") { for (const statement of body.body as Node[]) walk(statement, inner, depth + 1); }
      else {
        const names = visible(inner);
        if (names.length) { open(body.start, `${RECORDER}.ret((`, depth + 1); close(body.end, `),${reader(names)},${sites++})`, depth + 1); }
        walk(body, inner, depth + 1);
      }
      if (node.key && node.computed) walk(node.key as Node, stack, depth + 1);
      return;
    }
    let scope: Scope | null = null;
    if (node.type === "BlockStatement" || node.type === "StaticBlock") scope = { names: lexicalNames(node.body as Node[]), factory: false };
    else if (node.type === "SwitchStatement") scope = { names: lexicalNames((node.cases as Node[]).flatMap(item => item.consequent as Node[])), factory: false };
    else if (node.type === "ForStatement" || node.type === "ForInStatement" || node.type === "ForOfStatement") {
      const head = (node.type === "ForStatement" ? node.init : node.left) as Node | null;
      scope = { names: head && head.type === "VariableDeclaration" && head.kind !== "var" ? (head.declarations as Node[]).flatMap(item => patternNames(item.id as Node)) : [], factory: false };
    } else if (node.type === "CatchClause") scope = { names: patternNames(node.param as Node | null), factory: false };
    const next = scope ? [...stack, scope] : stack;
    for (const child of children(node)) walk(child, next, depth + 1);
  };

  const factoryScope = functionScope(factory, true), body = factory.body as Node;
  for (const statement of body.body as Node[]) walk(statement, [factoryScope], 1);
  // The module's own top-level variables, readable for every step of it.
  const top = factoryScope.names;
  if (top.length) edits.push({ at: body.start + 1, end: body.start + 1, text: `${RECORDER}.bind(${reader(top)});`, order: -1e6 });

  edits.sort((a, b) => a.at - b.at || a.order - b.order);
  let out = "", offset = 0;
  for (const edit of edits) {
    if (edit.at < offset) continue; // inside a range already replaced (not expected)
    out += text.slice(offset, edit.at) + edit.text;
    offset = edit.end;
  }
  return out + text.slice(offset);
}

/** A program with every module rewritten to report its variables (the runtime and the host code untouched). */
export function instrumentProgram(program: string): string {
  let out = program;
  for (const chunk of programModules(program).values()) out = out.replace(chunk, () => instrumentModule(chunk));
  return out;
}
