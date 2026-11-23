import test from "node:test";
import assert from "node:assert/strict";
import { run, sampleScene, sceneProgram } from "./fixtures/scene";
import { connectScene } from "../app/server/scene-code.server";
import { prepareCode } from "../app/server/code.server";
import { readSceneValues, sceneStructureKey, syncScene, withBlockParams } from "../app/lib/scene/machines";
import { sceneLiveStatus } from "../app/lib/scene/live";
import { moveNodes, updateNode } from "../app/lib/scene/graph";
import * as ops from "../app/lib/scene/panel-ops";
import { createSketchPanel } from "../app/lib/sketch-panels";

const connect = (code = sceneProgram, scene = sampleScene()) => connectScene({ title: "Tree", explanation: "나무", code }, scene);

test("connected code reads every param live; widget edits and node moves patch only the host block", () => {
  const scene = sampleScene(), generated = connect(sceneProgram, scene);
  assert.equal(sceneLiveStatus(generated, scene), "live");
  const first = run(generated.code); first.draw();
  assert.equal(first.lines.length, 5);
  assert.equal(first.strokes[0], "#75664e");
  const panel = { ...createSketchPanel(), scene };
  const edited = { ...panel, ...ops.setParamScalar(panel, "tree", "structure", [], 7) };
  const recolored = { ...edited, ...ops.setParamScalar(edited, "tree", "ink", [], "#112233") };
  const moved = moveNodes(recolored.scene, ["orb"], .1, 0);
  const source = syncScene(generated.code, moved);
  assert.ok(source.endsWith(generated.code.slice(generated.code.indexOf("function decayed"))), "drawing code is untouched");
  const second = run(source); second.draw();
  assert.equal(second.lines.length, 7);
  assert.equal(second.strokes[0], "#112233");
  assert.ok(Math.abs(second.circles[0][0] - first.circles[0][0] - 90) < 1e-6, "layout keys follow the moved object");
  // The sandbox patches the prepared (re-printed) executable the same way.
  const prepared = prepareCode(generated.code);
  assert.match(syncScene(prepared, moved), /"tree\/structure": 7/);
  assert.equal(sceneLiveStatus(generated, recolored.scene), "live");
  const structural = { ...panel, ...ops.addSliderParam(panel, "orb", "pulse") };
  assert.equal(sceneLiveStatus(generated, structural.scene), "changed");
});

test("each node's FSM runs on its own: evaluate computes the current state's constraints in order, dispatch takes declared transitions", () => {
  const scene = sampleScene(), panel = { ...createSketchPanel(), scene };
  const fast = { ...panel, ...ops.setParamScalar(panel, "orb", "speed", [], 120) };
  const sketch = run(syncScene(connect(sceneProgram, scene).code, fast.scene));
  assert.equal(sketch.read('rulegenState["orb"].id'), "idle");
  assert.equal(sketch.read('rulegenState["tree"].id'), "default", "a node without a machine is its implicit state");
  sketch.draw(); assert.equal(sketch.circles.at(-1)![2], 48);
  assert.equal(sketch.read('JSON.stringify(rulegenOwners.orb[""].data)'), '{"size":48}', "idle evaluates its own constraints only");
  sketch.read("p.mousePressed()");
  assert.equal(sketch.read('rulegenState["orb"].id'), "moving");
  assert.equal(sketch.read('rulegenEmit("orb", "press")'), false, "events only fire from their source state");
  sketch.draw();
  const start = scene.nodes[1].region.x * 900;
  assert.ok(Math.abs(sketch.circles.at(-1)![0] - (start + 12)) < 1e-6, "moving also evaluates x: 120px/s for 100ms");
  for (let i = 0; i < 40 && sketch.read('rulegenState["orb"].id') === "moving"; i++) sketch.draw();
  assert.equal(sketch.read('rulegenState["orb"].id'), "idle", "the code dispatched settle at the edge");
  assert.equal(sketch.read('rulegenJumpState("tree", "idle")'), false, "no such state");
  assert.equal(sketch.read('rulegenJumpState("orb", "moving")'), true, "the panel can put a node into a state");
  // Each evaluation is recorded as state machine steps: a visit, then its constraints in order.
  const steps = (sketchRun: typeof sketch) => (JSON.parse(sketchRun.read("JSON.stringify(rulegenRunEnd())")).events as { kind: string; data: { fsm: string; node: string; state: string; property?: string; event?: string; to?: string } }[])
    .filter(event => event.kind === "trace").map(({ data }) => [data.fsm, data.node, data.state, data.property ?? data.event ?? ""].join(" "));
  const fresh = run(syncScene(connect(sceneProgram, scene).code, fast.scene));
  fresh.read('rulegenJumpState("orb", "moving")'); fresh.read("rulegenRunStart(null, null, null, {})"); fresh.draw();
  assert.deepEqual(steps(fresh), ["state tree default ", "constraint tree default branches", "constraint tree default color", "state orb moving ", "constraint orb moving size", "constraint orb moving x"]);
  // The order lives in the host block: reordering the state changes it without new code.
  const inState = { ...fast, ...ops.chooseState(fast, "orb", "moving") }, reordered = { ...inState, ...ops.moveConstraint(inState, "orb", "drift", -1) };
  assert.equal(sceneLiveStatus(connect(sceneProgram, scene), reordered.scene), "live");
  const again = run(syncScene(connect(sceneProgram, scene).code, reordered.scene));
  again.read('rulegenJumpState("orb", "moving")'); again.read("rulegenRunStart(null, null, null, {})"); again.draw();
  assert.deepEqual(steps(again).slice(3), ["state orb moving ", "constraint orb moving x", "constraint orb moving size"]);
  // A transition is a step too, followed by entering its destination.
  const pressed = run(connect(sceneProgram, scene).code);
  pressed.draw(); pressed.read("rulegenRunStart(null, null, null, {})"); pressed.read("p.mousePressed()");
  assert.deepEqual(steps(pressed), ["transition orb idle press", "state orb moving "]);
  // A constraint step carries its value and the params it read.
  const detail = run(connect(sceneProgram, scene).code);
  detail.read("rulegenRunStart(null, null, null, {})"); detail.draw();
  const size = (JSON.parse(detail.read("JSON.stringify(rulegenRunEnd())")).events as { data?: { property?: string; value?: unknown; reads?: Record<string, unknown> } }[]).find(event => event.data?.property === "size")!.data!;
  assert.deepEqual([size.value, size.reads], [48, { "orb/radius": 24 }]);
});

test("the module contract: one self-contained module per root, reading only its own nodes through m", () => {
  const close = sceneProgram.lastIndexOf("});");
  const inside = (extra: string) => sceneProgram.replace("    mousePressed()", `    keyPressed() { ${extra} },\n    mousePressed()`);
  const variants: [string, RegExp][] = [
    [sceneProgram.replace('m.v("tree/ink")', '"#000000"'), /could not be connected to the code/],
    [sceneProgram.replace('m.v("orb/speed")', 'm.v("orb/unknown")'), /param connections in the generated code are invalid/],
    [sceneProgram.replace('m.v("orb/speed")', 'm.v("orb/" + "speed")'), /param connections in the generated code are invalid/],
    [inside("const read = m.v;"), /m\.v must be called directly/],
    [inside("helper(m);"), /m\.v \/ m\.box/],
    [inside("rulegenParams[\"orb/radius\"] = 3;"), /cannot access rulegenParams/],
    [inside("rulegenEmit(\"orb\", \"press\");"), /cannot access rulegenEmit/],
    [inside("rulegenOwners.orb = {};"), /cannot access rulegenOwners/],
    [inside('m.fsm("orb").dispatch("settle-now");'), /not an event of a transition/],
    [inside('const event = "press"; m.fsm("orb").dispatch(event);'), /string literal/],
    [inside('m.state("tree");'), /m\.v \/ m\.box \/ m\.fsm/],
    [inside('m.fsm("elsewhere").evaluate();'), /m\.fsm must take a node ID of this module/],
    [sceneProgram.replace("drift: computeX", ""), /compute function in constraints\["orb"\]: drift/],
    [sceneProgram.replace("drift: computeX", "drift: computeX, glow: computeX"), /do not exist: glow/],
    [sceneProgram.replace("drift: computeX", "drift: 3"), /must be a function/],
    [sceneProgram.replace('orb.dispatch("settle")', "orb.state"), /never taken: dispatch "settle"/],
    [sceneProgram.replace('m.fsm("tree").evaluate()', '({ color: m.v("tree/ink"), branches: [] })'), /never evaluated/],
    [inside("p.draw = () => {};"), /cannot change properties of p/],
    [inside("p.background(0);"), /p\.background/],
    [inside("m.p.noLoop();"), /p\.noLoop/],
    [inside("shared = 1;"), /undeclared global variable shared/],
    [`${sceneProgram}\nlet shared = 0;`, /rulegenModule/],
    [sceneProgram.replace('rulegenModule("tree"', 'rulegenModule("orb"'), /must be a root node ID/],
    [sceneProgram.replace("function (m)", "function (ctx)"), /must take the form/],
    [`const rulegenState = {};\n${sceneProgram}`, /rulegenModule/],
    [`// @rulegen-scene:start\n${sceneProgram}`, /Host connection blocks/],
  ];
  assert.ok(close > 0);
  for (const [code, error] of variants) assert.throws(() => connect(code), error, code.slice(-120));
  // A second root node needs its own module.
  const scene = sampleScene(), split = updateNode(scene, "orb", node => ({ ...node, parentId: null }));
  assert.throws(() => connect(sceneProgram, split), /param connections in the generated code are invalid|Each root node needs a module/);
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
  const body = (inside: string, draw = "") => sceneProgram.replace("  function decayed", `  ${inside}\n  function decayed`).replace("    draw() {\n", `    draw() {\n${draw}`);
  assert.throws(() => connect(body("let x = 0;")), /m\.store/);
  assert.throws(() => connect(body("const trail = [];")), /m\.store/);
  assert.throws(() => connect(body("const v = p.createVector(1, 2);")), /m\.store/);
  assert.throws(() => connect(body("", "      m.store = {};\n")), /m\.store cannot be replaced/);
  assert.doesNotThrow(() => connect(body("const TAU = Math.PI * 2, R = 3; const step = () => 1;", "      m.store.t = (m.store.t || 0) + TAU;\n")));
});

test("a runtime snapshot restores module stores, machine states and the seed; new values redraw from the restored moment", () => {
  const moving = sceneProgram.replace("p.circle(data.x ?? m.box(\"orb\").x, 300, data.size);",
    "m.store.x = (m.store.x || 0) + 10; m.store.trail = [...(m.store.trail || []), m.store.x].slice(-3);\n      p.circle(m.store.x, 300, data.size);");
  assert.notEqual(moving, sceneProgram);
  const sketch = run(connect(moving).code);
  sketch.draw(); sketch.draw(); sketch.read("rulegenEmit('orb', 'press')");
  const snapshot = sketch.read("rulegenSnapshot()");
  assert.equal(JSON.stringify(snapshot.stores.tree), JSON.stringify({ x: 20, trail: [10, 20] }));
  assert.equal(snapshot.states.orb.id, "moving");
  assert.equal(snapshot.owners.orb[""].state, "moving", "each owner's state and data come with the step");
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
      setup() { m.store.trail = []; m.store.slots = m.v("tree/structure"); },
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
  sketch.read(`rulegenSetup(new Set([${JSON.stringify("tree/structure")}]))`);
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
  // m.history() passes the context check (this module just does not wire every param).
  assert.throws(() => connect(`rulegenModule("tree", ${derived});`, scene), /params could not be connected to the code/);
  assert.throws(() => connect(`rulegenModule("tree", function (m) { return { draw() { m.history(1); } }; });`, scene), /called without arguments/);
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

test("a temporary fork reads what the tools show live with m.demo: null until given, then a host value that redraws in place", () => {
  const code = sceneProgram.replace('function computeSize() { return m.v("orb/radius") * 2; }',
    'function computeSize() { const shown = m.demo("size"); return shown === null ? m.v("orb/radius") * 2 : shown.w; }');
  const generated = connect(code), sketch = run(generated.code);
  sketch.draw();
  assert.equal(sketch.circles.at(-1)![2], 48, "nothing shown yet: as before");
  const pushed = withBlockParams(generated.code, { "~demo/size": { w: 77 } })!;
  assert.equal(sceneStructureKey(pushed), sceneStructureKey(generated.code), "a shown value is a host value: no reload");
  sketch.read(`Object.assign(rulegenBase, ${JSON.stringify(readSceneValues(pushed)!.params)}); rulegenApply();`);
  sketch.draw();
  assert.equal(sketch.circles.at(-1)![2], 77, "the shown value is used at once");
  const inside = (extra: string) => sceneProgram.replace("    mousePressed()", `    keyPressed() { ${extra} },\n    mousePressed()`);
  assert.throws(() => connect(inside('const id = "size"; m.demo(id);')), /m\.demo is called as m\.demo\("<value id>"\)/);
  assert.throws(() => connect(inside('m.demo("a b");')), /m\.demo is called/);
});
