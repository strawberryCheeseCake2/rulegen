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
import { createInteractionPen, compositionContext } from "../app/lib/semantic-pens";
import { makeConstraintPen } from "../app/lib/scene/pens";
import { convertScene } from "../app/lib/scene/convert";

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
  await assert.rejects(runAI(requestSchema.parse({ intent: "extract" }), signal()), /There is no image to analyze/);
});

test("transform regenerates one param (or the whole constraint)", async () => {
  const scene = sampleScene();
  const constraint = { id: "pulse", property: "size", description: "", params: [{ id: "radius", label: "Radius", effect: "spatial", description: "", value: num(40, 5, 200, 1, "px") }], inputs: [], drags: [] };
  await withMockedAI(() => ({ constraint }), async calls => {
    const next = sceneSchema.parse(await runAI(requestSchema.parse({ intent: "transform", scene, targetNodeId: "orb", targetParamId: "radius" }), signal()));
    const orb = next.nodes.find(node => node.id === "orb")!;
    assert.deepEqual(orb.constraints[0].params[0].value, num(40, 5, 200, 1, "px"));
    assert.equal(orb.constraints[1].params[0].id, "speed", "other params are preserved");
    assert.deepEqual(orb.machine!.states.map(state => state.constraintIds), [["pulse"], ["pulse", "drift"]], "the states still evaluate the regenerated constraint");
    const context = JSON.parse(calls[0].input[0].content[0].text);
    assert.equal(context.targetNodeId, "orb"); assert.equal(context.targetParamId, "radius"); assert.equal("algorithms" in context.scene, false);
  });
  await withMockedAI(() => ({ constraint: { ...constraint, params: [{ ...constraint.params[0], id: "other", value: num(1, 0, 2) }] } }), async () => {
    await assert.rejects(runAI(requestSchema.parse({ intent: "transform", scene, targetNodeId: "orb", targetParamId: "radius" }), signal()), /does not match the selection/);
  });
  await assert.rejects(runAI(requestSchema.parse({ intent: "transform", scene, targetNodeId: "missing" }), signal()), /Could not find the target Collection or Object/);
});

test("AI adds a new stacked constraint or replaces one in place, keeping param ids unique per node", async () => {
  const scene = sampleScene();
  const sway = { id: "wind-sway", property: "sway", description: "바람에 흔들림", params: [
    { id: "ink", label: "Sway", effect: "temporal", description: "", value: { type: "toggle", value: true } },
  ], inputs: [{ source: "speed" as const, paramId: "ink", how: "faster drags sway more" }, { source: "x" as const, paramId: "structure", how: "not its own" }, { source: "speed" as const, paramId: "ink", how: "twice" }],
    drags: [{ paramId: "ink", source: "x" as const, mode: "ratio" as const, invert: false, how: "a toggle is not a number to drag" }] };
  await withMockedAI(() => ({ constraint: sway }), async calls => {
    const added = sceneSchema.parse(await runAI(requestSchema.parse({ intent: "transform", scene, targetNodeId: "tree" }), signal()));
    const tree = added.nodes.find(node => node.id === "tree")!;
    assert.deepEqual(tree.constraints.map(item => item.id), ["branching-growth", "ink-wash", "wind-sway"], "appended after the existing ones");
    assert.equal(tree.constraints[2].params[0].id, "ink-2", "a colliding param id is renamed");
    // What the mouse drives follows the renamed param; a mapping to another constraint's value (or twice) is dropped.
    assert.deepEqual(tree.constraints[2].inputs, [{ source: "speed", paramId: "ink-2", how: "faster drags sway more" }]);
    assert.deepEqual(tree.constraints[2].drags, [], "a drag adjusts a number only");
    assert.equal(JSON.parse(calls[0].input[0].content[0].text).mode, "add");
    const replaced = sceneSchema.parse(await runAI(requestSchema.parse({ intent: "transform", scene, targetNodeId: "tree", targetConstraintId: "ink-wash" }), signal()));
    const next = replaced.nodes.find(node => node.id === "tree")!;
    assert.deepEqual(next.constraints.map(item => [item.id, item.property]), [["branching-growth", "branches"], ["ink-wash", "sway"]], "replaced in place, id kept");
    assert.equal(next.constraints[1].params[0].id, "ink", "its own old ids are free to reuse");
    assert.equal(JSON.parse(calls[1].input[0].content[0].text).mode, "replace");
    // The user's text and the annotation drawn on the frame go with the request.
    await runAI(requestSchema.parse({ intent: "transform", scene, targetNodeId: "tree", targetConstraintId: "ink-wash", instruction: "더 번지게", transformMarks: [[{ x: .2, y: .3 }, { x: .4, y: .5 }]], image: "data:image/png;base64,AAAA" }), signal());
    const context = JSON.parse(calls[2].input[0].content[0].text);
    assert.equal(context.instruction, "더 번지게");
    assert.deepEqual(context.annotationMarks, [[{ x: .2, y: .3 }, { x: .4, y: .5 }]]);
    assert.match(calls[2].instructions, /annotationMarks/);
  });
  assert.match(loadPrompt("transform"), /"add"[\s\S]*"replace"[\s\S]*"param"/);
  assert.match(loadPrompt("extract"), /CONSTRAINTS \(required\)[\s\S]*`property` — EXACTLY the name of the property it controls/);
  assert.match(loadPrompt("code"), /IN THE STATE'S ORDER/);
  const full = { ...scene, nodes: scene.nodes.map(node => node.id === "tree" ? { ...node, constraints: Array.from({ length: 16 }, (_, i) => ({ id: `t${i}`, property: "p", description: "", params: [] })) } : node) };
  await assert.rejects(runAI(requestSchema.parse({ intent: "transform", scene: full, targetNodeId: "tree" }), signal()), /No more constraints can be added/);
});

test("extracted nodes may carry several constraints; duplicate ids from the model are made unique", () => {
  const nodes = structuredClone(aiScene.nodes);
  nodes[1].constraints.push({ id: "pulse", property: "Glow", description: "", params: [{ id: "radius", label: "Glow radius", effect: "stylistic", description: "", value: num(4, 0, 10) }], inputs: [], drags: [] });
  const scene = convertScene({ nodes });
  const orb = scene.nodes.find(node => node.id === "orb")!;
  assert.deepEqual(orb.constraints.map(item => item.id), ["pulse", "drift", "pulse-2"]);
  assert.deepEqual(orb.constraints.map(item => item.params.map(param => param.id)), [["radius"], ["speed"], ["radius-2"]]);
  assert.deepEqual(orb.machine!.states.map(state => state.constraintIds), [["pulse"], ["pulse", "drift"]], "the states keep pointing at the first one");
});

test("state machines are planned per collection/object: states order the node's constraints (new ones come with the machine), validated against them", async () => {
  const scene = sampleScene();
  const machine = { initialState: "rest", states: [
    { id: "rest", label: "쉬기", description: "", constraintIds: ["branching-growth", "ink-wash"] },
    { id: "grow", label: "자라기", description: "", constraintIds: ["branching-growth", "ink-green"] },
  ], transitions: [{ id: "grown", from: "grow", to: "rest", event: "grown", label: "성장 완료" }, { id: "tap", from: "rest", to: "grow", event: "tap", label: "나무 탭" }] };
  // Growing needs its own color relation: a new constraint comes with the machine (a colliding param id is renamed).
  const green = { id: "ink-green", property: "color", description: "자라는 동안 초록", params: [{ id: "ink", label: "Green", effect: "stylistic", description: "", value: { type: "color", value: "#228844" } }], inputs: [], drags: [] };
  await withMockedAI(() => ({ constraints: [green], machine }), async calls => {
    const next = sceneSchema.parse(await runAI(requestSchema.parse({ intent: "state-machine", scene, targetNodeId: "tree", image, instruction: "탭하면 자라기" }), signal()));
    const tree = next.nodes.find(node => node.id === "tree")!;
    assert.equal(tree.machine!.states.length, 2);
    assert.deepEqual(tree.constraints.map(item => [item.id, item.property, item.params.map(param => param.id)]), [["branching-growth", "branches", ["structure", "base-length", "ratio"]], ["ink-wash", "color", ["ink"]], ["ink-green", "color", ["ink-2"]]]);
    assert.deepEqual(tree.machine!.states[1].constraintIds, ["branching-growth", "ink-green"]);
    assert.equal(next.nodes.find(node => node.id === "orb")!.machine!.initialState, "idle", "other nodes keep their own machines");
    assert.match(calls[0].instructions, /FINE-GRAINED STATE PLANNING/);
    assert.equal(calls[0].max_output_tokens, 32000);
    assert.equal(calls[0].text.format.schema.properties.machine.properties.states.maxItems, 32);
  });
  await withMockedAI(() => ({ constraints: [], machine: { ...machine, states: [machine.states[0], { ...machine.states[1], constraintIds: ["pulse"] }] } }), async () => {
    await assert.rejects(runAI(requestSchema.parse({ intent: "state-machine", scene, targetNodeId: "tree" }), signal()), /refers to a constraint that does not exist/);
  });
  await withMockedAI(() => ({ constraints: [green], machine: { ...machine, transitions: [...machine.transitions, { id: "tap-again", from: "rest", to: "rest", event: "tap", label: "다시 탭" }] } }), async () => {
    await assert.rejects(runAI(requestSchema.parse({ intent: "state-machine", scene, targetNodeId: "tree" }), signal()), /same event/);
  });
});

test("code receives every nested binding and returns a connected, executable sketch", async () => {
  const scene = sampleScene();
  await withMockedAI(() => ({ title: "Tree", explanation: "나무", code: sceneProgram }), async calls => {
    const generated = generatedSchema.parse(await runAI(requestSchema.parse({ intent: "code", scene, image, instruction: "" }), signal()));
    const context = JSON.parse(calls[0].input[0].content[0].text);
    assert.deepEqual(context.parameterBindings.map((binding: { key: string }) => binding.key), ["tree/structure", "tree/base-length", "tree/ratio", "tree/ink", "orb/radius", "orb/speed"]);
    assert.match(calls[0].instructions, /SCENE CODE CONTRACT/);
    assert.equal(generated.sceneBindings.length, 6);
    assert.match(generated.code, /@rulegen-scene-driver/);
    assert.deepEqual(context.modules, [{ key: "tree", nodes: ["tree", "orb"] }], "one module per root node");
  });
  await withMockedAI(() => ({ title: "Tree", explanation: "나무", code: "p.setup=()=>{p.createCanvas(900,600);}" }), async () => {
    await assert.rejects(runAI(requestSchema.parse({ intent: "code", scene }), signal()), /rulegenModule/);
  });
  await assert.rejects(runAI(requestSchema.parse({ intent: "code", scene: { nodes: [] } }), signal()), /Extract collections and objects from the sketch first/);
});

test("compose turns pen strokes into a scene that adapts the pen's constraint; interaction marks add the interaction contract", async () => {
  const pen = makeConstraintPen(sampleScene(), "tree", "branching-growth", "source", "branch-pen", "#3b73c4");
  const interaction = createInteractionPen();
  const context = compositionContext({ name: "Sketch", photo: null, revision: 1, strokes: [
    { tool: "pen", color: pen.color, width: 3, opacity: 1, points: [{ x: 100, y: 500 }, { x: 450, y: 100 }], semanticPen: pen },
    { tool: "pen", color: interaction.color, width: 3, opacity: 1, points: [{ x: 400, y: 120 }, { x: 420, y: 140 }], semanticPen: interaction },
  ] });
  await withMockedAI(() => aiScene, async calls => {
    const scene = sceneSchema.parse(await runAI(requestSchema.parse({ intent: "compose", image, instruction: "가지 펜으로 나무를 만들고 원을 누르면 움직이게", ...context }), signal()));
    assert.deepEqual(scene.nodes.map(node => node.id), ["tree", "orb"]);
    const sent = JSON.parse(calls[0].input[0].content[0].text);
    assert.equal(sent.compositionPens[0].constraint.label, "branches");
    assert.deepEqual(sent.compositionStrokes.map((stroke: { tool: string }) => stroke.tool), ["semantic", "interaction"]);
    assert.match(calls[0].instructions, /INTERACTION ANNOTATION CONTRACT/);
    // Pens are read for what the sketch shows them driving (re-targeted, read together), not pasted onto their origin.
    assert.match(calls[0].instructions, /READING SEMANTIC PENS: INTENT, NOT LITERAL ORDERS/); assert.match(calls[0].instructions, /RE-TARGET/);
    assert.match(loadPrompt("compose-prompt"), /READING SEMANTIC PENS/);
  });
  await assert.rejects(runAI(requestSchema.parse({ intent: "compose", image, instruction: " ", ...context }), signal()), /Compose prompt/);
});

test("revision proposes a complete scene, keeps sketch regions of retained nodes and rejects no-op proposals", async () => {
  const scene = sampleScene(), annotations = [{ id: "a", points: [{ x: .1, y: .1 }, { x: .2, y: .2 }] }];
  const nodes = structuredClone(aiScene.nodes);
  nodes[0].region = { x: 0, y: 0, w: 1, h: 1 };
  nodes.push({ id: "leaves", kind: "collection", parentId: "tree", name: "Leaves", description: "잎", primitive: "group", region: { x: .6, y: .1, w: .2, h: .2 }, constraints: [{ id: "scatter", property: "Scatter", description: "", params: [{ id: "count", label: "Count", effect: "spatial", description: "", value: num(12, 1, 40) }], inputs: [], drags: [] }], machine: null });
  const input = requestSchema.parse({ intent: "revision", scene, image, previous: sceneProgram, annotations, instruction: "잎을 추가해줘" });
  await withMockedAI(() => ({ summary: "잎 collection 추가", nodes }), async () => {
    const proposal = sceneProposalSchema.parse(await runAI(input, signal()));
    assert.ok(proposal.scene.nodes.some(node => node.id === "leaves"));
    assert.deepEqual(proposal.scene.nodes.find(node => node.id === "orb")!.region, scene.nodes.find(node => node.id === "orb")!.region);
  });
  await withMockedAI(() => ({ summary: "변경 없음", nodes: aiScene.nodes }), async () => {
    await assert.rejects(runAI(input, signal()), /No actual changes were proposed/);
  });
});

test("feature/rule-era intents are no longer accepted", () => {
  for (const intent of ["analyze", "rules", "subfeature", "brush"]) assert.equal(requestSchema.safeParse({ intent }).success, false);
});



