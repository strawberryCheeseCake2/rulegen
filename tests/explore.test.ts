import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { run, sampleScene, sceneProgram, withMockedAI } from "./fixtures/scene";
import { connectScene } from "../app/server/scene-code.server";
import { EXEC_KEY, executedRuntime, exploreProgram, exploreResultSchema, exploreStep, inputPath, LAST_ROOT, NEXT_ROOT, PATH_ROOT, previewKeys, gestureRange, runSteps, runStores, stageCounts, stepBlock, STEPS_ROOT, traceOnly, withoutTraces, type ExploreFrame, type ExploreResult } from "../app/lib/explore";
import { emptyInspection, evaluate, targetedResultSchema } from "../app/lib/inspection";
import { addHostParams, readSceneValues } from "../app/lib/scene/machines";
import { requestSchema } from "../app/lib/schema";
import { runAI } from "../app/server/ai.server";

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
  const frame = (progress: number, axis: "input" | "steps") => ({ base: { runtime, values: {}, steps, params: {} }, progress, result: { axis } as ExploreResult });
  assert.deepEqual([0, .5, 1].map(t => exploreStep(frame(t, "steps")).runtime), ["a", "b", "c"]);
  assert.equal(exploreStep(frame(.5, "steps")).values.v, 2);
  assert.equal((exploreStep(frame(.4, "input")).runtime as { history: unknown[] }).history.length, 1);
  assert.equal(exploreStep({ ...frame(.4, "input"), result: null }).runtime, runtime, "before AI answers: the marks as they are");
});

test("a recommendation not applied yet runs as a preview in the frame's own program: edits in the module, its new values in the host block", () => {
  const scene = sampleScene(), code = connectScene({ title: "Tree", explanation: "", code: sceneProgram }, scene).code;
  const result = { edits: [{ nodeId: "orb", find: "p.stroke(m.v(\"tree/ink\"));", replace: "p.stroke(m.v(\"tree/ink\")); const lean = m.v(\"tree/lean\"); p.line(0, 0, lean, lean);" }],
    values: [{ nodeId: "tree", id: "lean", label: "기울기", value: { type: "number" as const, value: 12, min: 0, max: 40, step: 1, unit: "px" } }] };
  assert.deepEqual(previewKeys(scene, result.values[0]), ["tree/lean"]);
  const made = exploreProgram(code, scene, result);
  assert.ok("code" in made);
  assert.equal(readSceneValues(made.code)!.params["tree/lean"], 12);
  const sketch = run(made.code); sketch.draw();
  assert.ok(sketch.lines.some(line => line[2] === 12 && line[3] === 12), "it runs with the new value");
  assert.deepEqual(exploreProgram(code, scene, { ...result, edits: [{ ...result.edits[0], find: "not in the code" }] }), { error: "바꿀 코드 부분을 찾지 못했습니다" });
  assert.equal(readSceneValues(addHostParams(code, { "orb/radius": 999 }))!.params["orb/radius"], 24, "values the scene has stay");
});

type Shown = ExploreResult["overlays"][number];
const pen: Shown = { id: "pen", kind: "ellipse", name: "펜 끝", x: `pathX(p("${EXEC_KEY}")) - 8`, y: `pathY(p("${EXEC_KEY}")) - 8`, w: "16", h: "16", label: "", color: "#e0457b",
  link: { kind: "constraint", nodeId: "orb", id: "radius" }, when: "", each: "",
  handle: { key: EXEC_KEY, gesture: "drag", x: `pathX(p("${EXEC_KEY}"))`, y: `pathY(p("${EXEC_KEY}"))`, pivotX: "", pivotY: "", value: "nearest(hx, hy)", hint: "펜 끝을 끌어 그려 나가기" } };
const radius: Shown = { ...pen, id: "radius", handle: { ...pen.handle!, key: "orb/radius", value: "start + dx" } };
const constraints = [{ key: "orb/radius", nodeId: "orb", transformationId: "pulse", transformation: "Pulse", propertyId: "radius", property: "Radius", path: "", type: "number" }];
const stepInput = { id: 1, nodeId: null, from: null, to: null, transitionId: null, values: { "orb/radius": 24 }, runtime: { states: {}, stores: {} } };
async function explore(mode: "execution" | "parameters", output: Partial<ExploreResult>, recommendation: object | null = null, steps = [stepInput]) {
  const scene = sampleScene(), code = connectScene({ title: "Tree", explanation: "", code: sceneProgram }, scene).code;
  return withMockedAI(() => ({ summary: "펜 끝을 끌어 보세요.", axis: "input", from: 0, to: 1, edits: [], values: [], overlays: [pen], stages: [], sketches: [], ...output }), async calls => {
    const result = exploreResultSchema.parse(await runAI(requestSchema.parse({ intent: "explore", scene, image: "data:image/png;base64,AAAA", instruction: "불꽃이 어떻게 합쳐지는지", previous: code,
      inspection: { brushName: "Tree", nodeIds: ["tree", "orb"], cursor: null, marks: [], constraints, steps },
      explore: { mode, summary: "원인", overlays: [], recommendation, input: { gestures: 2, points: 10 } } }), new AbortController().signal));
    return { result, calls };
  });
}

test("explore AI: execution keeps exactly the execution handle; parameters keeps value handles; nothing to drag is an error", async () => {
  const { result, calls } = await explore("execution", { overlays: [pen, radius], axis: "steps" });
  assert.deepEqual(result.overlays.map(item => [item.id, item.handle?.key ?? null]), [["pen", EXEC_KEY], ["radius", null]], "execution: the gesture runs execution, nothing else");
  assert.equal(result.axis, "input", "steps only with steps to move between");
  assert.match(calls[0].instructions, /UNDERSTAND HOW THE BRUSH WORKS INSIDE by CONTROLLING ITS EXECUTION STEP BY STEP/);
  assert.equal(JSON.parse(calls[0].input[0].content[0].text).mode, "execution");
  const values = await explore("parameters", { overlays: [pen, radius] });
  assert.deepEqual(values.result.overlays.map(item => [item.id, item.handle?.key ?? null]), [["pen", null], ["radius", "orb/radius"]], "parameters: values, never execution");
  await assert.rejects(explore("execution", { overlays: [radius] }), /execution을 조절할 손잡이를 만들지 못했습니다/);
  const narrow = await explore("execution", { from: .5, to: .505 });
  assert.deepEqual([narrow.result.from, narrow.result.to], [0, 1], "a range too narrow to move in is the whole");
});

test("explore AI: a preview only for a recommendation not applied yet, with the new values its code reads; a broken one runs the current code", async () => {
  const edit = { nodeId: "orb", find: "p.stroke(m.v(\"tree/ink\"));", replace: "p.stroke(m.v(\"tree/ink\")); const lean = m.v(\"tree/lean\");" };
  const lean = { nodeId: "tree", id: "lean", label: "기울기", value: { type: "number" as const, value: 12, min: 0, max: 40, step: 1, unit: "px" } };
  const leanHandle: Shown = { ...radius, id: "lean", link: { kind: "parameter", nodeId: "tree", id: "lean" }, handle: { ...radius.handle!, key: "tree/lean" } };
  const recommendation = (applied: boolean) => ({ kind: "transformation", nodeId: "tree", targetId: "branching-growth", targetIds: [], title: "기울이기", detail: "가지를 기울입니다", changes: [], applied });
  const previewed = await explore("parameters", { edits: [edit], values: [lean, { ...lean, id: "unread" }], overlays: [leanHandle] }, recommendation(false));
  assert.equal(previewed.result.edits.length, 1); assert.deepEqual(previewed.result.values.map(value => value.id), ["lean"], "only values the edits read");
  assert.equal(previewed.result.overlays[0].handle?.key, "tree/lean", "a handle on the preview's new value");
  const applied = await explore("parameters", { edits: [edit], values: [lean], overlays: [radius] }, recommendation(true));
  assert.deepEqual([applied.result.edits, applied.result.values], [[], []], "applied: the code already does it");
  const broken = await explore("parameters", { edits: [{ ...edit, find: "nowhere" }], values: [lean], overlays: [radius] }, recommendation(false));
  assert.deepEqual(broken.result.edits, []); assert.match(broken.result.summary, /지금 코드로 보여줍니다/);
  const invalid = await explore("parameters", { edits: [{ ...edit, replace: "p.stroke(m.v(\"tree/ink\")); const = ;" }], values: [], overlays: [radius] }, recommendation(false));
  assert.deepEqual(invalid.result.edits, [], "edited code must parse");
});

test("the inspection panel offers Execution on the cause and both on each recommendation; the frame is wired on the board", async () => {
  const { InspectionPanel } = await import("../app/components/inspection-panel");
  const { brushesFor } = await import("../app/lib/brushes");
  const scene = sampleScene(), [brush] = brushesFor(scene, "sketch-a", [], () => "brush-1"), noop = () => {};
  const result = targetedResultSchema.parse({ summary: "원인 설명", overlays: [], valueFixes: [], recommendations: [{ kind: "value", nodeId: "orb", targetId: "", title: "크기 줄이기", detail: "d", changes: [{ key: "orb/radius", stateId: "", value: 12 }] }] });
  const targeted = { id: "t1", name: "T", concern: "c", marks: [], markStyles: [], result, overlayUpdates: [] };
  const render = (props: object) => renderToStaticMarkup(createElement(InspectionPanel, { brush, kind: "targeted", targeted, scene, nodeIds: ["tree", "orb"], state: emptyInspection(brush.id), busy: false, running: true,
    onCursor: noop, onClear: noop, onFocus: noop, onConcern: noop, onClearMarks: noop, onInspect: noop, onApplyChanges: noop, onApplyRecommendation: noop, onTool: noop, ...props } as never));
  const html = render({ onExplore: noop, exploring: (mode: string, index: number | null) => mode === "parameters" && index === 0 });
  assert.equal(html.match(/Execution 조절해보기/g)?.length, 2, "the cause and the recommendation");
  assert.equal(html.match(/핵심 파라미터 조절해보기/g)?.length, 1, "only the recommendation (the cause's values have handles already)");
  assert.match(html, /핵심 파라미터 조절해보기<small>열림 · 이동<\/small>/, "an open one goes to its frame");
  assert.ok(html.indexOf("원인 설명") < html.indexOf("Execution 조절해보기") && html.indexOf("Execution 조절해보기") < html.indexOf("크기 줄이기"), "the cause's under its explanation");
  assert.doesNotMatch(render({}), /조절해보기/, "nothing without exploration frames");
  const home = readFileSync("app/routes/home.tsx", "utf8");
  assert.match(home, /onExplore=\{openExplore\} exploring=\{exploreOpen\}/);
  assert.match(home, /base: \{ runtime: state\.steps\[at\]\.runtime/, "the frame starts from the brush marks the inspection holds");
  assert.match(home, /executable: syncScene\(owner\.executable, owner\.scene\)/, "its own copy of the program");
  assert.match(home, /closeExploreFrames\(frame => frame\.targetFrameId === id\)/, "it goes with its frame");
  assert.match(readFileSync("app/components/code-preview.tsx", "utf8"), /sentRestore\.current\?\.startsWith\(`\$\{event\.data\.drawnFor\}\|`\)/, "the stores drawn for a held moment reach the overlays");
});

test("the exploration frame draws the held marks with the execution handle and a scrubber", async () => {
  const { ExploreFrameView } = await import("../app/components/explore-frame");
  const frame: ExploreFrame = { id: "explore-1", targetFrameId: "sketch-a", brushId: "b", toolId: "t", mode: "execution", source: { kind: "cause" }, name: "n", nodeIds: ["orb"],
    base: { runtime, values: { "orb/radius": 24 }, steps: [], params: {} }, executable: "", status: "ready", error: "", progress: .7, values: {},
    result: { summary: "펜 끝을 끌어 보세요.", axis: "input", from: 0, to: 1, edits: [], values: [], overlays: [pen], stages: [], sketches: [] },
    request: { concern: "c", inspection: targetedResultSchema.parse({ summary: "s", overlays: [], valueFixes: [], recommendations: [] }), recommendation: null } };
  const noop = () => {};
  const html = renderToStaticMarkup(createElement(ExploreFrameView, { frame, zoom: 1, specs: {}, labelOf: key => key, expand: key => [key], onProgress: noop, onValue: noop, onRetry: noop, onActivate: noop }));
  assert.match(html, /role="slider" aria-label="펜 끝을 끌어 그려 나가기"/); assert.match(html, /aria-label="Execution progress"/); assert.match(html, />70%</);
  assert.match(html, /cx="120"/, "the grip on the pen tip at that progress");
  assert.doesNotMatch(html, /inspection-step-badge|inspection-badge/, "one moment: no step numbers");
});

test("a run of the code is executed step by step: each checkpoint starts a step, and only the steps executed are drawn", () => {
  // Checkpoints go in the frame's own program (like a preview's edits), after the code was generated.
  const program = connectScene({ title: "Tree", explanation: "", code: sceneProgram }, sampleScene()).code.replace("    draw() {", "    draw() {\n      for (let i = 0; i < 3; i++) { m.trace(\"점 \" + i, { op: 1, x: i * 10, y: 5, d: i * 2 }); p.circle(i * 10, 5, 4); }");
  const sketch = run(program);
  const dots = () => sketch.circles.filter(circle => circle[2] === 4).length;
  const record = (budget: number | null, roots?: string[]) => { sketch.circles.length = 0; sketch.read(`rulegenRunStart(${budget}, ${JSON.stringify(roots ?? null)})`); sketch.draw(); return JSON.parse(JSON.stringify(sketch.read("rulegenRunEnd()"))); };
  sketch.circles.length = 0; sketch.draw();
  assert.equal(dots(), 3, "outside a run nothing changes"); assert.equal(sketch.read("rulegenRun"), null);
  const all = record(null, ["tree"]);
  assert.deepEqual(all.events.slice(0, 4).map((event: { kind: string; label: string }) => [event.kind, event.label]), [["trace", "점 0"], ["circle", "점 0"], ["trace", "점 1"], ["circle", "점 1"]]);
  assert.deepEqual([all.events[2].x, all.events[2].y, all.events[2].data.d], [10, 5, 2], "a checkpoint is where its data says, with its state");
  assert.deepEqual([all.events[3].x, all.events[3].y, all.events[3].w], [8, 3, 4], "a drawing call is where it draws");
  assert.equal(record(null, ["somewhere-else"]).total, 0, "only the brush explored is recorded; other brushes draw as usual");
  assert.equal(dots(), 3);
  // Steps: the checkpoints. One step done = everything before the second checkpoint.
  const frame = (done: number) => ({ base: { runtime, values: {}, steps: [], params: {} }, progress: done / 3, result: { axis: "run" } as ExploreResult });
  assert.deepEqual([0, 1, 2, 3].map(done => exploreStep(frame(done), all).budget), [0, 2, 4, null]);
  assert.equal(exploreStep(frame(1)).budget, null, "before the run is recorded: all of it (to record it)");
  record(exploreStep(frame(1), all).budget, ["tree"]); assert.equal(dots(), 1, "step 1: the first dot only");
  record(exploreStep(frame(0), all).budget, ["tree"]); assert.equal(dots(), 0, "no step yet");
  // As overlays read it: the step just executed, the next one, every step, and the path through them.
  const stores = runStores(all, 1);
  const next = stores[NEXT_ROOT] as { step: number; op: number; none: number; cx: number; total: number }, last = stores[LAST_ROOT] as { step: number; none: number };
  assert.deepEqual([last.step, last.none, next.step, next.op, next.none, next.cx, next.total], [0, 0, 1, 1, 0, 10, 3]);
  assert.equal((runStores(all, 0)[LAST_ROOT] as { none: number }).none, 1, "nothing executed yet");
  assert.equal((runStores(all, 3)[NEXT_ROOT] as { none: number }).none, 1, "all executed");
  assert.deepEqual((stores[STEPS_ROOT] as { done: number }[]).map(step => step.done), [1, 0, 0]);
  assert.deepEqual(stores.path.map(point => point.x), [0, 10, 20]);
  assert.deepEqual(stageCounts(all, 2).get(1), { count: 3, done: 2, first: 0 });
  const context = { values: { [EXEC_KEY]: 1 }, stores: { [PATH_ROOT]: stores.path }, states: {}, step: 0, steps: 1 };
  assert.equal(evaluate("nearestStep(19, 4)", context), 3, "pointing at the third dot: three steps executed");
  // Without checkpoints the drawing calls are the steps.
  assert.deepEqual(exploreStep(frame(1), { total: 2, events: [{ index: 0, kind: "circle" }, { index: 1, kind: "line" }] }).budget, 1);
  const code = readFileSync("app/components/code-preview.tsx", "utf8");
  assert.match(code, /if\(running\)rulegenRunStart\(pinnedRun\.budget,pinnedRun\.roots,pinnedRun\.show\);try\{forceRender=true;p\.redraw\(\);reportDrawn\(running\?rulegenRunEnd\(\):null\);/, "the held moment is drawn as a run when asked");
  assert.match(readFileSync("app/routes/home.tsx", "utf8"), /progress: found\.axis === "run" \? 0 : found\.to/, "a run starts with no step executed");
});

test("checkpoint edits only add m.trace calls; the server keeps them for execution and drops anything else outside a preview", async () => {
  assert.equal(withoutTraces("a(); m.trace(\"x (\" + f(1), { p: [1, 2] }); b();"), "a();  b();");
  assert.ok(traceOnly({ find: "for (const f of fs) draw(f);", replace: "for (const f of fs) { m.trace(`f ${f.i}`, { x: f.x }); draw(f); }" }), "braces to hold a checkpoint");
  assert.ok(!traceOnly({ find: "draw(f);", replace: "m.trace(\"x\", {}); drawOther(f);" }), "anything else changed");
  assert.ok(!traceOnly({ find: "draw(f);", replace: "draw(f);" }), "no checkpoint");
  const trace = { nodeId: "orb", find: "p.stroke(m.v(\"tree/ink\"));", replace: "p.stroke(m.v(\"tree/ink\")); m.trace(\"색 정하기\", { op: 1, x: 1, y: 2 });" };
  const changed = { nodeId: "orb", find: "p.stroke(m.v(\"tree/ink\"));", replace: "p.stroke(\"red\");" };
  const kept = await explore("execution", { axis: "run", edits: [trace] });
  assert.equal(kept.result.edits.length, 1); assert.equal(kept.result.axis, "run");
  assert.deepEqual((await explore("execution", { axis: "run", edits: [changed] })).result.edits, [], "the cause runs the code as it is");
  assert.deepEqual((await explore("parameters", { overlays: [radius], edits: [trace] })).result.edits, [], "checkpoints only for execution");
  assert.match(readFileSync("prompts/explore.md", "utf8"), /CONTROLLING ITS EXECUTION STEP BY STEP with metaphoric direct manipulation/);
  assert.match(readFileSync("prompts/explore.md", "utf8"), /give EACH kind of operation \(`stages`\) its OWN way to perform it: a handle \(below\) or a sketched mark/);
  // Every verb its own step and its own gesture (a removal too), shaped by that step's geometry.
  assert.match(readFileSync("prompts/explore.md", "utf8"), /ONE VERB PER STEP[^\n]*REMOVING part of it/);
  assert.match(readFileSync("prompts/explore.md", "utf8"), /the gesture IS the operation's verb, performed with THAT STEP'S geometry/);
  assert.match(readFileSync("prompts/explore.md", "utf8"), /remove \/ cull \/ clip \/ hide \/ skip \/ cut away → throw the part away/);
  assert.match(readFileSync("prompts/explore.md", "utf8"), /DESIGN IT FROM THE CONTEXT[^\n]*never a menu to choose from/, "the verbs are examples: a gesture from what the brush depicts");
  assert.match(readFileSync("prompts/explore.md", "utf8"), /These are examples, not a list to pick from/);
  const stages = [{ op: 1, name: "색 정하기", explain: "e", many: false }, { op: 1, name: "dup", explain: "", many: true }];
  assert.deepEqual(kept.result.stages.map(stage => stage.name), [], "no stages unless given");
  assert.deepEqual((await explore("execution", { axis: "run", edits: [trace], stages })).result.stages.map(stage => stage.name), ["색 정하기"], "one per operation");
  assert.deepEqual((await explore("execution", { axis: "run", edits: [], stages })).result.stages, [], "no checkpoints: no operations to name");
  const perOperation = await explore("execution", { axis: "run", edits: [trace], stages, overlays: [pen, { ...pen, id: "paint" }] });
  assert.deepEqual(perOperation.result.overlays.map(item => item.handle?.key), [EXEC_KEY, EXEC_KEY], "a handle per kind of operation");
});

test("the exploration controls sit under the frame, not over the drawing, and frames placed later leave room for them", async () => {
  const css = readFileSync("app/styles/scene.css", "utf8");
  assert.match(css, /\.explore-bar \{ position: absolute; left: 0; right: 0; top: calc\(100% \+ 14px\);/);
  const { besideFramePosition, EXPLORE_BAR_HEIGHT, FRAME_HEIGHT } = await import("../app/lib/workspace");
  const below = besideFramePosition({ source: { x: 0, y: 0 }, "explore-1": { x: 1040, y: 0 } }, "source");
  assert.ok(below.y >= FRAME_HEIGHT + EXPLORE_BAR_HEIGHT, "not on the controls under the exploration frame");
  assert.equal(besideFramePosition({ source: { x: 0, y: 0 }, "sketch-1": { x: 1040, y: 0 } }, "source").y, FRAME_HEIGHT + 140, "other frames as before");
});

test("one gesture executes one step of its operation (back or on), never on into the next operation", async () => {
  // Stroke 1: orange ×2, yellow ×2; stroke 2: orange ×2, yellow ×1.
  const ops = [1, 1, 2, 2, 1, 1, 2];
  const run = { total: ops.length, events: ops.map((op, index) => ({ index, kind: "trace", label: `${op}`, data: { op } })) };
  assert.deepEqual(stepBlock(run, 0), [0, 2], "stroke 1's orange");
  assert.deepEqual(stepBlock(run, 2), [2, 4], "its yellow: it stops before stroke 2's orange (step 5)");
  assert.deepEqual(stepBlock(run, 3), [2, 4], "partway: back to its first yellow, on to its last");
  assert.deepEqual(stepBlock(run, 4), [4, 6]);
  assert.deepEqual(stepBlock(run, 7), [7, 7], "nothing left");
  // One gesture: one step forward or back, within that run; an operation that is one continuous motion: its whole run.
  assert.deepEqual(gestureRange(run, 2, false), [2, 3], "the first yellow step, nothing more");
  assert.deepEqual(gestureRange(run, 3, false), [2, 4], "back one, or on one");
  assert.deepEqual(gestureRange(run, 0, true), [0, 2], "many: anywhere in its own run");
  const view = readFileSync("app/components/explore-frame.tsx", "utf8");
  assert.match(view, /block\.current = stepwise && run \? \{ range: gestureRange\(run, done, many\), start: done, many, latched: null \} : null/, "fixed when the drag starts");
  assert.match(view, /const target = Math\.max\(drag\.range\[0\], Math\.min\(drag\.range\[1\],/, "the drag is kept within it");
});

test("a checkpoint may be guarded by a condition, and steps of an operation whose checkpoints were dropped are not offered", async () => {
  // As the bush's removal step was written: taken only at the start of a hidden stretch.
  const guarded = { find: "if(hidden){if(path.length>1)out.push(path);path=[];}", replace: "if(hidden){if(j===0||!items.some((z,k)=>k!==i))m.trace(`수풀 ${i+1}: 안쪽 윤곽 ${x?'a':'b'}`,{op:2,x,y});if(path.length>1){m.trace(`보존`,{op:3});out.push(path);}path=[];}" };
  assert.ok(traceOnly(guarded), "if (…) m.trace(…) and a body given braces for one");
  assert.equal(withoutTraces("a(); if (c) { m.trace('x', {}); } b();"), "a();  b();");
  assert.ok(!traceOnly({ find: "x();", replace: "if (c) x(); m.trace('a', {});" }), "a condition on the code itself is a change");
  const stages = [{ op: 1, name: "윤곽 검사", explain: "", many: false }, { op: 2, name: "안쪽 윤곽 제외", explain: "", many: false }];
  const trace = { nodeId: "orb", find: "p.stroke(m.v(\"tree/ink\"));", replace: "p.stroke(m.v(\"tree/ink\")); m.trace(\"검사\", { op: 1, x: 1, y: 2 });" };
  const { result } = await explore("execution", { axis: "run", edits: [trace, { ...trace, find: "nowhere" }], stages });
  assert.deepEqual(result.stages.map(stage => stage.name), ["윤곽 검사"], "only operations with checkpoints");
  assert.match(result.summary, /「안쪽 윤곽 제외」 단계는 코드에 넣지 못해 빠졌습니다/);
});

test("a hand still settling is no step, and a gesture that cannot measure itself goes one step forward", () => {
  const view = readFileSync("app/components/explore-frame.tsx", "utf8");
  assert.match(view, /!motion \|\| motion\.moved < STEP_SLOP \? drag\.start : motion\.reach < STEP_SLOP \? drag\.start \+ 1 : Number\(value\)/);
  assert.match(readFileSync("app/components/inspection-overlay.tsx", "utf8"), /reach: current\.grip\.handle\.gesture === "drag" \? Infinity : Math\.hypot\(drag\.sx - drag\.px, drag\.sy - drag\.py\)/);
  assert.match(readFileSync("prompts/explore.md", "utf8"), /THE GESTURE MUST BE MEASURABLE ON EVERY STEP/);
});

test("checkpoint data keeps long point lists (thinned), every step has a grip, and a drag does one step and keeps it", async () => {
  const program = connectScene({ title: "Tree", explanation: "", code: sceneProgram }, sampleScene()).code.replace("    draw() {", "    draw() {\n      m.trace(\"제외\", { op: 2, removed: Array.from({ length: 900 }, (_, i) => ({ x: i / 3, y: 5 + i / 1000 })) });");
  const sketch = run(program);
  sketch.read("rulegenRunStart(null, null)"); sketch.draw();
  const recorded = JSON.parse(JSON.stringify(sketch.read("rulegenRunEnd()")));
  const removed = recorded.events[0].data.removed;
  assert.ok(removed.length <= 201 && removed.length >= 150, `thinned, not dropped (${removed.length})`);
  assert.deepEqual(removed.at(-1), { x: 299.7, y: 5.9 }, "the last point stays, one decimal");
  assert.deepEqual([recorded.events[0].x, recorded.events[0].w], [0, 299.7], "placed by its points");
  // A step with no place: its grip is in the middle of the canvas.
  const stores = runStores({ total: 1, events: [{ index: 0, kind: "trace", label: "x", data: { op: 1 } }] }, 0);
  assert.deepEqual([(stores[NEXT_ROOT] as { cx: number }).cx, (stores[NEXT_ROOT] as { cy: number }).cy], [450, 300]);
  const view = readFileSync("app/components/explore-frame.tsx", "utf8");
  assert.match(view, /!mark\s*&& !handleGrips\(result\.overlays, context\)\.some\(grip => grip\.handle\.key === EXEC_KEY\)/, "a plain grip when the next step has none");
  assert.match(view, /if \(drag\.latched !== null\) return;/); assert.match(view, /if \(!drag\.many && target !== drag\.start\) drag\.latched = target;/, "one step per drag, kept");
});

test("a step can draw the brush as it is after it (code that draws only at the end changes the picture at every step)", () => {
  // Collect first, draw once at the end: without pictures nothing changes until the last step.
  const program = connectScene({ title: "Tree", explanation: "", code: sceneProgram }, sampleScene()).code.replace("    draw() {", `    draw() {
      const kept = [];
      for (let i = 0; i < 3; i++) { m.trace("조각 " + i + " 보존", { op: 1, x: i * 10, y: 5 }, () => { for (const k of kept.concat([i])) p.circle(k * 10, 5, 7); }); kept.push(i); }
      for (const k of kept) p.circle(k * 10, 5, 4);`);
  const sketch = run(program);
  const shown = (budget: number | null, show: number | null) => { sketch.circles.length = 0; sketch.read(`rulegenRunStart(${budget}, ["tree"], ${show})`); sketch.draw(); const recorded = JSON.parse(JSON.stringify(sketch.read("rulegenRunEnd()")));
    return { recorded, pictured: sketch.circles.filter(circle => circle[2] === 7).map(circle => circle[0]), inked: sketch.circles.filter(circle => circle[2] === 4).length }; };
  type Recorded = { total: number; events: { index: number; kind: string; label: string; shows?: boolean }[] };
  const full = shown(null, null) as { recorded: Recorded; pictured: number[]; inked: number };
  assert.deepEqual([full.pictured, full.inked], [[], 3], "all of it: the code's own drawing only");
  const steps = runSteps(full.recorded);
  assert.equal(steps.length, 3); assert.ok(steps.every(step => step.shows));
  // Two steps done: the second checkpoint's picture, as it was then (pieces 0 and 1), nothing of the end.
  const two = shown(steps[2].index, 1);
  assert.deepEqual([two.pictured, two.inked], [[0, 10], 0]);
  assert.equal(two.recorded.total, full.recorded.total, "the picture is not part of the run (steps stay the same)");
  assert.match(readFileSync("app/components/explore-frame.tsx", "utf8"), /show: pictured/);
  assert.match(readFileSync("prompts/explore.md", "utf8"), /THE BRUSH MARKS THEMSELVES CHANGE AT EVERY STEP/);
});

test("a step can be performed by sketching its mark: many kinds of marks are recognized where the step is", async () => {
  const { recognizeMark } = await import("../app/lib/sketch-gestures");
  const area = { x: 100, y: 100, w: 80, h: 80 };
  const line = (ax: number, ay: number, bx: number, by: number, n = 12) => Array.from({ length: n }, (_, i) => ({ x: ax + (bx - ax) * i / (n - 1), y: ay + (by - ay) * i / (n - 1) }));
  const loop = (cx: number, cy: number, r: number) => Array.from({ length: 30 }, (_, i) => ({ x: cx + r * Math.cos(i / 29 * 2 * Math.PI), y: cy + r * Math.sin(i / 29 * 2 * Math.PI) }));
  const x = (spec: object, strokes: { x: number; y: number }[][]) => recognizeMark({ area, ...spec } as never, strokes);
  // X: two crossing strokes on it.
  assert.equal(x({ shape: "x" }, [line(110, 110, 170, 170)]).ok, false); assert.match(x({ shape: "x" }, [line(110, 110, 170, 170)]).message, /두 번째 획/);
  assert.ok(x({ shape: "x" }, [line(110, 110, 170, 170), line(170, 110, 110, 170)]).ok);
  assert.equal(x({ shape: "x" }, [line(400, 400, 460, 460), line(460, 400, 400, 460)]).ok, false, "somewhere else");
  assert.equal(x({ shape: "x" }, [line(110, 110, 170, 110), line(110, 130, 170, 130)]).ok, false, "not crossing");
  // Circle around it; arrow to where it goes; a cut through it; a tap on it.
  assert.ok(x({ shape: "circle" }, [loop(140, 140, 60)]).ok);
  assert.ok(x({ shape: "arrow", to: { x: 400, y: 140 } }, [line(140, 140, 395, 142)]).ok);
  assert.match(x({ shape: "arrow", to: { x: 400, y: 140 } }, [line(140, 140, 260, 140)]).message, /가야 할 자리까지/);
  assert.ok(x({ shape: "cut" }, [line(60, 140, 230, 140)]).ok); assert.equal(x({ shape: "cut" }, [line(120, 140, 160, 140)]).ok, false, "from outside to outside");
  assert.ok(x({ shape: "tap" }, [[{ x: 140, y: 140 }]]).ok);
  // A check, a scribble, tracing a path.
  assert.ok(x({ shape: "check" }, [[...line(120, 130, 135, 150, 6), ...line(135, 150, 175, 100, 10)]]).ok);
  assert.ok(x({ shape: "scribble" }, [[...line(110, 120, 170, 125, 5), ...line(170, 125, 110, 135, 5), ...line(110, 135, 170, 145, 5), ...line(170, 145, 110, 155, 5), ...line(110, 155, 170, 160, 5)]]).ok);
  const path = line(100, 300, 400, 300, 20);
  assert.ok(x({ shape: "trace", path }, [line(102, 305, 398, 296)]).ok); assert.equal(x({ shape: "trace", path }, [line(102, 305, 200, 300)]).ok, false, "most of the way");
  // Any mark AI draws: a zigzag, at another size, on the area.
  const zigzag = [{ x: 0, y: 0 }, { x: 1, y: 2 }, { x: 2, y: 0 }, { x: 3, y: 2 }, { x: 4, y: 0 }];
  const drawnZigzag = zigzag.map(point => ({ x: 110 + point.x * 15, y: 120 + point.y * 15 })).flatMap((point, i, all) => i ? line(all[i - 1].x, all[i - 1].y, point.x, point.y, 5) : [point]);
  assert.ok(x({ shape: "custom", template: zigzag }, [drawnZigzag]).ok);
  assert.equal(x({ shape: "custom", template: zigzag }, [line(110, 140, 170, 140)]).ok, false, "a different mark");
  // The server keeps a mark only with what its shape needs, for operations of the run.
  const trace = { nodeId: "orb", find: "p.stroke(m.v(\"tree/ink\"));", replace: "p.stroke(m.v(\"tree/ink\")); m.trace(\"지우기\", { op: 1, x: 1, y: 2 });" };
  const sketch = (shape: "x" | "trace" | "custom", more: object = {}) => ({ op: 1, shape, x: "s(\"@next\", \"x\")", y: "s(\"@next\", \"y\")", w: "40", h: "40", toX: "", toY: "", path: "", template: [], hint: "X로 지우기", ...more });
  const kept = await explore("execution", { axis: "run", edits: [trace], stages: [{ op: 1, name: "지우기", explain: "", many: false }], overlays: [radius], sketches: [sketch("x")] });
  assert.deepEqual(kept.result.sketches.map(item => item.shape), ["x"], "a mark alone is enough to perform an operation (no handle needed)");
  assert.deepEqual((await explore("execution", { axis: "run", edits: [trace], overlays: [pen], sketches: [sketch("trace"), sketch("custom")] })).result.sketches, [], "a trace needs its path, a custom mark its shape");
  const view = readFileSync("app/components/explore-frame.tsx", "utf8");
  assert.match(view, /const submit = \(\) => \{ if \(!recognized\?\.ok\) return; setPlaying\(false\); setStrokes\(\[\]\); goTo\(done \+ 1\); \};/, "submitting a recognized mark executes the step");
  assert.match(readFileSync("prompts/explore.md", "utf8"), /`"custom"`: ANY other mark that fits the operation/);
});
