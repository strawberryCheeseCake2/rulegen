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
import { sceneProposalSchema, sceneSchema } from "../app/lib/scene/validate";
import { createInteractionPen, compositionContext } from "../app/lib/algorithm-pens";
import { makeAlgorithmPen } from "../app/lib/scene/pens";
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
  assert.match(loadPrompt("extract"), /SCENE MODEL: Collections, Objects/);
  assert.match(loadPrompt("state-machine"), /PER-NODE STATE MACHINE/);
  assert.throws(() => loadPrompt("../.env"), /prompt/);
});

test("extract sends the prompt file and strict schema, and returns a validated collection/object scene", async () => {
  await withMockedAI(() => aiScene, async calls => {
    const scene = sceneSchema.parse(await runAI(requestSchema.parse({ intent: "extract", image, instruction: "" }), signal()));
    assert.deepEqual(scene.nodes.map(node => node.id), ["tree", "orb"]);
    assert.equal(calls[0].instructions, loadPrompt("extract"));
    assert.equal(calls[0].text.format.name, "rulegen_extract");
    assert.equal(calls[0].text.format.strict, true);
    assert.deepEqual(calls[0].text.format.schema, JSON.parse(schemaText("extract")));
    assert.equal(calls[0].input[0].content[1].image_url, image);
  });
  await assert.rejects(runAI(requestSchema.parse({ intent: "extract" }), signal()), /이미지가 없습니다/);
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
  });
  assert.match(loadPrompt("transform"), /"add"[\s\S]*"replace"[\s\S]*"property"/);
  assert.match(loadPrompt("extract"), /STACK of semantic transformations/);
  assert.match(loadPrompt("code"), /apply IN ORDER/);
  const full = { ...scene, nodes: scene.nodes.map(node => node.id === "tree" ? { ...node, transformations: Array.from({ length: 6 }, (_, i) => ({ id: `t${i}`, label: "", description: "", properties: [] })) } : node) };
  await assert.rejects(runAI(requestSchema.parse({ intent: "transform", scene: full, targetNodeId: "tree" }), signal()), /더 이상/);
});

test("extracted nodes may carry several transformations; duplicate ids from the model are made unique", () => {
  const nodes = structuredClone(aiScene.nodes);
  nodes[1].transformations.push({ id: "pulse", label: "Glow", description: "", properties: [{ id: "radius", label: "Glow radius", effect: "stylistic", description: "", value: num(4, 0, 10) }] });
  const scene = convertScene({ algorithms: aiScene.algorithms, nodes });
  const orb = scene.nodes.find(node => node.id === "orb")!;
  assert.deepEqual(orb.transformations.map(item => item.id), ["pulse", "pulse-2"]);
  assert.deepEqual(orb.transformations.map(item => item.properties.map(property => property.id)), [["radius", "speed"], ["radius-2"]]);
});

test("state machines are planned per collection/object and validated against that node's properties", async () => {
  const scene = sampleScene();
  const machine = { initialState: "rest", states: [
    { id: "rest", label: "쉬기", description: "", values: [] },
    { id: "grow", label: "자라기", description: "", values: [{ propertyId: "ink", value: { type: "color", value: "#228844" } }] },
  ], transitions: [{ id: "grown", from: "grow", to: "rest", label: "성장 완료", trigger: "after", afterMs: 900 }, { id: "tap", from: "rest", to: "grow", label: "나무 탭", trigger: "event", afterMs: 1000 }] };
  await withMockedAI(() => ({ algorithms: [], machine }), async calls => {
    const next = sceneSchema.parse(await runAI(requestSchema.parse({ intent: "state-machine", scene, targetNodeId: "tree", image, instruction: "탭하면 자라기" }), signal()));
    assert.equal(next.nodes.find(node => node.id === "tree")!.machine!.states.length, 2);
    assert.equal(next.nodes.find(node => node.id === "orb")!.machine!.initialState, "idle", "other nodes keep their own machines");
    assert.match(calls[0].instructions, /FINE-GRAINED STATE PLANNING/);
    assert.equal(calls[0].max_output_tokens, 32000);
    assert.equal(calls[0].text.format.schema.properties.machine.properties.states.maxItems, 32);
  });
  await withMockedAI(() => ({ algorithms: [], machine: { ...machine, states: [machine.states[0], { ...machine.states[1], values: [{ propertyId: "radius", value: num(1, 0, 2) }] }] } }), async () => {
    await assert.rejects(runAI(requestSchema.parse({ intent: "state-machine", scene, targetNodeId: "tree" }), signal()), /없는 property/);
  });
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
  });
  await withMockedAI(() => ({ title: "Tree", explanation: "나무", code: "p.setup=()=>{p.createCanvas(900,600);}" }), async () => {
    await assert.rejects(runAI(requestSchema.parse({ intent: "code", scene }), signal()), /연결하지 못했습니다/);
  });
  await assert.rejects(runAI(requestSchema.parse({ intent: "code", scene: { nodes: [], algorithms: [] } }), signal()), /추출/);
});

test("compose turns pen strokes into a scene that reuses the pen's algorithm; interaction marks add the interaction contract", async () => {
  const pen = makeAlgorithmPen(sampleScene(), { nodeId: "tree", propertyId: "structure" }, "source", "branch-pen", "#3b73c4");
  const interaction = createInteractionPen();
  const context = compositionContext({ name: "Sketch", photo: null, revision: 1, strokes: [
    { tool: "pen", color: pen.color, width: 3, opacity: 1, points: [{ x: 100, y: 500 }, { x: 450, y: 100 }], semanticPen: pen },
    { tool: "pen", color: interaction.color, width: 3, opacity: 1, points: [{ x: 400, y: 120 }, { x: 420, y: 140 }], semanticPen: interaction },
  ] });
  await withMockedAI(() => aiScene, async calls => {
    const scene = sceneSchema.parse(await runAI(requestSchema.parse({ intent: "compose", image, instruction: "가지 펜으로 나무를 만들고 원을 누르면 움직이게", ...context }), signal()));
    assert.ok(scene.algorithms.some(algorithm => algorithm.id === "recursive-branch"));
    const sent = JSON.parse(calls[0].input[0].content[0].text);
    assert.equal(sent.compositionPens[0].algorithm.call.algorithmId, "recursive-branch");
    assert.deepEqual(sent.compositionStrokes.map((stroke: { tool: string }) => stroke.tool), ["semantic", "interaction"]);
    assert.match(calls[0].instructions, /INTERACTION ANNOTATION CONTRACT/);
    assert.match(calls[0].instructions, /copy those definitions into your `algorithms` array with the SAME ids/);
  });
  await assert.rejects(runAI(requestSchema.parse({ intent: "compose", image, instruction: " ", ...context }), signal()), /Compose prompt/);
});

test("revision proposes a complete scene, keeps sketch regions of retained nodes and rejects no-op proposals", async () => {
  const scene = sampleScene(), annotations = [{ id: "a", points: [{ x: .1, y: .1 }, { x: .2, y: .2 }] }];
  const nodes = structuredClone(aiScene.nodes);
  nodes[0].region = { x: 0, y: 0, w: 1, h: 1 };
  nodes.push({ id: "leaves", kind: "collection", parentId: "tree", name: "Leaves", description: "잎", primitive: "group", region: { x: .6, y: .1, w: .2, h: .2 }, transformations: [{ id: "scatter", label: "Scatter", description: "", properties: [{ id: "count", label: "Count", effect: "spatial", description: "", value: num(12, 1, 40) }] }], machine: null });
  const input = requestSchema.parse({ intent: "revision", scene, image, previous: sceneProgram, annotations, instruction: "잎을 추가해줘" });
  await withMockedAI(() => ({ summary: "잎 collection 추가", algorithms: [], nodes }), async () => {
    const proposal = sceneProposalSchema.parse(await runAI(input, signal()));
    assert.ok(proposal.scene.nodes.some(node => node.id === "leaves"));
    assert.deepEqual(proposal.scene.nodes.find(node => node.id === "orb")!.region, scene.nodes.find(node => node.id === "orb")!.region);
  });
  await withMockedAI(() => ({ summary: "변경 없음", algorithms: [], nodes: aiScene.nodes }), async () => {
    await assert.rejects(runAI(input, signal()), /실제 변경 제안이 없습니다/);
  });
});

test("feature/rule-era intents are no longer accepted", () => {
  for (const intent of ["analyze", "rules", "subfeature", "brush"]) assert.equal(requestSchema.safeParse({ intent }).success, false);
});

// Seven petals listed one by one, plus a distinct center.
const petal = (i: number) => ({ id: `petal-${i}`, kind: "object" as const, parentId: "flower", name: `Petal ${i}`, description: "꽃잎", primitive: "petal",
  region: { x: .45 + .1 * Math.cos(i * Math.PI * 2 / 7), y: .45 + .15 * Math.sin(i * Math.PI * 2 / 7), w: .06, h: .09 },
  transformations: [{ id: "petal", label: "Petal", description: "", properties: [{ id: `color-${i}`, label: "Color", effect: "stylistic" as const, description: "", value: { type: "color" as const, value: "#d4708a" } }, { id: "size", label: "Size", effect: "spatial" as const, description: "", value: num(30 + i, 10, 80) }] }], machine: null });
const enumerated = { algorithms: [], nodes: [
  { id: "flower", kind: "collection" as const, parentId: null, name: "Flower", description: "꽃", primitive: "group", region: { x: .3, y: .2, w: .4, h: .6 }, transformations: [{ id: "radial-bloom", label: "Radial bloom", description: "", properties: [] }], machine: null },
  ...[1, 2, 3, 4, 5, 6, 7].map(petal),
  { id: "center", kind: "object" as const, parentId: "flower", name: "Center", description: "꽃술", primitive: "dot", region: { x: .47, y: .47, w: .06, h: .06 }, transformations: [{ id: "dot", label: "Dot", description: "", properties: [{ id: "color", label: "Color", effect: "stylistic" as const, description: "", value: { type: "color" as const, value: "#e0b030" } }] }], machine: null },
] };
const procedural = { algorithms: [{ id: "radial-repeat", name: "Radial repeat", description: "count개를 radius 원 위에 균등 각도로 배치", params: [{ id: "radius", label: "Radius", description: "", value: num(90, 0, 300) }] }], nodes: [
  enumerated.nodes[0], enumerated.nodes[8],
  { ...petal(1), id: "petals", name: "Petals", region: { x: .33, y: .25, w: .34, h: .5 }, transformations: [{ id: "radial-petals", label: "Radial petals", description: "", properties: [
    { id: "count", label: "Count", effect: "spatial" as const, description: "", value: num(7, 1, 24) },
    { id: "layout", label: "Layout", effect: "spatial" as const, description: "", value: { type: "algorithm" as const, algorithmId: "radial-repeat", args: [] } },
  ] }] },
] };

test("extraction must generate repeated elements procedurally: the model is asked to rewrite enumerated instances", async () => {
  await withMockedAI(body => body.input.length === 1 ? enumerated : procedural, async calls => {
    const scene = sceneSchema.parse(await runAI(requestSchema.parse({ intent: "extract", image }), signal()));
    assert.equal(calls.length, 2, "one repair round");
    assert.match(calls[1].input.at(-1).content[0].text, /PROCEDURAL ECONOMY VIOLATION[\s\S]*Petal 1, Petal 2/);
    assert.equal(calls[1].input[1].role, "assistant");
    assert.deepEqual(scene.nodes.map(node => node.id).sort(), ["center", "flower", "petals"]);
  });
  assert.match(loadPrompt("extract"), /PROCEDURAL ECONOMY/); assert.match(loadPrompt("compose"), /PROCEDURAL ECONOMY/);
  assert.match(loadPrompt("code"), /stands for MANY instances/);
});

test("if the repair round still enumerates, the instances collapse into one node with a repeat-layout property", async () => {
  await withMockedAI(() => enumerated, async calls => {
    const scene = sceneSchema.parse(await runAI(requestSchema.parse({ intent: "compose", image, instruction: "꽃" }), signal()));
    assert.equal(calls.length, 2);
    const petals = scene.nodes.filter(node => node.primitive === "petal");
    assert.equal(petals.length, 1); assert.equal(petals[0].name, "Petal ×7");
    const repetition = petals[0].transformations.at(-1)!;
    assert.equal(repetition.label, "Repetition", "repetition is stacked as its own semantic transformation");
    const repeat = repetition.properties.find(property => property.id === "repeat")!.value as AlgorithmCall;
    assert.equal(repeat.algorithmId, "repeat-layout");
    assert.deepEqual(repeat.args.slice(0, 2).map(arg => (arg.value as { value: unknown }).value), [7, "radial"]);
    assert.ok(scene.nodes.some(node => node.id === "center"), "distinct elements stay");
  });
});

test("revisions are checked only for newly added repetition", async () => {
  const scene = sceneSchema.parse(await withMockedAI(() => procedural, () => runAI(requestSchema.parse({ intent: "extract", image }), signal())));
  const input = requestSchema.parse({ intent: "revision", scene, image, previous: sceneProgram, annotations: [{ id: "a", points: [{ x: .1, y: .1 }, { x: .2, y: .2 }] }], instruction: "잎 추가" });
  const leaf = (i: number) => ({ id: `leaf-${i}`, kind: "object" as const, parentId: null, name: `Leaf ${i}`, description: "", primitive: "leaf", region: { x: .1 * i, y: .8, w: .05, h: .05 }, transformations: [{ id: "leaf", label: "Leaf", description: "", properties: [] }], machine: null });
  await withMockedAI(() => ({ summary: "잎 추가", algorithms: [], nodes: [...procedural.nodes, leaf(1), leaf(2), leaf(3)] }), async calls => {
    const proposal = sceneProposalSchema.parse(await runAI(input, signal()));
    assert.equal(calls.length, 2);
    assert.deepEqual(proposal.scene.nodes.filter(node => node.primitive === "leaf").map(node => node.name), ["Leaf ×3"]);
  });
});
