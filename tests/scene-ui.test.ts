import { emptyMachineDraft } from "../app/lib/sketch-panels";
import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { sampleScene } from "./fixtures/scene";
import { LayerPanel, type LayerPanelProps } from "../app/components/scene/layer-panel";
import { ConstraintInspector, type ConstraintInspectorProps } from "../app/components/scene/constraint-inspector";
import { NodeMachinePanel } from "../app/components/scene/node-machine-panel";
import { AlgorithmLibrary } from "../app/components/scene/algorithm-library";
import { stateConstraints } from "../app/lib/scene/machines";

const noop = () => {};
const handlers = new Proxy({}, { get: () => noop }) as Record<string, () => void>;

test("the layer panel shows the collection/object tree with machine badges and grouping actions", () => {
  const scene = sampleScene();
  const html = renderToStaticMarkup(createElement(LayerPanel, { ...handlers, scene, selected: ["orb"], hovered: null, busy: false, canUndo: true, canRedo: false, title: "Sketch", canExtract: true } as unknown as LayerPanelProps));
  assert.match(html, /role="tree"/);
  assert.match(html, /aria-level="1"[^>]*>.*Tree/);
  assert.match(html, /aria-selected="true" aria-level="2"[^>]*>.*Orb/);
  assert.match(html, /2S/, "machine badge");
  for (const label of ["New brush stamp", "New object", "Group selection", "Ungroup brush stamp", "Delete selected layers", "Undo layer change"]) assert.match(html, new RegExp(`aria-label="${label}"`));
  const empty = renderToStaticMarkup(createElement(LayerPanel, { ...handlers, scene: { nodes: [], algorithms: [] }, selected: [], hovered: null, busy: false, canUndo: false, canRedo: false, title: "Sketch", canExtract: true } as unknown as LayerPanelProps));
  assert.match(empty, /Extract brush stamps/);
});

test("the inspector shows a node's constraints with nested algorithm sliders, and a state's constraints in its evaluation order", () => {
  const scene = sampleScene(), tree = scene.nodes[0], orb = scene.nodes[1];
  const props = (node: typeof tree, stateId?: string) => ({ ...handlers, node, constraints: stateConstraints(node, stateId), library: scene.algorithms, state: node.machine?.states.find(state => state.id === stateId), busy: false, clip: null } as unknown as ConstraintInspectorProps);
  const base = renderToStaticMarkup(createElement(ConstraintInspector, props(tree)));
  assert.match(base, /CONSTRAINTS · 2\/16/);
  assert.match(base, /aria-label="constraint branches"[\s\S]*Branching[\s\S]*aria-label="constraint color"[\s\S]*Ink/, "each constraint holds its own params, in order");
  assert.match(base, /aria-label="branches constraint property" title="The property this constraint controls"[^>]*value="branches"/);
  assert.match(base, /aria-label="Move branches up" title="Declare earlier" disabled/);
  assert.match(base, /aria-label="Regenerate color"/);
  assert.match(base, /\+ Add constraint/); assert.match(base, /Add constraint with AI/);
  assert.equal(base.match(/Drop a ƒ block here/g)?.length, 2, "each constraint has its own socket");
  assert.match(base, /Recursive branch/);
  assert.match(base, /Power decay/, "the nested algorithm argument is editable in place");
  assert.match(base, /aria-label="Ratio"[^>]*type="range"|type="range"[^>]*aria-label="Ratio"/);
  assert.match(base, /aria-label="Branching slot"/, "sockets can swap between number and any algorithm block");
  assert.match(base, /class="value-socket socket-root accepts-blocks/, "params are sockets that accept blocks");
  assert.match(base, /class="algorithm-block depth-0"[^>]*data-algorithm-id="recursive-branch"/, "the algorithm is a separate block plugged into the socket");
  assert.match(base, /class="algorithm-block-header" draggable="true"/, "blocks can be dragged out to another socket");
  const inState = renderToStaticMarkup(createElement(ConstraintInspector, props(orb, "moving")));
  assert.match(inState, /aria-pressed="true">이동/);
  assert.match(inState, /<strong>이동<\/strong> evaluates these constraints in this order/);
  assert.match(inState, /이동 · EVALUATION ORDER · 2/);
  assert.match(inState, /aria-label="constraint size"[\s\S]*aria-label="constraint x"/, "in the state's order");
  assert.match(inState, /aria-label="Leave size out of 이동"/);
  assert.match(inState, /title="Evaluate earlier in this state"/);
  assert.match(inState, /aria-label="Transition settle semantic label"/);
  assert.match(inState, /aria-label="Transition 오른쪽 끝에 닿음 event" maxLength="80" value="settle"/);
  const idle = renderToStaticMarkup(createElement(ConstraintInspector, props(orb, "idle")));
  assert.match(idle, /NOT IN 대기[\s\S]*x<\/button>/, "a constraint the state leaves out can be added to it");
  assert.match(idle, /class="constraint-states"[^>]*>대기 · 이동</, "where each constraint is evaluated");
});

test("the bottom panel shows only the selected node's machine graph; params live in the inspector", () => {
  const scene = sampleScene();
  const html = renderToStaticMarkup(createElement(NodeMachinePanel, { ...handlers, scene, node: scene.nodes[1], editingStateId: "moving", runtimeStateId: "idle", playing: true, busy: false, hasCode: true, target: { kind: "state", id: "moving" }, draft: emptyMachineDraft() } as never));
  assert.match(html, /class="machine-state selected-state attached-state[^"]*"[^>]*aria-label="Select state 이동" aria-pressed="true"/);
  assert.doesNotMatch(html, /machine-refine-composer/, "the refine composer opens only on request");
  assert.match(html, /원 클릭/); assert.match(html, /오른쪽 끝에 닿음/);
  assert.doesNotMatch(html, /State params/);
  const none = renderToStaticMarkup(createElement(NodeMachinePanel, { ...handlers, scene, node: scene.nodes[0], editingStateId: null, runtimeStateId: null, playing: true, busy: false, hasCode: true, target: null, draft: emptyMachineDraft() } as never));
  assert.match(none, /Tree has no state machine/);
  assert.match(none, /Generate state machine for Tree/);
});

test("the algorithm library shows shared definitions, their users and import sources", () => {
  const scene = sampleScene();
  const html = renderToStaticMarkup(createElement(AlgorithmLibrary, { ...handlers, clipFor: () => null, scene, busy: false, targetName: "Orb", imports: [{ key: "pen:x", label: "Branch pen", algorithm: scene.algorithms[0] }] } as never));
  assert.match(html, /Plugged into Tree/);
  assert.match(html, /Not plugged anywhere · alternative/);
  assert.match(html, /Plug into Orb/);
  assert.match(html, /class="palette-block-header" draggable="true"/);
  assert.match(html, /Branch pen · Power decay/);
});

test("the params panel has a keyboard-accessible resize handle", async () => {
  const { PanelResizer } = await import("../app/components/panel-resizer");
  const html = renderToStaticMarkup(createElement(PanelResizer, { label: "Resize params panel", min: 280, max: 900, measure: () => 354, onResize() {}, onReset() {} }));
  assert.match(html, /role="separator" aria-orientation="vertical" aria-label="Resize params panel" aria-valuemin="280" aria-valuemax="900" tabindex="0"/);
  assert.match(html, /double-click to reset/);
});

test("Layers lists each node's constraints under it, to pick, drag and delete", () => {
  const scene = sampleScene();
  const html = renderToStaticMarkup(createElement(LayerPanel, { ...handlers, scene, selected: [], hovered: null, busy: false, canUndo: false, canRedo: false, title: "Sketch", canExtract: true,
    pickedConstraint: { nodeId: "orb", constraintId: "pulse" }, onMoveConstraint: noop, onRemoveConstraint: noop, onPickConstraint: noop } as unknown as LayerPanelProps));
  for (const node of scene.nodes) {
    const list = html.match(new RegExp(`aria-label="Params of ${node.name}"[\\s\\S]*?</ul>`))?.[0] ?? "";
    for (const item of node.constraints) { assert.ok(list.includes(item.property || item.id), `${node.name}: ${item.property}`); assert.ok(list.includes(`aria-label="Delete ${item.property || item.id} constraint"`)); }
  }
  assert.match(html, /class="layer-constraint picked[^"]*"[^>]*draggable="true"/);
});

test("a constraint dragged in Layers moves within its node or to another one, ids made unique there, out of the states it leaves", async () => {
  const { createSketchPanel } = await import("../app/lib/sketch-panels");
  const ops = await import("../app/lib/scene/panel-ops");
  const { takeConstraint } = await import("../app/lib/scene/constraints");
  const { findNode } = await import("../app/lib/scene/graph");
  const panel = createSketchPanel({ scene: sampleScene() });
  const ids = (scene: typeof panel.scene, id: string) => findNode(scene, id)!.constraints.map(item => item.id);
  const reordered = ops.relocateConstraint(panel, "tree", "ink-wash", "tree", "branching-growth");
  assert.deepEqual(ids(reordered.scene!, "tree"), ["ink-wash", "branching-growth"], "before another in its own node");
  assert.deepEqual(ops.relocateConstraint(panel, "tree", "branching-growth", "tree", "ink-wash"), {}, "dropped where it is");
  assert.deepEqual(ops.relocateConstraint(panel, "tree", "ink-wash", "tree", null), {}, "already last");
  const moved = ops.relocateConstraint(panel, "orb", "pulse", "tree", "ink-wash");
  assert.deepEqual(ids(moved.scene!, "tree"), ["branching-growth", "pulse", "ink-wash"]);
  assert.ok(findNode(moved.scene!, "orb")!.machine!.states.every(state => !state.constraintIds.includes("pulse")), "the orb's states no longer evaluate the constraint that left");
  assert.deepEqual(ids(moved.scene!, "orb"), ["drift"]);
  assert.ok(findNode(moved.scene!, "tree")!.machine === null, "the tree evaluates it in its implicit state");
  assert.ok(moved.sceneHistory!.length > panel.sceneHistory.length, "an undoable layer change");
  // Ids already used in the node it goes to get a suffix.
  const tree = findNode(panel.scene, "tree")!, pulse = findNode(panel.scene, "orb")!.constraints[0];
  const clash = takeConstraint({ ...tree, constraints: [...tree.constraints, { ...pulse, params: [pulse.params[0]] }] }, pulse, null);
  assert.deepEqual(clash.constraints.at(-1)!.params.map(item => item.id), ["radius-2"]); assert.equal(clash.constraints.at(-1)!.id, "pulse-2");
  const full = createSketchPanel({ scene: { ...panel.scene, nodes: panel.scene.nodes.map(node => node.id === "tree" ? { ...node, constraints: Array.from({ length: 16 }, (_, i) => ({ id: `t${i}`, property: "p", description: "", params: [] })) } : node) } });
  assert.match(ops.relocateConstraint(full, "orb", "pulse", "tree", null).error!, /no room/);
});

test("a constraint copied in Layers pastes into any layer of any sketch: after the picked one or at the end, with its algorithms, ids unique there", async () => {
  const { copyConstraint, pasteConstraint } = await import("../app/lib/scene/transfer");
  const { findNode } = await import("../app/lib/scene/graph");
  const { algorithmRefs } = await import("../app/lib/scene/algorithms");
  const scene = sampleScene(), clip = copyConstraint(scene, "tree", "branching-growth");
  assert.equal(clip.label, "branches"); assert.ok(clip.library.length > 0, "the algorithms it uses go with it");
  const ids = (next: typeof scene, id: string) => findNode(next, id)!.constraints.map(item => item.id);
  // Into its own node, after the first: a copy beside it, its ids unique.
  const own = pasteConstraint(scene, "tree", clip, "branching-growth");
  assert.deepEqual(ids(own, "tree"), ["branching-growth", "branching-growth-2", "ink-wash"]);
  assert.deepEqual(findNode(own, "tree")!.constraints[1].params.map(item => item.id), ["structure-2"]);
  // Into another node, at the end.
  assert.deepEqual(ids(pasteConstraint(scene, "tree", clip, null), "tree").at(-1), "branching-growth-2");
  assert.deepEqual(ids(pasteConstraint(scene, "orb", clip), "orb"), ["pulse", "drift", "branching-growth"]);
  // Into another sketch with no algorithms: the definitions come along and the pasted values point at them.
  const other = { algorithms: [], nodes: [{ ...findNode(scene, "orb")!, parentId: null, constraints: [], machine: null }] };
  const pasted = pasteConstraint(other, "orb", clip), value = findNode(pasted, "orb")!.constraints[0].params[0].value;
  for (const id of algorithmRefs(value)) assert.ok(pasted.algorithms.some(item => item.id === id), id);
  const full = { ...scene, nodes: scene.nodes.map(node => node.id === "orb" ? { ...node, constraints: Array.from({ length: 16 }, (_, i) => ({ id: `t${i}`, property: "p", description: "", params: [] })), machine: null } : node) };
  assert.throws(() => pasteConstraint(full, "orb", clip), /no room/);
  const html = renderToStaticMarkup(createElement(LayerPanel, { ...handlers, scene, selected: ["orb"], hovered: null, busy: false, canUndo: false, canRedo: false, title: "Sketch", canExtract: true,
    onCopyConstraint: noop, onPasteConstraint: noop, copied: "branches" } as unknown as LayerPanelProps));
  assert.match(html, /aria-label="Copy size constraint"/); assert.match(html, /aria-label="Paste branches into Orb"/);
});

test("mouse interaction is listed apart, each pointer attribute with the constraint and value it is mapped to, linked back to its card", async () => {
  const { pointerLinks, removeConstraint } = await import("../app/lib/scene/constraints");
  const { sceneSchema } = await import("../app/lib/scene/validate");
  const scene = sampleScene(), tree = scene.nodes.find(item => item.id === "tree")!, noop = () => {};
  const node = { ...tree, constraints: [
    { ...tree.constraints[0], inputs: [{ source: "x" as const, paramId: "", how: "grows toward the pointer" }] },
    { ...tree.constraints[1], inputs: [{ source: "speed" as const, paramId: "ink", how: "darker when dragged fast" }, { source: "y" as const, paramId: "gone", how: "a removed value" }] },
  ] };
  // Saved scenes keep it (and older ones without it still load).
  assert.deepEqual(sceneSchema.parse({ ...scene, nodes: scene.nodes.map(item => item.id === "tree" ? node : item) }).nodes.find(item => item.id === "tree")!.constraints[1].inputs?.[0], { source: "speed", paramId: "ink", how: "darker when dragged fast" });
  assert.deepEqual(pointerLinks(node.constraints).map(link => [link.source, link.index, link.constraint, link.param]),
    [["x", 0, "branches", ""], ["speed", 1, "color", "Ink"]], "a mapping to a value no longer there is not listed");
  assert.deepEqual(pointerLinks(removeConstraint(node, "ink-wash").constraints).map(link => link.source), ["x"]);
  const html = renderToStaticMarkup(createElement(ConstraintInspector, new Proxy({ node, constraints: node.constraints, state: null, busy: false, library: scene.algorithms } as Record<string, unknown>,
    { get: (target, key) => key in target ? target[key as string] : noop }) as never));
  assert.match(html, /aria-label="Mouse interaction"[\s\S]*MOUSE INTERACTION · 2/);
  assert.match(html, /<b class="pointer-source">mouse speed<\/b>[\s\S]*?<span class="constraint-order">2<\/span>color<em> · Ink<\/em>[\s\S]*?darker when dragged fast/);
  assert.match(html, /<b class="pointer-source">mouse x<\/b>[\s\S]*?branches<em> · the constraint itself<\/em>/);
  assert.ok(html.indexOf("MOUSE INTERACTION") < html.indexOf("CONSTRAINTS · 2/16"), "its own list, above the constraints");
  // At the original place: the value (or constraint) shows what of the mouse drives it.
  assert.match(html, /data-param-id="ink"[\s\S]*?class="pointer-chip"[^>]*>[\s\S]*?mouse speed<\/span>/);
  assert.match(html, /data-constraint-id="branching-growth"[\s\S]*?class="pointer-chip"[^>]*>[\s\S]*?mouse x<\/span>/);
  // Nothing follows the mouse: no list.
  assert.doesNotMatch(renderToStaticMarkup(createElement(ConstraintInspector, new Proxy({ node: tree, constraints: tree.constraints, state: null, busy: false, library: scene.algorithms } as Record<string, unknown>,
    { get: (target, key) => key in target ? target[key as string] : noop }) as never)), /Mouse interaction/);
  const { loadPrompt } = await import("../app/server/prompts.server");
  assert.match(loadPrompt("extract"), /POINTER INPUT[\s\S]*`paramId` — the param OF THIS SAME CONSTRAINT/);
  assert.match(loadPrompt("code"), /POINTER INPUTS: a constraint's `inputs`/);
});
