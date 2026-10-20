import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { sampleScene, sceneProgram, run, withMockedAI } from "./fixtures/scene";
import { connectScene } from "../app/server/scene-code.server";
import { exposeParameter, parameterProblem, parameterStatus, type ParameterSuggestion } from "../app/lib/hidden-parameters";
import { brushesFor } from "../app/lib/brushes";
import { emptyInspection, inspectResultSchema, remapResult, targetedResultSchema } from "../app/lib/inspection";
import { sceneLiveStatus } from "../app/lib/scene/live";
import { findNode } from "../app/lib/scene/graph";
import { findProperty } from "../app/lib/scene/transformations";
import { requestSchema } from "../app/lib/schema";
import { runAI } from "../app/server/ai.server";
import { InspectionPanel } from "../app/components/inspection-panel";

const logDirectory = mkdtempSync(path.join(tmpdir(), "rulegen-hidden-"));
const previousLogDirectory = process.env.RULEGEN_AI_LOG_DIR;
process.env.RULEGEN_AI_LOG_DIR = logDirectory;
after(() => { rmSync(logDirectory, { recursive: true, force: true }); if (previousLogDirectory === undefined) delete process.env.RULEGEN_AI_LOG_DIR; else process.env.RULEGEN_AI_LOG_DIR = previousLogDirectory; });
const noop = () => {};

// The tree's segments are spaced by a hard-coded 10px: a hidden parameter.
const LOOP = "for (let i = 0; i < depth; i++) p.line(x, bottom - i * 10, x, bottom - i * 10 - algo_power_decay(base, ratio, i));";
const gap: ParameterSuggestion = {
  nodeId: "tree", transformationId: "branching-growth", id: "segment-gap", label: "Segment gap", effect: "spatial", description: "가지 마디 사이 간격",
  value: { type: "number", value: 10, min: 2, max: 40, step: 1, unit: "px" }, reason: "마디 간격이 촘촘해 보이는 원인입니다.",
  edits: [{ find: LOOP, replace: LOOP.replaceAll("i * 10", "i * m.v(\"tree/segment-gap\")") }],
};
const program = () => connectScene({ title: "Tree", explanation: "", code: sceneProgram }, sampleScene());

test("a hidden constant is exposed as a property the module reads, without regenerating the code", () => {
  const scene = sampleScene(), generated = program();
  assert.equal(parameterProblem(scene, generated.code, gap), null);
  const result = exposeParameter(scene, generated, gap);
  assert.ok(!("error" in result));
  const property = findProperty(findNode(result.scene, "tree")!, "segment-gap")!;
  assert.deepEqual(property.value, gap.value);
  assert.ok(findNode(result.scene, "tree")!.transformations.find(item => item.id === "branching-growth")!.properties.some(item => item.id === "segment-gap"), "on the transformation it belongs to");
  assert.match(result.generated.code, /i \* m\.v\("tree\/segment-gap"\)/); assert.doesNotMatch(result.generated.code, /i \* 10/);
  assert.equal(sceneLiveStatus(result.generated, result.scene), "live", "the program stays live: no Update needed");
  // The picture does not change until the value moves; then it follows it.
  const sketch = run(result.generated.code);
  sketch.draw(); const before = sketch.lines.map(line => line[1]);
  const original = run(generated.code); original.draw();
  assert.deepEqual(before, original.lines.map(line => line[1]), "exposed at its current value: same drawing");
  sketch.lines.length = 0; sketch.read("rulegenParams['tree/segment-gap'] = 30"); sketch.draw();
  assert.notDeepEqual(sketch.lines.map(line => line[1]), before, "moving it changes the drawing");
  assert.equal(parameterStatus(gap, scene), "pending"); assert.equal(parameterStatus(gap, result.scene), "accepted"); assert.equal(parameterStatus({ ...gap, rejected: true }, scene), "rejected");
});

test("an exposure is refused when its edit does not fit the code", () => {
  const scene = sampleScene(), code = program().code;
  assert.match(parameterProblem(scene, code, { ...gap, edits: [{ find: "nope", replace: "m.v(\"tree/segment-gap\")" }] })!, /찾지 못했습니다/);
  assert.match(parameterProblem(scene, code, { ...gap, edits: [{ find: "i * 10", replace: "i * m.v(\"tree/segment-gap\")" }] })!, /여러 곳/);
  assert.match(parameterProblem(scene, code, { ...gap, edits: [{ find: LOOP, replace: LOOP.replaceAll("10", "m.v(\"tree/gap\")") }] })!, /m\.v\("tree\/segment-gap"\)/, "it must read the new key");
  assert.match(parameterProblem(scene, code, { ...gap, id: "ink" })!, /이미 있습니다/);
  assert.match(parameterProblem(scene, code, { ...gap, transformationId: "nope" })!, /transformation/);
  assert.match(parameterProblem(scene, code, { ...gap, value: { ...gap.value, value: 99 } } as ParameterSuggestion)!, /범위/);
  assert.match(parameterProblem(scene, code, gap, () => false)!, /올바르지/);
  // Every stamp drawn by the same code gets it (an instance shares the master's code id).
  const twin = { ...scene, nodes: [...scene.nodes, { ...scene.nodes.find(node => node.id === "tree")!, id: "tree-2", codeId: "tree", codeModule: "tree" }] };
  const exposed = exposeParameter(twin, program(), gap) as { scene: typeof scene };
  assert.ok(findProperty(findNode(exposed.scene, "tree-2")!, "segment-gap"), "the other stamp too");
});

test("targeted inspection suggests hidden parameters from the brush's code; only ones that apply are kept", async () => {
  const scene = sampleScene(), code = program().code;
  const output = { summary: "마디가 촘촘합니다.", overlays: [], valueFixes: [], recommendations: [],
    parameters: [gap, { ...gap, id: "broken", label: "Broken", edits: [{ find: "not in the code", replace: "m.v(\"tree/broken\")" }] }, { ...gap, label: "Duplicate" }] };
  const inspection = { brushName: "Tree", nodeIds: ["tree", "orb"], cursor: null, marks: [[{ x: .4, y: .2 }]], constraints: [], steps: [] };
  await withMockedAI(() => output, async calls => {
    const result = inspectResultSchema.parse(await runAI(requestSchema.parse({ intent: "inspect", scene, image: "data:image/png;base64,AAAA", instruction: "마디 간격이 궁금해", previous: code, inspection }), new AbortController().signal));
    assert.deepEqual(result.parameters.map(item => item.label), ["Segment gap"], "edits that do not apply and duplicates are dropped");
    const context = JSON.parse(calls[0].input[0].content[0].text);
    assert.match(context.code.tree, /i \* 10/, "the AI reads the brush's module code");
    assert.match(calls[0].instructions, /hidden constants the concern depends on/);
  });
  await withMockedAI(() => output, async () => {
    const result = inspectResultSchema.parse(await runAI(requestSchema.parse({ intent: "inspect", scene, image: "data:image/png;base64,AAAA", instruction: "c", inspection }), new AbortController().signal));
    assert.deepEqual(result.parameters, [], "no code: nothing to expose");
  });
  // Stored tools keep the rejection; ids translate between frames, the code edits do not (they use the code's ids).
  const stored = targetedResultSchema.parse({ ...output, parameters: [{ ...gap, rejected: true }] });
  assert.equal(stored.parameters[0].rejected, true);
  const moved = remapResult(stored, new Map([["tree", "tree-2"]]));
  assert.equal(moved.parameters[0].nodeId, "tree-2"); assert.equal(moved.parameters[0].edits[0].replace, gap.edits[0].replace);
  assert.deepEqual(targetedResultSchema.parse({ summary: "s", overlays: [], valueFixes: [], recommendations: [] }).parameters, [], "older tools read without any");
});

test("the panel offers each hidden parameter to accept or reject, and an accepted one is adjusted in place", () => {
  const scene = sampleScene(), [brush] = brushesFor(scene, "sketch-a", [], () => "brush-1");
  const exposed = (exposeParameter(scene, program(), gap) as { scene: typeof scene }).scene;
  const tool = (parameters: unknown[]) => ({ id: "t1", name: "c", concern: "c", marks: [], markStyles: [], result: targetedResultSchema.parse({ summary: "s", overlays: [], valueFixes: [], recommendations: [], parameters }) });
  const render = (sceneNow: typeof scene, parameters: unknown[]) => renderToStaticMarkup(createElement(InspectionPanel, { brush, kind: "targeted", targeted: tool(parameters), scene: sceneNow, nodeIds: ["tree", "orb"], state: emptyInspection(brush.id), busy: false, running: true,
    onCursor: noop, onClear: noop, onFocus: noop, onConcern: noop, onClearMarks: noop, onInspect: noop, onApplyChanges: noop, onApplyRecommendation: noop, onTool: noop, onAcceptParameter: noop, onRejectParameter: noop, onParameterValue: noop } as never));
  const pending = render(scene, [gap]);
  assert.match(pending, /HIDDEN PARAMETERS/); assert.match(pending, /<em>제안<\/em>Segment gap/); assert.match(pending, /지금 코드의 값 10px \(2–40\)/);
  assert.match(pending, />Accept<\/button>/); assert.match(pending, />Reject<\/button>/); assert.match(pending, /코드 변경 보기/);
  const accepted = render(exposed, [gap]);
  assert.match(accepted, /<em>추가됨<\/em>/); assert.match(accepted, /type="range" aria-label="Segment gap" min="2" max="40" step="1" value="10"/, "a slider to try values right away");
  assert.doesNotMatch(accepted, />Accept<\/button>/);
  const rejected = render(scene, [{ ...gap, rejected: true }]);
  assert.match(rejected, /<em>거절됨<\/em>/); assert.match(rejected, /다시 보기/); assert.doesNotMatch(rejected, />Accept<\/button>/);
});

test("a module replaced in place keeps its store, and m.memo recomputes when a value it read changes", async () => {
  const { assembleProgram, moduleSource } = await import("../app/lib/scene/machines");
  const scene = sampleScene();
  const module = (factor: string) => moduleSource("tree", `function (m) {
    function size() { return m.v("orb/radius") * ${factor}; }
    return {
      setup() { m.store.kept = 7; m.store.computed = 0; },
      draw() { const s = m.memo(["size"], () => { m.store.computed++; return size(); }); p.circle(m.store.kept, 0, s); },
    };
  }`);
  const sketch = run(assembleProgram(scene, [module("2")]));
  sketch.draw(); sketch.draw();
  assert.equal(sketch.read("rulegenLive[0].store.computed"), 1, "cached");
  sketch.read("rulegenParams['orb/radius'] = 30"); sketch.circles.length = 0; sketch.draw();
  assert.equal(sketch.read("rulegenLive[0].store.computed"), 2, "the key does not name the radius, but it was read inside: recomputed");
  assert.equal(sketch.circles[0][2], 60);
  // Swap the module's code in place: the store stays, the new code draws.
  sketch.read(`${module("3").split("\n").filter(line => !line.startsWith("//")).join("\n")}; rulegenRefreshModule("tree")`);
  sketch.circles.length = 0; sketch.draw();
  assert.equal(sketch.circles[0][0], 7, "the store survived"); assert.equal(sketch.circles[0][2], 90, "the new code runs");
});

test("records: the module is made to keep a per-item value on its item records, and overlays at a step read it as the step is drawn now", async () => {
  const { assembleProgram, moduleSource } = await import("../app/lib/scene/machines");
  const { placeOverlays, stepContext } = await import("../app/lib/inspection");
  const { recordFields, recordingApplied, recordingProblem } = await import("../app/lib/hidden-parameters");
  const scene = sampleScene();
  const PUSH = "items.push({ x: i * 20, y: 0 });";
  const code = assembleProgram(scene, [moduleSource("tree", `function (m) {
    return { draw() { const items = []; for (let i = 0; i < 3; i++) { const size = 10 + i * m.v("orb/radius"); ${PUSH} p.circle(i * 20, 0, size); } m.store.items = items; } };
  }`)]);
  const records = { nodeId: "tree", fields: ["size"], reason: "별마다 크기가 다릅니다.", edits: [{ find: PUSH, replace: "items.push({ x: i * 20, y: 0, size });" }] };
  assert.equal(recordingProblem(scene, code, records), null);
  assert.match(recordingProblem(scene, code, { ...records, fields: ["speed"] })!, /speed/, "every field must be written by an edit");
  assert.match(recordingProblem(scene, code, { ...records, edits: [{ find: "nope", replace: "size" }] })!, /찾지 못했습니다/);
  const generated = { title: "t", explanation: "", code, sceneBindings: [], machineSignature: "" };
  assert.equal(recordingApplied(scene, code, records), false);
  const result = recordFields(scene, generated, records) as { generated: typeof generated };
  assert.equal(recordingApplied(scene, result.generated.code, records), true);
  // Same drawing; the items now say their size.
  const before = run(code), after = run(result.generated.code);
  before.draw(); after.draw();
  assert.deepEqual(after.circles, before.circles, "nothing drawn changes");
  const drawn = JSON.parse(after.read("JSON.stringify({ tree: rulegenLive[0].store })"));
  assert.deepEqual(drawn.tree.items.map((item: { size: number }) => item.size), before.circles.map(circle => circle[2]));
  // A step recorded before the code kept it: the label is hidden there (no "?"); with the step as drawn now, it is shown on each item.
  const steps = [{ id: 1, at: 0, nodeId: null, from: null, to: null, transitionId: null, values: {}, runtime: { states: {}, stores: { tree: { items: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 40, y: 0 }] } } } }];
  const overlay = { id: "size", kind: "label" as const, name: "", x: "item(\"x\")", y: "item(\"y\")", w: "0", h: "0", label: "크기 ${item(\"size\")}", color: "#2563eb", link: { kind: "constraint" as const, nodeId: "orb", id: "radius" }, when: "", each: "tree:items" };
  assert.deepEqual(placeOverlays([overlay], stepContext(steps, 0)).map(item => item.label), ["", "", ""]);
  assert.deepEqual(placeOverlays([overlay], stepContext(steps, 0, {}, drawn)).map(item => item.label), drawn.tree.items.map((item: { size: number }) => `크기 ${item.size}`));
});

test("records from AI are kept only when they apply to the brush's module, and the panel says whether the code has them", async () => {
  const scene = sampleScene(), code = program().code;
  const records = { nodeId: "tree", fields: ["segments"], reason: "마디 수", edits: [{ find: LOOP, replace: `${LOOP} m.store.segments = depth;` }] };
  const inspection = { brushName: "Tree", nodeIds: ["tree", "orb"], cursor: null, marks: [[{ x: .4, y: .2 }]], constraints: [], steps: [] };
  const ask = (output: object) => withMockedAI(() => ({ summary: "s", overlays: [], valueFixes: [], recommendations: [], parameters: [], ...output }), async () =>
    inspectResultSchema.parse(await runAI(requestSchema.parse({ intent: "inspect", scene, image: "data:image/png;base64,AAAA", instruction: "c", previous: code, inspection }), new AbortController().signal)));
  assert.deepEqual((await ask({ records })).records, records);
  assert.equal((await ask({ records: { ...records, edits: [{ find: "not in the code", replace: "segments" }] } })).records, null);
  assert.equal((await ask({ records: { ...records, nodeId: "elsewhere" } })).records, null);
  assert.equal((await ask({ records: null })).records, null);
  assert.equal(targetedResultSchema.parse({ summary: "s", overlays: [], valueFixes: [], recommendations: [] }).records, null, "older tools read without any");
  const [brush] = brushesFor(scene, "sketch-a", [], () => "brush-1");
  const render = (codeNow: string) => renderToStaticMarkup(createElement(InspectionPanel, { brush, kind: "targeted", scene, nodeIds: ["tree", "orb"], state: emptyInspection(brush.id), busy: false, running: true, code: codeNow, onApplyRecording: noop,
    targeted: { id: "t1", name: "c", concern: "c", marks: [], markStyles: [], result: targetedResultSchema.parse({ summary: "s", overlays: [], valueFixes: [], recommendations: [], records }) },
    onCursor: noop, onClear: noop, onFocus: noop, onConcern: noop, onClearMarks: noop, onInspect: noop, onApplyChanges: noop, onApplyRecommendation: noop, onTool: noop } as never));
  assert.match(render(code), /ITEM RECORDS/); assert.match(render(code), />기록 추가<\/button>/, "not in the code (e.g. undone): it can be added again");
  const recorded = (await import("../app/lib/hidden-parameters")).recordFields(scene, program(), records) as { generated: { code: string } };
  assert.match(render(recorded.generated.code), /✓ 그려진 항목마다 segments/); assert.doesNotMatch(render(recorded.generated.code), />기록 추가</);
});
