import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { sampleScene, withMockedAI } from "./fixtures/scene";
import { brushesFor, brushNodeIds, brushSource, brushTool, dragGesture, markBrushes, parseBrushTool, type Brush } from "../app/lib/brushes";
import { addStep, historyOverlays, layoutLabels, changedKeys, constraintRows, emptyInspection, evaluate, fillLabel, filterValues, MAX_STEPS, placeOverlays, inspectResultSchema } from "../app/lib/inspection";
import { alongPath, brushPlan } from "../app/studio/brush-actions";
import { updateNode } from "../app/lib/scene/graph";
import { transplantNodes } from "../app/lib/scene/transfer";
import { sceneValues } from "../app/lib/scene/values";
import { requestSchema } from "../app/lib/schema";
import { runAI } from "../app/server/ai.server";
import { projectSchema } from "../app/lib/project";
import { ToolRail } from "../app/components/tool-rail";
import { InspectionPanel } from "../app/components/inspection-panel";
import { InspectionOverlay } from "../app/components/inspection-overlay";

const logDirectory = mkdtempSync(path.join(tmpdir(), "rulegen-brush-"));
const previousLogDirectory = process.env.RULEGEN_AI_LOG_DIR;
process.env.RULEGEN_AI_LOG_DIR = logDirectory;
after(() => { rmSync(logDirectory, { recursive: true, force: true }); if (previousLogDirectory === undefined) delete process.env.RULEGEN_AI_LOG_DIR; else process.env.RULEGEN_AI_LOG_DIR = previousLogDirectory; });
const noop = () => {};
let ids = 0;
const makeBrushes = (scene = sampleScene()) => brushesFor(scene, "sketch-a", [], () => `brush-${++ids}`);

test("every AI-made root collection becomes a brush; tool ids name the brush group", () => {
  const scene = sampleScene(), [brush] = makeBrushes(scene);
  assert.equal(brush.nodeId, "tree"); assert.equal(brush.name, "Tree"); assert.equal(brush.gesture, "stamp");
  assert.deepEqual(brush.scene.nodes.map(node => node.id), ["tree", "orb"], "the brush keeps its members");
  assert.deepEqual(parseBrushTool(brushTool("inspect", brush.id)), { kind: "inspect", brushId: brush.id });
  assert.deepEqual(parseBrushTool(brushTool("targeted", brush.id, "t1")), { kind: "targeted", brushId: brush.id, targetedId: "t1" });
  assert.equal(parseBrushTool(`targeted:${brush.id}`), null, "a targeted tool always names its concern tool");
  assert.deepEqual(brush.targeted, [], "no targeted inspection tool until one is made");
  assert.equal(parseBrushTool("pen"), null); assert.equal(parseBrushTool("semantic"), null);
  const dragging = updateNode(scene, "orb", node => ({ ...node, machine: { ...node.machine!, transitions: [...node.machine!.transitions, { id: "drag-star", from: "idle", to: "moving", label: "별 드래그", trigger: "event", afterMs: 1000 }] } }));
  assert.equal(dragGesture(dragging, "tree"), true, "a drag transition below makes it a drag brush");
  assert.equal(projectSchema.parse({ version: 2, name: "P", artwork: { name: "A", photo: null, strokes: [], revision: 0 }, brushes: [brush] }).brushes[0].id, brush.id);
});

test("stamped copies stay inspectable as the brush; the live source is preferred", () => {
  const scene = sampleScene(), [brush] = makeBrushes(scene);
  const marked = markBrushes(scene, [brush]);
  const source = brushSource(brush, marked);
  const stamped = transplantNodes(source, brush.nodeId, { algorithms: [], nodes: [] }, { x: .5, y: .5 });
  const twice = transplantNodes(source, brush.nodeId, stamped.scene, { x: .2, y: .2 });
  assert.equal(twice.scene.nodes.filter(node => node.brushId === brush.id).length, 2);
  assert.equal(brushNodeIds(twice.scene, brush, "sketch-b").length, 4, "both stamps with their members");
  assert.deepEqual(brushNodeIds(scene, brush, "sketch-a").sort(), ["orb", "tree"], "the source frame by node id");
  assert.deepEqual(brushSource(brush, undefined), brush.scene, "the saved copy when the source is gone");
});

test("a click stamps once, a drag paints stamps along the stroke or drives a drag brush", () => {
  const [brush] = makeBrushes(), path = [{ x: 100, y: 100, t: 0 }, { x: 500, y: 100, t: 400 }, { x: 800, y: 100, t: 700 }];
  assert.deepEqual(brushPlan(brush, brush.scene, [{ x: 10, y: 10, t: 0 }]).stamps.length, 1);
  const stroke = brushPlan(brush, brush.scene, path);
  assert.ok(stroke.stamps.length > 1 && stroke.stamps.length <= 8 && !stroke.replay);
  const drag = brushPlan({ ...brush, gesture: "drag" } as Brush, brush.scene, path);
  assert.equal(drag.stamps.length, 1); assert.equal(drag.replay, true);
  const spaced = alongPath(path, 100, 20);
  for (let i = 1; i < spaced.length; i++) assert.ok(Math.abs(Math.hypot(spaced[i].x - spaced[i - 1].x, spaced[i].y - spaced[i - 1].y) - 100) < 1e-6);
});

test("inspection keeps the newest 20 steps and reports what changed between steps", () => {
  let state = emptyInspection("b");
  for (let i = 0; i < 25; i++) state = addStep(state, { at: i, nodeId: "orb", from: "idle", to: "moving", transitionId: "press", values: { "orb/radius": i < 24 ? 10 : 20, "orb/speed": 1 }, runtime: null });
  assert.equal(state.steps.length, MAX_STEPS);
  assert.equal(state.steps[0].id, 6);
  assert.deepEqual([...changedKeys(state.steps, MAX_STEPS - 1)], ["orb/radius"]);
  const values = filterValues({ ...sceneValues(sampleScene()), "other/x": 1 }, ["orb"]);
  assert.ok(Object.keys(values).every(key => key.startsWith("orb/")));
  assert.ok("orb/@w" in values && "orb/radius" in values);
  assert.deepEqual(constraintRows(sampleScene(), ["orb"]).map(row => [row.key, row.transformation, row.property]), [["orb/radius", "Pulse", "Radius"], ["orb/speed", "Pulse", "Speed"]]);
});

test("overlay expressions read step values safely", () => {
  const values = { "orb/radius": 24, "orb/@x": 400, "orb/@w": 90, "orb/visible": true };
  assert.equal(evaluate("p(\"orb/@x\") + p(\"orb/@w\") / 2 - p('orb/radius')", values), 421);
  assert.equal(evaluate("max(2, min(10, 3)) * -2 + PI * 0", values), -6);
  assert.ok(Number.isNaN(evaluate("p(\"missing\") + 1", values)));
  for (const bad of ["alert(1)", "p(orb)", "constructor", "1 +", "window.top", "\"a\"[0]"]) assert.throws(() => evaluate(bad, values), bad);
  assert.equal(fillLabel("w=${p(\"orb/radius\") * 2}px h=${nope(1)}", values), "w=48px h=?");
  const placed = placeOverlays([
    { id: "a", kind: "rect", x: "p(\"orb/@x\")", y: "10", w: "p(\"orb/radius\")", h: "p(\"orb/radius\")", label: "r=${p(\"orb/radius\")}", color: "#ff0000", link: { kind: "constraint", nodeId: "orb", id: "radius" } },
    { id: "b", kind: "rect", x: "p(\"missing\")", y: "0", w: "1", h: "1", label: "", color: "#00ff00", link: { kind: "state", nodeId: "orb", id: "idle" } },
  ], values);
  assert.deepEqual(placed.map(item => [item.overlay.id, item.x, item.w, item.label]), [["a", 400, 24, "r=24"]]);
});

test("the toolbar shows each brush as a tool group that opens its tools", () => {
  const [brush] = makeBrushes();
  const props = { tool: brushTool("inspect", brush.id), toolsActive: true, pencilOpen: false, color: "#000000", width: 3, opacity: 80, pens: [], activePen: undefined, penSettingsOpen: false,
    busy: false, canAddSketch: true, canUndo: false, canRedo: false, canClear: false, zoom: 1, brushes: [brush], groupTools: {}, openGroup: brush.id } as Record<string, unknown>;
  const html = renderToStaticMarkup(createElement(ToolRail, new Proxy(props, { get: (target, key) => key in target ? target[key as string] : noop }) as never));
  assert.match(html, /aria-label="Tree brush tools" title="Tree · Inspection/, "the group shows the selected tool");
  for (const label of ["Brush", "Inspection", "Inspection annotation"]) assert.match(html, new RegExp(`<span>${label}</span>`));
  assert.doesNotMatch(html, /<span>Targeted inspection<\/span>/, "targeted tools are made from inspection annotations");
  assert.match(html, /Targeted inspection 도구가 여기에 생깁니다/);
  assert.match(html, /Drag drives interaction/);
  const result = { summary: "s", overlays: [], valueFixes: [], recommendations: [] };
  const withTool = { ...brush, targeted: [{ id: "t1", name: "별 크기", concern: "별 크기가 궁금해", marks: [], result }] };
  const selected = renderToStaticMarkup(createElement(ToolRail, new Proxy({ ...props, tool: brushTool("targeted", brush.id, "t1"), brushes: [withTool], onTargetedRemove: noop } as Record<string, unknown>, { get: (target, key) => key in target ? target[key as string] : noop }) as never));
  assert.match(selected, /title="Tree · 별 크기/, "the group shows the selected targeted tool");
  assert.match(selected, /<span>별 크기<\/span>/);
  assert.match(selected, /aria-label="Remove targeted inspection 별 크기"/);
});

test("the inspection panel steps through states, transitions and constraint values", () => {
  const scene = sampleScene(), [brush] = makeBrushes(scene);
  let state = emptyInspection(brush.id);
  state = addStep(state, { at: 0, nodeId: null, from: null, to: null, transitionId: null, values: { "orb/radius": 24, "orb/speed": 0 }, runtime: null });
  state = addStep(state, { at: 1, nodeId: "orb", from: "idle", to: "moving", transitionId: "press", values: { "orb/radius": 80, "orb/speed": 40 }, runtime: { seed: 1, states: {}, stores: {} } });
  const handlers = new Proxy({}, { get: () => noop });
  const html = renderToStaticMarkup(createElement(InspectionPanel, { ...(handlers as object), brush, kind: "inspect", scene, nodeIds: ["tree", "orb"], state: { ...state, cursor: 1 }, busy: false, running: true } as never));
  assert.match(html, /2 \/ 2/);
  assert.match(html, /Reset history/, "the recorded history can be reset");
  assert.match(html, />대기<\/button><span>→<\/span><button[^>]*>이동</);
  assert.match(html, /원 클릭/);
  assert.match(html, /class="changed[^"]*"[^>]*><td><span class="inspection-node">Orb<\/span><span>Pulse · <b>Radius<\/b>/);
  assert.match(html, /\+56/);
  assert.doesNotMatch(html, /YOUR CONCERN/, "the concern box belongs to targeted inspection");
  const annotation = renderToStaticMarkup(createElement(InspectionPanel, { ...(handlers as object), brush, kind: "inspect-annotate", scene, nodeIds: ["tree", "orb"], state: { ...state, marks: [[{ x: .1, y: .1 }]] }, busy: false, running: true } as never));
  assert.match(annotation, /Inspection annotation<\/b>1획 첨부됨/);
  assert.match(annotation, /Create targeted inspection/);
  const result = inspectResultSchema.parse({ summary: "원이 커집니다", valueFixes: [{ key: "orb/radius", stateId: "moving", value: 50, reason: "줄입니다" }], recommendations: [], overlays: [{ id: "r", kind: "rect" as const, x: "10", y: "10", w: "p(\"orb/radius\")", h: "5", label: "r=${p(\"orb/radius\")}", color: "#ff0000", link: { kind: "constraint" as const, nodeId: "orb", id: "radius" } }] });
  const tool = { id: "t1", name: "원 크기", concern: "원 크기가 궁금해", marks: [], result };
  const targeted = renderToStaticMarkup(createElement(InspectionPanel, { ...(handlers as object), brush: { ...brush, targeted: [tool] }, kind: "targeted", targeted: tool, scene, nodeIds: ["tree", "orb"], state, busy: false, running: true } as never));
  assert.match(targeted, /TARGETED INSPECTION/); assert.match(targeted, /원이 커집니다/); assert.match(targeted, /Inspect again/); assert.match(targeted, /Apply/);
  const overlay = renderToStaticMarkup(createElement(InspectionOverlay, { state: { ...state, cursor: 1 }, marks: [], result, liveValues: {}, clickable: true, zoom: 1, onFocus: noop }));
  assert.doesNotMatch(overlay, /<img/, "steps restore the running result, not an image"); assert.match(overlay, /width="80"/); assert.match(overlay, /r=80/);
});

test("targeted inspection asks AI with the brush's constraints and steps, and drops links outside the brush", async () => {
  const scene = sampleScene();
  const output = { summary: "원 크기가 이동 상태에서 커집니다.",
    overlays: [{ id: "size", kind: "rect", x: "p(\"orb/@x\")", y: "p(\"orb/@y\")", w: "p(\"orb/radius\")", h: "p(\"orb/radius\")", label: "w=${p(\"orb/radius\")}", color: "#e0457b", link: { kind: "constraint", nodeId: "orb", id: "radius" } },
      { id: "bogus", kind: "rect", x: "0", y: "0", w: "1", h: "1", label: "", color: "#000000", link: { kind: "state", nodeId: "orb", id: "nope" } }],
    valueFixes: [{ key: "orb/radius", stateId: "moving", value: 50, reason: "줄입니다" }, { key: "orb/nope", stateId: "", value: 1, reason: "" }],
    recommendations: [{ kind: "transition", nodeId: "orb", targetId: "settle", title: "더 천천히", detail: "정착을 늦춥니다", changes: [] }, { kind: "state", nodeId: "orb", targetId: "ghost", title: "x", detail: "", changes: [] }] };
  const inspection = { brushName: "Tree", nodeIds: ["tree", "orb"], cursor: 1, marks: [[{ x: .4, y: .2 }, { x: .5, y: .3 }]],
    constraints: constraintRows(scene, ["tree", "orb"]).map(row => ({ key: row.key, nodeId: row.binding.nodeId, transformationId: row.transformationId, transformation: row.transformation, propertyId: row.binding.path[0], property: row.property, path: row.path, type: row.binding.type })),
    steps: [{ id: 1, nodeId: "orb", from: "idle", to: "moving", transitionId: "press", values: { "orb/radius": 80 }, runtime: { states: { orb: { id: "moving", elapsed: 0 } }, stores: { tree: { ball: { x: 10 } } } } }] };
  await withMockedAI(() => output, async calls => {
    const result = inspectResultSchema.parse(await runAI(requestSchema.parse({ intent: "inspect", scene, image: "data:image/png;base64,AAAA", instruction: "원 크기가 궁금해", inspection }), new AbortController().signal));
    assert.deepEqual(result.overlays.map(item => item.id), ["size"]);
    assert.deepEqual(result.valueFixes.map(item => item.key), ["orb/radius"]);
    assert.deepEqual(result.recommendations.map(item => item.targetId), ["settle"]);
    const context = JSON.parse(calls[0].input[0].content[0].text);
    assert.equal(context.concern, "원 크기가 궁금해");
    assert.deepEqual(context.brushNodes.map((node: { id: string }) => node.id), ["tree", "orb"]);
    assert.equal(context.steps[0].values["orb/radius"], 80);
    assert.equal(context.steps[0].runtime.stores.tree.ball.x, 10, "AI sees the history's runtime state");
    assert.match(calls[0].instructions, /TAILORED to that concern/);
  });
  await withMockedAI(() => output, async calls => {
    await assert.rejects(runAI(requestSchema.parse({ intent: "inspect", scene, inspection: { ...inspection, marks: [] } }), new AbortController().signal), /알고 싶은 점/);
    assert.equal(calls.length, 0);
  });
});

test("the step timeline places steps by time and keeps every mark reachable", async () => {
  const { timelinePositions } = await import("../app/components/inspection-panel");
  const spots = timelinePositions([{ at: 0 }, { at: 1 }, { at: 2 }, { at: 10_000 }]);
  assert.equal(spots[0], 0); assert.equal(spots.at(-1), 1);
  assert.ok(spots[1] - spots[0] >= 1 / 30 - 1e-9 && spots[2] - spots[1] >= 1 / 30 - 1e-9, "close steps are spread apart");
  assert.deepEqual(timelinePositions([{ at: 5 }]), [.5]);
});

test("targeted overlays are rules over the history: each step recomputes them from its values and stores, with conditions, trails and per-item marks", () => {
  const step = (id: number, x: number, state: string, radius: number) => ({ id, at: id * 100, nodeId: "orb", from: null, to: state, transitionId: null, values: { "orb/radius": radius },
    runtime: { seed: 1, states: { orb: { id: state, elapsed: 0 } }, stores: { tree: { ball: { x, y: 50 }, dots: [{ x: 1 }, { x: 2 }, { x: x }] } } } });
  const steps = [step(1, 10, "idle", 20), step(2, 30, "moving", 20), step(3, 60, "moving", 35)];
  const result = inspectResultSchema.parse({ summary: "s", valueFixes: [], recommendations: [], overlays: [
    { id: "ball", kind: "ellipse", x: "s(\"tree\", \"ball.x\")", y: "s(\"tree\", \"ball.y\")", w: "p(\"orb/radius\")", h: "2", label: "dx=${s(\"tree\", \"ball.x\") - 10} d=${delta(\"orb/radius\")}", color: "#ff0000", link: { kind: "state", nodeId: "orb", id: "moving" }, when: "", each: "" },
    { id: "moving", kind: "label", x: "0", y: "0", w: "0", h: "0", label: "moving", color: "#00ff00", link: { kind: "state", nodeId: "orb", id: "moving" }, when: "in(\"orb\", \"moving\") && len(\"tree\", \"dots\") == 3", each: "" },
    { id: "dots", kind: "rect", x: "item(\"x\")", y: "i * 10", w: "1", h: "1", label: "", color: "#0000ff", link: { kind: "state", nodeId: "orb", id: "moving" }, when: "", each: "tree:dots" },
  ] });
  const first = historyOverlays(result.overlays, steps, 0);
  assert.deepEqual(first.filter(item => item.overlay.id === "ball").map(item => [item.x, item.step, item.ghost]), [[60, 2, 2], [30, 1, 1], [10, 0, 0]], "later steps show as ghosts too, farthest first");
  assert.ok(!first.some(item => item.overlay.id === "moving" && !item.ghost), "when hides it at steps where it does not hold");
  const middle = historyOverlays(result.overlays, steps, 1);
  assert.deepEqual(middle.filter(item => item.overlay.id === "ball").map(item => [item.x, item.step, item.ghost, item.label]), [[60, 2, 1, ""], [10, 0, -1, ""], [30, 1, 0, "dx=20 d=0"]], "earlier and later steps around the current one");
  const last = historyOverlays(result.overlays, steps, 2);
  assert.equal(last.at(-1)?.overlay.id, "dots");
  assert.ok(last.some(item => item.overlay.id === "moving" && !item.ghost));
  assert.deepEqual(last.filter(item => item.overlay.id === "dots" && !item.ghost).map(item => [item.x, item.y]), [[1, 0], [2, 10], [60, 20]]);
  assert.deepEqual(last.filter(item => item.overlay.id === "dots" && item.ghost).map(item => [item.x, item.step]), [[10, 0], [30, 1]], "ghosts that would sit on a nearer step's spot are left out");
  // Overlays saved before when/trail/each existed still place.
  assert.equal(placeOverlays([{ id: "old", kind: "rect", x: "1", y: "2", w: "3", h: "4", label: "", color: "#000000", link: { kind: "state", nodeId: "orb", id: "moving" } }], { "orb/radius": 1 }).length, 1);
  assert.equal(evaluate("if(3 > 2, 7, 9) + !0", {}), 8);
});

test("overlay labels never overlap: each takes the first free spot beside its shape, else farther away with a leader, else none", () => {
  const shape = { x: 100, y: 100, w: 40, h: 40 };
  const labels = layoutLabels(Array.from({ length: 6 }, (_, i) => ({ key: `k${i}`, text: `크기 ${i}px`, anchor: { x: 100, y: 96 }, shape })), 12);
  assert.equal(labels.length, 6);
  const box = (label: (typeof labels)[number]) => ({ x: label.x, y: label.y - label.height * .8, w: label.width, h: label.height });
  for (const [i, a] of labels.entries()) for (const b of labels.slice(i + 1)) {
    const p = box(a), q = box(b);
    assert.ok(p.x >= q.x + q.w || q.x >= p.x + p.w || p.y >= q.y + q.h || q.y >= p.y + p.h, `${a.key} and ${b.key} overlap`);
  }
  assert.equal(labels[0].leader, false); assert.ok(labels.some(label => label.leader));
  assert.ok(labels.every(label => label.x >= 0 && label.y - label.height * .8 >= 0));
});
