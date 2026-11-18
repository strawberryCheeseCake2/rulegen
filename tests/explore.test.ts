import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import vm from "node:vm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { run, sampleScene, sceneProgram, withMockedAI } from "./fixtures/scene";
import { connectScene } from "../app/server/scene-code.server";
import { emptyExploreEdit, EXEC_KEY, executedRuntime, restoredExplore, savedExplore, exploreProgram, exploreResultSchema, exploreStep, inputPath, LAST_ROOT, NEXT_ROOT, PATH_ROOT, jumpTarget, runSteps, runStores, stageCounts, stepsAt, STEPS_ROOT, traceOnly, withoutTraces, type ExploreFrame, type ExploreResult } from "../app/lib/explore";
import { emptyInspection, evaluate, targetedResultSchema } from "../app/lib/inspection";
import { addHostParams, programModules, readSceneValues } from "../app/lib/scene/machines";
import { moduleKeyOf } from "../app/lib/hidden-parameters";
import { requestSchema } from "../app/lib/schema";
import { projectSchema } from "../app/lib/project";
import { runAI } from "../app/server/ai.server";
import { prepareCode } from "../app/server/code.server";

const logDirectory = mkdtempSync(path.join(tmpdir(), "rulegen-explore-"));
const previousLogDirectory = process.env.RULEGEN_AI_LOG_DIR;
process.env.RULEGEN_AI_LOG_DIR = logDirectory;
after(() => { rmSync(logDirectory, { recursive: true, force: true }); if (previousLogDirectory === undefined) delete process.env.RULEGEN_AI_LOG_DIR; else process.env.RULEGEN_AI_LOG_DIR = previousLogDirectory; });

// Two gestures of 4 and 6 points: execution runs through 10 points.
const gesture = (id: number, xs: number[]) => ({ id, rev: 7, points: xs.map((x, i) => ({ x, y: id * 100, t: i * 10 })), done: true });
const runtime = { seed: 1, states: {}, stores: { tree: { items: [1, 2, 3] } }, history: [gesture(1, [0, 10, 20, 30]), gesture(2, [100, 110, 120, 130, 140, 150])] };
type Gesture = { id: number; rev: number; points: unknown[]; done: boolean };

test("execution progress executes the recorded input only up to that point: whole gestures, the one it is in cut (still being drawn), none after", () => {
  const history = (t: number) => (executedRuntime(runtime, t) as { history: Gesture[] }).history;
  assert.equal(executedRuntime(runtime, 1), runtime, "all of it: the marks as they are");
  assert.deepEqual(history(.4).map(g => [g.id, g.points.length, g.done]), [[1, 4, true]], "4 of 10 points: the first gesture whole");
  assert.deepEqual(history(.7).map(g => [g.id, g.points.length, g.done]), [[1, 4, true], [2, 3, false]], "7 of 10: the second cut after 3 points, not done");
  assert.notEqual(history(.7)[1].rev, 7, "a cut gesture gets a rev of its own, so nothing computed from the whole gesture is reused");
  assert.notEqual(history(.7)[1].rev, history(.8)[1].rev);
  assert.deepEqual(history(0), [], "nothing executed yet");
  assert.deepEqual((executedRuntime(runtime, .7) as { stores: unknown }).stores, runtime.stores, "the rest of the runtime as it was");
  assert.equal(inputPath(runtime).length, 10);
});

test("the program draws the marks as that much execution makes them (a cut gesture comes back unfinished)", () => {
  const program = sceneProgram.replace("    draw() {", "    draw() {\n      for (const g of m.history()) for (const q of g.points) p.circle(q.x, q.y, g.done ? 1 : 2);");
  const sketch = run(connectScene({ title: "Tree", explanation: "", code: program }, sampleScene()).code);
  const drawn = (t: number) => { sketch.circles.length = 0; sketch.read(`rulegenRestore(${JSON.stringify(executedRuntime(runtime, t))})`); sketch.draw(); return sketch.circles.filter(circle => circle[2] <= 2); };
  assert.equal(drawn(1).length, 10);
  const half = drawn(.7);
  assert.equal(half.length, 7); assert.deepEqual(half.filter(circle => circle[2] === 2).map(circle => circle[0]), [100, 110, 120], "the gesture being drawn is not done");
  assert.equal(drawn(0).length, 0);
});

test("handles read execution: p(\"@execution\"), the input point executed at a progress, and the progress nearest the pointer", () => {
  const path = inputPath(runtime), context = { values: { [EXEC_KEY]: .7 }, stores: { [PATH_ROOT]: path }, states: {}, step: 0, steps: 1 };
  assert.equal(evaluate(`pathX(p("${EXEC_KEY}"))`, context), 120, "the pen tip at 7 of 10 points is the 7th point");
  assert.equal(evaluate("pathY(0.2)", context), 100);
  assert.equal(evaluate("nearest(118, 205)", context), .7, "the pointer near the 7th point: that much execution");
  assert.equal(evaluate(`pathX(nearest(31, 99))`, context), 30, "inverse of each other");
  assert.ok(Number.isNaN(evaluate("pathX(0.5)", { ...context, stores: {} })), "no path: not a number (no error)");
});

test("an execution axis of steps moves between the recorded steps", () => {
  const steps = [{ runtime: "a", values: { v: 1 } }, { runtime: "b", values: { v: 2 } }, { runtime: "c", values: { v: 3 } }];
  const frame = (progress: number, axis: "input" | "steps") => ({ base: { runtime, values: {}, steps }, progress, result: { axis } as ExploreResult });
  assert.deepEqual([0, .5, 1].map(t => exploreStep(frame(t, "steps")).runtime), ["a", "b", "c"]);
  assert.equal(exploreStep(frame(.5, "steps")).values.v, 2);
  assert.equal((exploreStep(frame(.4, "input")).runtime as { history: unknown[] }).history.length, 1);
  assert.equal(exploreStep({ ...frame(.4, "input"), result: null }).runtime, runtime, "before AI answers: the marks as they are");
});

test("an Execution frame's edits (its wrappers) go into its own program; one that does not apply is an error", () => {
  const scene = sampleScene(), code = connectScene({ title: "Tree", explanation: "", code: sceneProgram }, scene).code;
  const result = { edits: [{ nodeId: "orb", find: "p.stroke(tree.color);", replace: "p.stroke(tree.color); p.line(0, 0, 12, 12);" }] };
  const made = exploreProgram(code, scene, result);
  assert.ok("code" in made);
  const sketch = run(made.code); sketch.draw();
  assert.ok(sketch.lines.some(line => line[2] === 12 && line[3] === 12), "it runs with the edit");
  assert.deepEqual(exploreProgram(code, scene, { edits: [{ ...result.edits[0], find: "not in the code" }] }), { error: "Could not find the code to change" });
  assert.equal(readSceneValues(addHostParams(code, { "orb/radius": 999 }))!.params["orb/radius"], 24, "values the scene has stay");
  // The brush's code changed after AI wrote them (e.g. the inspection made with the frame recorded on its items): they go into the module they were written for.
  const key = moduleKeyOf(scene, "orb")!, module = programModules(code).get(key)!;
  const changed = code.replace(module, () => module.replace("p.stroke(tree.color);", "p.stroke(m.store.seen = tree.color);"));
  assert.ok("error" in exploreProgram(changed, scene, result), "not in the changed module");
  const own = exploreProgram(changed, scene, result, { [key]: module });
  assert.ok("code" in own && own.code.includes("p.line(0, 0, 12, 12)") && !own.code.includes("m.store.seen"), "its own copy, with the edit");
  assert.equal(programModules(own.code).size, programModules(code).size, "the other modules stay");
});

type Shown = ExploreResult["overlays"][number];
const pen: Shown = { id: "pen", kind: "ellipse", name: "펜 끝", x: `pathX(p("${EXEC_KEY}")) - 8`, y: `pathY(p("${EXEC_KEY}")) - 8`, w: "16", h: "16", label: "", color: "#e0457b",
  link: { kind: "param", nodeId: "orb", id: "radius" }, when: "", each: "" };
/** As an AI may still write it: with a handle (that runs execution, or changes a value). */
const handled = (key: string) => ({ ...pen, id: `grip-${key}`, handle: { key, gesture: "drag", x: `pathX(p("${EXEC_KEY}"))`, y: `pathY(p("${EXEC_KEY}"))`, pivotX: "", pivotY: "", value: "nearest(hx, hy)", hint: "끌어 그려 나가기" } });
const params = [{ key: "orb/radius", nodeId: "orb", constraintId: "pulse", constraint: "size", paramId: "radius", param: "Radius", type: "number" }];
const stepInput = { id: 1, nodeId: null, from: null, to: null, transitionId: null, values: { "orb/radius": 24 }, runtime: { states: {}, stores: {} } };
async function explore(output: Partial<ExploreResult>, steps = [stepInput]) {
  const scene = sampleScene(), code = connectScene({ title: "Tree", explanation: "", code: sceneProgram }, scene).code;
  return withMockedAI(() => ({ summary: "단계를 넘겨 보세요.", axis: "input", from: 0, to: 1, edits: [], overlays: [pen], stages: [], sketches: [], ...output }), async calls => {
    const result = exploreResultSchema.parse(await runAI(requestSchema.parse({ intent: "explore", scene, image: "data:image/png;base64,AAAA", instruction: "불꽃이 어떻게 합쳐지는지", previous: code,
      inspection: { brushName: "Tree", nodeIds: ["tree", "orb"], cursor: null, marks: [], params, steps },
      explore: { summary: "원인", overlays: [], input: { gestures: 2, points: 10 } } }), new AbortController().signal));
    return { result, calls };
  });
}

test("explore AI: an Execution frame's overlays only explain: no handle runs execution or changes anything", async () => {
  const { result, calls } = await explore({ overlays: [pen, handled(EXEC_KEY), handled("orb/radius")] as Shown[], axis: "steps" });
  assert.deepEqual(result.overlays.map(item => [item.id, "handle" in item]), [["pen", false], [`grip-${EXEC_KEY}`, false], ["grip-orb/radius", false]], "handles written anyway are dropped");
  assert.equal(result.axis, "input", "steps only with steps to move between");
  assert.match(calls[0].instructions, /UNDERSTAND HOW THE BRUSH WORKS INSIDE by GOING THROUGH ITS EXECUTION STEP BY STEP/);
  assert.match(calls[0].instructions, /WITHOUT handles: nothing on this frame is dragged to run it/);
  assert.doesNotMatch(calls[0].instructions, /### the execution handle|nearestStep|metaphor/i, "no execution handle to design");
  assert.doesNotMatch(calls[0].instructions, /recommendation|"parameters"/i, "only the Execution frame is left");
  assert.equal((await explore({ overlays: [] })).result.overlays.length, 0, "nothing to drag is no error");
  const narrow = await explore({ from: .5, to: .505 });
  assert.deepEqual([narrow.result.from, narrow.result.to], [0, 1], "a range too narrow to move in is the whole");
});

test("the inspection panel offers the Execution frame under its explanation; the frame is wired on the board", async () => {
  const { InspectionPanel } = await import("../app/components/inspection-panel");
  const { brushesFor } = await import("../app/lib/brushes");
  const scene = sampleScene(), [brush] = brushesFor(scene, "sketch-a", [], () => "brush-1"), noop = () => {};
  const result = targetedResultSchema.parse({ summary: "원인 설명", overlays: [] });
  const targeted = { id: "t1", name: "T", concern: "c", marks: [], markStyles: [], result, overlayUpdates: [] };
  const render = (props: object) => renderToStaticMarkup(createElement(InspectionPanel, { brush, kind: "targeted", targeted, scene, nodeIds: ["tree", "orb"], state: emptyInspection(brush.id), busy: false, running: true,
    onCursor: noop, onClear: noop, onFocus: noop, onConcern: noop, onClearMarks: noop, onInspect: noop, onTool: noop, ...props } as never));
  const html = render({ onExplore: noop, exploring: true });
  assert.equal(html.match(/Execution · draw the state you want/g)?.length, 1);
  assert.match(html, /Execution · draw the state you want<small>Open · go<\/small>/, "an open one goes to its frame");
  assert.ok(html.indexOf("원인 설명") < html.indexOf("Execution · draw the state you want"), "under its explanation");
  assert.doesNotMatch(render({}), /draw the state you want<\/button>/, "nothing without Execution frames");
  assert.match(render({ onExplore: noop, onDeferExecution: noop, deferExecution: true }), /<input type="checkbox" checked=""[^>]*\/>Generate Execution exploration later \(frame only\)/, "the Execution frame can be made later");
  const home = readFileSync("app/routes/home.tsx", "utf8");
  assert.match(home, /onExplore=\{openExplore\} exploring=\{exploreOpen\(\)\}/);
  assert.match(home, /base: \{ runtime: state\.steps\[at\]\.runtime/, "the frame starts from the brush marks the inspection holds");
  assert.match(home, /executable: syncScene\(owner\.executable, owner\.scene\)/, "its own copy of the program");
  assert.match(home, /closeExploreFrames\(frame => frame\.targetFrameId === id\)/, "it goes with its frame");
  assert.match(readFileSync("app/components/code-preview.tsx", "utf8"), /sentRestore\.current\?\.startsWith\(`\$\{event\.data\.drawnFor\}\|`\)/, "the stores drawn for a held moment reach the overlays");
});

test("the exploration frame draws the held marks with its overlays and a scrubber, and no grip", async () => {
  const { ExploreFrameView } = await import("../app/components/explore-frame");
  const frame: ExploreFrame = { id: "explore-1", targetFrameId: "sketch-a", brushId: "b", toolId: "t", mode: "execution", name: "n", nodeIds: ["orb"],
    base: { runtime, values: { "orb/radius": 24 }, steps: [] }, executable: "", status: "ready", error: "", progress: .7, values: {},
    result: { summary: "펜 끝을 끌어 보세요.", axis: "input", from: 0, to: 1, edits: [], overlays: [pen], stages: [], sketches: [], of: [] },
    request: { concern: "c", inspection: targetedResultSchema.parse({ summary: "s", overlays: [] }) } };
  const noop = () => {};
  const html = renderToStaticMarkup(createElement(ExploreFrameView, { frame, zoom: 1, specs: {}, onProgress: noop, onValue: noop, onRetry: noop, onActivate: noop }));
  assert.doesNotMatch(html, /role="slider" aria-label="[^"]*끌어/, "no grip runs execution"); assert.match(html, /aria-label="Execution progress"/); assert.match(html, />70%</);
  // Execution frames made later: placed with the brush marks, and AI makes it only when Generate is pressed.
  const idle = renderToStaticMarkup(createElement(ExploreFrameView, { frame: { ...frame, status: "idle", result: null }, zoom: 1, specs: {}, onProgress: noop, onValue: noop, onRetry: noop, onActivate: noop }));
  assert.match(idle, /Not generated yet\.[^<]*<button>Generate<\/button>/);
  assert.match(html, /cx="120"/, "the overlay on the pen tip at that progress");
  assert.doesNotMatch(html, /inspection-step-badge|inspection-badge/, "one moment: no step numbers");
});

test("a brush that paints on the canvas itself (p.drawingContext) is executed step by step too: its paint calls past the step are not drawn", () => {
  // Each stroke is an item of the orb with its own owner: evaluating it is a state machine step (its state, then its size).
  const program = connectScene({ title: "Tree", explanation: "", code: sceneProgram }, sampleScene()).code.replace("    draw() {",
    "    draw() {\n      const ctx = p.drawingContext;\n      for (let i = 0; i < 3; i++) { m.fsm(\"orb\", i).evaluate(0); ctx.beginPath(); ctx.moveTo(i * 100, 10); ctx.lineTo(i * 100 + 40, 30); ctx.stroke(); }\n      p.background(255);");
  const p: Record<string, unknown> = { setup() {}, draw() {}, deltaTime: 100, createCanvas() {}, background() { ctx.fillRect(); }, clear() {}, push() {}, pop() {}, noLoop() {}, stroke() {}, line() {}, circle() {} };
  const context = vm.createContext({ p, __rulegenGuard() {} });
  const ctx = { painted: [] as string[], getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }), beginPath() {}, moveTo() {}, lineTo() {}, stroke() { ctx.painted.push("stroke"); }, fillRect() { ctx.painted.push("fillRect"); } };
  p.drawingContext = ctx;
  vm.runInContext(prepareCode(program), context); (p.setup as () => void)();
  const painted = () => ctx.painted.filter(kind => kind === "stroke").length;
  const record = (budget: number | null) => { ctx.painted.length = 0; vm.runInContext(`rulegenRunStart(${budget}, ["tree"])`, context); (p.draw as () => void)(); return JSON.parse(JSON.stringify(vm.runInContext("rulegenRunEnd()", context))); };
  const all = record(null);
  assert.deepEqual(all.events.slice(0, 6).map((event: { kind: string }) => event.kind), ["trace", "trace", "stroke", "trace", "trace", "stroke"], "each item's state visit and its constraint, then its paint call");
  assert.deepEqual(all.events.slice(0, 2).map((event: { data: { fsm: string; key: string } }) => [event.data.fsm, event.data.key]), [["state", "0"], ["constraint", "0"]]);
  assert.ok(!all.events.some((event: { kind: string }) => event.kind === "fillRect"), "a background is not");
  assert.deepEqual([all.events[5].x, all.events[5].y, all.events[5].w, all.events[5].h], [100, 10, 40, 20], "where the path it paints is");
  assert.equal(painted(), 3);
  const count = runSteps(all).length, frame = (done: number) => ({ base: { runtime, values: {}, steps: [] }, progress: done / count, result: { axis: "run" } as ExploreResult });
  record(exploreStep(frame(2), all).budget); assert.equal(painted(), 1, "one item's state machine step: the first stroke only");
  record(exploreStep(frame(0), all).budget); assert.equal(painted(), 0, "no step yet");
  assert.ok(ctx.painted.includes("fillRect"), "the background is painted at every step");
  ctx.painted.length = 0; (p.draw as () => void)(); assert.equal(painted(), 3, "outside a run nothing changes");
});

test("a run of the code is executed state machine step by state machine step: each state visit, then its constraints in order; only the steps executed are drawn", async () => {
  const { fsmVisits, fsmName, keySteps, stepOp } = await import("../app/lib/explore");
  const scene = sampleScene(), sketch = run(connectScene({ title: "Tree", explanation: "", code: sceneProgram }, scene).code);
  const record = (budget: number | null, roots?: string[]) => { sketch.circles.length = 0; sketch.lines.length = 0; sketch.read(`rulegenRunStart(${budget}, ${JSON.stringify(roots ?? null)})`); sketch.draw(); return JSON.parse(JSON.stringify(sketch.read("rulegenRunEnd()"))); };
  sketch.draw(); assert.equal(sketch.read("rulegenRun"), null);
  type Step = { index: number; kind: string; label: string; data: { fsm: string; node: string; property?: string; value?: unknown; reads?: unknown } };
  const all = record(null, ["tree"]) as { total: number; events: Step[] }, steps = runSteps(all);
  // The tree's implicit state with its two constraints in order, then the orb's idle state with its size.
  assert.deepEqual(steps.map(event => [event.data.fsm, event.data.node, event.data.property ?? ""]),
    [["state", "tree", ""], ["constraint", "tree", "branches"], ["constraint", "tree", "color"], ["state", "orb", ""], ["constraint", "orb", "size"]]);
  assert.deepEqual(steps[4].data.value, 48, "a constraint step carries the value it stored"); assert.deepEqual(steps[4].data.reads, { "orb/radius": 24 }, "and the params it read");
  assert.deepEqual(fsmVisits(all).map(visit => [visit.start, visit.steps]), [[0, [0, 1, 2]], [3, [3, 4]]], "two state machine steps");
  assert.deepEqual(keySteps(all), [0, 3, 5], "stepping by state machine step stops where each starts");
  assert.equal(fsmName(scene, steps[1].data)!.name, "Tree · Default · branches"); assert.equal(fsmName(scene, steps[3].data)!.name, "Orb · 대기");
  assert.equal(fsmName(scene, steps[4].data)!.explain, "반지름의 두 배");
  assert.equal(record(null, ["somewhere-else"]).total, 0, "only the brush explored is recorded; other brushes draw as usual");
  const frame = (done: number) => ({ base: { runtime, values: {}, steps: [] }, progress: done / steps.length, result: { axis: "run" } as ExploreResult });
  assert.equal(exploreStep(frame(1)).budget, null, "before the run is recorded: all of it (to record it)");
  record(exploreStep(frame(3), all).budget, ["tree"]); assert.deepEqual([sketch.lines.length, sketch.circles.length], [5, 0], "the tree's state machine step: its branches drawn, the orb not yet");
  record(exploreStep(frame(0), all).budget, ["tree"]); assert.deepEqual([sketch.lines.length, sketch.circles.length], [0, 0], "no step yet");
  record(null, ["tree"]); assert.equal(sketch.circles.length, 1);
  // As overlays read it: the step just executed, the next one (what it is, as numbers), every step.
  const stores = runStores(all, 3);
  const next = stores[NEXT_ROOT] as { step: number; none: number; total: number; is: Record<string, number> }, last = stores[LAST_ROOT] as { step: number; is: Record<string, number> };
  assert.deepEqual([last.step, last.is, next.step, next.none, next.total], [2, { constraint: 1, "ink-wash": 1, color: 1 }, 3, 0, 5]);
  assert.deepEqual(next.is, { state: 1, idle: 1 });
  assert.equal(evaluate("s(\"@last\", \"is.color\") && !s(\"@next\", \"is.color\")", { values: {}, stores, states: {}, step: 0, steps: 1 }), 1);
  assert.equal((runStores(all, 0)[LAST_ROOT] as { none: number }).none, 1, "nothing executed yet");
  assert.deepEqual((stores[STEPS_ROOT] as { done: number }[]).map(step => step.done), [1, 1, 1, 0, 0]);
  assert.deepEqual(stageCounts(all, 4).get(stepOp(all, 4)), { count: 1, done: 0, first: 4 });
  // Without FSM steps the drawing calls are the steps.
  assert.deepEqual(exploreStep(frame(1), { total: 2, events: [{ index: 0, kind: "circle" }, { index: 1, kind: "line" }] }).budget, 0);
  const code = readFileSync("app/components/code-preview.tsx", "utf8");
  assert.match(code, /if\(running\)rulegenRunStart\(pinnedRun\.budget,pinnedRun\.roots,pinnedRun\.show,\{focus:pinnedRun\.focus,solo:pinnedRun\.solo\}\);try\{forceRender=true;p\.redraw\(\);reportDrawn\(running\?rulegenRunEnd\(\):null\);/, "the held moment is drawn as a run");
  assert.match(readFileSync("app/routes/home.tsx", "utf8"), /progress: found\.axis === "run" \? 0 : found\.to/, "a run starts with no step executed");
});

test("edits only wrap (inner terms, decisions, runtime state); checkpoints and anything else are dropped by the server", async () => {
  assert.equal(withoutTraces("a(); m.trace(\"x (\" + f(1), { p: [1, 2] }); b();"), "a();  b();");
  assert.ok(!traceOnly({ find: "for (const f of fs) draw(f);", replace: "for (const f of fs) { m.trace(`f ${f.i}`, { x: f.x }); draw(f); }" }), "no checkpoints: the steps are the state machine steps");
  assert.ok(traceOnly({ find: "draw(f.x + f.vx);", replace: "draw(f.x + m.term(\"drift\", f.vx));" }), "an inner term");
  assert.ok(!traceOnly({ find: "draw(f);", replace: "draw(f);" }), "nothing added");
  // Wrappers the code already has (an inspection's m.runtime records) stay as they are.
  const kept0 = "for (const it of items) { const c = m.runtime(\"center\", it.id, { x: it.x, y: it.y }); draw(c.x + it.vx); }";
  assert.ok(traceOnly({ find: kept0, replace: kept0.replace("it.vx", "m.term(\"drift\", it.vx)") }), "a term beside an m.runtime the code has");
  assert.ok(!traceOnly({ find: kept0, replace: kept0.replace("m.runtime(\"center\", it.id, { x: it.x, y: it.y })", "{ x: it.x, y: it.y }").replace("it.vx", "m.term(\"drift\", it.vx)") }), "a wrapper the code has may not go");
  const term = { nodeId: "orb", find: "p.stroke(tree.color);", replace: "p.stroke(m.term(\"ink\", tree.color));" };
  const trace = { nodeId: "orb", find: "p.stroke(tree.color);", replace: "p.stroke(tree.color); m.trace(\"색 정하기\", { op: 1, x: 1, y: 2 });" };
  const changed = { nodeId: "orb", find: "p.stroke(tree.color);", replace: "p.stroke(\"red\");" };
  const kept = await explore({ axis: "run", edits: [term] });
  assert.equal(kept.result.edits.length, 1); assert.equal(kept.result.axis, "run");
  assert.deepEqual((await explore({ axis: "run", edits: [trace] })).result.edits, [], "a checkpoint is dropped");
  assert.deepEqual((await explore({ axis: "run", edits: [changed] })).result.edits, [], "the cause runs the code as it is");
  const prompt = readFileSync("prompts/explore.md", "utf8");
  assert.match(prompt, /GOING THROUGH ITS EXECUTION STEP BY STEP/); assert.match(prompt, /`sketches`: always `\[\]`/); assert.match(prompt, /`stages`: always `\[\]`/);
  assert.match(prompt, /a STATE step each time an owner[\s\S]*one CONSTRAINT step per constraint that state computes, IN THE STATE'S ORDER[\s\S]*a TRANSITION step/);
  const stages = [{ op: 1, name: "색 정하기", explain: "e", of: [] }];
  assert.deepEqual((await explore({ axis: "run", edits: [term], stages })).result.stages, [], "steps are named by the brush itself");
});

test("the exploration controls sit under the frame, not over the drawing, and frames placed later leave room for them", async () => {
  const css = readFileSync("app/styles/scene.css", "utf8");
  assert.match(css, /\.explore-bar \{ position: absolute; left: 0; right: 0; top: calc\(100% \+ 14px\);/);
  const { besideFramePosition, EXPLORE_BAR_HEIGHT, FRAME_HEIGHT } = await import("../app/lib/workspace");
  const below = besideFramePosition({ source: { x: 0, y: 0 }, "explore-1": { x: 1040, y: 0 } }, "source");
  assert.ok(below.y >= FRAME_HEIGHT + EXPLORE_BAR_HEIGHT, "not on the controls under the exploration frame");
  assert.equal(besideFramePosition({ source: { x: 0, y: 0 }, "sketch-1": { x: 1040, y: 0 } }, "source").y, FRAME_HEIGHT + 140, "other frames as before");
});

test("a checkpoint guarded by a condition is still a checkpoint (dropped), and a condition on the code itself is a change", () => {
  const guarded = { find: "if(hidden){if(path.length>1)out.push(path);path=[];}", replace: "if(hidden){if(j===0)m.trace(`수풀 ${i+1}`,{op:2});if(path.length>1){out.push(path);}path=[];}" };
  assert.ok(!traceOnly(guarded));
  assert.equal(withoutTraces("a(); if (c) { m.trace('x', {}); } b();"), "a();  b();");
  assert.ok(!traceOnly({ find: "x();", replace: "if (c) x(); m.trace('a', {});" }));
});

test("a constraint step keeps a long computed point list (thinned) and is placed by it; a step with no place sits in the middle", async () => {
  const program = connectScene({ title: "Tree", explanation: "", code: sceneProgram }, sampleScene()).code
    .replace("function computeColor() { return m.v(\"tree/ink\"); }", "function computeColor() { m.v(\"tree/ink\"); return Array.from({ length: 900 }, (_, i) => ({ x: i / 3, y: 5 + i / 1000 })); }")
    .replace("p.stroke(tree.color);", "p.stroke(\"#000\");");
  const sketch = run(program);
  sketch.read("rulegenRunStart(null, null)"); sketch.draw();
  const recorded = JSON.parse(JSON.stringify(sketch.read("rulegenRunEnd()")));
  const step = recorded.events.find((event: { data?: { property?: string } }) => event.data?.property === "color"), removed = step.data.value;
  assert.ok(removed.length <= 201 && removed.length >= 150, `thinned, not dropped (${removed.length})`);
  assert.deepEqual(removed.at(-1), { x: 299.7, y: 5.9 }, "the last point stays, one decimal");
  assert.deepEqual([step.x, step.w], [0, 299.7], "placed by its points");
  const stores = runStores({ total: 1, events: [{ index: 0, kind: "trace", label: "x", data: { op: 1 } }] }, 0);
  assert.deepEqual([(stores[NEXT_ROOT] as { cx: number }).cx, (stores[NEXT_ROOT] as { cy: number }).cy], [450, 300]);
});

test("steps are never run by sketching a mark: the server drops marks", async () => {
  const trace = { nodeId: "orb", find: "p.stroke(tree.color);", replace: "p.stroke(m.term(\"ink\", tree.color));" };
  const sketch = { op: 1, shape: "scribble" as const, x: "s(\"@next\", \"x\")", y: "s(\"@next\", \"y\")", w: "40", h: "40", toX: "", toY: "", path: "", template: [], hint: "Scribble to erase" };
  const marked = await explore({ axis: "run", edits: [trace], stages: [{ op: 1, name: "지우기", explain: "", of: [] }], overlays: [pen], sketches: [sketch] });
  assert.deepEqual(marked.result.sketches, [], "a mark does not run a step: the steps run with the buttons, the keys and pressing a part");
  assert.equal((await explore({ axis: "run", edits: [], overlays: [pen] })).result.axis, "run", "nothing recorded: each drawing call is a step");
  assert.deepEqual((await explore({ axis: "run", edits: [trace], overlays: [pen], sketches: [sketch] })).result.sketches, [], "marks given anyway are dropped");
  assert.doesNotMatch(readFileSync("prompts/explore.md", "utf8"), /#### sketched marks/);
});

test("pressing a part of the picture jumps execution to the step that draws it; pressed again, to the next step that draws there", () => {
  // Three steps: a heart at 100 (drawn by two strokes), a heart at 300, then the first heart drawn again bigger; a background under all.
  const events = [
    { index: 0, kind: "fillRect", label: "", x: 0, y: 0, w: 900, h: 600 },
    { index: 1, kind: "trace", label: "하트 1", x: 100, y: 100, w: 40, h: 40, data: { op: 1 } },
    { index: 2, kind: "stroke", label: "하트 1", x: 100, y: 100, w: 40, h: 40 },
    { index: 3, kind: "stroke", label: "하트 1", x: 110, y: 110, w: 10, h: 10 },
    { index: 4, kind: "trace", label: "하트 2", x: 300, y: 100, w: 40, h: 40, data: { op: 1 } },
    { index: 5, kind: "stroke", label: "하트 2", x: 300, y: 100, w: 40, h: 40 },
    { index: 6, kind: "trace", label: "합치기", x: 90, y: 90, w: 80, h: 80, data: { op: 2 } },
    { index: 7, kind: "stroke", label: "합치기", x: 90, y: 90, w: 80, h: 80 },
  ];
  const run = { total: 8, events };
  const at = stepsAt(run, { x: 115, y: 115 });
  assert.deepEqual(at.map(item => item.done), [1, 3], "the first heart's step, then the step that draws over it");
  assert.equal(at[0].event.index, 3, "the smallest call drawing there");
  assert.deepEqual(stepsAt(run, { x: 320, y: 120 }).map(item => item.done), [2]);
  assert.deepEqual(stepsAt(run, { x: 600, y: 500 }), [], "only the background there: nothing");
  assert.deepEqual(stepsAt(run, { x: 360, y: 120 }).map(item => item.done), [2], "close by: the nearest");
  assert.equal(jumpTarget(at, 0)!.done, 1); assert.equal(jumpTarget(at, 1)!.done, 3, "pressed again: on"); assert.equal(jumpTarget(at, 3)!.done, 1, "then back to the first");
  assert.equal(jumpTarget([], 2), null);
  // Exploring with no checkpoints: the drawing calls are the steps.
  assert.deepEqual(stepsAt({ events: events.filter(event => event.kind !== "trace") }, { x: 320, y: 120 }).map(item => item.done), [4]);
  const frame = readFileSync("app/components/explore-frame.tsx", "utf8");
  assert.match(frame, /◎ Jump to pressed/); assert.match(frame, /goTo\(target\.done\)/);
});

test("an Execution frame says which constraints, states or transitions it runs; parts the brush does not have are dropped", async () => {
  const trace = { nodeId: "orb", find: "p.stroke(tree.color);", replace: "p.stroke(m.term(\"ink\", tree.color));" };
  const pulse = { kind: "constraint" as const, nodeId: "orb", id: "pulse" }, press = { kind: "transition" as const, nodeId: "orb", id: "press" };
  const { result } = await explore({ axis: "run", edits: [trace], overlays: [pen],
    of: [press, press, pulse, { kind: "constraint", nodeId: "orb", id: "ghost" }] });
  assert.deepEqual(result.of, [press, pulse], "only parts the brush has, each once");
  const html = renderToStaticMarkup(createElement((await import("../app/components/explore-frame")).ExploreFrameView, { zoom: 1, specs: {}, onProgress: () => {}, onValue: () => {}, onRetry: () => {}, onActivate: () => {},
    partName: part => part.id === "pulse" ? { name: "size", node: "Orb" } : part.id === "press" ? { name: "원 클릭", node: "Orb" } : null,
    frame: { id: "explore-1", targetFrameId: "sketch-a", brushId: "b", toolId: "t", mode: "execution", name: "n", nodeIds: ["orb"], base: { runtime, values: {}, steps: [] },
      executable: "", status: "ready", error: "", progress: 0, values: {}, result, request: { concern: "c", inspection: targetedResultSchema.parse({ summary: "s", overlays: [] }) } } }));
  assert.match(html, /Part of<\/span><button type="button" class="explore-part transition[^"]*"[^>]*><em>Transition<\/em>원 클릭<\/button><button type="button" class="explore-part constraint[^"]*"[^>]*><em>Constraint<\/em>size/);
  assert.match(html, /click to view in the state machine panel below/); assert.match(html, /click to view in the constraint panel on the right/);
  // Pressed: shown where it is edited (its frame and tool current, its node selected, highlighted in the params or state machine panel).
  const home = readFileSync("app/routes/home.tsx", "utf8");
  assert.match(home, /onPart=\{part => showPart\(explore, part\)\}/);
  assert.match(home, /selectedNodeIds: \[part\.nodeId\],\s*machineTarget: part\.kind === "state" \|\| part\.kind === "transition" \? \{ nodeId: part\.nodeId, kind: part\.kind, id: part\.id \} : null/);
  assert.match(readFileSync("app/components/scene/machine-graph.tsx", "utf8"), /A state or transition picked from elsewhere[^\n]*\n\s*useEffect/, "the state machine panel pans to it");
  // Zoomed in, the board is drawn sharp (not a picture of it stretched): only while it is dragged is it one layer.
  assert.match(readFileSync("app/app.css", "utf8"), /\.world-layer\{position:absolute;inset:0;transform-origin:0 0;pointer-events:none\}\.board-dragging \.world-layer\{will-change:transform\}/);
});

test("Execution frames are saved with the project, with their frame groups and the tools AI made; one being made comes back placed only; old recommendation frames and fork slots are left out", () => {
  const artwork = { strokes: [], photo: null, name: "Original", revision: 0 };
  const inspection = targetedResultSchema.parse({ summary: "s", overlays: [] });
  const kit = { reading: "r", tools: [{ id: "dot", kind: "shape" as const, name: "Dot", hint: "", color: "#2563eb", label: "Dot", closed: true, template: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 100 }], labels: [], handles: [], nodeId: "", specs: [], values: [], patch: null, probe: { x: 0, y: 0, w: 0, h: 0 } }], presets: [], variables: [] };
  const frame: ExploreFrame = { id: "explore-1", targetFrameId: "sketch-a", brushId: "b", toolId: "t", mode: "execution", name: "n", nodeIds: ["orb"],
    base: { runtime, values: { "orb/radius": 24 }, steps: [{ runtime, values: {} }] }, executable: "prepared program", status: "ready", error: "", progress: .4, values: { "orb/radius": 30 },
    result: { summary: "s", axis: "run", from: 0, to: 1, edits: [], overlays: [pen], stages: [], sketches: [], of: [] }, request: { concern: "c", inspection },
    edit: { ...emptyExploreEdit(kit), marks: [[{ x: .1, y: .1 }]] } };
  const loading: ExploreFrame = { ...frame, id: "explore-2", status: "loading", result: null };
  const gone: ExploreFrame = { ...frame, id: "explore-3", targetFrameId: "sketch-gone" };
  const slot = { id: "slot-1", targetFrameId: "sketch-a", brushId: "b", toolId: "t", index: 0, key: "k", title: "t", detail: "d" };
  const old = { ...savedExplore({ ...frame, id: "explore-4" }), mode: "parameters", source: { kind: "recommendation", index: 0, title: "t", key: "k", applied: false } };
  const project = projectSchema.parse(JSON.parse(JSON.stringify({ version: 2, name: "P", artwork, sketchFrames: [{ id: "sketch-a", artwork }], exploreFrames: [frame, loading, gone, old].map(item => "executable" in item ? savedExplore(item as ExploreFrame) : item), forkSlots: [slot, { broken: true }],
    workspace: { frames: { source: { x: 0, y: 0 }, "sketch-a": { x: 1000, y: 0 }, "explore-1": { x: 2000, y: 0 }, "explore-2": { x: 3000, y: 0 }, "explore-3": { x: 4000, y: 0 }, "slot-1": { x: 5000, y: 0 } },
      groups: [{ id: "group-1", title: "Recommendation · t", frames: ["slot-1", "explore-1", "explore-2", "explore-3"] }] } })));
  assert.deepEqual(project.exploreFrames.map(item => item.id), ["explore-1", "explore-2"], "with the frame they were made from; a recommendation's frame saved before is left out, not the project");
  assert.ok(!("forkSlots" in project), "fork slots are gone");
  assert.deepEqual(project.workspace.groups[0].frames, ["explore-1", "explore-2"]); assert.deepEqual(project.workspace.frames["explore-1"], { x: 2000, y: 0 });
  assert.equal(project.workspace.frames["explore-3"], undefined); assert.equal(project.workspace.frames["slot-1"], undefined);
  const [made, placed] = project.exploreFrames.map(restoredExplore);
  assert.equal(made.status, "ready"); assert.equal(made.progress, .4); assert.deepEqual(made.values, { "orb/radius": 30 }); assert.equal(made.result!.overlays[0].id, pen.id);
  assert.equal(made.executable, "", "its program is prepared again");
  assert.deepEqual(made.edit, emptyExploreEdit(kit), "the tools AI made come back; what was drawn is not kept");
  assert.deepEqual(made.base.steps, [], "recorded steps only for a frame that moves through them");
  assert.equal(placed.status, "idle"); assert.equal(placed.result, null);
  const home = readFileSync("app/routes/home.tsx", "utf8");
  assert.match(home, /exploreFrames: exploreRef\.current\.map\(savedExplore\)/); assert.match(home, /setExploreFrames\(data\.exploreFrames\.map\(restoredExplore\)\)/);
  assert.match(home, /executable: executable \?\? syncScene\(owner\.executable, owner\.scene\)/, "prepared again once its frame's result is");
});
