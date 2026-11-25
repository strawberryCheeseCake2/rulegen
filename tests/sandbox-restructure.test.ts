import test from "node:test";
import assert from "node:assert/strict";
import { num, sampleScene, sceneProgram } from "./fixtures/scene";
import { applyRestructure, restructureSchema, restructureTarget, settleRestructure, type AIRestructure } from "../app/lib/execution/sandbox-restructure";

const param = (id: string, value: number) => ({ id, label: id, effect: "spatial" as const, description: `${id} desc`, value: num(value, 0, 10, 0.1) });
const option = (id: string, params: ReturnType<typeof param>[], thumbnail = "note.label(10, 10, 'x');") =>
  ({ id, label: id, change: `${id} change`, logic: `${id} logic`, constraint: { id: "other-id", property: "branches", description: id, params, inputs: [], drags: [] }, thumbnail });
const output = (options: AIRestructure["options"]): AIRestructure => ({ question: "값만으로는 안 됩니다", options });

test("structural options keep the part's constraint id, need params, and drop previews that do not parse", () => {
  const settled = settleRestructure(output([option("a", [param("ratio", 1)]), option("a", [param("spread", 2)], "this is not ( code"), option("empty", [])]), "branching-growth");
  assert.deepEqual(settled.options.map(item => [item.id, item.constraint.id]), [["a", "branching-growth"], ["a-2", "branching-growth"]]);
  assert.equal(settled.options[1].thumbnail, "", "a preview that does not parse is left out");
  assert.deepEqual(settleRestructure(output([option("a", [param("ratio", 1)])]), "x").options, [], "one option is no choice");
  assert.ok(restructureSchema.parse(settled));
});

test("a picked option replaces the part's constraint, keeping handles of params that are still there", () => {
  const scene = sampleScene(), handle = { code: "rulegenHandle(function (h) { return {}; });", prepared: "x", paths: [[]], hint: "" };
  const withHandle = { nodes: scene.nodes.map(node => node.id !== "tree" ? node : { ...node, constraints: node.constraints.map(item => item.id !== "branching-growth" ? item
    : { ...item, params: item.params.map(p => p.id === "ratio" ? { ...p, handle } : p) }) }) };
  const [picked] = settleRestructure(output([option("a", [param("ratio", 1), param("spread", 2)]), option("b", [param("x", 1)])]), "branching-growth").options;
  const next = applyRestructure(withHandle as never, "tree", picked);
  const tree = next.nodes.find(node => node.id === "tree")!;
  assert.deepEqual(tree.constraints.map(item => item.id), ["branching-growth", "ink-wash"], "in place, others kept");
  assert.deepEqual(tree.constraints[0].params.map(p => [p.id, Boolean(p.handle)]), [["ratio", true], ["spread", false]]);
  assert.equal(restructureTarget(next, { nodeId: "tree", constraintId: "branching-growth" })?.constraint.id, "branching-growth");
  assert.equal(restructureTarget(next, { nodeId: "tree", constraintId: "", scope: "node" }), null, "only a sandbox of one constraint");
});

test("Suggest, then pick: the sandbox's part is rewritten to the option, its code follows and its handles are made again", async () => {
  const { sceneAI } = await import("../app/studio/scene-actions");
  const { createSketchPanel } = await import("../app/lib/sketch-panels");
  const panels: Record<string, ReturnType<typeof createSketchPanel>> = { s: { ...createSketchPanel({ scene: sampleScene(), exampleOf: { frameId: "a", nodeId: "tree", constraintId: "branching-growth" } }),
    generated: { title: "T", explanation: "", code: sceneProgram, sceneBindings: [], machineSignature: "" }, sandboxLogic: { summary: "s", params: [{ id: "ratio", how: "곱해짐" }], concern: "더 휘게" } } };
  const calls: { intent: string; body: any }[] = [];
  const deps = {
    panel: (id: string) => panels[id] ?? createSketchPanel(), activate: () => {}, toast: () => {}, focus: () => {}, documentId: () => 1, requestId: () => 1, preview: () => undefined, active: () => "s", refreshBrushCode: () => {},
    updatePanel: (id: string, patch: any) => { const base = panels[id] ?? createSketchPanel(); panels[id] = { ...base, ...(typeof patch === "function" ? patch(base) : patch) }; },
    openProxy: () => {}, addSubBrush: () => null,
    task: async (label: string, work: () => Promise<void>, owner: string) => { deps.updatePanel(owner, { loading: label }); try { await work(); } finally { deps.updatePanel(owner, { loading: "" }); } },
    request: async (intent: string, body: any) => { calls.push({ intent, body });
      return intent === "sandbox-restructure" ? settleRestructure(output([option("bend", [param("ratio", 1), param("spread", 2)]), option("b", [param("x", 1)])]), body.targetConstraintId)
        : intent === "handles" ? { handles: [], skipped: [] } : { title: "T", explanation: "", code: sceneProgram }; },
    capture: async () => ({ image: "data:image/png;base64,AAAA", region: { x: 0, y: 0, w: 1, h: 1 } }),
    artwork: (id: string) => panels[id] ? { name: id, photo: null, strokes: [], revision: 1 } : undefined,
  } as any;
  await sceneAI(deps, "s").suggestRestructure();
  assert.equal(calls[0].intent, "sandbox-restructure"); assert.equal(calls[0].body.instruction, "더 휘게"); assert.equal(calls[0].body.targetConstraintId, "branching-growth");
  assert.deepEqual(panels.s.restructure?.options.map(item => item.id), ["bend", "b"]); assert.equal(panels.s.restructure?.picture, "data:image/png;base64,AAAA");
  await sceneAI(deps, "s").pickRestructure("bend");
  assert.deepEqual(calls.map(call => call.intent), ["sandbox-restructure", "code", "handles"]);
  assert.match(calls[1].body.instruction, /bend change/);
  assert.equal(panels.s.restructure, null);
  assert.deepEqual(panels.s.scene.nodes.find(node => node.id === "tree")!.constraints[0].params.map(p => p.id), ["ratio", "spread"]);
  assert.deepEqual(panels.s.sandboxLogic?.params, [{ id: "ratio", how: "곱해짐" }, { id: "spread", how: "spread desc" }], "how it works follows the change");
});

test("Propagate asks before AI rewrites the frames above; no leaves them as they are", async () => {
  const { propagate } = await import("../app/studio/propagate");
  const { createSketchPanel } = await import("../app/lib/sketch-panels");
  const { propagationBase } = await import("../app/lib/scene/propagation");
  for (const yes of [false, true]) {
    const of = { frameId: "a", nodeId: "tree", constraintId: "branching-growth" }, scene = sampleScene();
    const generated = { title: "T", explanation: "", code: sceneProgram, sceneBindings: [], machineSignature: "" };
    const changed = { nodes: scene.nodes.map(node => node.id !== "tree" ? node : { ...node, constraints: node.constraints.map(item => item.id !== "branching-growth" ? item : { ...item, description: "new rule" }) }) };
    const panels: Record<string, ReturnType<typeof createSketchPanel>> = { a: { ...createSketchPanel({ scene }), generated },
      s: { ...createSketchPanel({ scene: changed, exampleOf: of }), generated, propagationBase: propagationBase(scene, of, sceneProgram, []) } };
    const calls: string[] = [], asked: any[] = [];
    const deps = {
      panel: (id: string) => panels[id] ?? createSketchPanel(), activate: () => {}, toast: () => {}, focus: () => {}, documentId: () => 1, requestId: () => 1, preview: () => undefined, active: () => "s", refreshBrushCode: () => {},
      updatePanel: (id: string, patch: any) => { const base = panels[id] ?? createSketchPanel(); panels[id] = { ...base, ...(typeof patch === "function" ? patch(base) : patch) }; },
      task: async (_label: string, work: () => Promise<void>) => { await work(); }, confirm: async (prompt: any) => { asked.push(prompt); return yes; },
      request: async (intent: string) => { calls.push(intent); return { title: "T", explanation: "", code: sceneProgram }; },
      capture: async () => ({ image: "data:image/png;base64,AAAA", region: { x: 0, y: 0, w: 1, h: 1 } }),
      artwork: (id: string) => panels[id] ? { name: id, photo: null, strokes: [], revision: 1 } : undefined,
    } as any;
    await propagate(deps, "s", ["a"]);
    assert.equal(asked.length, 1, "asked once"); assert.match(asked[0].title, /Fix/);
    const description = panels.a.scene.nodes.find(node => node.id === "tree")!.constraints[0].description;
    if (yes) { assert.deepEqual(calls, ["code"]); assert.equal(description, "new rule"); }
    else { assert.deepEqual(calls, [], "no AI"); assert.notEqual(description, "new rule", "the frame above stays"); assert.ok(panels.s.propagationBase && panels.s.scene.nodes.find(n => n.id === "tree")!.constraints[0].description === "new rule", "still to pass up"); }
  }
});
