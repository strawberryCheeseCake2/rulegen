import test, { after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { compositionPromptSchema, requestSchema, type Artwork } from "../app/lib/schema";
import { createInteractionPen, compositionContext } from "../app/lib/algorithm-pens";
import { makeAlgorithmPen } from "../app/lib/scene/pens";
import { setScalarAt } from "../app/lib/scene/values";
import { aiScene, sampleScene } from "./fixtures/scene";
import { projectSchema } from "../app/lib/project";
import { createSketchPanel, savedSketchPanels } from "../app/lib/sketch-panels";

const logDirectory = mkdtempSync(path.join(tmpdir(), "rulegen-semantic-tests-"));
const previousLogDirectory = process.env.RULEGEN_AI_LOG_DIR;
process.env.RULEGEN_AI_LOG_DIR = logDirectory;
after(() => { rmSync(logDirectory, { recursive: true, force: true }); if (previousLogDirectory === undefined) delete process.env.RULEGEN_AI_LOG_DIR; else process.env.RULEGEN_AI_LOG_DIR = previousLogDirectory; });

const scene = sampleScene();
const pen = makeAlgorithmPen(scene, { nodeId: "tree", propertyId: "structure" }, "source", "branch-pen", "#3b73c4");
const depth = (value: typeof pen) => (value.algorithm!.call.args.find(arg => arg.id === "depth")!.value as { value: number }).value;
const art: Artwork = { name: "Sketch", photo: null, revision: 1, strokes: [{ tool: "pen", color: pen.color, width: 3, opacity: .8, points: [{ x: 100, y: 150 }, { x: 700, y: 300 }], semanticPen: structuredClone(pen) }, { tool: "pen", color: "#75664e", width: 3, opacity: .8, points: [{ x: 80, y: 80 }, { x: 600, y: 500 }] }] };
const rawProject = { version: 2, name: "Semantic study", artwork: art, sketchPanels: { source: { scene } }, semanticPens: [pen], activeSemanticPenId: pen.id };

test("projects have an editable default Interaction pen alongside custom algorithm pens", () => {
  const old = projectSchema.parse(rawProject);
  assert.equal(old.interactionPen.kind, "interaction");
  assert.equal(old.interactionPen.name, "Interaction pen");
  assert.equal(old.semanticPens.length, 1);
  assert.equal(old.semanticPens[0].kind, "algorithm");
  const changed = { ...old.interactionPen, meaning: "원을 누르고 오른쪽 박스로 드래그하면 놓은 뒤 원이 정착합니다.", color: "#aa5533" };
  const restored = projectSchema.parse(JSON.parse(JSON.stringify({ ...old, interactionPen: changed, activeSemanticPenId: changed.id })));
  assert.deepEqual(restored.interactionPen, changed);
  assert.equal(restored.activeSemanticPenId, changed.id);
});

test("interaction annotations retain per-stroke meanings, geometry and eraser order through save and AI context", () => {
  const interaction = createInteractionPen();
  const changed = { ...interaction, meaning: "박스 위에 놓기" };
  const original = { ...art.strokes[0], semanticPen: interaction, color: interaction.color };
  const artwork = { ...art, strokes: [art.strokes[1], original, { ...original, semanticPen: changed }, { ...original, tool: "eraser" as const }] };
  const restored = projectSchema.parse(JSON.parse(JSON.stringify({ ...rawProject, artwork, interactionPen: changed })));
  const context = compositionContext(restored.artwork);
  assert.deepEqual(context.compositionStrokes.map(s => s.tool), ["pencil", "interaction", "interaction", "eraser"]);
  assert.equal(context.compositionPens[0].meaning, interaction.meaning);
  assert.equal(context.compositionPens[1].meaning, changed.meaning);
  assert.equal(context.compositionStrokes[1].points[0].x, 100 / 900);
  assert.notEqual(context.compositionStrokes[1].semanticPenId, context.compositionStrokes[2].semanticPenId);
  assert.equal(context.compositionStrokes[3].semanticPenId, null);
  assert.equal(requestSchema.safeParse({ intent: "compose", ...context }).success, true);
  assert.equal(requestSchema.safeParse({ intent: "compose", ...context, compositionPens: [] }).success, false);
  assert.equal(requestSchema.safeParse({ intent: "compose", ...context, compositionPens: context.compositionPens.map(p => ({ ...p, kind: "algorithm" })) }).success, false);
});

test("Make pen copies the chosen algorithm locally without producing drawing geometry", () => {
  assert.equal(pen.algorithm!.call.algorithmId, "recursive-branch"); assert.equal(depth(pen), 5);
  assert.deepEqual(pen.algorithm!.library.map(item => item.id).sort(), ["power-decay", "recursive-branch"]);
  assert.equal(pen.source.label, "Tree · Branching"); assert.equal(pen.meaning, scene.algorithms.find(item => item.id === "recursive-branch")!.description);
  assert.equal(pen.sourceSketchId, "source"); assert.equal("primitives" in pen, false); assert.equal("settings" in pen, false);
  assert.throws(() => makeAlgorithmPen(scene, { nodeId: "tree", propertyId: "missing" }, "source", "x", "#3b73c4"));
  assert.throws(() => makeAlgorithmPen(scene, { nodeId: "tree", propertyId: "ink" }, "source", "x", "#3b73c4"), /알고리즘/);
});

test("composition includes semantic snapshots and pencil marks with spatial and eraser order", () => {
  const context = compositionContext({ ...art, strokes: [...art.strokes, { ...art.strokes[0], points: [{ x: 200, y: 100 }, { x: 250, y: 300 }] }, { ...art.strokes[0], tool: "eraser", semanticPen: undefined }] });
  assert.equal(context.compositionPens.length, 1); assert.equal(context.compositionStrokes.length, 4);
  assert.deepEqual(context.compositionStrokes.map(s => s.tool), ["semantic", "pencil", "semantic", "eraser"]);
  assert.equal(context.compositionStrokes[0].semanticPenId, context.compositionStrokes[2].semanticPenId);
  assert.equal(context.compositionStrokes[1].semanticPenId, null); assert.equal(context.compositionStrokes[3].semanticPenId, null);
  assert.equal(context.compositionStrokes[0].points[0].x, 100 / 900); assert.equal(context.compositionStrokes[0].points[0].y, .25);
  assert.equal(requestSchema.safeParse({ intent: "compose", ...context }).success, true);
  assert.equal(requestSchema.safeParse({ intent: "compose", ...context, compositionPens: [] }).success, false);
});

test("edited and removed pens keep the semantics of existing strokes, with bounded point context", () => {
  const changed = { ...structuredClone(pen), meaning: "Grow deeper", algorithm: { ...pen.algorithm!, call: setScalarAt(pen.algorithm!.call, ["depth"], 7) as NonNullable<typeof pen.algorithm>["call"] } };
  const context = compositionContext({ ...art, strokes: [...art.strokes, { ...art.strokes[0], semanticPen: changed, points: Array.from({ length: 6000 }, (_, i) => ({ x: i / 5999 * 900, y: 400 })) }] });
  assert.equal(context.compositionPens.length, 2); assert.equal(depth(context.compositionPens[0]), 5); assert.equal(depth(context.compositionPens[1]), 7);
  assert.notEqual(context.compositionStrokes[0].semanticPenId, context.compositionStrokes[2].semanticPenId);
  assert.equal(context.compositionStrokes[2].points.length, 128); assert.equal(context.compositionStrokes[2].points.at(-1)?.x, 1);
  const restored = projectSchema.parse({ ...rawProject, semanticPens: [] }); assert.equal(compositionContext(restored.artwork).compositionPens[0].algorithm!.call.algorithmId, "recursive-branch");
});

test("semantic pens, normal strokes and per-sketch compose prompts survive project export", () => {
  const source = createSketchPanel(); source.composePrompt = "Power 펜은 점점 커지게, 연필 선을 따라 배치"; source.generationMode = "compose";
  const second = createSketchPanel(); second.composePrompt = "다른 스케치의 방향";
  const restored = projectSchema.parse(JSON.parse(JSON.stringify({ ...rawProject, sketchFrames: [{ id: "sketch-a", artwork: { ...art, name: "Other" } }], sketchPanels: savedSketchPanels({ source, "sketch-a": second }) })));
  assert.equal(restored.semanticPens[0].color, pen.color); assert.equal(restored.activeSemanticPenId, pen.id);
  assert.equal(restored.artwork.strokes[0].tool, "pen"); assert.equal(depth(restored.artwork.strokes[0].semanticPen!), 5);
  assert.equal(restored.sketchPanels.source.composePrompt, source.composePrompt); assert.equal(restored.sketchPanels["sketch-a"].composePrompt, second.composePrompt); assert.equal(restored.sketchPanels.source.generationMode, "compose");
});

test("projects from the previous format are rejected instead of half-migrated", () => {
  assert.equal(projectSchema.safeParse({ ...rawProject, version: 1 }).success, false);
  assert.equal(projectSchema.safeParse({ ...rawProject, semanticPens: [{ ...pen, algorithm: null }] }).success, false, "algorithm pens must carry an algorithm");
});

test("Compose sends freeform geometry, pen algorithms and the prompt to AI without requiring prior extraction", async () => {
  const { runAI } = await import("../app/server/ai.server");
  const previousFetch = globalThis.fetch, previousKey = process.env.OPENAI_API_KEY; process.env.OPENAI_API_KEY = "test-placeholder";
  let payload: any;
  globalThis.fetch = async (_url, options) => { payload = JSON.parse(String(options?.body)); return Response.json({ output: [{ content: [{ type: "output_text", text: JSON.stringify(aiScene) }] }] }); };
  try {
    const context = compositionContext(art), image = "data:image/png;base64,YQ==";
    const result = await runAI(requestSchema.parse({ intent: "compose", image, ...context, instruction: "Power를 증가 패턴으로 만들고 연필 경로와 조합" }), new AbortController().signal) as { nodes: { id: string }[] };
    const sent = JSON.parse(payload.input[0].content[0].text); assert.equal(sent.instruction, "Power를 증가 패턴으로 만들고 연필 경로와 조합"); assert.equal(depth(sent.compositionPens[0]), 5); assert.equal(sent.compositionPens[0].algorithm.call.algorithmId, "recursive-branch"); assert.equal(sent.compositionStrokes[1].tool, "pencil"); assert.equal(payload.input[0].content[1].image_url, image);
    assert.match(payload.instructions, /ordinary pencil line/); assert.match(payload.instructions, /jointly describe/); assert.deepEqual(result.nodes.map(node => node.id), ["tree", "orb"]);
    assert.equal(payload.text.format.name, "rulegen_compose"); assert.deepEqual(payload.text.format.schema.required.sort(), Object.keys(payload.text.format.schema.properties).sort());
    await assert.rejects(runAI(requestSchema.parse({ intent: "compose", ...context, instruction: "Compose" }), new AbortController().signal), /스케치/);
  } finally { globalThis.fetch = previousFetch; if (previousKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previousKey; }
});

test("AI drafts an editable Compose prompt from the image and stored stroke semantics without user text or feature analysis", async () => {
  const { runAI } = await import("../app/server/ai.server");
  const previousFetch = globalThis.fetch, previousKey = process.env.OPENAI_API_KEY; process.env.OPENAI_API_KEY = "test-placeholder";
  let payload: any;
  const prompt = "Power 펜의 exponent 2로 점점 커지는 패턴을 만들고, 연필로 그린 곡선을 따라 배치해줘.";
  globalThis.fetch = async (_url, options) => { payload = JSON.parse(String(options?.body)); return Response.json({ output: [{ content: [{ type: "output_text", text: JSON.stringify({ prompt }) }] }] }); };
  try {
    const context = compositionContext({ ...art, strokes: [...art.strokes, { ...art.strokes[0], tool: "eraser", semanticPen: undefined }] });
    const image = "data:image/png;base64,YQ==";
    const input = requestSchema.parse({ intent: "compose-prompt", image, ...context });
    const result = compositionPromptSchema.parse(await runAI(input, new AbortController().signal));
    assert.equal(result.prompt, prompt);
    const sent = JSON.parse(payload.input[0].content[0].text);
    assert.equal(sent.instruction, ""); assert.equal(sent.features, undefined);
    assert.equal(depth(sent.compositionPens[0]), 5);
    assert.deepEqual(sent.compositionStrokes.map((s: { tool: string }) => s.tool), ["semantic", "pencil", "eraser"]);
    assert.equal(payload.input[0].content[1].image_url, image);
    assert.match(payload.instructions, /editable Korean composition prompt/); assert.match(payload.instructions, /No code/);
    assert.equal(payload.text.format.name, "rulegen_compose-prompt"); assert.equal(payload.max_output_tokens, 2000);
    const edited = "같은 Power exponent를 유지하면서 더 작게 배치해줘";
    await runAI(requestSchema.parse({ ...input, instruction: edited }), new AbortController().signal);
    assert.equal(JSON.parse(payload.input[0].content[0].text).instruction, edited);
    await assert.rejects(runAI(requestSchema.parse({ intent: "compose-prompt" }), new AbortController().signal), /스케치 이미지/);
    globalThis.fetch = async () => Response.json({ output: [{ content: [{ type: "output_text", text: '{"prompt":"  "}' }] }] });
    await assert.rejects(runAI(input, new AbortController().signal), /응답을 해석/);
  } finally { globalThis.fetch = previousFetch; if (previousKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previousKey; }
});
