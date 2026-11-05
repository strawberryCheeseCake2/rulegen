import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { run, sampleScene, sceneProgram } from "./fixtures/scene";
import { connectScene } from "../app/server/scene-code.server";
import { editRuntime } from "../app/lib/runtime-edits";
import { traceOnly, withoutRuntime } from "../app/lib/explore";

// Four items in two pairs; each item's reach (from a value of the brush) is kept in the execution state (m.runtime), and
// two items join when their reaches meet. As drawn, neither pair meets.
const program = connectScene({ title: "Tree", explanation: "", code: sceneProgram }, sampleScene()).code.replace("    draw() {",
  `    draw() {
      const items = [{ id: "a", x: 100 }, { id: "b", x: 150 }, { id: "c", x: 300 }, { id: "d", x: 350 }];
      const reach = it => m.runtime("reach", it.id, m.v("orb/radius"));
      const near = (one, other) => one !== other && Math.abs(one.x - other.x) < reach(one) + reach(other);
      m.store.joined = items.filter(it => items.some(other => near(it, other))).map(it => it.id).join(",");`);

test("one item's runtime state (m.runtime) is changed at a moment: only what that item is in reacts, and the run goes on from it", () => {
  const sketch = run(program), joined = () => sketch.read("rulegenLive.find(inst => inst.entry.root === 'tree').store.joined");
  sketch.draw();
  assert.equal(joined(), "", "as the code is (24 + 24 < 50): nothing joins");
  const held = JSON.parse(JSON.stringify(sketch.read("rulegenSnapshot()")));
  assert.deepEqual(held.stores.tree["@runtime"].reach.b, { base: 24, value: 24 }, "each item's state is part of the moment");
  // The held moment with item b's reach changed (the handle's key), drawn and played on.
  const edited = editRuntime(held, { "@store:tree:@runtime.reach.b.value": 30 });
  sketch.read(`rulegenRestore(${JSON.stringify(edited)})`); sketch.draw();
  assert.equal(joined(), "a,b", "b's reach meets a's: that pair joins, the other pair does not, nothing else grows");
  sketch.draw(); sketch.draw();
  assert.equal(joined(), "a,b", "playing on, b keeps its changed state");
  assert.deepEqual(held.stores.tree["@runtime"].reach.b, { base: 24, value: 24 }, "the recorded moment is unchanged");
  // What it is computed from changes (a value of the brush): the state follows it again.
  sketch.read(`rulegenParams["orb/radius"] = 26`); sketch.draw();
  assert.equal(joined(), "a,b,c,d");
  sketch.read(`rulegenParams["orb/radius"] = 24`); sketch.draw();
  assert.equal(joined(), "", "b's change is gone once its source changed");
});

test("m.runtime is allowed in code with a literal name, and edits that only add it are kept as checkpoint edits", () => {
  assert.throws(() => connectScene({ title: "Tree", explanation: "", code: sceneProgram.replace("    draw() {", "    draw() {\n      const r = m.runtime(name, 1, 3);") }, sampleScene()), /m\.runtime is called as/);
  assert.equal(withoutRuntime("const r = m.runtime(\"reach\", item.id, h * ratio / 2);"), "const r = (h * ratio / 2);");
  assert.equal(withoutRuntime("const r = m.runtime(\"reach\", h * ratio / 2);"), null, "the item's id is given");
  const find = "const ah = height(a.d, a.id), ch = height(c.d, c.id);";
  assert.ok(traceOnly({ find, replace: "const ah = m.runtime(\"size\", a.id, height(a.d, a.id)), ch = m.runtime(\"size\", c.id, height(c.d, c.id));" }), "both sides wrapped, the code otherwise the same");
  assert.ok(!traceOnly({ find, replace: "const ah = m.runtime(\"size\", a.id, height(a.d, a.id) * 2), ch = height(c.d, c.id);" }), "a changed expression is dropped");
  const prompt = readFileSync("prompts/inspect.md", "utf8");
  assert.match(prompt, /HANDLES CHANGE THE RUNTIME EXECUTION STATE OF THE MOMENT, not the brush's values/);
  assert.match(prompt, /"@store:<root>:@runtime\.<name>\.\$\{item\(\\"id\\"\)\}\.value"/);
  assert.match(readFileSync("prompts/explore.md", "utf8"), /m\.runtime\("<name>", <the item's id>, <the expression as it is>\)/);
});

test("the values mode of an exploration frame keeps edits that only keep an item's state (m.runtime), not checkpoints", () => {
  const server = readFileSync("app/server/intents.server.ts", "utf8");
  assert.match(server, /const keepsState = \(edit: \{ replace: string \}\) => edit\.replace\.includes\("m\.runtime\("\) && !edit\.replace\.includes\("m\.trace\("\);/);
  assert.match(server, /\(previewing \|\| \(traceOnly\(edit\) && \(execution \|\| keepsState\(edit\)\)\)\)/);
});
