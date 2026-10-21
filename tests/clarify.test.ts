import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { sampleScene, withMockedAI } from "./fixtures/scene";
import { clarificationSchema, requestSchema, type Clarification } from "../app/lib/schema";
import { clarificationTarget, clarifiedInstruction, settleClarification } from "../app/lib/scene/clarify";
import { runAI } from "../app/server/ai.server";
import { createSketchPanel, newTransformDraft, type SketchPanel } from "../app/lib/sketch-panels";
import { sceneAI } from "../app/studio/scene-actions";

const logDirectory = mkdtempSync(path.join(tmpdir(), "rulegen-clarify-"));
const previousLogDirectory = process.env.RULEGEN_AI_LOG_DIR;
process.env.RULEGEN_AI_LOG_DIR = logDirectory;
after(() => { rmSync(logDirectory, { recursive: true, force: true }); if (previousLogDirectory === undefined) delete process.env.RULEGEN_AI_LOG_DIR; else process.env.RULEGEN_AI_LOG_DIR = previousLogDirectory; });

const image = "data:image/png;base64,AAAA";
const clarification = (patch: Partial<Clarification> = {}): Clarification => ({ understanding: " 원을 더 빠르게 맥동시키려는 것으로 이해했습니다. ", action: "modify", nodeId: "orb", transformationId: "pulse", propertyId: "speed", penId: "",
  plan: "Pulse의 Speed를 1.2에서 2.4로 올립니다. 반지름은 그대로 둡니다.", questions: ["  ", "더 크게도 할까요?"], ...patch });

test("clarify: the AI says in text what it would add or modify where (nothing changes), checked against the scene", async () => {
  const scene = sampleScene();
  await withMockedAI(() => clarification(), async calls => {
    const marks = [[{ x: .4, y: .4 }, { x: .5, y: .5 }]];
    const result = clarificationSchema.parse(await runAI(requestSchema.parse({ intent: "clarify", scene, image, instruction: "더 빠르게", transformMarks: marks }), new AbortController().signal));
    assert.deepEqual([result.action, result.nodeId, result.transformationId, result.propertyId], ["modify", "orb", "pulse", "speed"]);
    assert.equal(result.understanding, "원을 더 빠르게 맥동시키려는 것으로 이해했습니다."); assert.deepEqual(result.questions, ["더 크게도 할까요?"]);
    assert.equal(calls[0].text.format.name, "rulegen_clarify"); assert.match(calls[0].instructions, /Nothing is changed yet/);
    const context = JSON.parse(calls[0].input[0].content[0].text);
    assert.equal(context.target, null, "on the whole frame the AI picks the target"); assert.deepEqual(context.annotationMarks, marks.map(points => ({ points, pen: null }))); assert.equal(context.instruction, "더 빠르게");
    await assert.rejects(runAI(requestSchema.parse({ intent: "clarify", scene, image }), new AbortController().signal), /프레임에 그리거나/);
  });
  // A regeneration opened on a node keeps its target, whatever the model says.
  await withMockedAI(() => clarification({ nodeId: "orb", transformationId: "pulse" }), async () => {
    const fixed = clarificationSchema.parse(await runAI(requestSchema.parse({ intent: "clarify", scene, image, instruction: "번지게", targetNodeId: "tree", targetTransformationId: "ink-wash" }), new AbortController().signal));
    assert.deepEqual([fixed.action, fixed.nodeId, fixed.transformationId, fixed.propertyId], ["modify", "tree", "ink-wash", ""]);
  });
  await withMockedAI(() => clarification({ nodeId: "ghost" }), async () => {
    await assert.rejects(runAI(requestSchema.parse({ intent: "clarify", scene, image, instruction: "x" }), new AbortController().signal), /대상\(collection\/object\)을 찾지 못했습니다/);
  });
});

test("a clarification is made sound: a property names its transformation; add has no target transformation; unknown ones fail", () => {
  const scene = sampleScene();
  assert.equal(settleClarification(scene, clarification({ transformationId: "" })).transformationId, "pulse", "the property names its transformation");
  assert.deepEqual(Object.values(settleClarification(scene, clarification({ action: "add", transformationId: "pulse" }))).slice(1, 5), ["add", "orb", "", ""]);
  assert.equal(settleClarification(scene, clarification({ propertyId: "nope" })).propertyId, "");
  assert.throws(() => settleClarification(scene, clarification({ transformationId: "nope", propertyId: "" })), /transformation을 찾지 못했습니다/);
  assert.equal(clarificationTarget(scene, settleClarification(scene, clarification())), "「Orb」 · Pulse의 property 「Speed」 수정");
  assert.match(clarificationTarget(scene, clarification({ action: "add", transformationId: "", propertyId: "" })), /「Orb」에 새 transformation 추가/);
  const brief = clarifiedInstruction("더 빠르게", clarification(), "아니요");
  assert.match(brief, /User request: 더 빠르게/); assert.match(brief, /Confirmed plan \(follow it exactly\): Pulse의 Speed/); assert.match(brief, /answers .*: 아니요/);
});

test("Annotate: the frame's request is clarified first (no change), and only Apply adds or modifies it, then the code follows", async () => {
  const scene = sampleScene(), requests: { intent: string; body: any }[] = [];
  const panels: Record<string, SketchPanel> = { "sketch-1": { ...createSketchPanel({ scene }), transformDraft: { ...newTransformDraft(null), instruction: "더 빠르게" } } };
  let answer: unknown = clarification();
  const deps = {
    panel: (id: string) => panels[id], activate: () => {}, toast: () => {}, focus: () => {}, active: () => "sketch-1",
    updatePanel: (id: string, patch: any) => { panels[id] = { ...panels[id], ...(typeof patch === "function" ? patch(panels[id]) : patch) }; },
    task: async (_label: string, work: () => Promise<void>) => { await work(); },
    request: async (intent: string, body: any) => { requests.push({ intent, body }); return intent === "clarify" ? settleClarification(body.scene, answer as Clarification, null) : answer; },
    capture: async () => ({ image, region: { x: 0, y: 0, w: 1, h: 1 } }),
    artwork: () => ({ name: "S", photo: null, strokes: [], revision: 0 }), createFrames: () => [], resolvePen: (pen: unknown) => pen,
    documentId: () => 1, requestId: () => 1, clip: () => null, setClip: () => {}, preview: () => undefined,
  } as any;
  assert.equal(newTransformDraft(null).annotating, true, "annotating the frame starts drawing right away");
  await sceneAI(deps, "sketch-1").clarify();
  const draft = panels["sketch-1"].transformDraft!;
  assert.deepEqual(requests.map(item => [item.intent, item.body.targetNodeId, item.body.instruction, item.body.transformMarks.length]), [["clarify", "", "더 빠르게", 0]]);
  assert.equal(draft.clarification?.nodeId, "orb"); assert.equal(draft.annotating, false); assert.deepEqual(panels["sketch-1"].selectedNodeIds, ["orb"]);
  assert.deepEqual(panels["sketch-1"].scene, scene, "nothing changed yet");
  // Answering and asking again: the answer joins the request and the previous clarification goes along.
  panels["sketch-1"] = { ...panels["sketch-1"], transformDraft: { ...draft, answer: "크기는 그대로" } };
  await sceneAI(deps, "sketch-1").clarify();
  assert.equal(requests[1].body.instruction, "더 빠르게\n(답변) 크기는 그대로"); assert.equal(requests[1].body.clarification.plan, clarification().plan);
  assert.equal(panels["sketch-1"].transformDraft!.answer, "");
  // Apply: the transform step gets that target and the confirmed plan as its brief (no "alternative" rewrite).
  // (As the server returns it: the scene with that one change.)
  answer = { ...scene, nodes: scene.nodes.map(node => node.id === "orb" ? { ...node, description: "더 빠른 맥동" } : node) };
  await sceneAI(deps, "sketch-1").applyClarification();
  const transform = requests.find(item => item.intent === "transform")!;
  assert.deepEqual([transform.body.targetNodeId, transform.body.targetTransformationId, transform.body.targetPropertyId, transform.body.alternative], ["orb", "pulse", "speed", false]);
  assert.match(transform.body.instruction, /Confirmed plan \(follow it exactly\): Pulse의 Speed를 1\.2에서 2\.4로/); assert.match(transform.body.instruction, /User request: 더 빠르게\n\(답변\) 크기는 그대로/);

  assert.equal(panels["sketch-1"].scene.nodes.find(node => node.id === "orb")!.description, "더 빠른 맥동"); assert.equal(panels["sketch-1"].transformDraft, null, "applied: the request closes");
});

test("an annotation drawn with a transformation pen: the AI sees which strokes carry which pen; adding it copies the pen's transformation exactly (no AI)", async () => {
  const { aiDecomposition } = await import("./fixtures/scene");
  const { convertDecomposition, exampleScene } = await import("../app/lib/scene/minimal-example");
  const { examplePen } = await import("../app/lib/algorithm-pens");
  const parts = convertDecomposition(structuredClone(aiDecomposition)), example = exampleScene(parts, parts.items[0]);
  const pen = examplePen(example.scene, "sketch-ex", example.example, "pen-radial", "#3b73c4")!;
  const scene = sampleScene(), marks = [[{ x: .4, y: .4 }, { x: .5, y: .5 }], [{ x: .1, y: .1 }, { x: .2, y: .2 }]];
  // The request: each stroke's pen, the pens with their transformations; a pen not sent is refused.
  await withMockedAI(() => clarification({ action: "add", nodeId: "tree", transformationId: "", propertyId: "", penId: "pen-radial" }), async calls => {
    const result = clarificationSchema.parse(await runAI(requestSchema.parse({ intent: "clarify", scene, image, transformMarks: marks, transformMarkPens: ["pen-radial", ""], compositionPens: [pen] }), new AbortController().signal));
    assert.deepEqual([result.action, result.nodeId, result.penId], ["add", "tree", "pen-radial"]);
    const context = JSON.parse(calls[0].input[0].content[0].text);
    assert.deepEqual(context.annotationMarks.map((mark: { pen: string | null }) => mark.pen), ["pen-radial", null]);
    assert.equal(context.pens[0].transformation.label, "Radial repetition"); assert.match(calls[0].instructions, /transformation pen/);
    assert.throws(() => requestSchema.parse({ intent: "clarify", scene, image, transformMarks: marks, transformMarkPens: ["pen-radial", ""] }), /펜을 찾지 못했습니다/);
  });
  assert.equal(settleClarification(scene, clarification({ penId: "other" }), null, ["pen-radial"]).penId, "", "only a pen the user drew with");
  assert.match(clarificationTarget(scene, clarification({ action: "add", nodeId: "tree", transformationId: "", propertyId: "", penId: "pen-radial" }), id => id === pen.id ? pen : undefined), /「Tree」에 펜 「Radial repetition」의 transformation을 그대로 추가/);
  // Apply: copied in as the example has it (values, algorithms, origin); no transform request; the code follows with the example's code as reference.
  const requests: { intent: string; body: any }[] = [];
  const panels: Record<string, SketchPanel> = { "sketch-1": { ...createSketchPanel({ scene }), generated: { title: "t", explanation: "", code: "rulegenModule(\"tree\", function (m) { return {}; });", sceneBindings: [], machineSignature: "" },
    transformDraft: { ...newTransformDraft(null), marks: [marks[0]], markPens: ["pen-radial"], clarification: settleClarification(scene, clarification({ action: "add", nodeId: "tree", transformationId: "", propertyId: "", penId: "pen-radial" }), null, ["pen-radial"]) } } };
  const deps = {
    panel: (id: string) => panels[id] ?? createSketchPanel(), activate: () => {}, toast: () => {}, focus: () => {}, active: () => "sketch-1",
    updatePanel: (id: string, patch: any) => { panels[id] = { ...panels[id], ...(typeof patch === "function" ? patch(panels[id]) : patch) }; },
    task: async (_label: string, work: () => Promise<void>) => { await work(); },
    request: async (intent: string, body: any) => { requests.push({ intent, body }); throw new Error("stop"); },
    capture: async () => ({ image, region: { x: 0, y: 0, w: 1, h: 1 } }), artwork: () => ({ name: "S", photo: null, strokes: [], revision: 0 }), createFrames: () => [],
    resolvePen: (value: unknown) => value, pen: (id: string) => id === pen.id ? pen : undefined, documentId: () => 1, requestId: () => 1, clip: () => null, setClip: () => {}, preview: () => undefined,
  } as any;
  await sceneAI(deps, "sketch-1").applyClarification().catch(() => {});
  const tree = panels["sketch-1"].scene.nodes.find(node => node.id === "tree")!, added = tree.transformations.at(-1)!;
  assert.equal(added.label, "Radial repetition"); assert.deepEqual(added.origin, { frameId: "sketch-ex", transformationId: "radial-repetition", label: "Radial repetition" });
  assert.deepEqual(added.properties.map(property => property.id), ["count", "layout"]); assert.equal((added.properties[0].value as { value: number }).value, 7);
  assert.ok(panels["sketch-1"].scene.algorithms.some(algorithm => algorithm.id === "radial-repeat"), "its algorithms come along");
  assert.equal(panels["sketch-1"].transformDraft, null);
  assert.deepEqual(requests.map(item => item.intent), ["code"], "no transform request: only the code follows");
});
