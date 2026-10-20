import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { sampleScene, withMockedAI } from "./fixtures/scene";
import { brushesFor, brushNodeIds, brushRole, brushRoots, brushSource, brushTool, detachedBrush, frameIds, markBrushes, parseBrushTool, sharedIds } from "../app/lib/brushes";
import { addStep, remapResult, resultInFrame, historyOverlays, layoutLabels, changedKeys, constraintRows, emptyInspection, evaluate, fillLabel, filterValues, MAX_STEPS, placeOverlays, inspectResultSchema } from "../app/lib/inspection";
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
  assert.equal(brush.nodeId, "tree"); assert.equal(brush.name, "Tree");
  assert.deepEqual(brush.scene.nodes.map(node => node.id), ["tree", "orb"], "the brush keeps its members");
  assert.deepEqual(parseBrushTool(brushTool("inspect", brush.id)), { kind: "inspect", brushId: brush.id });
  assert.deepEqual(parseBrushTool(brushTool("targeted", brush.id, "t1")), { kind: "targeted", brushId: brush.id, targetedId: "t1" });
  assert.equal(parseBrushTool(`targeted:${brush.id}`), null, "a targeted tool always names its concern tool");
  assert.deepEqual(brush.targeted, [], "no targeted inspection tool until one is made");
  assert.equal(parseBrushTool("pen"), null); assert.equal(parseBrushTool("semantic"), null);
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
  const fallback = brushSource(brush, undefined);
  assert.deepEqual(fallback.nodes.map(node => node.id), brush.scene.nodes.map(node => node.id), "the saved copy when the source is gone");
  assert.equal(fallback.nodes.find(node => node.id === brush.nodeId)?.brushId, brush.id, "and its root carries the brush mark");
});

test("the source frame holds a brush's master, every stamp is an instance; detaching makes it the master of a new brush", () => {
  const scene = sampleScene(), [brush] = makeBrushes(scene), marked = markBrushes(scene, [brush]);
  assert.deepEqual(brushRole(marked, "sketch-a", "orb", [brush]), { brush, rootId: "tree", master: true }, "a member of the master");
  const stamped = transplantNodes(brushSource(brush, marked), brush.nodeId, { algorithms: [], nodes: [] }, { x: .3, y: .3 });
  const member = stamped.ids.get("orb")!;
  assert.deepEqual(brushRole(stamped.scene, "sketch-b", member, [brush]), { brush, rootId: stamped.rootId, master: false });
  assert.equal(brushRole(scene, "sketch-b", "orb", [brush]), null, "the same ids in another frame, without the brush mark, are not the brush");
  const made = detachedBrush(stamped.scene, "sketch-b", stamped.rootId, { ...brush, targeted: [] }, [brush], "brush-new", "");
  assert.equal(made.name, "Tree 2", "a free name"); assert.equal(made.sourceFrameId, "sketch-b"); assert.equal(made.nodeId, stamped.rootId);
  const detached = updateNode(stamped.scene, stamped.rootId, node => ({ ...node, brushId: made.id }));
  assert.deepEqual(brushRole(detached, "sketch-b", member, [brush, made]), { brush: made, rootId: stamped.rootId, master: true });
  assert.deepEqual(brushRoots(detached, brush, "sketch-b"), [], "no longer an instance of the old brush");
});

test("a targeted inspection is kept in shared ids and works on the master and on every instance", () => {
  const scene = sampleScene(), [brush] = makeBrushes(scene), marked = markBrushes(scene, [brush]);
  const result = inspectResultSchema.parse({ summary: "s", overlays: [{ id: "o", kind: "rect", x: "p(\"tree/@x\") + s(\"tree\", \"ball.x\")", y: "0", w: "item(\"r\")", h: "1", label: "r ${p(\"orb/radius\")} ${in('orb', 'idle')}", color: "#ff0000",
    link: { kind: "constraint", nodeId: "orb", id: "radius" }, when: "elapsed(\"orb\") > 0", each: "tree:points", name: "n" }],
    valueFixes: [{ key: "orb/radius", stateId: "", value: 3, reason: "r" }], recommendations: [{ kind: "value", nodeId: "orb", targetId: "radius", title: "t", detail: "d", changes: [{ key: "orb/radius", stateId: "", value: 4 }] }] });
  const first = transplantNodes(brushSource(brush, marked), "tree", sampleScene(), { x: .3, y: .3 });
  const second = transplantNodes(brushSource(brush, marked), "tree", first.scene, { x: .7, y: .7 });
  const frame = second.scene, roots = brushRoots(frame, brush, "sketch-b"), [tree, orb] = [second.ids.get("tree")!, second.ids.get("orb")!];
  assert.equal(roots.length, 2);
  // Made on the second instance, stored in the shared ids (the master's).
  const made = remapResult(resultInFrame(result, [frameIds(frame, second.rootId)]), new Map());
  assert.equal(made.overlays[0].x, `p("${tree}/@x") + s("${tree}", "ball.x")`);
  assert.deepEqual(remapResult(made, sharedIds(frame, roots)), result, "back to the shared ids");
  const shown = resultInFrame(result, roots.map(root => frameIds(frame, root)), 1);
  assert.equal(shown.overlays.length, 2, "drawn on both instances");
  assert.deepEqual(shown.overlays.map(overlay => overlay.id), ["o", "o~2"]);
  assert.equal(shown.overlays[1].label, `r \${p("${orb}/radius")} \${in('${orb}', 'idle')}`);
  assert.equal(shown.overlays[1].each, `${tree}:points`); assert.equal(shown.overlays[1].when, `elapsed("${orb}") > 0`); assert.equal(shown.overlays[1].link.nodeId, orb);
  assert.equal(shown.valueFixes[0].key, `${orb}/radius`, "fixes go to the selected instance");
  assert.equal(shown.recommendations[0].nodeId, orb); assert.equal(shown.recommendations[0].changes[0].key, `${orb}/radius`);
  assert.deepEqual(resultInFrame(result, [frameIds(marked, "tree")]), result, "the master reads it as is");
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
  assert.equal(fillLabel("w=${p(\"orb/radius\") * 2}px", values), "w=48px");
  assert.equal(fillLabel("w=${p(\"orb/radius\") * 2}px h=${nope(1)}", values), "", "a part that cannot be read hides the label (no \"?\")");
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
  assert.doesNotMatch(html, /BRUSH GESTURE/, "a brush adds itself once per frame, then plays: no gesture setting");
  const located = renderToStaticMarkup(createElement(ToolRail, new Proxy({ ...props, brushMaster: () => "Sketch A" } as Record<string, unknown>, { get: (target, key) => key in target ? target[key as string] : noop }) as never));
  assert.match(located, /MASTER.*◆ Sketch A/, "the group says where its master is");
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
    recommendations: [{ kind: "transition", nodeId: "orb", targetId: "settle", targetIds: ["pulse"], title: "더 천천히", detail: "정착을 늦춥니다", changes: [] }, { kind: "state", nodeId: "orb", targetId: "ghost", targetIds: [], title: "x", detail: "", changes: [] },
      { kind: "transformation", nodeId: "tree", targetId: "ink-wash", targetIds: ["branching-growth", "ink-wash", "pulse", "nope"], title: "둘 다", detail: "", changes: [] },
      { kind: "add-transformation", nodeId: "orb", targetId: "", targetIds: [], title: "새로 추가", detail: "속도에 따라 꼬리를 그리는 새 transformation", changes: [] },
      { kind: "add-transformation", nodeId: "elsewhere", targetId: "", targetIds: [], title: "브러시 밖", detail: "", changes: [] }] };
  const inspection = { brushName: "Tree", nodeIds: ["tree", "orb"], cursor: 1, marks: [[{ x: .4, y: .2 }, { x: .5, y: .3 }]],
    constraints: constraintRows(scene, ["tree", "orb"]).map(row => ({ key: row.key, nodeId: row.binding.nodeId, transformationId: row.transformationId, transformation: row.transformation, propertyId: row.binding.path[0], property: row.property, path: row.path, type: row.binding.type })),
    steps: [{ id: 1, nodeId: "orb", from: "idle", to: "moving", transitionId: "press", values: { "orb/radius": 80 }, runtime: { states: { orb: { id: "moving", elapsed: 0 } }, stores: { tree: { ball: { x: 10 } } } } }] };
  await withMockedAI(() => output, async calls => {
    const result = inspectResultSchema.parse(await runAI(requestSchema.parse({ intent: "inspect", scene, image: "data:image/png;base64,AAAA", instruction: "원 크기가 궁금해", inspection }), new AbortController().signal));
    assert.deepEqual(result.overlays.map(item => item.id), ["size"]);
    assert.deepEqual(result.valueFixes.map(item => item.key), ["orb/radius"]);
    assert.deepEqual(result.recommendations.map(item => item.targetId), ["settle", "ink-wash", ""]);
    assert.deepEqual(result.recommendations.map(item => item.targetIds), [[], ["branching-growth"], []], "only other transformations of the same node are kept");
    assert.deepEqual(result.recommendations.map(item => item.kind), ["transition", "transformation", "add-transformation"], "a new transformation may be proposed, on a node of the brush");
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

test("overlays can sit on drawn items: a point list reads as its box, the input history is readable, and AI gets item boxes instead of raw points", async () => {
  const { runtimeForAI, stepContext, pointsBox, INPUT_ROOT } = await import("../app/lib/inspection");
  const outline = (x: number, y: number) => Array.from({ length: 40 }, (_, i) => ({ x: x + 30 + 30 * Math.cos(i / 40 * Math.PI * 2), y: y + 20 + 20 * Math.sin(i / 40 * Math.PI * 2) }));
  const polygons = [outline(100, 300), outline(140, 300), outline(180, 300)];
  const gesture = { points: [{ x: 100, y: 320, t: 0 }, { x: 160, y: 330, t: 40 }, { x: 240, y: 318, t: 90 }], done: true };
  const steps = [{ id: 1, at: 0, nodeId: null, from: null, to: null, transitionId: null, values: { "bush/spacing": 40 }, runtime: { states: {}, stores: { bush: { polygons } }, history: [gesture] } }];
  assert.deepEqual(pointsBox(polygons[0]), { "@x": 100, "@y": 300, "@w": 60, "@h": 40, "@cx": 130, "@cy": 320, "@n": 40 });
  // One rectangle around each drawn bush, wherever it is (not at a fixed spot).
  const overlay = { id: "each-bush", kind: "rect" as const, name: "", x: "item(\"@x\")", y: "item(\"@y\")", w: "item(\"@w\")", h: "item(\"@h\")", label: "", color: "#2563eb", link: { kind: "constraint" as const, nodeId: "bush", id: "spacing" }, when: "", each: "bush:polygons" };
  assert.deepEqual(placeOverlays([overlay], stepContext(steps, 0)).map(item => [item.x, item.y, item.w, item.h]), [[100, 300, 60, 40], [140, 300, 60, 40], [180, 300, 60, 40]]);
  const gap = evaluate("s(\"bush\", \"polygons.1.@cx\") - s(\"bush\", \"polygons.0.@cx\")", stepContext(steps, 0));
  assert.equal(gap, 40, "the gap between two items");
  assert.equal(evaluate(`s("${INPUT_ROOT}", "0.points.@w")`, stepContext(steps, 0)), 140, "the recorded drag path");
  assert.equal(placeOverlays([{ ...overlay, x: "item(\"points.@x\")", y: "item(\"points.@y\")", w: "item(\"points.@w\")", h: "item(\"points.@h\")", each: `${INPUT_ROOT}:` }], stepContext(steps, 0)).length, 1);
  // AI sees where each item is (a box) and the input, small.
  const sent = runtimeForAI(steps[0] as never, ["bush"]) as { stores: Record<string, unknown> };
  assert.deepEqual((sent.stores.bush as { polygons: unknown[] }).polygons[0], { "@x": 100, "@y": 300, "@w": 60, "@h": 40, "@cx": 130, "@cy": 320, "@n": 40, "@points": "…" });
  assert.ok(INPUT_ROOT in sent.stores, "the input history goes too");
  assert.ok(JSON.stringify(sent).length < 1200);
  assert.equal(remapResult({ summary: "s", overlays: [{ ...overlay, each: `${INPUT_ROOT}:` }], valueFixes: [], recommendations: [] }, new Map([["bush", "bush-2"]])).overlays[0].each, `${INPUT_ROOT}:`, "the input root is not a node id");
});

test("per-item values stay readable: records keep their fields for AI, and an each label that is the same for every item is shown once", async () => {
  const { runtimeForAI, stepContext, labelReadsItem } = await import("../app/lib/inspection");
  const outline = Array.from({ length: 30 }, (_, i) => ({ x: 10 + i, y: 20 + (i % 3) }));
  const items = Array.from({ length: 8 }, (_, i) => ({ x: 100 + 60 * i, y: 300, w: 50, h: 30, speed: 100 + 120 * i, tips: 12 - i, poly: outline }));
  const steps = [{ id: 1, at: 0, nodeId: null, from: null, to: null, transitionId: null, values: { "bush/tips": 12, "bush/slow": 100, "bush/fast": 1000 }, runtime: { states: {}, stores: { bush: { items } } } }];
  const sent = (runtimeForAI(steps[0] as never, ["bush"]).stores.bush as { items: unknown[] }).items;
  assert.deepEqual(Object.keys(sent[0] as object), ["x", "y", "w", "h", "speed", "tips", "poly"], "an item record is not mistaken for a path: its fields are seen");
  assert.equal((sent[0] as { poly: { "@n": number } }).poly["@n"], 30, "its outline (bare points) is still sent as a box");
  assert.match(String(sent.at(-1)), /^…\(8 items; all in box @x=100 @y=300 @w=420 @h=0 @cx=310 @cy=300\)$/, "how many, and where they all are");
  // A label reading the item says that item's value; one that does not is the same everywhere: shown once.
  assert.ok(labelReadsItem("잎 끝 ${item(\"tips\")}개")); assert.ok(labelReadsItem("#${i + 1}")); assert.ok(!labelReadsItem("${p(\"bush/slow\")}→${p(\"bush/fast\")}px/s"));
  const overlay = (label: string) => ({ id: "o", kind: "label" as const, name: "", x: "item(\"x\")", y: "item(\"y\")", w: "0", h: "0", label, color: "#2563eb", link: { kind: "constraint" as const, nodeId: "bush", id: "tips" }, when: "", each: "bush:items" });
  assert.deepEqual(placeOverlays([overlay("잎 끝 ${item(\"tips\")}개")], stepContext(steps, 0)).slice(0, 3).map(item => item.label), ["잎 끝 12개", "잎 끝 11개", "잎 끝 10개"]);
  const shared = placeOverlays([overlay("${p(\"bush/slow\")}→${p(\"bush/fast\")}px/s")], stepContext(steps, 0));
  assert.equal(shared.length, 8, "the overlay is still placed on every item");
  assert.deepEqual(shared.map(item => item.label).filter(Boolean), ["100→1000px/s"], "but its item-independent label only once");
});

test("every recorded step keeps a badge on the canvas: steps whose overlay sits at the same spot share one, and clicking it walks through them", async () => {
  const { stepBadges } = await import("../app/lib/inspection");
  // The first item stays put (it is the oldest), so steps 0–2 draw it at the same spot; step 3 moved it.
  const at = (x: number) => ({ states: {}, stores: { bush: { items: [{ x, y: 50 }, { x: 300, y: 50 }] } } });
  const steps = [at(10), at(10), at(10), at(90)].map((runtime, i) => ({ id: i + 1, at: 0, nodeId: null, from: null, to: null, transitionId: null, values: {}, runtime }));
  const overlay = { id: "o", kind: "rect" as const, name: "", x: "item(\"x\")", y: "item(\"y\")", w: "20", h: "20", label: "", color: "#2563eb", link: { kind: "constraint" as const, nodeId: "bush", id: "tips" }, when: "", each: "bush:items" };
  const spot = (item: { x: number; y: number }) => ({ x: item.x, y: item.y });
  const view = (index: number) => stepBadges([overlay], steps as never, index, spot).map(({ steps, shown, next, current }) => ({ steps, shown, next, current }));
  assert.deepEqual(view(1), [{ steps: [0, 1, 2], shown: 1, next: 2, current: true }, { steps: [3], shown: 3, next: 3, current: false }], "the shared badge goes to the next step at that spot");
  assert.deepEqual(view(2)[0], { steps: [0, 1, 2], shown: 2, next: 0, current: true }, "and wraps around");
  assert.deepEqual(view(3)[0], { steps: [0, 1, 2], shown: 2, next: 2, current: false }, "from elsewhere, the nearest of them");
  assert.equal(historyOverlays([overlay], steps as never, 1).filter(item => item.ghost && item.key.endsWith(":0")).length, 1, "(as ghosts, the repeated ones are left out: only step 3's first item)");
});

test("Autocomplete: on request, AI reads the inspection annotation and suggests concerns; one that continues the typed text completes it with Tab", async () => {
  const { concernCompletion } = await import("../app/lib/inspection");
  const scene = sampleScene(), [brush] = makeBrushes(scene);
  const marks = [[{ x: .4, y: .2 }, { x: .5, y: .3 }]];
  const inspection = { brushName: "Tree", nodeIds: ["tree", "orb"], cursor: null, marks, constraints: [], steps: [], markStyles: [{ color: "#e0457b", width: 12, opacity: .6 }] };
  const output = { suggestions: ["가지 끝이 왜 겹치는지 궁금해", "가지 끝 간격이 단계마다 어떻게 바뀌는지 알고 싶어", "가지 끝 간격이 단계마다 어떻게 바뀌는지 알고 싶어"] };
  await withMockedAI(() => output, async calls => {
    const result = await runAI(requestSchema.parse({ intent: "concern", scene, image: "data:image/png;base64,AAAA", instruction: "가지 끝 간격이", inspection }), new AbortController().signal) as { suggestions: string[] };
    assert.deepEqual(result.suggestions, ["가지 끝 간격이 단계마다 어떻게 바뀌는지 알고 싶어", "가지 끝이 왜 겹치는지 궁금해"], "distinct, the one continuing the typed text first");
    const context = JSON.parse(calls[0].input[0].content[0].text);
    assert.equal(context.typed, "가지 끝 간격이"); assert.deepEqual(context.annotationMarks, marks); assert.equal(context.annotationMarkStyles[0].color, "#e0457b");
    assert.deepEqual(context.brushNodes.map((node: { name: string }) => node.name), scene.nodes.map(node => node.name));
    assert.ok(context.brushNodes[0].transformations[0].properties[0].label, "named in the user's terms");
    assert.doesNotMatch(JSON.stringify(context), /"value":/, "no values or code: only what the marked things are");
    assert.match(calls[0].instructions, /reusable tool for one concern/);
  });
  await withMockedAI(() => output, async calls => {
    await assert.rejects(runAI(requestSchema.parse({ intent: "concern", scene, inspection: { ...inspection, marks: [] } }), new AbortController().signal), /Inspection annotation/);
    assert.equal(calls.length, 0, "nothing to read: no AI call");
  });
  assert.equal(concernCompletion("가지 끝 간격이", "가지 끝 간격이 단계마다 바뀌나요"), " 단계마다 바뀌나요");
  assert.equal(concernCompletion("", "가지"), ""); assert.equal(concernCompletion("나무", "가지 끝"), "");
  const props = { brush, kind: "inspect-annotate", scene, nodeIds: ["tree", "orb"], state: { ...emptyInspection(brush.id), marks, concern: "가지 끝 간격이" }, busy: false, running: true,
    suggestions: { items: ["가지 끝 간격이 단계마다 바뀌나요", "가지 끝이 왜 겹치는지 궁금해"], loading: false, error: "" }, onSuggest: noop,
    onCursor: noop, onClear: noop, onFocus: noop, onConcern: noop, onClearMarks: noop, onInspect: noop, onApplyChanges: noop, onApplyRecommendation: noop, onTool: noop };
  const html = renderToStaticMarkup(createElement(InspectionPanel, props as never));
  assert.match(html, /<span class="concern-typed">가지 끝 간격이<\/span><span class="concern-rest"> 단계마다 바뀌나요<\/span>/, "the completion in grey after the typed text");
  assert.match(html, /<kbd>Tab<\/kbd>/); assert.match(html, /class="concern-suggestion ">가지 끝이 왜 겹치는지 궁금해<\/button>/);
  assert.match(html, /class="concern-autocomplete"[^>]*>.*?Autocomplete<\/button>/, "suggestions come only from the Autocomplete button");
  assert.doesNotMatch(html, /type="checkbox"/, "no automatic suggesting");
  const loading = renderToStaticMarkup(createElement(InspectionPanel, { ...props, suggestions: { items: [], loading: true, error: "" } } as never));
  assert.match(loading, /disabled=""[^>]*>.*?Autocompleting…/);
  const nothing = renderToStaticMarkup(createElement(InspectionPanel, { ...props, state: { ...props.state, marks: [], concern: "" }, suggestions: { items: [], loading: false, error: "" } } as never));
  assert.match(nothing, /class="concern-autocomplete" disabled=""/, "nothing marked or typed: nothing to read");
  const empty = renderToStaticMarkup(createElement(InspectionPanel, { ...props, state: { ...props.state, concern: "" } } as never));
  assert.match(empty, /placeholder="가지 끝 간격이 단계마다 바뀌나요"/, "with nothing typed the best suggestion shows as the placeholder (Tab takes it)");
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

test("each recommendation names what it changes; its chip highlights that transformation, constraint or state", () => {
  const scene = sampleScene(), [brush] = makeBrushes(scene), noop = () => {};
  const result = inspectResultSchema.parse({ summary: "s", overlays: [], valueFixes: [], recommendations: [
    { kind: "transformation", nodeId: "tree", targetId: "ink-wash", title: "번짐 줄이기", detail: "d", changes: [] },
    { kind: "value", nodeId: "orb", targetId: "", title: "반지름 줄이기", detail: "d", changes: [{ key: "orb/radius", stateId: "", value: 10 }] },
    { kind: "state", nodeId: "orb", targetId: "moving", title: "이동 다듬기", detail: "d", changes: [] }] });
  const tool = { id: "t1", name: "c", concern: "c", marks: [], result };
  const render = (focus: unknown) => renderToStaticMarkup(createElement(InspectionPanel, new Proxy({ brush: { ...brush, targeted: [tool] }, kind: "targeted", targeted: tool, scene, nodeIds: ["tree", "orb"],
    state: { ...emptyInspection(brush.id), focus }, busy: false, running: true } as Record<string, unknown>, { get: (target, key) => key in target ? target[key as string] : noop }) as never));
  const html = render(null);
  assert.match(html, /class="inspection-target "[^>]*><svg[\s\S]*?<span>Tree<\/span><b>Ink wash<\/b>/, "the transformation and its node");
  assert.match(html, /<span>Orb<\/span><b>[^<]*Radius<\/b>/, "the constraint a value recommendation changes");
  assert.match(html, /<span>Orb<\/span><b>이동<\/b>/, "the state");
  assert.match(render({ kind: "transformation", nodeId: "tree", id: "ink-wash" }), /class="inspection-target focused" aria-pressed="true"/);
});

test("master and instances read apart; editing an instance explains detach; any frame with the brush can be inspected", async () => {
  const { BrushRoleBanner, BrushRoleBadge, DetachDialog } = await import("../app/components/brush-role");
  const [brush] = makeBrushes(), handlers = { onMaster: noop, onDetach: noop, onAdopt: noop, onCancel: noop };
  assert.match(renderToStaticMarkup(createElement(BrushRoleBadge, { role: { brush, master: true } })), /◆<span>Master/);
  const instance = renderToStaticMarkup(createElement(BrushRoleBanner, { ...handlers, role: { brush, rootId: "tree-2", master: false }, nodeName: "Tree", masterFrame: "Sketch A" }));
  assert.match(instance, /◇<span>Instance/); assert.match(instance, /master\(<b>Sketch A<\/b>\)/); assert.match(instance, /Go to master/); assert.match(instance, /Detach as new brush/);
  const orphan = renderToStaticMarkup(createElement(BrushRoleBanner, { ...handlers, role: { brush, rootId: "tree-2", master: false }, nodeName: "Tree", masterFrame: null }));
  assert.match(orphan, /Make master/); assert.doesNotMatch(orphan, /Go to master/);
  assert.doesNotMatch(renderToStaticMarkup(createElement(BrushRoleBanner, { ...handlers, role: { brush, rootId: "tree", master: true }, nodeName: "Tree", masterFrame: "Sketch A" })), /Detach/, "the master has nothing to detach");
  const dialog = renderToStaticMarkup(createElement(DetachDialog, { ...handlers, prompt: { frameId: "f", rootId: "tree-2", brushId: brush.id, nodeName: "Tree", what: "state machine", apply: noop }, brushName: "Tree", masterFrame: "Sketch A" }));
  assert.match(dialog, /<b>state machine<\/b>/); assert.match(dialog, /Detach and create new brush/); assert.match(dialog, /Edit the master in Sketch A/);
  const frames = [{ id: "a", name: "Sketch A", master: true }, { id: "b", name: "Sketch B", master: false }];
  const empty = renderToStaticMarkup(createElement(InspectionPanel, { brush, kind: "inspect", scene: sampleScene(), nodeIds: [], state: emptyInspection(brush.id), busy: false, running: true, frames, frameId: "c", onFrame: noop } as never));
  assert.match(empty, /◆ Sketch A<small>master/); assert.match(empty, /◇ Sketch B<small>instance/);
  const picker = renderToStaticMarkup(createElement(InspectionPanel, { brush, kind: "inspect", scene: sampleScene(), nodeIds: ["tree", "orb"], state: emptyInspection(brush.id), busy: false, running: true, frames, frameId: "b", onFrame: noop, onCursor: noop, onClear: noop, onFocus: noop, onConcern: noop, onClearMarks: noop, onInspect: noop, onApplyChanges: noop, onApplyRecommendation: noop, onTool: noop } as never));
  assert.match(picker, /aria-label="Inspected frame"/); assert.match(picker, /<option value="b" selected="">◇ Sketch B · instance/);
});

test("inspection has its own pane beside Code / State Machine, and the graph highlights the inspected step's state, transition and related states", async () => {
  const { RawCodePanel } = await import("../app/components/raw-code-panel");
  const { MachineGraph } = await import("../app/components/scene/machine-graph");
  const { machineInspection } = await import("../app/lib/inspection");
  const html = renderToStaticMarkup(createElement(RawCodePanel, { code: "p.circle(1,1,1);", sketchName: "A", fileName: "a", onCopy: noop, onError: noop, machinePanel: createElement("div", null, "MACHINE"), inspectionPanel: createElement("div", null, "INSPECTION") }));
  assert.match(html, /class="bottom-panel-split"/); assert.match(html, /<section class="inspection-dock[^"]*" aria-label="Inspection"><div>INSPECTION<\/div>/);
  assert.match(html, /class="bottom-panel-side"/); assert.doesNotMatch(html, /role="tab"[^>]*>[^<]*<svg[^>]*>.*?<\/svg>Inspection</, "no Inspection tab any more");
  assert.match(html, />Code<\/button>.*>State Machine<\/button><\/div>/);
  const scene = sampleScene(), orb = scene.nodes.find(node => node.machine)!, [first, second] = orb.machine!.states;
  const transition = orb.machine!.transitions[0];
  let state = emptyInspection("b");
  state = addStep(state, { at: 0, nodeId: orb.id, from: first.id, to: second.id, transitionId: transition.id, values: {}, runtime: null });
  state = addStep(state, { at: 1, nodeId: "tree", from: null, to: null, transitionId: null, values: {}, runtime: { states: { [orb.id]: { id: first.id, elapsed: 0 } }, stores: {} } });
  const result = inspectResultSchema.parse({ summary: "s", overlays: [{ id: "o", kind: "rect", x: "0", y: "0", w: "1", h: "1", label: "", color: "#000000", link: { kind: "transition", nodeId: orb.id, id: transition.id }, when: `in("${orb.id}", "${second.id}")`, each: "", name: "" }], valueFixes: [], recommendations: [] });
  assert.deepEqual(machineInspection({ ...state, cursor: 0 }, result, orb.id), { state: second.id, from: first.id, transition: transition.id, states: [second.id], transitions: [transition.id] });
  assert.equal(machineInspection(state, null, orb.id).state, first.id, "another node's step: the state this node was in then (from the runtime)");
  const graph = renderToStaticMarkup(createElement(MachineGraph, { machine: orb.machine!, selectedId: null, target: null, runtimeId: "", busy: false, annotating: false, strokes: [], onState: noop, onTransition: noop, onBackground: noop, onStroke: noop, summary: () => "",
    inspected: { state: second.id, from: first.id, transition: transition.id, states: [], transitions: [] } }));
  assert.match(graph, new RegExp(`data-state-id="${second.id}" class="machine-state[^"]*inspected-state`));
  assert.match(graph, new RegExp(`data-state-id="${first.id}" class="machine-state[^"]*inspected-from`));
  assert.match(graph, /machine-transition-edge[^"]*inspected-transition/);
});

test("the inspection annotation eraser removes the marks it passes over, and the panel offers pen / eraser", async () => {
  const { eraseMarks } = await import("../app/lib/inspection");
  const marks = [[{ x: .1, y: .1 }, { x: .2, y: .1 }], [{ x: .8, y: .8 }, { x: .9, y: .9 }]];
  assert.deepEqual(eraseMarks(marks, [{ x: 180, y: 62 }]), [marks[1]], "a pass near any point of a mark erases that whole mark");
  assert.equal(eraseMarks(marks, [{ x: 450, y: 300 }]).length, 2, "far away: nothing erased");
  const [brush] = makeBrushes();
  const html = renderToStaticMarkup(createElement(InspectionPanel, { brush, kind: "inspect-annotate", scene: sampleScene(), nodeIds: ["tree", "orb"], state: { ...emptyInspection(brush.id), marks }, busy: false, running: true, eraser: true, onEraser: noop,
    onCursor: noop, onClear: noop, onFocus: noop, onConcern: noop, onClearMarks: noop, onInspect: noop, onApplyChanges: noop, onApplyRecommendation: noop, onTool: noop } as never));
  assert.match(html, /role="radio" aria-checked="false"[^>]*>.*?Pen<\/button>/); assert.match(html, /role="radio" aria-checked="true" class="active"[^>]*>.*?Eraser<\/button>/);
  assert.match(html, /지울 자국 위를 문지르세요/);
});

test("a transformation recommendation that changes several transformations shows one chip per transformation", () => {
  const scene = sampleScene(), [brush] = makeBrushes(scene);
  const recommendation = { kind: "transformation" as const, nodeId: "tree", targetId: "ink-wash", targetIds: ["branching-growth"], title: "둘 다 바꾸기", detail: "d", changes: [] };
  const tool = { id: "t1", name: "c", concern: "c", marks: [], result: inspectResultSchema.parse({ summary: "s", overlays: [], valueFixes: [], recommendations: [recommendation] }) };
  const html = renderToStaticMarkup(createElement(InspectionPanel, { brush: { ...brush, targeted: [tool] }, kind: "targeted", targeted: tool, scene, nodeIds: ["tree", "orb"], state: { ...emptyInspection(brush.id), focus: { kind: "transformation", nodeId: "tree", id: "branching-growth" } }, busy: false, running: true,
    onCursor: noop, onClear: noop, onFocus: noop, onConcern: noop, onClearMarks: noop, onInspect: noop, onApplyChanges: noop, onApplyRecommendation: noop, onTool: noop } as never));
  const chips = [...html.matchAll(/<button class="inspection-target ?(focused)?" aria-pressed="(true|false)"[^>]*>.*?<b>([^<]*)<\/b><\/button>/g)].map(match => [match[3], match[2]]);
  const labels = Object.fromEntries(scene.nodes[0].transformations.map(item => [item.id, item.label]));
  assert.deepEqual(chips, [[labels["ink-wash"], "false"], [labels["branching-growth"], "true"]], "each chip highlights just its own transformation");
});

test("a recommendation can add a new transformation instead of forcing an unrelated one to change", () => {
  const scene = sampleScene(), [brush] = makeBrushes(scene);
  const recommendation = { kind: "add-transformation" as const, nodeId: "orb", targetId: "", targetIds: [], title: "꼬리 추가", detail: "속도에 따라 꼬리를 그립니다", changes: [] };
  const tool = { id: "t1", name: "c", concern: "c", marks: [], result: inspectResultSchema.parse({ summary: "s", overlays: [], valueFixes: [], recommendations: [recommendation] }) };
  const html = renderToStaticMarkup(createElement(InspectionPanel, { brush: { ...brush, targeted: [tool] }, kind: "targeted", targeted: tool, scene, nodeIds: ["tree", "orb"], state: emptyInspection(brush.id), busy: false, running: true,
    onCursor: noop, onClear: noop, onFocus: noop, onConcern: noop, onClearMarks: noop, onInspect: noop, onApplyChanges: noop, onApplyRecommendation: noop, onTool: noop } as never));
  assert.match(html, /<em>새 Transformation<\/em>꼬리 추가/);
  assert.match(html, /<span>Orb<\/span><b>\+ 새 transformation<\/b>/);
  assert.match(html, />Add with AI<\/button>/);
});

test("an applied new-transformation recommendation reads as the transformation it added, and the overlays are rebuilt for it", async () => {
  const { currentRecommendation, targetedResultSchema } = await import("../app/lib/inspection");
  const { targetedToolSchema } = await import("../app/lib/brushes");
  const scene = sampleScene(), [brush] = makeBrushes(scene), orb = scene.nodes.find(node => node.id === "orb")!, added = orb.transformations[0];
  const listed = { kind: "add-transformation" as const, nodeId: "orb", targetId: "", targetIds: [], title: "꼬리 추가", detail: "속도에 따라 꼬리를 그립니다", changes: [], addedId: added.id };
  // Stored tools from before keep parsing; addedId survives storage and the id translation between frames.
  assert.equal(targetedToolSchema.parse({ id: "t", name: "c", concern: "c", marks: [], result: { summary: "s", overlays: [], valueFixes: [], recommendations: [{ ...listed, addedId: undefined }] } }).result.recommendations[0].addedId, undefined);
  const stored = targetedResultSchema.parse({ summary: "s", overlays: [], valueFixes: [], recommendations: [listed] });
  assert.equal(remapResult(stored, new Map([["orb", "orb-2"]])).recommendations[0].addedId, added.id);
  assert.deepEqual(currentRecommendation(stored.recommendations[0], scene), { ...listed, kind: "transformation", targetId: added.id, targetIds: [] });
  const undone = { ...scene, nodes: scene.nodes.map(node => node.id === "orb" ? { ...node, transformations: node.transformations.slice(1) } : node) };
  assert.equal(currentRecommendation(stored.recommendations[0], undone).kind, "add-transformation", "undone: it is a new transformation again");
  const tool = { id: "t1", name: "c", concern: "c", marks: [], markStyles: [], result: stored };
  const props = { brush: { ...brush, targeted: [tool] }, kind: "targeted", targeted: tool, nodeIds: ["tree", "orb"], state: emptyInspection(brush.id), busy: false, running: true, recommendationKey: (item: { kind: string; title: string }) => `${item.kind}:${item.title}`,
    applied: { past: [{ id: "a", title: "꼬리 추가", key: "add-transformation:꼬리 추가" }], future: [], undoClean: true, redoClean: false },
    onCursor: noop, onClear: noop, onFocus: noop, onConcern: noop, onClearMarks: noop, onInspect: noop, onApplyChanges: noop, onApplyRecommendation: noop, onTool: noop };
  const html = renderToStaticMarkup(createElement(InspectionPanel, { ...props, scene } as never));
  assert.match(html, /<em>Transformation · 추가됨<\/em>꼬리 추가/);
  assert.match(html, new RegExp(`<span>Orb</span><b>${added.label}</b>`), "its chip is the added transformation");
  assert.match(html, />Apply with AI<\/button>/); assert.match(html, /✓ 적용됨 · 위 transformation으로 추가되었습니다/, "still marked as applied");
  assert.match(renderToStaticMarkup(createElement(InspectionPanel, { ...props, scene: undone } as never)), /<em>새 Transformation<\/em>꼬리 추가/);
  // Rebuilding the overlays: AI gets what was applied and the overlays so far.
  const inspection = { brushName: "Tree", nodeIds: ["tree", "orb"], cursor: null, marks: [], constraints: [], steps: [],
    update: { title: "꼬리 추가", detail: "d", nodeId: "orb", transformationId: added.id, summary: "전", overlays: [{ id: "size", kind: "rect", x: "0", y: "0", w: "1", h: "1", label: "", color: "#e0457b", link: { kind: "constraint", nodeId: "orb", id: "radius" } }] } };
  await withMockedAI(() => ({ summary: "후", overlays: [], valueFixes: [], recommendations: [] }), async calls => {
    await runAI(requestSchema.parse({ intent: "inspect", scene, image: "data:image/png;base64,AAAA", instruction: "꼬리가 궁금해", inspection }), new AbortController().signal);
    const context = JSON.parse(calls[0].input[0].content[0].text);
    assert.deepEqual(context.appliedRecommendation, { title: "꼬리 추가", detail: "d", nodeId: "orb", addedTransformationId: added.id });
    assert.equal(context.previousSummary, "전"); assert.deepEqual(context.previousOverlays.map((item: { id: string }) => item.id), ["size"]);
    assert.match(calls[0].instructions, /After a recommendation added a transformation/);
  });
  await withMockedAI(() => ({ summary: "s", overlays: [], valueFixes: [], recommendations: [] }), async calls => {
    await runAI(requestSchema.parse({ intent: "inspect", scene, image: "data:image/png;base64,AAAA", instruction: "c", inspection: { ...inspection, update: null } }), new AbortController().signal);
    assert.equal(JSON.parse(calls[0].input[0].content[0].text).appliedRecommendation, undefined, "a plain inspection has no update");
  });
});

test("inspection annotation marks keep their own color, width and opacity; the pen sets the next ones and the tool panel scrolls", async () => {
  const { addMark, eraseStyledMarks, DEFAULT_MARK_STYLE, markStyleAt } = await import("../app/lib/inspection");
  const red = { color: "#e0457b", width: 20, opacity: .4 };
  let state = { marks: [] as { x: number; y: number }[][], markStyles: [] as typeof red[] };
  state = addMark(state, [{ x: .1, y: .1 }, { x: .2, y: .1 }], DEFAULT_MARK_STYLE);
  state = addMark(state, [{ x: .5, y: .5 }, { x: .6, y: .5 }], red);
  assert.deepEqual(state.markStyles, [DEFAULT_MARK_STYLE, red]);
  assert.deepEqual(markStyleAt([], 3), DEFAULT_MARK_STYLE, "older marks without a style draw as before");
  const { MAX_MARKS } = await import("../app/lib/inspection");
  let many = { marks: [] as { x: number; y: number }[][], markStyles: [] as typeof red[] };
  for (let i = 0; i < MAX_MARKS + 5; i++) many = addMark(many, [{ x: i / 200, y: .5 }], i % 2 ? red : DEFAULT_MARK_STYLE);
  assert.equal(MAX_MARKS, 128); assert.equal(many.marks.length, 128, "an annotation keeps 128 strokes, the oldest go first"); assert.equal(many.marks[0][0].x, 5 / 200);
  const { targetedToolSchema } = await import("../app/lib/brushes");
  assert.equal(targetedToolSchema.parse({ id: "t", name: "c", concern: "c", marks: many.marks, markStyles: many.markStyles, result: { summary: "s", overlays: [], valueFixes: [], recommendations: [] } }).marks.length, 128);
  assert.equal(requestSchema.parse({ intent: "inspect", inspection: { brushName: "b", nodeIds: ["orb"], constraints: [], steps: [], cursor: null, marks: many.marks, markStyles: many.markStyles } }).inspection!.marks.length, 128);
  // A thick mark is erased from further away, and the styles stay with the marks that are left.
  const erased = eraseStyledMarks(state, [{ x: 450, y: 322 }]);
  assert.deepEqual(erased.markStyles, [DEFAULT_MARK_STYLE]);
  assert.equal(eraseStyledMarks(addMark({ marks: [], markStyles: [] }, [{ x: .5, y: .5 }], DEFAULT_MARK_STYLE), [{ x: 450, y: 322 }]).marks.length, 1, "a thin mark is not");
  const scene = sampleScene(), [brush] = makeBrushes(scene), base = emptyInspection(brush.id);
  const overlay = renderToStaticMarkup(createElement(InspectionOverlay, { state: base, marks: state.marks, markStyles: state.markStyles, result: null, liveValues: {}, clickable: false, zoom: 1, onFocus: noop }));
  assert.match(overlay, /stroke:#e0457b;stroke-width:20;opacity:0.4/);
  const panel = renderToStaticMarkup(createElement(InspectionPanel, { brush, kind: "inspect-annotate", scene, nodeIds: ["tree", "orb"], state: base, busy: false, running: true, onEraser: noop, eraser: false, pen: red, onPen: noop,
    onCursor: noop, onClear: noop, onFocus: noop, onConcern: noop, onClearMarks: noop, onInspect: noop } as never));
  assert.match(panel, /aria-label="Pen width"[^>]*value="20"/); assert.match(panel, /40%/); assert.match(panel, /aria-pressed="true" class="active" style="background:#e0457b"/);
  const props = { tool: brushTool("inspect", brush.id), toolsActive: true, pencilOpen: false, color: "#000000", width: 3, opacity: 80, pens: [], activePen: undefined, penSettingsOpen: false,
    busy: false, canAddSketch: true, canUndo: false, canRedo: false, canClear: false, zoom: 1, brushes: [brush], groupTools: {}, openGroup: brush.id } as Record<string, unknown>;
  assert.match(renderToStaticMarkup(createElement(ToolRail, new Proxy(props, { get: (target, key) => key in target ? target[key as string] : noop }) as never)), /class="brush-group-body"><div class="brush-group-tools">/, "the group panel's tools sit in a scrolling body");
});
