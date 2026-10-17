import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { sampleScene } from "./fixtures/scene";
import { minimalExampleInstruction, minimalExampleScene } from "../app/lib/scene/minimal-example";
import { sceneSchema } from "../app/lib/scene/validate";
import { sceneBindings } from "../app/lib/scene/values";
import { PropertyInspector } from "../app/components/scene/property-inspector";

test("a minimal example keeps only the chosen transformation, centered, without machines", () => {
  const scene = sampleScene();
  const orb = sceneSchema.parse(minimalExampleScene(scene, "orb", "pulse"));
  assert.deepEqual(orb.nodes.map(node => [node.id, node.kind, node.parentId]), [["collection", "collection", null], ["orb", "object", "collection"]], "an object goes inside a plain collection");
  assert.deepEqual(orb.nodes[1].transformations.map(item => item.id), ["pulse"]);
  assert.deepEqual(orb.nodes[0].transformations, []);
  assert.ok(orb.nodes.every(node => node.machine === null));
  const r = orb.nodes[1].region;
  assert.ok(Math.abs(r.x + r.w / 2 - .5) < 1e-9 && Math.abs(r.y + r.h / 2 - .5) < 1e-9, "centered");
  assert.deepEqual(sceneBindings(orb).map(binding => binding.key).sort(), ["orb/radius", "orb/speed"]);

  const tree = scene.nodes.find(node => node.id === "tree")!;
  const only = sceneSchema.parse(minimalExampleScene(scene, "tree", "ink-wash"));
  assert.deepEqual(only.nodes.find(node => node.id === "tree")!.transformations.map(item => item.id), ["ink-wash"]);
  assert.ok(only.algorithms.length < scene.algorithms.length || tree.transformations.length === 1, "only the algorithms this transformation uses");
  for (const algorithm of only.algorithms) assert.ok(scene.algorithms.some(item => item.id === algorithm.id));
  assert.throws(() => minimalExampleScene(scene, "orb", "missing"), /찾지 못했습니다/);
  assert.match(minimalExampleInstruction(tree, "ink-wash"), /minimal example/);
});

test("collections keep one plain member inside their new box", () => {
  const base = sampleScene();
  const scene = { ...base, nodes: [
    { ...base.nodes[1], id: "ring", kind: "collection" as const, primitive: "group", machine: null, region: { x: .1, y: .1, w: .4, h: .4 } },
    { ...base.nodes[1], id: "dot", parentId: "ring", machine: null, region: { x: .2, y: .2, w: .1, h: .1 } },
    { ...base.nodes[1], id: "dot-2", parentId: "ring", machine: null, region: { x: .3, y: .3, w: .1, h: .1 } },
  ] };
  const example = sceneSchema.parse(minimalExampleScene(scene, "ring", "pulse"));
  assert.deepEqual(example.nodes.map(node => node.id), ["ring", "dot"]);
  const [ring, dot] = example.nodes;
  assert.equal(dot.parentId, "ring"); assert.deepEqual(dot.transformations, []);
  assert.ok(dot.region.x >= ring.region.x && dot.region.x + dot.region.w <= ring.region.x + ring.region.w + 1e-9);
  assert.ok(dot.region.y >= ring.region.y && dot.region.y + dot.region.h <= ring.region.y + ring.region.h + 1e-9);
  const empty = sceneSchema.parse(minimalExampleScene({ ...scene, nodes: [scene.nodes[0]] }, "ring", "pulse"));
  assert.deepEqual(empty.nodes.map(node => [node.kind, node.parentId]), [["collection", null], ["object", "ring"]], "an empty collection gets one plain object");
});

test("each semantic transformation card offers Create Minimal Example", () => {
  const scene = sampleScene(), node = scene.nodes.find(item => item.id === "tree")!;
  const noop = () => {};
  const props = new Proxy({ node, transformations: node.transformations, state: null, busy: false, library: scene.algorithms, onMinimalExample: noop } as Record<string, unknown>, { get: (target, key) => key in target ? target[key as string] : noop });
  const html = renderToStaticMarkup(createElement(PropertyInspector, props as never));
  assert.equal(html.match(/Create Minimal Example/g)?.length, node.transformations.length);
});

test("regenerating opens a composer with what is attached, a text box and drawing on the frame", () => {
  const scene = sampleScene(), node = scene.nodes.find(item => item.id === "tree")!, noop = () => {};
  const render = (draft: unknown) => renderToStaticMarkup(createElement(PropertyInspector, new Proxy({ node, transformations: node.transformations, state: null, busy: false, library: scene.algorithms, draft } as Record<string, unknown>,
    { get: (target, key) => key in target ? target[key as string] : noop }) as never));
  assert.doesNotMatch(render(null), /REGENERATE WITH AI/, "nothing runs or opens until a regenerate button is pressed");
  const html = render({ nodeId: "tree", target: { transformationId: "ink-wash" }, instruction: "", annotating: false, marks: [] });
  assert.equal(html.match(/REGENERATE WITH AI/g)?.length, 1);
  assert.match(html, /<b>Transformation<\/b>[^<]*첨부됨/); assert.match(html, /Draw on frame/); assert.match(html, /aria-label="How to regenerate"/);
  const drawn = render({ nodeId: "tree", target: {}, instruction: "흔들리게", annotating: true, marks: [[{ x: .1, y: .1 }, { x: .2, y: .2 }]] });
  assert.match(drawn, /<b>New transformation<\/b>/); assert.match(drawn, /Annotation<\/b>1획 첨부됨/); assert.match(drawn, /Done drawing/);
});

test("the bottom panel (code, state machine, inspection) has a height handle on its top edge", async () => {
  const { RawCodePanel } = await import("../app/components/raw-code-panel");
  const html = renderToStaticMarkup(createElement(RawCodePanel, { code: "p.circle(1,1,1);", sketchName: "A", fileName: "a", onCopy: () => {}, onError: () => {} }));
  assert.match(html, /role="separator" aria-orientation="horizontal" aria-label="Resize bottom panel"/);
});
