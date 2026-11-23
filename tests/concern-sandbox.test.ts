import test from "node:test";
import assert from "node:assert/strict";
import { num, sampleScene, sceneProgram, withMockedAI } from "./fixtures/scene";
import { runAI } from "../app/server/ai.server";
import { requestSchema } from "../app/lib/schema";
import { connectScene } from "../app/server/scene-code.server";
import { sandboxSchema, sandboxTarget, settleSandbox, type AISandbox } from "../app/lib/execution/concern-sandbox";

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
  await withMockedAI(() => answer({ scope: "computation", computation }), async calls => {
    const result = sandboxSchema.parse(await runAI(requestSchema.parse({ intent: "trace-part", scene, previous: code, image: "data:image/png;base64,AAAA",
      trace: { concern: "왜 가지가 짧아지지?", nodeIds: ids, cycles: 0, sites: [], marks: [[{ x: 1, y: 2 }, { x: 3, y: 4 }]] } }), signal()));
    assert.equal(result.part?.id, "decay");
    const sent = JSON.stringify(calls[0]);
    assert.match(sent, /왜 가지가 짧아지지/); assert.match(sent, /rulegenModule/); assert.match(sent, /base-length/);
  });
});

test("Mini sandbox: only the concern's part becomes a part frame linked to the frame, then gets handles for its params", async () => {
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
      return intent === "trace-part" ? sandboxSchema.parse(settleSandbox(body.scene, body.trace.nodeIds, answer({ scope: "computation", computation })))
        : intent === "handles" ? { handles: [], skipped: [] } : { title: "Sandbox", explanation: "", code: "rulegenModule(\"x\", function (m) { return { draw() {} }; });" }; },
    capture: async () => ({ image: "data:image/png;base64,AAAA", region: { x: 0, y: 0, w: 1, h: 1 } }),
    artwork: (id: string) => panels[id] ? { name: id, photo: null, strokes: [], revision: 1 } : undefined,
  } as any;
  await sceneAI(deps, "a").concernSandbox("왜 가지가 짧아지지?", "data:image/png;base64,AAAA", []);
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
