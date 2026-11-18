import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { groupBox, groupRow, liveGroups, workspaceSchema, FRAME_WIDTH, FRAME_HEIGHT } from "../app/lib/workspace";
import { projectSchema } from "../app/lib/project";
import { FreeformWorkspace } from "../app/components/freeform-workspace";

const noop = () => {};

test("frame groups: a row of frames placed clear of the board, a box under a title, and only frames still there", () => {
  const layout = workspaceSchema.parse({ frames: { "sketch-a": { x: 1040, y: 0 } } });
  const first = groupRow(layout, "source", 3);
  assert.deepEqual(first.map(spot => spot.x), [1040, 2080, 3120]); assert.ok(first[0].y > FRAME_HEIGHT, "below the frame already right of it");
  const withGroup = { ...layout, frames: { ...layout.frames, "sketch-fork": first[0], "proxy-1": first[1], "proxy-2": first[2] }, groups: [{ id: "g", title: "R", frames: ["sketch-fork", "proxy-1", "proxy-2"] }] };
  const second = groupRow(withGroup, "source", 3);
  const box = groupBox(withGroup.frames, withGroup.groups[0].frames)!;
  assert.ok(second[0].y > box.y + box.h - 200, "the next group goes below the first one"); assert.ok(box.h >= FRAME_HEIGHT, "room for the frames");
  assert.equal(box.w, 3 * FRAME_WIDTH + 2 * 140 + 72);
  assert.deepEqual(liveGroups(withGroup.groups, new Set(["sketch-fork"])), [{ id: "g", title: "R", frames: ["sketch-fork"] }]);
  assert.deepEqual(liveGroups(withGroup.groups, new Set()), []);
  // Saved: a group keeps the saved frames (a fork); spots of fork slots saved before are dropped.
  const saved = projectSchema.parse({ version: 2, name: "p", artwork: { strokes: [], photo: null, name: "a", revision: 0 }, sketchFrames: [{ id: "sketch-f", artwork: { strokes: [], photo: null, name: "fork", revision: 0 } }],
    workspace: { frames: { "slot-1": { x: 0, y: 0 }, "sketch-f": { x: 9, y: 9 } }, groups: [{ id: "g", title: "R", frames: ["sketch-f", "explore-1"] }, { id: "h", title: "gone", frames: ["slot-1"] }] } });
  assert.deepEqual(saved.workspace.groups, [{ id: "g", title: "R", frames: ["sketch-f"] }]); assert.equal(saved.workspace.frames["slot-1"], undefined);
});

test("a group is drawn behind its frames with a title to drag it by and a delete button, and may carry an action", () => {
  const layout = workspaceSchema.parse({ frames: { "sketch-fork": { x: 1040, y: 800 }, "explore-1": { x: 2080, y: 800 } }, groups: [{ id: "g", title: "Fork · 합치기", frames: ["sketch-fork", "explore-1"] }] });
  const html = renderToStaticMarkup(createElement(FreeformWorkspace, { layout, onChange: noop, tool: "select", onDrop: noop, onBackground: noop, onDeleteGroup: noop, groups: layout.groups,
    frames: [{ id: "source", title: "S", subtitle: "", content: "" }, { id: "sketch-fork" as never, title: "fork", subtitle: "", content: "" }, { id: "explore-1" as never, title: "exec", subtitle: "", content: "" }] }));
  assert.match(html, /class="frame-group" style="left:1004px;top:690px/);
  assert.match(html, /data-group-handle="g"[^>]*><span>▦ Fork · 합치기<\/span><small>2 frames<\/small>/);
  assert.match(html, /aria-label="Delete group Fork · 합치기"/);
  assert.ok(html.indexOf("frame-group") < html.indexOf("world-frame "), "behind the frames");
  assert.match(html, /class="world-frame [^"]*frame-sketch/);
  const action = renderToStaticMarkup(createElement(FreeformWorkspace, { layout, onChange: noop, tool: "select", onDrop: noop, onBackground: noop, groups: layout.groups,
    groupAction: () => ({ label: "◎ fork inspection 도구", title: "t", disabled: true, onClick: noop }),
    frames: [{ id: "sketch-fork" as never, title: "fork", subtitle: "", content: "" }, { id: "explore-1" as never, title: "exec", subtitle: "", content: "" }] }));
  assert.match(action, /<button class="frame-group-action" title="t" disabled="">◎ fork inspection 도구<\/button>/, "a group's title can carry a button (disabled until the fork exists)");
});
