import test from "node:test";
import assert from "node:assert/strict";
import { run, sampleScene, sceneProgram } from "./fixtures/scene";
import { connectScene } from "../app/server/scene-code.server";
import { programModules, sceneInstances } from "../app/lib/scene/machines";
import { sceneLiveStatus } from "../app/lib/scene/live";
import { stampModule } from "../app/lib/scene/stamp";
import { brushesFor, markBrushes } from "../app/lib/brushes";
import { createSketchPanel } from "../app/lib/sketch-panels";
import { applyBrush, brushModule } from "../app/studio/brush-actions";

const generated = () => connectScene({ title: "Tree", explanation: "나무", code: sceneProgram }, sampleScene());
const moduleOf = (code: string) => ({ key: "tree", text: programModules(code).get("tree")! });

test("a brush stamps into an empty frame and runs its own module at once, without new code", () => {
  const source = sampleScene(), code = generated().code;
  const result = stampModule({ scene: { algorithms: [], nodes: [] }, generated: null }, source, "tree", moduleOf(code), [{ x: .3, y: .5 }, { x: .7, y: .5 }], "Tree");
  assert.equal(result.roots.length, 2);
  assert.deepEqual([...programModules(result.generated.code).keys()], ["tree"], "one module, two instances");
  assert.equal(sceneLiveStatus(result.generated, result.scene), "live");
  assert.deepEqual(sceneInstances(result.scene).map(item => item.module), ["tree", "tree"]);
  const sketch = run(result.generated.code); sketch.draw();
  assert.equal(sketch.circles.length, 2, "both stamps draw");
  assert.equal(sketch.lines.length, 10);
});

test("stamping into a frame with its own program keeps its modules; a different module with the same key is renamed", () => {
  const source = sampleScene(), code = generated().code;
  const target = { scene: source, generated: generated() };
  const same = stampModule(target, source, "tree", moduleOf(code), [{ x: .2, y: .2 }], "Tree");
  assert.deepEqual([...programModules(same.generated.code).keys()], ["tree"], "the same module is reused");
  const other = { key: "tree", text: moduleOf(code).text.replace("p.stroke(m.v(\"tree/ink\"));", "p.stroke(m.v(\"tree/ink\")); // thicker") };
  const renamed = stampModule(target, source, "tree", other, [{ x: .2, y: .2 }], "Tree");
  assert.deepEqual([...programModules(renamed.generated.code).keys()], ["tree", "tree~2"]);
  assert.equal(renamed.scene.nodes.find(node => node.id === renamed.roots[0])?.codeModule, "tree~2");
  const sketch = run(renamed.generated.code); sketch.draw();
  assert.equal(sketch.circles.length, 2);
  assert.throws(() => stampModule({ scene: source, generated: { ...generated(), code: "p.setup = () => {};" } }, source, "tree", moduleOf(code), [{ x: .5, y: .5 }], "Tree"), /이전 형식/);
});

test("using a brush never calls AI: the module comes from the source frame's program", () => {
  const scene = sampleScene(), [brush] = brushesFor(scene, "sketch-a", [], () => "brush-1");
  const panels: Record<string, ReturnType<typeof createSketchPanel>> = {
    "sketch-a": { ...createSketchPanel({ scene: markBrushes(scene, [brush]) }), generated: generated() },
    "sketch-b": createSketchPanel(),
  };
  const requests: string[] = [];
  const deps = {
    panel: (id: string) => panels[id], artwork: (id: string) => panels[id] ? { name: id, photo: null, strokes: [], revision: 0 } : undefined,
    updatePanel: (id: string, patch: any) => { panels[id] = { ...panels[id], ...(typeof patch === "function" ? patch(panels[id]) : patch) }; },
    request: async (intent: string) => { requests.push(intent); return {}; }, task: async () => {}, activate: () => {}, toast: () => {}, focus: () => {},
  } as any;
  assert.ok(brushModule(deps, brush));
  applyBrush(deps, brush, "sketch-b", [{ x: 450, y: 300, t: 0 }]);
  assert.deepEqual(requests, []);
  const target = panels["sketch-b"];
  assert.equal(target.scene.nodes.filter(node => node.brushId === brush.id).length, 1, "the stamp stays inspectable as the brush");
  assert.ok(target.generated && programModules(target.generated.code).has("tree"));
  applyBrush(deps, brush, "sketch-b", [{ x: 100, y: 300, t: 0 }, { x: 800, y: 300, t: 500 }]);
  assert.ok(panels["sketch-b"].scene.nodes.filter(node => node.brushId === brush.id).length > 2, "a stroke stamps along the path");
  assert.deepEqual(requests, []);
  // Without code in the source frame and no saved module, nothing is made.
  const bare = { ...brush, code: "" };
  panels["sketch-a"] = { ...panels["sketch-a"], generated: null };
  assert.equal(brushModule(deps, bare), null);
});
