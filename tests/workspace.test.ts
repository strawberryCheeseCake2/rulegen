import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FreeformWorkspace } from "../app/components/freeform-workspace";
import { besideFramePosition, ensureFramePositions, fitFrames, workspaceSchema, removeWorkspaceFrame, showWorkspaceFrame } from "../app/lib/workspace";
import { projectSchema } from "../app/lib/project";

test("deleting a sketch removes only its position; the base frame is hidden and can be shown again", () => {
  const layout = workspaceSchema.parse({ frames: { "sketch-a": { x: 3000, y: 0 }, "sketch-b": { x: 4000, y: 200 } } });
  const removed = removeWorkspaceFrame(layout, "sketch-a");
  assert.equal(removed.frames["sketch-a"], undefined);
  assert.deepEqual(removed.frames["sketch-b"], layout.frames["sketch-b"]);
  const hidden = removeWorkspaceFrame(workspaceSchema.parse({}), "source");
  assert.deepEqual(workspaceSchema.parse(JSON.parse(JSON.stringify(hidden))).hiddenFrames, ["source"]);
  assert.deepEqual(showWorkspaceFrame(hidden, "source").hiddenFrames, []);
});

test("frames derived from a sketch are placed beside it without overlapping existing frames", () => {
  const frames = workspaceSchema.parse({ frames: { "sketch-a": { x: 1040, y: 0 } } }).frames;
  assert.deepEqual(besideFramePosition(frames, "source"), { x: 1040, y: 740 });
  assert.deepEqual(besideFramePosition(frames, "sketch-a"), { x: 2080, y: 0 });
});

test("each frame exposes an accessible deletion button when deletion is available", () => {
  const html = renderToStaticMarkup(createElement(FreeformWorkspace, { layout: workspaceSchema.parse({}), onChange() {}, onDeleteFrame() {}, deleteDisabled: true, tool: "pen", onDrop() {}, onBackground() {}, frames: [{ id: "source", title: "Sketch", subtitle: "", content: "" }] }));
  assert.match(html, /aria-label="Delete Sketch frame"/);
  assert.match(html, /title="Delete frame" disabled/);
});

test("workspace renders a new frame before its position reaches the layout", () => {
  const layout = workspaceSchema.parse({});
  const html = renderToStaticMarkup(createElement(FreeformWorkspace, {
    layout, onChange() {}, tool: "pen", onDrop() {}, onBackground() {},
    frames: [{ id: "sketch-late", title: "Late sketch", subtitle: "", content: "Preserved sketch" }],
  }));
  assert.match(html, /Preserved sketch/);
  assert.match(html, /left:1040px/);
  assert.equal(layout.frames["sketch-late"], undefined);
});

test("restoration recovers missing frame positions without dropping artwork or moving existing frames", () => {
  const artwork = { strokes: [{ points: [{ x: 10, y: 20 }, { x: 30, y: 40 }], color: "#397461", width: 3, opacity: 1, tool: "pen" }], photo: null, name: "Preserved", revision: 4 };
  const project = projectSchema.parse({ version: 2, name: "Recover", artwork,
    sketchFrames: [{ id: "sketch-kept", artwork }, { id: "sketch-missing", artwork }], activeSketchId: "sketch-missing",
    workspace: { camera: { x: 50, y: -30, zoom: .6 }, frames: { "sketch-kept": { x: 3200, y: 200 } } },
  });
  assert.deepEqual(project.workspace.frames["sketch-kept"], { x: 3200, y: 200 });
  assert.deepEqual(project.workspace.frames["sketch-missing"], { x: 4240, y: 0 });
  assert.deepEqual(project.sketchFrames[1].artwork, artwork);
  assert.deepEqual(project.workspace.camera, { x: 50, y: -30, zoom: .6 });
  assert.deepEqual(projectSchema.parse(JSON.parse(JSON.stringify(project))), project);
});

test("recovered frame positions stay distinct and fit yields a finite camera", () => {
  const initial = workspaceSchema.parse({}).frames;
  const frames = ensureFramePositions(initial, ["sketch-a", "sketch-b"]);
  assert.deepEqual(frames["sketch-a"], { x: 1040, y: 0 });
  assert.deepEqual(frames["sketch-b"], { x: 2080, y: 0 });
  assert.equal(ensureFramePositions(frames, ["sketch-a", "sketch-b"]), frames);
  const camera = fitFrames([frames["sketch-a"], frames["sketch-b"]], 1200, 800);
  assert.ok(Object.values(camera).every(Number.isFinite));
  assert.ok(Object.values(fitFrames([], 1200, 800)).every(Number.isFinite));
});

test("saved projects keep each sketch's generated result and frame positions", () => {
  const artwork = { strokes: [], photo: null, name: "Original", revision: 0 };
  const generated = { title: "Result", explanation: "", code: "p.setup=()=>p.createCanvas(900,600);" };
  const project = projectSchema.parse({ version: 2, name: "Results", artwork, sketchFrames: [{ id: "sketch-a", artwork }], sketchPanels: { "sketch-a": { generated, sourceFrameId: "source" } },
    workspace: { frames: { ...workspaceSchema.parse({}).frames, "sketch-a": { x: 2080, y: 0 } } } });
  const restored = projectSchema.parse(JSON.parse(JSON.stringify(project)));
  assert.deepEqual(restored.workspace.frames["sketch-a"], { x: 2080, y: 0 });
  assert.deepEqual(restored.sketchPanels["sketch-a"].generated, { ...generated, sceneBindings: [], machineSignature: "" });
  assert.equal(restored.sketchPanels["sketch-a"].sourceFrameId, "source");
});
