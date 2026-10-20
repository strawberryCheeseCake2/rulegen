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

test("a value change re-runs only the setups that read it, so trails and drag state survive tweaking; older programs get the current host runtime", async () => {
  const { assembleProgram, moduleSource, refreshProgram, SCENE_DRIVER_MARK } = await import("../app/lib/scene/machines");
  const scene = sampleScene();
  const module = moduleSource("tree", `function (m) {
    return {
      setup() { m.store.trail = []; m.store.slots = m.v("tree/structure/depth"); },
      draw() { p.line(0, 0, m.v("orb/radius"), 0); },
      mouseDragged() { m.store.trail.push(1); },
    };
  }`);
  const program = assembleProgram(scene, [module]);
  assert.equal(refreshProgram(program), program, "a current program is left exactly as it is");
  const sketch = run(program);
  sketch.read("p.mouseDragged(); p.mouseDragged();");
  assert.equal(sketch.read("rulegenLive[0].store.trail.length"), 2);
  sketch.read(`rulegenSetup(new Set([${JSON.stringify("orb/radius")}]))`);
  assert.equal(sketch.read("rulegenLive[0].store.trail.length"), 2, "radius is read only in draw: the trail stays");
  sketch.read(`rulegenSetup(new Set([${JSON.stringify("tree/structure/depth")}]))`);
  assert.equal(sketch.read("rulegenLive[0].store.trail.length"), 0, "depth sized the store in setup: it is rebuilt");
  sketch.read("p.mouseDragged(); rulegenSetup()");
  assert.equal(sketch.read("rulegenLive[0].store.trail.length"), 0, "without a change list every setup runs (start, re-render)");
  // An older program (another driver) is brought up to date around its modules.
  const old = program.replace(SCENE_DRIVER_MARK, `${SCENE_DRIVER_MARK}\n// old driver`);
  assert.equal(refreshProgram(old), program);
  assert.equal(createSketchPanel({ generated: { ...connect(sceneProgram, scene), code: old }, scene }).generated!.code, program, "saved projects load with it");
});

test("modules derive input-made things from m.history(), so a value change adjusts them in place; baking modules fall back to replaying the input", async () => {
  const { assembleProgram, moduleSource } = await import("../app/lib/scene/machines");
  const { bakesInput } = await import("../app/lib/proxy-frames");
  const scene = sampleScene();
  // Dots along every drag, spaced by the current radius: nothing is stored when the input arrives.
  const derived = `function (m) {
    return {
      draw() { const gap = m.v("orb/radius"); for (const g of m.history()) for (let i = 0; i < g.points.length; i += 1) if (i % Math.max(1, Math.round(gap / 10)) === 0) p.circle(g.points[i].x, g.points[i].y, 4); },
      mouseDragged() {},
    };
  }`;
  // m.history() passes the context check (this module just does not wire every property).
  assert.throws(() => connect(`rulegenModule("tree", ${derived});`, scene), /property를 코드에 연결/);
  assert.throws(() => connect(`rulegenModule("tree", function (m) { return { draw() { m.history(1); } }; });`, scene), /인자 없이/);
  const sketch = run(assembleProgram(scene, [moduleSource("tree", derived)]));
  sketch.read("p.mouseX = 10; p.mouseY = 10; p.mousePressed(); for (let i = 1; i <= 20; i++) { p.mouseX = 10 + i; p.mouseDragged(); } p.mouseReleased();");
  assert.equal(sketch.read("rulegenGestures.length"), 1);
  assert.equal(sketch.read("rulegenGestures[0].points.length"), 21);
  assert.equal(sketch.read("rulegenGestures[0].done"), true);
  sketch.circles.length = 0; sketch.read("rulegenParams['orb/radius'] = 10"); sketch.draw();
  const dense = sketch.circles.length;
  sketch.circles.length = 0; sketch.read("rulegenParams['orb/radius'] = 50"); sketch.draw();
  assert.ok(sketch.circles.length < dense && sketch.circles.length > 0, "the same drag re-laid at the new spacing, without new input");
  assert.equal(sketch.read("rulegenNeedsReplay()"), false, "it derives from history: no replay needed");
  const snapshot = sketch.read("JSON.stringify(rulegenSnapshot())");
  sketch.read("rulegenInputReset()"); assert.equal(sketch.read("rulegenGestures.length"), 0);
  sketch.read(`rulegenRestore(${snapshot})`);
  assert.equal(sketch.read("rulegenGestures[0].points.length"), 21, "a restored step brings its input back");
  // A module that stores what it made keeps the old values in it: a value change needs the input again.
  const baked = `function (m) { return { setup() { m.store.dots = []; }, draw() { for (const d of m.store.dots) p.circle(d.x, d.y, 4); }, mouseDragged() { m.store.dots.push({ x: m.p.mouseX, y: m.p.mouseY }); } }; }`;
  assert.equal(run(assembleProgram(scene, [moduleSource("tree", baked)])).read("rulegenNeedsReplay()"), true);
  assert.equal(bakesInput(baked), true); assert.equal(bakesInput(derived), false); assert.equal(bakesInput("function (m) { return { draw() {} }; }"), false);
});

test("a frame's cost does not grow with all the input: gestures have a stable id and rev, and m.memo computes each one's result once", async () => {
  const { assembleProgram, moduleSource } = await import("../app/lib/scene/machines");
  const scene = sampleScene();
  // Counts how often each gesture's layout is computed.
  const memoized = `function (m) {
    return {
      setup() { m.store.computed = 0; },
      draw() {
        const gap = m.v("orb/radius");
        for (const g of m.history()) {
          const dots = m.memo(["dots", g.id, g.rev, gap], () => { m.store.computed++; return g.points.filter((_, i) => i % Math.max(1, Math.round(gap / 10)) === 0); });
          for (const d of dots) p.circle(d.x, d.y, 4);
        }
      },
      mouseDragged() {},
    };
  }`;
  assert.throws(() => connect(`rulegenModule("tree", function (m) { return { draw() { m.memo("k"); } }; });`, scene), /m.memo\(key/);
  const sketch = run(assembleProgram(scene, [moduleSource("tree", memoized)]));
  const drag = (x: number) => sketch.read(`p.mouseX = ${x}; p.mouseY = 10; p.mousePressed(); for (let i = 1; i <= 10; i++) { p.mouseX = ${x} + i; p.mouseDragged(); } p.mouseReleased();`);
  drag(10); drag(100);
  assert.deepEqual(sketch.read("JSON.stringify(rulegenGestures.map(g => [g.id, g.done]))"), JSON.stringify([[1, true], [2, true]]));
  const rev = sketch.read("rulegenGestures[0].rev");
  assert.ok(rev > 0, "rev changed with each point and the release");
  sketch.draw(); const first = sketch.read("rulegenLive[0].store.computed");
  assert.equal(first, 2, "one computation per gesture");
  for (let i = 0; i < 5; i++) sketch.draw();
  assert.equal(sketch.read("rulegenLive[0].store.computed"), 2, "finished gestures are not computed again frame after frame");
  // While a new drag is held, only that gesture is recomputed as it grows.
  sketch.read("p.mouseX = 200; p.mousePressed(); p.mouseX = 201; p.mouseDragged();"); sketch.draw();
  sketch.read("p.mouseX = 202; p.mouseDragged();"); sketch.draw();
  assert.equal(sketch.read("rulegenLive[0].store.computed"), 4, "only the live gesture, once per change");
  sketch.read("p.mouseReleased()");
  // A value change recomputes each gesture once, then it is cached again.
  sketch.read("rulegenParams['orb/radius'] = 40"); sketch.draw(); sketch.draw();
  assert.equal(sketch.read("rulegenLive[0].store.computed"), 4 + 3, "three gestures, once each");
  // Restored steps keep ids and revs; new gestures never reuse an id.
  const snapshot = sketch.read("JSON.stringify(rulegenSnapshot())");
  sketch.read(`rulegenRestore(${snapshot})`);
  assert.equal(sketch.read("JSON.stringify(rulegenGestures.map(g => g.id))"), JSON.stringify([1, 2, 3]));
  assert.equal(sketch.read("rulegenGestures[0].rev"), rev);
  drag(300); assert.equal(sketch.read("rulegenGestures.at(-1).id"), 4);
  // Unused entries go after a while; a key made of points is refused.
  for (let i = 0; i < 400; i++) sketch.draw();
  assert.ok(sketch.read("rulegenLive[0].memo.size") <= 4, "old values' entries are dropped");
  const long = run(assembleProgram(scene, [moduleSource("tree", `function (m) { return { draw() { m.memo("x".repeat(3000), () => 1); } }; }`)]));
  assert.throws(() => long.draw(), /m.memo key is too long/, "a key built from points is refused");
});
