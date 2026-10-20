import test from "node:test";
import assert from "node:assert/strict";
import { recoverGeneration, recoveryContextSchema } from "../app/lib/generation-recovery";
import { requestSchema, generatedSchema } from "../app/lib/schema";
import { projectSchema } from "../app/lib/project";
import { sampleScene, num } from "./fixtures/scene";
import { updateNode } from "../app/lib/scene/graph";

const scene = sampleScene();
const code = generatedSchema.parse({ title: "Result", explanation: "", code: "p.setup=()=>{p.createCanvas(900,600);p.noLoop();};" });
const image = "data:image/png;base64,AAAA";
const annotations = [{ id: "mark", points: [{ x: .1, y: .1 }, { x: .2, y: .2 }] }];
const project = projectSchema.parse({ version: 2, name: "Before", artwork: { name: "Original", photo: image, strokes: [], revision: 1 },
  sketchFrames: [{ id: "sketch-owner", artwork: { name: "Owner", photo: image, strokes: [], revision: 4 } }],
  sketchPanels: { "sketch-owner": { scene, generated: code, composePrompt: "old prompt" } },
});
const context = recoveryContextSchema.parse({ project, owner: "sketch-owner", annotations, annotationImage: image });

test("every AI output restores to its own sketch and leaves other sketches intact", () => {
  const renamed = updateNode(scene, "tree", node => ({ ...node, name: "Grown tree" }));
  const withMachine = updateNode(scene, "tree", node => ({ ...node, machine: { initialState: "a", states: [{ id: "a", label: "A", description: "", values: [] }], transitions: [] } }));
  const outputs: Record<string, unknown> = {
    extract: scene, compose: renamed, transform: renamed, "state-machine": withMachine, code,
    "compose-prompt": { prompt: "new prompt" },
    "machine-refine": { scene: withMachine, composePrompt: "- refined prompt" },
    clarification: { clarification: "가지를 키워줘" },
    revision: { summary: "가지를 키웁니다", scene: renamed },
    concern: { suggestions: ["잎 끝 개수가 궁금해"] },
    handles: { handles: [{ propertyId: "ink", handle: { code: "rulegenHandle(function (h) { return {}; });", prepared: "rulegenHandle(function (h) { __rulegenGuard(); return {}; });", paths: [[]], hint: "먹색 고르기" } }] },
  };
  for (const intent of requestSchema.shape.intent.options) {
    const input = requestSchema.parse({ intent, scene, targetNodeId: "tree", previous: code.code, instruction: "new prompt" });
    const restored = recoverGeneration(input, outputs[intent], context);
    const panel = restored.project.sketchPanels[context.owner];
    assert.equal(restored.project.activeSketchId, context.owner, intent);
    assert.deepEqual(restored.project.sketchPanels.source, project.sketchPanels.source);
    assert.deepEqual(restored.project.sketchFrames, project.sketchFrames);
    assert.deepEqual(context.project, project);
    if (intent === "extract") { assert.equal(panel.analysisRevision, 4); assert.equal(panel.generated, null); assert.deepEqual(panel.scene.nodes.map(node => node.id), ["tree", "orb"]); }
    if (intent === "compose") { assert.equal(panel.scene.nodes[0].name, "Grown tree"); assert.equal(panel.generationMode, "compose"); assert.equal(panel.composePrompt, "new prompt"); }
    if (intent === "transform") { assert.equal(panel.scene.nodes[0].name, "Grown tree"); assert.deepEqual(panel.selectedNodeIds, ["tree"]); }
    if (intent === "state-machine") { assert.equal(panel.scene.nodes[0].machine?.initialState, "a"); assert.equal(panel.editingStates.tree, "a"); }
    if (intent === "code") { assert.deepEqual(panel.generated, code); assert.equal(restored.annotationImage, ""); }
    if (intent === "compose-prompt") assert.equal(panel.composePrompt, "new prompt");
    if (intent === "machine-refine") { assert.equal(panel.scene.nodes[0].machine?.initialState, "a"); assert.equal(panel.composePrompt, "- refined prompt"); }
    if (intent === "clarification") { assert.equal(restored.revisionInstruction, "가지를 키워줘"); assert.deepEqual(restored.annotations, annotations); }
    if (intent === "handles") { assert.equal(panel.scene.nodes[0].transformations[1].properties[0].handle?.hint, "먹색 고르기"); assert.deepEqual(panel.selectedNodeIds, ["tree"]); }
    if (intent === "revision") { assert.equal(restored.proposal?.scene.nodes[0].name, "Grown tree"); assert.equal(panel.scene.nodes[0].name, "Tree", "proposals are not applied"); }
  }
});

test("a restored generation brings the board back as it was: frame positions and the view", () => {
  const board = { ...project, workspace: { ...project.workspace, camera: { x: -812, y: 140, zoom: .42 }, frames: { ...project.workspace.frames, "sketch-owner": { x: 3310, y: 920 } } } };
  const restored = recoverGeneration(requestSchema.parse({ intent: "code", scene }), code, recoveryContextSchema.parse({ ...context, project: board }));
  assert.deepEqual(restored.project.workspace.frames["sketch-owner"], { x: 3310, y: 920 });
  assert.deepEqual(restored.project.workspace.camera, { x: -812, y: 140, zoom: .42 });
});

test("a confirmed revision restores the whole proposed scene along with its code", () => {
  const proposed = updateNode(scene, "orb", node => ({ ...node, transformations: [...node.transformations, { id: "glow-layer", label: "Glow", description: "", properties: [{ id: "glow", label: "Glow", effect: "stylistic" as const, description: "", value: num(3, 0, 10) }] }] }));
  const input = requestSchema.parse({ intent: "code", scene: proposed, revisionSummary: "Glow 추가" });
  const restored = recoverGeneration(input, code, { ...context, proposal: { summary: "Glow 추가", scene: proposed } });
  assert.deepEqual(restored.project.sketchPanels[context.owner].scene, proposed);
});

test("logs without a project snapshot restore into a fresh project", () => {
  const restored = recoverGeneration(requestSchema.parse({ intent: "code", scene, image }), code);
  assert.equal(restored.owner, "source");
  assert.deepEqual(restored.project.sketchPanels.source.generated, code);
  assert.deepEqual(restored.project.sketchPanels.source.scene, scene);
});
