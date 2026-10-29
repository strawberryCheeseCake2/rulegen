import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { editRuntime, moveValue, parseMove, runtimeTarget, targetPoint } from "../app/lib/runtime-edits";
import { handleGrips, handleProblem, INPUT_ROOT, moveDrag, remapResult, startDrag, stepContext, type InspectionStep, type InspectResult, type Overlay } from "../app/lib/inspection";
import { ExploreFrameView } from "../app/components/explore-frame";
import type { ExploreFrame } from "../app/lib/explore";
import { targetedResultSchema } from "../app/lib/inspection";

const line = (n: number, y = 100) => Array.from({ length: n }, (_, i) => ({ x: 100 + i * 10, y, t: i * 16 }));
const runtime = () => ({ seed: 1, states: {}, stores: { trail: { hearts: [{ id: "a", x: 1, y: 2 }], pos: { x: 50, y: 60 }, speed: 3 } }, history: [{ id: 1, rev: 4, points: line(5, 40), done: true }, { id: 2, rev: 9, points: line(21), done: true }] });
const overlay = (handle: Partial<Overlay["handle"] & object>, extra: Partial<Overlay> = {}): InspectResult["overlays"][number] => ({ id: "o", kind: "rect", name: "", x: "0", y: "0", w: "1", h: "1", label: "", color: "#000000",
  link: { kind: "constraint", nodeId: "trail", id: "x" }, when: "", each: "", ...extra,
  handle: { key: "", gesture: "move", x: "", y: "", pivotX: "", pivotY: "", value: "", hint: "끌어 옮기기", ...handle } });

test("runtime keys name an input point (by index or by fraction of the stroke), a whole gesture, or a store value", () => {
  assert.deepEqual(runtimeTarget("@input:-1:0.5"), { kind: "input", gesture: -1, at: { fraction: .5 } });
  assert.deepEqual(runtimeTarget("@input:0:-1"), { kind: "input", gesture: 0, at: { index: -1 } });
  assert.deepEqual(runtimeTarget("@input:1"), { kind: "input", gesture: 1, at: null });
  assert.deepEqual(runtimeTarget("@store:trail:hearts.-1.pos"), { kind: "store", root: "trail", path: ["hearts", "-1", "pos"] });
  for (const bad of ["@input:x", "@input:0:1.5", "@store:trail", "trail/size"]) assert.equal(runtimeTarget(bad), null, bad);
  assert.deepEqual(parseMove(moveValue(12.345, -4)), { x: 12.3, y: -4 });
  assert.deepEqual(parseMove(3), { x: 0, y: 0 });
});

test("moving an input point bends the stroke around it: it moves fully, its neighbours less, the ends stay, and the gesture gets a new rev", () => {
  const before = runtime(), after = editRuntime(before, { "@input:-1:10": moveValue(0, 30) });
  const points = after.history[1].points;
  assert.equal(points[10].y, 130);
  assert.ok(points[8].y > 100 && points[8].y < 130, "a neighbour follows partly");
  assert.equal(points[0].y, 100); assert.equal(points[20].y, 100);
  assert.notEqual(after.history[1].rev, 9);
  // Only what the key names changes; the recorded step is left as it was.
  assert.equal(after.history[0], before.history[0]);
  assert.equal(before.history[1].points[10].y, 100);
  // A fraction of the length finds the same middle point; the whole gesture moves every point.
  assert.equal(editRuntime(before, { "@input:1:0.5": moveValue(0, 30) }).history[1].points[10].y, 130);
  assert.ok(editRuntime(before, { "@input:0": moveValue(5, 0) }).history[0].points.every((q, i) => q.x === 105 + i * 10));
  // Values that are no runtime keys change nothing.
  assert.equal(editRuntime(before, { "trail/size": 4 }), before);
});

test("a store value is set (a number) or moved (a point), and the grip of a move sits on the point it moves", () => {
  const after = editRuntime(runtime(), { "@store:trail:speed": 7, "@store:trail:pos": moveValue(10, -5), "@store:trail:hearts.-1": moveValue(1, 1), "@store:missing:pos": moveValue(1, 1) });
  assert.equal(after.stores.trail.speed, 7);
  assert.deepEqual(after.stores.trail.pos, { x: 60, y: 55 });
  assert.deepEqual(after.stores.trail.hearts[0], { id: "a", x: 2, y: 3 });
  assert.equal("missing" in after.stores, false);
  assert.deepEqual(targetPoint("@store:trail:pos", after.stores, after.history), { x: 60, y: 55 });
  assert.deepEqual(targetPoint("@input:-1:2", after.stores, after.history), { x: 120, y: 100 });
});

test("a move handle is valid without a value; a non-move handle cannot move the input, and a move needs a runtime key", () => {
  const move = overlay({ key: "@input:-1:0.5" }).handle!;
  assert.equal(handleProblem(move, undefined), null);
  assert.equal(handleProblem({ ...move, key: "@input:-1:${item(\"t\")}" }, undefined), null);
  assert.match(handleProblem({ ...move, gesture: "drag", value: "start + dx" }, undefined) ?? "", /move/);
  assert.equal(handleProblem({ ...move, key: "@store:trail:speed", gesture: "slide", value: "start + dx / 10" }, undefined), null);
  assert.match(handleProblem({ ...move, key: "trail/size" }, { type: "number" }) ?? "", /실행 상태/);
  assert.match(handleProblem({ ...move, key: "@input:nope" }, undefined) ?? "", /실행 상태/);
});

test("the step is looked at with its moved state: move grips sit on their point (per item with ${…} keys) and a drag adds to the offset it had", () => {
  const step: InspectionStep = { id: 1, at: 0, nodeId: null, from: null, to: null, transitionId: null, values: {}, runtime: runtime(), edits: { "@input:-1:10": moveValue(0, 30) } };
  const context = stepContext([step], 0);
  assert.equal((context.stores[INPUT_ROOT] as { points: { y: number }[] }[])[1].points[10].y, 130);
  const [grip] = handleGrips([overlay({ key: "@input:-1:10" })], context);
  assert.deepEqual({ x: grip.x, y: grip.y }, { x: 200, y: 130 });
  const drag = startDrag(grip, { x: 200, y: 130 });
  assert.equal(moveDrag(drag, { x: 210, y: 120 }), "10,20");
  // Each item gets a grip on the input point its key names.
  const each = handleGrips([overlay({ key: "@input:-1:${item(\"at\")}" }, { each: "trail:marks" })], { ...context, stores: { ...context.stores, trail: { marks: [{ at: 2 }, { at: 4 }] } } });
  assert.deepEqual(each.map(item => [item.handle.key, item.x]), [["@input:-1:2", 120], ["@input:-1:4", 140]]);
});

test("a store key follows the brush's shared ids like the other keys of a stored inspection", () => {
  const result = remapResult({ summary: "", overlays: [overlay({ key: "@store:trail:pos" })], valueFixes: [], recommendations: [], parameters: [], records: null }, new Map([["trail", "brush-root"]]));
  assert.equal(result.overlays[0].handle!.key, "@store:brush-root:pos");
});

test("an exploration frame is drawn from its moved input and lists it as a moved path, not as a raw key", () => {
  const frame: ExploreFrame = { id: "explore-1", targetFrameId: "sketch-a", brushId: "b", toolId: "t", mode: "parameters", source: { kind: "cause" }, name: "n", nodeIds: ["trail"],
    base: { runtime: runtime(), values: {}, steps: [], params: {} }, executable: "", status: "ready", error: "", progress: 0, values: { "@input:-1:10": moveValue(12, -3) },
    result: { summary: "", axis: "run", from: 0, to: 1, edits: [], values: [], machine: null, overlays: [overlay({ key: "@input:-1:10" })], stages: [], sketches: [] },
    request: { concern: "c", inspection: targetedResultSchema.parse({ summary: "s", overlays: [], valueFixes: [], recommendations: [] }), recommendation: null } };
  const html = renderToStaticMarkup(createElement(ExploreFrameView, { frame, zoom: 1, specs: {}, labelOf: key => key, expand: key => [key], onProgress: () => {}, onValue: () => {}, onRetry: () => {}, onActivate: () => {} }));
  assert.match(html, /옮긴 입력 경로 <b>12, -3px<\/b>/);
  assert.match(html, /gesture-move/);
  assert.match(html, /cx="212"/, "the grip on the moved point");
});
