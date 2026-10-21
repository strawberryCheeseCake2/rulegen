import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { aiDecomposition } from "./fixtures/scene";
import { requestSchema } from "../app/lib/schema";

const root = mkdtempSync(path.join(tmpdir(), "rulegen-errors-"));
const saved = { ai: process.env.RULEGEN_AI_LOG_DIR, errors: process.env.RULEGEN_ERROR_LOG_DIR, base: process.env.RULEGEN_AI_RETRY_BASE_MS, key: process.env.OPENAI_API_KEY, fetch: globalThis.fetch };
process.env.RULEGEN_AI_LOG_DIR = path.join(root, "ai"); process.env.RULEGEN_ERROR_LOG_DIR = path.join(root, "errors"); process.env.RULEGEN_AI_RETRY_BASE_MS = "1";
process.env.OPENAI_API_KEY = "sk-test-secret-key-123456";
after(() => {
  rmSync(root, { recursive: true, force: true }); globalThis.fetch = saved.fetch;
  for (const [name, value] of [["RULEGEN_AI_LOG_DIR", saved.ai], ["RULEGEN_ERROR_LOG_DIR", saved.errors], ["RULEGEN_AI_RETRY_BASE_MS", saved.base], ["OPENAI_API_KEY", saved.key]] as const) if (value === undefined) delete process.env[name]; else process.env[name] = value;
});
const image = "data:image/png;base64,AAAA";
const overloaded = () => Response.json({ error: { message: "Our servers are currently overloaded.", type: "service_unavailable_error", code: "server_is_overloaded" } }, { status: 503 });
const success = () => Response.json({ output: [{ content: [{ type: "output_text", text: JSON.stringify(aiDecomposition) }] }] });
const files = (dir: string): string[] => { try { return readdirSync(dir, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile()).map(entry => path.join(entry.parentPath, entry.name)); } catch { return []; } };
const errorFiles = () => files(path.join(root, "errors")).filter(file => file.endsWith(".json"));
const read = (file: string) => JSON.parse(readFileSync(file, "utf8"));

test("an overloaded OpenAI server (503) is retried with backoff and the generation succeeds", async () => {
  const { runAI } = await import("../app/server/ai.server");
  let calls = 0;
  globalThis.fetch = async () => ++calls <= 2 ? overloaded() : success();
  const result = await runAI(requestSchema.parse({ intent: "decompose", image }), new AbortController().signal) as { items: unknown[] };
  assert.equal(calls, 3); assert.equal(result.items.length, 3);
  const generation = files(path.join(root, "ai")).find(file => file.endsWith("log.json"))!;
  assert.deepEqual(read(generation).retries.map((item: { status: number }) => item.status), [503, 503]);
  assert.ok(files(path.dirname(generation)).some(file => file.endsWith("response-1-retry1.txt")), "each failed try is kept");
});

test("a persistent 503 fails with a clear message and is written to error-logs with its generation", async () => {
  const { runAI } = await import("../app/server/ai.server");
  let calls = 0;
  globalThis.fetch = async () => { calls++; return overloaded(); };
  const before = errorFiles().length;
  await assert.rejects(runAI(requestSchema.parse({ intent: "decompose", image }), new AbortController().signal), /과부하/);
  assert.equal(calls, 4, "first try + 3 retries");
  const entry = read(errorFiles().at(-1)!);
  assert.equal(errorFiles().length, before + 1);
  assert.equal(entry.source, "ai"); assert.equal(entry.status, 503); assert.equal(entry.providerCode, "server_is_overloaded"); assert.equal(entry.intent, "decompose");
  assert.match(entry.generation, /^\d{4}-\d{2}-\d{2}\/.*-decompose-/);
  assert.doesNotMatch(readFileSync(errorFiles().at(-1)!, "utf8"), /sk-test-secret/);
});

test("an exhausted quota is not retried", async () => {
  const { runAI } = await import("../app/server/ai.server");
  let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({ error: { code: "insufficient_quota" } }, { status: 429 }); };
  await assert.rejects(runAI(requestSchema.parse({ intent: "decompose", image }), new AbortController().signal), /사용 한도/);
  assert.equal(calls, 1);
});

test("code-check failures and browser-reported errors are logged; images and keys are stripped", async () => {
  const generate = await import("../app/routes/api.generate");
  const errors = await import("../app/routes/api.errors");
  const post = (url: string, body: unknown) => new Request(`http://localhost${url}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const bad = "p.setup=()=>{p.createCanvas(900,600);p['top'];};";
  const response = await generate.action({ request: post("/api/generate", { intent: "prepare", code: bad }) } as never);
  const body = await response.json();
  assert.match(body.error, /동적 API/); assert.ok(body.logged, "the client is told it was logged");
  const prepare = read(errorFiles().find(file => file.includes("-prepare-"))!);
  assert.equal(prepare.code, bad);
  const reported = await errors.action({ request: post("/api/errors", { source: "runtime", message: "ReferenceError: x is not defined sk-test-secret-key-123456", owner: "sketch-a", frame: "Sketch 2", code: `const img = "${image}";` }) } as never);
  assert.equal(reported.status, 200);
  const runtime = read(errorFiles().find(file => file.includes("-runtime-"))!);
  assert.equal(runtime.owner, "sketch-a"); assert.match(runtime.message, /\[redacted\]/);
  assert.match(runtime.code, /\[image/);
  assert.equal((await errors.action({ request: post("/api/errors", { source: "ai", message: "spoofed" }) } as never)).status, 400, "only browser-side sources are accepted");
});
