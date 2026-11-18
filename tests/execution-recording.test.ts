import { test } from "node:test";
import assert from "node:assert/strict";
import { run, sampleScene, sceneProgram } from "./fixtures/scene";
import { assembleProgram, moduleSource, programModules } from "../app/lib/scene/machines";
import { instrumentProgram } from "../app/lib/scene/instrument";
import { RECORDER_RUNTIME } from "../app/lib/execution/recorder-runtime";
import { addCycle, emptyTrace, nextIds, readCycle, readPath, siteOf } from "../app/lib/execution/trace";

/** The fixture program as the sandbox runs it: modules instrumented, the recorder ahead of them. */
function recordedSketch() {
  const module = [...programModules(assembleProgram(sampleScene(), [moduleSource("tree", sceneProgram.replace(/^rulegenModule\("tree", /, "").replace(/\);\s*$/, ""))])).values()][0];
  const program = RECORDER_RUNTIME + "\n" + instrumentProgram(assembleProgram(sampleScene(), [module]));
  return run(program);
}
/** One drawing recorded as a cycle (what the sandbox host does on a frame drawn from something new). */
function recordFrame(sketch: ReturnType<typeof run>) {
  return sketch.read(`(() => { __rgRec.arm(true); const runtime = rulegenSnapshot(); rulegenRunStart(null, null); __rgRec.drawStart(true);
    try { p.draw(); } finally { var out = __rgRec.drawEnd(); rulegenRunEnd(); }
    return JSON.parse(JSON.stringify({ at: 1, runtime, params: {}, steps: out.steps, truncated: out.truncated })); })()`);
}

test("a recorded drawing keeps every FSM step with the variables of the code there", () => {
  const sketch = recordedSketch();
  const raw = recordFrame(sketch);
  const cycle = readCycle(raw, 1, 1)!;
  assert.ok(cycle.steps.length >= 4, "state visits and constraints of tree and orb");
  const branches = cycle.steps.find(step => siteOf(step) === "constraint:tree/branching-growth")!;
  assert.ok(branches, "the branching constraint is a step");
  // Locals of the compute function and of the helper it called, the module's top level, and the FSM values.
  assert.equal(readPath(branches, "@depth"), 5);
  assert.equal(readPath(branches, "@base"), 140);
  assert.deepEqual(readPath(branches, "@lengths"), readPath(branches, "@$value"));
  assert.equal((readPath(branches, "@$value") as number[]).length, 5);
  assert.ok("decayed" in branches.variables === false, "functions are left out");
  const size = cycle.steps.find(step => siteOf(step) === "constraint:orb/pulse")!;
  assert.equal(readPath(size, "@$value"), 48);
  // The caller's variables at evaluate: the draw function's own (tree's data is there once evaluated).
  assert.ok("box" in size.variables && "tree" in size.variables);
  // Each step knows where it is in the drawing (to redraw up to it).
  assert.ok(cycle.steps.every((step, i) => i === 0 || step.index >= cycle.steps[i - 1].index));
});

test("steps taken by input handlers wait for the next recorded cycle; nothing is kept when not recording", () => {
  const sketch = recordedSketch();
  sketch.read(`__rgRec.arm(true); p.mousePressed();`);
  const raw = recordFrame(sketch);
  const transition = raw.steps.find((step: { kind: string }) => step.kind === "transition");
  assert.ok(transition && transition.pre, "the press transition comes first, marked as before the drawing");
  assert.equal(transition.index, -1);
  sketch.read(`__rgRec.arm(false); __rgRec.drawStart(false); p.draw(); globalThis.__out = __rgRec.drawEnd();`);
  assert.equal(sketch.read("__out"), null);
});

test("cycles are kept with unique step ids across the trace", () => {
  const sketch = recordedSketch();
  let trace = emptyTrace();
  for (let i = 0; i < 3; i++) { const ids = nextIds(trace); trace = addCycle(trace, readCycle(recordFrame(sketch), ids.cycle, ids.step)!); }
  const ids = trace.cycles.flatMap(cycle => cycle.steps.map(step => step.id));
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(trace.cycles.length, 3);
});
