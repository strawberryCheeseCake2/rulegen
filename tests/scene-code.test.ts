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

test("the code contract rejects missing or unknown keys, dynamic access, writes, shadowing, bad events and stopped loops", () => {
  const variants: [string, RegExp][] = [
    [sceneProgram.replace('rulegenParams["tree/ink"]', '"#000000"'), /연결하지 못했습니다/],
    [sceneProgram.replace('rulegenParams["orb/speed"]', 'rulegenParams["orb/unknown"]'), /연결이 올바르지/],
    [sceneProgram.replace('rulegenParams["orb/speed"]', 'rulegenParams["orb/" + "speed"]'), /연결이 올바르지/],
    [`${sceneProgram}\nObject.keys(rulegenParams);`, /리터럴 키/],
    [`${sceneProgram}\np.keyPressed = () => { rulegenParams["orb/radius"] = 3; };`, /직접 변경/],
    [`${sceneProgram}\np.keyPressed = () => { rulegenState["orb"].id = "moving"; };`, /직접 변경/],
    [`const rulegenState = {};\n${sceneProgram}`, /덮어썼습니다/],
    [`${sceneProgram}\np.keyPressed = () => rulegenEmit("orb", "settle-now");`, /rulegenEmit/],
    [`${sceneProgram}\np.keyPressed = () => rulegenEmit("tree", "press");`, /rulegenEmit/],
    [`${sceneProgram}\np.keyPressed = () => rulegenJumpState("orb", "moving");`, /접근할 수 없습니다/],
    [sceneProgram.replace("p.createCanvas(900, 600);", "p.createCanvas(900, 600); p.noLoop();"), /p\.draw/],
    [`// @rulegen-scene:start\n${sceneProgram}`, /호스트/],
  ];
  for (const [code, error] of variants) assert.throws(() => connect(code), error, code.slice(-80));
  // Static scenes (no machines) may draw once and stop.
  const scene = sampleScene(), staticScene = updateNode(scene, "orb", node => ({ ...node, machine: null }));
  const program = sceneProgram.replace('rulegenState["orb"].elapsed', "0").replace('p.mousePressed = () => { if (rulegenState["orb"].id === "idle") rulegenEmit("orb", "press"); };', "").replace("p.createCanvas(900, 600);", "p.createCanvas(900, 600); p.noLoop();");
  const generated = connect(program, staticScene);
  assert.equal(generated.machineSignature, "[]");
  assert.doesNotMatch(generated.code, /@rulegen-scene-driver/);
});

test("value-only changes keep the program identical, so the running result updates in place instead of reloading", () => {
  const scene = sampleScene(), generated = connect(sceneProgram, scene);
  const prepared = prepareCode(generated.code);
  const moved = syncScene(prepared, moveNodes(scene, ["tree"], .1, .05));
  assert.equal(sceneStructureKey(moved), sceneStructureKey(prepared));
  assert.notEqual(readSceneValues(moved)!.params["orb/@x"], readSceneValues(prepared)!.params["orb/@x"]);
  assert.notEqual(sceneStructureKey(prepareCode(connect(sceneProgram.replace("p.background(250);", "p.background(240);"), scene).code)), sceneStructureKey(prepared));
  // Applying pushed values in a running sketch re-renders with the new layout.
  const sketch = run(generated.code); sketch.draw();
  const before = sketch.circles.at(-1)![0];
  const values = readSceneValues(syncScene(generated.code, moveNodes(scene, ["orb"], .1, 0)))!;
  sketch.read(`Object.assign(rulegenBase, ${JSON.stringify(values.params)}); rulegenApply();`); sketch.draw();
  assert.ok(Math.abs(sketch.circles.at(-1)![0] - before - 90) < 1e-6);
});
