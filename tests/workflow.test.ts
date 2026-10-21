import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { aiDecomposition, num, run, withMockedAI } from "./fixtures/scene";
import { convertDecomposition, decompositionSchema, exampleInstruction, exampleScene } from "../app/lib/scene/minimal-example";
import { compositionContext, examplePen, livePen } from "../app/lib/algorithm-pens";
import { convertComposition } from "../app/lib/scene/convert";
import { findNode } from "../app/lib/scene/graph";
import { findProperty } from "../app/lib/scene/transformations";
import { setPropertyScalar } from "../app/lib/scene/panel-ops";
import { requestSchema, type Artwork, type SemanticPen } from "../app/lib/schema";
import { createSketchPanel, type SketchPanel } from "../app/lib/sketch-panels";
import { runAI } from "../app/server/ai.server";
import { connectScene } from "../app/server/scene-code.server";
import { sceneBindings } from "../app/lib/scene/values";
import { codeInstruction, codeReferences, exampleModule, sceneAI } from "../app/studio/scene-actions";
import { projectSchema } from "../app/lib/project";
import { recoverGeneration } from "../app/lib/generation-recovery";

const logDirectory = mkdtempSync(path.join(tmpdir(), "rulegen-workflow-"));
const previousLogDirectory = process.env.RULEGEN_AI_LOG_DIR;
process.env.RULEGEN_AI_LOG_DIR = logDirectory;
after(() => { rmSync(logDirectory, { recursive: true, force: true }); if (previousLogDirectory === undefined) delete process.env.RULEGEN_AI_LOG_DIR; else process.env.RULEGEN_AI_LOG_DIR = previousLogDirectory; });

const image = "data:image/png;base64,AAAA";
const decomposition = () => convertDecomposition(structuredClone(aiDecomposition));
const moduleCode = (root: string, body: string) => `rulegenModule(${JSON.stringify(root)}, function (m) {\n  return { draw() { ${body} } };\n});`;

test("decompose: AI splits the sketch into independent transformations, each with its subject; ids are made unique", async () => {
  await withMockedAI(() => aiDecomposition, async calls => {
    const result = decompositionSchema.parse(await runAI(requestSchema.parse({ intent: "decompose", image, instruction: "색은 따로 나눠줘" }), new AbortController().signal));
    assert.deepEqual(result.items.map(item => item.transformation.id), ["radial-repetition", "petal-curl", "petal-curl-2"]);
    assert.deepEqual(result.items.map(item => item.subject.kind), ["collection", "object", "collection"]);
    assert.equal(result.items[1].member, null, "an object's transformation has no member");
    const layout = findProperty({ transformations: [result.items[0].transformation] } as never, "layout")!.value as { algorithmId: string; args: unknown[] };
    assert.equal(layout.algorithmId, "radial-repeat"); assert.ok(layout.args.length, "algorithm calls are expanded with their defaults");
    assert.equal(calls[0].text.format.name, "rulegen_decompose");
    assert.match(calls[0].instructions, /AS INDEPENDENT AS POSSIBLE/); assert.match(calls[0].instructions, /MINIMAL EXAMPLE/);
    assert.equal(JSON.parse(calls[0].input[0].content[0].text).instruction, "색은 따로 나눠줘");
    await assert.rejects(runAI(requestSchema.parse({ intent: "decompose" }), new AbortController().signal), /이미지/);
  });
});

test("each transformation becomes a minimal example scene: only it, on a plain subject, with just the algorithms it calls", () => {
  const parts = decomposition();
  const arrangement = exampleScene(parts, parts.items[0]);
  assert.deepEqual(arrangement.scene.nodes.map(node => [node.id, node.kind, node.parentId, node.transformations.map(item => item.id)]), [["petals", "collection", null, ["radial-repetition"]], ["petal", "object", "petals", []]]);
  assert.deepEqual(arrangement.example, { nodeId: "petals", transformationId: "radial-repetition" });
  assert.deepEqual(arrangement.scene.algorithms.map(item => item.id), ["radial-repeat"]);
  assert.ok(arrangement.scene.nodes.every(node => node.machine === null));
  const shape = exampleScene(parts, parts.items[1]);
  assert.deepEqual(shape.scene.nodes.map(node => [node.id, node.kind, node.parentId, node.transformations.length]), [["example", "collection", null, 0], ["petal", "object", "example", 1]]);
  assert.equal(shape.example.nodeId, "petal"); assert.deepEqual(shape.scene.algorithms, []);
  // A member is always there for a collection's transformation, even when the model gave none.
  assert.equal(exampleScene(parts, parts.items[2]).scene.nodes.length, 2);
  const instruction = exampleInstruction(arrangement.scene, arrangement.example, "더 크게");
  assert.match(instruction, /minimal example of ONE semantic transformation, "Radial repetition"/); assert.match(instruction, /ONLY this transformation/); assert.match(instruction, /User direction: 더 크게/);
});

test("a pen made from an example follows it: values tuned there come along; its last state stays when the frame is gone", () => {
  const parts = decomposition(), { scene, example } = exampleScene(parts, parts.items[0]);
  const pen = examplePen(scene, "sketch-ex", example, "pen-1", "#3b73c4")!;
  assert.equal(pen.kind, "transformation"); assert.equal(pen.name, "Radial repetition");
  assert.deepEqual(pen.transformation!.subject, { kind: "collection", name: "Petals", description: "꽃잎들", primitive: "group" });
  assert.equal(pen.transformation!.member?.name, "Petal");
  const tuned = setPropertyScalar({ ...createSketchPanel({ scene }) } as SketchPanel, "petals", "count", [], 12).scene!;
  const count = (value: SemanticPen) => (value.transformation!.transformation.properties.find(item => item.id === "count")!.value as { value: number }).value;
  assert.equal(count(livePen(pen, id => id === "sketch-ex" ? tuned : undefined)), 12, "follows the example frame");
  assert.equal(count(livePen(pen, () => undefined)), 7, "the frame is gone: its saved copy");
  // Strokes drawn with the pen are one pen in the AI context, read live.
  const art: Artwork = { name: "S", photo: null, revision: 1, strokes: [1, 2].map(i => ({ tool: "pen" as const, color: pen.color, width: 3, opacity: 1, points: [{ x: 90 * i, y: 60 }, { x: 90 * i + 50, y: 120 }], semanticPen: pen })) };
  const context = compositionContext(art, value => livePen(value, () => tuned));
  assert.equal(context.compositionPens.length, 1); assert.equal(count(context.compositionPens[0]), 12);
  assert.deepEqual(context.compositionStrokes.map(stroke => stroke.semanticPenId), ["mark-pen-1", "mark-pen-1"]);
  // Saved pens of an older kind are dropped; transformation pens round-trip.
  const project = projectSchema.parse({ version: 2, name: "p", artwork: art, semanticPens: [pen, { kind: "algorithm", id: "old", name: "Old", color: "#000000", meaning: "" }] });
  assert.deepEqual(project.semanticPens.map(item => item.id), ["pen-1"]);
  assert.equal(projectSchema.parse({ version: 2, name: "p", artwork: { ...art, strokes: [{ ...art.strokes[0], semanticPen: { kind: "algorithm", id: "x" } }] } }).artwork.strokes[0].semanticPen, undefined, "a stroke with an old pen stays a pencil line");
});

test("compose: nodes take the pens' transformations exactly (with an origin), plus their own; the model sees transformations, not frames", async () => {
  const parts = decomposition();
  const pens = parts.items.slice(0, 2).map((item, i) => { const { scene, example } = exampleScene(parts, item); return { ...examplePen(scene, `sketch-ex${i}`, example, `p${i}`, "#3b73c4")!, id: `mark-pen-${i + 1}` }; });
  // The model's own algorithm reuses an id the pen also has, with different content: the pen's is renamed.
  const output = { algorithms: [{ id: "radial-repeat", name: "Mine", description: "다른 것", params: [] }], nodes: [
    { id: "flowers", kind: "collection" as const, parentId: null, name: "Flowers", description: "", primitive: "group", region: { x: .1, y: .1, w: .8, h: .8 }, pens: [], transformations: [], machine: null },
    { id: "petals", kind: "collection" as const, parentId: "flowers", name: "Petals", description: "", primitive: "group", region: { x: .2, y: .2, w: .2, h: .2 }, pens: ["mark-pen-1", "missing"],
      transformations: [{ id: "radial-repetition", label: "Tilt", description: "", properties: [{ id: "count", label: "Tilt", effect: "spatial" as const, description: "", value: num(3, 0, 9) }] }],
      machine: { initialState: "rest", states: [{ id: "rest", label: "Rest", description: "", values: [] }, { id: "open", label: "Open", description: "", values: [{ propertyId: "count", value: num(12, 2, 24) }] }], transitions: [{ id: "press", from: "rest", to: "open", label: "Press", trigger: "event" as const, afterMs: 1000 }] } },
    { id: "petal", kind: "object" as const, parentId: "petals", name: "Petal", description: "", primitive: "petal", region: { x: .25, y: .25, w: .05, h: .05 }, pens: ["mark-pen-2"], transformations: [], machine: null },
  ] };
  const scene = convertComposition(output, pens);
  const petals = findNode(scene, "petals")!;
  assert.deepEqual(petals.transformations.map(item => [item.id, item.label, item.origin?.frameId ?? null]), [["radial-repetition", "Radial repetition", "sketch-ex0"], ["radial-repetition-2", "Tilt", null]], "pen first, then the node's own (renamed on a collision: the pen's ids win)");
  assert.deepEqual(petals.transformations.flatMap(item => item.properties.map(property => property.id)), ["count", "layout", "count-2"]);
  assert.deepEqual(petals.machine?.states[1].values.map(item => item.propertyId), ["count"], "a machine state may set a pen's property");
  assert.equal((findProperty(petals, "count")!.value as { value: number }).value, 7, "the example's value, exactly");
  const layout = findProperty(petals, "layout")!.value as { algorithmId: string };
  assert.notEqual(layout.algorithmId, "radial-repeat"); assert.equal(scene.algorithms.find(item => item.id === layout.algorithmId)?.name, "Radial repeat", "the pen's own definition, renamed");
  assert.equal(findNode(scene, "petal")!.transformations[0].origin?.transformationId, "petal-curl");
  await withMockedAI(() => output, async calls => {
    const strokes = [{ id: "stroke-1", tool: "semantic", color: "#3b73c4", width: 3, opacity: 1, points: [{ x: .2, y: .2 }], semanticPenId: "mark-pen-1" }, { id: "stroke-2", tool: "semantic", color: "#3b73c4", width: 3, opacity: 1, points: [{ x: .3, y: .3 }], semanticPenId: "mark-pen-2" }];
    const result = await runAI(requestSchema.parse({ intent: "compose", image, instruction: "- 꽃을 배치해줘", compositionPens: pens, compositionStrokes: strokes }), new AbortController().signal) as typeof scene;
    assert.equal(findNode(result, "petals")!.transformations[0].origin?.frameId, "sketch-ex0");
    const sent = JSON.parse(calls[0].input[0].content.find((part: { text?: string }) => part.text?.includes("compositionPens")).text);
    assert.equal(sent.compositionPens[0].transformation.label, "Radial repetition"); assert.equal(sent.compositionPens[0].subject.kind, "collection");
    assert.equal(sent.compositionPens[0].frameId, undefined); assert.equal(JSON.stringify(sent).includes("sketch-ex0"), false, "frames are the app's business");
    assert.match(calls[0].instructions, /THIS transformation applies HERE/); assert.match(calls[0].instructions, /copies that transformation into the node EXACTLY/);
  });
});

test("a composition's code reuses the code of the examples its transformations came from", async () => {
  const parts = decomposition(), { scene, example } = exampleScene(parts, parts.items[0]);
  const exampleCode = moduleCode("petals", "const r = m.v(\"petals/layout/radius\"); for (let i = 0; i < m.v(\"petals/count\"); i++) p.circle(r, i, 4);");
  const examplePanel = { ...createSketchPanel({ scene, role: "example", example: { ...example, sourceFrameId: "source", penId: "p0" } }), generated: connectScene({ title: "Petals", explanation: "", code: exampleCode }, scene) };
  assert.match(exampleModule(examplePanel)!, /petals\/layout\/radius/);
  assert.match(codeInstruction(examplePanel), /minimal example of ONE semantic transformation/);
  const pen = { ...examplePen(scene, "sketch-ex", example, "p0", "#3b73c4")!, id: "mark-pen-1" };
  const composed = convertComposition({ algorithms: [], nodes: [{ id: "ring", kind: "collection", parentId: null, name: "Ring", description: "", primitive: "group", region: { x: .1, y: .1, w: .5, h: .5 }, pens: ["mark-pen-1"], transformations: [], machine: null }] }, [pen]);
  const panels: Record<string, SketchPanel> = { "sketch-ex": examplePanel };
  const deps = { panel: (id: string) => panels[id] ?? createSketchPanel(), artwork: (id: string) => panels[id] ? { name: id, photo: null, strokes: [], revision: 0 } : undefined };
  const references = codeReferences(deps as never, composed);
  assert.deepEqual(references.map(item => [item.transformationId, item.label]), [["radial-repetition", "Radial repetition"]]);
  assert.match(references[0].code, /petals\/count/);
  assert.deepEqual(codeReferences({ ...deps, artwork: () => undefined } as never, composed), [], "the example frame is gone: nothing to reuse");
  const composition = createSketchPanel({ scene: composed, role: "composition", composePrompt: "- 링으로 배치", instruction: "작게" });
  assert.equal(codeInstruction(composition), "- 링으로 배치\nUser direction: 작게");
  await withMockedAI(() => ({ title: "Ring", explanation: "", code: moduleCode("ring", sceneBindings(composed).map(binding => `m.v(${JSON.stringify(binding.key)});`).join(" ")) }), async calls => {
    await runAI(requestSchema.parse({ intent: "code", scene: composed, image, instruction: "x", references }), new AbortController().signal);
    assert.match(JSON.parse(calls[0].input[0].content[0].text).references[0].code, /petals\/count/);
    assert.match(calls[0].instructions, /reuse each example's implementation/);
  });
});

test("Decompose makes a minimal example frame and a pen per transformation beside the sketch, then codes each example on its own", async () => {
  const panels: Record<string, SketchPanel> = { source: createSketchPanel() };
  const requests: { intent: string; owner: string; body: any }[] = [], pens: SemanticPen[] = [], captured: string[] = [];
  let made = 0;
  const deps = {
    panel: (id: string) => panels[id], activate: () => {}, toast: () => {}, focus: () => {}, active: () => "source",
    updatePanel: (id: string, patch: any) => { panels[id] = { ...panels[id], ...(typeof patch === "function" ? patch(panels[id]) : patch) }; },
    task: async (_label: string, work: () => Promise<void>) => { await work(); },
    request: async (intent: string, body: any, owner: string) => {
      requests.push({ intent, owner, body });
      if (intent === "decompose") return decomposition();
      // As the server returns it: connected to the example's scene (reading every value).
      const root = body.scene.nodes.find((node: any) => !node.parentId).id;
      return connectScene({ title: root, explanation: "", code: moduleCode(root, `${sceneBindings(body.scene).map(binding => `m.v(${JSON.stringify(binding.key)});`).join(" ")} p.circle(0, 0, 10);`) }, body.scene);
    },
    capture: async (owner: string) => { captured.push(owner); return { image, region: { x: 0, y: 0, w: 1, h: 1 } }; },
    artwork: (id: string) => panels[id] ? { name: id === "source" ? "Flower" : id, photo: null, strokes: [], revision: id === "source" ? 4 : 0 } : undefined,
    createFrames: (from: string, names: string[]) => { assert.equal(from, "source"); return names.map(name => { const id = `sketch-${++made}`; assert.match(name, / · example$/); panels[id] = createSketchPanel(); return id; }); },
    addPen: (make: (id: string, color: string) => SemanticPen | null) => { const pen = make(`pen-${pens.length + 1}`, "#3b73c4"); if (pen) pens.push(pen); return pen; },
    resolvePen: (pen: SemanticPen) => pen, documentId: () => 1, requestId: () => 1, clip: () => null, setClip: () => {}, preview: () => undefined,
  } as any;
  await sceneAI(deps, "source").decompose();
  assert.deepEqual(panels.source.scene.nodes, [], "the sketch stays a sketch");
  const examples = ["sketch-1", "sketch-2", "sketch-3"].map(id => panels[id]);
  assert.deepEqual(examples.map(item => [item.role, item.sourceFrameId, item.analysisRevision, item.example?.transformationId, item.example?.penId]),
    [["example", "source", 4, "radial-repetition", "pen-1"], ["example", "source", 4, "petal-curl", "pen-2"], ["example", "source", 4, "petal-curl-2", "pen-3"]]);
  assert.deepEqual(pens.map(pen => [pen.name, pen.transformation!.frameId]), [["Radial repetition", "sketch-1"], ["Petal curl", "sketch-2"], ["Size falloff", "sketch-3"]]);
  assert.deepEqual(requests.map(item => item.intent).sort(), ["code", "code", "code", "decompose"]);
  const codeRequests = requests.filter(item => item.intent === "code");
  assert.deepEqual(codeRequests.map(item => item.owner).sort(), ["sketch-1", "sketch-2", "sketch-3"]);
  assert.ok(codeRequests.every(item => /minimal example of ONE semantic transformation/.test(item.body.instruction)));
  assert.ok(captured.filter(owner => owner !== "source").length === 3, "each example is coded against itself, not the whole sketch");
  assert.ok(examples.every(item => item.generated && !item.pendingResult));
  // Each example runs: it draws, and its code is what a composition will reuse.
  for (const item of examples) { const sketch = run(item.generated!.code); sketch.draw(); assert.equal(sketch.circles.length, 1); }
});

test("AI history: a decompose log restores its example frames and pens; a compose log its composition frame", () => {
  const project = projectSchema.parse({ version: 2, name: "p", artwork: { name: "Flower", photo: null, strokes: [], revision: 2 } });
  const input = requestSchema.parse({ intent: "decompose", image });
  const restored = recoverGeneration(input, decomposition(), { project, owner: "source" });
  const ids = restored.project.sketchFrames.map(frame => frame.id);
  assert.equal(ids.length, 3); assert.equal(restored.project.semanticPens.length, 3);
  assert.deepEqual(ids.map(id => restored.project.sketchPanels[id].role), ["example", "example", "example"]);
  assert.deepEqual(restored.project.semanticPens.map(pen => pen.transformation!.frameId), ids);
  assert.ok(ids.every(id => restored.project.workspace.frames[id]), "placed on the board");
  const composed = recoverGeneration(requestSchema.parse({ intent: "compose", image, instruction: "- 배치" }), exampleScene(decomposition(), decomposition().items[0]).scene, { project, owner: "source" });
  assert.equal(composed.project.sketchPanels[composed.owner].role, "composition"); assert.equal(composed.project.sketchPanels[composed.owner].composePrompt, "- 배치");
});

test("a minimal example decomposes again: its one transformation (with current values and algorithms) is split into smaller examples and pens", async () => {
  const parts = decomposition(), { scene, example } = exampleScene(parts, parts.items[0]);
  // The model sees what to split; a split into one piece means it was already minimal.
  await withMockedAI(() => aiDecomposition, async calls => {
    await runAI(requestSchema.parse({ intent: "decompose", image, scene, targetNodeId: example.nodeId, targetTransformationId: example.transformationId }), new AbortController().signal);
    const split = JSON.parse(calls[0].input[0].content[0].text).split;
    assert.equal(split.transformation.id, "radial-repetition"); assert.equal(split.subject.kind, "collection"); assert.equal(split.member.name, "Petal");
    assert.deepEqual(split.algorithms.map((item: { id: string }) => item.id), ["radial-repeat"]);
    assert.match(calls[0].instructions, /DECOMPOSE IT FURTHER/);
    await assert.rejects(runAI(requestSchema.parse({ intent: "decompose", image, scene, targetNodeId: example.nodeId, targetTransformationId: "gone" }), new AbortController().signal), /나눌 transformation/);
  });
  const panels: Record<string, SketchPanel> = { "sketch-1": createSketchPanel({ role: "example", scene, sourceFrameId: "source", example: { ...example, sourceFrameId: "source", penId: "pen-0" } }) };
  const requests: { intent: string; owner: string; body: any }[] = [], toasts: string[] = [];
  let made = 1, pieces = decomposition();
  const deps = {
    panel: (id: string) => panels[id], activate: () => {}, toast: (text: string) => toasts.push(text), focus: () => {}, active: () => "sketch-1",
    updatePanel: (id: string, patch: any) => { panels[id] = { ...panels[id], ...(typeof patch === "function" ? patch(panels[id]) : patch) }; },
    task: async (_label: string, work: () => Promise<void>) => { await work(); },
    request: async (intent: string, body: any, owner: string) => {
      requests.push({ intent, owner, body });
      if (intent === "decompose") return pieces;
      const root = body.scene.nodes.find((node: any) => !node.parentId).id;
      return connectScene({ title: root, explanation: "", code: moduleCode(root, sceneBindings(body.scene).map(binding => `m.v(${JSON.stringify(binding.key)});`).join(" ")) }, body.scene);
    },
    capture: async () => ({ image, region: { x: 0, y: 0, w: 1, h: 1 } }),
    artwork: (id: string) => panels[id] ? { name: id, photo: null, strokes: [], revision: 0 } : undefined,
    createFrames: (from: string, names: string[]) => { assert.equal(from, "sketch-1"); return names.map(() => { const id = `sketch-${++made}`; panels[id] = createSketchPanel(); return id; }); },
    addPen: (make: (id: string, color: string) => SemanticPen | null) => make(`pen-${made}`, "#3b73c4"),
    resolvePen: (pen: SemanticPen) => pen, documentId: () => 1, requestId: () => 1, clip: () => null, setClip: () => {}, preview: () => undefined,
  } as any;
  await sceneAI(deps, "sketch-1").decompose();
  assert.deepEqual(requests[0].body.targetTransformationId, "radial-repetition"); assert.equal(requests[0].body.scene.nodes.length, 2);
  const smaller = ["sketch-2", "sketch-3", "sketch-4"].map(id => panels[id]);
  assert.ok(smaller.every(item => item.role === "example" && item.sourceFrameId === "sketch-1" && item.example?.sourceFrameId === "sketch-1" && item.generated));
  assert.equal(panels["sketch-1"].example?.transformationId, "radial-repetition", "the example (and its pen) stays");
  // Already minimal: nothing is made.
  pieces = { ...pieces, items: pieces.items.slice(0, 1) }; requests.length = 0;
  await sceneAI(deps, "sketch-1").decompose();
  assert.equal(made, 4); assert.match(toasts.at(-1)!, /더 나눌 수 없습니다/);
  // The AI history restores the same way.
  const project = projectSchema.parse({ version: 2, name: "p", artwork: { name: "Flower", photo: null, strokes: [], revision: 0 } });
  const input = requestSchema.parse({ intent: "decompose", image, scene, targetNodeId: example.nodeId, targetTransformationId: example.transformationId });
  assert.equal(recoverGeneration(input, pieces, { project, owner: "source" }).project.sketchFrames.length, 0);
  assert.equal(recoverGeneration(input, decomposition(), { project, owner: "source" }).project.sketchFrames.length, 3);
});
