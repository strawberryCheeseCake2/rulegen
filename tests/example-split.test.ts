import test from "node:test";
import assert from "node:assert/strict";
import { num, sampleScene, sceneProgram, withMockedAI } from "./fixtures/scene";
import { runAI } from "../app/server/ai.server";
import { requestSchema, semanticPenSchema, splitResultSchema } from "../app/lib/schema";
import { connectScene } from "../app/server/scene-code.server";
import { minimalExampleScene } from "../app/lib/scene/minimal-example";
import { sceneSchema } from "../app/lib/scene/validate";
import { makeTransformationPen, penAlgorithm } from "../app/lib/scene/pens";
import { compositionContext } from "../app/lib/algorithm-pens";
import { workspaceSchema } from "../app/lib/workspace";

const signal = () => new AbortController().signal;
const part = (id: string, label: string, property: string) => ({ id, label, description: `${label} 설명`, properties: [{ id: property, label: property, effect: "spatial", description: "", value: num(3, 0, 10) }] });

test("split asks for the transformation with the example's module code, and keeps parts as transformations with ids free in the node", async () => {
  const scene = sampleScene(), code = connectScene({ title: "Tree", explanation: "", code: sceneProgram }, scene).code;
  await withMockedAI(() => ({ divisible: true, reason: "둘로 나눴습니다.", algorithms: [], parts: [part("pulse", "Grow", "grow"), part("drift", "Drift", "drift")] }), async calls => {
    const result = splitResultSchema.parse(await runAI(requestSchema.parse({ intent: "split", scene, targetNodeId: "orb", targetTransformationId: "pulse", previous: code, instruction: "" }), signal()));
    assert.equal(result.divisible, true);
    assert.deepEqual(result.parts.map(item => item.id), ["pulse-2", "drift"], "the parent's own id is not reused");
    const sent = JSON.stringify(calls[0]);
    assert.match(sent, /targetTransformationId/); assert.match(sent, /rulegenModule/, "the module that draws it"); assert.match(sent, /algo_power_decay/);
  });
  // One part (or none) is no division: the reason is given instead.
  await withMockedAI(() => ({ divisible: true, reason: "", algorithms: [], parts: [part("grow", "Grow", "grow")] }), async () => {
    const result = splitResultSchema.parse(await runAI(requestSchema.parse({ intent: "split", scene, targetNodeId: "orb", targetTransformationId: "pulse", previous: code, instruction: "" }), signal()));
    assert.equal(result.divisible, false); assert.deepEqual(result.parts, []); assert.match(result.reason, /나눌/);
  });
});

test("Decompose on a minimal example divides its transformation: the example stays as it is and each part gets a child example frame linked to it", async () => {
  const { sceneAI } = await import("../app/studio/scene-actions");
  const { createSketchPanel } = await import("../app/lib/sketch-panels");
  const example = sceneSchema.parse(minimalExampleScene(sampleScene(), "orb", "pulse"));
  const panels: Record<string, ReturnType<typeof createSketchPanel>> = { ex: { ...createSketchPanel({ scene: example }), exampleOf: { frameId: "a", nodeId: "orb", transformationId: "pulse" } } };
  const before = JSON.stringify(panels.ex.scene);
  let frames = 0;
  const intents: string[] = [], toasts: string[] = [], subs: string[] = [];
  const parts = [part("grow", "Grow", "grow"), part("drift", "Drift", "drift")].map(item => ({ ...item, properties: item.properties.map(property => ({ ...property, value: { ...property.value } })) }));
  const deps = {
    panel: (id: string) => panels[id] ?? createSketchPanel(), activate: () => {}, toast: (text: string) => { toasts.push(text); }, focus: () => {}, documentId: () => 1, requestId: () => 1, preview: () => undefined, active: () => "ex", refreshBrushCode: () => {},
    updatePanel: (id: string, patch: any) => { const base = panels[id] ?? createSketchPanel(); panels[id] = { ...base, ...(typeof patch === "function" ? patch(base) : patch) }; },
    createFrame: () => { const id = `sketch-${++frames}`; panels[id] = createSketchPanel(); return id; },
    addSubBrush: (owner: string, nodeId: string, frameId: string) => { subs.push(`${owner}:${nodeId}@${frameId}`); return null; },
    task: async (_label: string, work: () => Promise<void>) => { await work(); },
    request: async (intent: string) => { intents.push(intent); return intent === "split" ? { divisible: true, reason: "둘로 나눴습니다.", algorithms: example.algorithms, parts } : { title: "Example", explanation: "", code: "rulegenModule(\"x\", function (m) { return { draw() {} }; });" }; },
    capture: async () => ({ image: "data:image/png;base64,AAAA", region: { x: 0, y: 0, w: 1, h: 1 } }),
    artwork: (id: string) => ({ name: id, photo: null, strokes: [], revision: 1 }),
  } as any;
  await sceneAI(deps, "ex").decompose();
  assert.deepEqual(intents, ["split", "code", "code"]);
  assert.equal(JSON.stringify(panels.ex.scene), before, "the example itself is unchanged");
  const children = Object.entries(panels).filter(([id]) => id.startsWith("sketch-"));
  assert.deepEqual(children.map(([, panel]) => panel.exampleOf), [{ frameId: "ex", nodeId: "orb", transformationId: "grow" }, { frameId: "ex", nodeId: "orb", transformationId: "drift" }]);
  assert.ok(children.every(([, panel]) => panel.scene.nodes.flatMap(node => node.transformations).length === 1 && panel.generated), "each child holds only its part and is rendered");
  assert.deepEqual(children.map(([, panel]) => panel.scene.nodes.find(node => node.id === "orb")!.transformations[0].properties[0].id), ["grow", "drift"], "its constraints can be adjusted there");
  assert.equal(subs.length, 2, "each part is a sub brush too");
  // When it cannot be divided: no frames, the reason is said.
  frames = 0; intents.length = 0;
  deps.request = async () => ({ divisible: false, reason: "하나의 감쇠식입니다.", algorithms: [], parts: [] });
  await sceneAI(deps, "ex").decompose();
  assert.equal(Object.keys(panels).filter(id => id.startsWith("sketch-")).length, 2);
  assert.match(toasts.at(-1)!, /더 쪼갤 수 없습니다: 하나의 감쇠식입니다/);
});

test("a transformation pen carries the example's transformation as it is (properties, values, algorithms) and goes to Compose with the marks", () => {
  const scene = sampleScene(), pen = makeTransformationPen(scene, "tree", "branching-growth", "ex", "pen-1", "#3b73c4");
  assert.equal(pen.kind, "transformation");
  assert.equal(pen.transformation!.label, "Branching growth");
  assert.deepEqual(pen.transformation!.properties.map(property => property.id), ["structure"]);
  assert.ok(pen.transformation!.library.some(algorithm => algorithm.id === "recursive-branch"), "the algorithms it uses come along");
  assert.equal(penAlgorithm(pen), null, "it is not one algorithm to import");
  assert.throws(() => semanticPenSchema.parse({ ...pen, transformation: null }));
  assert.throws(() => makeTransformationPen(scene, "tree", "nope", "ex", "pen-2", "#3b73c4"));
  const context = compositionContext({ name: "s", photo: null, revision: 1, strokes: [{ points: [{ x: 10, y: 10 }, { x: 40, y: 40 }], color: pen.color, width: 2, opacity: 1, tool: "semantic", semanticPen: pen }] } as never);
  assert.equal(context.compositionPens[0].transformation?.label, "Branching growth");
  assert.equal(context.compositionStrokes[0].tool, "semantic");
});

test("hidden minimal examples are kept with the layout", () => {
  assert.deepEqual(workspaceSchema.parse({}).hiddenExamples, []);
  assert.deepEqual(workspaceSchema.parse({ hiddenExamples: ["sketch-2"] }).hiddenExamples, ["sketch-2"]);
});

test("Decompose leaves out a still background filling the canvas: it is no brush, so its transformation gets no example (nor a brush of its own)", async () => {
  const { sceneAI } = await import("../app/studio/scene-actions");
  const { createSketchPanel } = await import("../app/lib/sketch-panels");
  const base = sampleScene();
  const scene = sceneSchema.parse({ ...base, nodes: [{ id: "background", kind: "object", parentId: null, name: "Quiet background", description: "", primitive: "rect", region: { x: 0, y: 0, w: 1, h: 1 },
    transformations: [{ id: "paper-fill", label: "Paper fill", description: "종이색으로 채움", properties: [{ id: "paper", label: "Paper", effect: "stylistic", description: "", value: { type: "color", value: "#fffefa" } }] }], visible: true, machine: null }, ...base.nodes] });
  const panels: Record<string, ReturnType<typeof createSketchPanel>> = { a: createSketchPanel({ scene }) };
  let frames = 0;
  const deps = {
    panel: (id: string) => panels[id] ?? createSketchPanel(), activate: () => {}, toast: () => {}, focus: () => {}, documentId: () => 1, requestId: () => 1, preview: () => undefined, active: () => "a", refreshBrushCode: () => {},
    updatePanel: (id: string, patch: any) => { const before = panels[id] ?? createSketchPanel(); panels[id] = { ...before, ...(typeof patch === "function" ? patch(before) : patch) }; },
    createFrame: () => { const id = `sketch-${++frames}`; panels[id] = createSketchPanel(); return id; }, addSubBrush: () => null,
    task: async (_label: string, work: () => Promise<void>) => { await work(); },
    request: async () => ({ title: "Example", explanation: "", code: "rulegenModule(\"x\", function (m) { return { draw() {} }; });" }),
    capture: async () => ({ image: "data:image/png;base64,AAAA", region: { x: 0, y: 0, w: 1, h: 1 } }),
    artwork: (id: string) => ({ name: id, photo: null, strokes: [], revision: 1 }),
  } as any;
  await sceneAI(deps, "a").decompose();
  const shown = Object.entries(panels).filter(([id]) => id !== "a").map(([, panel]) => panel.exampleOf?.transformationId);
  assert.ok(shown.length > 0); assert.ok(!shown.includes("paper-fill"));
});
