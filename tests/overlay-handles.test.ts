import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { sampleScene, sceneProgram, withMockedAI } from "./fixtures/scene";
import { connectScene } from "../app/server/scene-code.server";
import { clampValue, dragValue, emptyInspection, evaluate, handleGrips, inspectResultSchema, remapResult, startDrag, stepContext, targetedResultSchema, valueSpecs, type InspectionStep, type Overlay } from "../app/lib/inspection";
import { requestSchema } from "../app/lib/schema";
import { runAI } from "../app/server/ai.server";
import { InspectionOverlay } from "../app/components/inspection-overlay";

const logDirectory = mkdtempSync(path.join(tmpdir(), "rulegen-handles-"));
const previousLogDirectory = process.env.RULEGEN_AI_LOG_DIR;
process.env.RULEGEN_AI_LOG_DIR = logDirectory;
after(() => { rmSync(logDirectory, { recursive: true, force: true }); if (previousLogDirectory === undefined) delete process.env.RULEGEN_AI_LOG_DIR; else process.env.RULEGEN_AI_LOG_DIR = previousLogDirectory; });

// The orb's size: a square around its center with a grip on the corner, slid away from the center to scale it.
const size: Overlay = { id: "size", kind: "rect", name: "크기", x: "300 - p(\"orb/radius\")", y: "300 - p(\"orb/radius\")", w: "p(\"orb/radius\") * 2", h: "p(\"orb/radius\") * 2", label: "", color: "#e0457b",
  link: { kind: "constraint", nodeId: "orb", id: "radius" }, when: "", each: "",
  handle: { key: "orb/radius", gesture: "slide", x: "300 + p(\"orb/radius\")", y: "300 + p(\"orb/radius\")", pivotX: "300", pivotY: "300", value: "start * dist / startDist", hint: "모서리를 끌어 키우기" } };
const step = (values: Record<string, number>, stores: Record<string, unknown> = {}): InspectionStep => ({ id: 1, at: 0, nodeId: null, from: null, to: null, transitionId: null, values, runtime: { stores, states: {} } });

test("a handle's grip sits on what its value moves, and dragging it gives the value that puts it under the pointer", () => {
  const context = stepContext([step({ "orb/radius": 24 })], 0);
  const [grip] = handleGrips([size], context);
  assert.deepEqual([grip.x, grip.y], [324, 324], "on the corner");
  const drag = startDrag(grip, { x: 324, y: 324 });
  assert.deepEqual([drag.start, drag.px, drag.py], [24, 300, 300]);
  assert.equal(dragValue(grip, drag, { x: 348, y: 348 }), 48, "twice as far from the center: twice the size");
  const spec = valueSpecs(sampleScene(), ["orb"])["orb/radius"];
  assert.equal(clampValue(spec, 48.4), 48, "rounded to its step");
  assert.equal(clampValue(spec, 900), 140, "clamped to its range"); assert.equal(clampValue(spec, NaN), null);
  assert.equal(clampValue({ type: "toggle", value: false }, .7), true);
  // With the new value the grip (and the overlay) follow.
  const [moved] = handleGrips([size], stepContext([{ ...step({ "orb/radius": 24 }), edits: { "orb/radius": 48 } }], 0));
  assert.deepEqual([moved.x, moved.y], [348, 348]);
  // A rotation reads the angle around the pivot.
  const turn = { ...grip, handle: { ...grip.handle, gesture: "rotate" as const, value: "start + (angle - startAngle) * 180 / PI" } };
  assert.equal(Math.round(dragValue(turn, startDrag(turn, { x: 400, y: 300 }), { x: 300, y: 400 })), 24 + 90);
  assert.equal(evaluate("hx * 2 + start", { values: {}, stores: {}, states: {}, step: 0, steps: 1, vars: { hx: 3, start: 1 } }), 7);
});

test("an each overlay gets a grip on its first items whose condition holds, each reading its own item", () => {
  const bends = [{ x: 10, w: 100, side: 0 }, { x: 50, w: 200, side: 1 }, { x: 90, w: 100, side: 0 }];
  const overlay: Overlay = { ...size, id: "bend", each: "bush:bends", when: "item(\"side\") == 0", link: { kind: "parameter", nodeId: "bush", id: "bend" },
    handle: { key: "bush/bend", gesture: "drag", x: "item(\"x\") + item(\"w\") * 0.1 * p(\"bush/bend\")", y: "0", pivotX: "", pivotY: "", value: "start + dx / (item(\"w\") * 0.1)", hint: "끝을 끌어 휘게" } };
  const context = stepContext([step({}, { bush: { bends } })], 0, {}, null, { "bush/bend": 1 });
  const grips = handleGrips([overlay], context);
  assert.deepEqual(grips.map(grip => grip.x), [20, 100], "a suggested parameter is read at the code's value");
  assert.equal(dragValue(grips[1], startDrag(grips[1], { x: 100, y: 0 }), { x: 110, y: 0 }), 2, "the dragged item's own size maps the drag");
});

test("handles from AI are kept only when they change a number or toggle of the brush with readable expressions; ids translate between frames", async () => {
  const scene = sampleScene(), code = connectScene({ title: "Tree", explanation: "", code: sceneProgram }, scene).code;
  const constraints = [{ key: "orb/radius", nodeId: "orb", transformationId: "t", transformation: "T", propertyId: "radius", property: "Radius", path: "", type: "number" },
    { key: "orb/tint", nodeId: "orb", transformationId: "t", transformation: "T", propertyId: "tint", property: "Tint", path: "", type: "color" }];
  const overlays = [size, { ...size, id: "elsewhere", handle: { ...size.handle!, key: "tree/nope" } }, { ...size, id: "color", handle: { ...size.handle!, key: "orb/tint" } },
    { ...size, id: "broken", handle: { ...size.handle!, value: "start * window.x" } }, { ...size, id: "unknown", handle: { ...size.handle!, value: "start * speed" } }];
  const inspection = { brushName: "Orb", nodeIds: ["tree", "orb"], cursor: null, marks: [[{ x: .4, y: .2 }]], constraints, steps: [] };
  await withMockedAI(() => ({ summary: "s", overlays, valueFixes: [], recommendations: [], parameters: [] }), async calls => {
    const result = inspectResultSchema.parse(await runAI(requestSchema.parse({ intent: "inspect", scene, image: "data:image/png;base64,AAAA", instruction: "크기", previous: code, inspection }), new AbortController().signal));
    assert.deepEqual(result.overlays.map(item => [item.id, Boolean(item.handle)]), [["size", true], ["elsewhere", false], ["color", false], ["broken", false], ["unknown", false]], "the overlay stays without its handle");
    assert.match(calls[0].instructions, /handle — direct manipulation on the overlay/);
  });
  const moved = remapResult(targetedResultSchema.parse({ summary: "s", overlays: [size], valueFixes: [], recommendations: [] }), new Map([["orb", "orb-2"]]));
  assert.equal(moved.overlays[0].handle!.key, "orb-2/radius"); assert.equal(moved.overlays[0].handle!.x, "300 + p(\"orb-2/radius\")");
  assert.equal(targetedResultSchema.parse({ summary: "s", overlays: [{ ...size, handle: undefined }], valueFixes: [], recommendations: [] }).overlays[0].handle, null, "older overlays have none");
});

test("a drag is a what-if of the step looked at only: that step reads it, the others and the property keep theirs", async () => {
  const { editStep, stepValues, changedKeys, historyOverlays } = await import("../app/lib/inspection");
  const state = { ...emptyInspection("b"), steps: [step({ "orb/radius": 24 }), { ...step({ "orb/radius": 24 }), id: 2 }, { ...step({ "orb/radius": 24 }), id: 3 }] };
  const edited = editStep(state, 1, "orb/radius", 60);
  assert.deepEqual(edited.steps.map(item => stepValues(item)!["orb/radius"]), [24, 60, 24]);
  assert.deepEqual(edited.steps[1].values, { "orb/radius": 24 }, "the recording stays");
  assert.ok(changedKeys(edited.steps, 1).has("orb/radius"), "it shows as a change at that step");
  // The overlay at that step (and its ghost at the others) reads each step's own value.
  const placed = historyOverlays([size], edited.steps, 1);
  assert.deepEqual(placed.filter(item => !item.ghost).map(item => item.w), [120]);
  assert.ok(placed.filter(item => item.ghost).every(item => item.w === 48));
  assert.equal(editStep(edited, 1, "orb/radius", null).steps[1].edits, undefined, "taken back");
  assert.equal(editStep(state, 9, "orb/radius", 1), state, "no such step");
  // The panel marks it and offers to take it back.
  const { InspectionPanel } = await import("../app/components/inspection-panel");
  const { brushesFor } = await import("../app/lib/brushes");
  const scene = sampleScene(), [brush] = brushesFor(scene, "sketch-a", [], () => "brush-1"), noop = () => {};
  const html = renderToStaticMarkup(createElement(InspectionPanel, { brush, kind: "inspect", scene, nodeIds: ["tree", "orb"], state: { ...edited, brushId: brush.id, cursor: 1 }, busy: false, running: true, onResetEdit: noop,
    onCursor: noop, onClear: noop, onFocus: noop, onConcern: noop, onClearMarks: noop, onInspect: noop, onApplyChanges: noop, onApplyRecommendation: noop, onTool: noop } as never));
  assert.match(html, /이 단계만 \(기록 24\)/); assert.match(html, /aria-label="Reset Radius at this step"/); assert.match(html, /class="[^"]*edited/);
});

test("grips are drawn on the frame with what they do, only with an inspection tool that can drag them", () => {
  const result = targetedResultSchema.parse({ summary: "s", overlays: [size], valueFixes: [], recommendations: [] });
  const render = (props: object) => renderToStaticMarkup(createElement(InspectionOverlay, { state: { ...emptyInspection("b"), steps: [step({ "orb/radius": 24 })] }, marks: [], result, liveValues: {}, clickable: true, zoom: 1, onFocus: () => {}, ...props }));
  const html = render({ onHandle: () => {}, specs: valueSpecs(sampleScene(), ["orb"]) });
  assert.match(html, /class="inspection-grip gesture-slide "/); assert.match(html, /role="slider" aria-label="모서리를 끌어 키우기"/); assert.match(html, /<title>모서리를 끌어 키우기<\/title>/);
  assert.doesNotMatch(render({}), /inspection-grip/, "nothing to drag with");
  assert.doesNotMatch(render({ onHandle: () => {}, clickable: false }), /inspection-grip/, "not while annotating");
});

test("there is no Live mode: the result is held at the step looked at, the latest unless another is picked", async () => {
  const { heldIndex } = await import("../app/lib/inspection");
  const steps = [step({}), { ...step({}), id: 2 }, { ...step({}), id: 3 }];
  assert.equal(heldIndex({ steps, cursor: null }), 2, "the latest"); assert.equal(heldIndex({ steps, cursor: 0 }), 0); assert.equal(heldIndex({ steps: [], cursor: null }), null);
  const { InspectionPanel } = await import("../app/components/inspection-panel");
  const { brushesFor } = await import("../app/lib/brushes");
  const scene = sampleScene(), [brush] = brushesFor(scene, "sketch-a", [], () => "brush-1"), noop = () => {};
  const html = renderToStaticMarkup(createElement(InspectionPanel, { brush, kind: "inspect", scene, nodeIds: ["tree", "orb"], state: { ...emptyInspection(brush.id), steps }, busy: false, running: true,
    onCursor: noop, onClear: noop, onFocus: noop, onConcern: noop, onClearMarks: noop, onInspect: noop, onApplyChanges: noop, onApplyRecommendation: noop, onTool: noop } as never));
  assert.doesNotMatch(html, />Live<\/button>|LIVE/); assert.match(html, /3 \/ 3/); assert.match(html, /STEP 3</);
});

test("the held step is drawn with its what-if values and the real values come back after (as the frame does it)", async () => {
  const { run } = await import("./fixtures/scene");
  const sketch = run(connectScene({ title: "Tree", explanation: "", code: sceneProgram }, sampleScene()).code);
  sketch.draw();
  const snapshot = JSON.stringify(sketch.read("rulegenSnapshot()")), real = sketch.read("rulegenParams['orb/radius']");
  // showPinned: restore, what-if values over the restored values, draw once, restore again.
  sketch.circles.length = 0;
  sketch.read(`rulegenRestore(${snapshot}); const what = { "orb/radius": 70, "nope/x": 1 }; for (const key of Object.keys(what)) if (key in rulegenParams) rulegenParams[key] = what[key];`);
  sketch.draw();
  assert.equal(sketch.circles[0][2], 140, "drawn with the step's value");
  assert.equal(sketch.read("'nope/x' in rulegenParams"), false, "unknown keys are not added");
  sketch.read(`rulegenRestore(${snapshot})`);
  assert.equal(sketch.read("rulegenParams['orb/radius']"), real, "the real value is back");
  const { readFileSync } = await import("node:fs");
  assert.match(readFileSync("app/components/code-preview.tsx", "utf8"), /function showPinned\(\)\{rulegenRestore\(pinned\);if\(pinnedParams\)/, "the frame does the same");
  // Nothing redraws after it with the real values (that drawing would be the one shown).
  assert.match(readFileSync("app/components/code-preview.tsx", "utf8"), /pinnedParams=event\.data\.params[^;]*;[^\n]*?showPinned\(\);return;\}/, "the restore message ends after drawing the held step");
});

test("one drawn item can have its own what-if: the runtime gives it to m.v(key, id) and the overlays read it for that item", async () => {
  const { assembleProgram, moduleSource } = await import("../app/lib/scene/machines");
  const { run } = await import("./fixtures/scene");
  const { editStep, readsPerItem, placeOverlays, contextValue } = await import("../app/lib/inspection");
  const scene = sampleScene();
  const code = assembleProgram(scene, [moduleSource("tree", `function (m) {
    return { draw() { const items = []; for (const id of ["a", "b"]) { const r = m.memo(["r", id, m.v("orb/radius", id)], () => m.v("orb/radius", id)); items.push({ id, x: id === "a" ? 0 : 100, r }); p.circle(id === "a" ? 0 : 100, 0, r * 2); } m.store.items = items; } };
  }`)]);
  assert.ok(readsPerItem(code, "orb/radius")); assert.ok(!readsPerItem(connectScene({ title: "T", explanation: "", code: sceneProgram }, scene).code, "orb/radius"), "read once for all");
  const sketch = run(code);
  sketch.draw(); assert.deepEqual(sketch.circles.map(c => c[2]), [48, 48]);
  sketch.circles.length = 0; sketch.read(`rulegenItemValues = { b: { "orb/radius": 70 } }`); sketch.draw();
  assert.deepEqual(sketch.circles.map(c => c[2]), [48, 140], "only item b");
  sketch.circles.length = 0; sketch.read(`rulegenItemValues = {}`); sketch.draw();
  assert.deepEqual(sketch.circles.map(c => c[2]), [48, 48], "back, not a cached result of the what-if");
  // The step keeps it per item; an each overlay reads it on that item only.
  const state = editStep({ ...emptyInspection("b"), steps: [step({ "orb/radius": 24 }, { tree: { items: [{ id: "a", x: 0 }, { id: "b", x: 100 }] } })] }, 0, "orb/radius", 70, "b");
  assert.deepEqual(state.steps[0].itemEdits, { b: { "orb/radius": 70 } }); assert.equal(state.steps[0].edits, undefined);
  const overlay: Overlay = { ...size, id: "r", each: "tree:items", x: "item(\"x\")", y: "0", w: "p(\"orb/radius\")", h: "0", label: "" };
  assert.deepEqual(placeOverlays([overlay], stepContext(state.steps, 0)).map(item => item.w), [24, 70]);
  assert.equal(contextValue({ ...stepContext(state.steps, 0), item: { id: "b" } }, "orb/radius"), 70);
  assert.equal(editStep(state, 0, "orb/radius", null).steps[0].itemEdits, undefined, "taking the key back clears its item values too");
  // The frame sets them only while drawing the held step.
  const { readFileSync } = await import("node:fs");
  assert.match(readFileSync("app/components/code-preview.tsx", "utf8"), /if\(items\)rulegenItemValues=pinnedItems\|\|\{\};try\{forceRender=true;p\.redraw\(\);reportDrawn\(\);\}finally\{if\(items\)rulegenItemValues=\{\};\}/);
});

test("a grip on one item changes that item only: the code is made to read the value per item, or the grip is not offered", async () => {
  const { readsPerItem } = await import("../app/lib/inspection");
  const { guardSuggestedReads, parameterProblem, recordingProblem } = await import("../app/lib/hidden-parameters");
  const scene = sampleScene(), code = connectScene({ title: "Tree", explanation: "", code: sceneProgram }, scene).code;
  const READ = `p.circle(m.box("orb").x + speed * m.state("orb").elapsed / 1000, 300, m.v("orb/radius") * 2);`;
  const PER_ITEM = `const id = "orb:0"; m.store.items = [{ id, x: 300 }]; p.circle(m.box("orb").x + speed * m.state("orb").elapsed / 1000, 300, m.v("orb/radius", id) * 2);`;
  const records = { nodeId: "tree", fields: ["items"], perItem: ["orb/radius"], reason: "원마다 크기", edits: [{ find: READ, replace: PER_ITEM }] };
  assert.equal(recordingProblem(scene, code, records), null);
  assert.match(recordingProblem(scene, code, { ...records, edits: [{ find: READ, replace: `m.store.items = []; ${READ}` }] })!, /항목별로 읽지 않습니다/, "perItem must really be read per item");
  assert.ok(readsPerItem(`m.opt(1, "orb/radius", id)`, "orb/radius"), "a guarded read per item counts");
  // A records edit reading a suggested parameter (not a value until accepted) falls back to the code's value.
  const suggestion = { nodeId: "orb", transformationId: "t", id: "bend", label: "굽힘", effect: "spatial" as const, description: "", form: "scale" as const, value: { type: "number" as const, value: 1, min: .2, max: 3, step: .1, unit: "×" }, reason: "", edits: [{ find: "x", replace: "x" }] };
  assert.equal(guardSuggestedReads({ ...records, edits: [{ find: "a", replace: `k = m.v("orb/bend", id) + m.v('orb/bend') + m.v("orb/bendy")` }] }, [suggestion]).edits[0].replace,
    `k = m.opt(1, "orb/bend", id) + m.opt(1, 'orb/bend') + m.v("orb/bendy")`);
  // A suggestion's edits may read it per item.
  const orbTransformation = scene.nodes.find(node => node.id === "orb")!.transformations[0];
  const exposed = { ...suggestion, transformationId: orbTransformation.id, edits: [{ find: READ, replace: READ.replace(`m.v("orb/radius")`, `m.v("orb/radius") * m.v("orb/bend", id)`) }] };
  assert.equal(parameterProblem(scene, code, exposed), null);

  // From AI: a grip on each item of an overlay is kept only when the code (with the records) reads its value per item.
  const constraints = [{ key: "orb/radius", nodeId: "orb", transformationId: "t", transformation: "T", propertyId: "radius", property: "Radius", path: "", type: "number" }];
  const inspection = { brushName: "Orb", nodeIds: ["tree", "orb"], cursor: null, marks: [[{ x: .4, y: .2 }]], constraints, steps: [] };
  const each = { ...size, id: "each", each: "tree:items", x: "item(\"x\")" };
  const ask = (output: object) => withMockedAI(() => ({ summary: "s", overlays: [size, each], valueFixes: [], recommendations: [], parameters: [], ...output }), async () =>
    inspectResultSchema.parse(await runAI(requestSchema.parse({ intent: "inspect", scene, image: "data:image/png;base64,AAAA", instruction: "크기", previous: code, inspection }), new AbortController().signal)));
  const flat = await ask({ records: null });
  assert.deepEqual(flat.overlays.map(item => [item.id, Boolean(item.handle)]), [["size", true], ["each", false]], "read once for all: one grip would move every item");
  assert.match(flat.summary, /손잡이 1개는 코드가 그 값을 항목마다 따로 읽지 않아/);
  const single = await ask({ records });
  assert.deepEqual(single.overlays.map(item => [item.id, Boolean(item.handle)]), [["size", true], ["each", true]]);
  assert.deepEqual(single.records!.perItem, ["orb/radius"]); assert.equal(single.summary, "s");

  // The runtime: m.opt gives the fallback until the value exists, and the item's own value when it has one.
  const { assembleProgram, moduleSource } = await import("../app/lib/scene/machines");
  const { run } = await import("./fixtures/scene");
  const sketch = run(assembleProgram(scene, [moduleSource("tree", `function (m) {
    return { draw() { for (const id of ["a", "b"]) p.circle(0, 0, m.opt(5, "orb/nope", id) + m.opt(0, "orb/radius", id)); } };
  }`)]));
  sketch.draw(); assert.deepEqual(sketch.circles.map(c => c[2]), [29, 29]);
  sketch.circles.length = 0; sketch.read(`rulegenItemValues = { b: { "orb/radius": 70 } }`); sketch.draw();
  assert.deepEqual(sketch.circles.map(c => c[2]), [29, 75], "item b alone");
});

test("the frame changes one item only for a grip on an each overlay, and nothing when the code cannot", async () => {
  const { readFileSync } = await import("node:fs");
  const home = readFileSync("app/routes/home.tsx", "utf8");
  assert.match(home, /if \(drag\.each && !single\) \{\s*handleDrag\.current = null;/, "no fallback that changes every item");
  assert.match(home, /editHeldStep\(drag\.frameId, brush\.id, drag\.key, drag\.last, single \? drag\.item! : undefined\)/);
  assert.doesNotMatch(home, /항목 전체가 함께 바뀝니다/);
});
