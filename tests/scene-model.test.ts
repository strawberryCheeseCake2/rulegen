import test from "node:test";
import assert from "node:assert/strict";
import { aiScene, num, sampleScene } from "./fixtures/scene";
import { convertScene } from "../app/lib/scene/convert";
import { sceneSchema } from "../app/lib/scene/validate";
import { sceneBindings, sceneValues, valueAt } from "../app/lib/scene/values";
import { clickTarget, descendantIds, groupNodes, layerTree, moveNodes, removeNodes, setParent, ungroupNode } from "../app/lib/scene/graph";
import { importAlgorithms, instantiate } from "../app/lib/scene/algorithms";
import { makeAlgorithmPen, importAlgorithmCall, penAlgorithm } from "../app/lib/scene/pens";
import { stateProperties } from "../app/lib/scene/machines";
import * as ops from "../app/lib/scene/panel-ops";
import { createSketchPanel, sketchPanelSchema } from "../app/lib/sketch-panels";
import type { AlgorithmCall } from "../app/lib/scene/schema";

test("extraction output becomes collections and objects whose algorithm parameters can hold other algorithms", () => {
  const scene = sampleScene();
  assert.deepEqual(layerTree(scene).map(row => [row.node.id, row.depth]), [["tree", 0], ["orb", 1]]);
  const structure = scene.nodes[0].transformations[0].properties[0].value as AlgorithmCall;
  assert.equal(structure.algorithmId, "recursive-branch");
  // Arguments follow the definition; the omitted `length` argument expands into a power-decay call.
  assert.deepEqual(structure.args.map(arg => arg.id), ["depth", "length"]);
  assert.equal((valueAt(structure, ["depth"]) as { value: number }).value, 5);
  assert.equal((valueAt(structure, ["length"]) as AlgorithmCall).algorithmId, "power-decay");
  assert.equal((valueAt(structure, ["length", "ratio"]) as { value: number }).value, .7);
  // Unused definitions stay in the library as swappable alternatives.
  assert.ok(scene.algorithms.some(algorithm => algorithm.id === "sine-wave"));
  // Collections enclose their members.
  const [tree, orb] = scene.nodes;
  assert.ok(tree.region.x <= orb.region.x && tree.region.x + tree.region.w >= orb.region.x + orb.region.w);
});

test("every scalar leaf becomes a live binding, plus optional node layout and visibility", () => {
  const scene = sampleScene();
  assert.deepEqual(sceneBindings(scene).map(binding => binding.key), ["tree/structure/depth", "tree/structure/length/base", "tree/structure/length/ratio", "tree/ink", "orb/radius", "orb/speed"]);
  const values = sceneValues(scene);
  assert.equal(values["tree/structure/length/base"], 140);
  assert.equal(values["orb/@x"], scene.nodes[1].region.x * 900);
  assert.equal(values["orb/@visible"], true);
});

test("invalid scenes are rejected: dangling algorithms, self-referencing defaults, object parents and bad slider ranges", () => {
  const bad = (edit: (scene: typeof aiScene) => void) => { const copy = structuredClone(aiScene); edit(copy); return () => convertScene(copy); };
  assert.throws(bad(s => { (s.nodes[0].transformations[0].properties[0].value as { algorithmId: string }).algorithmId = "missing"; }), /찾지 못했습니다/);
  assert.throws(bad(s => { s.algorithms[0].params[0].value = { type: "algorithm-ref", algorithmId: "power-decay" }; }), /자기 자신|중첩/);
  assert.throws(bad(s => { s.nodes[1].transformations[0].properties[0].value = num(500, 10, 140); }), /범위/);
  // A state value whose structure differs from the base property is dropped, not allowed to break bindings.
  const mismatched = bad(s => { s.nodes[1].machine!.states[1].values[0].value = { type: "color", value: "#ffffff" }; })();
  assert.deepEqual(mismatched.nodes[1].machine!.states[1].values.map(item => item.propertyId), ["speed"]);
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

test("algorithms are reusable: plugged into other properties, imported across sketches, carried by pens", () => {
  const scene = sampleScene();
  const panel = { ...createSketchPanel(), scene };
  // Number slot → algorithm → number again.
  const swapped = { ...panel, ...ops.swapSlot(panel, "orb", "radius", [], { type: "algorithm", algorithmId: "power-decay" }) };
  assert.equal((swapped.scene.nodes[1].transformations[0].properties[0].value as AlgorithmCall).algorithmId, "power-decay");
  assert.equal(swapped.sceneHistory.length, 1);
  assert.deepEqual(swapped.dirtyNodeIds, ["orb"]);
  // The machine's state value for radius no longer matches and is dropped instead of breaking bindings.
  assert.equal(swapped.scene.nodes[1].machine!.states[1].values.some(item => item.propertyId === "radius"), false);
  const back = { ...swapped, ...ops.swapSlot(swapped, "orb", "radius", [], { type: "number" }) };
  assert.equal(back.scene.nodes[1].transformations[0].properties[0].value.type, "number");
  // An algorithm argument can itself be swapped for another algorithm.
  const nested = { ...panel, ...ops.swapSlot(panel, "tree", "structure", ["depth"], { type: "algorithm", algorithmId: "sine-wave" }) };
  assert.equal((valueAt(nested.scene.nodes[0].transformations[0].properties[0].value, ["depth"]) as AlgorithmCall).algorithmId, "sine-wave");
  // Same id and same content is reused; same id with different content is renamed.
  const changed = { ...scene.algorithms[0], description: "different" };
  const merged = importAlgorithms(scene.algorithms, [scene.algorithms[0], changed]);
  assert.equal(merged.library.filter(algorithm => algorithm.description === "different")[0].id, "power-decay-2");
  // Pens carry the call and every definition it depends on.
  const pen = makeAlgorithmPen(scene, { nodeId: "tree", propertyId: "structure" }, "source", "pen", "#3b73c4");
  assert.deepEqual(pen.algorithm!.library.map(algorithm => algorithm.id).sort(), ["power-decay", "recursive-branch"]);
  assert.equal(pen.source.label, "Tree · Branching");
  assert.throws(() => makeAlgorithmPen(scene, { nodeId: "tree", propertyId: "ink" }, "source", "x", "#3b73c4"), /알고리즘/);
  const other = importAlgorithmCall({ nodes: [], algorithms: [] }, penAlgorithm(pen)!);
  assert.deepEqual(other.scene.algorithms.map(algorithm => algorithm.id).sort(), ["power-decay", "recursive-branch"]);
  assert.deepEqual(other.call, pen.algorithm!.call);
  assert.deepEqual(instantiate(scene.algorithms, "recursive-branch").args.map(arg => arg.id), ["depth", "length"]);
});

test("with a state selected, widget edits change only that state; Base edits change the shared property", () => {
  const panel = { ...createSketchPanel(), scene: sampleScene() };
  const inState = { ...panel, ...ops.chooseState(panel, "orb", "moving") };
  assert.deepEqual(inState.selectedNodeIds, ["orb"]);
  assert.deepEqual(inState.stateJump && { node: inState.stateJump.nodeId, state: inState.stateJump.stateId }, { node: "orb", state: "moving" });
  assert.equal((ops.inspectedProperties(inState, inState.scene.nodes[1])[0].value as { value: number }).value, 80);
  const edited = { ...inState, ...ops.setPropertyScalar(inState, "orb", "radius", [], 100) };
  const orb = edited.scene.nodes[1];
  assert.equal((stateProperties(orb, "moving")[0].value as { value: number }).value, 100);
  assert.equal((orb.transformations[0].properties[0].value as { value: number }).value, 24, "base value untouched");
  const base = { ...edited, ...ops.chooseState(edited, "orb", null) };
  const baseEdit = { ...base, ...ops.setPropertyScalar(base, "orb", "speed", [], 7.4) };
  assert.equal((baseEdit.scene.nodes[1].transformations[0].properties[1].value as { value: number }).value, 7, "snapped to the slider step");
  assert.equal((stateProperties(baseEdit.scene.nodes[1], "idle")[1].value as { value: number }).value, 7, "states without overrides follow the base");
  const undone = { ...baseEdit, ...ops.removeProperty(baseEdit, "orb", "speed") };
  assert.equal(undone.scene.nodes[1].machine!.states[1].values.some(item => item.propertyId === "speed"), false);
  const restored = { ...undone, ...ops.undoScene(undone) };
  assert.equal(restored.scene.nodes[1].transformations[0].properties.length, 2);
  assert.equal({ ...restored, ...ops.redoScene(restored) }.scene.nodes[1].transformations[0].properties.length, 1);
});

test("procedural economy: repeated siblings are found by structure, laid out by observed geometry, and machines stay separate", async () => {
  const { collapseRepeats, inferLayout, nameStem, repeatedSiblings } = await import("../app/lib/scene/procedural");
  const dot = (i: number, x: number, y: number) => ({ id: `dot-${i}`, kind: "object" as const, parentId: null, name: `Dot ${i}`, description: "", primitive: "Dot", region: { x, y, w: .04, h: .06 }, visible: true, machine: null,
    transformations: [{ id: "main", label: "", description: "", properties: [{ id: `r${i}`, label: "R", effect: "spatial" as const, description: "", value: { type: "number" as const, value: i, min: 0, max: 10, step: 1, unit: "" } }] }] });
  const row = { nodes: [dot(1, .1, .5), dot(2, .3, .5), dot(3, .5, .52)], algorithms: [] };
  assert.equal(nameStem("Petal #3"), "petal");
  assert.deepEqual(repeatedSiblings(row).map(group => group.ids), [["dot-1", "dot-2", "dot-3"]]);
  assert.equal(inferLayout(row.nodes.map(node => node.region)).arrangement, "row");
  assert.equal(inferLayout(row.nodes.map(node => node.region)).spacing, 180);
  const collapsed = collapseRepeats(row);
  assert.equal(collapsed.nodes.length, 1); assert.equal(collapsed.nodes[0].name, "Dot ×3");
  assert.ok(Math.abs(collapsed.nodes[0].region.w - .44) < 1e-6, "the node covers every instance");
  assert.equal(collapsed.algorithms[0].id, "repeat-layout");
  assert.deepEqual(sceneBindings(collapsed).map(binding => binding.key).filter(key => key.includes("repeat")), ["dot-1/repeat/count", "dot-1/repeat/arrangement", "dot-1/repeat/spacing", "dot-1/repeat/size", "dot-1/repeat/jitter"]);
  // Two eyes are not a repetition; two numbered copies are. Interactive nodes keep their own machines.
  const pair = { nodes: [{ ...dot(1, .1, .1), name: "Left eye" }, { ...dot(2, .3, .1), name: "Right eye" }], algorithms: [] };
  assert.equal(repeatedSiblings(pair).length, 0);
  assert.equal(repeatedSiblings({ nodes: [dot(1, .1, .1), dot(2, .3, .1)], algorithms: [] }).length, 1);
  const machine = { initialState: "a", states: [{ id: "a", label: "A", description: "", values: [] }], transitions: [] };
  assert.equal(repeatedSiblings({ nodes: row.nodes.map(node => ({ ...node, machine })), algorithms: [] }).length, 0);
});

test("a node stacks several semantic transformations: add, reorder, fill and remove them without changing live keys", () => {
  const panel = { ...createSketchPanel(), scene: sampleScene() };
  const tree = () => (current: typeof panel) => current.scene.nodes.find(node => node.id === "tree")!;
  assert.deepEqual(tree()(panel).transformations.map(item => item.id), ["branching-growth", "ink-wash"]);
  const added = { ...panel, ...ops.addTransformation(panel, "tree", "Wind sway") };
  assert.deepEqual(tree()(added).transformations.map(item => item.label), ["Branching growth", "Ink wash", "Wind sway"]);
  assert.deepEqual(added.dirtyNodeIds, ["tree"]);
  // A block dropped on the new transformation lands there; property ids stay unique across the node.
  const sway = tree()(added).transformations[2].id;
  const filled = { ...added, ...ops.addAlgorithmProperty(added, "tree", "sine-wave", sway) };
  const again = { ...filled, ...ops.addAlgorithmProperty(filled, "tree", "sine-wave", "ink-wash") };
  assert.deepEqual(tree()(again).transformations.map(item => item.properties.map(property => property.id)), [["structure"], ["ink", "sine-wave-2"], ["sine-wave"]]);
  assert.ok(sceneBindings(again.scene).some(binding => binding.key === "tree/sine-wave/amplitude"), "keys stay nodeId/propertyId whichever transformation holds it");
  const moved = { ...again, ...ops.moveTransformation(again, "tree", sway, -2) };
  assert.deepEqual(tree()(moved).transformations.map(item => item.label), ["Wind sway", "Branching growth", "Ink wash"]);
  const renamed = { ...moved, ...ops.editTransformation(moved, "tree", sway, { label: "Wind", description: "바람에 흔들림" }) };
  assert.equal(tree()(renamed).transformations[0].description, "바람에 흔들림");
  const removed = { ...renamed, ...ops.removeTransformation(renamed, "tree", "ink-wash") };
  assert.deepEqual(tree()(removed).transformations.map(item => item.id), [sway, "branching-growth"]);
  assert.equal(sceneBindings(removed.scene).some(binding => binding.key === "tree/ink"), false, "its properties go with it");
  assert.equal({ ...removed, ...ops.undoScene(removed) }.scene.nodes[0].transformations.length, 3);
  // Limits: six transformations per node.
  let full = panel;
  for (let i = 0; i < 6; i++) full = { ...full, ...ops.addTransformation(full, "tree") };
  assert.equal(tree()(full).transformations.length, 6);
  // Removing a transformation drops state values of its properties.
  const orb = { ...panel, ...ops.removeTransformation(panel, "orb", "pulse") };
  assert.deepEqual(orb.scene.nodes[1].machine!.states[1].values, []);
  // Duplicate ids are rejected by validation.
  assert.throws(() => sceneSchema.parse({ ...panel.scene, nodes: panel.scene.nodes.map(node => node.id === "tree" ? { ...node, transformations: [...node.transformations, { ...node.transformations[1], id: "copy" }] } : node) }));
});

test("objects stack semantic transformations exactly like collections", () => {
  const panel = { ...createSketchPanel(), scene: sampleScene() };
  assert.equal(panel.scene.nodes[1].kind, "object");
  const added = { ...panel, ...ops.addTransformation(panel, "orb", "Glow") };
  const glow = added.scene.nodes[1].transformations[1].id;
  const filled = { ...added, ...ops.addAlgorithmProperty(added, "orb", "sine-wave", glow) };
  const orb = filled.scene.nodes[1];
  assert.deepEqual(orb.transformations.map(item => [item.label, item.properties.map(property => property.id)]), [["Pulse", ["radius", "speed"]], ["Glow", ["sine-wave"]]]);
  assert.ok(sceneBindings(filled.scene).some(binding => binding.key === "orb/sine-wave/amplitude"));
  // The object's state machine keeps working across its stack: states still address properties by id.
  assert.equal((stateProperties(orb, "moving").find(property => property.id === "radius")!.value as { value: number }).value, 80);
});
