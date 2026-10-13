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
  for (const label of ["New collection", "New object", "Group selection", "Ungroup collection", "Delete selected layers", "Undo layer change"]) assert.match(html, new RegExp(`aria-label="${label}"`));
  const empty = renderToStaticMarkup(createElement(LayerPanel, { ...handlers, scene: { nodes: [], algorithms: [] }, selected: [], hovered: null, busy: false, canUndo: false, canRedo: false, title: "Sketch", canExtract: true } as unknown as LayerPanelProps));
  assert.match(empty, /Extract collections/);
});

test("the inspector shows a node's stack of semantic transformations with nested algorithm sliders and state-linked values", () => {
  const scene = sampleScene(), tree = scene.nodes[0], orb = scene.nodes[1];
  const props = (node: typeof tree, stateId?: string) => ({ ...handlers, node, transformations: stateTransformations(node, stateId), library: scene.algorithms, state: node.machine?.states.find(state => state.id === stateId), busy: false, clip: null } as unknown as PropertyInspectorProps);
  const base = renderToStaticMarkup(createElement(PropertyInspector, props(tree)));
  assert.match(base, /SEMANTIC TRANSFORMATIONS · 2\/6/);
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
  const html = renderToStaticMarkup(createElement(NodeMachinePanel, { ...handlers, scene, node: scene.nodes[1], editingStateId: "moving", runtimeStateId: "idle", playing: true, busy: false, hasCode: true } as never));
  assert.match(html, /aria-label="Jump to state 이동" aria-pressed="true"/);
  assert.match(html, /원 클릭/); assert.match(html, /정착 후 대기/);
  assert.doesNotMatch(html, /State constraints/);
  const none = renderToStaticMarkup(createElement(NodeMachinePanel, { ...handlers, scene, node: scene.nodes[0], editingStateId: null, runtimeStateId: null, playing: true, busy: false, hasCode: true } as never));
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
