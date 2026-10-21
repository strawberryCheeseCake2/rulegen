import test from "node:test";
import assert from "node:assert/strict";
import { num, sampleScene } from "./fixtures/scene";
import { addBlockProperty, ALGORITHM_DRAG_TYPE, copyAlgorithm, pasteAlgorithm, readAlgorithmDrag } from "../app/lib/scene/transfer";
import { instantiate } from "../app/lib/scene/algorithms";
import { sceneBindings, valueAt } from "../app/lib/scene/values";
import { findNode } from "../app/lib/scene/graph";
import type { AlgorithmCall, Scene } from "../app/lib/scene/schema";

const other = (): Scene => ({ algorithms: [{ id: "power-decay", name: "Different", description: "다른 정의", params: [] }], nodes: [
  { id: "orb", kind: "object", parentId: null, name: "Existing orb", description: "", primitive: "ellipse", region: { x: .1, y: .1, w: .2, h: .2 }, visible: true, machine: null,
    transformations: [{ id: "main", label: "", description: "", properties: [{ id: "size", label: "Size", effect: "spatial", description: "", value: num(5, 0, 10) }] }] },
] });

test("a copied block keeps its arguments and can be pasted into any socket, even in another sketch", () => {
  const scene = sampleScene();
  const branch = scene.nodes[0].transformations[0].properties[0].value as AlgorithmCall;
  const clip = copyAlgorithm(scene, valueAt(branch, ["length"]) as AlgorithmCall);
  assert.equal(clip.label, "Power decay");
  // Same sketch: the orb's radius becomes a power-decay block with the copied argument values.
  const pasted = pasteAlgorithm(scene, "orb", "radius", [], clip);
  assert.deepEqual(findNode(pasted, "orb")!.transformations[0].properties[0].value, clip.call);
  assert.equal(findNode(pasted, "orb")!.machine!.states[1].values.some(item => item.propertyId === "radius"), false, "state overrides follow the new structure");
  // Another sketch with a different `power-decay`: the pasted block is renamed, not merged.
  const elsewhere = pasteAlgorithm(other(), "orb", "size", [], clip);
  const call = findNode(elsewhere, "orb")!.transformations[0].properties[0].value as AlgorithmCall;
  assert.equal(call.algorithmId, "power-decay-2");
  assert.equal(elsewhere.algorithms.find(a => a.id === "power-decay")!.name, "Different");
  // A whole nested block (branch → power decay) carries its dependencies too.
  const nested = pasteAlgorithm(other(), "orb", "size", [], copyAlgorithm(scene, branch));
  assert.deepEqual(nested.algorithms.map(a => a.id).sort(), ["power-decay", "power-decay-2", "recursive-branch"]);
  assert.deepEqual(sceneBindings(nested).map(b => b.key), ["orb/size/depth", "orb/size/length/base", "orb/size/length/ratio"]);
  // Pasting deep enough to exceed the nesting limit is refused.
  const deep = copyAlgorithm(scene, branch);
  assert.throws(() => pasteAlgorithm(scene, "tree", "structure", ["length", "base"], { ...deep, call: { ...deep.call, args: deep.call.args.map(a => a.id === "depth" ? { ...a, value: instantiate(scene.algorithms, "recursive-branch") } : a) } }), /중첩/);
});

test("dropping a block on a node's empty socket adds a property holding that block", () => {
  const scene = sampleScene();
  const next = addBlockProperty(scene, "orb", copyAlgorithm(scene, instantiate(scene.algorithms, "sine-wave")));
  const added = findNode(next, "orb")!.transformations[0].properties[2];
  assert.equal(added.id, "sine-wave"); assert.equal(added.label, "Sine wave");
  assert.equal(findNode(addBlockProperty(next, "orb", copyAlgorithm(scene, instantiate(scene.algorithms, "sine-wave"))), "orb")!.transformations[0].properties[3].id, "sine-wave-2");
});

test("regenerating a transformation rewrites the frame's code right away, so the running result does the new thing", async () => {
  const { sceneAI } = await import("../app/studio/scene-actions");
  const { createSketchPanel } = await import("../app/lib/sketch-panels");
  const { sampleScene, sceneProgram } = await import("./fixtures/scene");
  const { connectScene } = await import("../app/server/scene-code.server");
  const scene = sampleScene(), generated = connectScene({ title: "Tree", explanation: "", code: sceneProgram }, scene);
  const panels: Record<string, ReturnType<typeof createSketchPanel>> = { a: { ...createSketchPanel({ scene }), generated } };
  const requests: { intent: string; body: any }[] = [];
  const deps = {
    panel: (id: string) => panels[id], activate: () => {}, toast: () => {}, focus: () => {}, documentId: () => 1, requestId: () => 1, preview: () => undefined,
    updatePanel: (id: string, patch: any) => { panels[id] = { ...panels[id], ...(typeof patch === "function" ? patch(panels[id]) : patch) }; },
    task: async (_label: string, work: () => Promise<void>) => { await work(); },
    request: async (intent: string, body: any) => {
      requests.push({ intent, body });
      if (intent === "transform") return { ...body.scene, nodes: body.scene.nodes.map((node: any) => node.id === "tree" ? { ...node, transformations: node.transformations.map((item: any) => item.id === "ink-wash" ? { ...item, label: "Speed ink", description: "속도에 따라" } : item) } : node) };
      return { title: "Tree", explanation: "", code: "rulegenModule(\"tree\", function (m) { return { draw() {} }; });" };
    },
    capture: async () => ({ image: "data:image/png;base64,AAAA", region: { x: 0, y: 0, w: 1, h: 1 } }),
    artwork: (id: string) => id === "a" ? { name: "A", photo: null, strokes: [], revision: 1 } : undefined,
  } as any;
  await sceneAI(deps, "a").regenerate("tree", { transformationId: "ink-wash" }, "속도에 따라 바뀌게");
  assert.deepEqual(requests.map(r => r.intent), ["transform", "code"]);
  assert.equal(requests[0].body.instruction, "속도에 따라 바뀌게");
  assert.match(requests[1].body.instruction, /"Speed ink" \(ink-wash\) of node "Tree"[\s\S]*was just regenerated/);
  assert.equal(panels.a.generated?.code.includes("rulegenModule(\"tree\", function (m) { return { draw() {} }; })"), true, "the new code is in place");
  assert.deepEqual(panels.a.dirtyNodeIds, []);
});


test("AI work keeps running per frame: a composition made after the user moved away appears without taking the view", async () => {
  const { sceneAI } = await import("../app/studio/scene-actions");
  const { createSketchPanel } = await import("../app/lib/sketch-panels");
  const { aiScene } = await import("./fixtures/scene");
  const { convertScene } = await import("../app/lib/scene/convert");
  const { connectScene } = await import("../app/server/scene-code.server");
  const { sceneProgram } = await import("./fixtures/scene");
  const panels: Record<string, ReturnType<typeof createSketchPanel>> = { source: createSketchPanel({ composePrompt: "- 나무를 그려줘" }), other: createSketchPanel() };
  const activated: string[] = [], focused: string[] = [], requests: { intent: string; owner: string }[] = [];
  let active = "source";
  const deps = {
    panel: (id: string) => panels[id], toast: () => {}, activate: (id: string) => activated.push(id), focus: (id: string) => focused.push(id), active: () => active,
    updatePanel: (id: string, patch: any) => { panels[id] = { ...panels[id], ...(typeof patch === "function" ? patch(panels[id]) : patch) }; },
    task: async (_label: string, work: () => Promise<void>) => { await work(); },
    // The user switches to another frame while the AI is working.
    request: async (intent: string, body: any, owner: string) => { requests.push({ intent, owner }); active = "other"; return intent === "compose" ? convertScene(structuredClone(aiScene)) : connectScene({ title: "Tree", explanation: "", code: sceneProgram }, body.scene); },
    capture: async () => ({ image: "data:image/png;base64,AAAA", region: { x: 0, y: 0, w: 1, h: 1 } }),
    artwork: (id: string) => panels[id] ? { name: id, photo: null, strokes: [], revision: 1 } : undefined,
    createFrames: () => { panels.derived = createSketchPanel(); return ["derived"]; }, addPen: () => null, resolvePen: (pen: unknown) => pen,
    documentId: () => 1, requestId: () => 1, clip: () => null, setClip: () => {}, preview: () => undefined,
  } as any;
  await sceneAI(deps, "source").compose();
  assert.deepEqual(requests, [{ intent: "compose", owner: "source" }, { intent: "code", owner: "derived" }]);
  assert.equal(panels.derived.role, "composition"); assert.equal(panels.derived.sourceFrameId, "source"); assert.equal(panels.derived.composePrompt, "- 나무를 그려줘");
  assert.equal(panels.derived.generated?.title, "Tree", "the work finished in its own frame");
  assert.deepEqual(panels.source.scene.nodes, [], "the sketch stays a sketch");
  assert.deepEqual(activated, []); assert.deepEqual(focused, []);
});
