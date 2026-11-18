import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { run, sampleScene, sceneProgram, withMockedAI } from "./fixtures/scene";
import { runAI } from "../app/server/ai.server";
import { requestSchema } from "../app/lib/schema";
import { connectScene } from "../app/server/scene-code.server";
import { paramRows, evaluate, layoutBlocks, placeOverlays, targetedResultSchema } from "../app/lib/inspection";
import { behaviorProgram, emptyExploreEdit, exploreProgram, exploreStep, type ExploreFrame } from "../app/lib/explore";
import { alignFixSchema, alignKitSchema, decidedSpecs, describeIdeal, drawnObject, keptSpecs, specColor, specExamples, linkObjects, placedBySpecs, placedValues, respecified, setSpec, specScope, withSpecs, type SpecReader, liftedItem, liftedOnMove, pickedRecord, PICKED_ROOT, readsPicked, emptyIdeal, fitTemplate, labelObjects, mergeObjects, placedOutline, presetState, presetValues, removeObjects, stateChanges, stateToolOf, tagObjects, withMerged, withoutState, withTools, type AlignTool, type IdealState, describeRefs, expandRefs, keptVariables, readVariables, refsIn, type RuntimeVar, applyWidget, behaviorFallbacks, behaviorProbe, behaviorValues, behaviorValuesOf, readsBehavior, codeState, keptWidget, variableCode, widgetRules, widgetStart, widgetValue, type TagWidget } from "../app/lib/alignment";
import { IdealSheet, IdealTools, optionMatches, refAt, refChoices, RefInput, refMatches, specText, VariableMarks, widgetCan, type WidgetControl, TagControl, tagBox, tagTarget, tagBlocks, blockSize, controlSize } from "../app/components/ideal-state";
import { ExploreFrameView } from "../app/components/explore-frame";
import { canvasPerScreen, TagWidgetLayer } from "../app/components/tag-widget";
import { tagWidgetDocument } from "../app/lib/tag-widget-runtime";

const logDirectory = mkdtempSync(path.join(tmpdir(), "rulegen-align-"));
const previousLogDirectory = process.env.RULEGEN_AI_LOG_DIR;
process.env.RULEGEN_AI_LOG_DIR = logDirectory;
after(() => { rmSync(logDirectory, { recursive: true, force: true }); if (previousLogDirectory === undefined) delete process.env.RULEGEN_AI_LOG_DIR; else process.env.RULEGEN_AI_LOG_DIR = previousLogDirectory; });

const signal = () => new AbortController().signal;
const noop = () => {};
const square = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
const behaviorNone = { values: [], patch: null, probe: { x: 0, y: 0, w: 0, h: 0 } };
const tools: AlignTool[] = [
  { id: "leaf", kind: "shape", name: "Leaf", hint: "Drag a box to place a leaf", color: "#1f8a5b", label: "Leaf", closed: true, template: square, labels: [], handles: [], nodeId: "", specs: [], ...behaviorNone },
  { id: "edge", kind: "pen", name: "Boundary", hint: "Draw where it stops", color: "#e07b00", label: "Boundary", closed: false, template: [], labels: [], handles: [], nodeId: "", specs: [], ...behaviorNone },
  { id: "blob", kind: "pen", name: "Own form", hint: "Draw a form", color: "#2563eb", label: "Form", closed: true, template: [], labels: [], handles: [], nodeId: "", specs: [], ...behaviorNone },
  { id: "join", kind: "merge", name: "Merge outlines", hint: "Join the selected forms", color: "#7c3aed", label: "Joined form", closed: false, template: [], labels: [], handles: [], nodeId: "", specs: [], ...behaviorNone },
  { id: "mark", kind: "label", name: "Mark as", hint: "Name it", color: "#7c3aed", label: "", closed: false, template: [], labels: ["Grows", "Removed"], handles: [], nodeId: "", specs: [], ...behaviorNone },
];
const moment = { summary: "잎을 하나씩 놓습니다.", axis: "run", done: 3, count: 8, progress: 3 / 8, last: "잎 3 · 놓기", next: "잎 4 · 놓기", stage: { name: "놓기", explain: "줄기를 따라 놓습니다." } };

test("a shape tool fits its form into the box dragged; pens draw forms or lines; lifting and erasing take what is drawn around; too little is nothing", () => {
  assert.deepEqual(fitTemplate([{ x: 50, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }], { x: 10, y: 20, w: 40, h: 20 }), [{ x: 30, y: 20 }, { x: 50, y: 40 }, { x: 10, y: 40 }]);
  const state = emptyIdeal();
  const leaf = drawnObject(state, "leaf", tools, { box: { x: 100, y: 100, w: 60, h: 40 } })!;
  assert.deepEqual([leaf.id, leaf.kind, leaf.label, leaf.color, leaf.box], ["o1", "shape", "", "#1f8a5b", { x: 100, y: 100, w: 60, h: 40 }], "no words on its tag: they are the user's own");
  const line = drawnObject({ objects: [leaf], merges: [] }, "edge", tools, { points: [{ x: 0, y: 300 }, { x: 200, y: 310 }, { x: 400, y: 300 }] })!;
  assert.deepEqual([line.id, line.kind], ["o2", "line"], "an open pen draws a line");
  assert.equal(drawnObject(state, "blob", tools, { points: [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 80 }, { x: 0, y: 80 }] })!.kind, "shape", "a closed pen draws a form");
  assert.equal(drawnObject(state, "crop", tools, { points: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }, { x: 0, y: 50 }] })!.kind, "crop");
  assert.equal(drawnObject(state, "erase", tools, { box: { x: 0, y: 0, w: 30, h: 30 } })!.kind, "erase");
  assert.equal(drawnObject(state, "leaf", tools, { box: { x: 0, y: 0, w: 2, h: 2 } }), null, "a click is not a form");
  assert.equal(drawnObject(state, "edge", tools, { points: [{ x: 0, y: 0 }, { x: 3, y: 0 }] }), null, "a dot is not a line");
  assert.equal(drawnObject(state, "join", tools, { box: { x: 0, y: 0, w: 50, h: 50 } }), null, "merging draws nothing");
});

test("merged forms are one outline; naming a whole merge names the merged form; removing or splitting takes forms out", () => {
  const make = (state: IdealState, x: number) => { const item = drawnObject(state, "leaf", tools, { box: { x, y: 100, w: 60, h: 60 } })!; return { ...state, objects: [...state.objects, item] }; };
  let state = make(make(make(emptyIdeal(), 100), 140), 400);
  state = { ...state, objects: [...state.objects, drawnObject(state, "edge", tools, { points: [{ x: 0, y: 300 }, { x: 400, y: 300 }] })!] };
  assert.equal(mergeObjects(state, ["o1"], "x"), state, "one form is no merge");
  assert.deepEqual(mergeObjects(state, ["o1", "o4"], "x"), state, "a line does not merge");
  state = mergeObjects(state, ["o1", "o2"], "Joined form");
  assert.deepEqual(state.merges, [{ id: "m1", label: "Joined form", members: ["o1", "o2"] }]);
  assert.deepEqual(withMerged(state, ["o2"]), ["o1", "o2"], "selecting one form of a merge selects the merged form");
  assert.equal(labelObjects(state, ["o1", "o2"], "Grows").merges[0].label, "Grows");
  assert.equal(labelObjects(state, ["o3"], "Removed").objects[2].label, "Removed");
  const moved = mergeObjects(state, ["o2", "o3"], "Other");
  assert.deepEqual(moved.merges.map(merge => merge.members), [["o2", "o3"]], "a form leaves its old merge, which is gone with one form left");
  assert.deepEqual(removeObjects(state, ["o1"]).merges, [], "removing a form dissolves the merge it leaves alone");
  const turned = placedOutline({ outline: [{ x: 0, y: 0 }, { x: 20, y: 0 }], box: { x: 0, y: -10, w: 20, h: 20 }, dx: 5, dy: 0, scale: 2, rotate: 90 });
  assert.deepEqual(turned.map(p => ({ x: Math.round(p.x), y: Math.round(p.y) })), [{ x: 15, y: -20 }, { x: 15, y: 20 }], "moved, scaled and turned about its center");
});

test("a preset is loaded as objects made with the kit's tools at their place; AI reads the drawn state in numbers", () => {
  const state = presetState({ id: "joined", title: "Leaves join", detail: "d", objects: [
    { id: "a", tool: "leaf", label: "", x: 100, y: 100, w: 60, h: 60, points: [], dx: 0, dy: 0, scale: 1, rotate: 0, nodeId: "", specs: [] },
    { id: "b", tool: "leaf", label: "", x: 140, y: 100, w: 60, h: 60, points: [], dx: 0, dy: 0, scale: 1, rotate: 0, nodeId: "", specs: [] },
    { id: "c", tool: "crop", label: "Moved", x: 400, y: 100, w: 40, h: 40, points: [], dx: 30, dy: -10, scale: 1.5, rotate: 400, nodeId: "", specs: [] },
    { id: "d", tool: "nowhere", label: "", x: 0, y: 0, w: 10, h: 10, points: [], dx: 0, dy: 0, scale: 1, rotate: 0, nodeId: "", specs: [] }],
    merges: [{ id: "m", label: "One leaf", members: ["a", "b", "d"] }], state: [] }, tools);
  assert.deepEqual(state.objects.map(item => [item.id, item.kind, item.label]), [["o1", "shape", ""], ["o2", "shape", ""], ["o3", "crop", ""]], "an object of no tool is left out; AI's names are not put on tags");
  assert.deepEqual(state.merges, [{ id: "m1", label: "", members: ["o1", "o2"] }]);
  assert.equal(state.objects[2].rotate, 40, "angles come back into range");
  const drawn = describeIdeal(state, tools);
  assert.deepEqual(drawn.objects[0], { id: "o1", kind: "shape", tool: "Leaf", label: "", box: { x: 100, y: 100, w: 60, h: 60 }, mergedInto: "m1" });
  const lifted = drawn.objects[2] as Record<string, unknown>;
  assert.deepEqual(lifted.from, { x: 400, y: 100, w: 40, h: 40 }); assert.deepEqual(lifted.moved, { dx: 30, dy: -10, scale: 1.5, rotate: 40 });
  assert.deepEqual(drawn.merges, [{ id: "m1", label: "", members: ["o1", "o2"] }]);
});

function request(intent: "align-kit" | "align", align: object, extra: object = {}) {
  const scene = sampleScene(), code = connectScene({ title: "Tree", explanation: "", code: sceneProgram }, scene).code;
  return requestSchema.parse({ intent, scene, image: "data:image/png;base64,AAAA", previous: code, instruction: "", ...extra,
    inspection: { brushName: "Tree", nodeIds: ["tree", "orb"], cursor: 0, marks: [],
      params: paramRows(scene, ["tree", "orb"]).map(row => ({ key: row.key, nodeId: row.binding.nodeId, constraintId: row.constraintId, constraint: row.constraint, paramId: row.binding.path[0], param: row.param, type: row.binding.type })),
      steps: [{ id: 1, nodeId: null, from: null, to: null, transitionId: null, values: {}, runtime: { states: {}, stores: { tree: { leaves: [{ x: 100, y: 100 }] } } } }], align: { concern: "잎이 겹치면 하나로", summary: "s", execution: moment, ...align } } });
}

test("align-kit: AI reads the concern at the moment and makes tools and presets; tools that cannot work and objects of no tool are dropped", async () => {
  const output = { reading: "You want overlapping leaves to become one.", tools: [tools[0], tools[1], tools[3], { ...tools[0], id: "empty", template: [] }, { ...tools[1], id: "crop" }, { ...tools[0] }],
    presets: [{ id: "joined", title: "Leaves join", detail: "d", objects: [{ id: "a", tool: "leaf", label: "", x: 100, y: 100, w: 60, h: 60, points: [], dx: 0, dy: 0, scale: 1, rotate: 0 }, { id: "b", tool: "ghost", label: "", x: 0, y: 0, w: 9, h: 9, points: [], dx: 0, dy: 0, scale: 1, rotate: 0 }],
      merges: [{ id: "m", label: "One", members: ["a", "b"] }], state: [] }, { id: "nothing", title: "Nothing", detail: "", objects: [], merges: [], state: [] }] };
  await withMockedAI(() => output, async calls => {
    const kit = alignKitSchema.parse(await runAI(request("align-kit", {}), signal()));
    assert.deepEqual(kit.tools.map(tool => tool.id), ["leaf", "edge", "join"], "a shape needs its form, base tool ids are taken, ids once");
    assert.deepEqual(kit.presets.map(preset => preset.objects.map(item => item.id)), [["a"]], "a preset keeps what its tools make; an empty one goes");
    assert.deepEqual(kit.presets[0].merges, [], "a merge of fewer than two forms goes");
    const sent = JSON.parse(calls[0].input[0].content[0].text);
    assert.equal(sent.concern, "잎이 겹치면 하나로"); assert.equal(sent.execution.stage.name, "놓기"); assert.deepEqual(sent.step.runtime.stores.tree.leaves, [{ x: 100, y: 100 }]);
    assert.ok(Object.keys(sent.code).length > 0, "the code, so the forms match what the brush draws");
    assert.match(calls[0].instructions, /micro direct manipulation tools/); assert.match(calls[0].instructions, /PLACE EVERYTHING WHERE IT IS/);
    assert.match(calls[0].instructions, /Your job is NOT to fix the brush and NOT to recommend a fix/, "tools to say it, not a fix");
  });
  await assert.rejects(runAI(requestSchema.parse({ ...request("align-kit", {}), image: undefined }), signal()), /An Execution frame, its picture and its brush are needed/);
});

test("align: AI reads the state drawn at the moment (the drawing in numbers, the guess it started from) and returns one fix of this brush", async () => {
  const ideal = presetState({ id: "joined", title: "Leaves join", detail: "d", objects: [
    { id: "a", tool: "leaf", label: "", x: 100, y: 100, w: 60, h: 60, points: [], dx: 0, dy: 0, scale: 1, rotate: 0, nodeId: "", specs: [] },
    { id: "b", tool: "leaf", label: "", x: 140, y: 100, w: 60, h: 60, points: [], dx: 0, dy: 0, scale: 1, rotate: 0, nodeId: "", specs: [] }], merges: [{ id: "m", label: "One leaf", members: ["a", "b"] }], state: [] }, tools);
  const output = { kind: "constraint", nodeId: "tree", targetId: "branching-growth", targetIds: ["ink-wash", "pulse", "branching-growth"], title: "Join overlapping leaves", detail: "d", changes: [{ key: "orb/radius", stateId: "", value: 3 }], reply: "You merged the two forms." };
  await withMockedAI(() => output, async calls => {
    const fix = alignFixSchema.parse(await runAI(request("align", { reading: "r", tools, preset: { title: "Leaves join", detail: "d" }, ideal }, { instruction: "하나로" }), signal()));
    assert.deepEqual([fix.kind, fix.targetId, fix.targetIds, fix.changes], ["constraint", "branching-growth", ["ink-wash"], []], "other constraints of the same node only; no value changes for a structural fix");
    const sent = JSON.parse(calls[0].input[0].content[0].text);
    assert.deepEqual(sent.drawn, describeIdeal(ideal, tools)); assert.deepEqual(sent.drawn.merges[0].members, ["o1", "o2"]);
    assert.deepEqual(sent.startedFrom, { title: "Leaves join", detail: "d" }); assert.equal(sent.request, "하나로"); assert.equal(sent.reading, "r");
    assert.match(calls[0].instructions, /THE DRAWING IS THE SPECIFICATION/); assert.match(calls[0].instructions, /It is a demonstration, not a one-off edit/);
  });
  await withMockedAI(() => ({ ...output, nodeId: "elsewhere" }), async () => {
    await assert.rejects(runAI(request("align", { tools, ideal }), signal()), /does not point at a node of this brush/);
  });
  await withMockedAI(() => ({ ...output, kind: "value", changes: [{ key: "orb/nope", stateId: "", value: 1 }] }), async () => {
    await assert.rejects(runAI(request("align", { tools, ideal }), signal()), /cannot be applied to this brush/, "a value fix needs values of the brush");
  });
  await assert.rejects(runAI(request("align", { tools, ideal: emptyIdeal() }), signal()), /Draw the state you want at this moment, set it, or say it/);
});

test("the drawing sheet draws merged forms as one outline (strokes, then their insides painted over), lifted parts where they were put, names and grips", () => {
  const ideal = presetState({ id: "p", title: "t", detail: "", objects: [
    { id: "a", tool: "leaf", label: "", x: 100, y: 100, w: 60, h: 60, points: [], dx: 0, dy: 0, scale: 1, rotate: 0, nodeId: "", specs: [] },
    { id: "b", tool: "leaf", label: "", x: 140, y: 100, w: 60, h: 60, points: [], dx: 0, dy: 0, scale: 1, rotate: 0, nodeId: "", specs: [] },
    { id: "c", tool: "crop", label: "", x: 400, y: 100, w: 40, h: 40, points: [], dx: 20, dy: 0, scale: 1, rotate: 0, nodeId: "", specs: [] },
    { id: "d", tool: "edge", label: "Stop here", x: 0, y: 0, w: 0, h: 0, points: [{ x: 0, y: 300 }, { x: 450, y: 310 }, { x: 900, y: 300 }], dx: 0, dy: 0, scale: 1, rotate: 0, nodeId: "", specs: [] }],
    merges: [{ id: "m", label: "One leaf", members: ["a", "b"] }], state: [] }, tools);
  const sheet = (props: object) => renderToStaticMarkup(createElement(IdealSheet, { state: ideal, onState: noop, tools, mode: "select", marks: [[{ x: .1, y: .1 }, { x: .2, y: .2 }]], onMarks: noop, shot: "data:image/png;base64,AAAA", selected: [], onSelect: noop, editable: true, ...props }));
  const html = sheet({});
  const merged = html.match(/<g class="ideal-forms ">((?:(?!<\/g>).)*)<\/g>/)![1];
  assert.deepEqual([...merged.matchAll(/fill="([^"]+)"/g)].map(match => match[1]), ["none", "none", "#fffefa", "#fffefa", "#1f8a5b", "#1f8a5b"], "both outlines, then both insides in paper, then the tint: one outer outline");
  assert.match(html, /class="ideal-gone crop"/); assert.match(html, /<image href="data:image\/png;base64,AAAA"/);
  assert.match(html, /translate\(440 120\)/, "the lifted part where it was put");
  assert.doesNotMatch(html, /class="ideal-label"/, "AI's names are not written on the tags");
  const named = sheet({ state: { ...ideal, merges: ideal.merges.map(merge => ({ ...merge, label: "One leaf" })), objects: ideal.objects.map(item => item.tool === "edge" ? { ...item, label: "Stop here" } : item) } });
  assert.match(named, /class="ideal-label"[^>]*><tspan[^>]*>One leaf<\/tspan><\/text>/); assert.match(named, /class="ideal-label"[^>]*><tspan[^>]*>Stop here<\/tspan><\/text>/);
  assert.match(html, /class="ideal-line"/); assert.match(html, /class="ideal-note"/);
  assert.doesNotMatch(html, /ideal-grip/, "nothing selected, no grips");
  assert.match(sheet({ selected: ["o3"] }), /class="ideal-grip scale"/, "one selected object has its grips");
  assert.match(sheet({ mode: "run" }), /pointer-events:none/, "while execution runs the drawing only shows");
});

test("the tools: AI's reading, the kit's forms and pens next to the base tools, merging and naming what is selected, and presets to load", () => {
  const kit = { reading: "You want overlapping leaves to become one.", tools, presets: [{ id: "joined", title: "Leaves join", detail: "Two leaves drawn as one outline.", objects: [], merges: [], state: [] }], variables: [] };
  const leaves = presetState({ id: "p", title: "t", detail: "", objects: [
    { id: "a", tool: "leaf", label: "", x: 100, y: 100, w: 60, h: 60, points: [], dx: 0, dy: 0, scale: 1, rotate: 0, nodeId: "", specs: [] },
    { id: "b", tool: "leaf", label: "", x: 140, y: 100, w: 60, h: 60, points: [], dx: 0, dy: 0, scale: 1, rotate: 0, nodeId: "", specs: [] }], merges: [], state: [] }, tools);
  const render = (props: object) => renderToStaticMarkup(createElement(IdealTools, { state: emptyIdeal(), onState: noop, kit, mode: "run", onMode: noop, selected: [], onSelect: noop, marks: [], onMarks: noop,
    editable: true, busy: false, preset: "", onPreset: noop, making: false, onMake: noop, changes: [], onStateValues: noop, objects: [{ id: "orb", name: "Orb" }], current: [], ...props }));
  const html = render({});
  assert.match(html, /Your intent, as read<\/em>You want overlapping leaves to become one\./);
  for (const name of ["Look · Step", "Move · Size", "Lasso", "Pencil", "Tag", "Erase part", "Note", "Leaf", "Boundary", "Own form"]) assert.match(html, new RegExp(`>${name}</button>`));
  assert.match(html, /aria-label="Ask for a tool"/); assert.match(html, />Make tool<\/button>/, "a tool of one's own, asked for in words");
  assert.match(html, /<button class="kit" title="Join the selected forms"><i[^>]*><\/i>Merge outlines<\/button>/, "joining is a tool there before anything is selected");
  assert.doesNotMatch(html, /class="ideal-actions"/, "acting on a selection only shows with one");
  assert.match(html, /AI&#x27;S GUESSES/); assert.match(html, /<b>Leaves join<\/b><span>Two leaves drawn as one outline\.<\/span>/);
  assert.match(html, /Remake tools here/);
  const one = render({ state: leaves, selected: ["o1"] }), two = render({ state: leaves, selected: ["o1", "o2"] });
  assert.match(one, /disabled=""[^>]*>[^]*?Merge outlines<\/button>/, "one form cannot merge");
  assert.match(two, /<button title="Join the selected forms"><i[^>]*><\/i>Merge outlines<\/button>/);
  // The tag is one field: its words as they are (editable, none offered), a dropdown of the brush's objects, and the object linked as a chip.
  assert.match(two, /<input[^>]*aria-label="Words on the tag of what is selected"/); assert.doesNotMatch(two, /class="ref-drop"|role="combobox"/, "no names offered"); assert.match(two, /Remove<\/button>/);
  assert.match(two, /<select class="ideal-tag-link"[^>]*aria-label="The object of the brush it is"[^>]*><option value="" selected="">No object<\/option><option value="orb">Orb<\/option><\/select>/, "nothing linked yet");
  const named = { ...leaves, objects: leaves.objects.map(item => ({ ...item, label: "Grows", nodeId: "orb" })) };
  const linkedTag = render({ state: named, selected: ["o1"] });
  assert.match(linkedTag, /Its tags and rules are on the picture\./, "one thing is tagged on the picture"); assert.doesNotMatch(linkedTag, /ideal-specs/);
  const options = [{ key: "node-orb", text: "Orb", choose: noop }, { key: "words-Grows", text: "Grows", choose: noop }, { key: "words-Gone", text: "Gone", choose: noop }];
  assert.deepEqual(optionMatches(options, "Grows", false).map(item => item.text), ["Orb", "Grows", "Gone"], "just opened: every option, whatever the words are now");
  assert.deepEqual(optionMatches(options, "g", true).map(item => item.text), ["Grows", "Gone"], "typing narrows them");
  assert.deepEqual(optionMatches(options, "big leaf", true), [], "free words: nothing to choose, the words are kept");
  assert.match(render({ kit: null, making: true }), /Making tools…/);
});

test("an Execution frame folds the drawing tools until asked; opening them makes the tools for the moment, and the brush is fixed to what is drawn", () => {
  const frame: ExploreFrame = { id: "explore-1", targetFrameId: "sketch-a", brushId: "b", toolId: "t", mode: "execution", name: "n", nodeIds: ["orb"],
    base: { runtime: null, values: {}, steps: [] }, executable: "", status: "ready", error: "", progress: .5, values: {},
    result: { summary: "펜 끝을 끌어 보세요.", axis: "input", from: 0, to: 1, edits: [], overlays: [], stages: [], sketches: [], of: [] },
    request: { concern: "c", inspection: targetedResultSchema.parse({ summary: "s", overlays: [] }) } };
  const render = (item: ExploreFrame, edits = true) => renderToStaticMarkup(createElement(ExploreFrameView, { frame: item, zoom: 1, specs: {}, onProgress: noop, onValue: noop, onRetry: noop, onActivate: noop,
    ...(edits ? { onEdit: noop, onKit: noop, onFix: noop, onCancel: noop, onOpenFork: noop } : {}) }));
  const html = render(frame);
  assert.match(html, /class="explore-recommend-open"[^>]*>.*?Draw the state you want at this moment/); assert.doesNotMatch(html, /Fix the brush to this/);
  assert.doesNotMatch(render(frame, false), /Draw the state you want/, "only where it can be done");
  const kit = { reading: "r", tools, presets: [], variables: [] };
  const open = render({ ...frame, edit: emptyExploreEdit(kit) });
  assert.match(open, /THE STATE YOU WANT/); assert.match(open, /<button class="primary" disabled=""[^>]*>.*?Fix the brush to this/, "nothing drawn yet");
  const key = `${frame.id}:${exploreStep(frame).key}`, at = { key, progress: .5, moment: { ...moment, axis: "input" as const, done: null, count: null, stage: null } };
  const ideal = presetState({ id: "p", title: "t", detail: "", objects: [{ id: "a", tool: "leaf", label: "", x: 100, y: 100, w: 60, h: 60, points: [], dx: 0, dy: 0, scale: 1, rotate: 0, nodeId: "", specs: [] }], merges: [], state: [] }, tools);
  const drawn = render({ ...frame, edit: { ...emptyExploreEdit(kit), mode: "select", ideal, at } });
  assert.match(drawn, /class="explore-edit-sheet mode-select"/); assert.doesNotMatch(drawn, /<button class="primary" disabled=""[^>]*>.*?Fix the brush/, "drawn: the brush can be fixed to it");
  const elsewhere = render({ ...frame, edit: { ...emptyExploreEdit(kit), ideal, at: { ...at, key: "other", progress: .2 } } });
  assert.doesNotMatch(elsewhere, /explore-edit-sheet/); assert.match(elsewhere, /There is a drawing made at 20%/); assert.match(elsewhere, /Go to that moment/);
  assert.match(render({ ...frame, edit: { ...emptyExploreEdit(kit), note: "하나로", making: true } }), /fixing a fork of the brush to it/);
  assert.match(render({ ...frame, edit: { ...emptyExploreEdit(kit), reply: "Applied.", forkId: "fork-1" } }), /Applied\.<button>Go to the fork/);
});

test("the frame asks for the tools and the fix, and a fix is applied to a fork of the brush (the brush stays)", () => {
  const home = readFileSync("app/routes/home.tsx", "utf8");
  assert.match(home, /const made = await requestAlignKit\(deps, explore\.targetFrameId, found\.brush, found\.context, image, signal, request, before\?\.tools \?\? \[\], before\?\.variables \?\? \[\]\);/);
  assert.match(home, /if \(adding && edit\.kit\) \{ const kit = withTools\(edit\.kit, made\)/, "a tool asked for is added to the tools there are");
  assert.match(home, /Nothing drawn yet: the first guess is loaded to start from, at the moment it was made for\./);
  assert.match(home, /at: \{ key: edit\.kitAt, progress: explore\.progress, moment \}/, "drawn only at the moment the tools were made at");
  assert.match(home, /const fork = await forkFix\(explore\.targetFrameId, found\.brush, found\.tool, change\);/);
  assert.match(home, /const key = fixKey\(fix\), added = await applyFix\(deps, id, fix, key\);/, "applied in the fork's copy of the frame");
  assert.match(home, /fork: \{ brushId: brush\.id, frameId: frame, key: fixKey\(fix\), title: fix\.title, toolId: tool\.id \}/);
  assert.doesNotMatch(home, /placeRecommendationGroup|forkSlots|recommendFromFrame|reviseSlot/, "no recommendation frame groups any more");
  const actions = readFileSync("app/studio/inspection-actions.ts", "utf8");
  assert.match(actions, /const image = await annotatedImage\(await idealImage\(drawn\.image, drawn\.ideal\), drawn\.marks\);/, "AI sees the drawing on the picture");
});

test("a targeted inspection of a frame with no step recorded (steps are not saved) takes the moment the frame shows now as its step, so its Execution frame can be made", () => {
  const home = readFileSync("app/routes/home.tsx", "utf8"), preview = readFileSync("app/components/code-preview.tsx", "utf8");
  assert.match(home, /const stepped = await recordNow\(frame, brush\.id\);\n    const state = inspectionFor/, "before the inspection reads its steps");
  assert.match(home, /preview\.snapshot\(\);/);
  assert.match(home, /No steps were recorded, so the Execution frame could not be made/, "else it says why no frame was made");
  assert.match(preview, /event\.data\.type==='snapshot'\)\{traceQueue\.push\(\{nodeId:null[^}]*\}\);flushTrace\(\);return;\}/, "the running sketch reports itself as a step");
});

// A state tool: a reach the code keeps per leaf (m.runtime), shown as a circle with a grip on its rim, and the input's last point.
const reachTool: AlignTool = { id: "reach", kind: "state", name: "Leaf reach", hint: "Drag a rim to change how far a leaf reaches", color: "#e07b00", label: "", closed: false, template: [], labels: [], ...behaviorNone,
  handles: [{ id: "rim", kind: "ellipse", name: "Reach of each leaf", x: 'item("x") - item("r")', y: 'item("y") - item("r")', w: 'item("r") * 2', h: 'item("r") * 2', label: "reach ${round(item(\"r\"))}px", color: "#e07b00",
    link: { kind: "param", nodeId: "tree", id: "" }, when: "", each: "tree:leaves",
    handle: { key: '@store:tree:@runtime.reach.${item("id")}.value', gesture: "slide", x: 'item("x") + item("r")', y: 'item("y")', pivotX: 'item("x")', pivotY: 'item("y")', value: "start * dist / startDist", hint: "Drag the rim" } },
    { id: "tip", kind: "ellipse", name: "Where the stroke ends", x: '0', y: '0', w: "8", h: "8", label: "", color: "#2563eb", link: { kind: "param", nodeId: "tree", id: "" }, when: "", each: "",
      handle: { key: "@input:-1:-1", gesture: "move", x: "", y: "", pivotX: "", pivotY: "", value: "", hint: "Move the end" } }], nodeId: "", specs: [] };

test("execution state set by hand: a state tool's grips name the keys they change (per item too); presets set it; what it was and is now", () => {
  const all = [...tools, reachTool];
  assert.equal(stateToolOf("@store:tree:@runtime.reach.g1:0.value", all)?.overlay.id, "rim", "an item's key matches the grip's per-item key");
  assert.equal(stateToolOf("@store:tree:@runtime.other.g1:0.value", all), null); assert.equal(stateToolOf("@input:-1:-1", all)?.overlay.id, "tip");
  const preset = { id: "touch", title: "t", detail: "", objects: [], merges: [], state: [{ key: "@store:tree:@runtime.reach.g1:0.value", value: 24 }, { key: "@store:tree:@runtime.reach.g1:1.value", value: "nope" }, { key: "orb/radius", value: 3 }, { key: "@input:-1:-1", value: "12,-4" }] };
  assert.deepEqual(presetValues(preset, all), { "@store:tree:@runtime.reach.g1:0.value": 24, "@input:-1:-1": "12,-4" }, "only keys its state tools change, numbers and moves");
  assert.deepEqual(withoutState({ "orb/radius": 3, "@input:-1:-1": "1,1" }), { "orb/radius": 3 });
  const runtime = { stores: { tree: { "@runtime": { reach: { "g1:0": { base: 10, value: 10 } } } } }, history: [{ id: 1, points: [{ x: 0, y: 0 }, { x: 50, y: 20 }] }] };
  const changes = stateChanges({ "orb/radius": 3, "@store:tree:@runtime.reach.g1:0.value": 24, "@input:-1:-1": "12,-4" }, runtime, all);
  assert.deepEqual(changes.map(change => [change.name, change.kind, change.was, change.now]), [["Reach of each leaf", "number", 10, 24], ["Where the stroke ends", "move", { x: 50, y: 20 }, { x: 62, y: 16 }]], "values of the brush are not execution state");
});

test("state tools: AI makes tools that check the condition and grips on execution state (a grip that changes no state goes), presets set it, and the fix reads the state set with the drawing", async () => {
  const output = { reading: "You want leaves that touch to join.", tools: [tools[0], reachTool, { ...reachTool, id: "check", handles: [{ ...reachTool.handles[0], handle: { ...reachTool.handles[0].handle!, key: "orb/radius" } }], nodeId: "", specs: [] }, { ...reachTool, id: "empty", handles: [], nodeId: "", specs: [] }, { ...tools[1], id: "pencil" }],
    presets: [{ id: "touch", title: "Reach until they touch", detail: "d", objects: [], merges: [], state: [{ key: "@store:tree:@runtime.reach.g1:0.value", value: 24 }, { key: "@store:tree:elsewhere", value: 2 }] }] };
  await withMockedAI(() => output, async calls => {
    const kit = alignKitSchema.parse(await runAI(request("align-kit", {}), signal()));
    assert.deepEqual(kit.tools.map(tool => tool.id), ["leaf", "reach", "check"], "a state tool shows something; a base tool's id is taken");
    assert.equal(kit.tools[2].handles[0].handle, null, "a grip on no execution state goes; the check stays");
    assert.deepEqual(kit.tools[0].handles, [], "only state tools have grips");
    assert.deepEqual(kit.presets[0].state, [{ key: "@store:tree:@runtime.reach.g1:0.value", value: 24 }], "a preset of state only stays; state no tool changes goes");
    assert.match(calls[0].instructions, /### a state tool's handles/); assert.match(calls[0].instructions, /drawn on the picture only while the user has this tool chosen/);
  });
  const state = stateChanges({ "@store:tree:@runtime.reach.g1:0.value": 24 }, { stores: { tree: { "@runtime": { reach: { "g1:0": { base: 10, value: 10 } } } } } }, [reachTool]);
  const fix = { kind: "constraint", nodeId: "tree", targetId: "branching-growth", targetIds: [], title: "Reach farther", detail: "d", changes: [], reply: "r" };
  await withMockedAI(() => fix, async calls => {
    await runAI(request("align", { tools: [reachTool], ideal: emptyIdeal(), state }), signal());
    const sent = JSON.parse(calls[0].input[0].content[0].text);
    assert.deepEqual(sent.stateSet.map((item: { name: string; was: number; now: number }) => [item.name, item.was, item.now]), [["Reach of each leaf", 10, 24]], "state set alone is enough to fix to");
    assert.match(calls[0].instructions, /state set by hand: the state at which the outcome they want happens/);
  });
});

test("the frame shows a state tool's grips only while it is chosen (the only grips on it), and the panel lists the state set", () => {
  const frame = readFileSync("app/components/explore-frame.tsx", "utf8"), home = readFileSync("app/routes/home.tsx", "utf8"), sheet = readFileSync("app/components/ideal-state.tsx", "utf8");
  assert.match(frame, /setting = stateTool\?\.kind === "state" \? stateTool : undefined/); assert.match(frame, /\.\.\.\(setting \? setting\.handles\.map\(/, "its grips, only while it is chosen");
  assert.match(frame, /result\.overlays\.map\(item => \(\{ \.\.\.item, handle: null \}\)\)/, "the frame's own overlays hold none");
  assert.match(frame, /idealEdited\(edit\.ideal, edit\.marks, edit\.note\) \|\| changes\.length > 0/, "state set alone can be fixed to");
  assert.match(sheet, /const live = editable && mode !== "run" && kitTool\(mode, tools\)\?\.kind !== "state";/, "the drawing sheet lets the grips take the pointer");
  assert.match(home, /onStateValues=\{values => patchExplore\(explore\.id, current => \(\{ values: \{ \.\.\.withoutState\(current\.values\), \.\.\.values \} \}\)\)\}/);
  assert.match(home, /state: stateChanges\(explore\.values, exploreStep\(explore, null\)\.runtime, edit\.kit\?\.tools \?\? \[\]\), refs \}, signal\)/);
  const kit = { reading: "r", tools: [tools[0], reachTool], presets: [], variables: [] };
  const html = renderToStaticMarkup(createElement(IdealTools, { state: emptyIdeal(), onState: noop, kit, mode: "tool:reach", onMode: noop, selected: [], onSelect: noop, marks: [], onMarks: noop,
    editable: true, busy: false, preset: "", onPreset: noop, making: false, onMake: noop, onStateValues: noop, objects: [], current: [{ key: "@store:tree:@runtime.reach.g1:0.value", name: "Reach of each leaf", text: "14" }],
    changes: stateChanges({ "@store:tree:@runtime.reach.g1:0.value": 24 }, { stores: { tree: { "@runtime": { reach: { "g1:0": { base: 10, value: 10 } } } } } }, [reachTool]) }));
  assert.match(html, /Leaf reach/); assert.match(html, /Drag a rim to change how far a leaf reaches/, "its hint while chosen");
  assert.match(html, /<b>Reach of each leaf<\/b> 10 → 24/); assert.match(html, /Clear drawing and state/);
});

test("base tools: the pencil draws a line or, closed, a form; a tag points at an item of the picture and links it to an object of the brush; a tool asked for joins the kit", () => {
  const line = drawnObject(emptyIdeal(), "pencil", tools, { points: [{ x: 0, y: 0 }, { x: 60, y: 10 }, { x: 120, y: 0 }] })!;
  assert.deepEqual([line.kind, line.tool], ["line", "pencil"]);
  const loop = drawnObject(emptyIdeal(), "pencil", tools, { points: [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 80 }, { x: 0, y: 80 }, { x: 4, y: 4 }] })!;
  assert.equal(loop.kind, "shape", "a stroke that closes up is a form");
  const item = drawnObject(emptyIdeal(), "tag", tools, { box: { x: 100, y: 100, w: 40, h: 30 } })!;
  assert.deepEqual([item.kind, item.box], ["item", { x: 100, y: 100, w: 40, h: 30 }]);
  const tagged = tagObjects({ objects: [item], merges: [] }, [item.id], "Orb", "orb");
  assert.deepEqual(describeIdeal(tagged, tools).objects[0], { id: item.id, kind: "item", tool: "tag", label: "Orb", brushObject: "orb", box: { x: 100, y: 100, w: 40, h: 30 } }, "what it is tagged as, for AI");
  const kit = { reading: "r", tools: [tools[0], tools[1]], presets: [], variables: [] };
  const merged = withTools(kit, { reading: "more", tools: [{ ...tools[1], name: "Ruler" }, reachTool], presets: [], variables: [] });
  assert.deepEqual(merged.tools.map(tool => tool.id), ["leaf", "edge", "edge-2", "reach"], "added after; a taken id gets a number");
  assert.equal(merged.reading, "r");
  const sheet = readFileSync("app/components/ideal-state.tsx", "utf8"), frame = readFileSync("app/components/explore-frame.tsx", "utf8");
  assert.match(sheet, /if \(taken\.length\) onSelect\(withMerged\(state, taken\)\); else add\(drawnObject\(state, "crop", tools, \{ points: stroke \}\)\);/, "the lasso takes what is inside it, else lifts the picture there");
  assert.match(sheet, /const box = itemAt\?\.\(at\);/, "a tag on an item of the picture");
  assert.match(frame, /stepsAt\(run, at\)\.filter\(moment => moment\.done <= done\)/, "an item drawn as far as execution is now");
  assert.match(readFileSync("prompts/align-kit.md", "utf8"), /## a tool asked for/);
});


test("a state tool can check things the user presses: its overlays read them as boxes in the order pressed, shown once enough are picked", () => {
  const relation: AlignTool = { ...reachTool, id: "relation", handles: [{ id: "between", kind: "line", name: "Between the two pressed", x: 's("@picked", "0.cx")', y: 's("@picked", "0.cy")',
    w: 's("@picked", "1.cx") - s("@picked", "0.cx")', h: 's("@picked", "1.cy") - s("@picked", "0.cy")', label: '${round(s("@picked", "1.x") - s("@picked", "0.x") - s("@picked", "0.w"))}px',
    color: "#e07b00", link: { kind: "param", nodeId: "tree", id: "" }, when: 'len("@picked", "") >= 2', each: "", handle: null }] };
  assert.equal(readsPicked(relation), true); assert.equal(readsPicked(reachTool), false, "a tool that reads no picks takes no presses");
  const context = (boxes: { x: number; y: number; w: number; h: number }[]) => ({ values: {}, states: {}, step: 0, steps: 1, stores: { [PICKED_ROOT]: boxes.map(pickedRecord) } });
  assert.deepEqual(placeOverlays(relation.handles, context([{ x: 100, y: 100, w: 40, h: 40 }])), [], "shown only once two are picked");
  const [line] = placeOverlays(relation.handles, context([{ x: 100, y: 100, w: 40, h: 40 }, { x: 170, y: 100, w: 40, h: 40 }]));
  assert.deepEqual([line.x, line.y, line.w, line.h, line.label], [120, 120, 70, 0, "30px"]);
  const frame = readFileSync(new URL("../app/components/explore-frame.tsx", import.meta.url), "utf8");
  assert.match(frame, /\[PICKED_ROOT\]: picked\.map/, "the frame gives its overlays what was pressed");
  assert.match(frame, /setting && readsPicked\(setting\) && here && <svg className="explore-pick-sheet"/, "pressing picks only with a tool that reads it");
});

test("Move · Size on an item of the picture lifts it, so moving or sizing changes the thing itself (a tagged item too, keeping its tag)", () => {
  const lifted = liftedItem(emptyIdeal(), tools, { x: 100, y: 100, w: 40, h: 36 })!;
  assert.equal(lifted.kind, "crop"); assert.deepEqual(lifted.box, { x: 97, y: 97, w: 46, h: 42 }, "its box and a little around it");
  assert.deepEqual(liftedItem(emptyIdeal(), tools, { x: 100, y: 100, w: 0, h: 0 })!.box, { x: 88, y: 88, w: 24, h: 24 }, "an item with no size: a small part around it");
  const tagged = tagObjects({ objects: [drawnObject(emptyIdeal(), "tag", tools, { box: { x: 100, y: 100, w: 40, h: 40 } })!], merges: [] }, ["o1"], "Heart", "heart-node").objects[0];
  const sized = liftedOnMove({ ...tagged, scale: 1.6 });
  assert.equal(sized.kind, "crop"); assert.equal(sized.scale, 1.6); assert.equal(sized.label, "Heart"); assert.equal(sized.nodeId, "heart-node");
  assert.equal(describeIdeal({ objects: [sized], merges: [] }, tools).objects[0].kind, "crop", "AI reads it as the thing drawn now ending up that size");
  assert.equal(liftedOnMove(lifted), lifted, "anything else stays what it is");
});

test("a tag links an object of the brush and carries words and rules: AI's rules place the object, the user changes them, and dragging writes what it is now", () => {
  // Two items of the brush kept in the stores; the guess: one form as wide as both together, at their middle.
  const stores = { trail: { hearts: [{ x: 100, y: 100, size: 40 }, { x: 130, y: 104, size: 36 }] } };
  const read: SpecReader = (expr, item) => { try { const value = evaluate(expr, { values: {}, states: {}, step: 0, steps: 1, stores, item: specScope(item), itemIndex: 0 }); return Number.isFinite(value) ? value : null; } catch { return null; } };
  const preset = { id: "one", title: "One larger", detail: "d", merges: [], state: [], objects: [{ id: "a", tool: "leaf", label: "Joined", x: 100, y: 90, w: 40, h: 40, points: [], dx: 0, dy: 0, scale: 1, rotate: 0, nodeId: "trail",
    specs: [{ aspect: "w", expr: 's("trail", "hearts.0.size") + s("trail", "hearts.1.size")', options: [] }, { aspect: "x", expr: '(s("trail", "hearts.0.x") + s("trail", "hearts.1.x")) / 2', options: [] }, { aspect: "color", expr: "the newer one's", options: [] }] }] };
  let state = withSpecs(presetState(preset, tools), read);
  state = { ...state, objects: state.objects.map(item => ({ ...item, label: "Joined" })) };
  const joined = state.objects[0];
  assert.equal(joined.nodeId, "trail"); assert.equal(presetState(preset, tools).objects[0].label, "", "AI's words are not put on the tag: they are the user's own");
  assert.deepEqual([placedValues(joined).w, placedValues(joined).x], [76, 115], "placed by its rules: as wide as both, at their middle");
  assert.deepEqual(describeIdeal(state, tools).objects[0], { id: "o1", kind: "shape", tool: "Leaf", label: "Joined", brushObject: "trail", specs: preset.objects[0].specs.map(({ aspect, expr }) => ({ aspect, expr })), box: { x: 77, y: 72, w: 76, h: 76 }, moved: { dx: -5, dy: 0, scale: 1.9, rotate: 0 } });
  // The user changes a rule on the tag: the object follows; a rule it cannot read leaves it as it is.
  state = setSpec(state, "o1", 0, { aspect: "w", expr: 'max(s("trail", "hearts.0.size"), s("trail", "hearts.1.size")) * 1.5', options: [] }, read);
  assert.equal(placedValues(state.objects[0]).w, 60);
  assert.equal(placedValues(setSpec(state, "o1", 0, { aspect: "w", expr: "max(", options: [] }, read).objects[0]).w, 60);
  assert.equal(placedBySpecs({ ...state.objects[0], specs: [{ aspect: "w", expr: 'item("w") * 2', options: [] }] }, read).scale, 2, "item(\"w\"): its own size where it was made");
  // Dragging it by hand: the rules it changed say what it is now; the rest stay rules.
  const dragged = respecified(state.objects[0], { ...state.objects[0], scale: 2 });
  assert.deepEqual(dragged.specs.map(spec => spec.expr), ["80", preset.objects[0].specs[1].expr, "the newer one's"]);
  // The object of the brush and the words are apart: tagging one keeps the other.
  const relinked = linkObjects(labelObjects(state, ["o1"], "Grows"), ["o1"], "");
  assert.deepEqual([relinked.objects[0].label, relinked.objects[0].nodeId], ["Grows", ""]);
  assert.equal(linkObjects(state, ["o1"], "other").objects[0].label, "Joined");
  assert.equal(setSpec(state, "o1", 2, null, read).objects[0].specs.length, 2, "a rule removed");
});

test("a tool's tag: what it makes starts tagged with the quantities left open and their readings; choosing one places or paints it, and AI reads what was chosen", () => {
  const stores = { trail: { items: [{ size: 40 }, { size: 30 }] } };
  const read: SpecReader = (expr, item) => { try { const value = evaluate(expr, { values: {}, states: {}, step: 0, steps: 1, stores, item: specScope(item), itemIndex: 0 }); return Number.isFinite(value) ? value : null; } catch { return null; } };
  const size = { aspect: "w", expr: 's("trail", "items.0.size")', options: [{ expr: 's("trail", "items.0.size") + s("trail", "items.1.size")', note: "sum of both" }, { expr: 'max(s("trail", "items.0.size"), s("trail", "items.1.size"))', note: "the larger" }] };
  const color = { aspect: "color", expr: "#e0457b", options: [{ expr: "#e0457b", note: "the first one's" }, { expr: "#2563eb", note: "the second one's" }] };
  const unit: AlignTool = { ...tools[0], id: "unit", nodeId: "trail", specs: [size, color, { aspect: "count", expr: "", options: [] }] };
  const made = drawnObject(emptyIdeal(), "unit", [unit], { box: { x: 100, y: 100, w: 50, h: 50 } })!;
  assert.equal(made.nodeId, "trail", "linked to the object of the brush it stands for");
  assert.deepEqual(made.specs.map(spec => [spec.aspect, spec.expr]), [["w", ""], ["color", "#e0457b"]], "where it is drawn decides its place until a reading is chosen; an open rule with nothing to choose is dropped");
  assert.equal(made.specs[0].options.length, 2);
  assert.equal(placedBySpecs(made, read).scale, 1, "an open rule does not move it");
  assert.equal(respecified(made, { ...made, scale: 2 }).specs[0].expr, "", "sizing it by hand leaves an open rule open");
  assert.match(specText(made.specs[0], null), /^w = \? sum of both \/ the larger$/, "the tag shows the choice");
  // Choosing a reading on the tag.
  let state: IdealState = { objects: [made], merges: [] };
  state = setSpec(state, made.id, 0, { ...made.specs[0], expr: made.specs[0].options[0].expr }, read);
  assert.equal(placedValues(state.objects[0]).w, 70);
  assert.equal(specColor(state.objects[0]), "#e0457b", "a color written #rrggbb paints it");
  assert.equal(specColor({ specs: [{ aspect: "color", expr: "the newer one's", options: [] }] }), null, "in words it goes to AI only");
  assert.deepEqual(describeIdeal(state, [unit]).objects[0].specs, [{ aspect: "w", expr: size.options[0].expr, means: "sum of both" }, { aspect: "color", expr: "#e0457b", means: "the first one's" }]);
  assert.equal(describeIdeal({ objects: [made], merges: [] }, [unit]).objects[0].specs?.length, 1, "an open rule is not said");
  assert.deepEqual(decidedSpecs(made.specs).map(spec => spec.aspect), ["color"]);
  // Rules to choose from on any tag: every reading the kit offers, then the object's own box.
  const examples = specExamples({ tools: [unit], presets: [] });
  assert.deepEqual(examples.filter(item => item.aspect === "w").map(item => item.note), ["sum of both", "the larger", "", "as drawn"]);
  assert.ok(examples.some(item => item.aspect === "color" && item.note === "the second one's"));
  // On the picture, with its tags: each rule a line to edit (its readings in its dropdown), and rules to add by choosing.
  const noop = () => {};
  const panel = renderToStaticMarkup(createElement(TagControl, { state, onState: noop, id: made.id, objects: [{ id: "trail", name: "Trail" }], tools: [unit], refs: [], editable: true, examples, read }));
  assert.match(panel, /aria-label="Its rule"[^>]*role="combobox"[^>]*value="[^"]+"\/><button type="button" class="ref-drop"/);
  assert.match(panel, /<button type="button" class="ideal-spec-add">\+ Rule<\/button>/, "a rule is added at once: no menu to choose from");
  assert.doesNotMatch(panel, /<select class="ideal-spec-add"|<option value="-1"/);
  const sheet = renderToStaticMarkup(createElement(IdealSheet, { state: { objects: [made], merges: [] }, onState: noop, tools: [unit], mode: "select", marks: [], onMarks: noop, shot: "", selected: [], onSelect: noop, editable: true, objectNames: { trail: "Trail" }, read }));
  assert.match(sheet, /fill="#e0457b" fill-opacity="0.8"/, "painted with its color");
  assert.match(sheet, /<tspan[^>]*>w = \? sum of both \/ the larger<\/tspan>/, "the open choice on its tag");
  assert.deepEqual(keptSpecs([{ aspect: " w ", expr: "", options: [{ expr: " 1 ", note: "a" }, { expr: "1", note: "b" }] }, { aspect: "w", expr: "2", options: [] }]), [{ aspect: "w", expr: "", options: [{ expr: "1", note: "a" }] }]);
});

test("runtime state the kit refers to: @ in rules and words reads it at the moment, its inspect tools show it, and AI is told what it is", async () => {
  const at = (index: number, key: string) => `s("hearts", "${index}.${key}")`;
  const thing = (id: string, index: number): RuntimeVar => ({ id, name: `Heart ${index + 1}`, means: "One of the two that meet", color: "#e0457b",
    fields: [{ key: "x", expr: at(index, "x") }, { key: "y", expr: at(index, "y") }, { key: "w", expr: at(index, "size") }, { key: "h", expr: at(index, "size") }] });
  const variables: RuntimeVar[] = [thing("first", 0), thing("second", 1), { id: "mid", name: "Midpoint of both", means: "Where the two meet halfway", color: "#2563eb",
    fields: [{ key: "x", expr: `(${at(0, "x")} + ${at(1, "x")}) / 2` }, { key: "y", expr: `(${at(0, "y")} + ${at(1, "y")}) / 2` }] }];
  const context = { values: {}, stores: { hearts: [{ x: 100, y: 200, size: 40 }, { x: 160, y: 220, size: 60 }] }, states: {}, step: 0, steps: 1 };
  const readNow = (expr: string, scope: object = {}) => { try { const value = evaluate(expandRefs(expr, variables), { ...context, ...scope }); return Number.isFinite(value) ? value : null; } catch { return null; } };
  // A reference is its field's expression; `@id` alone its first field; quoted parts and references to nothing stay.
  assert.equal(expandRefs("@first.w + @second.w", variables), `(${at(0, "size")}) + (${at(1, "size")})`);
  assert.equal(readNow("max(@first.w, @second.w)"), 60); assert.equal(readNow("@first"), 100);
  assert.equal(expandRefs('s("@picked", "0.cx") + @nothing.x', variables), 's("@picked", "0.cx") + @nothing.x'); assert.equal(readNow("@nothing.x"), null);
  // A rule on a tag placed by a reference.
  const read: SpecReader = (expr, item) => readNow(expr, { item: specScope(item), itemIndex: 0 });
  const made = drawnObject(emptyIdeal(), "leaf", tools, { box: { x: 0, y: 0, w: 50, h: 50 } })!;
  const state = setSpec({ objects: [made], merges: [] }, made.id, 0, { aspect: "x", expr: "@mid.x", options: [] }, read);
  assert.equal(placedValues(state.objects[0]).x, 130);
  // What a text refers to, and that runtime state for AI with what it reads now.
  const readings = readVariables(variables, expr => readNow(expr));
  assert.deepEqual(refsIn(["as big as @first and @second.w together", 's("@picked", "0")', "@second.q"], variables).map(item => item.id), ["first", "second"]);
  assert.deepEqual(describeRefs(readings, ["at @mid.x"]), [{ id: "mid", name: "Midpoint of both", means: "Where the two meet halfway",
    fields: [{ ref: "@mid.x", expr: variables[2].fields[0].expr, code: "(store[0].x + store[1].x) / 2", now: 130 }, { ref: "@mid.y", expr: variables[2].fields[1].expr, code: "(store[0].y + store[1].y) / 2", now: 210 }] }]);
  // Rules to choose on a tag include the places and sizes it holds.
  assert.ok(specExamples({ tools, presets: [], variables }).some(item => item.aspect === "x" && item.expr === "@mid.x" && item.note === "Midpoint of both ((store[0].x + store[1].x) / 2)"));
  // As kept: fields once, reading by themselves (not the object's own box, not another reference), ids once.
  assert.deepEqual(keptVariables([{ ...variables[0], fields: [...variables[0].fields, { key: "x", expr: "1" }, { key: "own", expr: 'item("w")' }, { key: "bad", expr: "max(" }] }, variables[0],
    { ...variables[1], fields: [{ key: "other", expr: "@first.x" }] }]).map(item => [item.id, item.fields.map(field => field.key)]), [["first", ["x", "y", "w", "h"]]]);
  // Tools asked for later bring their runtime state; one of an id there replaces it.
  const kit = { reading: "r", tools, presets: [], variables: variables.slice(0, 2) };
  assert.deepEqual(withTools(kit, { reading: "", tools: [], presets: [], variables: [{ ...variables[2] }, { ...variables[0], name: "Older heart" }] }).variables.map(item => item.name), ["Heart 2", "Midpoint of both", "Older heart"]);
  // Writing `@`: what is typed after it, not inside a quoted part of a rule nor in a word.
  assert.deepEqual(refAt("x + @mi", 7), { from: 4, typed: "mi" }); assert.equal(refAt('s("@pi', 6, true), null); assert.equal(refAt("me@home", 7), null);
  assert.deepEqual(refMatches(refChoices(readings), "mid").map(item => item.ref), ["@mid.x", "@mid.y"]);
  assert.deepEqual(refMatches(refChoices(readings), "heart 2").map(item => item.ref), ["@second.x", "@second.y", "@second.w", "@second.h"], "by name too");
  assert.match(renderToStaticMarkup(createElement(RefInput, { value: "@first.w", onValue: noop, refs: refChoices(readings), code: true, className: "expr", wrapClassName: "expr" })), /<span class="ref-input expr"><input class="expr" value="@first\.w"\/><\/span>/);
  // Inspect tools: one per variable; the inspected ones listed with what they read now, and drawn where they are.
  const panel = renderToStaticMarkup(createElement(IdealTools, { state, onState: noop, kit: { ...kit, variables }, mode: "select", onMode: noop, selected: [made.id], onSelect: noop, marks: [], onMarks: noop,
    editable: true, busy: false, preset: "", onPreset: noop, making: false, onMake: noop, changes: [], onStateValues: noop, objects: [], current: [], read, variables: readings, inspecting: ["mid"], onInspect: noop }));
  assert.match(panel, /class="kit inspect active" aria-pressed="true"[^>]*><svg[^]*?<\/svg>Midpoint of both<\/button>/);
  assert.match(panel, /class="kit inspect " aria-pressed="false"[^>]*><svg[^]*?<\/svg>Heart 1<\/button>/);
  assert.match(panel, /<code title="[^"]*">@mid\.x \(\(store\[0\]\.x \+ store\[1\]\.x\) \/ 2\) 130<\/code><code title="[^"]*">@mid\.y \(\(store\[0\]\.y \+ store\[1\]\.y\) \/ 2\) 210<\/code>/);
  const tagOnPicture = renderToStaticMarkup(createElement(TagControl, { state, onState: noop, id: made.id, objects: [], tools, refs: refChoices(readings), editable: true, examples: specExamples({ ...kit, variables }), read }));
  assert.match(tagOnPicture, /placeholder="a rule · @ state"[^>]*role="combobox"/);
  const marks = renderToStaticMarkup(createElement(VariableMarks, { readings }));
  assert.match(marks, /<rect x="80" y="180" width="40" height="40"/, "a place with a size: the box around it");
  assert.match(marks, />@mid Midpoint of both \(\(store\[0\]\.x \+ store\[1\]\.x\) \/ 2, \(store\[0\]\.y \+ st…\)<\/text>/); assert.match(marks, />@second Heart 2 \(store\[1\], store\[1\]\.size\) · w 60 · h 60<\/text>/);
  // AI: the kit keeps the runtime state that reads; the fix is told what the references are.
  await withMockedAI(() => ({ reading: "r", tools: [tools[0]], presets: [], variables: [...variables, { ...variables[0], id: "own", fields: [{ key: "w", expr: 'item("w")' }] }] }), async () => {
    assert.deepEqual(alignKitSchema.parse(await runAI(request("align-kit", {}), signal())).variables.map(item => item.id), ["first", "second", "mid"]);
  });
  const refs = describeRefs(readings, ["@mid.x", "as big as @first.w and @second.w together"]);
  const output = { kind: "constraint", nodeId: "tree", targetId: "branching-growth", targetIds: [], title: "t", detail: "d", changes: [], reply: "r" };
  await withMockedAI(() => output, async calls => {
    await runAI(request("align", { tools, variables, ideal: state, refs }, { instruction: "at @mid" }), signal());
    const sent = JSON.parse(calls[0].input[0].content[0].text);
    assert.deepEqual(sent.refs, refs); assert.equal(sent.drawn.objects[0].specs[0].expr, "@mid.x");
    assert.match(calls[0].instructions, /`refs` \(when present\)/);
  });
  await withMockedAI(() => output, async calls => {
    await runAI(request("align", { tools, ideal: state }, { instruction: "x" }), signal());
    assert.equal(JSON.parse(calls[0].input[0].content[0].text).refs, undefined, "nothing referred to: nothing said");
  });
});

test("a widget on a tag: AI makes it for what the rules written there mean (values, rules it writes with them, code drawn on the picture); manipulating it writes the rules", async () => {
  const made = drawnObject(emptyIdeal(), "leaf", tools, { box: { x: 100, y: 100, w: 40, h: 40 } })!;
  const item = { ...made, label: "Joined", specs: [{ aspect: "w", expr: "@first.w * 1.5", options: [{ expr: "@first.w * 1.5", note: "bigger" }] }, { aspect: "x", expr: "(@first.x + @second.x)/2", options: [] }] };
  const state: IdealState = { objects: [item, { ...made, id: "other", label: "Other" }], merges: [] };
  const variables: RuntimeVar[] = [{ id: "first", name: "First", means: "", color: "#e0457b", fields: [{ key: "x", expr: 's("tree", "leaves.0.x")' }, { key: "w", expr: "40" }] },
    { id: "second", name: "Second", means: "", color: "#2563eb", fields: [{ key: "x", expr: "200" }] }];
  const read: SpecReader = (expr, at) => { try { const value = evaluate(expandRefs(expr, variables), { values: {}, stores: { tree: { leaves: [{ x: 100, y: 100 }] } }, states: {}, step: 0, steps: 1, item: specScope(at), itemIndex: 0 }); return Number.isFinite(value) ? value : null; } catch { return null; } };
  const code = "rulegenHandle(function (h) { return { draw() { p.ellipse(h.item.cx, h.item.cy, 10, 10); }, dragged() { h.set('k', h.mouseX / 100); } }; });";
  const output = { reading: "As big as the first one, a bit bigger; centered between the two.", hint: "Drag the corner, slide between",
    params: [{ id: "k", label: "How much bigger", type: "number", value: 1.5, min: 0, max: 3, step: .05, options: [] }, { id: "t", label: "Where between", type: "number", value: .5, min: -.5, max: 1.5, step: .01, options: [] },
      { id: "k", label: "Again", type: "number", value: 9, min: 0, max: 1, step: .1, options: [] }, { id: "pick", label: "Which", type: "select", value: "x", min: 0, max: 1, step: .01, options: [] },
      { id: "tint", label: "Color", type: "color", value: "#ff8800", min: 0, max: 1, step: .01, options: [] }],
    rules: [{ aspect: "w", expr: "@first.w * ${k}" }, { aspect: "x", expr: "@first.x + (@second.x - @first.x)*${t}" }, { aspect: "y", expr: "${nothing}" }, { aspect: "color", expr: "${tint}" }],
    code };
  // AI gets the object, the rules on its tag with what each reads now, the others, all the runtime state; what it makes is kept usable and its code guarded.
  await withMockedAI(() => output, async calls => {
    const widget = { object: item.id, box: { x: 100, y: 100, w: 40, h: 40 }, rules: [{ aspect: "w", expr: "@first.w * 1.5", now: 60 }, { aspect: "x", expr: "(@first.x + @second.x)/2", now: 150 }], current: null };
    const refs = describeRefs(readVariables(variables, expr => read(expr, item)), ["@first", "@second"]);
    const result = await runAI(requestSchema.parse({ ...request("align", { tools, ideal: state, refs, widget }), intent: "tag-widget" }), signal()) as never as TagWidget;
    const sent = JSON.parse(calls[0].input[0].content[0].text);
    assert.match(calls[0].instructions, /tag-widget — a direct manipulation widget for the rules on a tag/);
    assert.deepEqual([sent.object.id, sent.object.label, sent.object.rules, sent.others.map((other: { id: string }) => other.id)], [item.id, "Joined", widget.rules, ["other"]]);
    assert.deepEqual(sent.refs.map((ref: { id: string }) => ref.id), ["first", "second"]); assert.equal(sent.refs[0].fields[0].code, "leaves[0].x");
    assert.deepEqual(result.params.map(param => [param.id, param.value]), [["k", 1.5], ["t", .5], ["tint", "#ff8800"]], "each once, of its kind (a select with no options goes)");
    assert.deepEqual(result.rules, [{ aspect: "w", expr: "@first.w * ${k}" }, { aspect: "x", expr: "@first.x + (@second.x - @first.x)*${t}" }, { aspect: "color", expr: "${tint}" }], "only rules of its values");
    assert.match(result.prepared, /__rulegenGuard/);
    await assert.rejects(runAI(requestSchema.parse({ ...request("align", { tools, ideal: state, widget: { ...widget, rules: [] } }), intent: "tag-widget" }), signal()), /Write a rule on the tag first/);
  });
  await withMockedAI(() => ({ ...output, code: "document.body.innerHTML = ''" }), async () => {
    const widget = { object: item.id, box: { x: 0, y: 0, w: 1, h: 1 }, rules: [{ aspect: "w", expr: "1", now: 1 }], current: null };
    await assert.rejects(runAI(requestSchema.parse({ ...request("align", { tools, ideal: state, widget }), intent: "tag-widget" }), signal()), /rulegenHandle/, "a widget that does not register is not kept");
  });
  // Its values kept to their kinds; the rules it writes with them; manipulated, the object's rules follow (readings kept) and it is placed by them.
  const spec = keptWidget(output as never), number = spec.params[0];
  assert.deepEqual([widgetValue(number, 2.02), widgetValue(number, 99), widgetValue(number, "x"), widgetValue(spec.params[2], "#00ff00"), widgetValue(spec.params[2], "red")], [2, 3, undefined, "#00ff00", undefined]);
  assert.deepEqual(widgetValue({ ...number, type: "select", options: ["@first.x", "@second.x"] }, 1), "@second.x");
  assert.deepEqual(widgetRules(spec, { k: 2, t: .25, tint: "#00ff00" }), [{ aspect: "w", expr: "@first.w * 2" }, { aspect: "x", expr: "@first.x + (@second.x - @first.x)*0.25" }, { aspect: "color", expr: '"#00ff00"' }]);
  assert.deepEqual(widgetStart(spec), { k: 1.5, t: .5, tint: "#ff8800" });
  const moved = applyWidget(state, item.id, spec, { k: 2, t: .25, tint: "#00ff00" }, read).objects[0];
  assert.deepEqual(moved.specs.map(entry => entry.expr), ["@first.w * 2", "@first.x + (@second.x - @first.x)*0.25", '"#00ff00"']);
  assert.deepEqual(moved.specs[0].options, item.specs[0].options); assert.deepEqual([placedValues(moved).w, placedValues(moved).x], [80, 125]);
  assert.throws(() => keptWidget({ ...output, rules: [{ aspect: "w", expr: "${gone}" }] } as never), /changes nothing/);
  // The button: only once a rule is written; AI making it; made: open it again, or remake it; why it could not.
  const control = (widget: Partial<WidgetControl>, on = state) => renderToStaticMarkup(createElement(TagControl, { state: on, onState: noop, id: item.id, objects: [], tools, refs: [], editable: true, examples: [], read,
    widget: { on: false, can: widgetCan(on.objects[0]), made: false, making: false, error: "", hint: "", toggle: noop, remake: noop, ...widget } }));
  assert.doesNotMatch(control({}, { objects: [{ ...item, specs: [] }], merges: [] }), /widget/i, "nothing written: no button");
  assert.match(control({}), />Create widget<\/button>/); assert.doesNotMatch(control({}), /Remake/);
  assert.match(control({ making: true }), /disabled=""[^>]*><span class="loading-spinner"><\/span>Making widget…<\/button>/);
  assert.match(control({ made: true, on: true }), />Close widget<\/button><button[^>]*>[^]*?Remake<\/button>/);
  assert.match(control({ error: "Could not make the widget." }), /class="ideal-widget-error" role="alert">Could not make the widget.<\/p>/);
  assert.match(control({ made: true, on: true, hint: "Drag the corner" }), /class="ideal-widget-hint" role="status">Widget on the picture · Drag the corner<\/p>/, "open: what to grab is said");
  assert.doesNotMatch(control({ made: true, hint: "Drag the corner" }), /ideal-widget-hint/, "closed: not said");
  // On the picture: its code runs isolated over the frame, given what it reads; the picture's input goes to it.
  const widget: TagWidget = { ...spec, id: item.id, prepared: "rulegenHandle(function(h){return {};});", values: widgetStart(spec) };
  const world = { values: widget.values, item: { x: 100, y: 100, w: 40, h: 40, cx: 120, cy: 120 }, others: [], rules: { w: 60 }, refs: { "@first.x": 100 } };
  const document = tagWidgetDocument("t", "http://x", widget.prepared, widget.params, { ...world, px: 2 });
  // Sizes on screen: it is told how big a screen pixel is on the canvas (the board zoomed out: bigger), its defaults follow.
  assert.match(document, /"px":2/); assert.match(document, /get px\(\)\{return WORLD\.px>0\?WORLD\.px:1;\}/); assert.match(document, /p\.textSize\(12\*h\.px\);p\.strokeWeight\(h\.px\)/);
  assert.deepEqual([canvasPerScreen(900), canvasPerScreen(450), canvasPerScreen(300)], [1, 2, 3]);
  assert.match(readFileSync("prompts/tag-widget.md", "utf8"), /size everything for the SCREEN with `h\.px`/);
  assert.match(document, /background:transparent/); assert.match(document, /p\.clear\(\)/); assert.match(document, /"@first\.x":100/); assert.match(document, /connect-src 'none'/);
  const layer = renderToStaticMarkup(createElement(TagWidgetLayer, { widget, world, onValues: noop, onError: noop }));
  assert.match(layer, /<div class="tag-widget-stage "><iframe class="tag-widget-engine" title="Tag widget" sandbox="allow-scripts"[^>]*><\/iframe><div class="tag-widget-input" aria-label="Widget: Drag the corner, slide between"/);
});

test("runtime state is named with where it is in the brush's code", () => {
  assert.equal(codeState('s("brush", "items.3.w")'), "items[3].w");
  assert.equal(codeState('s("brush", "@runtime.center.1:3.value.x")'), 'runtime("center", "1:3").x');
  assert.equal(codeState('(s("brush", "items.3.x") + s("brush", "items.8.x")) / 2'), "(items[3].x + items[8].x) / 2");
  assert.equal(codeState('len("brush", "items")'), "items.length");
  const variable: RuntimeVar = { id: "green", name: "Earlier heart", means: "", color: "#22c55e",
    fields: [{ key: "x", expr: 's("brush", "@runtime.center.1:3.value.x")' }, { key: "y", expr: 's("brush", "@runtime.center.1:3.value.y")' }, { key: "w", expr: 's("brush", "items.3.w")' }] };
  assert.equal(variableCode(variable), 'runtime("center", "1:3"), items[3]');
  assert.deepEqual(specExamples({ tools: [], presets: [], variables: [variable] }).find(example => example.expr === "@green.w")!.note, "Earlier heart (items[3].w)");
  assert.deepEqual(describeRefs(readVariables([variable], () => 30), ["@green.w"])[0].fields.map(field => field.code), ['runtime("center", "1:3").x', 'runtime("center", "1:3").y', "items[3].w"]);
  const marks = renderToStaticMarkup(createElement(VariableMarks, { readings: readVariables([variable], () => 30) }));
  assert.match(marks, /@green Earlier heart \(runtime\(&quot;center&quot;, &quot;1:3&quot;\), items\[3\]\) · w 30/);
});

test("a tag on the picture: pressed, what it is on is selected; edited there, its one tag (no names offered), its rules line by line (added at once), its widget button; tags never cover each other", () => {
  const made = drawnObject(emptyIdeal(), "leaf", tools, { box: { x: 100, y: 300, w: 60, h: 60 } })!;
  const item = { ...made, label: "Grows", nodeId: "orb", specs: [{ aspect: "w", expr: "90", options: [{ expr: "90", note: "bigger" }, { expr: 'item("w")', note: "as drawn" }] }] };
  const state = { objects: [item], merges: [] }, read: SpecReader = expr => Number.isFinite(Number(expr)) ? Number(expr) : null;
  // One tag: its object of the brush and the user's words; both go to AI.
  assert.deepEqual(tagObjects(state, [item.id], "  Bigger ", "orb").objects[0], { ...item, label: "Bigger", nodeId: "orb" });
  assert.equal(describeIdeal(state, tools).objects[0].brushObject, "orb");
  assert.equal(describeIdeal(state, tools).objects[0].label, "Grows");
  // Written on the picture: a line per tag, then its rules; pressable while it can be edited; the one edited not written.
  const sheet = (editable: boolean, tagEditing: string | null = null) => renderToStaticMarkup(createElement(IdealSheet, { state, onState: noop, tools, mode: "run", marks: [], onMarks: noop, shot: "", selected: [], onSelect: noop, editable, objectNames: { orb: "Orb" }, read, onTagPress: noop, tagEditing }));
  assert.match(sheet(true), /<text class="ideal-label pressable"[^>]*><title>Press to edit this tag<\/title><tspan[^>]*class="">Orb · Grows<\/tspan><tspan[^>]*class="ideal-spec">w = 90/);
  assert.match(sheet(false), /<text class="ideal-label"[^>]*><tspan/);
  assert.doesNotMatch(sheet(true, item.id), /ideal-label/);
  // Which is edited: one object's, a merged form's when all of it is selected, else none (several: in the panel).
  const merged = mergeObjects({ objects: [item, { ...item, id: "two" }], merges: [] }, [item.id, "two"], "One");
  assert.equal(tagTarget(state, [item.id]), item.id); assert.equal(tagTarget(merged, [item.id, "two"]), merged.merges[0].id); assert.equal(tagTarget(state, []), null);
  assert.deepEqual(tagBox(state, item.id), { x: 100, y: 300, w: 60, h: 60 });
  // The control: its one tag (object dropdown, words; no names offered, no second tag), the widget, each rule a line, + Rule.
  const control = renderToStaticMarkup(createElement(TagControl, { state, onState: noop, id: item.id, objects: [{ id: "orb", name: "Orb" }], tools, refs: [], editable: true, examples: [], read, at: { x: 90, y: 180 }, widget: { on: false, can: true, made: false, making: false, error: "", hint: "", toggle: noop, remake: noop } }));
  assert.match(control, /class="ideal-tag-control placed" style="left:10%;top:30%"/);
  assert.equal(control.match(/class="ideal-tag-field"/g)?.length, 1, "one tag on an object");
  assert.match(control, /<option value="orb" selected="">Orb<\/option>[^]*?value="Grows"/);
  assert.doesNotMatch(control, />\+ Tag<\/button>|Remove this tag|aria-label="Words on the tag"[^>]*role="combobox"/); assert.match(control, />Create widget<\/button>/);
  assert.match(control, /aria-label="What it sets" placeholder="w h x y…" value="w"[^]*?aria-label="Its rule"[^]*?value="90"/); assert.match(control, /\+ Rule/);
  assert.ok(controlSize(state, item.id, 1).height > controlSize(state, item.id, 2).height, "measured in canvas pixels");
  const none = renderToStaticMarkup(createElement(TagControl, { state, onState: noop, id: item.id, objects: [], tools, refs: [], editable: true, examples: [], read, widget: { on: false, can: false, made: false, making: false, error: "", hint: "", toggle: noop, remake: noop } }));
  assert.doesNotMatch(none, /Create widget/, "nothing in its rules to drag: no widget button"); assert.doesNotMatch(none, /<select class="ideal-tag-link/, "no objects of the brush: words only");
  const onMerge = renderToStaticMarkup(createElement(TagControl, { state: merged, onState: noop, id: merged.merges[0].id, objects: [], tools, refs: [], editable: true, examples: [], read, widget: { on: false, can: true, made: false, making: false, error: "", hint: "", toggle: noop, remake: noop } }));
  assert.match(onMerge, /value="One"/); assert.doesNotMatch(onMerge, /widget|Its rule/);
  // Never covering each other, the frame's other texts, or what they are about.
  const blocks = tagBlocks({ objects: [item, { ...item, id: "near", box: { x: 120, y: 300, w: 60, h: 60 } }], merges: [] }, { orb: "Orb" }, read);
  const caption = { x: 0, y: 0, width: 900, height: 40 };
  const spots = layoutBlocks(blocks.map(block => ({ key: block.key, ...blockSize(block), shape: block.box })), { width: 900, height: 600 }, [caption]);
  const over = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  assert.equal(spots.length, 2); assert.ok(!over(spots[0], spots[1]), "the two tags apart");
  for (const spot of spots) { assert.ok(!over(spot, caption)); for (const block of blocks) assert.ok(!over(spot, { x: block.box.x, y: block.box.y, width: block.box.w, height: block.box.h }), "not over what they are about"); }
});

// ── Tools that change what the frame shows: inspect, draw a behavior, draw the state wanted ──

const reachBehavior: AlignTool = { id: "reach", kind: "behavior", name: "Orb reach", hint: "Drag a circle: the orb is drawn that big", color: "#e07b00", label: "Orb reach", closed: true, template: square, labels: [], handles: [], nodeId: "", specs: [],
  values: [{ id: "r", label: "Reach", kind: "number", expr: 'item("w") / 2', fallback: 0 }],
  patch: { nodeId: "orb", edits: [{ find: 'm.v("orb/radius") * 2', replace: 'Math.max(m.v("orb/radius") * 2, m.opt(0, "@tool/reach/r") * 2)' }] }, probe: { x: 200, y: 260, w: 120, h: 120 } };

test("a behavior tool: what is drawn with it gives values its own code reads, in the frame's program only; the brush draws as it is until something is drawn", () => {
  const scene = sampleScene(), code = connectScene({ title: "Tree", explanation: "", code: sceneProgram }, scene).code;
  const missing = { ...reachBehavior, id: "missing", patch: { nodeId: "orb", edits: [{ find: "no such code", replace: 'm.opt(0, "@tool/missing/r")' }] } };
  const deaf = { ...reachBehavior, id: "deaf", patch: { nodeId: "orb", edits: [{ find: 'm.v("orb/radius") * 2', replace: 'm.v("orb/radius") * 3' }] } };
  assert.equal(readsBehavior(reachBehavior), true); assert.equal(readsBehavior(deaf), false, "its code must read every value it gives");
  const made = behaviorProgram(code, scene, [reachBehavior, missing, deaf, tools[0]]);
  assert.deepEqual(made.failed, ["missing", "deaf"], "a patch that does not apply, or does not read its values, is left out");
  assert.equal(made.reasons.missing, "its code is not in this frame's program");
  // Two behaviors that change the same code: the first goes in, the other is left out, saying which it collides with.
  const same = { ...reachBehavior, id: "same", name: "Same reach", patch: { nodeId: "orb", edits: [{ find: 'return m.v("orb/radius") * 2;', replace: 'return m.opt(0, "@tool/same/r");' }] } };
  const both = behaviorProgram(code, scene, [reachBehavior, same]);
  assert.deepEqual([both.failed, both.reasons.same], [["same"], "it changes the same code as “Orb reach”"]);
  // Checkpoints go in after the behaviors; one whose code a behavior changed is left out (they only explain), not the behavior.
  const checkpoint = { nodeId: "orb", find: 'return m.v("orb/radius") * 2;', replace: 'return m.v("orb/radius") * 2 /* traced */;' };
  assert.ok("error" in exploreProgram(made.code, scene, { edits: [checkpoint] }));
  assert.deepEqual((exploreProgram(made.code, scene, { edits: [checkpoint] }, {}, true) as { skipped: number }).skipped, 1);
  assert.match(made.code, /"@tool\/reach\/r": 0/, "its value is in the scene block, at its fallback");
  const sketch = run(made.code), original = run(code);
  sketch.draw(); original.draw();
  assert.deepEqual(sketch.circles, original.circles, "nothing drawn: the brush draws exactly as it does");
  sketch.circles.length = 0; sketch.read("rulegenParams['@tool/reach/r'] = 60"); sketch.draw();
  assert.equal(sketch.circles[0][2], 120, "the value drawn changes what the brush draws");
  // What is drawn gives the values: where it is now (moved, sized), an outline around its center; none drawn, none given.
  const kit = [reachBehavior, { ...reachBehavior, id: "region", values: [{ id: "shape", label: "Region", kind: "outline" as const, expr: "", fallback: "[]" }] }];
  const read: SpecReader = (expr, item) => { try { const value = evaluate(expr, { values: {}, states: {}, step: 0, steps: 1, stores: {}, item: specScope(item), itemIndex: 0 }); return Number.isFinite(value) ? value : null; } catch { return null; } };
  const drawn = drawnObject(emptyIdeal(), "reach", kit, { box: { x: 100, y: 100, w: 80, h: 80 } })!;
  assert.deepEqual(behaviorValues({ objects: [drawn], merges: [] }, kit, read), { "@tool/reach/r": 40 });
  assert.deepEqual(behaviorValues({ objects: [{ ...drawn, scale: 2 }], merges: [] }, kit, read), { "@tool/reach/r": 80 }, "sized by hand: read as it is now");
  assert.deepEqual(behaviorValues(emptyIdeal(), kit, read), {}, "none drawn: the code reads its fallback");
  const region = drawnObject(emptyIdeal(), "region", kit, { box: { x: 0, y: 0, w: 40, h: 20 } })!;
  assert.deepEqual(JSON.parse(behaviorValues({ objects: [region], merges: [] }, kit, read)["@tool/region/shape"] as string), [[-20, -10], [20, -10], [20, 10], [-20, 10]]);
  assert.deepEqual(behaviorFallbacks(kit), { "@tool/reach/r": 0, "@tool/region/shape": "[]" });
  // Its check draws a typical drawing of it (its probe) at this moment.
  assert.deepEqual(behaviorValuesOf(reachBehavior, behaviorProbe(reachBehavior, kit)!, read), { "@tool/reach/r": 60 });
  assert.equal(behaviorProbe({ ...reachBehavior, probe: { x: 0, y: 0, w: 0, h: 0 } }, kit), null);
  // An item of a list is read by its own id, wherever it is in the list at a moment.
  assert.equal(evaluate('s("tree", "leaves.id=b.w")', { values: {}, states: {}, step: 0, steps: 1, stores: { tree: { leaves: [{ id: "a", w: 1 }, { id: "b", w: 7 }] } } }), 7);
});

test("align-kit keeps only tools that change what the frame shows: a behavior whose code goes in and reads its values, no names offered, rules the drawing shows", async () => {
  const badFind = { ...reachBehavior, id: "bad-find", patch: { nodeId: "orb", edits: [{ find: "nowhere in the code", replace: 'm.opt(0, "@tool/bad-find/r")' }] } };
  const noProbe = { ...reachBehavior, id: "no-probe", probe: { x: 0, y: 0, w: 0, h: 0 } };
  const otherBrush = { ...reachBehavior, id: "elsewhere", patch: { nodeId: "ghost", edits: reachBehavior.patch!.edits } };
  const leaf = { ...tools[0], specs: [{ aspect: "w", expr: "", options: [{ expr: 'item("w")', note: "as drawn" }] }, { aspect: "when", expr: "they touch", options: [] }] };
  const unguarded = { ...reachBehavior, id: "unguarded", patch: { nodeId: "orb", edits: [{ find: 'm.v("orb/radius") * 2', replace: '(document.title.length + m.opt(0, "@tool/unguarded/r"))' }] } };
  const output = { reading: "r", tools: [reachBehavior, badFind, noProbe, otherBrush, unguarded, tools[4], leaf], presets: [], variables: [] };
  await withMockedAI(() => output, async calls => {
    const kit = alignKitSchema.parse(await runAI(request("align-kit", {}), signal()));
    assert.deepEqual(kit.tools.map(tool => tool.id), ["reach", "leaf"], "a behavior whose code cannot go in, cannot be checked or would not run (document) and a tool of names are not made");
    assert.deepEqual(kit.tools[1].specs.map(spec => spec.aspect), ["w"], "a rule the drawing cannot show is not a rule");
    assert.deepEqual(kit.tools[0].patch, reachBehavior.patch); assert.deepEqual(kit.tools[1].values, []);
    assert.match(calls[0].instructions, /every one changes what the frame shows/); assert.match(calls[0].instructions, /Draw a procedural behavior/);
  });
  // The prompt's example is a kit that passes these checks.
  const prompt = readFileSync("prompts/align-kit.md", "utf8"), example = alignKitSchema.parse(JSON.parse(prompt.slice(prompt.lastIndexOf("```json") + 7, prompt.lastIndexOf("```"))));
  assert.ok(example.tools.some(tool => tool.kind === "behavior" && readsBehavior(tool)));
});

test("the kit's tools in three groups: inspect, behavior, desired state; what changes nothing at this moment is left out, said so", () => {
  const kit = { reading: "r", presets: [], variables: [], tools: [{ ...reachTool, id: "leaf-reach" }, reachBehavior, tools[0], tools[3], tools[4]] };
  const render = (props: object) => renderToStaticMarkup(createElement(IdealTools, { state: emptyIdeal(), onState: noop, kit, mode: "run", onMode: noop, selected: [], onSelect: noop, marks: [], onMarks: noop,
    editable: true, busy: false, preset: "", onPreset: noop, making: false, onMake: noop, changes: [], onStateValues: noop, objects: [], current: [], ...props }));
  const html = render({});
  assert.match(html, /aria-label="Inspect"[^>]*><em>Inspect<\/em><button[^>]*>[^]*?Leaf reach<\/button><\/span>/);
  assert.match(html, /aria-label="Behavior"[^>]*><em>Behavior<\/em><button[^>]*><i[^>]*><\/i>Orb reach<\/button><\/span>/);
  assert.match(html, /aria-label="Desired state"[^>]*><em>Desired state<\/em><button[^>]*><i[^>]*><\/i>Leaf<\/button><button[^>]*><i[^>]*><\/i>Merge outlines<\/button><\/span>/);
  assert.doesNotMatch(html, /Mark as/, "a tool of names is not shown");
  const left = render({ dead: { tools: ["reach"], variables: [] } });
  assert.doesNotMatch(left, />Orb reach<\/button>/); assert.match(left, /Left out at this moment: Orb reach/);
  const chosen = render({ mode: "tool:reach", behaving: { "@tool/reach/r": 42 } });
  assert.match(chosen, /aria-label="What the brush runs with"><li><span><b>Reach<\/b> 42<\/span>/);
  assert.match(render({ mode: "tool:reach" }), /<b>Reach<\/b> not drawn yet: the brush as it is/);
  // A behavior is checked, and shown once drawn, over the whole run by the brush's own code: partway, a step's own picture need not show it.
  assert.match(readFileSync("app/components/code-preview.tsx", "utf8"), /whole\?null:pinnedRun\.budget,whole\?null:pinnedRun\.show/);
  const frame = readFileSync("app/components/explore-frame.tsx", "utf8");
  assert.match(frame, /variantShot\(\{ id: "none", params: none \}, true\)/); assert.match(frame, /run: behaviorOn \? \{ budget: null, roots: frame\.nodeIds, show: null \}/);
});
