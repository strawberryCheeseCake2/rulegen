import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { sampleScene, sceneProgram } from "./fixtures/scene";
import { connectScene } from "../app/server/scene-code.server";
import { updateNode } from "../app/lib/scene/graph";
import { frameExport, FRAME_EXPORT_FORMAT } from "../app/lib/frame-export";
import { FrameJsonDialog } from "../app/components/frame-json-dialog";

test("a frame exports as one JSON: nodes with constraints and params, each state's constraints in order, transitions, the algorithms used and the code", () => {
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
  assert.equal(structure.value.type, "algorithm", "algorithm blocks are kept as blocks");
  assert.ok(structure.scalars.some(item => item.path === "length/base"), "and every scalar inside them");
  assert.deepEqual(data.algorithms.map(item => item.id).sort(), ["power-decay", "recursive-branch"], "only the algorithms used");
  assert.deepEqual(tree.constraints[1].params[0].handle, { hint: "먹색", paths: [[]] }); assert.doesNotMatch(JSON.stringify(data), /rulegenHandle/, "no widget code");
  assert.deepEqual(tree.brush, { name: "Tree", role: "master" }); assert.equal("brush" in orb, false);
  assert.match(data.code!.source, /@rulegen-scene:start/); assert.match(data.code!.source, /rulegenModule\("tree"/);
  assert.equal(JSON.parse(JSON.stringify(data)).nodes.length, scene.nodes.length, "plain JSON");
  assert.equal(frameExport({ id: "s", name: "s", scene, generated: null }).code, null, "no code yet");
  // Targeted inspection tools of the brushes in the frame, in this frame's ids (stored in the brush's shared ids).
  const instance = { ...scene, nodes: scene.nodes.map(node => node.id === "orb" ? { ...node, id: "orb-2", codeId: "orb" } : node) };
  const tool = { id: "t1", name: "원 크기", concern: "원 크기가 궁금해", marks: [[{ x: .5, y: .5 }, { x: .6, y: .25 }]], markStyles: [{ color: "#e0457b", width: 12, opacity: .6 }],
    result: { summary: "원이 커집니다",
      overlays: [{ id: "size", kind: "rect" as const, name: "크기", x: "p(\"orb/@x\")", y: "0", w: "p(\"orb/radius\")", h: "1", label: "", color: "#e0457b", link: { kind: "param" as const, nodeId: "orb", id: "radius" }, when: "", each: "orb:dots", handle: null }],
      parameters: [], records: null }, overlayUpdates: [] };
  const withTools = frameExport({ id: "sketch-2", name: "Sketch 2", scene: instance, generated: null, brushes: [{ id: "b1", name: "Orb", roots: ["orb-2"], targeted: [tool] }] });
  const exported = withTools.brushes[0].targetedInspections[0];
  assert.deepEqual(withTools.brushes.map(brush => [brush.name, brush.roots]), [["Orb", ["orb-2"]]]);
  assert.equal(exported.concern, "원 크기가 궁금해"); assert.equal(exported.summary, "원이 커집니다");
  assert.deepEqual(exported.annotation, [{ style: { color: "#e0457b", width: 12, opacity: .6 }, points: [{ x: 450, y: 300 }, { x: 540, y: 150 }] }], "the annotation in canvas pixels with its style");
  assert.equal(exported.overlays[0].x, "p(\"orb-2/@x\")", "in this frame's node ids"); assert.equal(exported.overlays[0].link.nodeId, "orb-2"); assert.equal(exported.overlays[0].each, "orb-2:dots");
  assert.ok(!("recommendations" in exported) && !("valueFixes" in exported), "a targeted inspection proposes no fixes");
  const html = renderToStaticMarkup(createElement(FrameJsonDialog, { name: "Sketch 1", data, onClose: () => {}, onCopied: () => {} }));
  assert.match(html, /1 state machine \(2 states\)/); assert.match(html, /Copy JSON/); assert.match(html, /aria-label="Frame JSON"/);
});
