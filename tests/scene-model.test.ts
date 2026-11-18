import test from "node:test";
import assert from "node:assert/strict";
import { aiScene, num, sampleScene } from "./fixtures/scene";
import { convertScene } from "../app/lib/scene/convert";
import { sceneSchema } from "../app/lib/scene/validate";
import { sceneBindings, sceneValues, valueAt } from "../app/lib/scene/values";
import { clickTarget, descendantIds, groupNodes, layerTree, moveNodes, removeNodes, setParent, ungroupNode, updateNode } from "../app/lib/scene/graph";
import { machineValues, nodeMachine, stateConstraints } from "../app/lib/scene/machines";
import * as ops from "../app/lib/scene/panel-ops";
import { createSketchPanel, sketchPanelSchema } from "../app/lib/sketch-panels";

test("extraction output becomes collections and objects whose params are scalars", () => {
  const scene = sampleScene();
  assert.deepEqual(layerTree(scene).map(row => [row.node.id, row.depth]), [["tree", 0], ["orb", 1]]);
  const [structure, base, ratio] = scene.nodes[0].constraints[0].params;
  assert.deepEqual([structure.value, base.value, ratio.value], [num(5, 1, 9), num(140, 20, 300, 1, "px"), num(.7, .3, .95, .01)]);
  assert.equal((valueAt(structure.value, []) as { value: number }).value, 5, "a value is its own one leaf");
  assert.equal("algorithms" in scene, false);
  // Collections enclose their members.
  const [tree, orb] = scene.nodes;
  assert.ok(tree.region.x <= orb.region.x && tree.region.x + tree.region.w >= orb.region.x + orb.region.w);
});

test("every scalar leaf becomes a live binding, plus optional node layout and visibility", () => {
  const scene = sampleScene();
  assert.deepEqual(sceneBindings(scene).map(binding => binding.key), ["tree/structure", "tree/base-length", "tree/ratio", "tree/ink", "orb/radius", "orb/speed"]);
  const values = sceneValues(scene);
  assert.equal(values["tree/base-length"], 140);
  assert.equal(values["orb/@x"], scene.nodes[1].region.x * 900);
  assert.equal(values["orb/@visible"], true);
});

test("invalid scenes are rejected: object parents and bad slider ranges", () => {
  const bad = (edit: (scene: typeof aiScene) => void) => { const copy = structuredClone(aiScene); edit(copy); return () => convertScene(copy); };
  assert.throws(bad(s => { s.nodes[1].constraints[0].params[0].value = num(500, 10, 140); }), /slider range is invalid/);
  // A state that lists a constraint the node does not have keeps only the ones it has.
  const dangling = bad(s => { s.nodes[1].machine!.states[1].constraintIds.push("missing"); })();
  assert.deepEqual(dangling.nodes[1].machine!.states[1].constraintIds, ["pulse", "drift"]);
  // Two transitions on the same event from one state would make dispatch ambiguous.
  assert.throws(bad(s => { s.nodes[1].machine!.transitions.push({ id: "again", from: "idle", to: "idle", event: "press", label: "again" }); }), /same event/);
  // An object cannot be a parent; the child is re-rooted rather than lost.
  const copy = structuredClone(aiScene); copy.nodes.push({ ...structuredClone(copy.nodes[1]), id: "child", parentId: "orb", machine: null });
  assert.equal(convertScene(copy).nodes.find(node => node.id === "child")!.parentId, null);
  assert.equal(sceneSchema.safeParse({ ...sampleScene(), nodes: [...sampleScene().nodes, sampleScene().nodes[0]] }).success, false);
});

test("layer operations group, ungroup, nest and move members together like Figma groups", () => {
  let scene = sampleScene();
  scene = { ...scene, nodes: [...scene.nodes, { ...scene.nodes[1], id: "leaf", parentId: null, region: { x: .8, y: .8, w: .1, h: .1 }, machine: null }] };
  const grouped = groupNodes(scene, ["orb", "leaf"], "pair", "Pair");
  assert.equal(grouped.nodes.find(node => node.id === "orb")!.parentId, "pair");
  assert.equal(grouped.nodes.find(node => node.id === "leaf")!.parentId, "pair");
  assert.equal(grouped.nodes.find(node => node.id === "pair")!.parentId, null); // members had different parents
  const before = grouped.nodes.find(node => node.id === "orb")!.region;
  const moved = moveNodes(grouped, ["pair"], .05, -.05);
  assert.ok(Math.abs(moved.nodes.find(node => node.id === "orb")!.region.x - (before.x + .05)) < 1e-6, "members move with their collection");
  assert.ok(Math.abs(moved.nodes.find(node => node.id === "leaf")!.region.y - .75) < 1e-6);
  const clamped = moveNodes(grouped, ["pair"], 5, 5);
  assert.ok(clamped.nodes.every(node => node.region.x + node.region.w <= 1.000001 && node.region.y + node.region.h <= 1.000001));
  assert.deepEqual(ungroupNode(grouped, "pair").nodes.filter(node => node.id === "orb" || node.id === "leaf").map(node => node.parentId), [null, null]);
  assert.equal(setParent(grouped, "pair", "orb").nodes.find(node => node.id === "pair")!.parentId, null, "objects cannot contain nodes");
  assert.equal(setParent(grouped, "tree", "pair").nodes.find(node => node.id === "tree")!.parentId, "pair");
  assert.equal(setParent(setParent(grouped, "tree", "pair"), "pair", "tree").nodes.find(node => node.id === "pair")!.parentId, null, "no cycles");
  assert.deepEqual(removeNodes(grouped, ["pair"]).nodes.map(node => node.id), ["tree"]);
  assert.deepEqual(descendantIds(grouped, "pair").sort(), ["leaf", "orb"]);
  // Click picks the outer collection first, then goes one level deeper.
  assert.equal(clickTarget(scene, "orb", []), "tree");
  assert.equal(clickTarget(scene, "orb", ["tree"]), "orb");
});

test("a state lists the constraints it evaluates in order; a param edit changes the constraint every state shares", () => {
  const panel = { ...createSketchPanel(), scene: sampleScene() };
  const inState = { ...panel, ...ops.chooseState(panel, "orb", "moving") };
  assert.deepEqual(inState.selectedNodeIds, ["orb"]);
  assert.deepEqual(inState.stateJump && { node: inState.stateJump.nodeId, state: inState.stateJump.stateId }, { node: "orb", state: "moving" });
  assert.deepEqual(ops.inspectedConstraints(inState, inState.scene.nodes[1]).map(item => item.property), ["size", "x"]);
  const idle = { ...panel, ...ops.chooseState(panel, "orb", "idle") };
  assert.deepEqual(ops.inspectedConstraints(idle, idle.scene.nodes[1]).map(item => item.property), ["size"]);
  // A param is the constraint's: the same in every state that evaluates it.
  const edited = { ...inState, ...ops.setParamScalar(inState, "orb", "radius", [], 100) };
  assert.equal((edited.scene.nodes[1].constraints[0].params[0].value as { value: number }).value, 100);
  const snapped = { ...edited, ...ops.setParamScalar(edited, "orb", "speed", [], 7.4) };
  assert.equal((snapped.scene.nodes[1].constraints[1].params[0].value as { value: number }).value, 7, "snapped to the slider step");
  // Reordering with a state selected changes that state's evaluation order only.
  const reordered = { ...snapped, ...ops.moveConstraint(snapped, "orb", "drift", -1) };
  assert.deepEqual(reordered.scene.nodes[1].machine!.states.map(state => state.constraintIds), [["pulse"], ["drift", "pulse"]]);
  assert.deepEqual(reordered.scene.nodes[1].constraints.map(item => item.id), ["pulse", "drift"], "declaration order stays");
  // A state can leave a constraint out and take it back.
  const out = { ...reordered, ...ops.setStateConstraintIncluded(reordered, "orb", "moving", "pulse", false) };
  assert.deepEqual(stateConstraints(out.scene.nodes[1], "moving").map(item => item.id), ["drift"]);
  const back = { ...out, ...ops.setStateConstraintIncluded(out, "orb", "moving", "pulse", true) };
  assert.deepEqual(stateConstraints(back.scene.nodes[1], "moving").map(item => item.id), ["drift", "pulse"]);
  // A new constraint added while a state is selected joins that state only.
  const added = { ...back, ...ops.addConstraint(back, "orb", "opacity") };
  assert.deepEqual(added.scene.nodes[1].machine!.states.map(state => state.constraintIds.length), [1, 3]);
  // The order is host data: the program gets it without new code.
  assert.deepEqual(machineValues(back.scene).orb.states[1].constraints, [{ id: "drift", property: "x" }, { id: "pulse", property: "size" }]);
  const removed = { ...snapped, ...ops.removeParam(snapped, "orb", "speed") };
  assert.equal(removed.scene.nodes[1].constraints[1].params.length, 0);
  const restored = { ...removed, ...ops.undoScene(removed) };
  assert.equal(restored.scene.nodes[1].constraints[1].params.length, 1);
  assert.equal({ ...restored, ...ops.redoScene(restored) }.scene.nodes[1].constraints[1].params.length, 0);
});

test("a node without a machine of its own is one implicit state that evaluates every constraint in order", () => {
  const tree = sampleScene().nodes[0];
  assert.equal(tree.machine, null);
  assert.deepEqual(nodeMachine(tree).states.map(state => [state.id, state.constraintIds]), [["default", ["branching-growth", "ink-wash"]]]);
  assert.deepEqual(machineValues(sampleScene()).tree.states[0].constraints.map(item => item.property), ["branches", "color"]);
});

test("a node stacks several constraints: add, reorder, fill and remove them without changing live keys", () => {
  const panel = { ...createSketchPanel(), scene: sampleScene() };
  const tree = () => (current: typeof panel) => current.scene.nodes.find(node => node.id === "tree")!;
  assert.deepEqual(tree()(panel).constraints.map(item => item.id), ["branching-growth", "ink-wash"]);
  const added = { ...panel, ...ops.addConstraint(panel, "tree", "sway") };
  assert.deepEqual(tree()(added).constraints.map(item => item.property), ["branches", "color", "sway"]);
  assert.deepEqual(added.dirtyNodeIds, ["tree"]);
  // A slider added to the new constraint lands there; param ids stay unique across the node.
  const sway = tree()(added).constraints[2].id;
  const filled = { ...added, ...ops.addSliderParam(added, "tree", sway) };
  const again = { ...filled, ...ops.addSliderParam(filled, "tree", "ink-wash") };
  assert.deepEqual(tree()(again).constraints.map(item => item.params.map(param => param.id)), [["structure", "base-length", "ratio"], ["ink", "value-2"], ["value"]]);
  assert.equal(tree()(again).constraints[2].params[0].value.type, "number", "a slider is a number");
  assert.ok(sceneBindings(again.scene).some(binding => binding.key === "tree/value-2"), "keys stay nodeId/paramId whichever constraint holds it");
  const moved = { ...again, ...ops.moveConstraint(again, "tree", sway, -2) };
  assert.deepEqual(tree()(moved).constraints.map(item => item.property), ["sway", "branches", "color"]);
  const renamed = { ...moved, ...ops.editConstraint(moved, "tree", sway, { property: "rotation", description: "바람에 흔들림" }) };
  assert.equal(tree()(renamed).constraints[0].description, "바람에 흔들림");
  const removed = { ...renamed, ...ops.removeConstraint(renamed, "tree", "ink-wash") };
  assert.deepEqual(tree()(removed).constraints.map(item => item.id), [sway, "branching-growth"]);
  assert.equal(sceneBindings(removed.scene).some(binding => binding.key === "tree/ink"), false, "its params go with it");
  assert.equal({ ...removed, ...ops.undoScene(removed) }.scene.nodes[0].constraints.length, 3);
  // Limits: sixteen constraints per node.
  let full = panel;
  for (let i = 0; i < 18; i++) full = { ...full, ...ops.addConstraint(full, "tree") };
  assert.equal(tree()(full).constraints.length, 16);
  // Removing a constraint takes it out of every state.
  const orb = { ...panel, ...ops.removeConstraint(panel, "orb", "pulse") };
  assert.deepEqual(orb.scene.nodes[1].machine!.states.map(state => state.constraintIds), [[], ["drift"]]);
  // Duplicate ids are rejected by validation.
  assert.throws(() => sceneSchema.parse({ ...panel.scene, nodes: panel.scene.nodes.map(node => node.id === "tree" ? { ...node, constraints: [...node.constraints, { ...node.constraints[1], id: "copy" }] } : node) }));
});

test("objects stack constraints exactly like collections", () => {
  const panel = { ...createSketchPanel(), scene: sampleScene() };
  assert.equal(panel.scene.nodes[1].kind, "object");
  const added = { ...panel, ...ops.addConstraint(panel, "orb", "glow") };
  const glow = added.scene.nodes[1].constraints[2].id;
  const filled = { ...added, ...ops.addSliderParam(added, "orb", glow) };
  const orb = filled.scene.nodes[1];
  assert.deepEqual(orb.constraints.map(item => [item.property, item.params.map(param => param.id)]), [["size", ["radius"]], ["x", ["speed"]], ["glow", ["value"]]]);
  assert.ok(sceneBindings(filled.scene).some(binding => binding.key === "orb/value"));
  // Added with no state selected, it joins every state, last in each one's order.
  assert.deepEqual(stateConstraints(orb, "idle").map(item => item.property), ["size", "glow"]);
  assert.deepEqual(stateConstraints(orb, "moving").map(item => item.property), ["size", "x", "glow"]);
});

test("collections nest up to five levels: deeper model output is flattened into level 5, deeper scenes are rejected", async () => {
  const { sceneDepth, nodeLevel } = await import("../app/lib/scene/graph");
  const chain = Array.from({ length: 7 }, (_, i) => ({ id: `level-${i + 1}`, kind: i < 6 ? "collection" as const : "object" as const, parentId: i ? `level-${i}` : null, name: `Level ${i + 1}`, description: "", primitive: i < 6 ? "group" : "dot",
    region: { x: .1 + i * .01, y: .1 + i * .01, w: .5, h: .5 }, constraints: [], machine: null }));
  const scene = convertScene({ nodes: chain });
  assert.equal(sceneDepth(scene), 5);
  assert.deepEqual(scene.nodes.map(node => [node.id, nodeLevel(scene, node.id)]), [["level-1", 1], ["level-2", 2], ["level-3", 3], ["level-4", 4], ["level-5", 5], ["level-6", 5], ["level-7", 5]]);
  assert.equal(scene.nodes.find(node => node.id === "level-7")!.parentId, "level-4", "extra levels attach to the level-4 ancestor");
  const tooDeep = { ...scene, nodes: scene.nodes.map(node => node.id === "level-7" ? { ...node, parentId: "level-6" } : node) };
  assert.throws(() => sceneSchema.parse(tooDeep), /nested at most 5 levels/);
});

