import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { run, sampleScene, sceneProgram } from "./fixtures/scene";
import { connectScene } from "../app/server/scene-code.server";
import { keyStep, keySteps, KEY_STEPS, traceOnly, withoutTerms } from "../app/lib/explore";

// Three dots, each pushed right by an inner term (m.term) that grows with its index, one checkpoint each.
const program = connectScene({ title: "Tree", explanation: "", code: sceneProgram }, sampleScene()).code.replace("    draw() {",
  "    draw() {\n      for (let i = 0; i < 3; i++) { m.trace(\"dot \" + i, { op: 1, x: i * 10, y: 5 }); p.circle(i * 10 + m.term(\"push\", i * 5), 5, 4); }");
type Run = { total: number; terms: string[]; events: { index: number; kind: string; terms?: Record<string, { last: unknown; mean: number | null; n: number }>; pts?: number[][] }[] };

test("an inner term (m.term) is returned as it is, recorded on the step that computes it, and can be scaled (0: without it) on a held step", () => {
  const sketch = run(program);
  const record = (points = true): Run => { sketch.circles.length = 0; sketch.read(`rulegenRunStart(null, ["tree"], null, { points: ${points} })`); sketch.draw(); return JSON.parse(JSON.stringify(sketch.read("rulegenRunEnd()"))); };
  const dots = () => sketch.circles.filter(circle => circle[2] === 4).map(circle => circle[0]);
  sketch.circles.length = 0; sketch.draw();
  assert.deepEqual(dots(), [0, 15, 30], "as the code makes it");
  const base = record();
  assert.deepEqual(base.terms, ["tree/push"]);
  assert.deepEqual(base.events.filter(event => event.kind === "trace").map(event => event.terms?.push), [{ last: 0, mean: 0, n: 1 }, { last: 5, mean: 5, n: 1 }, { last: 10, mean: 10, n: 1 }], "on the step that computed it");
  assert.ok(base.events.filter(event => event.kind === "circle").every(event => Array.isArray(event.pts) && event.pts.length > 0), "drawing calls keep a few of their points when asked");
  assert.equal(record(false).events.find(event => event.kind === "circle")!.pts, undefined, "and only then");
  // Scaled to 0 on the held step: every dot back on its own place; the scale is gone after.
  sketch.read(`rulegenSetTermScales({ "tree/push": 0 })`);
  const without = record();
  assert.deepEqual(dots(), [0, 10, 20]);
  sketch.read("rulegenSetTermScales({})"); sketch.circles.length = 0; sketch.draw();
  assert.deepEqual(dots(), [0, 15, 30]);
  // Compared mark by mark: the last dot moves 10px without the term; the steps whose drawing changes are the 2nd and 3rd.
  const lastDot = base.events.filter(event => event.kind === "circle")[2].index;
  const effect = JSON.parse(JSON.stringify(sketch.read(`rulegenCompareRuns(${JSON.stringify(base)}, ${JSON.stringify(without)}, ${lastDot})`)));
  assert.deepEqual(effect, { moved: 10, gone: false, steps: [1, 2] });
  assert.deepEqual(JSON.parse(JSON.stringify(sketch.read(`rulegenCompareRuns(${JSON.stringify(base)}, ${JSON.stringify(base)}, ${lastDot})`))), { moved: 0, gone: false, steps: [] }, "the same run: nothing");
  assert.throws(() => connectScene({ title: "Tree", explanation: "", code: sceneProgram.replace("    draw() {", "    draw() {\n      const termed = m.term(name, 3);") }, sampleScene()), /m\.term is called as/);
  assert.doesNotThrow(() => connectScene({ title: "Tree", explanation: "", code: sceneProgram.replace("    draw() {", "    draw() {\n      const termed = m.term(\"push\", 3);") }, sampleScene()), "kept by generated code that has it");
});

test("checkpoint edits may name inner terms: an m.term wrapper around an expression as it is passes, anything that changes the code does not", () => {
  assert.equal(withoutTerms("x += m.term(\"drift\", vx * 2);"), "x += (vx * 2);");
  assert.equal(withoutTerms("x += m.term(name, vx);"), null, "the name is a short lowercase literal");
  const find = "const field = attract + broad + detail * (a + b);";
  assert.ok(traceOnly({ find, replace: "const field = m.term(\"attract\", attract) + m.term(\"broad\", broad) + m.term(\"detail\", detail * (a + b));" }));
  assert.ok(traceOnly({ find, replace: "m.trace(\"field\", { op: 1 }); const field = m.term(\"attract\", attract) + broad + detail * (a + b);" }), "with checkpoints too");
  assert.ok(!traceOnly({ find, replace: "const field = m.term(\"attract\", attract * 2) + broad + detail * (a + b);" }), "a changed expression");
  assert.ok(!traceOnly({ find, replace: "const field = m.term(\"attract\", attract) + broad;" }), "code taken out");
  assert.ok(!traceOnly({ find, replace: find }), "nothing added");
});

test("a long run stops only at key steps: one round of its operations in full, then the rest in chunks, the end and any step jumped to", () => {
  const runOf = (ops: number[]) => ({ events: ops.map((op, index) => ({ index, kind: "trace", label: "", data: { op } })) });
  const short = runOf([1, 2, 3]);
  assert.deepEqual(keySteps(short), [0, 1, 2, 3], "a short run keeps every step");
  // 150 items, three operations each: the first item in full, then chunks.
  const cycles = runOf(Array.from({ length: 450 }, (_, i) => i % 3 + 1)), keys = keySteps(cycles);
  assert.ok(keys.length <= KEY_STEPS + 1, `${keys.length} stops`);
  assert.deepEqual(keys.slice(0, 4), [0, 1, 2, 3], "one item through every operation");
  assert.equal(keys.at(-1), 450); assert.ok(keys.every((stop, i) => !i || stop > keys[i - 1]));
  assert.ok(keys.slice(4, -1).every(stop => stop % 3 === 0), "chunks end where an item's operations end");
  assert.ok(keySteps(cycles, KEY_STEPS, [212]).includes(212), "a step jumped to is one");
  // One operation 500 times: spread evenly.
  const flat = keySteps(runOf(Array(500).fill(1)));
  assert.ok(flat.length <= KEY_STEPS + 1 && flat[1] === 1 && flat.at(-1) === 500);
  assert.equal(keyStep(keys, 3, 1), keys[4]); assert.equal(keyStep(keys, keys[4], -1), 3); assert.equal(keyStep(keys, 0, -1), 0);
});

test("the Execution frame shows key steps, what each step read, and — only for a mark looked at — what shapes it; the prompt asks for key steps and inner terms", () => {
  const frame = readFileSync("app/components/explore-frame.tsx", "utf8"), preview = readFileSync("app/components/code-preview.tsx", "utf8"), prompt = readFileSync("prompts/explore.md", "utf8");
  assert.match(frame, /keySteps\(run, KEY_STEPS, picked \? \[picked\.done\] : \[\]\)/); assert.match(frame, /\{marked\.length \? "This mark's step" : "Key step"\} <b>\{keyAt\}<\/b>/); assert.match(frame, /`All \$\{count\} steps`/);
  assert.match(frame, /className="explore-step-values"/, "what the step just executed read");
  assert.match(frame, /\{picked \? <div className="explore-influence"/, "the influences only for a mark looked at");
  assert.match(frame, /preview\.current\.influence\(influences\.map\(item => item\.nudge\), picked\.item !== null \? \{ item: picked\.item \} : picked\.index\)/);
  assert.match(frame, /choice\.effect\.steps\.slice\(0, 200\)\.map/, "the steps it changes, on the timeline");
  assert.match(preview, /event\.data\.type==='influence'\|\|event\.data\.type==='variant-shot'/); assert.match(preview, /if\(replaying\|\|quiet\)return;/, "variants are drawn quietly");
  assert.match(preview, /JSON\.stringify\(props\.restore\?\.fields \?\? null\), JSON\.stringify\(props\.restore\?\.terms \?\? null\), props\.restore\?\.playOn\?\.id \?\? null\]\)/, "combs, term scales and playing on redraw the held step");
  assert.match(prompt, /KEY STEPS ONLY: the user goes through the run by hand, so a run has about 8–24 steps, never hundreds/);
  assert.match(prompt, /### inner terms: what shapes each mark/); assert.match(prompt, /`m\.term\("<short-lowercase-name>", <the expression as it is>\)`/);
});

test("following one mark: m.focus says which item the code works on (every drawing call after it belongs to it) and takes the steps of the item followed instead of the representatives", async () => {
  const { markSteps } = await import("../app/lib/explore");
  const followed = connectScene({ title: "Tree", explanation: "", code: sceneProgram }, sampleScene()).code.replace("    draw() {",
    "    draw() {\n      for (let i = 0; i < 3; i++) { if (m.focus(i, i === 0)) m.trace(\"dot \" + i, { op: 1, x: i * 10, y: 5 }); p.circle(i * 10, 5, 4); }");
  const sketch = run(followed);
  type Event = { index: number; kind: string; label: string; item?: string };
  const record = (options: object): { events: Event[] } => { sketch.read(`rulegenRunStart(null, ["tree"], null, ${JSON.stringify(options)})`); sketch.draw(); return JSON.parse(JSON.stringify(sketch.read("rulegenRunEnd()"))); };
  const plain = record({});
  assert.deepEqual(plain.events.filter(event => event.kind === "trace").map(event => event.label), ["dot 0"], "the representative");
  assert.deepEqual(plain.events.filter(event => event.kind === "circle").slice(0, 3).map(event => event.item), ["0", "1", "2"], "each drawing call knows its item");
  const two = record({ focus: "2" });
  assert.deepEqual(two.events.filter(event => event.kind === "trace").map(event => event.label), ["dot 2"], "the item followed instead");
  assert.deepEqual(markSteps(two as never, { item: "2", index: -1 }), [1], "the steps where it changes");
  assert.deepEqual(markSteps(plain as never, { item: null, index: plain.events.find(event => event.kind === "circle" && event.item === "1")!.index }), [1], "a mark without an item: the step of its own drawing call");
  // Compared by item: all of its drawing calls.
  const base = record({ points: true }), moved = JSON.parse(JSON.stringify(sketch.read(`rulegenCompareRuns(${JSON.stringify(base)}, ${JSON.stringify({ ...base, events: base.events.map((event: Event & { pts?: number[][] }) => event.item === "1" && event.pts ? { ...event, pts: event.pts.map(([x, y]) => [x + 6, y + 8]) } : event) })}, { item: "1" })`)));
  assert.equal(moved.moved, 10); assert.equal(moved.gone, false);
  // Outside a run it is the representative condition, and nothing is recorded.
  sketch.circles.length = 0; sketch.draw(); assert.equal(sketch.circles.filter(circle => circle[2] === 4).length, 3);
  assert.ok(traceOnly({ find: "p.circle(i * 10, 5, 4);", replace: "if (m.focus(i, i === 0)) m.trace(\"dot\", { op: 1 }); p.circle(i * 10, 5, 4);" }), "a focus guard is part of a checkpoint");
});

test("what a step changed is colored over the picture: drawn blue, gone orange, thickened; the same for what an influence would change", async () => {
  const { diffPixels } = await import("../app/lib/picture-diff");
  const width = 5, height = 1, white = [255, 255, 255, 255], black = [0, 0, 0, 255];
  const picture = (pixels: number[][]) => new Uint8ClampedArray(pixels.flat());
  const before = picture([black, white, white, white, white]), after = picture([white, white, white, white, black]), out = new Uint8ClampedArray(width * height * 4);
  const counts = diffPixels(before, after, width, height, out, { added: [0, 0, 255], removed: [255, 128, 0] }, 28, 1);
  assert.deepEqual(counts, { added: 1, removed: 1 });
  const at = (x: number) => [...out.slice(x * 4, x * 4 + 4)];
  assert.deepEqual(at(4).slice(0, 3), [0, 0, 255]); assert.deepEqual(at(3).slice(0, 3), [0, 0, 255], "thickened by a pixel");
  assert.deepEqual(at(0).slice(0, 3), [255, 128, 0]); assert.equal(at(2)[3], 0, "unchanged: transparent");
  const frame = readFileSync("app/components/explore-frame.tsx", "utf8"), board = readFileSync("app/components/freeform-workspace.tsx", "utf8"), prompt = readFileSync("prompts/explore.md", "utf8");
  assert.match(frame, /pictureDiff\(from, image, CHANGE_COLORS\)/); assert.match(frame, /pictureDiff\(shots\.current\.get\(shotKeyNow\.current\) \?\? latestShot\.current, image, COMPARE_COLORS\)/);
  assert.match(frame, /solo: picked && solo \? \{ item: picked\.item, index: picked\.item === null \? picked\.index : null \} : null/, "the rest drawn faint while following");
  assert.match(frame, /marked\.length \? \[\.\.\.new Set\(\[0, marked\[0\] - 1, \.\.\.marked, count\]\)\]/, "stepping through its own steps");
  assert.match(frame, /className="explore-bar board-scroll"/); assert.match(board, /closest\("\.board-scroll"\)/, "the bar scrolls inside instead of running off");
  assert.match(prompt, /`if \(m\.focus\(i, i === 0 \|\| i === k\)\) m\.trace\(…\)`/);
});

test("an Execution frame explains itself on the picture, its gestures can be turned off, and its overlays are asked to be visual", () => {
  const frame = readFileSync("app/components/explore-frame.tsx", "utf8"), overlay = readFileSync("app/components/inspection-overlay.tsx", "utf8"), prompt = readFileSync("prompts/explore.md", "utf8");
  assert.match(frame, /className=\{`explore-caption \$\{lastPlace && lastPlace\.x \+ lastPlace\.w \/ 2 < 450 \? "right" : "left"\}`\}/, "a caption in the corner away from the step");
  assert.match(frame, /className="explore-step-mark last"/); assert.match(frame, /className="explore-step-mark next"/);
  assert.match(frame, /checked=\{gestures\} onChange=\{e => setGestures\(e\.currentTarget\.checked\)\} \/>Step by gesture/);
  assert.match(frame, /!gestures && item\.handle\?\.key === EXEC_KEY \? \{ \.\.\.item, handle: null \} : item/, "without gestures the execution grips go, the overlays stay");
  assert.doesNotMatch(frame, /explore-sketch|recognizeMark/, "steps are never run by drawing a mark");
  assert.match(frame, /plain specs=\{allSpecs\} textSize=\{textSize\}/, "the words on the picture take the size chosen");
  assert.match(frame, /aria-label="Larger text on the picture"/); assert.match(frame, /localStorage\.setItem\("rulegen:explore-text", String\(next\)\)/); assert.match(overlay, /const text = textSize \/ Math\.max\(\.2, zoom\);/);
  assert.match(prompt, /explain the step VISUALLY, so the picture alone is understandable without reading any text/);
  assert.match(prompt, /SHOW THE OPERATION AS GEOMETRY on the thing it works on/);
});

test("a step is shown by its own geometry and terms on the picture, for any brush: its data's points and paths, its inner terms as arrows and signed bars", async () => {
  const { dataShapes, termGlyphs } = await import("../app/lib/explore");
  const shapes = dataShapes({ op: 2, x: 10, y: 20, w: 0, h: 0, path: [{ x: 1, y: 2 }, { x: 3, y: 4 }, { x: 5, y: 6 }], pair: { a: { x: 7, y: 8 }, b: { x: 9, y: 10 } }, gap: 12, far: { x: 5000, y: 0 } });
  assert.deepEqual(shapes.map(shape => [shape.key, shape.points.length]), [["path", 3], ["pair.a", 1], ["pair.b", 1]], "point lists as paths, points by name; the step's own place, plain numbers and points off the canvas are not");
  const glyphs = termGlyphs({ push: { last: [3, 4], mean: 5, n: 1 }, wind: { last: { x: -1, y: 0 }, mean: 1, n: 1 }, jitter: { last: -.4, mean: .4, n: 2 }, name: { last: "x", mean: null, n: 1 } });
  assert.deepEqual(glyphs.vectors, [{ name: "push", v: [3, 4] }, { name: "wind", v: [-1, 0] }]); assert.deepEqual(glyphs.scalars, [{ name: "jitter", value: -.4 }]);
  const frame = readFileSync("app/components/explore-frame.tsx", "utf8"), prompt = readFileSync("prompts/explore.md", "utf8");
  assert.match(frame, /className="explore-data last"/); assert.match(frame, /className="explore-term-bars"/); assert.match(frame, /arrow\("@sum", sum, "#1f2a24", "together", "sum"\)/);
  // The picture points at the thing; the caption says it in words: what the step did, why, what it decided (one verdict, how many more were compared), what is next.
  for (const part of ["explore-caption-now", "explore-caption-why", "explore-caption-verdict", "explore-caption-next"]) assert.match(frame, new RegExp(`className=[^>]*${part}`));
  assert.doesNotMatch(frame, /explore-caption-values|className="explore-test pending"|className="explore-data next"/, "no list of values, nothing drawn ahead for the next step");
  assert.match(frame, /verdict = tested\.find\(test => test\.pass\) \?\? tested\[0\] \?\? null/, "one decision drawn per step");
  assert.match(frame, /className="explore-regenerate"/); assert.match(frame, /onRetry\(remake\)/, "the frame can be made again, saying what to change");
  assert.match(prompt, /The app DRAWS each step's data on the picture where it works/);
});
