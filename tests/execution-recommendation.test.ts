import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { sampleScene, sceneProgram, withMockedAI } from "./fixtures/scene";
import { runAI } from "../app/server/ai.server";
import { requestSchema } from "../app/lib/schema";
import { connectScene } from "../app/server/scene-code.server";
import { constraintRows, revisedRecommendationSchema, targetedResultSchema } from "../app/lib/inspection";
import { emptyExploreEdit, exploreStep, type ExploreFrame } from "../app/lib/explore";
import { ExploreFrameView } from "../app/components/explore-frame";

const signal = () => new AbortController().signal;
const edit = { nodeId: "tree", find: "p.stroke(m.v(\"tree/ink\"));", replace: "p.stroke(m.v(\"tree/ink\")); p.strokeWeight(m.v(\"tree/weight\"));" };
const moment = { summary: "가지를 하나씩 그립니다.", axis: "run", done: 3, count: 8, progress: 3 / 8, last: "가지 3 · 가지 뻗기", next: "가지 4 · 가지 뻗기", stage: { name: "가지 뻗기", explain: "부모 끝에서 각도만큼 돌려 뻗습니다." } };
const crop = { object: "crop:0", label: "크롭 #1", box: { x: 10, y: 10, w: 40, h: 40 }, outline: [{ x: 10, y: 10 }, { x: 50, y: 10 }, { x: 30, y: 50 }], dx: 0, dy: 0, scale: 1.8, rotate: 20 };

function request(scene: ReturnType<typeof sampleScene>, fromExecution: object, extra: object = {}) {
  const code = connectScene({ title: "Tree", explanation: "", code: sceneProgram }, scene).code;
  return requestSchema.parse({ intent: "execution-recommendation", scene, image: "data:image/png;base64,AAAA", previous: code, instruction: "", ...extra,
    inspection: { brushName: "Tree", nodeIds: ["tree", "orb"], cursor: 0, marks: [],
      constraints: constraintRows(scene, ["tree", "orb"]).map(row => ({ key: row.key, nodeId: row.binding.nodeId, transformationId: row.transformationId, transformation: row.transformation, propertyId: row.binding.path[0], property: row.property, path: row.path, type: row.binding.type })),
      steps: [{ id: 1, nodeId: null, from: null, to: null, transitionId: null, values: {}, runtime: null }], fromExecution } });
}

test("a recommendation is made from what the user showed on an Execution frame: AI gets the moment of execution, the frame's recommendation and the ones listed; the new one has a preview that runs", async () => {
  const scene = sampleScene(), weight = { nodeId: "tree", id: "weight", label: "굵기", value: { type: "number", value: 3, min: 1, max: 12, step: 1, unit: "px" } };
  const output = { kind: "add-transformation", nodeId: "tree", targetId: "x", targetIds: ["y"], title: "뻗을 때 굵게", detail: "가지를 뻗는 단계에서 획을 굵게", changes: [], reply: "가지 뻗기 단계에서 키운 크롭대로 굵게 만들었습니다.",
    preview: { caption: "가지가 굵어집니다", edits: [edit], values: [weight], machine: null, marks: [], handles: [] } };
  const base = { kind: "value", nodeId: "tree", targetId: "", targetIds: [], title: "잉크 진하게", detail: "d", changes: [], preview: null };
  await withMockedAI(() => output, async calls => {
    const made = revisedRecommendationSchema.parse(await runAI(request(scene, { concern: "가지가 얇아", summary: "s", execution: moment, base, applied: false, listed: ["잉크 진하게"], manipulations: [crop] }), signal()));
    assert.equal(made.title, "뻗을 때 굵게"); assert.equal(made.targetId, "", "a new transformation has no target"); assert.deepEqual(made.targetIds, []);
    assert.equal(made.preview!.edits.length, 1);
    const sent = JSON.parse(calls[0].input[0].content[0].text);
    assert.equal(sent.execution.stage.name, "가지 뻗기"); assert.equal(sent.execution.done, 3);
    assert.equal(sent.framedRecommendation.title, "잉크 진하게"); assert.equal(sent.framedRecommendation.applied, false);
    assert.deepEqual(sent.listedRecommendations, ["잉크 진하게"]); assert.deepEqual(sent.manipulations, [crop]);
    assert.match(calls[0].instructions, /execution-recommendation/);
  });
  // A preview that does not apply: nothing is added (an error to retry).
  await withMockedAI(() => ({ ...output, preview: { ...output.preview, edits: [{ ...edit, find: "nowhere();" }] } }), async () => {
    await assert.rejects(runAI(request(scene, { summary: "", execution: moment, manipulations: [crop] }), signal()), /만든 미리보기 코드를 적용하지 못했습니다/);
  });
  // Nothing shown: nothing to make it from.
  await assert.rejects(runAI(request(scene, { summary: "", execution: moment }), signal()), /annotation을 그리거나 크롭/);
});

test("an Execution frame lets the user crop (move, scale, rotate) and annotate its picture at one moment, and make a recommendation from it", () => {
  const frame: ExploreFrame = { id: "explore-1", targetFrameId: "sketch-a", brushId: "b", toolId: "t", mode: "execution", source: { kind: "cause" }, name: "n", nodeIds: ["orb"],
    base: { runtime: null, values: {}, steps: [], params: {} }, executable: "", status: "ready", error: "", progress: .5, values: {},
    result: { summary: "펜 끝을 끌어 보세요.", axis: "input", from: 0, to: 1, edits: [], values: [], machine: null, overlays: [], stages: [], sketches: [], of: [] },
    request: { concern: "c", inspection: targetedResultSchema.parse({ summary: "s", overlays: [], valueFixes: [], recommendations: [] }), recommendation: null } };
  const noop = () => {};
  const render = (item: ExploreFrame, edits = true) => renderToStaticMarkup(createElement(ExploreFrameView, { frame: item, zoom: 1, specs: {}, labelOf: key => key, expand: key => [key], onProgress: noop, onValue: noop, onRetry: noop, onActivate: noop,
    ...(edits ? { onEdit: noop, onRecommend: noop, onCancelRecommend: noop } : {}) }));
  const html = render(frame);
  assert.match(html, /aria-pressed="true"[^>]*>.*?실행 손잡이/, "the execution handles work first");
  assert.match(html, /크롭 · 이동 · 크기 · 회전/); assert.match(html, /Annotation/);
  assert.match(html, /<button class="primary" disabled="">.*?Recommendation 만들기/, "nothing shown yet");
  assert.doesNotMatch(render(frame, false), /Recommendation 만들기/, "only where it can be asked for");
  const key = `${frame.id}:${exploreStep(frame).key}`, at = { key, progress: .5, moment: { ...moment, axis: "input" as const, done: null, count: null, stage: null } };
  const marked = render({ ...frame, edit: { ...emptyExploreEdit(), mode: "select", manipulations: [crop], image: "data:image/png;base64,AAAA", at } });
  assert.match(marked, /class="explore-edit-sheet"/); assert.match(marked, /크롭 #1/); assert.match(marked, /크기 ×1\.80 · 회전 20°/);
  assert.doesNotMatch(marked, /<button class="primary" disabled="">.*?Recommendation 만들기/, "a crop moved: it can be asked for");
  // Shown at another moment: not drawn here, and that moment can be gone back to.
  const elsewhere = render({ ...frame, edit: { ...emptyExploreEdit(), manipulations: [crop], at: { ...at, key: "other", progress: .2 } } });
  assert.doesNotMatch(elsewhere, /explore-edit-sheet/); assert.match(elsewhere, /20%에서 표시한 내용이 있습니다/); assert.match(elsewhere, /그 순간으로/);
  const making = render({ ...frame, edit: { ...emptyExploreEdit(), note: "더 크게", making: true } });
  assert.match(making, /AI가 보여준 대로 recommendation과 preview를 만들고 있습니다/);
});

test("a recommendation made from an Execution frame joins the targeted tool with its own frame group", () => {
  const home = readFileSync("app/routes/home.tsx", "utf8");
  assert.match(home, /recommendations: \[\.\.\.entry\.result\.recommendations, shared\]/, "listed after the others");
  assert.match(home, /placeRecommendationGroup\(tooled, grown, frame, index, shared\)/, "its fork slot, Execution and key parameter frames");
  assert.match(home, /edit: undefined \}\)\);/, "a frame made again starts with nothing shown");
});

test("a targeted inspection of a frame with no step recorded (steps are not saved) takes the moment the frame shows now as its step, so its frames can be made", () => {
  const home = readFileSync("app/routes/home.tsx", "utf8"), preview = readFileSync("app/components/code-preview.tsx", "utf8");
  assert.match(home, /const stepped = await recordNow\(frame, brush\.id\);\n    const state = inspectionFor/, "before the inspection reads its steps");
  assert.match(home, /preview\.snapshot\(\);/);
  assert.match(home, /기록된 단계가 없어 원인 Execution 프레임과 recommendation 프레임 그룹은 만들지 못했습니다/, "else it says why no frames were made");
  assert.match(preview, /event\.data\.type==='snapshot'\)\{traceQueue\.push\(\{nodeId:null[^}]*\}\);flushTrace\(\);return;\}/, "the running sketch reports itself as a step");
});
