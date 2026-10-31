import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { run, sampleScene, sceneProgram } from "./fixtures/scene";
import { connectScene } from "../app/server/scene-code.server";
import { previewFork } from "../app/lib/preview-fork";
import { groupBox, groupRow, liveGroups, workspaceSchema, FRAME_WIDTH, EXPLORE_BAR_HEIGHT, FRAME_HEIGHT } from "../app/lib/workspace";
import { projectSchema } from "../app/lib/project";
import { readSceneValues } from "../app/lib/scene/machines";
import { sceneBindings } from "../app/lib/scene/values";
import { FreeformWorkspace } from "../app/components/freeform-workspace";
import { emptySlotEdit, ForkSlot } from "../app/components/fork-slot";

const noop = () => {};

test("a fork is made without AI from a recommendation's preview: its code runs, and the scene has the change and its new values as properties", () => {
  const scene = sampleScene(), generated = connectScene({ title: "Tree", explanation: "", code: sceneProgram }, scene);
  const preview = { edits: [{ nodeId: "tree", find: "p.stroke(m.v(\"tree/ink\"));", replace: "p.stroke(m.v(\"tree/ink\")); p.line(0, 0, m.v(\"tree/lean\"), 9);" }],
    values: [{ nodeId: "tree", id: "lean", label: "기울기", value: { type: "number" as const, value: 12, min: 0, max: 40, step: 1, unit: "px" } }] };
  const added = previewFork(scene, generated, { kind: "add-transformation", nodeId: "tree", targetId: "", title: "가지 기울이기", detail: "가지를 한쪽으로 기울입니다" }, preview);
  assert.ok(!("error" in added));
  const tree = added.scene.nodes.find(node => node.id === "tree")!, made = tree.transformations.at(-1)!;
  assert.equal(made.label, "가지 기울이기"); assert.equal(made.description, "가지를 한쪽으로 기울입니다");
  assert.deepEqual(made.properties.map(property => [property.id, property.value]), [["lean", preview.values[0].value]], "the new value is a property (it can be inspected)");
  assert.ok(sceneBindings(added.scene).some(binding => binding.key === "tree/lean"));
  assert.equal(readSceneValues(added.generated.code)!.params["tree/lean"], 12);
  const sketch = run(added.generated.code); sketch.draw();
  assert.ok(sketch.lines.some(line => line[2] === 12 && line[3] === 9), "the fork's code draws the change");
  // Changing a transformation: it gets the recommendation's description and the values.
  const changed = previewFork(scene, generated, { kind: "transformation", nodeId: "tree", targetId: "branching-growth", title: "기울기", detail: "기울여 자랍니다" }, preview);
  assert.ok(!("error" in changed));
  const growth = changed.scene.nodes.find(node => node.id === "tree")!.transformations.find(item => item.id === "branching-growth")!;
  assert.match(growth.description, /기울기: 기울여 자랍니다/); assert.ok(growth.properties.some(property => property.id === "lean"));
  assert.equal(changed.scene.nodes.find(node => node.id === "tree")!.transformations.length, scene.nodes.find(node => node.id === "tree")!.transformations.length, "no new transformation");
  assert.deepEqual(previewFork(scene, generated, { kind: "transformation", nodeId: "tree", targetId: "branching-growth", title: "t", detail: "d" }, { ...preview, edits: [{ ...preview.edits[0], find: "not in the code" }] }), { error: "바꿀 코드 부분을 찾지 못했습니다" });
  assert.ok("error" in previewFork(scene, generated, { kind: "transformation", nodeId: "tree", targetId: "branching-growth", title: "t", detail: "d" }, { edits: [], values: [] }));
});

test("frame groups: a row of frames placed clear of the board, a box under a title, and only frames still there", () => {
  const layout = workspaceSchema.parse({ frames: { "sketch-a": { x: 1040, y: 0 } } });
  const first = groupRow(layout, "source", 3);
  assert.deepEqual(first.map(spot => spot.x), [1040, 2080, 3120]); assert.ok(first[0].y > FRAME_HEIGHT, "below the frame already right of it");
  const withGroup = { ...layout, frames: { ...layout.frames, "slot-1": first[0], "explore-1": first[1], "explore-2": first[2] }, groups: [{ id: "g", title: "R", frames: ["slot-1", "explore-1", "explore-2"] }] };
  const second = groupRow(withGroup, "source", 3);
  const box = groupBox(withGroup.frames, withGroup.groups[0].frames)!;
  assert.ok(second[0].y > box.y + box.h - 200, "the next group goes below the first one"); assert.ok(box.h >= FRAME_HEIGHT + EXPLORE_BAR_HEIGHT, "room for exploration controls");
  assert.equal(box.w, 3 * FRAME_WIDTH + 2 * 140 + 72);
  assert.deepEqual(liveGroups(withGroup.groups, new Set(["slot-1"])), [{ id: "g", title: "R", frames: ["slot-1"] }]);
  assert.deepEqual(liveGroups(withGroup.groups, new Set()), []);
  // Saved: a group keeps the saved frames (a fork); exploration frames and slots are not saved.
  const saved = projectSchema.parse({ version: 2, name: "p", artwork: { strokes: [], photo: null, name: "a", revision: 0 }, sketchFrames: [{ id: "sketch-f", artwork: { strokes: [], photo: null, name: "fork", revision: 0 } }],
    workspace: { frames: { "slot-1": { x: 0, y: 0 }, "sketch-f": { x: 9, y: 9 } }, groups: [{ id: "g", title: "R", frames: ["sketch-f", "explore-1"] }, { id: "h", title: "gone", frames: ["slot-1"] }] } });
  assert.deepEqual(saved.workspace.groups, [{ id: "g", title: "R", frames: ["sketch-f"] }]); assert.equal(saved.workspace.frames["slot-1"], undefined);
});

test("a group is drawn behind its frames with a title to drag it by and a delete button; a fork slot accepts only when ready", () => {
  const layout = workspaceSchema.parse({ frames: { "slot-1": { x: 1040, y: 800 }, "explore-1": { x: 2080, y: 800 } }, groups: [{ id: "g", title: "Recommendation · 합치기", frames: ["slot-1", "explore-1"] }] });
  const html = renderToStaticMarkup(createElement(FreeformWorkspace, { layout, onChange: noop, tool: "select", onDrop: noop, onBackground: noop, onDeleteGroup: noop, groups: layout.groups,
    frames: [{ id: "source", title: "S", subtitle: "", content: "" }, { id: "slot-1" as never, title: "fork", subtitle: "", content: "" }, { id: "explore-1" as never, title: "exec", subtitle: "", content: "" }] }));
  assert.match(html, /class="frame-group" style="left:1004px;top:690px/);
  assert.match(html, /data-group-handle="g"[^>]*><span>▦ Recommendation · 합치기<\/span><small>2 frames<\/small>/);
  assert.match(html, /aria-label="Delete group Recommendation · 합치기"/);
  assert.ok(html.indexOf("frame-group") < html.indexOf("world-frame "), "behind the frames");
  assert.match(html, /class="world-frame [^"]*frame-slot/);
  const action = renderToStaticMarkup(createElement(FreeformWorkspace, { layout, onChange: noop, tool: "select", onDrop: noop, onBackground: noop, groups: layout.groups,
    groupAction: () => ({ label: "◎ fork inspection 도구", title: "t", disabled: true, onClick: noop }),
    frames: [{ id: "slot-1" as never, title: "fork", subtitle: "", content: "" }, { id: "explore-1" as never, title: "exec", subtitle: "", content: "" }] }));
  assert.match(action, /<button class="frame-group-action" title="t" disabled="">◎ fork inspection 도구<\/button>/, "a group's title can carry a button (disabled until the fork exists)");
  const slot = (status: "waiting" | "ready" | "paused", paused = false) => renderToStaticMarkup(createElement(ForkSlot, { title: "합치기", detail: "d", status, message: "m", preview: null, onAccept: noop, onActivate: noop,
    paused, onContinue: noop, edit: emptySlotEdit(), onEdit: noop, onRevise: noop, onCancelRevise: noop }));
  const accept = (html: string) => html.match(/<button class="primary"[^>]*><svg[^]*?<\/svg>Accept/)![0];
  assert.match(accept(slot("waiting")), /disabled=""/); assert.doesNotMatch(accept(slot("ready")), /disabled=""/);
  assert.match(slot("ready"), /Accept · 이 버전으로 fork 만들기/);
  // Its frames only placed: the slot makes them when asked; the menu sits under the preview, with the ways to revise it.
  assert.doesNotMatch(slot("ready"), /마저 생성/); assert.match(slot("paused", true), /▶ 마저 생성/);
  assert.ok(slot("ready").indexOf("fork-slot-view") < slot("ready").indexOf("fork-slot-bar"));
  assert.match(slot("ready"), /Annotation/); assert.match(slot("ready"), /class="active" aria-pressed="true"[^>]*>[^]*?크롭 · 이동 · 크기 · 회전/, "cropping is the tool at hand from the start"); assert.match(slot("ready"), /Revise recommendation/);
});
