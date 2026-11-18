import { test } from "node:test";
import assert from "node:assert/strict";
import { instrumentModule, instrumentProgram } from "../app/lib/scene/instrument";
import { moduleSource } from "../app/lib/scene/machines";

const factory = `function (m) {
  const SPACING = 12;
  let made = 0;
  function jitterOf(i) { const wobble = Math.sin(i * 1.7) * 4; return wobble; }
  return {
    draw() {
      const gestures = m.history();
      for (let i = 0; i < gestures.length; i++) {
        const g = gestures[i];
        const owner = m.fsm("dot", g.id);
        owner.evaluate(g, i);
        made++;
      }
    },
    constraints: { dot: {
      position: (owner, g, i) => { const t = i / 10; const jitter = jitterOf(i); return { x: g.x + jitter + t, y: g.y }; },
      size: (owner, g) => g.r * SPACING,
    } },
  };
}`;

/** Runs a rewritten module with a recorder that keeps what each reader gives. */
function run(text: string) {
  const reads: { kind: string; names: Record<string, unknown> }[] = [];
  const take = (read: () => [string, () => unknown][]) => Object.fromEntries(read().flatMap(([name, get]) => { try { return [[name, get()]]; } catch { return []; } }));
  const __rgRec = {
    ret: (value: unknown, read: () => [string, () => unknown][], _site?: number) => { reads.push({ kind: "ret", names: take(read) }); return value; },
    call: (object: Record<string, (...args: unknown[]) => unknown>, name: string, read: () => [string, () => unknown][]) => (...args: unknown[]) => { reads.push({ kind: `call:${name}`, names: take(read) }); return object[name](...args); },
    // The module's top level is read later, at the steps (its constants are declared by then).
    bind: (read: () => [string, () => unknown][]) => { bound = read; },
  };
  let bound: (() => [string, () => unknown][]) | null = null;
  type Handlers = { draw: () => void; constraints: Record<string, Record<string, (...args: unknown[]) => unknown>> };
  const made: { factory?: (m: unknown) => Handlers } = {};
  const rulegenModule = (_key: string, fn: (m: unknown) => Handlers) => { made.factory = fn; };
  new Function("rulegenModule", "__rgRec", text)(rulegenModule, __rgRec);
  const owners: unknown[] = [];
  let handlers!: Handlers;
  const m = { history: () => [{ id: 1, x: 10, y: 20, r: 2 }, { id: 2, x: 30, y: 40, r: 3 }],
    fsm: (_id: string, _key: unknown) => { const owner = { evaluate: (...inputs: unknown[]) => { owners.push(inputs); for (const compute of Object.values(handlers.constraints.dot)) compute(owner, ...inputs); } }; return owner; } };
  handlers = made.factory!(m);
  handlers.draw();
  if (bound) reads.push({ kind: "bind", names: take(bound) });
  return { reads, owners };
}

test("a rewritten module reports the variables of returns, evaluate calls and its top level", () => {
  const text = instrumentModule(moduleSource("dots", factory));
  assert.notEqual(text, moduleSource("dots", factory));
  const { reads, owners } = run(text);
  assert.equal(owners.length, 2, "the code still runs as written");
  const bind = reads.find(read => read.kind === "bind")!;
  assert.deepEqual(Object.keys(bind.names).sort(), ["SPACING", "jitterOf", "made"], "top-level variables, not m");
  const call = reads.find(read => read.kind === "call:evaluate")!;
  assert.equal(call.names.i, 0);
  assert.deepEqual(call.names.g, { id: 1, x: 10, y: 20, r: 2 });
  assert.ok("gestures" in call.names && "owner" in call.names);
  assert.ok(!("SPACING" in call.names), "module-level names come from bind only");
  // A compute function's return sees its locals; a helper's return its own.
  const position = reads.find(read => read.kind === "ret" && "jitter" in read.names)!;
  assert.equal(position.names.t, 0);
  assert.equal(position.names.i, 0);
  assert.ok(reads.some(read => read.kind === "ret" && "wobble" in read.names));
  // An arrow's expression body is a return too.
  assert.ok(reads.some(read => read.kind === "ret" && "g" in read.names && !("t" in read.names) && !("wobble" in read.names) && !("jitter" in read.names)));
});

test("block scopes are respected: a variable of another block is not visible", () => {
  const text = instrumentModule(moduleSource("b", `function (m) {
    return { draw() { if (true) { const inner = 1; } const outer = 2; return outer; } };
  }`));
  const reads: string[][] = [];
  const __rgRec = { ret: (value: unknown, read: () => [string, () => unknown][], _site?: number) => { reads.push(read().map(([name]) => name)); return value; }, call: () => () => undefined, bind: () => undefined };
  let made: { draw: () => number } | null = null;
  new Function("rulegenModule", "__rgRec", text)((_k: string, fn: (m: unknown) => { draw: () => number }) => { made = fn({}); }, __rgRec);
  assert.equal(made!.draw(), 2);
  assert.deepEqual(reads, [["outer"]]);
});

test("unparseable code and programs without modules are left as they are", () => {
  assert.equal(instrumentModule("rulegenModule('x', function (m) {"), "rulegenModule('x', function (m) {");
  assert.equal(instrumentProgram("const a = 1;"), "const a = 1;");
});
