import test from "node:test";
import assert from "node:assert/strict";
import { run, sampleScene, sceneProgram } from "./fixtures/scene";
import { connectScene } from "../app/server/scene-code.server";
import { prepareCode } from "../app/server/code.server";
import { readSceneValues, sceneStructureKey, syncScene } from "../app/lib/scene/machines";
import { sceneLiveStatus } from "../app/lib/scene/live";
import { moveNodes, updateNode } from "../app/lib/scene/graph";
import * as ops from "../app/lib/scene/panel-ops";
import { createSketchPanel } from "../app/lib/sketch-panels";

const connect = (code = sceneProgram, scene = sampleScene()) => connectScene({ title: "Tree", explanation: "나무", code }, scene);

test("connected code reads every property live; widget edits and node moves patch only the host block", () => {
  const scene = sampleScene(), generated = connect(sceneProgram, scene);
  assert.equal(sceneLiveStatus(generated, scene), "live");
  const first = run(generated.code); first.draw();
  assert.equal(first.lines.length, 5);
  assert.equal(first.strokes[0], "#75664e");
  const panel = { ...createSketchPanel(), scene };
  const edited = { ...panel, ...ops.setPropertyScalar(panel, "tree", "structure", ["depth"], 7) };
  const recolored = { ...edited, ...ops.setPropertyScalar(edited, "tree", "ink", [], "#112233") };
  const moved = moveNodes(recolored.scene, ["orb"], .1, 0);
  const source = syncScene(generated.code, moved);
  assert.ok(source.endsWith(generated.code.slice(generated.code.indexOf("function algo_power_decay"))), "drawing code is untouched");
  const second = run(source); second.draw();
  assert.equal(second.lines.length, 7);
  assert.equal(second.strokes[0], "#112233");
  assert.ok(Math.abs(second.circles[0][0] - first.circles[0][0] - 90) < 1e-6, "layout keys follow the moved object");
  // The sandbox patches the prepared (re-printed) executable the same way.
  const prepared = prepareCode(generated.code);
  assert.match(syncScene(prepared, moved), /"tree\/structure\/depth": 7/);
  assert.equal(sceneLiveStatus(generated, recolored.scene), "live");
  const structural = { ...panel, ...ops.swapSlot(panel, "orb", "radius", [], { type: "algorithm", algorithmId: "sine-wave" }) };
  assert.equal(sceneLiveStatus(generated, structural.scene), "changed");
});

test("each node's machine runs independently: jumps, input events from the source state, and timed transitions", () => {
  const scene = sampleScene(), sketch = run(connect(sceneProgram, scene).code);
  assert.equal(sketch.read('rulegenState["orb"].id'), "idle");
  sketch.draw(); assert.equal(sketch.circles.at(-1)![2], 48);
  sketch.read("p.mousePressed()");
  assert.equal(sketch.read('rulegenState["orb"].id'), "moving");
  sketch.draw(); assert.equal(sketch.circles.at(-1)![2], 160, "the state's own radius applies");
  assert.equal(sketch.read('rulegenEmit("orb", "press")'), false, "events only fire from their source state");
  for (let i = 0; i < 12; i++) sketch.draw();
  assert.equal(sketch.read('rulegenState["orb"].id'), "idle", "timed transition after 1200ms");
  sketch.read("rulegenPlaying = false"); sketch.read('rulegenJumpState("orb", "moving")');
  for (let i = 0; i < 20; i++) sketch.draw();
  assert.equal(sketch.read('rulegenState["orb"].id'), "moving", "paused machines do not advance");
  assert.equal(sketch.read('rulegenJumpState("tree", "idle")'), false, "nodes without machines have no state");
  // Editing a state's values changes only that state's drawing.
  const panel = { ...createSketchPanel(), scene }, inState = { ...panel, ...ops.chooseState(panel, "orb", "moving") };
  const edited = { ...inState, ...ops.setPropertyScalar(inState, "orb", "radius", [], 100) };
  const rerun = run(syncScene(connect(sceneProgram, scene).code, edited.scene));
  rerun.draw(); assert.equal(rerun.circles.at(-1)![2], 48);
  rerun.read('rulegenJumpState("orb", "moving")'); rerun.draw(); assert.equal(rerun.circles.at(-1)![2], 200);
  // Transition timing edits are live too.
  const faster = ops.editTransition(edited, "orb", "settle", { afterMs: 200 }).scene!;
  const timed = run(syncScene(connect(sceneProgram, scene).code, faster));
  timed.read('rulegenJumpState("orb", "moving")'); timed.draw(); timed.draw(); timed.draw();
  assert.equal(timed.read('rulegenState["orb"].id'), "idle");
});

test("the module contract: one self-contained module per root, reading only its own nodes through m", () => {
  const close = sceneProgram.lastIndexOf("});");
  const inside = (extra: string) => sceneProgram.replace("    mousePressed()", `    keyPressed() { ${extra} },\n    mousePressed()`);
  const variants: [string, RegExp][] = [
    [sceneProgram.replace('m.v("tree/ink")', '"#000000"'), /연결하지 못했습니다/],
    [sceneProgram.replace('m.v("orb/speed")', 'm.v("orb/unknown")'), /연결이 올바르지/],
    [sceneProgram.replace('m.v("orb/speed")', 'm.v("orb/" + "speed")'), /연결이 올바르지/],
    [inside("const read = m.v;"), /직접 호출/],
    [inside("helper(m);"), /m\.v \/ m\.box/],
    [inside("rulegenParams[\"orb/radius\"] = 3;"), /접근할 수 없습니다/],
    [inside("rulegenEmit(\"orb\", \"press\");"), /접근할 수 없습니다/],
    [inside('m.emit("orb", "settle-now");'), /m\.emit/],
    [inside('m.emit("tree", "press");'), /m\.emit/],
    [inside('m.state("tree");'), /m\.state/],
    [inside("p.draw = () => {};"), /p의 속성/],
    [inside("p.background(0);"), /p\.background/],
    [inside("m.p.noLoop();"), /p\.noLoop/],
    [inside("shared = 1;"), /전역 변수/],
    [`${sceneProgram}\nlet shared = 0;`, /rulegenModule/],
    [sceneProgram.replace('rulegenModule("tree"', 'rulegenModule("orb"'), /루트 노드 ID/],
    [sceneProgram.replace("function (m)", "function (ctx)"), /형태/],
    [`const rulegenState = {};\n${sceneProgram}`, /rulegenModule/],
    [`// @rulegen-scene:start\n${sceneProgram}`, /호스트/],
  ];
  assert.ok(close > 0);
  for (const [code, error] of variants) assert.throws(() => connect(code), error, code.slice(-120));
  // A second root node needs its own module.
  const scene = sampleScene(), split = updateNode(scene, "orb", node => ({ ...node, parentId: null }));
  assert.throws(() => connect(sceneProgram, split), /연결이 올바르지|모듈이 필요/);
});

test("modules are stored separately and run as instances: a copy with other node ids draws from the same module", async () => {
  const { programModules, assembleProgram, sceneInstances } = await import("../app/lib/scene/machines");
  const { transplantNodes } = await import("../app/lib/scene/transfer");
  const scene = sampleScene(), generated = connect(sceneProgram, scene);
  const modules = programModules(generated.code);
  assert.deepEqual([...modules.keys()], ["tree"]);
  const copy = transplantNodes(scene, "tree", scene, { x: .2, y: .5 });
  const stamped = copy.scene;
  assert.deepEqual(sceneInstances(stamped).map(item => [item.root, item.module, item.map]), [["tree", "tree", { tree: "tree", orb: "orb" }], [copy.rootId, "tree", { tree: copy.rootId, orb: copy.ids.get("orb") }]]);
  const sketch = run(assembleProgram(stamped, [...modules.values()]));
  sketch.draw();
  assert.equal(sketch.circles.length, 2, "both instances draw");
  assert.equal(sketch.lines.length, 10);
  assert.notEqual(sketch.lines[0][0], sketch.lines[5][0], "each instance draws in its own box");
  sketch.read("p.mousePressed()");
  assert.equal(sketch.read(`rulegenState[${JSON.stringify(copy.ids.get("orb"))}].id`), "moving", "input reaches the copy's own machine");
});

test("value-only changes keep the program identical, so the running result updates in place instead of reloading", () => {
  const scene = sampleScene(), generated = connect(sceneProgram, scene);
  const prepared = prepareCode(generated.code);
  const moved = syncScene(prepared, moveNodes(scene, ["tree"], .1, .05));
  assert.equal(sceneStructureKey(moved), sceneStructureKey(prepared));
  assert.notEqual(readSceneValues(moved)!.params["orb/@x"], readSceneValues(prepared)!.params["orb/@x"]);
  assert.notEqual(sceneStructureKey(prepareCode(connect(sceneProgram.replace("p.stroke(", "p.strokeWeight(2); p.stroke("), scene).code)), sceneStructureKey(prepared));
  // Applying pushed values in a running sketch re-renders with the new layout.
  const sketch = run(generated.code); sketch.draw();
  const before = sketch.circles.at(-1)![0];
  const values = readSceneValues(syncScene(generated.code, moveNodes(scene, ["orb"], .1, 0)))!;
  sketch.read(`Object.assign(rulegenBase, ${JSON.stringify(values.params)}); rulegenApply();`); sketch.draw();
  assert.ok(Math.abs(sketch.circles.at(-1)![0] - before - 90) < 1e-6);
});

test("module state lives in m.store: the factory scope holds only functions and constants", () => {
  const body = (inside: string, draw = "") => sceneProgram.replace("  function algo_power_decay", `  ${inside}\n  function algo_power_decay`).replace("    draw() {\n", `    draw() {\n${draw}`);
  assert.throws(() => connect(body("let x = 0;")), /m\.store/);
  assert.throws(() => connect(body("const trail = [];")), /m\.store/);
  assert.throws(() => connect(body("const v = p.createVector(1, 2);")), /m\.store/);
  assert.throws(() => connect(body("", "      m.store = {};\n")), /m\.store는 바꿔/);
  assert.doesNotThrow(() => connect(body("const TAU = Math.PI * 2, R = 3; const step = () => 1;", "      m.store.t = (m.store.t || 0) + TAU;\n")));
});

test("a runtime snapshot restores module stores, machine states and the seed; new values redraw from the restored moment", () => {
  const moving = sceneProgram.replace("p.circle(m.box(\"orb\").x + speed * m.state(\"orb\").elapsed / 1000, 300, m.v(\"orb/radius\") * 2);",
    "m.store.x = (m.store.x || 0) + 10; m.store.trail = [...(m.store.trail || []), m.store.x].slice(-3);\n      p.circle(m.store.x, 300, m.v(\"orb/radius\") * 2);");
  const sketch = run(connect(moving).code);
  sketch.draw(); sketch.draw(); sketch.read("rulegenEmit('orb', 'press')");
  const snapshot = sketch.read("rulegenSnapshot()");
  assert.equal(JSON.stringify(snapshot.stores.tree), JSON.stringify({ x: 20, trail: [10, 20] }));
  assert.equal(snapshot.states.orb.id, "moving");
  sketch.draw(); sketch.draw(); sketch.read("rulegenJumpState('orb', 'idle')");
  sketch.read(`rulegenRestore(${JSON.stringify(snapshot)})`);
  assert.equal(sketch.read("rulegenState.orb.id"), "moving");
  assert.deepEqual(sketch.read("JSON.stringify(rulegenLive[0].store)"), JSON.stringify({ x: 20, trail: [10, 20] }));
  // A value edit at the restored step: the module continues from the restored store with the new value.
  sketch.read("rulegenBase['orb/radius'] = 5; rulegenApply()");
  sketch.circles.length = 0; sketch.draw();
  assert.deepEqual(sketch.circles[0], [30, 300, sketch.read("rulegenParams['orb/radius']") * 2]);
  sketch.read(`rulegenRestore(${JSON.stringify(snapshot)})`);
  assert.equal(sketch.read("rulegenLive[0].store.x"), 20, "a snapshot can be restored again");
});
