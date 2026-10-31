import test from "node:test";
import assert from "node:assert/strict";
import { sampleScene, sceneProgram, withMockedAI } from "./fixtures/scene";
import { runAI } from "../app/server/ai.server";
import { requestSchema } from "../app/lib/schema";
import { connectScene } from "../app/server/scene-code.server";
import { constraintRows, remapResult, revisedRecommendationSchema, type InspectResult } from "../app/lib/inspection";
import { cropFrom, dragManipulation, manipulated, onCrop, placed } from "../app/lib/preview-objects";

const signal = () => new AbortController().signal;
const mark = { id: "where", kind: "ellipse", name: "새로 생김", x: "s(\"tree\", \"ball.x\") - 20", y: "280", w: "40", h: "40", label: "새로 생김", color: "#e0457b", when: "", each: "" };
const handle = (key: string) => ({ id: `h-${key}`, kind: "line", name: "굵기", x: "450", y: "300", w: "p(\"" + key + "\")", h: "0", label: "", color: "#3a7bd5", link: { kind: "constraint", nodeId: "tree", id: "ink" }, when: "", each: "",
  handle: { key, gesture: "drag", x: "450 + p(\"" + key + "\")", y: "300", pivotX: "", pivotY: "", value: "start + dx", hint: "끌어서 굵게" } });
const edit = { nodeId: "tree", find: "p.stroke(m.v(\"tree/ink\"));", replace: "p.stroke(m.v(\"tree/ink\")); p.strokeWeight(m.v(\"tree/weight\"));" };

function request(scene: ReturnType<typeof sampleScene>, revise: object, extra: object = {}) {
  const code = connectScene({ title: "Tree", explanation: "", code: sceneProgram }, scene).code;
  return requestSchema.parse({ intent: "revise-recommendation", scene, image: "data:image/png;base64,AAAA", previous: code, instruction: "", ...extra,
    inspection: { brushName: "Tree", nodeIds: ["tree", "orb"], cursor: 0, marks: [],
      constraints: constraintRows(scene, ["tree", "orb"]).map(row => ({ key: row.key, nodeId: row.binding.nodeId, transformationId: row.transformationId, transformation: row.transformation, propertyId: row.binding.path[0], property: row.property, path: row.path, type: row.binding.type })),
      steps: [{ id: 1, nodeId: null, from: null, to: null, transitionId: null, values: {}, runtime: { states: {}, stores: { tree: { ball: { x: 10 } } } } }], revise } });
}
const recommendation = { kind: "add-transformation", nodeId: "tree", targetId: "", targetIds: [], title: "굵게", detail: "획을 굵게", changes: [], preview: null };

test("revising a recommendation at its preview: AI gets what the user did there, and the result keeps a preview that runs, with its marks and only handles it can drag", async () => {
  const scene = sampleScene(), weight = { nodeId: "tree", id: "weight", label: "굵기", value: { type: "number", value: 3, min: 1, max: 12, step: 1, unit: "px" } };
  const output = { ...recommendation, title: "겹친 곳만 굵게", detail: "겹친 곳의 획을 6px로", reply: "겹친 곳만 굵게 바꿨습니다.",
    preview: { caption: "겹친 곳이 굵어집니다", edits: [edit], values: [weight], machine: null, marks: [mark], handles: [handle("tree/weight"), handle("@input:0:0.5"), handle("tree/nope")] } };
  const manipulation = { object: "crop:0", label: "크롭 #1", box: { x: 10, y: 10, w: 40, h: 40 }, outline: [{ x: 10, y: 10 }, { x: 50, y: 10 }, { x: 30, y: 50 }], dx: 20, dy: 0, scale: 1.5, rotate: 30 };
  await withMockedAI(() => output, async calls => {
    const result = revisedRecommendationSchema.parse(await runAI(request(scene, { recommendation, concern: "겹치면 어색해", summary: "겹친 곳이 얇습니다.", manipulations: [manipulation], adjusted: [{ key: "tree/weight", label: "굵기", from: 3, to: 6 }] }), signal()));
    assert.equal(result.title, "겹친 곳만 굵게"); assert.equal(result.reply, "겹친 곳만 굵게 바꿨습니다.");
    assert.deepEqual(result.preview!.marks.map(item => item.id), ["where"]);
    assert.deepEqual(result.preview!.handles.map(item => item.handle!.key), ["tree/weight"], "only a value the preview brings or a brush value; not the running state, not an unknown key");
    const sent = JSON.parse(calls[0].input[0].content[0].text);
    assert.deepEqual(sent.manipulations, [manipulation]); assert.equal(sent.adjusted[0].to, 6); assert.equal(sent.concern, "겹치면 어색해"); assert.equal(sent.recommendation.title, "굵게");
    assert.ok(sent.step && !("steps" in sent), "only the step the preview is drawn on");
  });
  // A preview whose code does not apply, or a target outside the brush: nothing is replaced (an error to retry).
  await withMockedAI(() => ({ ...output, preview: { ...output.preview, edits: [{ ...edit, find: "nowhere();" }] } }), async () => {
    await assert.rejects(runAI(request(scene, { recommendation, summary: "", manipulations: [manipulation] }), signal()), /미리보기 코드를 적용하지 못했습니다/);
  });
  await withMockedAI(() => ({ ...output, kind: "state", targetId: "ghost" }), async () => {
    await assert.rejects(runAI(request(scene, { recommendation, summary: "", manipulations: [manipulation] }), signal()), /적용할 수 없습니다/);
  });
  // Nothing done on the preview: nothing to revise.
  await assert.rejects(runAI(request(scene, { recommendation, summary: "" }), signal()), /annotation을 그리거나/);
});

test("a preview's marks and handles are kept in the brush's shared ids like its overlays", () => {
  const result = { summary: "s", overlays: [], valueFixes: [], parameters: [], records: null,
    recommendations: [{ ...recommendation, kind: "add-transformation" as const, nodeId: "tree-2", preview: { caption: "", edits: [{ ...edit, nodeId: "tree-2" }], values: [], machine: { nodeId: "tree-2", states: [], transitions: [] },
      marks: [{ ...mark, x: "p(\"tree-2/@x\")", each: "tree-2:items" }], handles: [{ ...handle("tree-2/weight"), each: "" }] } }] } as unknown as InspectResult;
  const preview = remapResult(result, new Map([["tree-2", "tree"]])).recommendations[0].preview!;
  assert.equal(preview.marks[0].x, "p(\"tree/@x\")"); assert.equal(preview.marks[0].each, "tree:items");
  assert.equal(preview.handles[0].handle!.key, "tree/weight"); assert.equal(preview.machine!.nodeId, "tree");
});

test("a part of the preview is cropped by drawing freely around it, then moved, scaled about its center and rotated; only what is inside the crop is grabbed", () => {
  // A triangle drawn around a part (for grabbing).
  const outline = [{ x: 100, y: 100 }, { x: 160, y: 100 }, { x: 160, y: 160 }];
  // A loop drawn freely (200 points) around a part.
  const crop = cropFrom(Array.from({ length: 200 }, (_, i) => ({ x: 130 + 30 * Math.cos(i / 100 * Math.PI), y: 130 + 30 * Math.sin(i / 100 * Math.PI) })), 0)!;
  assert.equal(crop.object, "crop:0"); assert.match(crop.label, /크롭 #1/);
  assert.ok(Math.abs(crop.box.x - 100) < 1 && Math.abs(crop.box.y - 100) < 1 && Math.abs(crop.box.w - 60) < 1 && Math.abs(crop.box.h - 60) < 1, "its box is around what it encloses");
  assert.ok(crop.outline.length <= 64, "a long outline is thinned");
  assert.equal(cropFrom([{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 400, y: 1 }], 0), null, "a line encloses nothing");
  assert.equal(cropFrom([{ x: 0, y: 0 }, { x: 3, y: 3 }], 0), null, "a click is no crop");
  const start = { ...crop, box: { x: 100, y: 100, w: 60, h: 60 }, outline, dx: 0, dy: 0, scale: 1, rotate: 0 };
  assert.ok(onCrop(start, { x: 150, y: 120 })); assert.ok(!onCrop(start, { x: 110, y: 150 }), "inside its box but outside the drawn outline");
  const moved = dragManipulation(start, "move", { x: 150, y: 120 }, { x: 250, y: 100 });
  assert.deepEqual([moved.dx, moved.dy], [100, -20]);
  assert.ok(onCrop(moved, { x: 250, y: 100 })); assert.ok(!onCrop(moved, { x: 150, y: 120 }), "it is grabbed where it is now");
  const scaled = dragManipulation(moved, "scale", { x: 260, y: 110 }, { x: 350, y: 110 });
  assert.equal(scaled.scale, 4);
  const turned = dragManipulation(scaled, "rotate", { x: 230, y: 50 }, { x: 290, y: 110 });
  assert.equal(turned.rotate, 90); assert.equal(placed(turned).hw, 120);
  assert.ok(manipulated(turned)); assert.ok(!manipulated(start));
});
