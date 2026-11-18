import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { sampleScene } from "./fixtures/scene";
import { proxyGroups, proxySections, setHandle } from "../app/lib/scene/handles";
import { findNode } from "../app/lib/scene/graph";
import { prepareHandle } from "../app/server/code.server";
import { proxyDocument } from "../app/lib/proxy-runtime";
import { ProxyFrame, ProxyFrameBar, proxyLayoutFor } from "../app/components/proxy-frame";
import { planProxyFrames, proxiesOf, proxyFrameSchema } from "../app/lib/proxy-frames";
import type { ParamHandle } from "../app/lib/scene/schema";

const noop = () => {};
const code = "rulegenHandle(function (h) { return { draw() { p.line(0, 0, h.w, h.h); } }; });";
const widget = (paths: string[][] = [[]]): ParamHandle => ({ code, prepared: prepareHandle(code), paths, hint: "drag" });
const inside = (a: { x: number; y: number; w: number; h: number }, b: typeof a) => a.x >= b.x - 1e-6 && a.y >= b.y - 1e-6 && a.x + a.w <= b.x + b.w + 1e-6 && a.y + a.h <= b.y + b.h + 1e-6;
const overlap = (a: { x: number; y: number; w: number; h: number }, b: typeof a) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test("a proxy frame is laid out by constraint: each section holds only its own widgets, nothing overlaps", () => {
  for (const counts of [[1], [2, 1], [3, 1, 2], [1, 1, 1, 1, 1], [4, 2, 1, 3, 1, 1, 2, 1, 1]]) {
    const sections = proxySections(counts), frame = { x: 0, y: 0, w: 900, h: 600 };
    assert.equal(sections.length, counts.length);
    sections.forEach((section, i) => {
      assert.ok(inside(section.box, frame), `section ${i} of ${counts} fits the frame`);
      assert.equal(section.cells.length, counts[i]);
      section.cells.forEach(cell => { assert.ok(inside(cell, section.box), "a widget stays in its constraint's section"); assert.ok(cell.w > 40 && cell.h > 40); });
    });
    const all = sections.flatMap(section => [section.box]), cells = sections.flatMap(section => section.cells);
    all.forEach((a, i) => all.slice(i + 1).forEach(b => assert.ok(!overlap(a, b), "sections do not overlap")));
    cells.forEach((a, i) => cells.slice(i + 1).forEach(b => assert.ok(!overlap(a, b), "widgets do not overlap")));
  }
});

test("each constraint has its own proxy frame (the whole frame), numbered and colored the same everywhere; a node's frames can be hidden and come back", () => {
  let scene = sampleScene();
  scene = setHandle(scene, "tree", "structure", widget([[]]));
  scene = setHandle(scene, "tree", "ink", widget());
  const tree = findNode(scene, "tree")!;
  assert.deepEqual(proxyGroups(tree.constraints).map(group => group.constraint.id), ["branching-growth", "ink-wash"]);
  const whole = proxyLayoutFor(tree.constraints), ink = proxyLayoutFor(tree.constraints, "ink-wash");
  assert.deepEqual(whole.sections.map(section => [section.id, section.number]), [["branching-growth", 1], ["ink-wash", 2]]);
  assert.deepEqual(ink.sections.map(section => [section.id, section.number]), [["ink-wash", 2]], "its own frame keeps the constraint's number");
  assert.deepEqual(ink.cells.map(cell => cell.id), ["ink"]);
  assert.ok(ink.cells[0].box.w > 800 && ink.cells[0].box.h > 500, "one constraint's widget has the frame to itself");
  assert.match(proxyDocument("tok", "http://x", whole.cells, whole.sections), /SECTIONS=\[\{"id":"branching-growth","label":"branches"/);

  // Opening: one frame per constraint with widgets; the node's own frame (made before any) goes; hidden ones come back.
  let n = 0; const makeId = () => `proxy-${++n}`;
  const first = planProxyFrames([], "a", "tree", [], makeId);
  assert.deepEqual(first.frames.map(frame => [frame.id, frame.constraintId]), [["proxy-1", undefined]], "no handles yet: one frame for the node");
  const split = planProxyFrames(first.frames, "a", "tree", ["branching-growth", "ink-wash"], makeId);
  assert.deepEqual(split.mine.map(frame => frame.constraintId), ["branching-growth", "ink-wash"]); assert.deepEqual(split.removed.map(frame => frame.id), ["proxy-1"]);
  const hidden = split.frames.map(frame => ({ ...frame, hidden: true }));
  const again = planProxyFrames(hidden, "a", "tree", ["branching-growth", "ink-wash"], makeId);
  assert.deepEqual([again.added.length, again.mine.every(frame => !frame.hidden)], [0, true], "opening shows them again, adding none");
  assert.equal(planProxyFrames([], "a", "tree", ["branching-growth", "ink-wash"], makeId, 1).left, 1, "the limit holds");
  assert.deepEqual(proxiesOf([...again.frames].reverse(), "a", "tree", ["branching-growth", "ink-wash"]).map(frame => frame.constraintId), ["branching-growth", "ink-wash"], "in constraint order");

  const frame = renderToStaticMarkup(createElement(ProxyFrame, { frameId: "proxy-2", node: tree, constraints: tree.constraints, targetName: "A", busy: "", onSet: noop, onError: noop, onDesign: noop, only: "ink-wash" }));
  assert.match(frame, /<iframe/);
  const bar = renderToStaticMarkup(createElement(ProxyFrameBar, { node: tree, constraints: tree.constraints, current: "proxy-2", busy: false, onHide: noop, onDesign: noop, onDesignAll: noop,
    siblings: [{ id: "proxy-2", constraintId: "branching-growth" }, { id: "proxy-3", constraintId: "ink-wash", hidden: true }] }));
  assert.match(bar, /class="proxy-chip here" aria-pressed="true"[^>]*>.*<b>1<\/b>branches/);
  assert.match(bar, /class="proxy-chip off" aria-pressed="false"[^>]*>.*<b>2<\/b>color/);
  assert.match(bar, /Hide all/);
  assert.equal(proxyFrameSchema.parse({ id: "proxy-1", targetFrameId: "a", nodeId: "tree", constraintId: "ink-wash", hidden: true }).hidden, true, "projects keep it");
  assert.equal(proxyFrameSchema.parse({ id: "proxy-1", targetFrameId: "a", nodeId: "tree", hidden: ["ink-wash"] }).hidden, undefined, "an older hidden list is dropped");
});

test("Handles for all: one request per base-state constraint still without handles, each applied; one failing does not stop the rest", async () => {
  const { sceneAI } = await import("../app/studio/scene-actions");
  const { createSketchPanel } = await import("../app/lib/sketch-panels");
  const scene = setHandle(sampleScene(), "tree", "ink", widget());
  const panels: Record<string, ReturnType<typeof createSketchPanel>> = { a: createSketchPanel({ scene }) };
  const asked: string[] = [], opened: string[] = [], toasts: string[] = [];
  const deps = {
    panel: (id: string) => panels[id] ?? createSketchPanel(), toast: (text: string) => toasts.push(text), documentId: () => 1, active: () => "a",
    updatePanel: (id: string, patch: any) => { const base = panels[id] ?? createSketchPanel(); panels[id] = { ...base, ...(typeof patch === "function" ? patch(base) : patch) }; },
    // Like the app's: the frame shows the work as loading until it ends.
    task: async (label: string, work: () => Promise<void>, owner: string) => { deps.updatePanel(owner, { loading: label }); try { await work(); } finally { deps.updatePanel(owner, { loading: "" }); } },
    request: async (intent: string, body: any) => {
      assert.equal(intent, "handles"); asked.push(`${body.targetNodeId}/${body.targetConstraintId}`);
      if (body.targetNodeId === "orb") throw new Error("boom");
      const node = findNode(body.scene, body.targetNodeId)!, item = node.constraints.find(entry => entry.id === body.targetConstraintId)!;
      return { handles: item.params.map(param => ({ paramId: param.id, handle: widget([[]]) })), skipped: [] };
    },
    capture: async () => ({ image: "data:image/png;base64,AAAA", region: { x: 0, y: 0, w: 1, h: 1 } }),
    openProxy: (_owner: string, nodeId: string) => opened.push(nodeId),
  } as any;
  await sceneAI(deps, "a").suggestAllHandles();
  assert.deepEqual(asked.sort(), ["orb/drift", "orb/pulse", "tree/branching-growth"], "ink-wash already has its handle; the orb (a child) is included");
  assert.ok(findNode(panels.a.scene, "tree")!.constraints[0].params[0].handle, "the result is on the scene");
  assert.deepEqual(opened, ["tree"]);
  assert.match(toasts.at(-1)!, /Created 3 direct manipulation handle\(s\) for 1 constraint\(s\).*Could not make: (size, x|x, size)/);

  asked.length = 0;
  await sceneAI(deps, "a").suggestAllHandles(["tree"]);
  assert.deepEqual(asked, [], "nothing left to make on the tree");
  assert.match(toasts.at(-1)!, /already has its handles: opened the proxy frames of 1 node/);
  assert.deepEqual(opened, ["tree", "tree"], "with nothing to make, it opens the node's proxy group");

  // Redesign all: every constraint with a handle is made again, the AI seeing the current widget.
  asked.length = 0;
  await sceneAI(deps, "a").suggestAllHandles(undefined, true);
  assert.deepEqual(asked.sort(), ["tree/branching-growth", "tree/ink-wash"], "only those with handles (the orb has none)");
  assert.match(toasts.at(-1)!, /^Redesigned 4 direct manipulation handle\(s\) for 2 constraint\(s\)/);
  assert.equal(panels.a.sceneHistory.length >= 2, true, "each result is its own undo step");
  const none = createSketchPanel({ scene: sampleScene() }); panels.b = none;
  await sceneAI(deps, "b").suggestAllHandles(undefined, true);
  assert.match(toasts.at(-1)!, /no handle to redesign/);
});

test("opening proxies groups a node's frames on the board: a row beside the target, later ones appended, other nodes in their own group", async () => {
  const { placeProxyGroup } = await import("../app/lib/proxy-frames");
  const { groupBox, liveGroups, workspaceSchema, FRAME_WIDTH, FRAME_HEIGHT } = await import("../app/lib/workspace");
  let layout = workspaceSchema.parse({ frames: { source: { x: 0, y: 0 }, "sketch-a": { x: 1040, y: 0 } } });
  let frames: ReturnType<typeof planProxyFrames>["frames"] = [], n = 0, g = 0;
  const open = (nodeId: string, withWidgets: string[]) => {
    const plan = planProxyFrames(frames, "sketch-a", nodeId, withWidgets, () => `proxy-${++n}`);
    frames = plan.frames; layout = placeProxyGroup(layout, plan, "sketch-a", `◎ ${nodeId} · proxy`, () => `group-${++g}`);
    return plan.mine.map(frame => frame.id);
  };
  const overlapping = () => { const spots = Object.entries(layout.frames); return spots.some(([a, p], i) => spots.slice(i + 1).some(([b, q]) => Math.abs(p.x - q.x) < FRAME_WIDTH && Math.abs(p.y - q.y) < FRAME_HEIGHT && a !== b)); };

  const empty = open("tree", []);
  assert.deepEqual(layout.groups.map(group => [group.title, group.frames]), [["◎ tree · proxy", empty]], "even the node's first frame is in its group");
  const two = open("tree", ["t1", "t2"]);
  assert.equal(layout.groups.length, 1); assert.deepEqual(layout.groups[0].frames, two, "the constraints' frames replace it in the same group");
  assert.deepEqual(layout.frames[two[0]], { x: 1040 + FRAME_WIDTH + 140, y: 0 }, "the first takes the node frame's spot");
  assert.equal(layout.frames[empty[0]], undefined);
  const three = open("tree", ["t1", "t2", "t3"]);
  assert.deepEqual(layout.groups[0].frames, three); assert.equal(layout.frames[three[2]].y, layout.frames[three[1]].y, "a later one goes after the rightmost, in the same row");
  const orb = open("orb", ["p1", "p2"]);
  assert.deepEqual(layout.groups.map(group => group.frames), [three, orb], "another node: its own group");
  assert.ok(!overlapping(), "no frames on top of each other");
  const [tree, orbBox] = layout.groups.map(group => groupBox(layout.frames, group.frames)!);
  assert.ok(tree.y + tree.h <= orbBox.y || orbBox.y + orbBox.h <= tree.y || tree.x + tree.w <= orbBox.x || orbBox.x + orbBox.w <= tree.x, "the groups do not overlap");
  // A hidden frame stays in its group while off the board.
  assert.deepEqual(liveGroups(layout.groups, new Set([...three.slice(1), ...orb, three[0]]))[0].frames, three);
});
