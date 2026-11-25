import test from "node:test";
import assert from "node:assert/strict";
import { sampleScene, sceneProgram, withMockedAI } from "./fixtures/scene";
import { runAI } from "../app/server/ai.server";
import { loadPrompt } from "../app/server/prompts.server";
import { requestSchema } from "../app/lib/schema";
import { connectScene } from "../app/server/scene-code.server";
import { clarifySchema, feedbackSchema, saysSomething, type Clarify } from "../app/lib/execution/manipulate";

const signal = () => new AbortController().signal;
const rule = (id: string): Clarify["rules"][number] => ({ id, rule: id, logic: `${id}()`, detail: "", tools: [{ kind: "brush", purpose: "" }], thumbnail: "note.label(1, 1, 'x');" });
const asked: Clarify = { related: true, summary: "", needsCode: true, rules: [rule("by-branch"), rule("at-forks")], ask: true, question: "Which?", reason: "", tools: [], targets: [] };
const base = (feedback: unknown) => {
  const scene = sampleScene();
  return requestSchema.parse({ intent: "trace-clarify", scene, previous: connectScene({ title: "Tree", explanation: "", code: sceneProgram }, scene).code, image: "data:image/png;base64,AAAA",
    trace: { concern: "색이 덜 바뀌게", nodeIds: ["tree"], cycles: 1, sites: [{ site: "constraint:tree/branching-growth", variables: { $value: 1 } }], feedback } });
};

test("feedback says something with text or a mark; it is sent with trace-clarify and the options come back to pick from", async () => {
  assert.equal(saysSomething({ text: " ", marks: [[{ x: 1, y: 1 }]] }), false, "a dot is not a mark");
  assert.equal(saysSomething({ text: "", marks: [[{ x: 1, y: 1 }, { x: 5, y: 5 }]] }), true);
  const options = feedbackSchema.parse({ kind: "options", text: "가지마다 한 색으로", marks: [[{ x: 10, y: 20 }, { x: 30, y: 40 }]], rejected: [{ rule: "by chance", logic: "p < 0.3", detail: "" }] });
  await withMockedAI(() => asked, async calls => {
    const result = clarifySchema.parse(await runAI(base(options), signal()));
    assert.equal(result.ask, true); assert.equal(result.rules.length, 2);
    const sent = JSON.stringify(calls[0]);
    assert.match(sent, /가지마다 한 색으로/); assert.match(sent, /by chance/); assert.match(sent, /\\"kind\\":\\"options\\"/);
  });
  // Without feedback nothing of it is sent.
  await withMockedAI(() => asked, async calls => { await runAI(base(null), signal()); assert.doesNotMatch(JSON.stringify(calls[0]), /\\"feedback\\"/); });
});

test("tool feedback carries the tools made, how each target was measured and what it measured to; alternatives are asked", async () => {
  const tools = feedbackSchema.parse({ kind: "tools", text: "칠할수록 더 세게", marks: [[{ x: 1, y: 2 }, { x: 3, y: 4 }]],
    made: { summary: "칠한 곳의 색이 바뀐다", rule: "Probability (p)", tools: [{ kind: "brush", purpose: "칠하세요" }],
      targets: [{ name: "Change chance", site: "", path: "", param: "", meaning: "칠한 영역", measure: "return input.mask;", shown: "0 – 1 (1350)" }] } });
  await withMockedAI(() => asked, async calls => {
    await runAI(base(tools), signal());
    const sent = JSON.stringify(calls[0]);
    assert.match(sent, /칠할수록 더 세게/); assert.match(sent, /return input\.mask;/); assert.match(sent, /0 – 1 \(1350\)/);
    assert.match(calls[0].instructions, /## Feedback/);
  });
  const prompt = loadPrompt("trace-clarify");
  assert.match(prompt, /none repeating a rejected one/); assert.match(prompt, /ALTERNATIVE corrections/); assert.match(prompt, /feedback outranks your earlier reading/);
});
