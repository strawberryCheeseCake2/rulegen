import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { aiCompositionPromptSchema, settleComposeTags, type AIComposeTag } from "../app/lib/compose-tags";
import { compositionPromptSchema } from "../app/lib/schema";
import { recoverGeneration } from "../app/lib/generation-recovery";
import { requestSchema } from "../app/lib/schema";

const line = (id: string, x0: number, y0: number, x1: number, y1: number, tool = "pencil") => ({ id, tool, points: [{ x: x0, y: y0 }, { x: x1, y: y1 }] });
const tag = (over: Partial<AIComposeTag>): AIComposeTag => ({ id: "t", kind: "object", label: "Part", parentId: "", strokeIds: [], summary: "", members: "", constraints: [], ...over });
const strokes = [line("stroke-1", .1, .1, .2, .2), line("stroke-2", .5, .5, .6, .7), line("stroke-3", .55, .55, .9, .9), line("stroke-4", 0, 0, 1, 1, "eraser")];

test("compose tags sit on the marks they name: the box is taken from those strokes, never from coordinates the AI writes", () => {
  const [one] = settleComposeTags([tag({ id: "a", strokeIds: ["stroke-2", "stroke-4", "stroke-404", "stroke-2"] })], strokes, []);
  assert.deepEqual(one.strokeIds, ["stroke-2"]);
  assert.ok(Math.abs(one.box.x - .488) < 1e-9 && Math.abs(one.box.y - .488) < 1e-9 && Math.abs(one.box.w - .124) < 1e-9 && Math.abs(one.box.h - .224) < 1e-9);
  // No drawn mark (only an eraser or unknown ids): no tag.
  assert.deepEqual(settleComposeTags([tag({ id: "b", strokeIds: ["stroke-4", "nope"] })], strokes, []), []);
});

test("compose tags nest only in collections, without loops, and a collection takes in its members' marks", () => {
  const settled = settleComposeTags([
    tag({ id: "c", kind: "collection", strokeIds: ["stroke-1"], members: "a few marks" }),
    tag({ id: "o", parentId: "c", strokeIds: ["stroke-3"], members: "dropped for an object" }),
    tag({ id: "p", parentId: "o", strokeIds: ["stroke-2"] }), // an object is no parent
    tag({ id: "x", kind: "collection", parentId: "y", strokeIds: ["stroke-2"] }), tag({ id: "y", kind: "collection", parentId: "x", strokeIds: ["stroke-2"] }),
    tag({ id: "c", strokeIds: ["stroke-2"] }), // a repeated id
  ], strokes, []);
  const byId = Object.fromEntries(settled.map(item => [item.id, item]));
  assert.deepEqual(settled.map(item => item.id), ["c", "o", "p", "x", "y"]);
  assert.equal(byId.o.parentId, "c"); assert.equal(byId.p.parentId, ""); assert.equal(byId.o.members, ""); assert.equal(byId.c.members, "a few marks");
  assert.ok(!(byId.x.parentId === "y" && byId.y.parentId === "x"));
  // The collection's box holds its own mark and its member's.
  assert.ok(byId.c.box.x <= .1 && byId.c.box.x + byId.c.box.w >= .9 && byId.c.box.y + byId.c.box.h >= .9);
});

test("a compose tag's constraints name the pen that carries them (its name and color), none for an unknown pen", () => {
  const [one] = settleComposeTags([tag({ id: "a", strokeIds: ["stroke-1"], constraints: [
    { label: "Size", effect: "spatial", how: "grows", penId: "mark-pen-1", params: [{ label: "Ratio", value: "0.8", how: "per step" }] },
    { label: "Fade", effect: "stylistic", how: "", penId: "mark-pen-9", params: [] }] })], strokes, [{ id: "mark-pen-1", name: "Power", color: "#3b73c4" }]);
  assert.deepEqual(one.constraints.map(item => item.pen && [item.pen.name, item.pen.color]), [["Power", "#3b73c4"], null]);
  assert.equal(one.constraints[0].params[0].value, "0.8");
});

test("compose-prompt results without tags still read, and a restored draft puts its tags back on the frame", () => {
  assert.deepEqual(compositionPromptSchema.parse({ prompt: "- Old prompt" }).tags, []);
  const [settled] = settleComposeTags([tag({ id: "a", strokeIds: ["stroke-1"] })], strokes, []);
  const restored = recoverGeneration(requestSchema.parse({ intent: "compose-prompt", image: "data:image/png;base64,YQ==" }), { prompt: "- New", tags: [settled] });
  const panel = restored.project.sketchPanels[restored.owner];
  assert.equal(panel.composePrompt, "- New"); assert.equal(panel.composeTags[0].id, "a"); assert.equal(panel.composeTagsRevision, restored.project.artwork.revision);
});

test("the compose-prompt prompt asks for tags on stroke ids, with no coordinates, and stays general", () => {
  const prompt = readFileSync("prompts/compose-prompt.md", "utf8");
  assert.match(prompt, /## Tags on the sketch/); assert.match(prompt, /strokeIds/); assert.match(prompt, /do not write coordinates/);
  assert.doesNotMatch(prompt, /heart|merged!/i);
});

test("a tag's constraint finds the minimal examples Decompose made of it, through the pen that carries it", async () => {
  const { penExamples } = await import("../app/lib/compose-tags");
  const { sampleScene } = await import("./fixtures/scene");
  const scene = sampleScene(), pen = (over: object) => ({ name: "Pen", color: "#3b73c4", frameId: "a", nodeId: "tree", constraint: "", algorithmId: "", ...over });
  const frames = { a: { scene, exampleOf: null }, ex1: { scene, exampleOf: { frameId: "a", nodeId: "tree", constraintId: "branching-growth" } }, ex2: { scene, exampleOf: { frameId: "a", nodeId: "orb", constraintId: "pulse" } }, other: { scene, exampleOf: { frameId: "b", nodeId: "tree", constraintId: "branching-growth" } } };
  assert.deepEqual(penExamples(pen({ constraint: "branches" }), frames), ["ex1"], "a constraint pen: the examples of the constraint it was taken from");
  assert.deepEqual(penExamples(pen({ algorithmId: "recursive-branch" }), frames), ["ex1"], "an algorithm pen: the examples of the constraints using its algorithm");
  assert.deepEqual(penExamples(pen({ frameId: "ex2", nodeId: "orb", constraint: "size" }), frames), ["ex2"], "a pen made from an example: that example");
  assert.deepEqual(penExamples(pen({ constraint: "Nope" }), frames), []); assert.deepEqual(penExamples(null, frames), []);
  assert.deepEqual(penExamples(pen({ frameId: "gone", constraint: "branches" }), frames), []);
});

test("Compose without the text prompt sends the tags on the sketch and no text, and keeps composing from them (not tagging again) after the sketch changed", async () => {
  const { sceneAI } = await import("../app/studio/scene-actions");
  const { createSketchPanel } = await import("../app/lib/sketch-panels");
  const { sampleScene } = await import("./fixtures/scene");
  const [settled] = settleComposeTags([tag({ id: "a", kind: "collection", strokeIds: ["stroke-1"] })], strokes, []);
  const panels: Record<string, ReturnType<typeof createSketchPanel>> = { s: { ...createSketchPanel({ composePrompt: "- Old text", composeTags: [settled], composeTagsRevision: 1, composeWithText: false }) } };
  let revision = 1, frames = 0;
  const calls: { intent: string; input: any }[] = [];
  const deps = {
    panel: (id: string) => panels[id] ?? createSketchPanel(), activate: () => {}, toast: () => {}, focus: () => {}, documentId: () => 1, requestId: () => 1, preview: () => undefined, active: () => "s", refreshBrushCode: () => {}, addBrushes: () => [],
    updatePanel: (id: string, patch: any) => { const base = panels[id] ?? createSketchPanel(); panels[id] = { ...base, ...(typeof patch === "function" ? patch(base) : patch) }; },
    createFrame: () => { const id = `sketch-${++frames}`; panels[id] = createSketchPanel(); return id; },
    task: async (_label: string, work: () => Promise<void>) => { await work(); },
    request: async (intent: string, input: any) => { calls.push({ intent, input });
      return intent === "compose" ? sampleScene() : intent === "compose-prompt" ? { prompt: "- New", tags: [settled] } : { title: "x", explanation: "", code: "rulegenModule(\"x\", function (m) { return { draw() {} }; });" }; },
    capture: async () => ({ image: "data:image/png;base64,AAAA", region: { x: 0, y: 0, w: 1, h: 1 } }),
    artwork: () => ({ name: "s", photo: null, strokes: [], revision }),
  } as any;
  await sceneAI(deps, "s").compose();
  assert.deepEqual(calls.map(call => call.intent), ["compose", "code"]);
  assert.equal(calls[0].input.instruction, ""); assert.deepEqual(calls[0].input.composeTags.map((item: { id: string }) => item.id), ["a"]);
  assert.equal(calls[1].input.instruction, "", "the code step gets no text either");
  assert.equal(panels["sketch-1"].composeWithText, false);
  // The sketch changed after tagging: Compose still composes from the tags as they are; reading the sketch again is the user's Regenerate.
  calls.length = 0; revision = 2;
  await sceneAI(deps, "s").compose();
  assert.deepEqual(calls.map(call => call.intent), ["compose", "code"]); assert.equal(panels.s.composeTagsRevision, 1);
  // Only a frame with no tags yet is tagged first.
  calls.length = 0; panels.s = { ...panels.s, composeTags: [] };
  await sceneAI(deps, "s").compose();
  assert.deepEqual(calls.map(call => call.intent), ["compose-prompt"]);
});

test("the compose intent takes the tags in place of a text prompt, without their boxes or where their pens were made", async () => {
  const { intents } = await import("../app/server/intents.server");
  const [settled] = settleComposeTags([tag({ id: "a", strokeIds: ["stroke-1"], constraints: [{ label: "Size", effect: "spatial", how: "", penId: "p", params: [] }] })], strokes, [{ id: "p", name: "Power", color: "#3b73c4", sourceSketchId: "f", source: { nodeId: "n" } }]);
  const image = "data:image/png;base64,YQ==";
  assert.match(intents.compose.check!(requestSchema.parse({ intent: "compose", image }))!, /Compose prompt \(or its tags/);
  const input = requestSchema.parse({ intent: "compose", image, composeTags: [settled] });
  assert.equal(intents.compose.check!(input), undefined);
  const sent = intents.compose.context(input) as { tags: any[] };
  assert.equal(sent.tags[0].box, undefined); assert.deepEqual(sent.tags[0].constraints[0].pen, { name: "Power", color: "#3b73c4" });
  assert.match(readFileSync("prompts/compose.md", "utf8"), /## Tags on the sketch/);
});

test("a tag pen written before pens kept where they were made is found among the sketch's pens by name and color", async () => {
  const { placedPen, penExamples } = await import("../app/lib/compose-tags");
  const { sampleScene } = await import("./fixtures/scene");
  const old = { name: "Grow pen", color: "#C4547D", frameId: "", nodeId: "", constraint: "", algorithmId: "" };
  const pens = [{ id: "x", name: "Other", color: "#c4547d" }, { id: "y", name: "Grow pen", color: "#c4547d", sourceSketchId: "ex", source: { nodeId: "orb" }, constraint: { label: "size" } }];
  const placed = placedPen(old, pens)!;
  assert.deepEqual([placed.frameId, placed.nodeId, placed.constraint, placed.color], ["ex", "orb", "size", "#C4547D"]);
  assert.deepEqual(penExamples(placed, { ex: { scene: sampleScene(), exampleOf: { frameId: "a", nodeId: "orb", constraintId: "pulse" } } }), ["ex"]);
  assert.equal(placedPen(old, [])!.frameId, "", "no such pen: as it was");
});

test("a tag card floats beside its chip inside the window: under it, over it when there is more room there, and scrolls in the room left", async () => {
  const { cardSpot } = await import("../app/components/compose-tags");
  const view = { width: 1200, height: 800 };
  assert.deepEqual(cardSpot({ left: 100, top: 100, bottom: 124 }, view), { left: 100, top: 128, maxHeight: 664 });
  assert.deepEqual(cardSpot({ left: 1100, top: 700, bottom: 724 }, view), { left: 872, bottom: 104, maxHeight: 688 }, "near the bottom right: over the chip, pulled inside");
  assert.equal(cardSpot({ left: 0, top: 500, bottom: 524 }, view).top, 528, "enough room under it");
});

test("with the text prompt, Compose sends the tags as the user edited them along, also after the sketch changed, pointing only at marks still drawn", async () => {
  const { sceneAI } = await import("../app/studio/scene-actions");
  const { createSketchPanel } = await import("../app/lib/sketch-panels");
  const { sampleScene } = await import("./fixtures/scene");
  const [settled] = settleComposeTags([tag({ id: "a", strokeIds: ["stroke-1"], constraints: [{ label: "Size", effect: "spatial", how: "", penId: "", params: [{ label: "Ratio", value: "0.8", how: "" }] }] })], strokes, []);
  const edited = { ...settled, label: "Edited name", constraints: [{ ...settled.constraints[0], params: [{ label: "Ratio", value: "0.5", how: "smaller each step" }] }] };
  const panels: Record<string, ReturnType<typeof createSketchPanel>> = { s: createSketchPanel({ composePrompt: "- Text", composeTags: [edited], composeTagsRevision: 1 }) };
  let revision = 1;
  const calls: { intent: string; input: any }[] = [];
  const deps = {
    panel: (id: string) => panels[id] ?? createSketchPanel(), activate: () => {}, toast: () => {}, focus: () => {}, documentId: () => 1, requestId: () => 1, preview: () => undefined, active: () => "s", refreshBrushCode: () => {}, addBrushes: () => [],
    updatePanel: (id: string, patch: any) => { const base = panels[id] ?? createSketchPanel(); panels[id] = { ...base, ...(typeof patch === "function" ? patch(base) : patch) }; },
    createFrame: () => { const id = `sketch-${calls.length}`; panels[id] = createSketchPanel(); return id; },
    task: async (_label: string, work: () => Promise<void>) => { await work(); },
    request: async (intent: string, input: any) => { calls.push({ intent, input }); return intent === "compose" ? sampleScene() : { title: "x", explanation: "", code: "rulegenModule(\"x\", function (m) { return { draw() {} }; });" }; },
    capture: async () => ({ image: "data:image/png;base64,AAAA", region: { x: 0, y: 0, w: 1, h: 1 } }),
    artwork: () => ({ name: "s", photo: null, strokes: [], revision }),
  } as any;
  await sceneAI(deps, "s").compose();
  const sent = calls.find(call => call.intent === "compose")!.input;
  assert.equal(sent.instruction, "- Text"); assert.equal(sent.composeTags[0].label, "Edited name"); assert.equal(sent.composeTags[0].constraints[0].params[0].value, "0.5");
  calls.length = 0; revision = 2;
  await sceneAI(deps, "s").compose();
  const later = calls.find(call => call.intent === "compose")!.input.composeTags;
  assert.equal(later[0].label, "Edited name", "the edited tags go along after the sketch changed too");
  assert.deepEqual(later[0].strokeIds, [], "marks no longer in the sketch are not pointed at");
  assert.match(readFileSync("prompts/compose.md", "utf8"), /the tags decide each part they describe/);
});

test("tag-revise changes one constraint of a tag as asked: the AI sees the tags with their pens by id, and the result keeps the pen and goes in its place", async () => {
  const { runAI } = await import("../app/server/ai.server");
  const { withMockedAI } = await import("./fixtures/scene");
  const { reviseTag, tagRevisionSchema } = await import("../app/lib/compose-tags");
  const pens = [{ kind: "algorithm", id: "mark-pen-1", name: "Power", color: "#3b73c4", sourceSketchId: "f", source: { nodeId: "n", label: "N" }, meaning: "", algorithm: { call: { type: "algorithm", algorithmId: "power", args: [] }, library: [] } }];
  const tags = settleComposeTags([tag({ id: "a", strokeIds: ["stroke-1"], constraints: [
    { label: "Size", effect: "spatial", how: "grows", penId: "mark-pen-1", params: [{ label: "Exponent", value: "1.4", how: "" }] },
    { label: "Hover", effect: "temporal", how: "grows on hover", penId: "", params: [] }] })], strokes, pens);
  const image = "data:image/png;base64,YQ==", base = { intent: "tag-revise", image, compositionPens: pens, compositionStrokes: [{ id: "stroke-1", tool: "semantic", color: "#3b73c4", width: 2, opacity: 1, points: [{ x: .1, y: .1 }], semanticPenId: "mark-pen-1" }], composeTags: tags };
  const revised = { label: "Shrinking size", effect: "spatial", how: "shrinks along the path", penId: "mark-pen-1", params: [{ label: "Ratio", value: "0.8", how: "per item" }] };
  await withMockedAI(() => ({ constraint: revised, note: "Made it shrink." }), async calls => {
    const result = tagRevisionSchema.parse(await runAI(requestSchema.parse({ ...base, tagTarget: { tagId: "a", index: 0 }, instruction: "make it shrink instead" }), new AbortController().signal));
    const sent = JSON.parse(calls[0].input[0].content[0].text);
    assert.equal(sent.request, "make it shrink instead"); assert.deepEqual(sent.target, { tagId: "a", index: 0 });
    assert.equal(sent.tags[0].constraints[0].penId, "mark-pen-1"); assert.equal(sent.tags[0].box, undefined);
    assert.match(calls[0].instructions, /change one constraint of a Compose tag/);
    assert.equal(result.constraint.pen?.name, "Power"); assert.equal(result.constraint.pen?.frameId, "f");
    const next = reviseTag(tags, result);
    assert.deepEqual(next[0].constraints.map(item => item.label), ["Shrinking size", "Hover"], "only that constraint changes");
    assert.equal(next[0].constraints[0].params[0].value, "0.8");
    assert.deepEqual(reviseTag(tags, { ...result, tagId: "gone" }), tags);
    // Restoring it from the AI history puts the change back on the frame's tags.
    const restored = recoverGeneration(requestSchema.parse({ ...base, tagTarget: { tagId: "a", index: 0 }, instruction: "x", composeTags: tags }), result);
    assert.equal(restored.project.sketchPanels[restored.owner].composeTags.length, 0, "a log without a project has no tags to change");
  });
  await assert.rejects(runAI(requestSchema.parse({ ...base, tagTarget: { tagId: "a", index: 5 }, instruction: "x" }), new AbortController().signal), /Could not find the tag's constraint/);
  await assert.rejects(runAI(requestSchema.parse({ ...base, tagTarget: { tagId: "a", index: 0 }, instruction: " " }), new AbortController().signal), /Say how to change it/);
});

test("asking to change a tag's constraint puts the AI's version in the frame's tags, with what changed said", async () => {
  const { sceneAI } = await import("../app/studio/scene-actions");
  const { createSketchPanel } = await import("../app/lib/sketch-panels");
  const tags = settleComposeTags([tag({ id: "a", strokeIds: ["stroke-1"], constraints: [{ label: "Size", effect: "spatial", how: "", penId: "", params: [] }] })], strokes, []);
  const panels: Record<string, ReturnType<typeof createSketchPanel>> = { s: createSketchPanel({ composeTags: tags, composeTagsRevision: 1 }) };
  const toasts: string[] = [], calls: { intent: string; input: any }[] = [];
  const deps = {
    panel: (id: string) => panels[id] ?? createSketchPanel(), toast: (text: string) => { toasts.push(text); }, documentId: () => 1, requestId: () => 1,
    updatePanel: (id: string, patch: any) => { const base = panels[id] ?? createSketchPanel(); panels[id] = { ...base, ...(typeof patch === "function" ? patch(base) : patch) }; },
    task: async (_label: string, work: () => Promise<void>) => { await work(); },
    request: async (intent: string, input: any) => { calls.push({ intent, input }); return { tagId: "a", index: 0, constraint: { label: "Fading", effect: "stylistic", how: "fades out", pen: null, params: [{ label: "End opacity", value: "0.1", how: "" }] }, note: "It fades now." }; },
    capture: async () => ({ image: "data:image/png;base64,AAAA", region: { x: 0, y: 0, w: 1, h: 1 } }),
    artwork: () => ({ name: "s", photo: null, strokes: [], revision: 1 }),
  } as any;
  await sceneAI(deps, "s").reviseComposeTag("a", 0, "make it fade out");
  assert.equal(calls[0].intent, "tag-revise"); assert.deepEqual(calls[0].input.tagTarget, { tagId: "a", index: 0 }); assert.equal(calls[0].input.instruction, "make it fade out");
  assert.equal(panels.s.composeTags[0].constraints[0].label, "Fading"); assert.equal(toasts.at(-1), "It fades now.");
});

test("tags read as a containment tree: each collection followed by what it contains, at any depth", async () => {
  const { tagTree, tagsInside } = await import("../app/lib/compose-tags");
  const tags = settleComposeTags([
    tag({ id: "leaf", parentId: "inner", strokeIds: ["stroke-3"] }), tag({ id: "outer", kind: "collection", strokeIds: ["stroke-1"] }),
    tag({ id: "lone", strokeIds: ["stroke-2"] }), tag({ id: "inner", kind: "collection", parentId: "outer", strokeIds: ["stroke-2"] }),
  ], strokes, []);
  assert.deepEqual(tagTree(tags).map(({ tag, depth }) => `${depth}:${tag.id}`), ["0:outer", "1:inner", "2:leaf", "0:lone"]);
  assert.deepEqual(tagsInside(tags, "outer").map(item => item.id), ["inner", "leaf"]);
  assert.deepEqual(tagsInside(tags, "lone"), []);
  assert.match(readFileSync("prompts/compose-prompt.md", "utf8"), /Set containment as the prompt reads it/);
});

test("repetition is a collection's job: the scene model makes the copies of a repeated unit a collection holding one unit object, in every prompt that builds scenes", async () => {
  const { loadPrompt } = await import("../app/server/prompts.server");
  const model = readFileSync("prompts/contracts/scene-model.md", "utf8");
  assert.match(model, /MAKING COPIES IS A COLLECTION'S JOB/); assert.match(model, /REPEATED UNITS ARE A COLLECTION WITH ONE MEMBER/);
  assert.doesNotMatch(model, /KEEP OBJECTS WHOLE/); assert.doesNotMatch(model, /one object `petals`\s+\(/);
  for (const intent of ["extract", "compose"] as const) assert.match(loadPrompt(intent), /ONE member object/, intent);
  assert.match(loadPrompt("compose-prompt"), /SOMETHING THAT APPEARS MORE THAN ONCE IS NEVER AN OBJECT/);
  const example = aiCompositionPromptSchema.parse(JSON.parse(readFileSync("prompts/compose-prompt.md", "utf8").match(/```json\n([\s\S]*?)\n```/)![1]));
  for (const item of example.tags.filter(item => item.kind === "collection"))
    assert.ok(example.tags.some(other => other.parentId === item.id && other.kind === "object"), `the example's collection ${item.id} holds its unit object`);
});

test("the tag structure can be changed by hand: move into a collection or to the top, switch kind, delete, add, with boxes fitted again", async () => {
  const { moveTag, canMoveTag, setTagKind, deleteTag, addTag, tagsInside } = await import("../app/lib/compose-tags");
  const tags = settleComposeTags([
    tag({ id: "c", kind: "collection", strokeIds: ["stroke-1"] }), tag({ id: "d", kind: "collection", parentId: "c", strokeIds: ["stroke-2"] }),
    tag({ id: "o", strokeIds: ["stroke-3"] }),
  ], strokes, []);
  assert.equal(canMoveTag(tags, "c", "d"), false, "not into what it holds"); assert.equal(canMoveTag(tags, "c", "o"), false, "not into an object");
  assert.equal(canMoveTag(tags, "d", "c"), false, "already there"); assert.equal(moveTag(tags, "c", "c", strokes), null);
  const moved = moveTag(tags, "o", "d", strokes)!;
  assert.deepEqual(tagsInside(moved, "c").map(item => item.id), ["d", "o"]);
  const c = moved.find(item => item.id === "c")!; assert.ok(c.box.x + c.box.w >= .9 && c.box.y + c.box.h >= .9, "the collection takes in what moved in");
  assert.equal(tags.find(item => item.id === "o")!.parentId, "", "the tags it came from are not changed");
  const top = moveTag(moved, "o", "", strokes)!; assert.equal(top.find(item => item.id === "o")!.parentId, "");
  assert.ok(top.find(item => item.id === "c")!.box.x + top.find(item => item.id === "c")!.box.w < .9, "and lets go of it again");
  const flat = setTagKind(moved, "d", "object", strokes);
  assert.equal(flat.find(item => item.id === "d")!.kind, "object"); assert.equal(flat.find(item => item.id === "o")!.parentId, "c", "what it held goes up a level");
  const gone = deleteTag(moved, "d", strokes);
  assert.deepEqual(gone.map(item => item.id), ["c", "o"]); assert.equal(gone.find(item => item.id === "o")!.parentId, "c");
  const added = addTag(gone, "object", "c")!;
  assert.equal(added.id, "t3"); const fresh = added.tags.find(item => item.id === "t3")!;
  assert.equal(fresh.parentId, "c"); assert.deepEqual(fresh.strokeIds, []); assert.ok(fresh.box.x >= gone[0].box.x && fresh.box.w < gone[0].box.w);
  assert.equal(addTag(gone, "object", "o")!.tags.at(-1)!.parentId, "", "not inside an object");
  assert.equal(addTag(Array.from({ length: 16 }, (_, i) => ({ ...fresh, id: `x${i}` })), "object", ""), null);
});

test("the tag tree in the Compose panel shows each tag's params: its constraints, their pens and the quantities with their values", async () => {
  const { createElement } = await import("react"), { renderToStaticMarkup } = await import("react-dom/server");
  const { SketchComposition } = await import("../app/components/sketch-composition");
  const tags = settleComposeTags([
    tag({ id: "c", kind: "collection", label: "Copies", strokeIds: ["stroke-1"], constraints: [{ label: "Spread out", effect: "spatial", how: "Placed apart.", penId: "", params: [{ label: "Count", value: "6", how: "How many." }] }] }),
    tag({ id: "o", parentId: "c", label: "Unit", strokeIds: ["stroke-2"], constraints: [{ label: "Fade", effect: "stylistic", how: "", penId: "", params: [{ label: "Opacity", value: "", how: "" }] }] }),
  ], strokes, []);
  const html = renderToStaticMarkup(createElement(SketchComposition, { artwork: { strokes: [], photo: null, name: "s", revision: 1 } as never, prompt: "", onPrompt() {}, onDraft() {}, onCompose() {}, busy: false, drafting: false, tags: tags.length, tagList: tags }));
  assert.match(html, /aria-label="Params of Copies"[\s\S]*Spread out[\s\S]*Count<b>6<\/b>[\s\S]*aria-label="Params of Unit"[\s\S]*Fade[\s\S]*Opacity<\/small>/);
});

test("a constraint can be dragged to another tag or another place in its own tag, and a full tag takes no more", async () => {
  const { moveConstraint, draggedConstraint, TAG_CONSTRAINT_DRAG, MAX_TAG_CONSTRAINTS } = await import("../app/lib/compose-tags");
  const t = (label: string) => ({ label, effect: "spatial" as const, how: "", penId: "", params: [] });
  const tags = settleComposeTags([tag({ id: "a", strokeIds: ["stroke-1"], constraints: [t("A1"), t("A2"), t("A3")] }), tag({ id: "b", strokeIds: ["stroke-2"], constraints: [t("B1")] })], strokes, []);
  const labels = (next: typeof tags | null) => next?.map(item => `${item.id}:${item.constraints.map(entry => entry.label).join(",")}`);
  assert.deepEqual(labels(moveConstraint(tags, { tagId: "a", index: 0 }, "b")), ["a:A2,A3", "b:B1,A1"], "onto a tag: at its end");
  assert.deepEqual(labels(moveConstraint(tags, { tagId: "a", index: 2 }, "b", 0)), ["a:A1,A2", "b:A3,B1"], "before another tag's constraint");
  assert.deepEqual(labels(moveConstraint(tags, { tagId: "a", index: 0 }, "a", 2)), ["a:A2,A1,A3", "b:B1"], "later in its own tag");
  assert.deepEqual(labels(moveConstraint(tags, { tagId: "a", index: 2 }, "a", 0)), ["a:A3,A1,A2", "b:B1"], "earlier in its own tag");
  assert.deepEqual(labels(moveConstraint(tags, { tagId: "a", index: 0 }, "a")), ["a:A2,A3,A1", "b:B1"], "to the end of its own tag");
  assert.equal(moveConstraint(tags, { tagId: "a", index: 1 }, "a", 1), null, "dropped where it is"); assert.equal(moveConstraint(tags, { tagId: "a", index: 1 }, "a", 2), null);
  assert.equal(moveConstraint(tags, { tagId: "a", index: 9 }, "b"), null); assert.equal(moveConstraint(tags, { tagId: "a", index: 0 }, "gone"), null);
  const full = tags.map(item => item.id === "b" ? { ...item, constraints: Array.from({ length: MAX_TAG_CONSTRAINTS }, (_, i) => ({ ...item.constraints[0], label: `B${i}` })) } : item);
  assert.equal(moveConstraint(full, { tagId: "a", index: 0 }, "b"), null, "a full tag takes no more");
  assert.ok(moveConstraint(full, { tagId: "b", index: 0 }, "b", 3), "reordering a full tag is fine");
  const data = (value: string) => ({ getData: (type: string) => type === TAG_CONSTRAINT_DRAG ? value : "" }) as unknown as DataTransfer;
  assert.deepEqual(draggedConstraint(data(JSON.stringify({ tagId: "a", index: 1 }))), { tagId: "a", index: 1 });
  assert.equal(draggedConstraint(data("")), null); assert.equal(draggedConstraint(data(JSON.stringify({ tagId: "a", index: "1" }))), null);
});

test("Compose is told what each collection holds, and copies what it holds even when its words still name the unit it held before the user moved tags", async () => {
  const { intents } = await import("../app/server/intents.server");
  const { moveTag, deleteTag } = await import("../app/lib/compose-tags");
  // The AI's reading: copies of a unit in one collection, and a form of its own at the top. The user then moves that form in and deletes the old unit.
  let tags = settleComposeTags([
    tag({ id: "c", kind: "collection", label: "Copies of a unit", members: "many units", strokeIds: ["stroke-1"], constraints: [{ label: "Layout", effect: "spatial", how: "Places the units apart.", penId: "", params: [] }] }),
    tag({ id: "u", parentId: "c", label: "Old unit", strokeIds: ["stroke-1"] }), tag({ id: "f", label: "Form", strokeIds: ["stroke-2"] }),
  ], strokes, []);
  tags = deleteTag(moveTag(tags, "f", "c", strokes)!, "u", strokes);
  const sent = intents.compose.context(requestSchema.parse({ intent: "compose", image: "data:image/png;base64,YQ==", composeTags: tags })) as { tags: any[] };
  assert.deepEqual(sent.tags.find(item => item.id === "c").holds, [{ id: "f", kind: "object", label: "Form" }]);
  assert.equal(sent.tags.find(item => item.id === "f").holds, undefined, "an object holds nothing");
  const compose = readFileSync("prompts/compose.md", "utf8");
  assert.match(compose, /WHAT A COLLECTION HOLDS IS WHAT IT REPEATS/); assert.match(compose, /THE STRUCTURE WINS OVER THE WORDS/);
  assert.doesNotMatch(compose, /a member that differs from the others/);
  const draft = readFileSync("prompts/compose-prompt.md", "utf8");
  assert.match(draft, /EVERYTHING INSIDE A COLLECTION IS WHAT IT REPEATS/); assert.doesNotMatch(draft, /differs from the others|differs in kind from the unit/);
});
