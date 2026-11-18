import { test } from "node:test";
import assert from "node:assert/strict";
import { addCycle, emptyTrace, nextIds, readCycle, type ExecTrace } from "../app/lib/execution/trace";
import { compiles, paramValue, recordedAt, revisionRequest, settleClarify, summarize, type Clarify } from "../app/lib/execution/manipulate";
import { hitStroke, newStroke, paintedMask, placedPoints, strokeFeatures, type ManipStroke } from "../app/lib/execution/strokes";

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
  assert.equal(hitStroke([paint], { x: 90, y: 20 }), "p");
  assert.equal(hitStroke([paint], { x: 90, y: 60 }), null);
});

const sites = [{ site: "constraint:heart/size", variables: ["$value", "base"] }];
const params = [{ key: "heart/scale", type: "number" }, { key: "heart/mode", type: "select", options: ["a", "b"] }];
const target = (patch: Partial<Clarify["targets"][number]>): Clarify["targets"][number] =>
  ({ id: "size", name: "Size", site: "constraint:heart/size", path: "@$value", param: "", meaning: "", measure: "return strokes.length ? strokes[0].box.w : null;", ...patch });
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
