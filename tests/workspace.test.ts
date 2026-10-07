import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FreeformWorkspace } from "../app/components/freeform-workspace";
import { ensureFramePositions, ensureResultFramePositions, resultFrameId, resultSketchId, fitFrames, workspaceSchema } from "../app/lib/workspace";
import { projectSchema } from "../app/lib/project";

test("workspace renders a new frame before its position reaches the layout", () => {
  const layout = workspaceSchema.parse({});
  const html = renderToStaticMarkup(createElement(FreeformWorkspace, {
    layout, onChange() {}, tool: "pen", onDrop() {}, onBackground() {},
    frames: [{ id: "sketch-late", title: "Late sketch", subtitle: "", content: "Preserved sketch" }],
  }));
  assert.match(html, /Preserved sketch/);
  assert.match(html, /left:832px/);
  assert.doesNotMatch(html, /scale\(/, "SVG and text must render directly at the camera size instead of enlarging a cached layer");
  assert.equal(layout.frames["sketch-late"], undefined);
});

test("restoration recovers missing frame positions without dropping artwork or moving existing frames", () => {
  const artwork = { strokes: [{ points: [{ x: 10, y: 20 }, { x: 30, y: 40 }], color: "#397461", width: 3, opacity: 1, tool: "pen" }], photo: null, name: "Preserved", revision: 4 };
  const project = projectSchema.parse({ version: 1, name: "Recover", artwork, features: [], groups: [], analysisRevision: 4, generated: null, brush: null, savedBrushes: [],
    sketchFrames: [{ id: "sketch-kept", artwork }, { id: "sketch-missing", artwork }], featureSourceId: "sketch-missing",
    workspace: { camera: { x: 50, y: -30, zoom: .6 }, frames: { result: { x: -500, y: 100 }, "sketch-kept": { x: 3200, y: 200 } } },
  });
  assert.deepEqual(project.workspace.frames.result, { x: -500, y: 100 });
  assert.deepEqual(project.workspace.frames["sketch-kept"], { x: 3200, y: 200 });
  assert.deepEqual(project.workspace.frames["sketch-missing"], { x: 4240, y: 0 });
  assert.deepEqual(project.sketchFrames[1].artwork, artwork);
  assert.deepEqual(project.workspace.camera, { x: 50, y: -30, zoom: .6 });
  assert.deepEqual(projectSchema.parse(JSON.parse(JSON.stringify(project))), project);
});

test("recovered frame positions stay distinct and fit yields a finite camera", () => {
  const initial = workspaceSchema.parse({}).frames;
  const frames = ensureFramePositions(initial, ["sketch-a", "sketch-b"]);
  assert.deepEqual(frames["sketch-a"], { x: 2080, y: 0 });
  assert.deepEqual(frames["sketch-b"], { x: 3120, y: 0 });
  assert.equal(ensureFramePositions(frames, ["sketch-a", "sketch-b"]), frames);
  const camera = fitFrames([frames["sketch-a"], frames["sketch-b"]], 1200, 800);
  assert.ok(Object.values(camera).every(Number.isFinite));
  assert.ok(Object.values(fitFrames([], 1200, 800)).every(Number.isFinite));
});

test("each result frame has a stable sketch owner and independent position", () => {
  const initial = workspaceSchema.parse({}).frames;
  initial["sketch-a"] = { x: 2080, y: 100 };
  initial["sketch-b"] = { x: 3120, y: -80 };
  const frames = ensureResultFramePositions(initial, ["source", "sketch-a", "sketch-b"]);
  assert.equal(resultFrameId("source"), "result");
  assert.equal(resultFrameId("sketch-a"), "result-sketch-a");
  assert.equal(resultSketchId("result-sketch-a"), "sketch-a");
  assert.equal(resultSketchId("result"), "source");
  assert.equal(resultSketchId("sketch-a"), null);
  assert.deepEqual(frames["result-sketch-a"], { x: 2080, y: 840 });
  assert.deepEqual(frames["result-sketch-b"], { x: 3120, y: 660 });
  assert.deepEqual(frames.result, initial.result);
  frames["result-sketch-a"] = { x: -900, y: 500 };
  assert.equal(ensureResultFramePositions(frames, ["source", "sketch-a", "sketch-b"]), frames);
  assert.deepEqual(frames["result-sketch-a"], { x: -900, y: 500 });
});

test("saved projects restore all generated result positions, including moved result frames", () => {
  const artwork = { strokes: [], photo: null, name: "Original", revision: 0 };
  const generated = { title: "Result", explanation: "", code: "p.setup=()=>p.createCanvas(900,600);", bindings: [] };
  const project = projectSchema.parse({ version: 1, name: "Results", artwork, features: [], groups: [], analysisRevision: -1, generated, brush: null, savedBrushes: [],
    sketchFrames: [{ id: "sketch-a", artwork }], sketchPanels: { "sketch-a": { generated } },
    workspace: { frames: { ...workspaceSchema.parse({}).frames, "sketch-a": { x: 2080, y: 0 } } },
  });
  assert.deepEqual(project.workspace.frames["result-sketch-a"], { x: 2080, y: 740 });
  project.workspace.frames["result-sketch-a"] = { x: -120, y: 1350 };
  const restored = projectSchema.parse(JSON.parse(JSON.stringify(project)));
  assert.deepEqual(restored.workspace.frames["result-sketch-a"], { x: -120, y: 1350 });
  assert.deepEqual(restored.sketchPanels.source.generated, generated);
  assert.deepEqual(restored.sketchPanels["sketch-a"].generated, generated);
});


test("deleted source remains deleted after serialization while a surviving sketch keeps its result", () => {
  const artwork = { strokes: [], photo: null, name: "Remaining", revision: 0 };
  const generated = { title: "Kept result", explanation: "", code: "p.setup=()=>p.createCanvas(900,600);", bindings: [] };
  const project = projectSchema.parse({ version: 1, name: "Delete source", artwork, sourceVisible: false,
    features: [], groups: [], analysisRevision: -1, generated: null, brush: null, savedBrushes: [],
    activeSketchId: "source", sketchFrames: [{ id: "sketch-kept", artwork }],
    sketchPanels: { source: { generated }, "sketch-kept": { generated }, "sketch-deleted": { generated } },
    workspace: { frames: { "sketch-kept": { x: 2080, y: 0 }, "result-sketch-kept": { x: 2080, y: 750 }, "sketch-deleted": { x: 3120, y: 0 }, "result-sketch-deleted": { x: 3120, y: 750 } } },
  });
  const restored = projectSchema.parse(JSON.parse(JSON.stringify(project)));
  assert.equal(restored.sourceVisible, false);
  assert.equal(restored.activeSketchId, "sketch-kept");
  assert.equal(restored.sketchPanels.source.generated, null);
  assert.equal(restored.sketchPanels["sketch-deleted"], undefined);
  assert.equal(restored.workspace.frames["sketch-deleted"], undefined);
  assert.equal(restored.workspace.frames["result-sketch-deleted"], undefined);
  assert.deepEqual(restored.sketchPanels["sketch-kept"].generated, generated);
  assert.deepEqual(restored.workspace.frames["result-sketch-kept"], { x: 2080, y: 750 });
});

test("empty workspace persists after the final sketch is deleted and older projects keep their source", () => {
  const base = { version: 1, name: "Empty", artwork: { strokes: [], photo: null, name: "Empty", revision: 0 }, features: [], groups: [], analysisRevision: -1, generated: null, brush: null, savedBrushes: [] };
  assert.equal(projectSchema.parse(base).sourceVisible, true);
  const empty = projectSchema.parse({ ...base, sourceVisible: false });
  const restored = projectSchema.parse(JSON.parse(JSON.stringify(empty)));
  assert.equal(restored.sourceVisible, false);
  assert.deepEqual(restored.sketchFrames, []);
  assert.equal(restored.sketchPanels.source.generated, null);
});
