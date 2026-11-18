import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { run, sampleScene, sceneProgram } from "./fixtures/scene";
import { connectScene } from "../app/server/scene-code.server";
import { combStroke, fieldsIn, type FieldSamples } from "../app/lib/fields";
import type { GeneratedCode } from "../app/lib/schema";
import { FieldLayer } from "../app/components/field-layer";

// A flow field (an angle at every point: here pointing right everywhere), sampled by lines the module draws, with a cached result.
const program = (field: string) => connectScene({ title: "Tree", explanation: "", code: sceneProgram.replace("    draw() {",
  `    draw() {\n      const flow = m.field("flow", ${field});\n      m.store.angles = [flow(100, 100), flow(800, 500)];\n      m.store.cached = m.memo("lines", () => flow(100, 100));`) }, sampleScene()).code;

test("a brush's field (m.field) is sampled through the function it returns; an inspection can sample it on a grid and comb it, the held step only", () => {
  const sketch = run(program("(x, y) => 0"));
  sketch.draw();
  const angles = () => sketch.read("JSON.stringify(rulegenLive[0].store.angles)");
  assert.equal(angles(), "[0,0]", "as the code makes it");
  // Sampled on a grid over the canvas, by "<root>/<field id>".
  const samples = JSON.parse(sketch.read("JSON.stringify(rulegenFieldSamples())")) as Record<string, FieldSamples>;
  assert.deepEqual(Object.keys(samples), ["tree/flow"]); assert.equal(samples["tree/flow"].cells.length, 36 * 24); assert.deepEqual(samples["tree/flow"].cells[0], [0, 1]);
  // Combed downward near (100, 100): the field there turns down, far away it stays; an angle stays an angle.
  sketch.read(`rulegenSetFieldEdits(${JSON.stringify({ "tree/flow": [combStroke([{ x: 100, y: 40 }, { x: 100, y: 100 }, { x: 100, y: 160 }], 80, 3)] })})`);
  sketch.draw();
  const [near, far] = JSON.parse(angles());
  assert.ok(near > .8 && near <= Math.PI / 2, `turned toward the comb (${near})`); assert.equal(far, 0, "out of its reach");
  assert.ok(JSON.parse(sketch.read("JSON.stringify(rulegenLive[0].store.cached)")) > .8, "what was computed with the field as it was is not reused with the comb");
  sketch.read("rulegenSetFieldEdits({})"); sketch.draw();
  assert.equal(angles(), "[0,0]"); assert.equal(sketch.read("JSON.stringify(rulegenLive[0].store.cached)"), "0", "and back");
  // A vector field stays a vector, its length kept.
  const vector = run(program("(x, y) => [2, 0]"));
  vector.read(`rulegenSetFieldEdits(${JSON.stringify({ "tree/flow": [combStroke([{ x: 100, y: 40 }, { x: 100, y: 160 }], 80, 3)] })})`); vector.draw();
  const [v] = JSON.parse(vector.read("JSON.stringify(rulegenLive[0].store.angles)"));
  assert.ok(Array.isArray(v) && Math.abs(Math.hypot(v[0], v[1]) - 2) < 1e-6 && v[1] > 0);
});

test("a field declared per mark (again in the same frame) is reported, so the arrows are not taken for the marks' field", () => {
  const sketch = run(connectScene({ title: "Tree", explanation: "", code: sceneProgram.replace("    draw() {",
    "    draw() {\n      for (let i = 0; i < 3; i++) { const flow = m.field(\"flow\", (x, y) => i); flow(0, 0); }") }, sampleScene()).code);
  sketch.draw(); sketch.draw();
  assert.equal(JSON.parse(sketch.read("JSON.stringify(rulegenFieldSamples())"))["tree/flow"].declared, 3);
  const once = run(program("(x, y) => 0")); once.draw(); once.draw();
  assert.equal(JSON.parse(once.read("JSON.stringify(rulegenFieldSamples())"))["tree/flow"].declared, 1);
  const field: FieldSamples = { root: "tree", id: "flow", cols: 1, rows: 1, w: 900, h: 600, cells: [[0, 1]], declared: 3 };
  assert.match(renderToStaticMarkup(createElement(FieldLayer, { fields: [["tree/flow", field]], edits: {}, onEdits: () => {}, nameOf: () => "flow" })), /Declared per mark · arrows may not match/);
});

test("generated code declares a field with m.field(\"<id>\", fn); anything else is refused", () => {
  assert.throws(() => connectScene({ title: "Tree", explanation: "", code: sceneProgram.replace("    draw() {", "    draw() {\n      const flow = m.field(name, (x, y) => 0);") }, sampleScene()), /m\.field is called as/);
  assert.throws(() => connectScene({ title: "Tree", explanation: "", code: sceneProgram.replace("    draw() {", "    draw() {\n      const flow = m.field(\"Flow Field\", (x, y) => 0);") }, sampleScene()), /short lowercase id/);
  assert.match(readFileSync("prompts/contracts/scene-code.md", "utf8"), /`m\.field\("<field id>", \(x, y\) => value\)`/, "the code contract asks for it");
});

test("an inspected frame shows the brush's fields as arrows and combs them; the combs go with the held step", () => {
  const field: FieldSamples = { root: "tree", id: "flow", cols: 2, rows: 1, w: 900, h: 600, cells: [[0, 1], [Math.PI / 2, .5]] };
  assert.deepEqual(fieldsIn({ "@field": { "tree/flow": field, "other/flow": { ...field, root: "other" } } }, ["tree"]).map(([key]) => key), ["tree/flow"], "the inspected brush's only");
  const html = renderToStaticMarkup(createElement(FieldLayer, { fields: [["tree/flow", field]], edits: { "tree/flow": [{ points: [[0, 0], [10, 10]], radius: 40, strength: 1 }] }, onEdits: () => {}, nameOf: () => "Tree · flow" }));
  assert.equal((html.match(/<line /g) ?? []).length, 2, "an arrow per cell");
  assert.match(html, /<b>Tree · flow<\/b>/); assert.match(html, />Comb</); assert.match(html, /1 comb · what-if on this step/);
  assert.equal(renderToStaticMarkup(createElement(FieldLayer, { fields: [], edits: {}, onEdits: () => {}, nameOf: key => key })), "", "a brush without a field: nothing");
  assert.equal(combStroke([{ x: 0, y: 0 }, { x: 2, y: 1 }], 50, 1), null, "a click is no comb");
  const home = readFileSync("app/routes/home.tsx", "utf8"), preview = readFileSync("app/components/code-preview.tsx", "utf8");
  assert.match(home, /fields: inspected!\.fieldEdits, playOn: playOns\[id\]\?\.restore === restoreId \? playOns\[id\] : null \} : null\}/); assert.match(home, /onEdits=\{fieldEdits => patchInspection\(id, \{ fieldEdits \}\)\}/);
  assert.match(preview, /if\(fields\)rulegenSetFieldEdits\(pinnedFields\|\|\{\}\)/, "drawn with the combs while held"); assert.match(preview, /stores\['@field'\]=sampled/, "and reports the field");
});

test("a targeted inspection lists a field only when the concern is about it; the code is made to declare it (m.field), and only those fields are shown", async () => {
  const { withMockedAI } = await import("./fixtures/scene");
  const { runAI } = await import("../app/server/ai.server");
  const { requestSchema } = await import("../app/lib/schema");
  const { paramRows, inspectResultSchema } = await import("../app/lib/inspection");
  const { hookField, declaresField, fieldHookProblem } = await import("../app/lib/fields");
  const scene = sampleScene(), code = connectScene({ title: "Tree", explanation: "", code: sceneProgram }, scene).code;
  const wrap = { find: "p.stroke(tree.color);", replace: "const flow = m.field(\"flow\", (x, y) => 0); m.store.heading = flow(0, 0); p.stroke(tree.color);" };
  const hook = { id: "flow", nodeId: "tree", name: "Flow direction", reason: "The lines bunch where the flow converges.", edits: [wrap] };
  const output = { summary: "s", overlays: [], parameters: [], records: null,
    fields: [hook, { ...hook, id: "wind", edits: [{ ...wrap, replace: wrap.replace.replace("m.field(\"flow\"", "noField(\"wind\"") }] }] };
  await withMockedAI(() => output, async calls => {
    const result = inspectResultSchema.parse(await runAI(requestSchema.parse({ intent: "inspect", scene, image: "data:image/png;base64,AAAA", instruction: "Why do the lines bunch up here?", previous: code,
      inspection: { brushName: "Tree", nodeIds: ["tree", "orb"], cursor: 0, marks: [],
        params: paramRows(scene, ["tree", "orb"]).map(row => ({ key: row.key, nodeId: row.binding.nodeId, constraintId: row.constraintId, constraint: row.constraint, paramId: row.binding.path[0], param: row.param, type: row.binding.type })),
        steps: [{ id: 1, nodeId: null, from: null, to: null, transitionId: null, values: {}, runtime: null }] } }), new AbortController().signal));
    assert.deepEqual(result.fields.map(item => item.id), ["flow"], "only a field the edits really declare");
    assert.match(result.summary, /1 field\(s\) could not be hooked into the code/);
    assert.match(calls[0].instructions, /## fields — when the concern is about a field the brush follows/);
    // Applied to the frame's code: it declares the field (nothing else changes); applied again, nothing more.
    const hooked = hookField(scene, { title: "Tree", explanation: "", code, sceneBindings: [], machineSignature: "" }, result.fields[0]);
    assert.ok("generated" in hooked && declaresField(hooked.generated.code, "flow"));
    const again = hookField(scene, hooked.generated, result.fields[0]);
    assert.ok("generated" in again && again.generated.code === hooked.generated.code);
    // Declared once per draw and sampled: declared per mark (twice) or never sampled, it is refused; a field declared
    // the wrong way is fixed by the hook's edits (not left as it is because it is declared).
    const declared = (hooked as { generated: GeneratedCode }).generated;
    const twice = { ...hook, edits: [{ find: "m.store.heading = flow(0, 0);", replace: "m.store.heading = flow(0, 0); const again = m.field(\"flow\", (x, y) => 1); again(0, 0);" }] };
    assert.match(fieldHookProblem(scene, declared.code, twice) ?? "", /declared more than once/);
    assert.match(fieldHookProblem(scene, code, { ...hook, edits: [{ ...wrap, replace: wrap.replace.replace(" m.store.heading = flow(0, 0);", "") }] }) ?? "", /never used/);
    const fix = { ...hook, edits: [{ find: "m.field(\"flow\", (x, y) => 0)", replace: "m.field(\"flow\", (x, y) => [0, 1])" }] };
    const fixed = hookField(scene, declared, fix);
    assert.ok("generated" in fixed && fixed.generated.code.includes("m.field(\"flow\", (x, y) => [0, 1])"));
  });
  const home = readFileSync("app/routes/home.tsx", "utf8");
  assert.match(home, /inspectionKind === "targeted" && \(targetedResult\?\.fields\?\.length \?\? 0\) > 0/, "shown only for a targeted inspection that found a field");
  assert.match(home, /\.filter\(\(\[key\]\) => about\(key\)\)/, "and only the fields it lists");
  assert.match(readFileSync("app/studio/inspection-actions.ts", "utf8"), /for \(const hook of out\.result\?\.fields \?\? \[\]\) await applyFieldHook\(deps, owner, hook\);/);
  assert.match(readFileSync("prompts/contracts/scene-code.md", "utf8"), /Do not add it yourself/, "code generation does not declare fields on its own");
  const prompt = readFileSync("prompts/inspect.md", "utf8");
  assert.match(prompt, /THE FIELD IS THE DIRECTION THE MARKS TRAVEL/, "the field is what the lines do, not a push or a component");
  assert.match(prompt, /THE MARKS FOLLOW IT/); assert.match(prompt, /RESTRUCTURE that one computation into tracing along the field/);
  assert.match(prompt, /Declare it ONCE per draw/);
  assert.match(prompt, /ITS SHAPE IS ADJUSTED BY HAND, through the execution state/, "its control points are store values handles move");
  const align = readFileSync("prompts/align.md", "utf8");
  assert.match(align, /Coming out "similar to" or "roughly like" the drawing is not a fix/, "approximating a drawn shape is no fix");
  assert.match(align, /`"value"` only when values of `params` alone produce exactly the drawn state[^\n]*Otherwise a structural change/);
  assert.match(prompt, /`"@store:<root>:<controls>\.\$\{i\}"`/);
  assert.match(home, /backfillStores\(held\.runtime, stores\)/, "a held step recorded before the hook gets those values once, so handles can move them");
});

test("a step recorded before its code kept a value (a field's attractors) gets it once from the step as drawn; then a handle moves it there", async () => {
  const { backfillStores, editRuntime } = await import("../app/lib/runtime-edits");
  const step: { seed: number; states: object; history: unknown[]; stores: Record<string, Record<string, unknown>> } = { seed: 1, states: {}, history: [], stores: { print: { items: [1, 2] } } };
  const drawn = { print: { items: [9], attractors: [{ x: 100, y: 200, strength: 1 }] }, "@field": {} };
  const filled = backfillStores(step, drawn)!;
  assert.deepEqual(filled.stores, { print: { items: [1, 2], attractors: [{ x: 100, y: 200, strength: 1 }] } }, "only what is missing, of the step's own roots");
  assert.equal(backfillStores(filled, drawn), null, "nothing more once it has it");
  const moved = editRuntime(filled, { "@store:print:attractors.0": "30,-20", "@store:print:attractors.0.strength": 2.5 });
  assert.deepEqual(moved.stores.print.attractors, [{ x: 130, y: 180, strength: 2.5 }]);
  assert.equal(editRuntime(step, { "@store:print:attractors.0": "30,-20" }).stores.print.attractors, undefined, "without it, there is nothing to move");
});
