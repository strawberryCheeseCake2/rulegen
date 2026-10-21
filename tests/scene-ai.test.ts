import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { aiScene, num, sampleScene, sceneProgram, withMockedAI } from "./fixtures/scene";
import { runAI } from "../app/server/ai.server";
import { intents, type IntentName } from "../app/server/intents.server";
import { loadPrompt } from "../app/server/prompts.server";
import { schemaFile, schemaText } from "../scripts/prompt-schemas";
import { generatedSchema, requestSchema } from "../app/lib/schema";
import { sceneSchema } from "../app/lib/scene/validate";
import { convertScene } from "../app/lib/scene/convert";
import type { AlgorithmCall } from "../app/lib/scene/schema";

const logDirectory = mkdtempSync(path.join(tmpdir(), "rulegen-scene-ai-"));
const previousLogDirectory = process.env.RULEGEN_AI_LOG_DIR;
process.env.RULEGEN_AI_LOG_DIR = logDirectory;
after(() => { rmSync(logDirectory, { recursive: true, force: true }); if (previousLogDirectory === undefined) delete process.env.RULEGEN_AI_LOG_DIR; else process.env.RULEGEN_AI_LOG_DIR = previousLogDirectory; });
const image = "data:image/png;base64,AAAA";
const signal = () => new AbortController().signal;

test("every intent has a readable prompt file and an up-to-date output JSON schema in prompts/", () => {
  for (const intent of Object.keys(intents) as IntentName[]) {
    const prompt = loadPrompt(intent);
    assert.match(prompt, /## Output JSON/, `${intent}.md documents its output`);
    assert.doesNotMatch(prompt, /\{\{include:/, `${intent}.md includes are expanded`);
    assert.equal(readFileSync(schemaFile(intent), "utf8"), schemaText(intent), `prompts/schemas/${intent}.json is stale: run npm run prompts:schemas`);
  }
  assert.match(loadPrompt("compose"), /SCENE MODEL: Collections, Objects/);
  assert.match(loadPrompt("compose"), /PER-NODE STATE MACHINE|STATE PLANNING/i);
  assert.throws(() => loadPrompt("../.env"), /prompt/);
});

test("transform regenerates one property (or the whole transformation) and reuses or adds library algorithms", async () => {
  const scene = sampleScene();
  const transformation = { id: "pulse", label: "Wobble", description: "", properties: [{ id: "radius", label: "Radius", effect: "spatial", description: "", value: { type: "algorithm", algorithmId: "wobble", args: [] } }] };
  const wobble = { id: "wobble", name: "Wobble", description: "noise*amplitude", params: [{ id: "amplitude", label: "Amplitude", description: "", value: num(5, 0, 20) }] };
  await withMockedAI(() => ({ algorithms: [wobble], transformation }), async calls => {
    const next = sceneSchema.parse(await runAI(requestSchema.parse({ intent: "transform", scene, targetNodeId: "orb", targetPropertyId: "radius" }), signal()));
    const orb = next.nodes.find(node => node.id === "orb")!;
    assert.equal((orb.transformations[0].properties[0].value as AlgorithmCall).algorithmId, "wobble");
    assert.equal(orb.transformations[0].properties[1].id, "speed", "other properties are preserved");
    assert.equal(orb.machine!.states[1].values.some(item => item.propertyId === "radius"), false, "state overrides follow the new structure");
    assert.ok(next.algorithms.some(algorithm => algorithm.id === "wobble"));
    const context = JSON.parse(calls[0].input[0].content[0].text);
    assert.equal(context.targetNodeId, "orb"); assert.equal(context.targetPropertyId, "radius"); assert.ok(context.scene.algorithms.length);
  });
  await withMockedAI(() => ({ algorithms: [], transformation: { ...transformation, properties: [{ ...transformation.properties[0], id: "other", value: num(1, 0, 2) }] } }), async () => {
    await assert.rejects(runAI(requestSchema.parse({ intent: "transform", scene, targetNodeId: "orb", targetPropertyId: "radius" }), signal()), /선택과 다릅니다/);
  });
  await assert.rejects(runAI(requestSchema.parse({ intent: "transform", scene, targetNodeId: "missing" }), signal()), /찾지 못했습니다/);
});

test("AI adds a new stacked transformation or replaces one in place, keeping property ids unique per node", async () => {
  const scene = sampleScene();
  const sway = { id: "wind-sway", label: "Wind sway", description: "바람에 흔들림", properties: [
    { id: "ink", label: "Sway", effect: "temporal", description: "", value: { type: "algorithm", algorithmId: "sine-wave", args: [] } },
  ] };
  await withMockedAI(() => ({ algorithms: [], transformation: sway }), async calls => {
    const added = sceneSchema.parse(await runAI(requestSchema.parse({ intent: "transform", scene, targetNodeId: "tree" }), signal()));
    const tree = added.nodes.find(node => node.id === "tree")!;
    assert.deepEqual(tree.transformations.map(item => item.id), ["branching-growth", "ink-wash", "wind-sway"], "appended after the existing ones");
    assert.equal(tree.transformations[2].properties[0].id, "ink-2", "a colliding property id is renamed");
    assert.equal(JSON.parse(calls[0].input[0].content[0].text).mode, "add");
    const replaced = sceneSchema.parse(await runAI(requestSchema.parse({ intent: "transform", scene, targetNodeId: "tree", targetTransformationId: "ink-wash" }), signal()));
    const next = replaced.nodes.find(node => node.id === "tree")!;
    assert.deepEqual(next.transformations.map(item => [item.id, item.label]), [["branching-growth", "Branching growth"], ["ink-wash", "Wind sway"]], "replaced in place, id kept");
    assert.equal(next.transformations[1].properties[0].id, "ink", "its own old ids are free to reuse");
    assert.equal(JSON.parse(calls[1].input[0].content[0].text).mode, "replace");
    // The user's text and the annotation drawn on the frame go with the request.
    await runAI(requestSchema.parse({ intent: "transform", scene, targetNodeId: "tree", targetTransformationId: "ink-wash", instruction: "더 번지게", transformMarks: [[{ x: .2, y: .3 }, { x: .4, y: .5 }]], image: "data:image/png;base64,AAAA" }), signal());
    const context = JSON.parse(calls[2].input[0].content[0].text);
    assert.equal(context.instruction, "더 번지게");
    assert.deepEqual(context.annotationMarks, [[{ x: .2, y: .3 }, { x: .4, y: .5 }]]);
    assert.match(calls[2].instructions, /annotationMarks/);
  });
  assert.match(loadPrompt("transform"), /"add"[\s\S]*"replace"[\s\S]*"property"/);
  assert.match(loadPrompt("compose"), /STACK of semantic transformations/);
  assert.match(loadPrompt("code"), /apply IN ORDER/);
  const full = { ...scene, nodes: scene.nodes.map(node => node.id === "tree" ? { ...node, transformations: Array.from({ length: 12 }, (_, i) => ({ id: `t${i}`, label: "", description: "", properties: [] })) } : node) };
  await assert.rejects(runAI(requestSchema.parse({ intent: "transform", scene: full, targetNodeId: "tree" }), signal()), /더 이상/);
});

test("composed nodes may carry several transformations; duplicate ids from the model are made unique", () => {
  const nodes = structuredClone(aiScene.nodes);
  nodes[1].transformations.push({ id: "pulse", label: "Glow", description: "", properties: [{ id: "radius", label: "Glow radius", effect: "stylistic", description: "", value: num(4, 0, 10) }] });
  const scene = convertScene({ algorithms: aiScene.algorithms, nodes });
  const orb = scene.nodes.find(node => node.id === "orb")!;
  assert.deepEqual(orb.transformations.map(item => item.id), ["pulse", "pulse-2"]);
  assert.deepEqual(orb.transformations.map(item => item.properties.map(property => property.id)), [["radius", "speed"], ["radius-2"]]);
});

test("code receives every nested binding and returns a connected, executable sketch", async () => {
  const scene = sampleScene();
  await withMockedAI(() => ({ title: "Tree", explanation: "나무", code: sceneProgram }), async calls => {
    const generated = generatedSchema.parse(await runAI(requestSchema.parse({ intent: "code", scene, image, instruction: "" }), signal()));
    const context = JSON.parse(calls[0].input[0].content[0].text);
    assert.deepEqual(context.parameterBindings.map((binding: { key: string }) => binding.key), ["tree/structure/depth", "tree/structure/length/base", "tree/structure/length/ratio", "tree/ink", "orb/radius", "orb/speed"]);
    assert.match(calls[0].instructions, /SCENE CODE CONTRACT/);
    assert.equal(generated.sceneBindings.length, 6);
    assert.match(generated.code, /@rulegen-scene-driver/);
    assert.deepEqual(context.modules, [{ key: "tree", nodes: ["tree", "orb"] }], "one module per root node");
  });
  await withMockedAI(() => ({ title: "Tree", explanation: "나무", code: "p.setup=()=>{p.createCanvas(900,600);}" }), async () => {
    await assert.rejects(runAI(requestSchema.parse({ intent: "code", scene }), signal()), /rulegenModule/);
  });
  await assert.rejects(runAI(requestSchema.parse({ intent: "code", scene: { nodes: [], algorithms: [] } }), signal()), /Decompose/);
});

test("intents of earlier workflows are no longer accepted", () => {
  for (const intent of ["analyze", "rules", "subfeature", "brush", "extract", "inspect", "handles", "revision", "state-machine"]) assert.equal(requestSchema.safeParse({ intent }).success, false);
});



