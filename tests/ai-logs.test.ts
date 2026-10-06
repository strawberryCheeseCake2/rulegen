import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runAI } from "../app/server/ai.server";
import { requestSchema } from "../app/lib/schema";

const root = await mkdtemp(path.join(tmpdir(), "rulegen-ai-logs-"));
const previous = { fetch: globalThis.fetch, key: process.env.OPENAI_API_KEY, directory: process.env.RULEGEN_AI_LOG_DIR };
const image = "data:image/png;base64,AAAA";
const feature = { id: "original", label: "Curve", description: "곡선", region: { x: .9, y: .2, w: .5, h: .5 } };
const output = { features: [feature, { ...feature, id: "second", label: "Rhythm" }] };
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
  const input = requestSchema.parse({ intent: "analyze", image, instruction: "Inspect my sketch" });
  await Promise.all([runAI(input, new AbortController().signal), runAI(input, new AbortController().signal)]);
  const directories = await folders();
  assert.equal(directories.length, 2);
  for (const directory of directories) {
    const metadata = await json(directory, "log.json");
    assert.equal(metadata.status, "success"); assert.equal(metadata.intent, "analyze");
    assert.equal(metadata.openaiRequestId, "req_test"); assert.equal(metadata.responseId, "resp_test");
    assert.equal(metadata.usage.output_tokens, 20); assert.equal(metadata.httpStatus, 200);
    assert.ok(metadata.durationMs >= 0); assert.ok(metadata.finishedAt);
    const request = await json(directory, "request.json"), prompt = await json(directory, "prompt.json");
    assert.equal(request.image.file, "image-1.png");
    assert.equal(prompt.input[0].content[1].image_url.file, request.image.file);
    assert.deepEqual(await readFile(path.join(directory, request.image.file)), Buffer.from("AAAA", "base64"));
    assert.equal((await json(directory, "response.json")).output[0].content[0].text, JSON.stringify(output));
    assert.equal((await json(directory, "result.json")).features[0].id, "feature-1");
    assert.ok((await json(directory, "result.json")).features[0].region.w < .11);
    assert.equal((await stat(path.join(directory, "log.json"))).mode & 0o777, 0o600);
    const textFiles = (await readdir(directory)).filter(name => /\.(json|txt|js)$/.test(name));
    for (const file of textFiles) assert.equal((await readFile(path.join(directory, file), "utf8")).includes(process.env.OPENAI_API_KEY!), false);
  }
});

test("generated code artifact exactly matches the final code result", async () => {
  const code = { title: "Composition", explanation: "자국 조합", code: "p.setup=()=>{p.createCanvas(900,600);p.background(250);p.circle(100,100,50);p.noLoop();}" };
  globalThis.fetch = async () => Response.json({ output: [{ content: [{ type: "output_text", text: JSON.stringify(code) }] }] });
  const result = await runAI(requestSchema.parse({ intent: "compose", image, instruction: "Compose marks" }), new AbortController().signal);
  const [directory] = await folders();
  assert.equal(await readFile(path.join(directory, "generated.js"), "utf8"), code.code);
  assert.deepEqual(await json(directory, "result.json"), result);
});

test("every AI intent logs its final validated result and clarification retains both input images", async () => {
  const source = { ...feature, region: { x: .1, y: .1, w: .5, h: .5 } };
  const subfeature = { id: "shape", label: "Shape", selectedImplementation: "curve", implementations: [{ id: "curve", label: "Curve", description: "Curved form", parameters: [] }] };
  const groups = [{ featureId: source.id, title: "Curve", subfeatures: [subfeature] }];
  const code = { title: "Sketch", explanation: "곡선", code: "p.setup=()=>{p.createCanvas(900,600);p.background(250);p.circle(100,100,50);p.noLoop();}" };
  const annotations = [{ id: "annotation", points: [{ x: .1, y: .1 }, { x: .3, y: .3 }] }];
  const results = {
    analyze: output, rules: { groups }, subfeature, code, compose: code,
    clarification: { clarification: "곡선을 키워줘" },
    "compose-prompt": { prompt: "곡선을 키우고 자유롭게 그린 배치와 조합해줘" },
    revision: { summary: "곡선을 키웁니다", features: [{ ...source, description: "큰 곡선" }], groups },
    brush: { name: "Curve", description: "곡선 브러시", settings: { size: 30, spacing: 10, spread: 0, variation: 0, taper: 0, color: "#334455" }, primitives: [{ kind: "ellipse", coords: [0, 0, 1, 1], weight: .05, filled: false, depth: 0 }] },
  };
  for (const intent of requestSchema.shape.intent.options) {
    globalThis.fetch = async () => Response.json({ output: [{ content: [{ type: "output_text", text: JSON.stringify(results[intent]) }] }] });
    await runAI(requestSchema.parse({ intent, image, resultImage: "data:image/jpeg;base64,AQID", features: [source], groups, previous: code.code, annotations, instruction: "곡선을 키워줘", targetFeatureId: source.id, targetSubfeatureId: subfeature.id }), new AbortController().signal);
  }
  const directories = await folders();
  assert.equal(directories.length, requestSchema.shape.intent.options.length);
  for (const directory of directories) {
    const log = await json(directory, "log.json"); assert.equal(log.status, "success");
    assert.ok(await json(directory, "result.json"));
    if (log.intent === "clarification") {
      const request = await json(directory, "request.json");
      const images = (await json(directory, "prompt.json")).input[0].content.filter((part: { type: string }) => part.type === "input_image");
      assert.deepEqual(images.map((part: { image_url: { file: string } }) => part.image_url.file), [request.resultImage.file, request.image.file]);
      assert.deepEqual(await readFile(path.join(directory, request.resultImage.file)), Buffer.from("AQID", "base64"));
    }
  }
});

test("upstream failures retain the provider response and redact keys without leaking it to the client", async () => {
  globalThis.fetch = async () => Response.json({ error: { message: `Bad key ${process.env.OPENAI_API_KEY}`, api_key: "another-secret" } }, { status: 401 });
  await assert.rejects(runAI(requestSchema.parse({ intent: "analyze", image }), new AbortController().signal), /API 키를 확인/);
  const [directory] = await folders();
  assert.equal((await json(directory, "log.json")).status, "failed");
  const raw = await json(directory, "response.json");
  assert.equal(raw.error.api_key, "[REDACTED]"); assert.match(raw.error.message, /\[REDACTED\]/);
  assert.match((await json(directory, "error.json")).message, /API 키를 확인/);
  assert.equal((await readdir(directory)).includes("result.json"), false);
});

test("malformed responses and invalid structured output remain inspectable with the original parse failure", async () => {
  for (const body of ["<html>not JSON</html>", JSON.stringify({ output: [{ content: [{ type: "output_text", text: '{"features":[]}' }] }] })]) {
    globalThis.fetch = async () => new Response(body);
    await assert.rejects(runAI(requestSchema.parse({ intent: "analyze", image }), new AbortController().signal), /응답을 해석/);
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
  await assert.rejects(runAI(requestSchema.parse({ intent: "analyze", image }), controller.signal), /취소/);
  await assert.rejects(runAI(requestSchema.parse({ intent: "analyze" }), new AbortController().signal), /이미지가 없습니다/);
  const directories = await folders();
  assert.equal(directories.length, 2);
  assert.deepEqual((await Promise.all(directories.map(directory => json(directory, "log.json")))).map(log => log.status).sort(), ["cancelled", "failed"]);
  for (const directory of directories) assert.equal((await readdir(directory)).includes("response.json"), false);
});

test("unwritable log destination prevents an unlogged AI call", async () => {
  const blocked = path.join(tmpdir(), `rulegen-blocked-log-${Date.now()}`);
  await writeFile(blocked, "file, not directory"); process.env.RULEGEN_AI_LOG_DIR = blocked;
  let calls = 0; globalThis.fetch = async () => { calls++; return response(); };
  try { await assert.rejects(runAI(requestSchema.parse({ intent: "analyze", image }), new AbortController().signal), /로그를 저장하지 못/); }
  finally { await rm(blocked, { force: true }); }
  assert.equal(calls, 0);
});
