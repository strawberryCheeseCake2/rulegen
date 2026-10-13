import test from "node:test";
import assert from "node:assert/strict";
import { createSketchPanel, savedSketchPanels, updateSketchPanel, type SketchPanel } from "../app/lib/sketch-panels";
import { projectSchema } from "../app/lib/project";
import { sampleScene } from "./fixtures/scene";

const artwork = { strokes: [], photo: null, name: "Original", revision: 3 };
const project = { version: 2, name: "Frames", artwork, sketchFrames: [{ id: "sketch-a", artwork }] };

test("editing each sketch's panel and undo data leaves other panels intact", () => {
  let panels: Record<string, SketchPanel> = { source: createSketchPanel(), "sketch-a": createSketchPanel() };
  const source = panels.source;
  panels = updateSketchPanel(panels, "sketch-a", "scene", sampleScene());
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

test("per-sketch panel export preserves selection, directions and unsaved code while excluding running state", () => {
  let panels: Record<string, SketchPanel> = { source: createSketchPanel(), "sketch-a": createSketchPanel() };
  panels = updateSketchPanel(panels, "sketch-a", "scene", sampleScene());
  panels = updateSketchPanel(panels, "sketch-a", "selectedNodeIds", ["orb"]);
  panels = updateSketchPanel(panels, "sketch-a", "editingStates", { orb: "moving" });
  panels = updateSketchPanel(panels, "sketch-a", "runtimeStates", { orb: "idle" });
  panels = updateSketchPanel(panels, "sketch-a", "codeDraft", "unfinished algorithm edit");
  panels = updateSketchPanel(panels, "sketch-a", "instruction", "반복을 적게");
  panels = updateSketchPanel(panels, "sketch-a", "loading", "Generating…");
  const saved = projectSchema.parse({ ...project, activeSketchId: "source", sketchPanels: savedSketchPanels(panels) });
  const restored = projectSchema.parse(JSON.parse(JSON.stringify(saved)));
  assert.equal(restored.activeSketchId, "source");
  assert.deepEqual(restored.sketchPanels["sketch-a"].selectedNodeIds, ["orb"]);
  assert.deepEqual(restored.sketchPanels["sketch-a"].editingStates, { orb: "moving" });
  assert.deepEqual(restored.sketchPanels["sketch-a"].scene, sampleScene());
  assert.equal("runtimeStates" in restored.sketchPanels["sketch-a"], false);
  assert.equal(restored.sketchPanels["sketch-a"].codeDraft, "unfinished algorithm edit");
  assert.equal(restored.sketchPanels["sketch-a"].instruction, "반복을 적게");
  assert.equal("loading" in restored.sketchPanels["sketch-a"], false);
  assert.equal(createSketchPanel(restored.sketchPanels["sketch-a"]).loading, "");
});
