import test from "node:test";
import assert from "node:assert/strict";
import { recoverGeneration, recoveryContextSchema } from "../app/lib/generation-recovery";
import { requestSchema, generatedSchema } from "../app/lib/schema";
import { projectSchema } from "../app/lib/project";
import { sampleScene } from "./fixtures/scene";
import { updateNode } from "../app/lib/scene/graph";

const scene = sampleScene();
const code = generatedSchema.parse({ title: "Result", explanation: "", code: "p.setup=()=>{p.createCanvas(900,600);p.noLoop();};" });
const image = "data:image/png;base64,AAAA";
const project = projectSchema.parse({ version: 2, name: "Before", artwork: { name: "Original", photo: image, strokes: [], revision: 1 },
  sketchFrames: [{ id: "sketch-owner", artwork: { name: "Owner", photo: image, strokes: [], revision: 4 } }],
  sketchPanels: { "sketch-owner": { scene, generated: code, composePrompt: "old prompt" } },
});
const context = recoveryContextSchema.parse({ project, owner: "sketch-owner" });

test("AI outputs that change a frame restore into that frame and leave the others intact", () => {
  const renamed = updateNode(scene, "tree", node => ({ ...node, name: "Grown tree" }));
  const outputs: Record<string, unknown> = { transform: renamed, code, "compose-prompt": { prompt: "new prompt" } };
  for (const intent of Object.keys(outputs)) {
    const input = requestSchema.parse({ intent, scene, targetNodeId: "tree", previous: code.code, instruction: "new prompt" });
    const restored = recoverGeneration(input, outputs[intent], context);
    const panel = restored.project.sketchPanels[context.owner];
    assert.equal(restored.project.activeSketchId, context.owner, intent);
    assert.deepEqual(restored.project.sketchPanels.source, project.sketchPanels.source);
    assert.deepEqual(restored.project.sketchFrames, project.sketchFrames);
    assert.deepEqual(context.project, project);
    if (intent === "transform") { assert.equal(panel.scene.nodes[0].name, "Grown tree"); assert.deepEqual(panel.selectedNodeIds, ["tree"]); }
    if (intent === "code") assert.deepEqual(panel.generated, code);
    if (intent === "compose-prompt") assert.equal(panel.composePrompt, "new prompt");
  }
});

test("a restored generation brings the board back as it was: frame positions and the view", () => {
  const board = { ...project, workspace: { ...project.workspace, camera: { x: -812, y: 140, zoom: .42 }, frames: { ...project.workspace.frames, "sketch-owner": { x: 3310, y: 920 } } } };
  const restored = recoverGeneration(requestSchema.parse({ intent: "code", scene }), code, recoveryContextSchema.parse({ ...context, project: board }));
  assert.deepEqual(restored.project.workspace.frames["sketch-owner"], { x: 3310, y: 920 });
  assert.deepEqual(restored.project.workspace.camera, { x: -812, y: 140, zoom: .42 });
});

test("logs without a project snapshot restore into a fresh project", () => {
  const restored = recoverGeneration(requestSchema.parse({ intent: "code", scene, image }), code);
  assert.equal(restored.owner, "source");
  assert.deepEqual(restored.project.sketchPanels.source.generated, code);
  assert.deepEqual(restored.project.sketchPanels.source.scene, scene);
});
