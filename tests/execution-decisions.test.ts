import test from "node:test";
import assert from "node:assert/strict";
import { run, sampleScene, sceneProgram } from "./fixtures/scene";
import { connectScene } from "../app/server/scene-code.server";
import { testGlyphs, traceOnly, withoutTests } from "../app/lib/explore";

// Three dots, one checkpoint each; a dot is drawn only when it is within reach of the first (a decision, m.test).
const program = connectScene({ title: "Tree", explanation: "", code: sceneProgram }, sampleScene()).code.replace("    draw() {",
  "    draw() {\n      for (let i = 0; i < 3; i++) { m.trace(\"dot \" + i, { op: 1, x: i * 10, y: 5 }); if (m.test(\"near\", i * 10 < 15, { x: i * 10, y: 5, r: 6 }, [\"joined!\", \"too far\"])) p.circle(i * 10, 5, 4); }");
type Run = { events: { kind: string; tests?: { name: string; pass: boolean; shape: unknown; yes?: string; no?: string }[] }[] };

test("a decision (m.test) is returned as it is and recorded, with the shape tested and its verdicts, on the step that makes it", () => {
  const sketch = run(program);
  sketch.circles.length = 0; sketch.draw();
  assert.deepEqual(sketch.circles.filter(circle => circle[2] === 4).map(circle => circle[0]), [0, 10], "the code goes on as it decides (outside a run too)");
  sketch.read(`rulegenRunStart(null, ["tree"], null, {})`); sketch.draw();
  const recorded: Run = JSON.parse(JSON.stringify(sketch.read("rulegenRunEnd()")));
  assert.deepEqual(recorded.events.filter(event => event.kind === "trace").map(event => event.tests), [
    [{ name: "near", pass: true, shape: { x: 0, y: 5, r: 6 }, yes: "joined!", no: "too far" }],
    [{ name: "near", pass: true, shape: { x: 10, y: 5, r: 6 }, yes: "joined!", no: "too far" }],
    [{ name: "near", pass: false, shape: { x: 20, y: 5, r: 6 }, yes: "joined!", no: "too far" }]]);
});

test("checkpoint edits may wrap a condition in m.test as it is; anything that changes the code is dropped", () => {
  assert.equal(withoutTests("if (m.test(\"overlap\", d < ra + rb, [{ x: a.x, y: a.y, r: ra }, { x: b.x, y: b.y, r: rb }], [\"merged!\", \"not merged\"])) merge(a, b);"), "if ((d < ra + rb)) merge(a, b);");
  assert.equal(withoutTests("if (m.test(name, d < r)) go();"), null, "the name is a short lowercase literal");
  const find = "if (d < ra + rb) merge(a, b);";
  assert.ok(traceOnly({ find, replace: "if (m.test(\"overlap\", d < ra + rb, { x1: a.x, y1: a.y, x2: b.x, y2: b.y }, [\"merged!\", \"not merged\"])) merge(a, b);" }));
  assert.ok(traceOnly({ find, replace: "m.trace(\"pair\", { op: 2 }); if (m.test(\"overlap\", d < ra + rb)) merge(a, b);" }), "with a checkpoint, without shape or verdicts");
  assert.ok(!traceOnly({ find, replace: "if (m.test(\"overlap\", d < ra + rb + 5)) merge(a, b);" }), "a changed condition");
  assert.ok(!traceOnly({ find, replace: "if (m.test(\"overlap\", d < ra + rb)) { merge(a, b); grow(a); }" }), "code added");
});

test("decisions are drawn as the shapes tested, colored by the outcome, with the verdict over them", () => {
  const [merged, apart] = testGlyphs([
    { name: "overlap", pass: true, shape: [{ x: 10, y: 20, r: 5 }, { x: 30, y: 20, r: 5 }, { x: 0, y: 0 }, { x: 1, y: 1 }], yes: "merged!", no: "not merged" },
    { name: "overlap", pass: false, shape: { x1: 0, y1: 0, x2: 40, y2: 10 }, yes: "merged!", no: "not merged" },
  ]);
  assert.deepEqual([merged.verdict, merged.shapes.map(shape => shape.kind), merged.at], ["merged!", ["circle", "circle", "point"], { x: 17.5, y: 0 }], "up to 3 shapes, the verdict above them");
  assert.deepEqual([apart.pass, apart.verdict, apart.shapes[0].kind], [false, "not merged", "line"]);
  assert.equal(testGlyphs([{ name: "long-enough", pass: false, shape: { x: 1, y: 2, w: 3, h: 4 } }])[0].verdict, "not long-enough", "without verdicts, the test's name");
  assert.deepEqual(testGlyphs([{ name: "x", pass: true, shape: "nowhere" }]), [], "nothing to draw without a shape");
});

test("the picture is about one step: explaining overlays read the step just executed, positions are never made up, and change coloring starts off", async () => {
  const { readFileSync } = await import("node:fs");
  const explore = readFileSync("prompts/explore.md", "utf8"), inspect = readFileSync("prompts/inspect.md", "utf8"), frame = readFileSync("app/components/explore-frame.tsx", "utf8");
  assert.match(explore, /The explaining overlays \(with `handle` `null`\) are about the step JUST EXECUTED: they read `@last`/);
  assert.match(explore, /Only the execution handle \(and at most one faint mark of where the next step works\) reads `@next`/);
  for (const prompt of [explore, inspect]) assert.match(prompt, /NEVER INVENT A POSITION/);
  assert.match(frame, /\[showChange, setShowChangeState\] = useState\(false\)/, "blue / orange change coloring is off unless turned on");
  assert.match(frame, /if \(!from \|\| !showChangeNow\.current\) return;/, "and not worked out while off");
});
