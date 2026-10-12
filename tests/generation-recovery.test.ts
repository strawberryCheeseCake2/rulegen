import test from "node:test";
import assert from "node:assert/strict";
import { recoverGeneration, recoveryContextSchema } from "../app/lib/generation-recovery";
import { requestSchema, generatedSchema } from "../app/lib/schema";
import { projectSchema } from "../app/lib/project";

const feature = { id: "curve", label: "Curve", description: "곡선", region: { x: .1, y: .1, w: .5, h: .5 } };
const subfeature = { id: "shape", label: "Shape", selectedImplementation: "curve", implementations: [{ id: "curve", label: "Curve", description: "곡선", parameters: [] }] };
const group = { featureId: feature.id, title: "Curve", subfeatures: [subfeature] };
const code = generatedSchema.parse({ title: "Result", explanation: "", code: "p.setup=()=>{p.createCanvas(900,600);p.noLoop();};" });
const image = "data:image/png;base64,AAAA";
const annotations = [{ id: "mark", points: [{ x: .1, y: .1 }, { x: .2, y: .2 }] }];
const project = projectSchema.parse({ version: 1, name: "Before", artwork: { name: "Original", photo: image, strokes: [], revision: 1 },
  sketchFrames: [{ id: "sketch-owner", artwork: { name: "Owner", photo: image, strokes: [], revision: 4 } }],
  features: [feature], groups: [group], generated: code, analysisRevision: 1, brush: null, savedBrushes: [],
  sketchPanels: { "sketch-owner": { features: [feature], groups: [group], generated: code, composePrompt: "old prompt" } },
});
const context = recoveryContextSchema.parse({ project, owner: "sketch-owner", annotations, annotationImage: image });

test("every AI output restores to its own sketch and leaves other sketches intact", () => {
  const outputs = {
    analyze: { features: [feature, { ...feature, id: "rhythm", label: "Rhythm" }] },
    rules: { groups: [{ ...group, title: "New rules" }] },
    subfeature: { ...subfeature, label: "New shape" },
    code, compose: code,
    brush: { name: "Dots", description: "점", settings: { size: 30, spacing: 10, spread: 0, variation: 0, taper: 0, color: "#334455" }, primitives: [{ kind: "ellipse", coords: [0, 0, 1, 1], weight: .05, filled: false, depth: 0 }] },
    "compose-prompt": { prompt: "new prompt" },
    clarification: { clarification: "곡선을 키워줘" },
    revision: { summary: "곡선을 키웁니다", features: [{ ...feature, label: "Bigger curve" }], groups: [group] },
    "state-machine": { initialState: "scene", states: [{ id: "scene", label: "Scene", description: "곡선", features: [feature], groups: [group] }], transitions: [] },
  };
  for (const intent of requestSchema.shape.intent.options) {
    const input = requestSchema.parse({ intent, features: [feature], groups: [group], previous: code.code, targetFeatureId: feature.id, targetSubfeatureId: subfeature.id, instruction: "new prompt" });
    const restored = recoverGeneration(input, outputs[intent], context);
    const panel = restored.project.sketchPanels[context.owner];
    assert.equal(restored.project.activeSketchId, context.owner);
    assert.deepEqual(restored.project.sketchPanels.source, project.sketchPanels.source);
    assert.deepEqual(restored.project.sketchFrames, project.sketchFrames);
    assert.deepEqual(context.project, project);
    if (intent === "analyze") { assert.equal(panel.analysisRevision, 4); assert.equal(panel.generated, null); assert.equal(panel.composePrompt, ""); }
    if (intent === "rules") assert.equal(panel.groups[0].title, "New rules");
    if (intent === "subfeature") assert.equal(panel.groups[0].subfeatures[0].label, "New shape");
    if (intent === "code" || intent === "compose") { assert.deepEqual(panel.generated, code); assert.equal(restored.annotationImage, ""); }
    if (intent === "brush") assert.equal(panel.brush?.name, "Dots");
    if (intent === "compose-prompt") assert.equal(panel.composePrompt, "new prompt");
    if (intent === "clarification") { assert.equal(restored.revisionInstruction, "곡선을 키워줘"); assert.deepEqual(restored.annotations, annotations); }
    if (intent === "revision") { assert.equal(restored.proposal?.features[0].label, "Bigger curve"); assert.equal(panel.features[0].label, "Curve"); }
    if (intent === "state-machine") assert.equal(panel.generated?.stateMachine?.initialState, "scene");
  }
});

test("confirmed revision restores its entire proposal even when code generation received only a subset", () => {
  const added = { ...feature, id: "other", label: "Other" };
  const proposal = { summary: "Keep both", features: [feature, added], groups: [group, { ...group, featureId: added.id }] };
  const input = requestSchema.parse({ intent: "code", features: [feature], groups: [group], revisionSummary: proposal.summary });
  const restored = recoverGeneration(input, code, { ...context, proposal });
  assert.deepEqual(restored.project.sketchPanels[context.owner].features, proposal.features);
  assert.deepEqual(restored.project.sketchPanels[context.owner].groups, proposal.groups);
});
