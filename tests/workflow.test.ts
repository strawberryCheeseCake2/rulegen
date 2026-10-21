import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { aiDecomposition, num, run, withMockedAI } from "./fixtures/scene";
import { convertDecomposition, decompositionSchema, exampleFrames, exampleInstruction, exampleScene, exampleStructure, objectScene } from "../app/lib/scene/minimal-example";
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
/** As the server finalizes a split of an example: nothing of the sketch. */
const splitDecomposition = () => convertDecomposition(structuredClone(aiDecomposition), true);
const moduleCode = (root: string, body: string) => `rulegenModule(${JSON.stringify(root)}, function (m) {\n  return { draw() { ${body} } };\n});`;

test("decompose: AI splits the sketch into independent operations, each with the collection/object structure that shows it; ids are made unique", async () => {
  await withMockedAI(() => aiDecomposition, async calls => {
    const result = decompositionSchema.parse(await runAI(requestSchema.parse({ intent: "decompose", image, instruction: "색은 따로 나눠줘" }), new AbortController().signal));
    assert.deepEqual(result.items.map(item => item.transformation.id), ["radial-repetition", "petal-curl", "petal-curl-2"]);
    assert.deepEqual(result.items.map(item => [item.carrier, item.nodes.length]), [["petals", 2], ["petal", 1], ["rings", 3]]);
    const item = calls[0].text.format.schema.properties.transformations.items.properties;
    assert.equal(item.nodes.maxItems, 8); assert.ok(item.nodes.items.properties.shape.anyOf, "objects are circle/square stand-ins, collections have no shape");
    assert.match(calls[0].instructions, /Objects and the transformations applied to them/); assert.match(calls[0].instructions, /nested collections/); assert.match(calls[0].instructions, /LOW COUPLING/);
    const layout = findProperty({ transformations: [result.items[0].transformation] } as never, "layout")!.value as { algorithmId: string; args: unknown[] };
    assert.equal(layout.algorithmId, "radial-repeat"); assert.ok(layout.args.length, "algorithm calls are expanded with their defaults");
    assert.equal(calls[0].text.format.name, "rulegen_decompose");
    assert.match(calls[0].instructions, /AS INDEPENDENT AS POSSIBLE/); assert.match(calls[0].instructions, /MINIMAL EXAMPLE/);
    assert.equal(JSON.parse(calls[0].input[0].content[0].text).instruction, "색은 따로 나눠줘");
    await assert.rejects(runAI(requestSchema.parse({ intent: "decompose" }), new AbortController().signal), /이미지/);
  });
});

test("a minimal example is the structure the transformation needs: the sketch's elements or plain stand-ins, collections (nested, several), the transformation on its carrier only", () => {
  const parts = decomposition();
  // Decomposed from the sketch: its objects are drawn as the sketch's elements (so it looks like the source); the transformation is on the group only.
  const arrangement = exampleScene(parts, parts.items[0]);
  assert.deepEqual(arrangement.scene.nodes.map(node => [node.id, node.kind, node.parentId, node.primitive, node.name, node.transformations.map(item => item.id)]),
    [["group", "collection", null, "group", "Group", ["radial-repetition"]], ["petal", "object", "group", "petal", "Petal", []]]);
  assert.deepEqual(arrangement.example, { kind: "transformation", nodeId: "group", transformationId: "radial-repetition", elements: ["petal"] });
  assert.equal(arrangement.scene.nodes[1].description, "끝이 뾰족한 길쭉한 꽃잎 하나");
  assert.deepEqual(arrangement.scene.algorithms.map(item => item.id), ["radial-repeat"]);
  assert.ok(arrangement.scene.nodes.every(node => node.machine === null));
  // Split from an example: plain stand-ins, nothing of the sketch's element ("꽃잎", "petal") in the names or descriptions.
  const split = splitDecomposition(), standIn = exampleScene(split, split.items[0]);
  assert.deepEqual(split.objects, []); assert.deepEqual(standIn.example.elements, []);
  assert.deepEqual(standIn.scene.nodes.map(node => [node.id, node.primitive, node.name]), [["group", "group", "Group"], ["circle", "circle", "Circle"]]);
  assert.doesNotMatch(JSON.stringify(standIn.scene.nodes.map(node => [node.id, node.name, node.description, node.primitive])), /꽃잎|petal/i);
  assert.match(exampleInstruction(standIn.scene, standIn.example), /not the sketch's elements/);
  const shape = exampleScene(parts, parts.items[1]);
  assert.deepEqual(shape.scene.nodes.map(node => [node.id, node.primitive, node.transformations.length]), [["petal", "petal", 1]]);
  assert.equal(shape.example.nodeId, "petal"); assert.deepEqual(shape.scene.algorithms, []);
  const nested = exampleScene(parts, parts.items[2]);
  // Groups of copies always get a count. A transformation without one only acts on copies (it does not make them): the count is a plain
  // "Copies" before it (example structure, not in its pen), so it never overlaps with the transformation that does make copies.
  assert.deepEqual(nested.scene.nodes.map(node => [node.id, node.parentId, node.name, node.transformations.map(item => [item.id, item.properties.map(property => property.id)])]),
    [["group", null, "Group 1", [["example-copies", ["count"]], ["petal-curl-2", ["size"]]]], ["group-2", "group", "Group 2", [["example-copies", ["count"]]]], ["circle", "group-2", "Circle", []]]);
  assert.match(exampleInstruction(nested.scene, nested.example), /"Copies" transformation/); assert.match(exampleInstruction(nested.scene, nested.example), /it comes first: the transformation then acts on those plain copies/);
  assert.doesNotMatch(exampleInstruction(nested.scene, nested.example), /count property/);
  assert.equal(examplePen(nested.scene, "sketch-ex", nested.example, "p", "#3b73c4")!.transformation!.transformation.properties.length, 1, "the pen has no count");
  // A carrier whose transformation makes the copies (a count property or algorithm argument) keeps its own count, with no "Copies".
  assert.deepEqual(arrangement.scene.nodes[0].transformations.map(item => [item.id, item.properties.map(property => property.id)]), [["radial-repetition", ["count", "layout"]]]);
  assert.match(exampleInstruction(arrangement.scene, arrangement.example), /count property/);
  const viaArg = { ...parts.items[0], transformation: { ...parts.items[0].transformation, properties: [{ id: "layout", label: "Layout", effect: "spatial" as const, description: "", value: { type: "algorithm" as const, algorithmId: "radial-repeat", args: [{ id: "radius", value: num(60, 0, 200, 1, "px") }, { id: "copy-count", value: num(5, 1, 20) }] } }] } };
  assert.deepEqual(exampleScene({ ...parts, algorithms: [{ ...parts.algorithms[0], params: [...parts.algorithms[0].params, { id: "copy-count", label: "Copies", description: "", value: num(5, 1, 20) }] }, parts.algorithms[1]] }, viaArg).scene.nodes[0].transformations.map(item => item.id), ["radial-repetition"]);
  // Without one, the model's count is the plain "Copies" default.
  const noCount = { ...parts.items[0], transformation: { ...parts.items[0].transformation, properties: parts.items[0].transformation.properties.filter(property => property.id !== "count") } };
  const plain = exampleScene(parts, noCount).scene.nodes[0].transformations;
  assert.deepEqual(plain.map(item => item.id), ["example-copies", "radial-repetition"]); assert.equal((plain[0].properties[0].value as { value: number }).value, 7);
  const inside = (a: { x: number; y: number; w: number; h: number }, b: typeof a) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w + 1e-9 && a.y + a.h <= b.y + b.h + 1e-9;
  assert.ok(inside(nested.scene.nodes[1].region, nested.scene.nodes[0].region) && inside(nested.scene.nodes[2].region, nested.scene.nodes[1].region), "children sit inside their collection");
  // Several objects and several collections; a broken structure is made sound.
  const messy = exampleStructure([
    { id: "a", kind: "collection", parentId: null, shape: null }, { id: "b", kind: "collection", parentId: null, shape: null },
    { id: "x", kind: "object", parentId: "a", shape: "circle" }, { id: "y", kind: "object", parentId: "a", shape: "square" },
    { id: "loop1", kind: "collection", parentId: "loop2", shape: null }, { id: "loop2", kind: "collection", parentId: "loop1", shape: null },
    { id: "z", kind: "object", parentId: "x", shape: "blob" }, { id: "x", kind: "object", parentId: null, shape: "square" }], "missing");
  assert.deepEqual(messy.nodes.map(node => [node.id, node.kind, node.parentId]), [
    ["group", "collection", null], ["circle", "object", "group"], ["square", "object", "group"],
    ["group-2", "collection", null], ["circle-2", "object", "group-2"],
    ["group-3", "collection", null], ["group-4", "collection", "group-3"], ["circle-3", "object", "group-4"], ["circle-4", "object", null]]);
  assert.equal(messy.carrier, "circle", "a missing carrier falls back to the first object");
  // Logs written with earlier models restore onto a structure.
  const legacy = decompositionSchema.parse({ algorithms: parts.algorithms, items: [
    { transformation: parts.items[1].transformation, region: parts.items[1].region, subject: { kind: "object", name: "Blob", description: "", primitive: "blob" }, member: null },
    { transformation: parts.items[0].transformation, region: parts.items[0].region, target: "collection", collection: { name: "Petals", description: "꽃잎들" }, object: { name: "Petal", description: "", primitive: "rect" } },
    { transformation: parts.items[1].transformation, region: parts.items[1].region, standIn: "square" }] });
  assert.deepEqual(legacy.items.map(item => exampleScene(legacy, item).scene.nodes.map(node => [node.name, node.transformations.length])),
    [[["Circle", 1]], [["Group", 1], ["Square", 0]], [["Square", 1]]]);
  const instruction = exampleInstruction(arrangement.scene, arrangement.example, "더 크게");
  assert.match(instruction, /minimal example of ONE semantic transformation, "Radial repetition"/); assert.match(instruction, /ONLY this transformation, to the collection "Group"/); assert.match(instruction, /User direction: 더 크게/);
  assert.match(instruction, /The object "Petal" is drawn to look like its element there/); assert.match(instruction, /Take nothing else from the image/); assert.match(instruction, /works unchanged on any shape/);
  assert.match(exampleInstruction(nested.scene, nested.example), /not the sketch's elements/, "stand-ins where no element fits");
});

test("the sketch's objects are minimal examples too: one element alone, no transformation, no pen", () => {
  const parts = decomposition(), { scene, example } = objectScene(parts.objects[0]);
  assert.deepEqual(scene.nodes.map(node => [node.id, node.kind, node.name, node.primitive, node.transformations.length]), [["petal", "object", "Petal", "petal", 0]]);
  assert.deepEqual(example, { kind: "object", nodeId: "petal", transformationId: "", elements: ["petal"] });
  assert.equal(examplePen(scene, "sketch-ob", example, "pen-x", "#3b73c4"), null);
  const instruction = exampleInstruction(scene, example);
  assert.match(instruction, /ONE object of the source sketch, "Petal"/); assert.match(instruction, /no copies, arrangement, variation/);
  // Board order: the objects, then the transformations.
  assert.deepEqual(exampleFrames(parts).map(frame => frame.name), ["Petal · object", "Radial repetition · example", "Petal curl · example", "Size falloff · example"]);
});

test("a pen made from an example follows it: values tuned there come along; its last state stays when the frame is gone", () => {
  const parts = decomposition(), { scene, example } = exampleScene(parts, parts.items[0]);
  const pen = examplePen(scene, "sketch-ex", example, "pen-1", "#3b73c4")!;
  assert.equal(pen.kind, "transformation"); assert.equal(pen.name, "Radial repetition");
  assert.equal(pen.meaning, "꽃잎을 중심 둘레에 반복합니다."); assert.equal(pen.transformation!.target, "collection");
  const tuned = setPropertyScalar({ ...createSketchPanel({ scene }) } as SketchPanel, "group", "count", [], 12).scene!;
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
    assert.equal(sent.compositionPens[0].transformation.label, "Radial repetition"); assert.equal(sent.compositionPens[0].appliesTo, "collection"); assert.equal(sent.compositionPens[0].subject, undefined, "the stand-ins are not part of the pen");
    assert.equal(sent.compositionPens[0].frameId, undefined); assert.equal(JSON.stringify(sent).includes("sketch-ex0"), false, "frames are the app's business");
    assert.match(calls[0].instructions, /THIS transformation applies HERE/); assert.match(calls[0].instructions, /copies that transformation into the node EXACTLY/);
  });
});

test("a composition's code reuses the code of the examples its transformations came from", async () => {
  const parts = decomposition(), { scene, example } = exampleScene(parts, parts.items[0]);
  const exampleCode = moduleCode("group", "const r = m.v(\"group/layout/radius\"); for (let i = 0; i < m.v(\"group/count\"); i++) p.circle(r, i, 4);");
  const examplePanel = { ...createSketchPanel({ scene, role: "example", example: { ...example, sourceFrameId: "source", penId: "p0" } }), generated: connectScene({ title: "Petals", explanation: "", code: exampleCode }, scene) };
  assert.match(exampleModule(examplePanel)!, /group\/layout\/radius/);
  assert.match(codeInstruction(examplePanel), /minimal example of ONE semantic transformation/);
  const pen = { ...examplePen(scene, "sketch-ex", example, "p0", "#3b73c4")!, id: "mark-pen-1" };
  const composed = convertComposition({ algorithms: [], nodes: [{ id: "ring", kind: "collection", parentId: null, name: "Ring", description: "", primitive: "group", region: { x: .1, y: .1, w: .5, h: .5 }, pens: ["mark-pen-1"], transformations: [], machine: null }] }, [pen]);
  const panels: Record<string, SketchPanel> = { "sketch-ex": examplePanel };
  const deps = { panel: (id: string) => panels[id] ?? createSketchPanel(), artwork: (id: string) => panels[id] ? { name: id, photo: null, strokes: [], revision: 0 } : undefined };
  const references = codeReferences(deps as never, composed);
  assert.deepEqual(references.map(item => [item.transformationId, item.label]), [["radial-repetition", "Radial repetition"]]);
  assert.match(references[0].code, /group\/count/);
  assert.deepEqual(codeReferences({ ...deps, artwork: () => undefined } as never, composed), [], "the example frame is gone: nothing to reuse");
  const composition = createSketchPanel({ scene: composed, role: "composition", composePrompt: "- 링으로 배치", instruction: "작게" });
  assert.equal(codeInstruction(composition), "- 링으로 배치\nUser direction: 작게");
  await withMockedAI(() => ({ title: "Ring", explanation: "", code: moduleCode("ring", sceneBindings(composed).map(binding => `m.v(${JSON.stringify(binding.key)});`).join(" ")) }), async calls => {
    await runAI(requestSchema.parse({ intent: "code", scene: composed, image, instruction: "x", references }), new AbortController().signal);
    assert.match(JSON.parse(calls[0].input[0].content[0].text).references[0].code, /group\/count/);
    assert.match(calls[0].instructions, /reuse each example's implementation/);
  });
});

test("Decompose makes a minimal example frame per object and per transformation beside the sketch (no pens until the user makes one), then codes each example on its own", async () => {
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
    createFrames: (from: string, names: string[]) => { assert.equal(from, "source"); return names.map(name => { const id = `sketch-${++made}`; assert.match(name, / · (example|object)$/); panels[id] = createSketchPanel(); return id; }); },
    addPen: (make: (id: string, color: string) => SemanticPen | null) => { const pen = make(`pen-${pens.length + 1}`, "#3b73c4"); if (pen) pens.push(pen); return pen; },
    resolvePen: (pen: SemanticPen) => pen, documentId: () => 1, requestId: () => 1, clip: () => null, setClip: () => {}, preview: () => undefined,
  } as any;
  await sceneAI(deps, "source").decompose();
  assert.deepEqual(panels.source.scene.nodes, [], "the sketch stays a sketch");
  const examples = ["sketch-1", "sketch-2", "sketch-3", "sketch-4"].map(id => panels[id]);
  assert.deepEqual(examples.map(item => [item.role, item.sourceFrameId, item.analysisRevision, item.example?.kind, item.example?.transformationId, item.example?.penId]),
    [["example", "source", 4, "object", "", ""], ["example", "source", 4, "transformation", "radial-repetition", ""], ["example", "source", 4, "transformation", "petal-curl", ""], ["example", "source", 4, "transformation", "petal-curl-2", ""]]);
  assert.deepEqual(pens, [], "pens are made with Make pen, not by Decompose");
  assert.deepEqual(requests.map(item => item.intent).sort(), ["code", "code", "code", "code", "decompose"]);
  const codeRequests = requests.filter(item => item.intent === "code");
  assert.deepEqual(codeRequests.map(item => item.owner).sort(), ["sketch-1", "sketch-2", "sketch-3", "sketch-4"]);
  assert.match(codeRequests.find(item => item.owner === "sketch-1")!.body.instruction, /ONE object of the source sketch/);
  assert.ok(codeRequests.filter(item => item.owner !== "sketch-1").every(item => /minimal example of ONE semantic transformation/.test(item.body.instruction)));
  // Each example is coded against itself, not the whole sketch, except that examples drawing the sketch's elements also see the source image.
  assert.equal(captured.filter(owner => owner !== "source").length, 4);
  assert.equal(captured.filter(owner => owner === "source").length, 2 + 3, "decompose (twice), then the object, Radial repetition and Petal curl examples");
  assert.ok(examples.every(item => item.generated && !item.pendingResult));
  // Each example runs: it draws, and its code is what a composition will reuse.
  for (const item of examples) { const sketch = run(item.generated!.code); sketch.draw(); assert.equal(sketch.circles.length, 1); }
});

test("AI history: a decompose log restores its example frames (no pens); a compose log its composition frame", () => {
  const project = projectSchema.parse({ version: 2, name: "p", artwork: { name: "Flower", photo: null, strokes: [], revision: 2 } });
  const input = requestSchema.parse({ intent: "decompose", image });
  const restored = recoverGeneration(input, decomposition(), { project, owner: "source" });
  const ids = restored.project.sketchFrames.map(frame => frame.id);
  assert.equal(ids.length, 4); assert.equal(restored.project.semanticPens.length, 0);
  assert.deepEqual(ids.map(id => [restored.project.sketchPanels[id].role, restored.project.sketchPanels[id].example?.kind]), [["example", "object"], ["example", "transformation"], ["example", "transformation"], ["example", "transformation"]]);
  assert.ok(ids.every(id => restored.project.sketchPanels[id].example?.penId === ""));
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
    // Every object goes as a plain stand-in; the pieces come back with no sketch objects and stand-ins only.
    assert.equal(split.transformation.id, "radial-repetition"); assert.equal(split.carrier, "group");
    assert.deepEqual(split.nodes.map((node: { id: string; shape: string | null; object: string | null }) => [node.id, node.shape, node.object]), [["group", null, null], ["petal", "circle", null]]);
    const pieces = decompositionSchema.parse(await runAI(requestSchema.parse({ intent: "decompose", image, scene, targetNodeId: example.nodeId, targetTransformationId: example.transformationId }), new AbortController().signal));
    assert.deepEqual(pieces.objects, []); assert.ok(pieces.items.every(item => item.nodes.every(node => node.object === null)));
    assert.deepEqual(split.algorithms.map((item: { id: string }) => item.id), ["radial-repeat"]);
    assert.match(calls[0].instructions, /DECOMPOSE IT FURTHER/);
    await assert.rejects(runAI(requestSchema.parse({ intent: "decompose", image, scene, targetNodeId: example.nodeId, targetTransformationId: "gone" }), new AbortController().signal), /나눌 transformation/);
  });
  const panels: Record<string, SketchPanel> = { "sketch-1": createSketchPanel({ role: "example", scene, sourceFrameId: "source", example: { ...example, sourceFrameId: "source", penId: "pen-0" } }) };
  const requests: { intent: string; owner: string; body: any }[] = [], toasts: string[] = [];
  let made = 1, pieces = splitDecomposition();
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
    resolvePen: (pen: SemanticPen) => pen, documentId: () => 1, requestId: () => 1, clip: () => null, setClip: () => {}, preview: () => undefined,
  } as any;
  await sceneAI(deps, "sketch-1").decompose();
  assert.deepEqual(requests[0].body.targetTransformationId, "radial-repetition"); assert.equal(requests[0].body.scene.nodes.length, 2);
  const smaller = ["sketch-2", "sketch-3", "sketch-4"].map(id => panels[id]);
  assert.ok(smaller.every(item => item.role === "example" && item.sourceFrameId === "sketch-1" && item.example?.sourceFrameId === "sketch-1" && item.generated));
  assert.equal(panels["sketch-1"].example?.transformationId, "radial-repetition", "the example (and its pen) stays");
  // Already minimal: nothing is made, and the model's reason is shown.
  pieces = { ...pieces, items: pieces.items.slice(0, 1), minimalReason: "개수 하나만 조절합니다." }; requests.length = 0;
  await sceneAI(deps, "sketch-1").decompose();
  assert.equal(made, 4); assert.match(toasts.at(-1)!, /최소 단위로 보고 나누지 않았습니다: 개수 하나만 조절합니다\./);
  assert.equal(convertDecomposition({ ...structuredClone(aiDecomposition), minimalReason: "이유" }, true).minimalReason, "", "a reason only comes with one piece");
  // The AI history restores the same way.
  const project = projectSchema.parse({ version: 2, name: "p", artwork: { name: "Flower", photo: null, strokes: [], revision: 0 } });
  const input = requestSchema.parse({ intent: "decompose", image, scene, targetNodeId: example.nodeId, targetTransformationId: example.transformationId });
  assert.equal(recoverGeneration(input, pieces, { project, owner: "source" }).project.sketchFrames.length, 0);
  assert.equal(recoverGeneration(input, splitDecomposition(), { project, owner: "source" }).project.sketchFrames.length, 3);
});
