import { emptyMachineDraft } from "../app/lib/sketch-panels";
import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { sampleScene } from "./fixtures/scene";
import { LayerPanel, type LayerPanelProps } from "../app/components/scene/layer-panel";
import { PropertyInspector, type PropertyInspectorProps } from "../app/components/scene/property-inspector";
import { NodeMachinePanel } from "../app/components/scene/node-machine-panel";
import { AlgorithmLibrary } from "../app/components/scene/algorithm-library";
import { stateProperties, stateTransformations } from "../app/lib/scene/machines";

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

test("the inspector shows a node's stack of semantic transformations with nested algorithm sliders and state-linked values", () => {
  const scene = sampleScene(), tree = scene.nodes[0], orb = scene.nodes[1];
  const props = (node: typeof tree, stateId?: string) => ({ ...handlers, node, transformations: stateTransformations(node, stateId), library: scene.algorithms, state: node.machine?.states.find(state => state.id === stateId), busy: false, clip: null } as unknown as PropertyInspectorProps);
  const base = renderToStaticMarkup(createElement(PropertyInspector, props(tree)));
  assert.match(base, /SEMANTIC TRANSFORMATIONS · 2\/12/);
  assert.match(base, /aria-label="Semantic transformation Branching growth"[\s\S]*Branching[\s\S]*aria-label="Semantic transformation Ink wash"[\s\S]*Ink/, "each transformation holds its own properties, in order");
  assert.match(base, /aria-label="Move Branching growth up" title="Apply earlier" disabled/);
  assert.match(base, /aria-label="Regenerate Ink wash"/);
  assert.match(base, /\+ Add transformation/); assert.match(base, /Add transformation with AI/);
  assert.equal(base.match(/Drop a ƒ block here/g)?.length, 2, "each transformation has its own socket");
  assert.match(base, /Recursive branch/);
  assert.match(base, /Power decay/, "the nested algorithm argument is editable in place");
  assert.match(base, /aria-label="Ratio"[^>]*type="range"|type="range"[^>]*aria-label="Ratio"/);
  assert.match(base, /aria-label="Branching slot"/, "sockets can swap between number and any algorithm block");
  assert.match(base, /class="value-socket socket-root accepts-blocks/, "properties are sockets that accept blocks");
  assert.match(base, /class="algorithm-block depth-0"[^>]*data-algorithm-id="recursive-branch"/, "the algorithm is a separate block plugged into the socket");
  assert.match(base, /class="algorithm-block-header" draggable="true"/, "blocks can be dragged out to another socket");
  const inState = renderToStaticMarkup(createElement(PropertyInspector, props(orb, "moving")));
  assert.match(inState, /aria-pressed="true">이동/);
  assert.match(inState, /Editing <strong>이동<\/strong>/);
  assert.match(inState, /value="80"/, "state value is shown instead of the base value");
  assert.doesNotMatch(inState, /aria-label="[^"]* slot"/, "structure cannot be changed per state");
  assert.doesNotMatch(inState, /Add transformation/, "the stack is edited in Base only");
  assert.match(inState, /원 클릭|정착 후 대기/);
  assert.match(inState, /aria-label="Transition settle semantic label"/);
});

test("the bottom panel shows only the selected node's machine graph; constraints live in the inspector", () => {
  const scene = sampleScene();
  const html = renderToStaticMarkup(createElement(NodeMachinePanel, { ...handlers, scene, node: scene.nodes[1], editingStateId: "moving", runtimeStateId: "idle", playing: true, busy: false, hasCode: true, target: { kind: "state", id: "moving" }, draft: emptyMachineDraft() } as never));
  assert.match(html, /class="machine-state selected-state attached-state[^"]*"[^>]*aria-label="Select state 이동" aria-pressed="true"/);
  assert.doesNotMatch(html, /machine-refine-composer/, "the refine composer opens only on request");
  assert.match(html, /원 클릭/); assert.match(html, /정착 후 대기/);
  assert.doesNotMatch(html, /State constraints/);
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

test("the properties panel has a keyboard-accessible resize handle", async () => {
  const { PanelResizer } = await import("../app/components/panel-resizer");
  const html = renderToStaticMarkup(createElement(PanelResizer, { label: "Resize properties panel", min: 280, max: 900, measure: () => 354, onResize() {}, onReset() {} }));
  assert.match(html, /role="separator" aria-orientation="vertical" aria-label="Resize properties panel" aria-valuemin="280" aria-valuemax="900" tabindex="0"/);
  assert.match(html, /double-click to reset/);
});

test("Layers lists each node's semantic transformations under it, to pick, drag and delete", () => {
  const scene = sampleScene();
  const html = renderToStaticMarkup(createElement(LayerPanel, { ...handlers, scene, selected: [], hovered: null, busy: false, canUndo: false, canRedo: false, title: "Sketch", canExtract: true,
    pickedTransformation: { nodeId: "orb", transformationId: "pulse" }, onMoveTransformation: noop, onRemoveTransformation: noop, onPickTransformation: noop } as unknown as LayerPanelProps));
  for (const node of scene.nodes) {
    const list = html.match(new RegExp(`aria-label="Constraints of ${node.name}"[\\s\\S]*?</ul>`))?.[0] ?? "";
    for (const item of node.transformations) { assert.ok(list.includes(item.label || item.id), `${node.name}: ${item.label}`); assert.ok(list.includes(`aria-label="Delete ${item.label || item.id} transformation"`)); }
  }
  assert.match(html, /class="layer-transformation picked[^"]*"[^>]*draggable="true"/);
});

test("a transformation dragged in Layers moves within its node or to another one, ids made unique there and its state values left behind", async () => {
  const { createSketchPanel } = await import("../app/lib/sketch-panels");
  const ops = await import("../app/lib/scene/panel-ops");
  const { takeTransformation } = await import("../app/lib/scene/transformations");
  const { findNode } = await import("../app/lib/scene/graph");
  const panel = createSketchPanel({ scene: sampleScene() });
  const ids = (scene: typeof panel.scene, id: string) => findNode(scene, id)!.transformations.map(item => item.id);
  const reordered = ops.relocateTransformation(panel, "tree", "ink-wash", "tree", "branching-growth");
  assert.deepEqual(ids(reordered.scene!, "tree"), ["ink-wash", "branching-growth"], "before another in its own node");
  assert.deepEqual(ops.relocateTransformation(panel, "tree", "branching-growth", "tree", "ink-wash"), {}, "dropped where it is");
  assert.deepEqual(ops.relocateTransformation(panel, "tree", "ink-wash", "tree", null), {}, "already last");
  const moved = ops.relocateTransformation(panel, "orb", "pulse", "tree", "ink-wash");
  assert.deepEqual(ids(moved.scene!, "tree"), ["branching-growth", "pulse", "ink-wash"]); assert.deepEqual(ids(moved.scene!, "orb"), []);
  assert.ok(findNode(moved.scene!, "orb")!.machine!.states.every(state => !state.values.length), "the orb's states no longer set the properties that left");
  assert.ok(moved.sceneHistory!.length > panel.sceneHistory.length, "an undoable layer change");
  // Ids already used in the node it goes to get a suffix.
  const tree = findNode(panel.scene, "tree")!, pulse = findNode(panel.scene, "orb")!.transformations[0];
  const clash = takeTransformation({ ...tree, transformations: [...tree.transformations, { ...pulse, properties: [pulse.properties[0]] }] }, pulse, null);
  assert.deepEqual(clash.transformations.at(-1)!.properties.map(item => item.id), ["radius-2", "speed"]); assert.equal(clash.transformations.at(-1)!.id, "pulse-2");
  const full = createSketchPanel({ scene: { ...panel.scene, nodes: panel.scene.nodes.map(node => node.id === "tree" ? { ...node, transformations: Array.from({ length: 12 }, (_, i) => ({ id: `t${i}`, label: "", description: "", properties: [] })) } : node) } });
  assert.match(ops.relocateTransformation(full, "orb", "pulse", "tree", null).error!, /no room/);
});

test("a transformation copied in Layers pastes into any layer of any sketch: after the picked one or at the end, with its algorithms, ids unique there", async () => {
  const { copyTransformation, pasteTransformation } = await import("../app/lib/scene/transfer");
  const { findNode } = await import("../app/lib/scene/graph");
  const { algorithmRefs } = await import("../app/lib/scene/algorithms");
  const scene = sampleScene(), clip = copyTransformation(scene, "tree", "branching-growth");
  assert.equal(clip.label, "Branching growth"); assert.ok(clip.library.length > 0, "the algorithms it uses go with it");
  const ids = (next: typeof scene, id: string) => findNode(next, id)!.transformations.map(item => item.id);
  // Into its own node, after the first: a copy beside it, its ids unique.
  const own = pasteTransformation(scene, "tree", clip, "branching-growth");
  assert.deepEqual(ids(own, "tree"), ["branching-growth", "branching-growth-2", "ink-wash"]);
  assert.deepEqual(findNode(own, "tree")!.transformations[1].properties.map(item => item.id), ["structure-2"]);
  // Into another node, at the end.
  assert.deepEqual(ids(pasteTransformation(scene, "tree", clip, null), "tree").at(-1), "branching-growth-2");
  assert.deepEqual(ids(pasteTransformation(scene, "orb", clip), "orb"), ["pulse", "branching-growth"]);
  // Into another sketch with no algorithms: the definitions come along and the pasted values point at them.
  const other = { algorithms: [], nodes: [{ ...findNode(scene, "orb")!, parentId: null, transformations: [], machine: null }] };
  const pasted = pasteTransformation(other, "orb", clip), value = findNode(pasted, "orb")!.transformations[0].properties[0].value;
  for (const id of algorithmRefs(value)) assert.ok(pasted.algorithms.some(item => item.id === id), id);
  const full = { ...scene, nodes: scene.nodes.map(node => node.id === "orb" ? { ...node, transformations: Array.from({ length: 12 }, (_, i) => ({ id: `t${i}`, label: "", description: "", properties: [] })), machine: null } : node) };
  assert.throws(() => pasteTransformation(full, "orb", clip), /no room/);
  const html = renderToStaticMarkup(createElement(LayerPanel, { ...handlers, scene, selected: ["orb"], hovered: null, busy: false, canUndo: false, canRedo: false, title: "Sketch", canExtract: true,
    onCopyTransformation: noop, onPasteTransformation: noop, copied: "Branching growth" } as unknown as LayerPanelProps));
  assert.match(html, /aria-label="Copy Pulse transformation"/); assert.match(html, /aria-label="Paste Branching growth into Orb"/);
});
