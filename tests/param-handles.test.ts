import test, { after } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { num, sampleScene, withMockedAI } from "./fixtures/scene";
import { applyHandles, CELL_HEADER, handleFits, handleSuggestionsSchema, keepHandles, proxyCells, setHandle, settleHandles } from "../app/lib/scene/handles";
import { findNode } from "../app/lib/scene/graph";
import { sceneSchema } from "../app/lib/scene/validate";
import { findParam } from "../app/lib/scene/constraints";
import { sceneLiveStatus } from "../app/lib/scene/live";
import { settleProposal } from "../app/lib/scene/revisions";
import { requestSchema } from "../app/lib/schema";
import { projectSchema } from "../app/lib/project";
import { proxyRuntime, type ProxyCell } from "../app/lib/proxy-runtime";
import { runAI } from "../app/server/ai.server";
import { prepareHandle } from "../app/server/code.server";
import { proxyCellsFor, ProxyFrame } from "../app/components/proxy-frame";
import { ConstraintInspector } from "../app/components/scene/constraint-inspector";
import type { ParamHandle, SceneNode } from "../app/lib/scene/schema";

const logDirectory = mkdtempSync(path.join(tmpdir(), "rulegen-handles-"));
const previousLogDirectory = process.env.RULEGEN_AI_LOG_DIR;
process.env.RULEGEN_AI_LOG_DIR = logDirectory;
after(() => { rmSync(logDirectory, { recursive: true, force: true }); if (previousLogDirectory === undefined) delete process.env.RULEGEN_AI_LOG_DIR; else process.env.RULEGEN_AI_LOG_DIR = previousLogDirectory; });

const noop = () => {};
/** A pull-the-tip widget for a number: x across the widget sets the value. */
const pullWidget = `rulegenHandle(function (h) {
  return {
    draw() { p.line(0, h.h / 2, h.ratio('') * h.w, h.h / 2); },
    dragged() { h.setRatio('', h.mouseX / h.w); },
  };
});`;
const widget = (code = pullWidget, paths: string[][] = [[]]): ParamHandle => ({ code, prepared: prepareHandle(code), paths, hint: "끌어서 크기" });

test("a param's handle is its own widget, saved with the scene; an older or broken handle is dropped", () => {
  const scene = sampleScene();
  const withHandle = setHandle(scene, "orb", "radius", widget());
  const parsed = sceneSchema.parse(JSON.parse(JSON.stringify(withHandle)));
  assert.equal(findParam(findNode(parsed, "orb")!, "radius")!.handle!.hint, "끌어서 크기");
  assert.match(findParam(findNode(parsed, "orb")!, "radius")!.handle!.prepared, /__rulegenGuard/, "the stored widget runs guarded");
  const old = { ...scene, nodes: scene.nodes.map(node => node.id === "orb" ? { ...node, constraints: node.constraints.map(item => ({ ...item, params: item.params.map(p => p.id === "radius" ? { ...p, handle: { metaphor: "stretch", anchor: { x: .5, y: .5 } } } : p) })) } : node) };
  assert.equal(findParam(findNode(sceneSchema.parse(old), "orb")!, "radius")!.handle, undefined, "the earlier metaphor handles do not block opening a project");
  assert.equal(findParam(findNode(setHandle(withHandle, "orb", "radius", null), "orb")!, "radius")!.handle, undefined);
});

test("handles are UI only: the code stays live, and they survive regeneration while their scalars exist", () => {
  const scene = sampleScene(), generated = { title: "t", code: "/* @rulegen-scene */", sceneBindings: [], machineSignature: "[]" } as never;
  const withHandles = setHandle(setHandle(scene, "tree", "structure", widget(pullWidget, [[]])), "tree", "ink", widget(pullWidget, [[]]));
  assert.equal(sceneLiveStatus(generated, withHandles), sceneLiveStatus(generated, scene));
  const node = findNode(withHandles, "tree")!;
  const regenerated: SceneNode = { ...node, constraints: node.constraints.map(item => ({ ...item, params: item.params.map(({ handle: _gone, ...rest }) => rest) })) };
  assert.deepEqual(keepHandles(node, regenerated), node, "same param ids and scalars: handles come back");
  const swapped: SceneNode = { ...regenerated, constraints: regenerated.constraints.map(item => ({ ...item, params: item.params.map(p => p.id === "structure" ? { ...p, value: num(3, 1, 9) } : p) })) };
  assert.ok(findParam(keepHandles(node, swapped), "structure")!.handle, "a new value of the same param keeps its widget");
  const renamed: SceneNode = { ...regenerated, constraints: regenerated.constraints.map(item => ({ ...item, params: item.params.map(p => p.id === "structure" ? { ...p, id: "levels" } : p) })) };
  assert.equal(findParam(keepHandles(node, renamed), "levels")!.handle, undefined, "a widget whose param is gone is dropped");
  assert.equal(handleFits({ ...findParam(swapped, "structure")!, handle: findParam(node, "structure")!.handle }), true);
  assert.ok(findParam(findNode(settleProposal(withHandles, scene), "tree")!, "ink")!.handle, "a revision proposal keeps them");
});

test("widget code is guarded like sketch code and may not take over the frame", () => {
  assert.throws(() => prepareHandle("p.ellipse(0, 0, 10, 10);"), /rulegenHandle/);
  assert.throws(() => prepareHandle("rulegenHandle(function (h) { p.createCanvas(10, 10); return {}; });"), /does not create a canvas/);
  assert.throws(() => prepareHandle("rulegenHandle(function (h) { window.location = 'x'; return {}; });"), /window/);
  assert.match(prepareHandle(pullWidget), /__rulegenGuard\(\)/);
});

test("AI builds one interface per param, with the param's meaning and scalar as context", async () => {
  const scene = sampleScene();
  const output = { handles: [
    { paramId: "structure", paths: [], hint: "가지 끝을 끌어 늘이기", code: pullWidget },
    { paramId: "structure", paths: [], hint: "중복", code: pullWidget },
    { paramId: "ink", paths: [], hint: "먹색", code: "rulegenHandle(function (h) { document.title = 'x'; return {}; });" },
    { paramId: "radius", paths: [], hint: "다른 노드", code: pullWidget },
  ] };
  await withMockedAI(() => output, async calls => {
    const result = handleSuggestionsSchema.parse(await runAI(requestSchema.parse({ intent: "handles", scene, targetNodeId: "tree", targetConstraintId: "branching-growth", image: "data:image/png;base64,AAAA", instruction: "가지를 직접 잡고 싶어" }), new AbortController().signal));
    assert.deepEqual(result.handles.map(item => item.paramId), ["structure"], "duplicates, other constraints' and other nodes' params are dropped");
    assert.deepEqual(result.handles[0].handle.paths, [[]], "the param's one scalar");
    const context = JSON.parse(calls[0].input[0].content[0].text);
    assert.deepEqual(context.params.map((item: { paramId: string }) => item.paramId), ["structure", "base-length", "ratio"], "one constraint's params");
    const structure = context.params[0];
    assert.deepEqual(structure.scalars.map((item: { path: string[]; value: number }) => [item.path.join("/"), item.value]), [["", 5]], "its scalar with its range");
    assert.equal("algorithms" in structure, false);
    assert.equal(context.instruction, "가지를 직접 잡고 싶어");
    assert.ok(context.widgetArea.w > 300 && context.widgetArea.h > 200, "the room each widget gets in the proxy frame");
    assert.match(calls[0].instructions, /bespoke interface per param/);
    const applied = applyHandles(scene, "tree", result.handles);
    assert.equal(findParam(findNode(applied, "tree")!, "structure")!.handle!.hint, "가지 끝을 끌어 늘이기");
    // Later requests carry the scene without widget code.
    await runAI(requestSchema.parse({ intent: "transform", scene: applied, targetNodeId: "tree", targetConstraintId: "ink-wash" }), new AbortController().signal).catch(() => null);
    assert.doesNotMatch(calls[1].input[0].content[0].text, /rulegenHandle/);
  });
  await withMockedAI(() => output, async calls => {
    await assert.rejects(runAI(requestSchema.parse({ intent: "handles", scene, targetNodeId: "tree", targetConstraintId: "ink-wash" }), new AbortController().signal), /Could not run the handle code: .*document/, "a widget using a blocked API is left out with why");
    assert.equal(calls.length, 1);
    // Never the whole node at once: one param or one constraint.
    await assert.rejects(runAI(requestSchema.parse({ intent: "handles", scene, targetNodeId: "tree" }), new AbortController().signal), /one param or one constraint/);
    assert.equal(calls.length, 1, "no AI call for a whole-node request");
  });
  await withMockedAI(() => ({ handles: [{ paramId: "radius", paths: [], hint: "", code: pullWidget }, { paramId: "speed", paths: [], hint: "", code: pullWidget }] }), async calls => {
    const result = handleSuggestionsSchema.parse(await runAI(requestSchema.parse({ intent: "handles", scene, targetNodeId: "orb", targetParamId: "speed" }), new AbortController().signal));
    assert.deepEqual(result.handles.map(item => item.paramId), ["speed"], "a param request designs that param only");
    assert.deepEqual(JSON.parse(calls[0].input[0].content[0].text).params.map((item: { paramId: string }) => item.paramId), ["speed"]);
  });
  await withMockedAI(() => ({ handles: [{ paramId: "ink", paths: [], hint: "", code: "rulegenHandle(function (h) { window.x = 1; return {}; });" }] }), async () => {
    await assert.rejects(runAI(requestSchema.parse({ intent: "handles", scene, targetNodeId: "tree", targetParamId: "ink" }), new AbortController().signal), /Could not run the handle code/);
  });
  assert.deepEqual(settleHandles(findNode(scene, "orb")!, { handles: [{ paramId: "radius", paths: [["missing"]], hint: "", code: pullWidget }] }, { paramId: "radius" }, code => code).handles[0].handle.paths, [[]], "no valid path: all of its scalars");
  assert.deepEqual(settleHandles(findNode(scene, "orb")!, { handles: [{ paramId: "radius", paths: [], hint: "", code: pullWidget }] }, {}, code => code).handles, [], "no target: nothing (never the whole node)");
});

/** Run the proxy runtime against a fake p5 and record what it posts. */
function runProxy(cells: ProxyCell[]) {
  const posted: Record<string, unknown>[] = [], listeners: ((event: { source: unknown; data: unknown }) => void)[] = [], lines: number[][] = [];
  const parent = { postMessage: (message: Record<string, unknown>) => posted.push(JSON.parse(JSON.stringify(message))) };
  const state: Record<string, unknown> = { mouseX: 0, mouseY: 0, pmouseX: 0, pmouseY: 0, line: (...a: number[]) => lines.push(a), millis: () => 0, textWidth: () => 10,
    drawingContext: { save: noop, restore: noop, beginPath: noop, rect: noop, clip: noop } };
  const p = new Proxy(state, { get: (target, key) => key in target ? target[key as string] : typeof key === "string" && key === key.toUpperCase() ? key : noop, set: (target, key, value) => { target[key as string] = value; return true; } });
  class P5 { constructor(sketch: (instance: unknown) => void) { sketch(p); } }
  vm.runInContext(proxyRuntime("tok", cells), vm.createContext({ p5: P5, parent, performance, window: { addEventListener: (_: string, listener: never) => listeners.push(listener) }, console }));
  (state.setup as () => void)(); (state.draw as () => void)();
  return { state, posted, lines, receive: (data: unknown) => listeners.forEach(listener => listener({ source: parent, data })),
    drag: (from: [number, number], to: [number, number]) => {
      // The parent forwards the pointer (the iframe itself takes no input).
      const pointer = (kind: string, [x, y]: [number, number]) => listeners.forEach(listener => listener({ source: parent, data: { channel: "rulegen-proxy-control", token: "tok", type: "pointer", kind, x, y } }));
      pointer("down", from); pointer("move", to); pointer("up", to);
    } };
}

test("the proxy runtime routes a drag to the widget under it and reports coerced values; a broken widget only fails its own cell", () => {
  const [a, b] = proxyCells(2);
  assert.deepEqual(proxyCells(5).map(box => Math.round(box.w)), [281, 281, 281, 281, 281], "5 widgets: a 3-column grid");
  const cells: ProxyCell[] = [
    { id: "radius", label: "Radius", hint: "끌어서 크기", effect: "spatial", box: a, specs: { "": { type: "number", value: 24, min: 10, max: 140, step: 1, unit: "px" } }, code: prepareHandle(pullWidget) },
    { id: "broken", label: "Broken", hint: "", effect: "temporal", box: b, specs: { "": { type: "number", value: 1, min: 0, max: 2, step: .5 } }, code: prepareHandle("rulegenHandle(function (h) { return { draw() { throw new Error('boom'); } }; });") },
  ];
  const proxy = runProxy(cells);
  assert.ok(proxy.posted.some(message => message.type === "ready"));
  assert.deepEqual(proxy.posted.filter(message => message.type === "error").map(message => [message.id, message.error]), [["broken", "boom"]]);
  // Drag across the radius widget to its middle: 10 + .5 * 130 = 75.
  const left = a.x, top = a.y + 34, width = a.w;
  proxy.drag([left + 10, top + 20], [left + width / 2, top + 20]);
  assert.deepEqual(proxy.posted.filter(message => message.type === "set").at(-1), { channel: "rulegen-proxy", token: "tok", type: "set", id: "radius", path: "", value: 75 });
  proxy.drag([left + 10, top + 20], [left + width * 5, top + 20]);
  assert.equal(proxy.posted.filter(message => message.type === "set").at(-1)!.value, 140, "clamped to the range");
  const before = proxy.posted.length;
  proxy.drag([b.x + 10, b.y + 50], [b.x + 100, b.y + 50]);
  assert.equal(proxy.posted.slice(before).filter(message => message.type === "set").length, 0, "the failed widget takes no input");
  proxy.receive({ channel: "rulegen-proxy-control", token: "tok", type: "values", cells: { radius: { "": { type: "number", value: 10, min: 10, max: 140, step: 1, unit: "px" } } } });
  proxy.lines.length = 0; (proxy.state.draw as () => void)();
  assert.equal(proxy.lines[0][2], 0, "values from outside redraw the widget (ratio 0)");
});

test("the proxy frame and the inspector show and edit each param's interface; projects keep proxy frames", () => {
  const scene = setHandle(sampleScene(), "tree", "structure", widget(pullWidget, [[]])), tree = findNode(scene, "tree")!;
  const cells = proxyCellsFor(tree.constraints);
  assert.deepEqual(cells.map(cell => [cell.id, Object.keys(cell.specs)]), [["structure", [""]]], "a widget reads only what it drives");
  assert.match(renderToStaticMarkup(createElement(ProxyFrame, { node: tree, constraints: tree.constraints, targetName: "Sketch 2", busy: "", onSet: noop, onError: noop, onDesign: noop })), /<iframe[^>]*sandbox="allow-scripts"/);
  // Only the widget areas take handle input; the rest of the body (cell titles, gaps) drags the frame on the board.
  const moving = renderToStaticMarkup(createElement(ProxyFrame, { frameId: "proxy-1", node: tree, constraints: tree.constraints, targetName: "Sketch 2", busy: "", onSet: noop, onError: noop, onDesign: noop }));
  assert.match(moving, /class="proxy-move" data-frame-handle="proxy-1"/);
  const [cell] = cells, input = /class="proxy-input" aria-label="[^"]*" style="left:([\d.]+)%;top:([\d.]+)%;width:([\d.]+)%;height:([\d.]+)%"/.exec(moving)!;
  assert.deepEqual(input.slice(1).map(Number).map(v => Math.round(v * 100) / 100), [cell.box.x / 9, (cell.box.y + CELL_HEADER) / 6, cell.box.w / 9, (cell.box.h - CELL_HEADER) / 6].map(v => Math.round(v * 100) / 100), "below the cell's title strip");
  const bare = findNode(sampleScene(), "orb")!;
  const empty = renderToStaticMarkup(createElement(ProxyFrame, { frameId: "proxy-1", node: bare, constraints: bare.constraints, targetName: "Sketch 2", busy: "", onSet: noop, onError: noop, onDesign: noop }));
  assert.match(empty, /class="proxy-frame-surface" data-frame-handle="proxy-1"/, "an empty proxy frame drags from anywhere");
  assert.deepEqual([...empty.matchAll(/Design <b>([^<]*)<\/b>/g)].map(match => match[1]), bare.constraints.map(item => item.property), "an empty proxy frame designs one constraint at a time");
  const props = { node: tree, constraints: tree.constraints, state: undefined, busy: false,
    onHandle: noop, onDesignHandles: noop, onOpenProxy: noop, handleErrors: { structure: "boom" } };
  const inspector = renderToStaticMarkup(createElement(ConstraintInspector, props as never));
  assert.match(inspector, /PROXY HANDLE/); assert.match(inspector, /⚠ boom/); assert.match(inspector, /Fix with AI/); assert.match(inspector, /Widget code/);
  assert.match(inspector, /Design a direct manipulation handle for Ink/); assert.match(inspector, /Open proxy frame/);
  const project = projectSchema.parse({ version: 2, name: "p", artwork: { strokes: [], photo: null, name: "a", revision: 0 }, sketchFrames: [{ id: "sketch-a", artwork: { strokes: [], photo: null, name: "b", revision: 0 } }],
    proxyFrames: [{ id: "proxy-1", targetFrameId: "sketch-a", nodeId: "tree" }, { id: "proxy-2", targetFrameId: "sketch-gone", nodeId: "tree" }] });
  assert.deepEqual(project.proxyFrames.map(frame => frame.id), ["proxy-1"], "a proxy frame goes with its target frame");
  assert.ok(project.workspace.frames["proxy-1"], "and has a place on the board");
});

test("the board draws each proxy frame's link to the frame it controls", async () => {
  const { FreeformWorkspace } = await import("../app/components/freeform-workspace");
  const layout = { camera: { x: 0, y: 0, zoom: .5 }, hiddenFrames: [], frames: { source: { x: 0, y: 0 }, "sketch-a": { x: 1040, y: 0 }, "proxy-1": { x: 2080, y: 0 } }, groups: [], hiddenExamples: [] };
  const frame = (id: string) => ({ id: id as never, title: id, subtitle: "", content: null });
  const html = renderToStaticMarkup(createElement(FreeformWorkspace, { layout, onChange: noop, tool: "select", onDrop: noop, onBackground: noop, highlight: "sketch-a" as never,
    frames: [frame("source"), frame("sketch-a"), frame("proxy-1")], links: [{ from: "proxy-1" as never, to: "sketch-a" as never, label: "◎ 조작" }] }));
  assert.match(html, /class="frame-link highlighted"/); assert.match(html, /◎ 조작/);
  assert.match(html, /M2080 300C/, "from the proxy's facing side…"); assert.match(html, /1940 300"/, "…to the target's");
  assert.match(html, /world-frame link-highlight/);
});
