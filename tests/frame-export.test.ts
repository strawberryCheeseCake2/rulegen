import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { sampleScene, sceneProgram } from "./fixtures/scene";
import { connectScene } from "../app/server/scene-code.server";
import { updateNode } from "../app/lib/scene/graph";
import { frameExport, FRAME_EXPORT_FORMAT } from "../app/lib/frame-export";
import { FrameJsonDialog } from "../app/components/frame-json-dialog";

test("a frame exports as one JSON: nodes with constraints and params, each state's constraints in order, transitions and the code", () => {
  let scene = sampleScene();
  scene = updateNode(scene, "tree", node => ({ ...node, constraints: node.constraints.map(item => ({ ...item, params: item.params.map(param => param.id === "ink" ? { ...param, handle: { code: "rulegenHandle(function (h) { return {}; });", prepared: "x", paths: [[]], hint: "먹색" } } : param) })) }));
  const generated = connectScene({ title: "Tree", explanation: "나무", code: sceneProgram }, scene);
  const data = frameExport({ id: "sketch-1", name: "Sketch 1", scene, generated, brushOf: id => id === "tree" ? { name: "Tree", master: true } : null });
  assert.equal(data.format, FRAME_EXPORT_FORMAT); assert.deepEqual(data.frame, { id: "sketch-1", name: "Sketch 1" });
  const orb = data.nodes.find(node => node.id === "orb")!, tree = data.nodes.find(node => node.id === "tree")!;
  assert.equal(orb.values["orb/radius"], 24, "every param value");
  assert.deepEqual(orb.machine.states.map(state => [state.id, state.constraints.map(item => item.property)]), [["idle", ["size"]], ["moving", ["size", "x"]]], "each state's constraints in evaluation order");
  assert.equal(orb.machine.transitions[0].id, "press"); assert.equal(orb.machine.transitions[0].event, "press"); assert.equal(orb.machine.initialState, "idle");
  assert.deepEqual(tree.machine.implicit, true, "a node without a machine: its implicit single state");
  assert.deepEqual(orb.constraints.map(item => item.property), ["size", "x"]);
  const radius = orb.constraints[0].params.find(param => param.id === "radius")!;
  assert.deepEqual(radius.scalars[0], { key: "orb/radius", path: "", type: "number", value: 24, min: 10, max: 140, step: 1, unit: "px" }, "with its range");
  const structure = tree.constraints[0].params[0];
  assert.deepEqual(structure.scalars, [{ key: "tree/structure", path: "", type: "number", value: 5, min: 1, max: 9, step: 1, unit: "" }], "a scalar param: one scalar");
  assert.equal("algorithms" in data, false);
  assert.deepEqual(tree.constraints[1].params[0].handle, { hint: "먹색", paths: [[]] }); assert.doesNotMatch(JSON.stringify(data), /rulegenHandle/, "no widget code");
  assert.deepEqual(tree.brush, { name: "Tree", role: "master" }); assert.equal("brush" in orb, false);
  assert.match(data.code!.source, /@rulegen-scene:start/); assert.match(data.code!.source, /rulegenModule\("tree"/);
  assert.equal(JSON.parse(JSON.stringify(data)).nodes.length, scene.nodes.length, "plain JSON");
  assert.equal(frameExport({ id: "s", name: "s", scene, generated: null }).code, null, "no code yet");
  // The brushes in the frame, with their roots in this frame's ids.
  const instance = { ...scene, nodes: scene.nodes.map(node => node.id === "orb" ? { ...node, id: "orb-2", codeId: "orb" } : node) };
  const withBrushes = frameExport({ id: "sketch-2", name: "Sketch 2", scene: instance, generated: null, brushes: [{ id: "b1", name: "Orb", roots: ["orb-2"] }] });
  assert.deepEqual(withBrushes.brushes, [{ id: "b1", name: "Orb", roots: ["orb-2"] }]);
  const html = renderToStaticMarkup(createElement(FrameJsonDialog, { name: "Sketch 1", data, onClose: () => {}, onCopied: () => {} }));
  assert.match(html, /1 state machine \(2 states\)/); assert.match(html, /Copy JSON/); assert.match(html, /aria-label="Frame JSON"/);
});
