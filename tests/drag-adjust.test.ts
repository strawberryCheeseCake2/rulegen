import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { aiScene, num, sampleScene } from "./fixtures/scene";
import { convertScene } from "../app/lib/scene/convert";
import { sceneSchema } from "../app/lib/scene/validate";
import { dragLinks, keptDrags, placeConstraint, setDragOff } from "../app/lib/scene/constraints";
import { draggedValue, dragTargets, FULL_SPEED, nodeBox, nodeToAdjust, smoothedSpeed } from "../app/lib/scene/drag-adjust";
import { coerceScalar } from "../app/lib/scene/values";
import type { SceneNode, Constraint, ValueDrag } from "../app/lib/scene/schema";
import { ConstraintInspector, type ConstraintInspectorProps } from "../app/components/scene/constraint-inspector";
import { DragAdjustLayer } from "../app/components/scene/drag-adjust";
import { loadPrompt } from "../app/server/prompts.server";

const noop = () => {};
const handlers = new Proxy({}, { get: () => noop }) as Record<string, () => void>;
const drag = (paramId: string, path: string, source: ValueDrag["source"], mode: ValueDrag["mode"] = "ratio", invert = false): ValueDrag => ({ paramId, path, source, mode, invert, how: `${source} ${paramId}` });
/** The sample scene with drags: the tree's base length and depth, the orb's radius and speed. */
function draggable() {
  const ai = structuredClone(aiScene);
  ai.nodes[0].constraints[0].drags = [drag("structure", "length/base", "y", "direct"), drag("structure", "depth", "x"),
    // Dropped: an attribute taken, a value twice, a color, a param of another constraint, a path to nothing.
    drag("structure", "depth", "speed"), drag("structure", "length/base", "speed")];
  ai.nodes[0].constraints[1].drags = [drag("ink", "", "x"), drag("radius", "", "y")];
  ai.nodes[1].constraints[0].drags = [drag("radius", "", "speed"), drag("speed", "", "x", "range"), drag("radius", "nope", "y")];
  ai.nodes[1].constraints[1].drags = [drag("speed", "", "x", "range")];
  return convertScene(ai);
}

test("each constraint maps its numbers to the mouse's x, y or speed while dragging its object; what cannot be mapped is dropped", () => {
  const scene = draggable(), tree = scene.nodes[0], orb = scene.nodes[1];
  assert.deepEqual(tree.constraints[0].drags?.map(item => [item.paramId, item.path, item.source]), [["structure", "length/base", "y"], ["structure", "depth", "x"]],
    "a nested number by its path; an attribute once and a value once per constraint (at most two)");
  assert.deepEqual(tree.constraints[1].drags, [], "a color, or another constraint's value, is not mapped");
  assert.deepEqual(orb.constraints[0].drags?.map(item => [item.paramId, item.source]), [["radius", "speed"]], "the speed is not this constraint's");
  assert.deepEqual(orb.constraints[1].drags?.map(item => [item.paramId, item.source]), [["speed", "x"]]);
  // Saved and loaded with the scene; an older scene has none.
  assert.deepEqual(sceneSchema.parse(JSON.parse(JSON.stringify(scene))).nodes[1].constraints[0].drags, orb.constraints[0].drags);
  assert.equal(sampleScene().nodes[1].constraints[0].drags?.length ?? 0, 0);
  // Turned off and on; off stays off when its constraint is made again; ids renamed while placing follow.
  const off = setDragOff(orb, "pulse", 0, true);
  assert.equal(off.constraints[0].drags?.[0].off, true); assert.equal(setDragOff(off, "pulse", 0, false).constraints[0].drags?.[0].off, undefined);
  const again = placeConstraint(off, { ...orb.constraints[0], drags: [drag("radius", "", "y")] }, { constraintId: "pulse" });
  assert.equal(again.constraints[0].drags?.[0].off, true, "the user's choice is kept");
  const renamed = keptDrags({ ...orb.constraints[0], params: [{ ...orb.constraints[0].params[0], id: "radius-2" }], drags: [drag("radius", "", "x")] }, new Map([["radius", "radius-2"]]));
  assert.equal(renamed[0].paramId, "radius-2");
  // On the object: those on, each attribute once over the whole stack (the first constraint's).
  const stack: Constraint[] = [{ ...tree.constraints[0] }, { id: "other", property: "Other", description: "",
    params: [{ id: "lean", label: "Lean", effect: "spatial", description: "", value: num(0, -45, 45, 1, "°") }, { id: "splash", label: "Splash", effect: "stylistic", description: "", value: num(0, 0, 90, 1, "px") }],
    drags: [drag("lean", "", "x", "range"), drag("splash", "", "speed")] }];
  assert.deepEqual(dragLinks(stack, true).map(item => `${item.constraintId}:${item.source}`), ["branching-growth:y", "branching-growth:x", "other:speed"]);
  assert.deepEqual(dragLinks(stack.map((item, i) => i ? item : { ...item, drags: item.drags!.map((entry, j) => j === 1 ? { ...entry, off: true } : entry) }), true).map(item => `${item.constraintId}:${item.source}`),
    ["branching-growth:y", "other:x", "other:speed"], "turned off, its attribute goes to the next value mapped to it");
});

test("x moves a value by how far right, y by how far up, speed from still to a fast stroke", () => {
  const box = { x: 100, y: 100, w: 200, h: 100 }, start = num(50, 0, 400, 1, "px"), from = { x: 150, y: 150 };
  // x: right is more; by the pixels, in proportion (the object's width: twice), or over the range across the width.
  assert.equal(draggedValue(drag("a", "", "x", "direct"), start, box, from, { x: 210, y: 150 }, 0), 110);
  assert.equal(draggedValue(drag("a", "", "x", "ratio"), start, box, from, { x: 350, y: 150 }, 0), 100);
  assert.equal(draggedValue(drag("a", "", "x", "range"), start, box, from, { x: 250, y: 150 }, 0), 250);
  assert.equal(draggedValue(drag("a", "", "x", "direct", true), start, box, from, { x: 210, y: 150 }, 0), -10, "reversed: right is less (then kept to its range)");
  // y: up is more (the canvas runs down), against the object's height (at least 60 px).
  assert.equal(draggedValue(drag("a", "", "y", "direct"), start, box, from, { x: 150, y: 110 }, 0), 90);
  assert.equal(draggedValue(drag("a", "", "y", "ratio"), start, box, from, { x: 150, y: 50 }, 0), 100);
  // Speed: still is the bottom of the range, a fast stroke the top; it does not depend on where the mouse is.
  assert.equal(draggedValue(drag("a", "", "speed"), start, box, from, { x: 999, y: 999 }, 0), 0);
  assert.equal(draggedValue(drag("a", "", "speed"), start, box, from, from, FULL_SPEED / 2), 200);
  assert.equal(draggedValue(drag("a", "", "speed", "ratio", true), start, box, from, from, FULL_SPEED * 3), 0, "reversed: fast is least");
  assert.equal(coerceScalar(start, draggedValue(drag("a", "", "y", "direct"), start, box, from, { x: 150, y: -900 }, 0)).value, 400, "kept to its range");
  // The speed is smoothed as the mouse moves (canvas px per ms).
  const s1 = smoothedSpeed(0, { x: 0, y: 0, t: 0 }, { x: 60, y: 0, t: 60 });
  assert.equal(s1, 1); assert.ok(smoothedSpeed(s1, { x: 60, y: 0, t: 60 }, { x: 60, y: 0, t: 76 }) < s1, "slowing down lowers it");
});

test("pressing a drawn object adjusts that object (the smallest one there with mappings), with the values as it shows them", () => {
  const scene = draggable(), tree = scene.nodes[0], orb = scene.nodes[1];
  assert.deepEqual(nodeBox(orb), { x: 405, y: 120, w: 90, h: 60 });
  assert.equal(nodeToAdjust(scene, { x: 450, y: 150 })?.id, "orb", "inside both: the smaller");
  assert.equal(nodeToAdjust(scene, { x: 300, y: 400 })?.id, "tree");
  assert.equal(nodeToAdjust(scene, { x: 20, y: 20 }), null);
  assert.equal(nodeToAdjust({ ...scene, nodes: scene.nodes.map(node => ({ ...node, visible: node.id !== "orb" })) }, { x: 450, y: 150 })?.id, "tree", "a hidden object is not adjusted");
  assert.deepEqual(dragTargets(tree).map(item => [item.source, item.param, item.value.value]), [["y", "Branching · length · base", 140], ["x", "Branching · depth", 5]]);
  const moving = { ...orb, constraints: orb.constraints.map(item => ({ ...item, params: item.params.map(param => param.id === "radius" ? { ...param, value: num(80, 10, 140, 1, "px") } : param) })) };
  assert.equal(dragTargets(orb, moving.constraints)[0].value.value, 80, "as a state shows it");
  const allOff: SceneNode = setDragOff(setDragOff(orb, "pulse", 0, true), "drift", 0, true);
  assert.deepEqual(dragTargets(allOff), []);
  const layer = renderToStaticMarkup(createElement(DragAdjustLayer, { scene, zoom: 1, stack: (node: SceneNode) => node.constraints, onStart: noop, onValue: noop, onEnd: noop }));
  assert.match(layer, /<svg class="drag-adjust "[^>]*viewBox="0 0 900 600"[^>]*aria-label="Drag on a drawn object: the mouse&#x27;s x, y and speed adjust its values"/);
});

test("the inspector lists which value the mouse's x, y and speed move, each on or off; the param says it too; AI is asked for the metaphor", () => {
  const scene = draggable(), orb = setDragOff(scene.nodes[1], "drift", 0, true);
  const html = renderToStaticMarkup(createElement(ConstraintInspector, { ...handlers, onDragOff: noop, node: orb, constraints: orb.constraints, library: scene.algorithms, state: undefined, busy: false, clip: null } as unknown as ConstraintInspectorProps));
  assert.match(html, /aria-label="Drag to adjust"><span class="inspector-subtitle">DRAG TO ADJUST · 1\/2/);
  assert.match(html, /<b class="pointer-source">≋ mouse speed<\/b>[^]*?size<em> · Radius<\/em>[^]*?<input type="checkbox" aria-label="Drag Radius on the object" checked=""\/>on/);
  assert.match(html, /<li class="off">[^]*?↔ mouse x[^]*?<input type="checkbox" aria-label="Drag Speed on the object"\/>off/);
  assert.match(html, /class="pointer-chip drag-chip "[^>]*>[^]*?≋ mouse speed<\/span>/); assert.match(html, /class="pointer-chip drag-chip off"/);
  const none = sampleScene().nodes[1];
  assert.doesNotMatch(renderToStaticMarkup(createElement(ConstraintInspector, { ...handlers, node: none, constraints: none.constraints, library: scene.algorithms, state: undefined, busy: false, clip: null } as unknown as ConstraintInspectorProps)), /DRAG TO ADJUST/);
  for (const intent of ["extract", "compose", "transform", "split", "revision"] as const) assert.match(loadPrompt(intent), /VALUE DRAG: the mouse's x, y and speed adjust values, as a metaphor/, intent);
  assert.match(readFileSync("app/routes/home.tsx", "utf8"), /tool === "adjust" && owner\.generated/);
});
