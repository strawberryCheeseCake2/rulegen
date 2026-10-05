import test from "node:test";
import assert from "node:assert/strict";
import { createSketchPanel, savedSketchPanels, updateSketchPanel, type SketchPanel } from "../app/lib/sketch-panels";
import { projectSchema } from "../app/lib/project";

const artwork = { strokes: [], photo: null, name: "Original", revision: 3 };
const features = [{ id: "curve", label: "Curve", description: "곡선", region: { x: .1, y: .1, w: .3, h: .3 } }];
const oldProject = { version: 1, name: "Legacy", artwork, sketchFrames: [{ id: "sketch-a", artwork }], featureSourceId: "sketch-a", features, groups: [], analysisRevision: 3, generated: null, brush: null, savedBrushes: [] };

test("legacy shared panel migrates to its analyzed sketch without copying analysis into other sketches", () => {
  const migrated = projectSchema.parse(oldProject);
  assert.equal(migrated.activeSketchId, "sketch-a");
  assert.deepEqual(migrated.sketchPanels["sketch-a"].features, features);
  assert.deepEqual(migrated.sketchPanels.source.features, []);
  assert.equal(migrated.sketchPanels["sketch-a"].analysisRevision, 3);
});

test("editing each sketch's panel and undo data leaves other panels intact", () => {
  let panels: Record<string, SketchPanel> = { source: createSketchPanel(), "sketch-a": createSketchPanel() };
  const source = panels.source;
  panels = updateSketchPanel(panels, "sketch-a", "features", features);
  panels = updateSketchPanel(panels, "sketch-a", "stage", "rules");
  panels = updateSketchPanel(panels, "sketch-a", "instruction", previous => `${previous}파란색`);
  panels = updateSketchPanel(panels, "sketch-a", "annotationHistory", { present: [{ id: "stroke", points: [{ x: .1, y: .1 }, { x: .5, y: .5 }] }], past: [[]], future: [] });
  assert.equal(panels.source, source);
  assert.equal(panels.source.instruction, "");
  assert.equal(panels["sketch-a"].annotationHistory.past.length, 1);
  assert.equal(panels.source.annotationHistory.past.length, 0);
  const sketch = panels["sketch-a"];
  panels = updateSketchPanel(panels, "source", "codeDraft", "independent unsaved code");
  assert.equal(panels["sketch-a"], sketch);
});

test("per-sketch panel export preserves tabs, selection, directions and unsaved code while excluding running state", () => {
  let panels: Record<string, SketchPanel> = { source: createSketchPanel(), "sketch-a": createSketchPanel() };
  panels = updateSketchPanel(panels, "sketch-a", "features", features);
  panels = updateSketchPanel(panels, "sketch-a", "selected", "curve");
  panels = updateSketchPanel(panels, "sketch-a", "stage", "code");
  panels = updateSketchPanel(panels, "sketch-a", "codeDraft", "unfinished algorithm edit");
  panels = updateSketchPanel(panels, "sketch-a", "instruction", "반복을 적게");
  panels = updateSketchPanel(panels, "sketch-a", "brushDescription", "작은 파란 잎");
  panels = updateSketchPanel(panels, "sketch-a", "loading", "Generating…");
  const saved = projectSchema.parse({ ...oldProject, activeSketchId: "source", sketchPanels: savedSketchPanels(panels) });
  const restored = projectSchema.parse(JSON.parse(JSON.stringify(saved)));
  assert.equal(restored.activeSketchId, "source");
  assert.equal(restored.sketchPanels["sketch-a"].stage, "code");
  assert.equal(restored.sketchPanels["sketch-a"].selected, "curve");
  assert.equal(restored.sketchPanels["sketch-a"].codeDraft, "unfinished algorithm edit");
  assert.equal(restored.sketchPanels["sketch-a"].brushDescription, "작은 파란 잎");
  assert.equal("loading" in restored.sketchPanels["sketch-a"], false);
  assert.equal(createSketchPanel(restored.sketchPanels["sketch-a"]).loading, "");
});
