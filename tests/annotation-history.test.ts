import test from "node:test";
import assert from "node:assert/strict";
import { annotationHistoryReducer as edit, emptyAnnotationHistory, annotationsHitByEraser } from "../app/lib/annotation-history";
import type { ResultAnnotation } from "../app/lib/schema";
import { projectSchema } from "../app/lib/project";
import { nextSketchPosition, workspaceSchema } from "../app/lib/workspace";

const note = (id: string, y = .5): ResultAnnotation => ({ id, points: [{ x: .1, y }, { x: .9, y }] });
test("one eraser gesture removes multiple freehand strokes and undo restores their geometry together", () => {
  let state = edit(edit(emptyAnnotationHistory(), { type: "add", annotation: note("a") }), { type: "add", annotation: note("b", .6) });
  const ids = annotationsHitByEraser(state.present, { x: .5, y: .3 }, { x: .5, y: .8 }, 1);
  assert.deepEqual(ids, ["a", "b"]);
  state = edit(state, { type: "remove", ids }); assert.equal(state.present.length, 0);
  state = edit(state, { type: "undo" }); assert.deepEqual(state.present, [note("a"), note("b", .6)]);
  state = edit(state, { type: "redo" }); assert.equal(state.present.length, 0);
});
test("eraser uses segment intersections even with sparse pointer samples and keeps a screen-sized hit radius", () => {
  assert.deepEqual(annotationsHitByEraser([note("a")], { x: .5, y: .1 }, { x: .5, y: .9 }, .5), ["a"]);
  assert.deepEqual(annotationsHitByEraser([note("a")], { x: .5, y: .52 }, { x: .5, y: .52 }, 1), []);
  assert.deepEqual(annotationsHitByEraser([note("a")], { x: .5, y: .52 }, { x: .5, y: .52 }, .5), ["a"]);
  assert.deepEqual(annotationsHitByEraser([note("a")], { x: .5, y: .8 }, { x: .6, y: .8 }, 1), []);
});
test("drawing and clear remain reversible; new strokes discard redo", () => {
  let state = edit(emptyAnnotationHistory(), { type: "add", annotation: note("a") });
  state = edit(state, { type: "add", annotation: note("b") });
  state = edit(state, { type: "undo" }); assert.deepEqual(state.present, [note("a")]);
  state = edit(state, { type: "redo" }); assert.equal(state.present.length, 2);
  state = edit(state, { type: "clear" }); assert.equal(state.present.length, 0);
  state = edit(state, { type: "undo" }); assert.equal(state.present.length, 2);
  state = edit(state, { type: "add", annotation: note("c") }); assert.equal(state.future.length, 0);
  assert.equal(edit(state, { type: "remove", ids: ["missing"] }), state);
  assert.deepEqual(edit(state, { type: "reset" }), emptyAnnotationHistory());
});
test("new sketch frames preserve independent artwork, analyzed source and moved positions across export", () => {
  const workspace = workspaceSchema.parse({});
  const id = "sketch-test"; workspace.frames[id] = nextSketchPosition(workspace.frames);
  assert.ok(workspace.frames[id].x >= workspace.frames.source.x + 1040);
  workspace.frames[id] = { x: -340, y: 710 };
  const artwork = { strokes: [], photo: null, name: "Original", revision: 0 };
  const project = projectSchema.parse({ version: 2, name: "Frames", artwork, sketchFrames: [{ id, artwork: { ...artwork, name: "Sketch 2", revision: 3, strokes: [{ points: [{ x: 10, y: 20 }], color: "#397461", width: 3, opacity: 1, tool: "pen" }] } }], activeSketchId: id, workspace });
  const restored = projectSchema.parse(JSON.parse(JSON.stringify(project)));
  assert.equal(restored.artwork.strokes.length, 0); assert.equal(restored.sketchFrames[0].artwork.strokes.length, 1);
  assert.equal(restored.activeSketchId, id); assert.deepEqual(restored.workspace.frames[id], { x: -340, y: 710 });
  assert.equal(projectSchema.safeParse({ ...project, sketchFrames: [...project.sketchFrames, ...project.sketchFrames] }).success, false);
  assert.equal(projectSchema.parse({ ...project, activeSketchId: "sketch-missing" }).activeSketchId, "source");
});
