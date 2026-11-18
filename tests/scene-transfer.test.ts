import test from "node:test";
import assert from "node:assert/strict";
import { num, sampleScene } from "./fixtures/scene";
import { addBlockParam, ALGORITHM_DRAG_TYPE, copyAlgorithm, moveNodeTo, NODE_DRAG_TYPE, pasteAlgorithm, readAlgorithmDrag, readNodeDrag, transplantNodes } from "../app/lib/scene/transfer";
import { instantiate } from "../app/lib/scene/algorithms";
import { sceneBindings, valueAt } from "../app/lib/scene/values";
import { findNode } from "../app/lib/scene/graph";
import type { AlgorithmCall, Scene } from "../app/lib/scene/schema";

const other = (): Scene => ({ algorithms: [{ id: "power-decay", name: "Different", description: "다른 정의", params: [] }], nodes: [
  { id: "orb", kind: "object", parentId: null, name: "Existing orb", description: "", primitive: "ellipse", region: { x: .1, y: .1, w: .2, h: .2 }, visible: true, machine: null,
    constraints: [{ id: "main", property: "", description: "", params: [{ id: "size", label: "Size", effect: "spatial", description: "", value: num(5, 0, 10) }] }] },
] });

test("a copied block keeps its arguments and can be pasted into any socket, even in another sketch", () => {
  const scene = sampleScene();
  const branch = scene.nodes[0].constraints[0].params[0].value as AlgorithmCall;
  const clip = copyAlgorithm(scene, valueAt(branch, ["length"]) as AlgorithmCall);
  assert.equal(clip.label, "Power decay");
  // Same sketch: the orb's radius becomes a power-decay block with the copied argument values.
  const pasted = pasteAlgorithm(scene, "orb", "radius", [], clip);
  assert.deepEqual(findNode(pasted, "orb")!.constraints[0].params[0].value, clip.call);
  // Another sketch with a different `power-decay`: the pasted block is renamed, not merged.
  const elsewhere = pasteAlgorithm(other(), "orb", "size", [], clip);
  const call = findNode(elsewhere, "orb")!.constraints[0].params[0].value as AlgorithmCall;
  assert.equal(call.algorithmId, "power-decay-2");
  assert.equal(elsewhere.algorithms.find(a => a.id === "power-decay")!.name, "Different");
  // A whole nested block (branch → power decay) carries its dependencies too.
  const nested = pasteAlgorithm(other(), "orb", "size", [], copyAlgorithm(scene, branch));
  assert.deepEqual(nested.algorithms.map(a => a.id).sort(), ["power-decay", "power-decay-2", "recursive-branch"]);
  assert.deepEqual(sceneBindings(nested).map(b => b.key), ["orb/size/depth", "orb/size/length/base", "orb/size/length/ratio"]);
  // Pasting deep enough to exceed the nesting limit is refused.
  const deep = copyAlgorithm(scene, branch);
  assert.throws(() => pasteAlgorithm(scene, "tree", "structure", ["length", "base"], { ...deep, call: { ...deep.call, args: deep.call.args.map(a => a.id === "depth" ? { ...a, value: instantiate(scene.algorithms, "recursive-branch") } : a) } }), /Algorithms can be nested at most/);
});

test("dropping a block on a node's empty socket adds a param holding that block", () => {
  const scene = sampleScene();
  const next = addBlockParam(scene, "orb", copyAlgorithm(scene, instantiate(scene.algorithms, "sine-wave")));
  const added = findNode(next, "orb")!.constraints.at(-1)!.params.at(-1)!;
  assert.equal(added.id, "sine-wave"); assert.equal(added.label, "Sine wave");
  assert.equal(findNode(addBlockParam(next, "orb", copyAlgorithm(scene, instantiate(scene.algorithms, "sine-wave"))), "orb")!.constraints.at(-1)!.params.at(-1)!.id, "sine-wave-2");
});

test("a layer dropped on another sketch frame is copied with members, blocks and machines; on the same frame it moves", () => {
  const scene = sampleScene();
  const { scene: target, rootId } = transplantNodes(scene, "tree", other(), { x: .7, y: .5 });
  assert.equal(rootId, "tree");
  const orbCopy = target.nodes.find(node => node.parentId === "tree")!;
  assert.equal(orbCopy.id, "orb-2", "colliding ids are renamed");
  assert.equal(orbCopy.machine!.states.length, 2);
  assert.ok(target.algorithms.some(a => a.id === "recursive-branch"));
  const length = valueAt(findNode(target, "tree")!.constraints[0].params[0].value, ["length"]) as AlgorithmCall;
  assert.equal(length.algorithmId, "power-decay-2", "references follow renamed blocks");
  const tree = findNode(target, "tree")!;
  assert.ok(Math.abs(tree.region.x + tree.region.w / 2 - .7) < .21, "placed around the drop point (clamped to the canvas)");
  assert.equal(findNode(target, "orb")!.name, "Existing orb", "existing nodes are untouched");
  assert.equal(scene.nodes.length, 2, "source sketch unchanged");
  const moved = moveNodeTo(scene, "orb", { x: .2, y: .8 });
  const orb = findNode(moved, "orb")!;
  assert.ok(Math.abs(orb.region.x + orb.region.w / 2 - .2) < 1e-6 && Math.abs(orb.region.y + orb.region.h / 2 - .8) < 1e-6);
});

test("drag payloads round-trip and reject foreign data", () => {
  const store = new Map<string, string>();
  const data = { getData: (type: string) => store.get(type) || "", setData: (type: string, value: string) => store.set(type, value) } as unknown as DataTransfer;
  const scene = sampleScene(), clip = copyAlgorithm(scene, instantiate(scene.algorithms, "sine-wave"));
  store.set(ALGORITHM_DRAG_TYPE, JSON.stringify(clip)); store.set(NODE_DRAG_TYPE, JSON.stringify({ sketchId: "source", nodeId: "tree" }));
  assert.deepEqual(readAlgorithmDrag(data), clip);
  assert.deepEqual(readNodeDrag(data), { sketchId: "source", nodeId: "tree" });
  store.set(ALGORITHM_DRAG_TYPE, "not json"); store.set(NODE_DRAG_TYPE, JSON.stringify({ nodeId: 3 }));
  assert.equal(readAlgorithmDrag(data), null); assert.equal(readNodeDrag(data), null);
});

test("dropping a layer on another sketch copies it, shows a pending result frame and generates that sketch's result", async () => {
  const { dropNode } = await import("../app/studio/scene-actions");
  const { createSketchPanel } = await import("../app/lib/sketch-panels");
  const panels: Record<string, ReturnType<typeof createSketchPanel>> = { source: { ...createSketchPanel(), scene: sampleScene() }, "sketch-b": createSketchPanel() };
  const requests: { intent: string; body: any }[] = [], focused: string[] = [], pending: boolean[] = [];
  const deps = {
    panel: (id: string) => panels[id], activate: () => {}, toast: () => {}, focus: (frame: string) => focused.push(frame),
    updatePanel: (id: string, patch: any) => { panels[id] = { ...panels[id], ...(typeof patch === "function" ? patch(panels[id]) : patch) }; },
    task: async (_label: string, work: () => Promise<void>) => { await work(); },
    request: async (intent: string, body: any) => { requests.push({ intent, body }); pending.push(panels["sketch-b"].pendingResult); return { title: "Copied", explanation: "", code: "p.setup=()=>{p.createCanvas(900,600);};" }; },
    capture: () => ({ image: "data:image/png;base64,AAAA", region: { x: 0, y: 0, w: 1, h: 1 } }),
    artwork: () => ({ name: "B", photo: null, strokes: [], revision: 0 }), documentId: () => 1, requestId: () => 1,
    addPen: () => {}, clip: () => null, setClip: () => {},
  } as any;
  await dropNode(deps, "source", "tree", "sketch-b", { x: .5, y: .5 });
  assert.deepEqual(panels["sketch-b"].scene.nodes.map(node => node.id), ["tree", "orb"]);
  assert.equal(requests.length, 1); assert.equal(requests[0].intent, "code");
  assert.deepEqual(requests[0].body.scene.nodes.map((node: { id: string }) => node.id), ["tree", "orb"]);
  assert.deepEqual(pending, [true], "the result frame is shown as pending while generating");
  assert.equal(panels["sketch-b"].pendingResult, false);
  assert.equal(panels["sketch-b"].generated?.title, "Copied");
  assert.ok(focused.includes("sketch-b"), "the result appears inside the frame the layer was dropped on");
  // Dropping on the same sketch only moves the node: no generation.
  await dropNode(deps, "sketch-b", "orb", "sketch-b", { x: .1, y: .1 });
  assert.equal(requests.length, 1);
});

test("Extract puts the scene into a NEW sketch frame beside the source and renders that frame's result there", async () => {
  const { sceneAI } = await import("../app/studio/scene-actions");
  const { createSketchPanel } = await import("../app/lib/sketch-panels");
  const { aiScene } = await import("./fixtures/scene");
  const { convertScene } = await import("../app/lib/scene/convert");
  const panels: Record<string, ReturnType<typeof createSketchPanel>> = { source: createSketchPanel() };
  const requests: { intent: string; owner: string; body: any }[] = [], captured: string[] = [], created: string[] = [];
  const deps = {
    panel: (id: string) => panels[id], activate: () => {}, toast: () => {}, focus: () => {},
    updatePanel: (id: string, patch: any) => { panels[id] = { ...panels[id], ...(typeof patch === "function" ? patch(panels[id]) : patch) }; },
    task: async (_label: string, work: () => Promise<void>) => { await work(); },
    request: async (intent: string, body: any, owner: string) => { requests.push({ intent, owner, body }); return intent === "extract" ? convertScene(structuredClone(aiScene)) : { title: "Tree", explanation: "", code: "p.setup=()=>{p.createCanvas(900,600);};" }; },
    capture: async (owner: string) => { captured.push(owner); return { image: "data:image/png;base64,AAAA", region: { x: 0, y: 0, w: 1, h: 1 } }; },
    artwork: (id: string) => id === "source" ? { name: "Tree sketch", photo: null, strokes: [], revision: 3 } : created.includes(id) ? { name: "Tree sketch · extracted", photo: null, strokes: [], revision: 0 } : undefined,
    createFrame: (from: string, name: string) => { assert.equal(from, "source"); assert.match(name, /extracted/); const id = "sketch-derived"; created.push(id); panels[id] = createSketchPanel(); return id; },
    documentId: () => 1, requestId: () => 1, addPen: () => {}, clip: () => null, setClip: () => {},
    addBrushes: (frameId: string, scene: any) => { const made = brushesFor(scene, frameId, brushes, () => `brush-${brushes.length + 1}`); brushes.push(...made); return made; }, preview: () => undefined,
  } as any;
  const { brushesFor } = await import("../app/lib/brushes");
  const brushes: any[] = [];
  await sceneAI(deps, "source").extract();
  assert.deepEqual(panels.source.scene.nodes, [], "the source sketch stays a plain sketch");
  const derived = panels["sketch-derived"];
  assert.deepEqual(derived.scene.nodes.map(node => node.id), ["tree", "orb"]);
  assert.equal(derived.sourceFrameId, "source"); assert.equal(derived.analysisRevision, 3);
  assert.deepEqual(requests.map(r => [r.intent, r.owner]), [["extract", "source"], ["code", "sketch-derived"]]);
  assert.deepEqual(captured, ["source", "source"], "code for the derived frame is generated against the source sketch");
  assert.equal(derived.generated?.title, "Tree"); assert.equal(derived.pendingResult, false);
  assert.deepEqual(brushes.map(brush => [brush.name, brush.nodeId, brush.sourceFrameId]), [["Tree", "tree", "sketch-derived"]], "the AI-made root collection became a brush");
  assert.equal(derived.scene.nodes.find(node => node.id === "tree")?.brushId, "brush-1");
});

test("regenerating a constraint rewrites the frame's code right away, so the running result does the new thing", async () => {
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
      if (intent === "transform") return { ...body.scene, nodes: body.scene.nodes.map((node: any) => node.id === "tree" ? { ...node, constraints: node.constraints.map((item: any) => item.id === "ink-wash" ? { ...item, property: "speed-ink", description: "속도에 따라" } : item) } : node) };
      return { title: "Tree", explanation: "", code: "rulegenModule(\"tree\", function (m) { return { draw() {} }; });" };
    },
    capture: async () => ({ image: "data:image/png;base64,AAAA", region: { x: 0, y: 0, w: 1, h: 1 } }),
    artwork: (id: string) => id === "a" ? { name: "A", photo: null, strokes: [], revision: 1 } : undefined,
  } as any;
  await sceneAI(deps, "a").regenerate("tree", { constraintId: "ink-wash" }, "속도에 따라 바뀌게");
  assert.deepEqual(requests.map(r => r.intent), ["transform", "code"]);
  assert.equal(requests[0].body.instruction, "속도에 따라 바뀌게");
  assert.match(requests[1].body.instruction, /constraint "speed-ink" \(ink-wash\) of node "Tree"[\s\S]*was just regenerated/);
  assert.equal(panels.a.generated?.code.includes("rulegenModule(\"tree\", function (m) { return { draw() {} }; })"), true, "the new code is in place");
  assert.deepEqual(panels.a.dirtyNodeIds, []);
});

test("AI work keeps running per frame: a frame made after the user moved away appears without taking the view", async () => {
  const { sceneAI } = await import("../app/studio/scene-actions");
  const { createSketchPanel } = await import("../app/lib/sketch-panels");
  const { aiScene } = await import("./fixtures/scene");
  const { convertScene } = await import("../app/lib/scene/convert");
  const panels: Record<string, ReturnType<typeof createSketchPanel>> = { source: createSketchPanel(), other: createSketchPanel() };
  const activated: string[] = [], focused: string[] = [];
  let active = "source";
  const deps = {
    panel: (id: string) => panels[id], toast: () => {}, activate: (id: string) => activated.push(id), focus: (id: string) => focused.push(id), active: () => active,
    updatePanel: (id: string, patch: any) => { panels[id] = { ...panels[id], ...(typeof patch === "function" ? patch(panels[id]) : patch) }; },
    task: async (_label: string, work: () => Promise<void>) => { await work(); },
    // The user switches to another frame while the AI is working.
    request: async (intent: string) => { active = "other"; return intent === "extract" ? convertScene(structuredClone(aiScene)) : { title: "Tree", explanation: "", code: "p.setup=()=>{p.createCanvas(900,600);};" }; },
    capture: async () => ({ image: "data:image/png;base64,AAAA", region: { x: 0, y: 0, w: 1, h: 1 } }),
    artwork: (id: string) => ({ name: id, photo: null, strokes: [], revision: 1 }),
    createFrame: () => { panels.derived = createSketchPanel(); return "derived"; },
    documentId: () => 1, requestId: () => 1, addPen: () => {}, clip: () => null, setClip: () => {}, addBrushes: () => [], preview: () => undefined,
  } as any;
  await sceneAI(deps, "source").extract();
  assert.equal(panels.derived.generated?.title, "Tree", "the work finished in its own frame");
  assert.deepEqual(activated, []); assert.deepEqual(focused, []);
});

test("a fix that changes several constraints regenerates each in turn (told about the others), then rewrites the code once", async () => {
  const { applyFix } = await import("../app/studio/inspection-actions");
  const { createSketchPanel } = await import("../app/lib/sketch-panels");
  const { sampleScene, sceneProgram } = await import("./fixtures/scene");
  const { connectScene } = await import("../app/server/scene-code.server");
  const scene = sampleScene(), generated = connectScene({ title: "Tree", explanation: "", code: sceneProgram }, scene);
  const panels: Record<string, ReturnType<typeof createSketchPanel>> = { a: { ...createSketchPanel({ scene }), generated } };
  const requests: { intent: string; body: any }[] = [];
  const deps = {
    panel: (id: string) => panels[id], activate: () => {}, toast: () => {}, focus: () => {}, documentId: () => 1, requestId: () => 1, preview: () => undefined, refreshBrushCode: () => {},
    updatePanel: (id: string, patch: any) => { panels[id] = { ...panels[id], ...(typeof patch === "function" ? patch(panels[id]) : patch) }; },
    task: async (_label: string, work: () => Promise<void>) => { await work(); },
    request: async (intent: string, body: any) => {
      requests.push({ intent, body });
      if (intent === "transform") return { ...body.scene, nodes: body.scene.nodes.map((node: any) => node.id === "tree" ? { ...node, constraints: node.constraints.map((item: any) => item.id === body.targetConstraintId ? { ...item, description: `${item.description} (new)` } : item) } : node) };
      return { title: "Tree", explanation: "", code: "rulegenModule(\"tree\", function (m) { return { draw() {} }; });" };
    },
    capture: async () => ({ image: "data:image/png;base64,AAAA", region: { x: 0, y: 0, w: 1, h: 1 } }),
    artwork: (id: string) => id === "a" ? { name: "A", photo: null, strokes: [], revision: 1 } : undefined,
  } as any;
  await applyFix(deps, "a", { kind: "constraint", nodeId: "tree", targetId: "ink-wash", targetIds: ["branching-growth"], title: "둘 다", detail: "함께 바꿉니다", changes: [] });
  assert.deepEqual(requests.map(r => [r.intent, r.body.targetConstraintId ?? ""]), [["transform", "ink-wash"], ["transform", "branching-growth"], ["code", ""]]);
  assert.match(requests[0].body.instruction, /changes 2 constraints[\s\S]*1\/2: regenerate only "ink-wash"/);
  assert.match(requests[2].body.instruction, /\(ink-wash\)[\s\S]*; [\s\S]*\(branching-growth\)[\s\S]*were just regenerated together/);
  assert.ok(panels.a.scene.nodes[0].constraints.every(item => item.description.endsWith("(new)")));
  assert.equal(panels.a.applied.past.length, 1, "one undo entry for the whole fix");
  assert.ok(panels.a.applied.past[0].before.scene.nodes[0].constraints.every(item => !item.description.endsWith("(new)")), "undo apply goes back to before both");
});

test("an add-constraint fix stacks a new constraint on the node, then rewrites the code", async () => {
  const { applyFix } = await import("../app/studio/inspection-actions");
  const { createSketchPanel } = await import("../app/lib/sketch-panels");
  const { sampleScene, sceneProgram } = await import("./fixtures/scene");
  const { connectScene } = await import("../app/server/scene-code.server");
  const scene = sampleScene(), generated = connectScene({ title: "Tree", explanation: "", code: sceneProgram }, scene);
  const panels: Record<string, ReturnType<typeof createSketchPanel>> = { a: { ...createSketchPanel({ scene }), generated } };
  const requests: { intent: string; body: any }[] = [];
  const deps = {
    panel: (id: string) => panels[id], activate: () => {}, toast: () => {}, focus: () => {}, documentId: () => 1, requestId: () => 1, preview: () => undefined, refreshBrushCode: () => {},
    updatePanel: (id: string, patch: any) => { panels[id] = { ...panels[id], ...(typeof patch === "function" ? patch(panels[id]) : patch) }; },
    task: async (_label: string, work: () => Promise<void>) => { await work(); },
    request: async (intent: string, body: any) => {
      requests.push({ intent, body });
      if (intent === "transform") return { ...body.scene, nodes: body.scene.nodes.map((node: any) => node.id === "orb" ? { ...node, constraints: [...node.constraints, { ...node.constraints[0], id: "tail", property: "tail", description: "꼬리", params: [] }] } : node) };
      return { title: "Tree", explanation: "", code: "rulegenModule(\"tree\", function (m) { return { draw() {} }; });" };
    },
    capture: async () => ({ image: "data:image/png;base64,AAAA", region: { x: 0, y: 0, w: 1, h: 1 } }),
    artwork: (id: string) => id === "a" ? { name: "A", photo: null, strokes: [], revision: 1 } : undefined,
  } as any;
  await applyFix(deps, "a", { kind: "add-constraint", nodeId: "orb", targetId: "", targetIds: [], title: "꼬리 추가", detail: "속도에 따라 꼬리를 그립니다", changes: [] });
  assert.deepEqual(requests.map(r => r.intent), ["transform", "code"]);
  assert.equal(requests[0].body.targetConstraintId, ""); assert.equal(requests[0].body.alternative, false, "a new one, not a rewrite of an existing one");
  assert.match(requests[1].body.instruction, /constraint "tail" \(tail\)[\s\S]*was just regenerated/);
  assert.deepEqual(panels.a.scene.nodes.find(node => node.id === "orb")!.constraints.map(item => item.id), ["pulse", "drift", "tail"]);
  assert.equal(panels.a.applied.past.length, 1);
});

test("a state or transition fix refines the node's machine, then rewrites the code to it (else the frame draws as before)", async () => {
  const { applyFix } = await import("../app/studio/inspection-actions");
  const { createSketchPanel } = await import("../app/lib/sketch-panels");
  const { sampleScene, sceneProgram } = await import("./fixtures/scene");
  const { connectScene } = await import("../app/server/scene-code.server");
  const scene = sampleScene(), generated = connectScene({ title: "Tree", explanation: "", code: sceneProgram }, scene);
  const panels: Record<string, ReturnType<typeof createSketchPanel>> = { a: { ...createSketchPanel({ scene }), generated } };
  const requests: { intent: string; body: any }[] = [], toasts: string[] = [];
  const deps = {
    panel: (id: string) => panels[id], activate: () => {}, toast: (text: string) => toasts.push(text), focus: () => {}, documentId: () => 1, requestId: () => 1, preview: () => undefined, refreshBrushCode: () => {},
    updatePanel: (id: string, patch: any) => { panels[id] = { ...panels[id], ...(typeof patch === "function" ? patch(panels[id]) : patch) }; },
    task: async (_label: string, work: () => Promise<void>) => { await work(); },
    request: async (intent: string, body: any) => {
      requests.push({ intent, body });
      if (intent === "machine-refine") return { scene: { ...body.scene, nodes: body.scene.nodes.map((node: any) => node.id === "orb" ? { ...node, machine: { ...node.machine, states: node.machine.states.map((state: any) => state.id === "moving" ? { ...state, description: "겹치면 하나로 합칩니다" } : state) } } : node) }, composePrompt: "p" };
      return { title: "Tree", explanation: "", code: "rulegenModule(\"tree\", function (m) { return { draw() {} }; });" };
    },
    capture: async () => ({ image: "data:image/png;base64,AAAA", region: { x: 0, y: 0, w: 1, h: 1 } }),
    artwork: (id: string) => id === "a" ? { name: "A", photo: null, strokes: [], revision: 1 } : undefined,
  } as any;
  await applyFix(deps, "a", { kind: "state", nodeId: "orb", targetId: "moving", targetIds: [], title: "합치기", detail: "겹치면 합칩니다", changes: [] });
  assert.deepEqual(requests.map(r => r.intent), ["machine-refine", "code"]);
  assert.match(requests[1].body.instruction, /The state "이동" \(moving\) of Orb's state machine was just regenerated/);
  assert.equal(panels.a.generated!.code, "rulegenModule(\"tree\", function (m) { return { draw() {} }; });", "the frame runs the new code");
  assert.ok(!toasts.some(text => /Press Update/.test(text)), "nothing is left for the user to press");
  assert.equal(panels.a.applied.past.length, 1, "one undo entry for the refinement and the code");
});
