import test from "node:test";
import assert from "node:assert/strict";
import { num, sampleScene, sceneProgram, withMockedAI } from "./fixtures/scene";
import { runAI } from "../app/server/ai.server";
import { requestSchema } from "../app/lib/schema";
import { connectScene } from "../app/server/scene-code.server";
import { sandboxesSchema, sandboxTarget, settleSandbox, settleSandboxes, type AISandbox } from "../app/lib/execution/concern-sandbox";

const signal = () => new AbortController().signal;
const computation = { id: "decay", property: "length", description: "길이가 세대마다 ratio배", params: [{ id: "ratio", label: "Ratio", effect: "spatial" as const, description: "", value: num(.7, .3, .95, .01) }], inputs: [], drags: [] };
const answer = (change: Partial<AISandbox>): AISandbox => ({ reason: "가지 길이 감소", nodeId: "tree", scope: "constraint", constraintId: "branching-growth", computation: null,
  logic: { summary: "세대마다 길이에 ratio를 곱해 가지가 짧아진다", params: [{ id: "ratio", how: "길이에 곱해지는 값; 작을수록 빨리 짧아진다" }] }, ...change });
const ids = ["tree", "orb"];

test("a concern's sandbox part: the smallest part that holds it, falling back one level when the answer does not hold", () => {
  const scene = sampleScene();
  assert.deepEqual(settleSandbox(scene, ids, answer({})).target, { nodeId: "tree", scope: "constraint", constraintId: "branching-growth" });
  const inner = settleSandbox(scene, ids, answer({ scope: "computation", computation }));
  assert.deepEqual(inner.target, { nodeId: "tree", scope: "constraint", constraintId: "decay" });
  assert.equal(inner.part?.params[0].id, "ratio");
  assert.equal(inner.logic.params[0].how, "길이에 곱해지는 값; 작을수록 빨리 짧아진다", "how it works comes along");
  const from = sandboxTarget(scene, inner).from!;
  assert.deepEqual(from.nodes.find(node => node.id === "tree")!.constraints.map(item => item.id), ["decay"], "the node holds only the computation");
  // A computation named like a constraint the node has gets an id of its own.
  assert.equal(settleSandbox(scene, ids, answer({ scope: "computation", computation: { ...computation, id: "ink-wash" } })).target.constraintId, "ink-wash-2");
  // A computation without params, or an unknown constraint: one level up.
  assert.deepEqual(settleSandbox(scene, ids, answer({ scope: "computation", computation: { ...computation, params: [] } })).target, { nodeId: "tree", scope: "constraint", constraintId: "branching-growth" });
  assert.deepEqual(settleSandbox(scene, ids, answer({ constraintId: "nope" })).target, { nodeId: "tree", scope: "constraints", constraintId: "" });
  assert.deepEqual(settleSandbox(scene, ids, answer({ scope: "node", constraintId: "" })).target, { nodeId: "tree", scope: "node", constraintId: "" });
  // A node outside the inspected brush: its root instead.
  assert.equal(settleSandbox(scene, ids, answer({ nodeId: "elsewhere" })).target.nodeId, "tree");
  assert.throws(() => settleSandbox(scene, [], answer({})));
});

test("trace-part is asked with the concern, marks and the brush's code and params", async () => {
  const scene = sampleScene(), code = connectScene({ title: "Tree", explanation: "", code: sceneProgram }, scene).code;
  await withMockedAI(() => ({ parts: [answer({ scope: "computation", computation })] }), async calls => {
    const result = sandboxesSchema.parse(await runAI(requestSchema.parse({ intent: "trace-part", scene, previous: code, image: "data:image/png;base64,AAAA",
      trace: { concern: "왜 가지가 짧아지지?", nodeIds: ids, cycles: 0, sites: [], marks: [[{ x: 1, y: 2 }, { x: 3, y: 4 }]] } }), signal()));
    assert.equal(result.parts[0].part?.id, "decay");
    const sent = JSON.stringify(calls[0]);
    assert.match(sent, /왜 가지가 짧아지지/); assert.match(sent, /rulegenModule/); assert.match(sent, /base-length/);
  });
});

/** Mini sandbox on frame "a" with the model answering these parts: what was asked and made. */
async function runSandbox(parts: AISandbox[]) {
  const { sceneAI } = await import("../app/studio/scene-actions");
  const { createSketchPanel } = await import("../app/lib/sketch-panels");
  const panels: Record<string, ReturnType<typeof createSketchPanel>> = { a: { ...createSketchPanel({ scene: sampleScene() }), generated: { title: "T", explanation: "", code: sceneProgram, sceneBindings: [], machineSignature: "" } } };
  let frames = 0;
  const calls: { intent: string; body: any }[] = [], proxies: string[] = [], toasts: string[] = [];
  const deps = {
    panel: (id: string) => panels[id] ?? createSketchPanel(), activate: () => {}, toast: (text: string) => { toasts.push(text); }, focus: () => {}, documentId: () => 1, requestId: () => 1, preview: () => undefined, active: () => "a", refreshBrushCode: () => {},
    updatePanel: (id: string, patch: any) => { const base = panels[id] ?? createSketchPanel(); panels[id] = { ...base, ...(typeof patch === "function" ? patch(base) : patch) }; },
    createFrame: () => { const id = `sketch-${++frames}`; panels[id] = createSketchPanel(); return id; },
    addSubBrush: () => null, openProxy: (owner: string, nodeId: string) => { proxies.push(`${owner}:${nodeId}`); },
    task: async (label: string, work: () => Promise<void>, owner: string) => { deps.updatePanel(owner, { loading: label }); try { await work(); } finally { deps.updatePanel(owner, { loading: "" }); } },
    request: async (intent: string, body: any) => { calls.push({ intent, body });
      return intent === "trace-part" ? sandboxesSchema.parse(settleSandboxes(body.scene, body.trace.nodeIds, { parts: parts }))
        : intent === "handles" ? { handles: [], skipped: [] } : { title: "Sandbox", explanation: "", code: "rulegenModule(\"x\", function (m) { return { draw() {} }; });" }; },
    capture: async () => ({ image: "data:image/png;base64,AAAA", region: { x: 0, y: 0, w: 1, h: 1 } }),
    artwork: (id: string) => panels[id] ? { name: id, photo: null, strokes: [], revision: 1 } : undefined,
  } as any;
  await sceneAI(deps, "a").concernSandbox("왜 가지가 짧아지지?", "data:image/png;base64,AAAA", []);
  return { panels, calls, toasts };
}

test("Mini sandbox: only the concern's part becomes a part frame linked to the frame, then gets handles for its params", async () => {
  const { panels, calls } = await runSandbox([answer({ scope: "computation", computation })]);
  assert.deepEqual(calls.map(call => call.intent), ["trace-part", "code", "handles"]);
  assert.equal(calls[0].body.trace.concern, "왜 가지가 짧아지지?");
  const frame = panels["sketch-1"];
  assert.deepEqual(frame.exampleOf, { frameId: "a", nodeId: "tree", constraintId: "decay" }, "a part frame of the frame, as decompose makes");
  assert.deepEqual(frame.scene.nodes.flatMap(node => node.constraints.map(item => item.id)), ["decay"], "only the concern's part");
  assert.match(frame.instruction, /mini sandbox.*왜 가지가 짧아지지/);
  assert.deepEqual(frame.sandboxLogic, { ...answer({}).logic, concern: "왜 가지가 짧아지지?" }, "how it works is kept with the sandbox (shown under its proxy frames)");
  assert.equal(calls[2].body.targetConstraintId, "decay"); assert.match(calls[2].body.instruction, /왜 가지가 짧아지지/, "handles fit the concern");
  assert.equal(Object.keys(panels).length, 2, "only one frame is made");
});

test("the inspect form makes only what is checked: mini sandbox alone makes no fork", async () => {
  const { inspectPlan } = await import("../app/components/execution-panel");
  assert.deepEqual(inspectPlan(false, false, true), { stepping: false, fork: null, sandbox: true }, "sandbox only");
  assert.deepEqual(inspectPlan(false, true, true), { stepping: false, fork: "tools", sandbox: true }, "tools and sandbox");
  assert.deepEqual(inspectPlan(false, false, false), { stepping: false, fork: "change", sandbox: false }, "nothing checked: the fork is changed");
  assert.deepEqual(inspectPlan(true, true, true), { stepping: true, fork: null, sandbox: true }, "stepping makes no fork");
});

test("a concern about several parts: each settled part gets its own sandbox, with no part twice", () => {
  const scene = sampleScene();
  const settled = settleSandboxes(scene, ids, { parts: [
    answer({ scope: "computation", computation }),
    answer({ scope: "computation", computation: { ...computation, description: "다른 계산" } }),
    answer({}), answer({ constraintId: "branching-growth" }),
  ].slice(0, 3) });
  assert.deepEqual(settled.parts.map(part => part.target.constraintId), ["decay", "decay-2", "branching-growth"], "two computations named alike get ids of their own");
  assert.deepEqual(settleSandboxes(scene, ids, { parts: [answer({}), answer({ scope: "constraint" })] }).parts.length, 1, "the same constraint twice: once");
  assert.deepEqual(settleSandboxes(scene, ids, { parts: [answer({ nodeId: "elsewhere", constraintId: "nope" }), answer({})] }).parts.map(part => part.target.scope), ["constraints", "constraint"], "a fallback that differs is kept");
  assert.throws(() => settleSandboxes(scene, [], { parts: [answer({})] }));
});

test("Mini sandbox of several parts: a part frame for each, each generated and given its handles", async () => {
  const { panels, calls, toasts } = await runSandbox([answer({ scope: "computation", computation }), answer({})]);
  assert.deepEqual(calls.map(call => call.intent), ["trace-part", "code", "handles", "code", "handles"]);
  assert.deepEqual(["sketch-1", "sketch-2"].map(id => panels[id].exampleOf?.constraintId), ["decay", "branching-growth"]);
  assert.ok(["sketch-1", "sketch-2"].every(id => panels[id].sandboxLogic?.concern === "왜 가지가 짧아지지?"), "each keeps what it is for");
  assert.equal(Object.keys(panels).length, 3, "no fork, only the sandboxes");
  assert.match(toasts.join(" "), /2 mini sandbox frames/);
});
