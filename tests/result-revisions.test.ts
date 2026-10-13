import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { clarificationSchema, generatedSchema, MAX_RESULT_STROKES, requestSchema } from "../app/lib/schema";
import { sceneChanges, sceneRevisionSnapshot, settleProposal } from "../app/lib/scene/revisions";
import { removeNodes, updateNode } from "../app/lib/scene/graph";
import { runAI } from "../app/server/ai.server";
import { num, sampleScene, sceneProgram, withMockedAI } from "./fixtures/scene";

const logDirectory = mkdtempSync(path.join(tmpdir(), "rulegen-revision-tests-"));
const previousLogDirectory = process.env.RULEGEN_AI_LOG_DIR;
process.env.RULEGEN_AI_LOG_DIR = logDirectory;
after(() => { rmSync(logDirectory, { recursive: true, force: true }); if (previousLogDirectory === undefined) delete process.env.RULEGEN_AI_LOG_DIR; else process.env.RULEGEN_AI_LOG_DIR = previousLogDirectory; });
const image = "data:image/png;base64,AAAA";
const annotations = [{ id: "a", points: [{ x: .1, y: .1 }, { x: .3, y: .2 }] }];

test("review lists added, changed and removed collections, properties and algorithms without mutating the scene", () => {
  const scene = sampleScene(), original = JSON.stringify(scene);
  let proposed = updateNode(scene, "orb", node => ({ ...node, transformations: [{ ...node.transformations[0], properties: [{ ...node.transformations[0].properties[0], value: num(60, 10, 140, 1, "px") }] }] }));
  proposed = { ...proposed, nodes: [...proposed.nodes, { ...proposed.nodes[1], id: "leaf", name: "Leaf", machine: null }] };
  const changes = sceneChanges(scene, proposed);
  assert.ok(changes.some(change => change.kind === "change" && change.path === "Object · Orb · Pulse · Radius (spatial)" && /60 px/.test(change.after)));
  assert.ok(changes.some(change => change.kind === "remove" && /Speed/.test(change.path)));
  assert.ok(changes.some(change => change.kind === "add" && change.path === "Object · Leaf · Name"));
  assert.ok(sceneChanges(scene, removeNodes(scene, ["orb"])).some(change => change.kind === "remove" && change.path === "Object · Orb · Name"));
  assert.equal(JSON.stringify(scene), original);
  const moved = updateNode(proposed, "orb", node => ({ ...node, region: { x: 0, y: 0, w: .5, h: .5 } }));
  assert.deepEqual(settleProposal(scene, moved).nodes.find(node => node.id === "orb")!.region, scene.nodes[1].region);
});

test("annotations are bounded and any edit to the sketch, clarification, scene or code invalidates a review", () => {
  assert.ok(requestSchema.safeParse({ intent: "revision", annotations: Array(20).fill(annotations[0]) }).success);
  assert.equal(requestSchema.safeParse({ intent: "revision", annotations: Array(MAX_RESULT_STROKES + 1).fill(annotations[0]) }).success, false);
  assert.equal(requestSchema.safeParse({ intent: "revision", annotations: [{ ...annotations[0], points: [{ x: 2, y: 0 }, { x: 0, y: 0 }] }] }).success, false);
  const scene = sampleScene(), snapshot = sceneRevisionSnapshot(scene, "code", annotations, "", image);
  assert.notEqual(snapshot, sceneRevisionSnapshot(scene, "code", annotations, "다르게", image));
  assert.notEqual(snapshot, sceneRevisionSnapshot(scene, "edited code", annotations, "", image));
  assert.notEqual(snapshot, sceneRevisionSnapshot(updateNode(scene, "tree", node => ({ ...node, name: "Bush" })), "code", annotations, "", image));
});

test("AI clarification compares before/after images with the scene as context and keeps the user's draft intent", async () => {
  const scene = sampleScene();
  const input = { intent: "clarification", image, resultImage: image, annotations, scene, previous: sceneProgram };
  await withMockedAI(() => ({ clarification: "Tree collection의 가지를 오른쪽으로 더 길게 뻗게 해줘." }), async calls => {
    const result = clarificationSchema.parse(await runAI(requestSchema.parse(input), new AbortController().signal));
    assert.match(result.clarification, /Tree collection/);
    const context = JSON.parse(calls[0].input[0].content[0].text);
    assert.equal(context.instruction, ""); assert.deepEqual(context.annotations, annotations); assert.equal(context.scene.nodes[0].name, "Tree");
    assert.equal(calls[0].input[0].content.filter((part: { type: string }) => part.type === "input_image").length, 2);
    assert.match(calls[0].instructions, /editable Korean/);
    await runAI(requestSchema.parse({ ...input, instruction: "잎을 추가해줘" }), new AbortController().signal);
    assert.equal(JSON.parse(calls[1].input[0].content[0].text).instruction, "잎을 추가해줘");
    await assert.rejects(runAI(requestSchema.parse({ ...input, annotations: [] }), new AbortController().signal));
    assert.equal(calls.length, 2);
  });
});

test("confirmed changes regenerate code from the proposed scene with the annotated image and summary", async () => {
  const proposed = updateNode(sampleScene(), "orb", node => ({ ...node, transformations: [{ ...node.transformations[0], properties: node.transformations[0].properties.map(p => p.id === "radius" ? { ...p, value: num(60, 10, 140, 1, "px") } : p) }] }));
  await withMockedAI(() => ({ title: "Tree", explanation: "큰 원", code: sceneProgram }), async calls => {
    const generated = generatedSchema.parse(await runAI(requestSchema.parse({ intent: "code", scene: proposed, image, annotations, revisionSummary: "원을 키웁니다", instruction: "원을 키워줘" }), new AbortController().signal));
    assert.match(generated.code, /"orb\/radius": 60/);
    const context = JSON.parse(calls[0].input[0].content[0].text);
    assert.equal(context.confirmedRevisionSummary, "원을 키웁니다");
    assert.deepEqual(context.annotations, annotations);
  });
});
