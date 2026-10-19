import test from "node:test";
import assert from "node:assert/strict";
import { run, sampleScene, sceneProgram } from "./fixtures/scene";
import { connectScene } from "../app/server/scene-code.server";
import { programModules, sceneInstances } from "../app/lib/scene/machines";
import { sceneLiveStatus } from "../app/lib/scene/live";
import { stampModule } from "../app/lib/scene/stamp";
import { sceneValues } from "../app/lib/scene/values";
import { brushesFor, brushNodeIds, markBrushes } from "../app/lib/brushes";
import { createSketchPanel } from "../app/lib/sketch-panels";
import { brushModule, placeBrush } from "../app/studio/brush-actions";

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
    request: async (intent: string) => { requests.push(intent); return {}; }, task: async () => {}, activate: () => {}, toast: () => {}, focus: () => {}, preview: () => undefined,
  } as any;
  assert.ok(brushModule(deps, brush));
  assert.equal(placeBrush(deps, brush, "sketch-b", { x: 450, y: 300 }), true);
  assert.deepEqual(requests, []);
  const target = panels["sketch-b"];
  assert.equal(target.scene.nodes.filter(node => node.brushId === brush.id).length, 1, "the stamp stays inspectable as the brush");
  assert.ok(target.generated && programModules(target.generated.code).has("tree"));
  // A frame that has the brush is not stamped again: the brush plays with it instead.
  assert.equal(placeBrush(deps, brush, "sketch-b", { x: 100, y: 300 }), true);
  assert.equal(panels["sketch-b"].scene, target.scene, "nothing added");
  assert.equal(placeBrush(deps, brush, "sketch-a", { x: 100, y: 300 }), true, "the master's frame has it too");
  panels["sketch-c"] = createSketchPanel({ scene: target.scene });
  assert.equal(placeBrush(deps, brush, "sketch-c", { x: 100, y: 300 }), false, "it has the brush but no result to play with");
  assert.match(panels["sketch-c"].error, /결과를 먼저 생성/);
  assert.equal(panels["sketch-c"].scene.nodes.length, target.scene.nodes.length);
  assert.deepEqual(requests, []);
  // Without code in the source frame and no saved module, nothing is made.
  const bare = { ...brush, code: "" };
  panels["sketch-a"] = { ...panels["sketch-a"], generated: null };
  assert.equal(brushModule(deps, bare), null);
});

test("a brush whose source frame was deleted still stamps inspectable copies (and older unmarked stamps are recognised)", () => {
  const scene = sampleScene(), [brush] = brushesFor(scene, "gone", [], () => "brush-1");
  const saved = { ...brush, code: moduleOf(generated().code).text };
  const panels: Record<string, ReturnType<typeof createSketchPanel>> = { "sketch-b": createSketchPanel() };
  const deps = {
    panel: (id: string) => panels[id], artwork: (id: string) => panels[id] ? { name: id, photo: null, strokes: [], revision: 0 } : undefined,
    updatePanel: (id: string, patch: any) => { panels[id] = { ...panels[id], ...(typeof patch === "function" ? patch(panels[id]) : patch) }; },
    request: async () => ({}), task: async () => {}, activate: () => {}, toast: () => {}, focus: () => {}, preview: () => undefined,
  } as any;
  placeBrush(deps, saved, "sketch-b", { x: 450, y: 300 });
  const target = panels["sketch-b"].scene;
  assert.equal(target.nodes.filter(node => node.brushId === brush.id).length, 1, "the copy carries the brush mark");
  assert.ok(brushNodeIds(target, brush, "sketch-b").length > 1, "inspection finds the stamp and its members");
  const unmarked = { ...target, nodes: target.nodes.map(({ brushId: _drop, ...node }) => node) };
  assert.ok(brushNodeIds(unmarked, brush, "sketch-b").includes("tree"), "an older unmarked stamp is recognised by the brush's node id");
});

test("adding a brush to a frame whose result is running injects its module in place: no reload, no server wait when prepared ahead", async () => {
  const { rememberPrepared, preparedFor } = await import("../app/lib/prepared");
  const { prepareCode } = await import("../app/server/code.server");
  const scene = sampleScene(), [brush] = brushesFor(scene, "sketch-a", [], () => "brush-hot");
  const other = { algorithms: scene.algorithms, nodes: [{ ...scene.nodes[0], id: "rock", name: "Rock", brushId: undefined, codeModule: undefined }] };
  const rock = stampModule({ scene: { algorithms: [], nodes: [] }, generated: null }, other, "rock", { key: "rock", text: moduleOf(generated().code).text.replaceAll("\"tree", "\"rock") }, [{ x: .5, y: .5 }], "Rock");
  const panels: Record<string, ReturnType<typeof createSketchPanel>> = {
    "sketch-a": { ...createSketchPanel({ scene: markBrushes(scene, [brush]) }), generated: generated() },
    "sketch-b": { ...createSketchPanel({ scene: rock.scene }), generated: rock.generated, executable: prepareCode(rock.generated.code), preparedCode: rock.generated.code },
  };
  const injected: string[] = [];
  const deps = {
    panel: (id: string) => panels[id], artwork: (id: string) => panels[id] ? { name: id, photo: null, strokes: [], revision: 0 } : undefined,
    updatePanel: (id: string, patch: any) => { panels[id] = { ...panels[id], ...(typeof patch === "function" ? patch(panels[id]) : patch) }; },
    request: async () => ({}), task: async () => {}, activate: () => {}, toast: () => {}, focus: () => {},
    preview: () => ({ isReadyFor: () => true, inject: (module: string) => injected.push(module) }),
  } as any;
  // Prepared ahead (what hovering the frame with the brush tool does), here without the server.
  const ahead = stampModule(panels["sketch-b"], markBrushes(scene, [brush]), "tree", moduleOf(generated().code), [{ x: .5, y: .5 }], "Tree").generated.code;
  rememberPrepared(ahead, prepareCode(ahead));
  assert.equal(placeBrush(deps, brush, "sketch-b", { x: 200, y: 200 }), true);
  const after = panels["sketch-b"];
  assert.equal(injected.length, 1); assert.match(injected[0], /^\/\/ @rulegen-module "tree"\nrulegenModule\("tree"/); assert.match(injected[0], /__rulegenGuard\(\)/, "the injected module is the prepared (guarded) one");
  assert.equal(after.preparedCode, after.generated!.code, "the frame takes the prepared program at once"); assert.equal(after.executable, preparedFor(after.generated!.code));
  assert.ok(after.scene.nodes.some(node => node.brushId === brush.id));
});

test("deleting a brush stamp keeps the frame's program live (no Update needed), and so does undoing it or a stamp", async () => {
  const { sceneEdits } = await import("../app/studio/scene-actions");
  const { relinkStamps } = await import("../app/lib/scene/live");
  const source = sampleScene(), code = generated().code;
  const two = stampModule({ scene: { algorithms: [], nodes: [] }, generated: null }, source, "tree", moduleOf(code), [{ x: .3, y: .5 }, { x: .7, y: .5 }], "Tree");
  const panels: Record<string, ReturnType<typeof createSketchPanel>> = { f: { ...createSketchPanel({ scene: two.scene }), generated: two.generated } };
  const deps = { panel: (id: string) => panels[id], updatePanel: (id: string, patch: any) => { panels[id] = { ...panels[id], ...(typeof patch === "function" ? patch(panels[id]) : patch) }; } } as any;
  const edits = sceneEdits(deps, "f");
  edits.removeIds([two.roots[1]]);
  assert.equal(panels.f.scene.nodes.filter(node => !node.parentId).length, 1);
  assert.equal(sceneLiveStatus(panels.f.generated, panels.f.scene), "live", "the other stamp keeps running, nothing to update");
  assert.equal(sceneInstances(panels.f.scene).length, 1);
  edits.undo();
  assert.equal(sceneLiveStatus(panels.f.generated, panels.f.scene), "live", "undo brings the stamp back, run by its module");
  edits.removeIds(two.roots);
  assert.equal(panels.f.scene.nodes.length, 0); assert.equal(sceneLiveStatus(panels.f.generated, panels.f.scene), "live");
  assert.ok(programModules(panels.f.generated!.code).has("tree"), "the module stays, so adding the brush again is instant");
  // Any other structural change still needs new code.
  const machine = source.nodes.find(node => node.machine)!.machine;
  const changed = { ...two.scene, nodes: two.scene.nodes.filter(node => node.id !== two.roots[1] && node.parentId !== two.roots[1]).map(node => node.id === two.roots[0] ? { ...node, machine } : node) };
  assert.equal(relinkStamps(two.generated, two.scene, changed), two.generated, "a new state machine on a stamp that was there is not covered");
});

test("an applied recommendation can be undone and redone as a whole (scene and code together)", async () => {
  const { applyRecommendation, appliedCurrent, stepApplied } = await import("../app/studio/inspection-actions");
  const scene = sampleScene(), gen = generated();
  const panels: Record<string, ReturnType<typeof createSketchPanel>> = { f: { ...createSketchPanel({ scene }), generated: gen, codeDraft: gen.code } };
  const deps = { panel: (id: string) => panels[id], updatePanel: (id: string, patch: any) => { panels[id] = { ...panels[id], ...(typeof patch === "function" ? patch(panels[id]) : patch) }; }, refreshBrushCode: () => {} } as any;
  const key = Object.keys(sceneValues(scene)).find(item => item.startsWith("tree/") && typeof sceneValues(scene)[item] === "number" && !item.includes("/@"))!;
  const original = sceneValues(scene)[key] as number;
  await applyRecommendation(deps, "f", { kind: "value", nodeId: "tree", targetId: "x", targetIds: [], title: "더 크게", detail: "d", changes: [{ key, stateId: "", value: original + 1 }] });
  assert.equal(sceneValues(panels.f.scene)[key], original + 1);
  assert.equal(panels.f.applied.past.length, 1); assert.equal(appliedCurrent(panels.f, "undo"), true);
  // As if AI had also rewritten the code with it.
  panels.f.applied.past[0].after = { ...panels.f.applied.past[0].after, generated: { ...gen, code: gen.code + "\n// new" } };
  panels.f = { ...panels.f, generated: panels.f.applied.past[0].after.generated };
  assert.equal(stepApplied(deps, "f", "undo")?.title, "더 크게");
  assert.equal(sceneValues(panels.f.scene)[key], original); assert.equal(panels.f.generated!.code, gen.code, "the code goes back too");
  assert.equal(panels.f.applied.future.length, 1); assert.equal(panels.f.applied.past.length, 0);
  stepApplied(deps, "f", "redo");
  assert.equal(sceneValues(panels.f.scene)[key], original + 1); assert.match(panels.f.generated!.code, /\/\/ new$/);
  // A later edit makes undo ask first (it would drop that edit too).
  panels.f = { ...panels.f, composePrompt: "changed later" };
  assert.equal(appliedCurrent(panels.f, "undo"), false);
});
