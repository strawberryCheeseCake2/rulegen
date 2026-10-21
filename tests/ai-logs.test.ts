import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runAI } from "../app/server/ai.server";
import { requestSchema } from "../app/lib/schema";
import { listGenerations, restoreGeneration, readGeneration } from "../app/server/ai-history.server";
import { recoveryContextSchema } from "../app/lib/generation-recovery";
import { projectSchema } from "../app/lib/project";
import { aiDecomposition, aiScene, sampleScene, sceneProgram } from "./fixtures/scene";

const root = await mkdtemp(path.join(tmpdir(), "rulegen-ai-logs-"));
const previous = { fetch: globalThis.fetch, key: process.env.OPENAI_API_KEY, directory: process.env.RULEGEN_AI_LOG_DIR };
const image = "data:image/png;base64,AAAA";
const output = aiDecomposition;
beforeEach(async () => {
  process.env.OPENAI_API_KEY = "test-key-secret-12345";
  process.env.RULEGEN_AI_LOG_DIR = root;
  await rm(root, { recursive: true, force: true });
});
after(async () => {
  globalThis.fetch = previous.fetch;
  for (const [key, value] of [["OPENAI_API_KEY", previous.key], ["RULEGEN_AI_LOG_DIR", previous.directory]]) {
    if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
  }
  await rm(root, { recursive: true, force: true });
});

async function folders() {
  const dates = await readdir(root);
  return (await Promise.all(dates.map(async date => (await readdir(path.join(root, date))).map(id => path.join(root, date, id))))).flat();
}
async function json(directory: string, filename: string) { return JSON.parse(await readFile(path.join(directory, filename), "utf8")); }
const response = () => Response.json({ id: "resp_test", usage: { input_tokens: 10, output_tokens: 20 }, output: [{ content: [{ type: "output_text", text: JSON.stringify(output) }] }] }, { headers: { "x-request-id": "req_test" } });

test("concurrent AI generations persist separate complete logs, original responses, normalized results and image assets", async () => {
  globalThis.fetch = async () => response();
  const input = requestSchema.parse({ intent: "decompose", image, instruction: "Inspect my sketch" });
  await Promise.all([runAI(input, new AbortController().signal), runAI(input, new AbortController().signal)]);
  const directories = await folders();
  assert.equal(directories.length, 2);
  for (const directory of directories) {
    const metadata = await json(directory, "log.json");
    assert.equal(metadata.status, "success"); assert.equal(metadata.intent, "decompose");
    assert.equal(metadata.openaiRequestId, "req_test"); assert.equal(metadata.responseId, "resp_test");
    assert.equal(metadata.usage.output_tokens, 20); assert.equal(metadata.httpStatus, 200);
    assert.ok(metadata.durationMs >= 0); assert.ok(metadata.finishedAt);
    const request = await json(directory, "request.json"), prompt = await json(directory, "prompt.json");
    assert.equal(request.image.file, "image-1.png");
    assert.equal(prompt.input[0].content[1].image_url.file, request.image.file);
    assert.deepEqual(await readFile(path.join(directory, request.image.file)), Buffer.from("AAAA", "base64"));
    assert.equal((await json(directory, "response.json")).output[0].content[0].text, JSON.stringify(output));
    assert.deepEqual((await json(directory, "result.json")).items.map((item: { transformation: { id: string } }) => item.transformation.id), ["radial-repetition", "petal-curl", "petal-curl-2"]);
    assert.equal((await json(directory, "result.json")).items[1].transformation.properties[0].value.type, "number");
    assert.equal((await stat(path.join(directory, "log.json"))).mode & 0o777, 0o600);
    const textFiles = (await readdir(directory)).filter(name => /\.(json|txt|js)$/.test(name));
    for (const file of textFiles) assert.equal((await readFile(path.join(directory, file), "utf8")).includes(process.env.OPENAI_API_KEY!), false);
  }
});

test("generated code artifact exactly matches the final code result", async () => {
  const code = { title: "Composition", explanation: "자국 조합", code: sceneProgram };
  globalThis.fetch = async () => Response.json({ output: [{ content: [{ type: "output_text", text: JSON.stringify(code) }] }] });
  const result = await runAI(requestSchema.parse({ intent: "code", scene: sampleScene(), image, instruction: "Compose marks" }), new AbortController().signal) as { code: string };
  const [directory] = await folders();
  assert.equal(await readFile(path.join(directory, "generated.js"), "utf8"), result.code);
  assert.match(result.code, /@rulegen-scene:start/);
  assert.deepEqual(await json(directory, "result.json"), result);
});

test("every AI intent logs its final validated result and restores", async () => {
  const scene = sampleScene();
  const code = { title: "Sketch", explanation: "나무", code: sceneProgram };
  const composed = { algorithms: aiScene.algorithms, nodes: aiScene.nodes.map(node => ({ ...node, pens: [] })) };
  const results: Record<string, unknown> = {
    decompose: aiDecomposition, compose: composed, code,
    transform: { algorithms: [], transformation: { id: "pulse", label: "Size", description: "", properties: [{ id: "radius", label: "Radius", effect: "spatial", description: "", value: { type: "number", value: 30, min: 10, max: 140, step: 1, unit: "px" } }] } },
    "compose-prompt": { prompt: "가지를 키우고 자유롭게 그린 배치와 조합해줘" },
  };
  for (const intent of Object.keys(results)) {
    globalThis.fetch = async () => Response.json({ output: [{ content: [{ type: "output_text", text: JSON.stringify(results[intent]) }] }] });
    await runAI(requestSchema.parse({ intent, image, scene, targetNodeId: "orb", targetPropertyId: intent === "transform" ? "radius" : "", previous: sceneProgram, instruction: "나무를 키워줘" }), new AbortController().signal);
  }
  const directories = await folders();
  assert.equal(directories.length, Object.keys(results).length);
  for (const directory of directories) {
    const log = await json(directory, "log.json"); assert.equal(log.status, "success", log.intent);
    assert.ok(await json(directory, "result.json"));
    const restored = await restoreGeneration(path.relative(root, directory));
    assert.ok(projectSchema.safeParse(restored.project).success, `restores ${log.intent}`);
  }
});

test("project snapshots, image assets and generated features restore exactly without a second AI request", async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return response(); };
  const artwork = { name: "Keep original", photo: image, strokes: [], revision: 3 };
  const project = projectSchema.parse({ version: 2, name: "History", artwork,
    sketchFrames: [{ id: "sketch-target", artwork: { ...artwork, name: "Target", revision: 7 } }, { id: "sketch-other", artwork }],
    workspace: { frames: { "sketch-target": { x: 3000, y: 200 } } },
  });
  const context = recoveryContextSchema.parse({ project, owner: "sketch-target" });
  await runAI(requestSchema.parse({ intent: "decompose", image }), new AbortController().signal, context);
  const history = await listGenerations(); assert.equal(history.entries.length, 1);
  const { key } = history.entries[0];
  const [directory] = await folders();
  assert.ok(await json(directory, "context.json")); assert.ok(await json(directory, "recovery.json"));
  const restored = await restoreGeneration(key);
  assert.equal(calls, 1); assert.equal(restored.project.activeSketchId, "sketch-target");
  assert.deepEqual(restored.project.artwork, project.artwork);
  assert.deepEqual(restored.project.sketchFrames.slice(0, 2), project.sketchFrames);
  assert.deepEqual(restored.project.workspace.frames["sketch-target"], { x: 3000, y: 200 });
  // The decomposition's minimal example frames come back, made from the target sketch, beside it.
  const examples = restored.project.sketchFrames.slice(2).map(frame => restored.project.sketchPanels[frame.id]);
  assert.equal(examples.length, 3); assert.ok(examples.every(panel => panel.role === "example" && panel.sourceFrameId === "sketch-target" && panel.analysisRevision === 7));
  assert.ok(restored.project.sketchFrames.slice(2).every(frame => restored.project.workspace.frames[frame.id].x > 3000));
  assert.deepEqual(restored.project.sketchPanels["sketch-other"], project.sketchPanels["sketch-other"]);
  assert.equal((await readGeneration(key)).metadata.status, "success");
  await assert.rejects(restoreGeneration("../../.env"), /로그 ID/);
  await assert.rejects(readGeneration(`${key}/../request.json`), /로그 ID/);
});

test("failed logs remain browsable and cannot be restored as completed output", async () => {
  globalThis.fetch = async () => Response.json({ error: "failure" }, { status: 401 });
  await assert.rejects(runAI(requestSchema.parse({ intent: "decompose", image }), new AbortController().signal));
  const history = await listGenerations(); const key = history.entries[0].key;
  assert.equal(history.entries[0].status, "failed");
  assert.ok((await readGeneration(key)).error);
  await assert.rejects(restoreGeneration(key), /완료된 AI 생성/);
});

test("upstream failures retain the provider response and redact keys without leaking it to the client", async () => {
  globalThis.fetch = async () => Response.json({ error: { message: `Bad key ${process.env.OPENAI_API_KEY}`, api_key: "another-secret" } }, { status: 401 });
  await assert.rejects(runAI(requestSchema.parse({ intent: "decompose", image }), new AbortController().signal), /API 키를 확인/);
  const [directory] = await folders();
  assert.equal((await json(directory, "log.json")).status, "failed");
  const raw = await json(directory, "response.json");
  assert.equal(raw.error.api_key, "[REDACTED]"); assert.match(raw.error.message, /\[REDACTED\]/);
  assert.match((await json(directory, "error.json")).message, /API 키를 확인/);
  assert.equal((await readdir(directory)).includes("result.json"), false);
});

test("malformed responses and invalid structured output remain inspectable with the original parse failure", async () => {
  for (const body of ["<html>not JSON</html>", JSON.stringify({ output: [{ content: [{ type: "output_text", text: '{"algorithms":[],"nodes":[]}' }] }] })]) {
    globalThis.fetch = async () => new Response(body);
    await assert.rejects(runAI(requestSchema.parse({ intent: "decompose", image }), new AbortController().signal), /응답을 해석/);
  }
  const directories = await folders();
  assert.equal(directories.length, 2);
  for (const directory of directories) {
    assert.equal((await json(directory, "log.json")).status, "failed");
    const error = await json(directory, "error.json"); assert.ok(error.cause);
    if (error.cause.name === "SyntaxError") assert.equal(await readFile(path.join(directory, "response.txt"), "utf8"), "<html>not JSON</html>");
    else assert.equal(error.cause.name, "ZodError");
  }
});

test("cancelled generations and preflight failures are recorded even without a response", async () => {
  const controller = new AbortController();
  globalThis.fetch = async () => { controller.abort(); throw new DOMException("Cancelled", "AbortError"); };
  await assert.rejects(runAI(requestSchema.parse({ intent: "decompose", image }), controller.signal), /취소/);
  await assert.rejects(runAI(requestSchema.parse({ intent: "decompose" }), new AbortController().signal), /이미지가 없습니다/);
  const directories = await folders();
  assert.equal(directories.length, 2);
  assert.deepEqual((await Promise.all(directories.map(directory => json(directory, "log.json")))).map(log => log.status).sort(), ["cancelled", "failed"]);
  for (const directory of directories) assert.equal((await readdir(directory)).includes("response.json"), false);
});

test("unwritable log destination prevents an unlogged AI call", async () => {
  const blocked = path.join(tmpdir(), `rulegen-blocked-log-${Date.now()}`);
  await writeFile(blocked, "file, not directory"); process.env.RULEGEN_AI_LOG_DIR = blocked;
  let calls = 0; globalThis.fetch = async () => { calls++; return response(); };
  try { await assert.rejects(runAI(requestSchema.parse({ intent: "decompose", image }), new AbortController().signal), /로그를 저장하지 못/); }
  finally { await rm(blocked, { force: true }); }
  assert.equal(calls, 0);
});
