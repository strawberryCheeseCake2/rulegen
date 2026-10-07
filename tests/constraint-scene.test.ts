import test, { after } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { constraintSceneSchema, requestSchema, type Feature, type RuleGroup, type ConstraintScene } from "../app/lib/schema";
import { sceneFromRules, rulesFromScene, applyRuleRevision, addSceneNode, dropSceneNode, copySceneNode, constraintApplications, withSceneReference, withoutTemporalConstraints, MAX_EXTRACTED_WIDGETS, sceneGroups, sceneTopology, connectAlgorithm, reparentNode, transformNode, removeNode, updateAlgorithmParameter } from "../app/lib/constraint-scene";
import { getBindings, syncParameters, parameterKey } from "../app/lib/live-parameters";
import { connectParameters } from "../app/server/live-code.server";
import { prepareCode } from "../app/server/code.server";
import { projectSchema } from "../app/lib/project";
import { createSketchPanel, savedSketchPanels, panelLiveGroups } from "../app/lib/sketch-panels";
import { runAI } from "../app/server/ai.server";

const features: Feature[] = [{ id: "leaf", label: "Leaves", description: "반복되는 잎", region: { x: .1, y: .1, w: .6, h: .6 } }];
const groups: RuleGroup[] = [{ featureId: "leaf", title: "Leaves", subfeatures: [
  { id: "repeat", label: "Repetition", kind: "spatial", primitive: null, selectedImplementation: "linear", implementations: [{ id: "linear", label: "Linear", description: "count evenly spaced along group x; no animation", parameters: [{ id: "count", label: "Count", type: "number", value: 5, min: 1, max: 20, step: 1, unit: "" }] }] },
  { id: "leaf", label: "Leaf primitive", kind: "object", primitive: "ellipse", selectedImplementation: "ellipse", implementations: [{ id: "ellipse", label: "Ellipse shape", description: "ellipse aspect ratio", parameters: [] }] },
  { id: "outline", label: "Outline", kind: "stylistic", primitive: null, selectedImplementation: "stroke", implementations: [{ id: "stroke", label: "Stroke", description: "strokeWeight(width)", parameters: [{ id: "width", label: "Width", type: "number", value: 1, min: 0, max: 10, step: .1, unit: "px" }] }] },
  { id: "palette", label: "Palette", kind: "stylistic", primitive: null, selectedImplementation: "solid", implementations: [{ id: "solid", label: "Solid", description: "fill(color)", parameters: [{ id: "color", label: "Color", type: "color", value: "#397461" }] }] },
] }];
const scene = () => sceneFromRules(features, groups);

test("extraction creates the three active widget categories with primitive membership and independent algorithm assets", () => {
  const graph = scene();
  assert.deepEqual(graph.nodes.map(n => n.kind), ["spatial", "object", "stylistic", "stylistic"]);
  const spatial = graph.nodes[0], object = graph.nodes[1];
  assert.equal(object.parentId, spatial.id); assert.equal(object.primitive, "ellipse"); assert.deepEqual(object.algorithmIds, []);
  assert.equal(graph.algorithms.length, 4);
  for (const constraint of graph.nodes.slice(2)) assert.deepEqual(constraint.targetIds, [spatial.id]);
  assert.deepEqual(graph, sceneFromRules(features, groups, graph));
});

test("detaching, moving and sharing algorithms preserve one canonical algorithm and exact parameter semantics", () => {
  const graph = scene(), [spatial, , temporal, stylistic] = graph.nodes, id = spatial.algorithmIds[0];
  const detached = connectAlgorithm(graph, spatial.id, id, false);
  assert.equal(detached.algorithms.length, graph.algorithms.length); assert.ok(!detached.nodes[0].algorithmIds.includes(id));
  const moved = connectAlgorithm(detached, temporal.id, id, true);
  const shared = connectAlgorithm(moved, stylistic.id, id, true);
  const edited = updateAlgorithmParameter(shared, id, "count", 9);
  const bound = sceneGroups(edited).flatMap(g => g.subfeatures.filter(s => s.id === id).map(s => s.implementations[0].parameters[0].value));
  assert.deepEqual(bound, [9, 9]); assert.equal(graph.algorithms[0].implementation.parameters[0].value, 5);
  assert.throws(() => connectAlgorithm(graph, graph.nodes[1].id, id, true));
});

test("moving and resizing nested spatial groups transforms children once and keeps bounds finite", () => {
  let graph = scene();
  const [parent, child] = graph.nodes;
  graph = transformNode(graph, child.id, { x: .2, y: .2, w: .1, h: .1 });
  graph = transformNode(graph, parent.id, { x: .3, y: .3, w: .3, h: .3 });
  const object = graph.nodes[1];
  assert.ok(Math.abs(object.box.x - .35) < 1e-9); assert.ok(Math.abs(object.box.w - .05) < 1e-9);
  graph = transformNode(graph, parent.id, { x: -1, y: 2, w: 2, h: 0 });
  assert.doesNotThrow(() => constraintSceneSchema.parse(graph));
});

test("membership rejects cycles, orphan references and non-spatial parents; removal keeps objects and algorithms", () => {
  const graph = scene();
  const nested = { ...graph.nodes[0], id: "nested", parentId: graph.nodes[0].id };
  const withNested = { ...graph, nodes: [...graph.nodes, nested] };
  assert.throws(() => reparentNode(withNested, graph.nodes[0].id, nested.id));
  assert.throws(() => reparentNode(graph, graph.nodes[1].id, graph.nodes[2].id));
  const bad = structuredClone(graph); bad.nodes[0].algorithmIds.push("missing");
  assert.equal(requestSchema.safeParse({ intent: "constraint-code", scene: bad }).success, false);
  const noGroup = removeNode(graph, graph.nodes[0].id);
  assert.equal(noGroup.nodes[0].parentId, null); assert.deepEqual(noGroup.algorithms, graph.algorithms);
  assert.doesNotThrow(() => constraintSceneSchema.parse(noGroup));
});

test("revision uses edited canonical values, preserves relocated assets and deliberately deleted widgets", () => {
  let graph = scene();
  const algorithm = graph.nodes[0].algorithmIds[0], receiverId = graph.nodes[2].id;
  graph = connectAlgorithm(connectAlgorithm(graph, graph.nodes[0].id, algorithm, false), graph.nodes[2].id, algorithm, true);
  graph = updateAlgorithmParameter(graph, algorithm, "count", 8);
  graph = removeNode(graph, graph.nodes[1].id);
  const current = rulesFromScene(groups, graph);
  assert.equal(current[0].subfeatures[0].implementations[0].parameters[0].value, 8);
  const proposed = structuredClone(current);
  proposed[0].subfeatures[0].implementations[0].parameters[0].value = 9;
  const revised = applyRuleRevision(features, current, proposed, graph);
  assert.equal(revised.nodes.some(n => n.kind === "object"), false);
  assert.ok(revised.nodes.find(n => n.id === receiverId)!.algorithmIds.includes(algorithm));
  assert.ok(!revised.nodes.find(n => n.kind === "spatial")!.algorithmIds.includes(algorithm));
  assert.equal(revised.algorithms.find(a => a.id === algorithm)!.implementation.parameters[0].value, 9);
  const removedFeature = applyRuleRevision([], current, [], graph);
  assert.equal(removedFeature.nodes.length, 0); assert.equal(removedFeature.algorithms.length, graph.algorithms.length);
});

test("palette drops create primitives inside spatial constraints and connect stylistic influence", () => {
  const graph = addSceneNode(scene(), "object", { x: .4, y: .4 }, "drop-object", "triangle");
  const object = graph.nodes.find(n => n.id === "drop-object")!;
  assert.equal(object.primitive, "triangle"); assert.equal(object.parentId, graph.nodes[0].id);
  const applications = constraintApplications(graph);
  for (const application of applications) assert.ok(application.objectIds.includes(object.id));
  const outside = dropSceneNode(graph, object.id, { x: .9, y: .9 });
  assert.equal(outside.nodes.find(n => n.id === object.id)!.parentId, null);
  assert.ok(!constraintApplications(outside).find(a => a.kind === "spatial")!.objectIds.includes(object.id));
});
test("dropping a constraint over existing primitives links targets, while cross-frame copies retain children and algorithms", () => {
  const graph = addSceneNode(scene(), "stylistic", { x: .4, y: .4 }, "new-style");
  assert.ok(graph.nodes.find(n => n.id === "new-style")!.targetIds.includes(graph.nodes[1].id));
  let sequence = 0;
  const copied = copySceneNode(graph, { nodes: [], algorithms: [] }, graph.nodes[0].id, { x: .5, y: .5 }, () => `copy-${++sequence}`);
  assert.equal(copied.scene.nodes.length, 5);
  assert.equal(copied.scene.nodes.filter(n => n.kind === "stylistic").length, 3);
  assert.equal(copied.scene.nodes.find(n => n.kind === "object")!.parentId, copied.nodeId);
  assert.ok(copied.scene.algorithms.length > 0);
  assert.deepEqual(copied.scene.algorithms[0].implementation, graph.algorithms[0].implementation);
  assert.doesNotThrow(() => requestSchema.parse({ intent: "constraint-code", scene: copied.scene }));
});

function boundSource(graph: ConstraintScene) {
  const bindings = getBindings(sceneGroups(graph));
  const object = graph.nodes.find(n => n.kind === "object")!;
  const geometry = (id: string) => `rulegenParams[${JSON.stringify(parameterKey(`widget:${object.id}`, "geometry", "bounds", id))}]`;
  const code = `p.setup=()=>{p.createCanvas(900,600);const values=[${bindings.map(b => `rulegenParams[${JSON.stringify(b.key)}]`).join(",")}];p.ellipse(${geometry("x")},${geometry("y")},${geometry("w")},${geometry("h")});p.noLoop();}`;
  return connectParameters({ title: "Scene", explanation: "조작 가능한 결과", code }, sceneGroups(graph));
}
test("direct geometry manipulation changes actual compiled p5 drawing calls without generating code again", () => {
  const graph = scene(), generated = boundSource(graph);
  const moved = transformNode(graph, graph.nodes[0].id, { x: .2, y: .3, w: .3, h: .2 });
  assert.equal(sceneTopology(graph), sceneTopology(moved));
  const source = syncParameters(generated.code, sceneGroups(moved), generated.bindings);
  let geometry: number[] = [];
  const p = { setup: () => {}, createCanvas() {}, noLoop() {}, ellipse: (...args: number[]) => { geometry = args; } };
  vm.runInNewContext(prepareCode(source), { p, __rulegenGuard() {} }); p.setup();
  assert.deepEqual(geometry, [180, 180, 270, 120]);
  assert.notEqual(sceneTopology(graph), sceneTopology(connectAlgorithm(graph, graph.nodes[0].id, graph.nodes[0].algorithmIds[0], false)));
});

test("legacy rules migrate and per-sketch graph, shared assets, geometry and linked code survive project roundtrip", () => {
  const graph = scene(), generated = boundSource(graph);
  const base = createSketchPanel();
  const moved = transformNode(graph, graph.nodes[0].id, { x: .2, y: .2, w: .5, h: .5 });
  const panel = { ...base, features, groups, scene: moved, selectedWidget: graph.nodes[0].id, generated, generationMode: "constraints" as const, compiledScene: sceneTopology(graph) };
  const saved = projectSchema.parse({ version: 1, name: "Graph", artwork: { strokes: [], photo: null, name: "Graph", revision: 0 }, features, groups, analysisRevision: 0, generated, brush: null, savedBrushes: [], sketchFrames: [{ id: "sketch-b", artwork: { strokes: [], photo: null, name: "B", revision: 0 } }], sketchPanels: savedSketchPanels({ source: panel, "sketch-b": base }) });
  const restored = projectSchema.parse(JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(restored.sketchPanels.source.scene, moved); assert.deepEqual(restored.sketchPanels["sketch-b"].scene.nodes, []);
  assert.equal(restored.sketchPanels.source.selectedWidget, graph.nodes[0].id);
  assert.equal(restored.sketchPanels.source.generated!.code, syncParameters(generated.code, panelLiveGroups(panel), generated.bindings));
  assert.deepEqual(createSketchPanel({ ...restored.sketchPanels.source, scene: undefined } as any).scene, graph);
});

const logs = mkdtempSync(path.join(tmpdir(), "rulegen-constraint-tests-"));
after(() => rmSync(logs, { recursive: true, force: true }));
test("constraint code API transmits graph references and all live bindings and rejects incomplete geometry code", async () => {
  const previous = { fetch: globalThis.fetch, key: process.env.OPENAI_API_KEY, log: process.env.RULEGEN_AI_LOG_DIR };
  process.env.OPENAI_API_KEY = "test-only"; process.env.RULEGEN_AI_LOG_DIR = logs;
  let payload: any;
  const graph = scene(), source = boundSource(graph).code.split("// @rulegen-parameters:end")[1];
  globalThis.fetch = async (_url, options) => {
    payload = JSON.parse(options!.body as string);
    return Response.json({ output: [{ content: [{ type: "output_text", text: JSON.stringify({ title: "Graph", explanation: "위젯 결과", code: source }) }] }] });
  };
  try {
    const result = await runAI(requestSchema.parse({ intent: "constraint-code", scene: graph }), new AbortController().signal) as ReturnType<typeof boundSource>;
    const context = JSON.parse(payload.input[0].content[0].text);
    assert.deepEqual(context.scene, graph); assert.deepEqual(context.constraintApplications, constraintApplications(graph)); assert.equal("compositionPens" in context, false);
    assert.equal(result.bindings.length, getBindings(sceneGroups(graph)).length);
    assert.match(payload.instructions, /ABSOLUTE canvas coordinates/);
    globalThis.fetch = async () => Response.json({ output: [{ content: [{ type: "output_text", text: JSON.stringify({ title: "Bad", explanation: "", code: "p.setup=()=>{p.createCanvas(900,600);p.noLoop();}" }) }] }] });
    await assert.rejects(() => runAI(requestSchema.parse({ intent: "constraint-code", scene: graph }), new AbortController().signal), /위젯을 코드에 연결/);
  } finally {
    globalThis.fetch = previous.fetch;
    for (const [key, value] of [["OPENAI_API_KEY", previous.key], ["RULEGEN_AI_LOG_DIR", previous.log]]) { if (value === undefined) delete process.env[key!]; else process.env[key!] = value; }
  }
});


test("reconstruction preserves precise motif bounds and references when a style feature shares another feature's geometry", () => {
  const image = "data:image/png;base64,YQ==";
  const styleFeature: Feature = { id: "ink", label: "Ink", description: "dark green outline", region: features[0].region };
  const extraction: RuleGroup[] = [
    { featureId: "ink", title: "Ink", subfeatures: [{ ...groups[0].subfeatures[3], targetSubfeatureIds: ["repeat"] }] },
    { ...groups[0], subfeatures: [groups[0].subfeatures[0], { ...groups[0].subfeatures[1], primitive: "path", region: { x: .22, y: .21, w: .06, h: .1 }, parentSubfeatureId: "repeat" }] },
  ];
  const graph = withSceneReference(sceneFromRules([...features, styleFeature], extraction), [...features, styleFeature], image);
  assert.equal(graph.nodes.length, 3, "style features must not add duplicate objects or empty layout groups");
  assert.ok(graph.nodes.length <= MAX_EXTRACTED_WIDGETS);
  const object = graph.nodes.find(n => n.kind === "object")!, layout = graph.nodes.find(n => n.kind === "spatial")!, style = graph.nodes.find(n => n.kind === "stylistic")!;
  assert.deepEqual(object.box, { x: .22, y: .21, w: .06, h: .1 });
  assert.equal(object.primitive, "path");
  assert.equal(object.parentId, layout.id);
  assert.deepEqual(style.targetIds, [layout.id]);
  assert.equal(object.source!.feature.description, features[0].description);
  assert.equal(graph.references![0].image, image);
  assert.equal(graph.algorithms.filter(a => layout.algorithmIds.includes(a.id)).length, 1);
  assert.ok(object.definitionId); assert.ok(graph.algorithms.some(a => a.id === object.definitionId));
  let sequence = 0;
  const copied = copySceneNode(graph, { nodes: [], algorithms: [] }, object.id, { x: .6, y: .6 }, () => `transfer-${++sequence}`);
  const transferred = copied.scene.nodes.find(n => n.id === copied.nodeId)!;
  assert.equal(copied.scene.nodes.length, 3, "object transfer carries its layout/shape and style constraints");
  assert.equal(transferred.box.w, object.box.w); assert.equal(transferred.box.h, object.box.h);
  assert.deepEqual(transferred.source, object.source);
  assert.deepEqual(copied.scene.references, graph.references);
  assert.ok(constraintApplications(copied.scene).every(a => a.objectIds.includes(transferred.id)));
  assert.doesNotThrow(() => constraintSceneSchema.parse(copied.scene));
});

test("movement and parent assignment never resize a constraint or its objects", () => {
  const graph = scene(), layout = graph.nodes[0];
  const added = addSceneNode(graph, "object", { x: .4, y: .4 }, "big", "rectangle");
  const moved = dropSceneNode(added, layout.id, { x: .8, y: .8 });
  for (const node of added.nodes) {
    const next = moved.nodes.find(n => n.id === node.id)!;
    assert.equal(next.box.w, node.box.w); assert.equal(next.box.h, node.box.h);
  }
  const outside = addSceneNode(graph, "object", { x: .9, y: .9 }, "outside", "ellipse");
  const original = outside.nodes.find(n => n.id === "outside")!;
  const inside = dropSceneNode(outside, original.id, { x: .4, y: .4 }).nodes.find(n => n.id === original.id)!;
  assert.equal(inside.box.w, original.box.w); assert.equal(inside.box.h, original.box.h);
});

test("temporal widgets are excluded from extraction and migrated scenes", () => {
  const legacy: RuleGroup[] = [{ ...groups[0], subfeatures: [...groups[0].subfeatures, { ...groups[0].subfeatures[2], id: "old-time", kind: "temporal" }] }];
  const graph = sceneFromRules(features, legacy);
  assert.equal(graph.nodes.some(n => n.kind === "temporal"), false);
  assert.equal(graph.algorithms.some(a => a.subfeatureId === "old-time"), false);
  const oldNode = { ...graph.nodes[2], id: "time-widget", kind: "temporal" as const };
  assert.equal(withoutTemporalConstraints({ ...graph, nodes: [...graph.nodes, oldNode] }).nodes.some(n => n.kind === "temporal"), false);
});

test("reference images reach the reconstruction model separately from text and copied appearance survives persistence", async () => {
  const previous = { fetch: globalThis.fetch, key: process.env.OPENAI_API_KEY, log: process.env.RULEGEN_AI_LOG_DIR };
  process.env.OPENAI_API_KEY = "test-only"; process.env.RULEGEN_AI_LOG_DIR = logs;
  const image = "data:image/png;base64,YQ==", graph = withSceneReference(scene(), features, image);
  let payload: any;
  globalThis.fetch = async (_url, options) => {
    payload = JSON.parse(options!.body as string);
    return Response.json({ output: [{ content: [{ type: "output_text", text: JSON.stringify({ title: "Reference", explanation: "", code: boundSource(graph).code.split("// @rulegen-parameters:end")[1] }) }] }] });
  };
  try {
    await runAI(requestSchema.parse({ intent: "constraint-code", scene: graph }), new AbortController().signal);
    const content = payload.input[0].content;
    const context = JSON.parse(content[0].text);
    assert.equal(context.scene.references[0].image, undefined);
    assert.deepEqual(content.filter((c: any) => c.type === "input_image").map((c: any) => c.image_url), [image]);
    assert.match(payload.instructions, /faithful procedural/); assert.match(payload.instructions, /source.referenceId/);
    const panel = createSketchPanel(); panel.scene = graph;
    const restored = createSketchPanel(savedSketchPanels({ source: panel }).source);
    assert.deepEqual(restored.scene, graph);
  } finally {
    globalThis.fetch = previous.fetch;
    for (const [key, value] of [["OPENAI_API_KEY", previous.key], ["RULEGEN_AI_LOG_DIR", previous.log]]) { if (value === undefined) delete process.env[key!]; else process.env[key!] = value; }
  }
});


test("image extraction enforces a shared seven-widget budget and disables temporal in provider schema", async () => {
  const previous = { fetch: globalThis.fetch, key: process.env.OPENAI_API_KEY, log: process.env.RULEGEN_AI_LOG_DIR };
  process.env.OPENAI_API_KEY = "test-only"; process.env.RULEGEN_AI_LOG_DIR = logs;
  let payload: any;
  globalThis.fetch = async (_url, options) => {
    payload = JSON.parse(options!.body as string);
    return Response.json({ output: [{ content: [{ type: "output_text", text: JSON.stringify({ groups }) }] }] });
  };
  try {
    await runAI(requestSchema.parse({ intent: "rules", features, image: "data:image/png;base64,YQ==", widgetBudget: 7 }), new AbortController().signal);
    const context = JSON.parse(payload.input[0].content[0].text);
    assert.equal(context.widgetBudget, 7);
    assert.match(payload.instructions, /TOTAL/); assert.match(payload.instructions, /never more than 7/);
    const enumTypes = payload.text.format.schema.properties.groups.items.properties.subfeatures.items.properties.kind.enum;
    assert.deepEqual(enumTypes, ["spatial", "stylistic", "object"]);
    await assert.rejects(() => runAI(requestSchema.parse({ intent: "rules", features, widgetBudget: 3 }), new AbortController().signal), /최대 3개/);
  } finally {
    globalThis.fetch = previous.fetch;
    for (const [key, value] of [["OPENAI_API_KEY", previous.key], ["RULEGEN_AI_LOG_DIR", previous.log]]) { if (value === undefined) delete process.env[key!]; else process.env[key!] = value; }
  }
});


test("independent background objects keep their definition parameters and are not copied with a spatial motif", () => {
  const background = { ...groups[0].subfeatures[1], id: "background", label: "Background", primitive: "rectangle" as const, parentSubfeatureId: null,
    implementations: [{ id: "ellipse", label: "Panel fill", description: "background fill(color)", parameters: [{ id: "color", label: "Color", type: "color" as const, value: "#202125" }] }] };
  const graph = sceneFromRules(features, [{ ...groups[0], subfeatures: [...groups[0].subfeatures, background] }]);
  const panel = graph.nodes.find(n => n.label === "Background")!;
  assert.equal(panel.parentId, null);
  assert.ok(panel.definitionId);
  const definition = graph.algorithms.find(a => a.id === panel.definitionId)!;
  assert.ok(getBindings(sceneGroups(graph)).some(b => b.featureId === `widget:${panel.id}` && b.parameterId === "color"));
  assert.ok(!graph.nodes[0].algorithmIds.includes(definition.id));
  let sequence = 0;
  const copy = copySceneNode(graph, { nodes: [], algorithms: [] }, graph.nodes[0].id, { x: .5, y: .5 }, () => `copy-motif-${++sequence}`);
  assert.equal(copy.scene.nodes.some(n => n.label === "Background"), false);
  assert.equal(copy.scene.algorithms.some(a => a.id === definition.id), false);
  assert.ok(copy.scene.nodes.find(n => n.kind === "object")!.definitionId);
});
