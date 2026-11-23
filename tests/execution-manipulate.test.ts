import { test } from "node:test";
import assert from "node:assert/strict";
import { addCycle, emptyTrace, nextIds, readCycle, type ExecTrace } from "../app/lib/execution/trace";
import { MANIP_WORKER, savedToolsSchema, compiles, demoKey, liveConcern, liveRequest, liveTargets, paramValue, recordedAt, revisionRequest, settleClarify, summarize, type Clarify } from "../app/lib/execution/manipulate";
import { hitStroke, newStroke, paintedMask, placedPoints, strokeFeatures, probedItems, strokeSpots, toggleProbe, underStrokes, type ManipStroke } from "../app/lib/execution/strokes";

const square = (x: number, y: number, size: number, tool: "brush" | "pencil" = "pencil"): ManipStroke => ({
  ...newStroke("s", tool, { x, y }),
  points: [{ x, y }, { x: x + size, y }, { x: x + size, y: y + size }, { x, y: y + size }, { x, y: y + 1 }],
});

test("strokes are measured as placed: moved, scaled and rotated about the center of what was drawn", () => {
  const drawn = square(100, 100, 40), plain = strokeFeatures(drawn);
  assert.deepEqual(plain.box, { x: 100, y: 100, w: 40, h: 40 });
  assert.equal(plain.closed, true);
  assert.ok(Math.abs(plain.area - 1600) < 30);
  const moved = strokeFeatures({ ...drawn, dx: 10, dy: -5, scale: 2 });
  assert.deepEqual(moved.box, { x: 90, y: 75, w: 80, h: 80 }, "scaled about its center, then moved");
  assert.equal(moved.width, drawn.width * 2);
  const turned = placedPoints({ ...drawn, rotate: Math.PI / 2 });
  assert.ok(Math.abs(turned[0].x - 140) < 1e-9 && Math.abs(turned[0].y - 100) < 1e-9, "a quarter turn about (120, 120)");
  const line = strokeFeatures({ ...newStroke("l", "pencil", { x: 0, y: 0 }), points: [{ x: 0, y: 0 }, { x: 50, y: 50 }, { x: 100, y: 100 }] });
  assert.equal(line.closed, false);
  assert.equal(line.area, 0);
  assert.equal(Math.round(line.angle), 45);
  assert.equal(Math.round(line.length), 141);
});

test("the brush's painted region becomes a mask of the canvas; strokes are hit near their line", () => {
  const paint = { ...newStroke("p", "brush", { x: 0, y: 0 }), points: [{ x: 10, y: 10 }, { x: 170, y: 10 }] };
  const mask = paintedMask([paint, square(400, 400, 100)]);
  assert.equal(mask.length, 30); assert.equal(mask[0].length, 45);
  assert.deepEqual(mask[0].slice(0, 10), [1, 1, 1, 1, 1, 1, 1, 1, 1, 0]);
  assert.equal(mask.flat().reduce((a, b) => a + b, 0), 9, "only brush strokes paint");
  const coats = paintedMask([paint, { ...paint, id: "q" }]);
  assert.deepEqual([coats[0][0], coats[0][9]], [2, 0], "painted over again: two coats");
  assert.equal(hitStroke([paint], { x: 90, y: 20 }), "p");
  assert.equal(hitStroke([paint], { x: 90, y: 60 }), null);
});

const sites = [{ site: "constraint:heart/size", variables: ["$value", "base"] }];
const params = [{ key: "heart/scale", type: "number" }, { key: "heart/mode", type: "select", options: ["a", "b"] }];
const target = (patch: Partial<Clarify["targets"][number]>): Clarify["targets"][number] =>
  ({ id: "size", name: "Size", site: "constraint:heart/size", path: "@$value", param: "", meaning: "", measure: "return strokes.length ? strokes[0].box.w : null;", at: "", ...patch });
const output = (patch: Partial<Clarify>): Clarify => ({ related: true, summary: "", needsCode: true, rules: [], ask: false, question: "", reason: "", tools: [{ kind: "brush", purpose: "Draw it" }], targets: [target({})], ...patch });
const rule = (id: string, thumbnail: string, tools: Clarify["tools"] = [{ kind: "brush", purpose: "" }]) => ({ id, rule: id, logic: "", detail: "", tools, thumbnail });

test("tools and targets are kept only where they can be used", () => {
  const settled = settleClarify(output({ targets: [
    target({}),
    target({ id: "size", path: "@nope" }),
    target({ id: "p", param: "heart/scale" }),
    target({ id: "q", param: "heart/missing" }),
    target({ id: "bad", measure: "return (" }),
  ], tools: [{ kind: "brush", purpose: "a" }, { kind: "brush", purpose: "b" }, { kind: "select", purpose: "c" }] }), sites, params, false);
  assert.deepEqual(settled.targets.map(item => [item.id, item.site, item.path, item.param]), [
    ["size", "constraint:heart/size", "@$value", ""],
    ["size-2", "", "", ""],
    ["p", "constraint:heart/size", "@$value", "heart/scale"],
    ["q", "constraint:heart/size", "@$value", ""],
  ], "unknown variables become new ones, unknown params are not params, code that does not parse is dropped");
  assert.deepEqual(settled.tools.map(tool => tool.kind), ["brush", "select"]);
  assert.throws(() => settleClarify(output({ tools: [{ kind: "select", purpose: "" }] }), sites, params, false), /No direct manipulation tool/);
});

test("rules are listed first; a question (2+ rules) waits for a pick, each rule with its own tools", () => {
  const rules = [rule("a", "ctx.fillRect(0, 0, 10, 10);", [{ kind: "pencil", purpose: "" }, { kind: "pencil", purpose: "" }]), rule("a", "ctx.(")];
  const asked = settleClarify(output({ rules, ask: true, question: "Which?" }), sites, params, false);
  assert.equal(asked.ask, true);
  assert.deepEqual(asked.rules.map(item => item.id), ["a", "a-2"]);
  assert.deepEqual(asked.rules[0].tools.map(tool => tool.kind), ["pencil"], "a rule's tools are each of a kind");
  assert.equal(asked.rules[1].thumbnail, "", "a thumbnail that does not parse is left empty");
  assert.deepEqual([asked.tools, asked.targets], [[], []], "no tools until a rule is picked");
  const picked = settleClarify(output({ rules, ask: true, question: "Which?" }), sites, params, true);
  assert.equal(picked.ask, false);
  assert.equal(picked.tools.length, 1);
  assert.equal(settleClarify(output({ rules: rules.slice(0, 1), ask: true }), sites, params, false).ask, false, "one rule is no question");
});

test("measured values fit params by type; recorded values are summarized", () => {
  assert.equal(paramValue(3.5, { type: "number" }), 3.5);
  assert.equal(paramValue(Number.NaN, { type: "number" }), undefined);
  assert.equal(paramValue("#a1b2c3", { type: "color" }), "#a1b2c3");
  assert.equal(paramValue("red", { type: "color" }), undefined);
  assert.equal(paramValue("b", { type: "select", options: ["a", "b"] }), "b");
  assert.equal(paramValue(true, { type: "toggle" }), true);
  assert.equal(summarize([3, 1.234, 8]), "1.23 – 8 (3)");
  assert.equal(summarize([4, 4]), "4");
  assert.equal(summarize(["x", "y", "x"]), '"x", "y"');
  assert.equal(summarize([]), "—");
  assert.ok(compiles("return 1;", ["a"]) && !compiles("return (", ["a"]));
});

test("recorded values come from the newest allowed cycle that has the site", () => {
  let trace: ExecTrace = emptyTrace();
  for (const n of [1, 2, 3]) {
    const ids = nextIds(trace);
    trace = addCycle(trace, readCycle({ at: n, runtime: {}, params: {}, steps: [
      { kind: "constraint", nodeId: "heart", root: "heart", key: "1", state: "s", constraintId: "size", property: "size", label: "", index: 0, variables: { $value: n * 10 } },
      { kind: "constraint", nodeId: "heart", root: "heart", key: "2", state: "s", constraintId: "size", property: "size", label: "", index: 1, variables: { $value: n * 10 + 1 } },
    ] }, ids.cycle, ids.step)!);
  }
  assert.deepEqual(recordedAt(trace, "constraint:heart/size", "@$value"), [30, 31]);
  assert.deepEqual(recordedAt(trace, "constraint:heart/size", "@$value", id => id <= 2), [20, 21]);
  assert.deepEqual(recordedAt(trace, "", ""), []);
  const request = revisionRequest({ concern: "merge", summary: "size", choice: { question: "How?", rule: "1.5×", logic: "s = 1.5 * s", detail: "", tools: ["brush"] }, tools: [{ kind: "brush", purpose: "Draw" }],
    targets: [{ ...target({}), before: "30 – 31 (2)", shown: "80" }] });
  assert.match(request, /Rule chosen for "How\?": 1\.5× \(s = 1\.5 \* s\)/);
  assert.match(request, /Size \(constraint:heart\/size @\$value\): 30 – 31 \(2\) → 80/);
});

test("on a live fork, targets the code computes are read with m.demo by an id the code can name; params stay params", () => {
  const settled = settleClarify(output({ targets: [target({ id: "change prob." }), target({ id: "scale", param: "heart/scale" })] }), sites, params, true);
  assert.deepEqual(settled.targets.map(item => item.id), ["change-prob-", "scale"], "ids become letters, digits, _ and -");
  assert.deepEqual(liveTargets(settled).map(item => item.id), ["change-prob-"]);
  assert.equal(demoKey("change-prob-"), "~demo/change-prob-");
  const request = liveRequest({ concern: "colors change", summary: "where", choice: { question: "How?", rule: "By probability", logic: "p(change) = painted", detail: "", tools: ["brush"] }, tools: settled.tools, targets: settled.targets });
  assert.match(request, /m\.demo\("change-prob-"\)/);
  assert.match(request, /measured by: return strokes\.length/);
  assert.match(request, /heart\/scale/);
  assert.match(liveConcern("colors change", settled.targets), /Show ONLY the values the direct manipulation tools set[\s\S]*@\$demo\.change-prob-/);
});

test("what a stroke shows is read where it was drawn; inspection shows the items at the spots clicked", () => {
  const paint = { ...newStroke("p", "brush", { x: 0, y: 0 }), points: [{ x: 100, y: 100 }, { x: 160, y: 100 }, { x: 220, y: 100 }] };
  assert.deepEqual(strokeSpots([paint]).map(point => point.x), [100, 160, 220]);
  assert.ok(underStrokes([paint], { x: 150, y: 120 }) && !underStrokes([paint], { x: 150, y: 160 }), "within half the brush width and a little");
  const items = [{ x: 120, y: 105, id: "a" }, { x: 200, y: 95, id: "b" }, { x: 500, y: 400, id: "c" }];
  assert.deepEqual(probedItems([{ x: 125, y: 110 }, { x: 490, y: 390 }, { x: 800, y: 50 }], items).map(item => item.id), ["a", "c"], "the item nearest each spot clicked, none far from all");
  assert.deepEqual(probedItems([], items), [], "nothing clicked, nothing shown");
  const spots = toggleProbe(toggleProbe([], { x: 10, y: 10 }), { x: 200, y: 10 });
  assert.equal(spots.length, 2);
  assert.deepEqual(toggleProbe(spots, { x: 14, y: 12 }), [{ x: 200, y: 10 }], "clicking near a spot removes it");
  const settled = settleClarify(output({ targets: [target({ id: "grid", at: "return value.cells[Math.floor(y / 100)][Math.floor(x / 100)];" }), target({ id: "bad", at: "return (" })] }), sites, params, true);
  assert.deepEqual(settled.targets.map(item => Boolean(item.at)), [true, false], "an at that does not parse is dropped (the whole value is shown)");
});

test("the sandbox workers compile (a broken worker would time out every request)", async () => {
  const { OVERLAY_WORKER } = await import("../app/lib/execution/overlay");
  for (const source of [MANIP_WORKER, OVERLAY_WORKER]) assert.doesNotThrow(() => new Function(source));
  const replies: any[] = [], self: any = { postMessage: (reply: unknown) => replies.push(reply) };
  new Function("self", "OffscreenCanvas", MANIP_WORKER)(self, undefined);
  await self.onmessage({ data: { id: 1, kind: "measure", code: "return strokes.length;", input: { strokes: [1, 2] } } });
  await self.onmessage({ data: { id: 2, kind: "at", code: "return value.grid[Math.floor(y / 100)][Math.floor(x / 100)];", input: { value: { grid: [[.1, .2], [.3, .4]] }, points: [[150, 50], [50, 150], [999, 999]] } } });
  assert.deepEqual(replies, [{ id: 1, value: 2 }, { id: 2, values: [.2, .3, null] }]);
});

test("tools made before can be read back from AI history (the frame, the concern, the rule picked, the tools)", () => {
  const clarify = settleClarify(output({}), sites, params, true);
  const saved = savedToolsSchema.parse({ owner: "sketch-1", concern: "merge", choice: null, clarify });
  assert.deepEqual([saved.owner, saved.marks, saved.clarify.tools.map(tool => tool.kind)], ["sketch-1", [], ["brush"]]);
  assert.throws(() => savedToolsSchema.parse({ owner: "sketch-1", concern: "merge", choice: null, clarify: { ...clarify, tools: [{ kind: "eraser", purpose: "" }] } }));
});
