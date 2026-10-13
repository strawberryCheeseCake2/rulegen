import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { num, sampleScene, withMockedAI } from "./fixtures/scene";
import { runAI } from "../app/server/ai.server";
import { machineRefineResultSchema, requestSchema } from "../app/lib/schema";
import { bezier, machineLayout, machineMarks, machineSnapshotSvg, strokeTargets } from "../app/lib/scene/machine-layout";
import { NodeMachinePanel } from "../app/components/scene/node-machine-panel";
import { emptyMachineDraft } from "../app/lib/sketch-panels";

const logDirectory = mkdtempSync(path.join(tmpdir(), "rulegen-machine-refine-"));
const previousLogDirectory = process.env.RULEGEN_AI_LOG_DIR;
process.env.RULEGEN_AI_LOG_DIR = logDirectory;
after(() => { rmSync(logDirectory, { recursive: true, force: true }); if (previousLogDirectory === undefined) delete process.env.RULEGEN_AI_LOG_DIR; else process.env.RULEGEN_AI_LOG_DIR = previousLogDirectory; });
const image = "data:image/png;base64,AAAA";
const signal = () => new AbortController().signal;
const orbMachine = () => sampleScene().nodes.find(node => node.id === "orb")!.machine!;

test("annotation strokes on the graph name the states and transitions they touch", () => {
  const layout = machineLayout(orbMachine());
  const idle = layout.states.find(state => state.id === "idle")!, press = layout.edges.find(edge => edge.id === "press")!;
  assert.deepEqual(strokeTargets(layout, [{ x: idle.x + 20, y: idle.y + 20 }, { x: idle.x + 60, y: idle.y + 30 }]), ["state idle 「대기」"]);
  assert.ok(strokeTargets(layout, [press.labelPoint, { x: press.labelPoint.x + 4, y: press.labelPoint.y }]).includes("transition press 「원 클릭」"));
  assert.deepEqual(strokeTargets(layout, [{ x: 5000, y: 5000 }, { x: 5010, y: 5010 }]), []);
  const marks = machineMarks(layout, [[{ x: -40, y: 10 }, { x: 900, y: 300 }]]);
  for (const point of marks[0].points) { assert.ok(point.x >= 0 && point.x <= 1); assert.ok(point.y >= 0 && point.y <= 1); }
  const svg = machineSnapshotSvg(layout, [[{ x: 10, y: 10 }, { x: 40, y: 40 }]], { kind: "transition", id: "press" });
  assert.match(svg, /<polyline/);
  assert.match(svg, /stroke="#e07b00"/, "the attached transition is highlighted");
  assert.match(machineSnapshotSvg(machineLayout({ ...orbMachine(), states: orbMachine().states.map(state => ({ ...state, label: "<b>&" })) }), [], null), /&lt;b&gt;&amp;/);
});

test("the refine composer shows what is attached and the annotation", () => {
  const scene = sampleScene(), node = scene.nodes.find(item => item.id === "orb")!;
  const noop = () => {};
  const render = (target: { kind: "state" | "transition"; id: string } | null, strokes = 0) => renderToStaticMarkup(createElement(NodeMachinePanel, {
    scene, node, editingStateId: null, runtimeStateId: null, playing: true, busy: false, hasCode: true, target,
    draft: { ...emptyMachineDraft("orb"), open: true, strokes: Array.from({ length: strokes }, () => [{ x: 1, y: 1 }, { x: 2, y: 2 }]) },
    onSelectNode: noop, onState: noop, onTransition: noop, onClearTarget: noop, onGenerate: noop, onDraft: noop, onRefine: noop, onError: noop, onPlay: noop, onRestart: noop, onEvent: noop }));
  const transition = render({ kind: "transition", id: "press" }, 2);
  assert.match(transition, /Transition<\/b>원 클릭 첨부됨/);
  assert.match(transition, /Annotation<\/b>2획 첨부됨/);
  assert.match(transition, /Refine transition/);
  assert.match(transition, /selected-transition/);
  assert.match(render({ kind: "state", id: "moving" }), /State<\/b>이동 첨부됨/);
  assert.match(render(null), /첨부 없음 · 상태 머신 전체를 다듬습니다/);
});

test("machine-refine sends the attached item, graph image and annotation, and returns the updated Compose prompt", async () => {
  const scene = sampleScene(), machine = orbMachine();
  const refined = { initialState: "idle", states: [
    ...machine.states.map(state => ({ ...state, values: state.values.map(value => ({ propertyId: value.propertyId, value: value.value })) })),
    { id: "bounce", label: "튕김", description: "놓으면 튕기듯 돌아옵니다", values: [{ propertyId: "radius", value: num(60, 10, 140, 1, "px") }] },
  ], transitions: [...machine.transitions.filter(item => item.id !== "settle"), { id: "settle", from: "moving", to: "bounce", label: "정착 전 튕김", trigger: "after", afterMs: 600 }, { id: "bounce-done", from: "bounce", to: "idle", label: "튕김 완료", trigger: "after", afterMs: 500 }] };
  const prompt = "- 화면 가운데에 원을 그려줘.\n- 원을 클릭하면 오른쪽으로 움직였다가 튕기듯 돌아오게 해줘.";
  const marks = [{ points: [{ x: .2, y: .2 }, { x: .4, y: .3 }], targets: ["transition settle 「정착 후 대기」"] }];
  await withMockedAI(() => ({ algorithms: [], machine: refined, composePrompt: prompt }), async calls => {
    const result = machineRefineResultSchema.parse(await runAI(requestSchema.parse({ intent: "machine-refine", scene, targetNodeId: "orb", image, machineImage: image, machineMarks: marks,
      machineTarget: { kind: "transition", id: "settle" }, instruction: "정착하기 전에 한 번 튕기게", composePrompt: "- 화면 가운데에 원을 그려줘." }), signal()));
    const orb = result.scene.nodes.find(node => node.id === "orb")!.machine!;
    assert.deepEqual(orb.states.map(state => state.id), ["idle", "moving", "bounce"]);
    assert.equal(result.composePrompt, prompt);
    const context = JSON.parse(calls[0].input[0].content[0].text);
    assert.deepEqual(context.attached, { kind: "transition", ...machine.transitions.find(item => item.id === "settle") });
    assert.deepEqual(context.annotationMarks, marks);
    assert.equal(context.composePrompt, "- 화면 가운데에 원을 그려줘.");
    assert.equal(calls[0].input[0].content.filter((part: { type: string }) => part.type === "input_image").length, 2, "sketch and state machine graph");
    assert.match(calls[0].instructions, /TARGETED change/);
    assert.match(calls[0].instructions, /FINE-GRAINED STATE PLANNING/);
    assert.ok(calls[0].text.format.schema.required.includes("composePrompt"));
  });
  await withMockedAI(() => ({}), async calls => {
    await assert.rejects(runAI(requestSchema.parse({ intent: "machine-refine", scene, targetNodeId: "orb", machineTarget: { kind: "state", id: "missing" }, instruction: "바꿔줘" }), signal()), /첨부한 state 또는 transition/);
    await assert.rejects(runAI(requestSchema.parse({ intent: "machine-refine", scene, targetNodeId: "orb" }), signal()), /어떻게 바꿀지/);
    await assert.rejects(runAI(requestSchema.parse({ intent: "machine-refine", scene, targetNodeId: "tree", instruction: "바꿔줘" }), signal()), /상태 머신을 만들어주세요/);
    assert.equal(calls.length, 0);
  });
});

test("moved states and labels shape the graph, follow their edges and are saved with the frame", async () => {
  const machine = orbMachine(), auto = machineLayout(machine);
  const moved = machineLayout(machine, { states: { moving: { x: 700, y: 400 } }, labels: { press: { x: 0, y: -40 } } });
  const state = moved.states.find(item => item.id === "moving")!, press = moved.edges.find(edge => edge.id === "press")!, autoPress = auto.edges.find(edge => edge.id === "press")!;
  assert.deepEqual({ x: state.x, y: state.y }, { x: 700, y: 400 });
  assert.ok(moved.width >= 700 + 154 && moved.height >= 400 + 72, "the graph grows to hold the moved state");
  const end = press.curve[3];
  assert.ok(end.x >= 700 - 1 && end.x <= 700 + 154 + 1 && end.y >= 400 - 1 && end.y <= 400 + 72 + 1, "the arrow ends on the moved box");
  assert.notDeepEqual(press.curve, autoPress.curve);
  const settle = moved.edges.find(edge => edge.id === "settle")!;
  assert.notDeepEqual(press.curve[1], settle.curve[2], "opposite transitions bend apart");
  const autoMiddle = bezier(machineLayout(machine, { states: { moving: { x: 700, y: 400 } }, labels: {} }).edges.find(edge => edge.id === "press")!.curve, .5);
  const middle = bezier(press.curve, .5), close = (a: number, b: number) => Math.abs(a - b) < 1e-6;
  assert.ok(close(press.labelPoint.x, autoMiddle.x) && close(press.labelPoint.y, autoMiddle.y - 40), "a moved label keeps its offset from where it would sit");
  assert.ok(close(middle.x, press.labelPoint.x) && close(middle.y, press.labelPoint.y), "the arrow bends to pass through the moved label");
  const loop = machineLayout({ ...machine, transitions: [{ id: "spin", from: "idle", to: "idle", label: "회전", trigger: "event", afterMs: 1000 }] }, { states: {}, labels: { spin: { x: 30, y: -20 } } }).edges[0];
  const loopMiddle = bezier(loop.curve, .5);
  assert.ok(close(loopMiddle.x, loop.labelPoint.x) && close(loopMiddle.y, loop.labelPoint.y), "self loops follow their label too");
  const { createSketchPanel, savedSketchPanels } = await import("../app/lib/sketch-panels");
  const panel = { ...createSketchPanel({ scene: sampleScene() }), machineLayouts: { orb: { states: { moving: { x: 700, y: 400 } }, labels: { press: { x: 0, y: -40 } } } } };
  assert.deepEqual(JSON.parse(JSON.stringify(savedSketchPanels({ source: panel }))).source.machineLayouts.orb.states.moving, { x: 700, y: 400 });
});
