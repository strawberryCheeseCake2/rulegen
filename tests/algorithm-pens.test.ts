import test, { after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { compositionPromptSchema, requestSchema, type Artwork } from "../app/lib/schema";
import { createInteractionPen, compositionContext, examplePen } from "../app/lib/algorithm-pens";
import { exampleScene, convertDecomposition } from "../app/lib/scene/minimal-example";
import { num } from "./fixtures/scene";
import { projectSchema } from "../app/lib/project";

const logDirectory = mkdtempSync(path.join(tmpdir(), "rulegen-semantic-tests-"));
const previousLogDirectory = process.env.RULEGEN_AI_LOG_DIR;
process.env.RULEGEN_AI_LOG_DIR = logDirectory;
after(() => { rmSync(logDirectory, { recursive: true, force: true }); if (previousLogDirectory === undefined) delete process.env.RULEGEN_AI_LOG_DIR; else process.env.RULEGEN_AI_LOG_DIR = previousLogDirectory; });

const parts = convertDecomposition({ algorithms: [], transformations: [{ id: "edge-jitter", label: "Edge jitter", description: "윤곽이 흔들립니다.", subject: { kind: "object", name: "Blob", description: "", primitive: "blob" }, member: null,
  region: { x: .2, y: .2, w: .3, h: .3 }, properties: [{ id: "amount", label: "Amount", effect: "spatial", description: "", value: num(5, 0, 20) }] }] });
const example = exampleScene(parts, parts.items[0]);
const pen = examplePen(example.scene, "sketch-ex", example.example, "jitter-pen", "#3b73c4")!;
const art: Artwork = { name: "Sketch", photo: null, revision: 1, strokes: [{ tool: "pen", color: pen.color, width: 3, opacity: .8, points: [{ x: 100, y: 150 }, { x: 700, y: 300 }], semanticPen: structuredClone(pen) }, { tool: "pen", color: "#75664e", width: 3, opacity: .8, points: [{ x: 80, y: 80 }, { x: 600, y: 500 }] }] };
const rawProject = { version: 2, name: "Semantic study", artwork: art, semanticPens: [pen], activeSemanticPenId: pen.id };

test("projects have an editable default Interaction pen alongside transformation pens", () => {
  const old = projectSchema.parse(rawProject);
  assert.equal(old.interactionPen.kind, "interaction");
  assert.equal(old.interactionPen.name, "Interaction pen");
  assert.equal(old.semanticPens.length, 1);
  assert.equal(old.semanticPens[0].kind, "transformation");
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
  assert.equal(requestSchema.safeParse({ intent: "compose", ...context, compositionPens: context.compositionPens.map(p => ({ ...p, kind: "transformation" })) }).success, false, "a transformation pen needs its transformation");
});

test("AI drafts an editable Compose prompt from the image and the pens' transformations without user text", async () => {
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
    const sent = JSON.parse(payload.input[0].content[0].text), strokes = JSON.parse(payload.input[0].content[2].text);
    assert.equal(sent.instruction, ""); assert.equal(sent.features, undefined);
    assert.equal(strokes.compositionPens[0].transformation.label, "Edge jitter"); assert.equal(strokes.compositionPens[0].transformation.properties[0].value.value, 5);
    assert.deepEqual(strokes.compositionStrokes.map((s: { tool: string }) => s.tool), ["semantic", "pencil", "eraser"]);
    assert.equal(payload.input[0].content[1].image_url, image);
    assert.match(payload.instructions, /editable Korean composition prompt/); assert.match(payload.instructions, /transformation pen/); assert.match(payload.instructions, /No code/);
    assert.equal(payload.text.format.name, "rulegen_compose-prompt"); assert.equal(payload.max_output_tokens, 2000);
    const edited = "같은 Power exponent를 유지하면서 더 작게 배치해줘";
    await runAI(requestSchema.parse({ ...input, instruction: edited }), new AbortController().signal);
    assert.equal(JSON.parse(payload.input[0].content[0].text).instruction, edited);
    await assert.rejects(runAI(requestSchema.parse({ intent: "compose-prompt" }), new AbortController().signal), /스케치 이미지/);
    globalThis.fetch = async () => Response.json({ output: [{ content: [{ type: "output_text", text: '{"prompt":"  "}' }] }] });
    await assert.rejects(runAI(input, new AbortController().signal), /응답을 해석/);
  } finally { globalThis.fetch = previousFetch; if (previousKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previousKey; }
});
