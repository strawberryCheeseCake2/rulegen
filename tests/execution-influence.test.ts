import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { run, sampleScene, sceneProgram } from "./fixtures/scene";
import { connectScene } from "../app/server/scene-code.server";
import { keyStep, keySteps, KEY_STEPS, traceOnly, withoutTerms } from "../app/lib/explore";

// The tree's color constraint also places three dots, each pushed right by an inner term (m.term) that grows with its
// index; they are drawn right after the tree's FSM is evaluated (so their drawing belongs to the color step).
const program = connectScene({ title: "Tree", explanation: "", code: sceneProgram }, sampleScene()).code
  .replace("function computeColor() { return m.v(\"tree/ink\"); }", "function computeColor() { m.store.dots = [0, 1, 2].map(i => i * 10 + m.term(\"push\", i * 5)); return m.v(\"tree/ink\"); }")
  .replace("p.stroke(tree.color);", "p.stroke(tree.color); for (const x of m.store.dots) p.circle(x, 5, 4);");
type Run = { total: number; terms: string[]; events: { index: number; kind: string; terms?: Record<string, { last: unknown; mean: number | null; n: number }>; pts?: number[][] }[] };

test("an inner term (m.term) is returned as it is, recorded on the step that computes it, and can be scaled (0: without it) on a held step", () => {
  const sketch = run(program);
  const record = (points = true): Run => { sketch.circles.length = 0; sketch.read(`rulegenRunStart(null, ["tree"], null, { points: ${points} })`); sketch.draw(); return JSON.parse(JSON.stringify(sketch.read("rulegenRunEnd()"))); };
  const dots = () => sketch.circles.filter(circle => circle[2] === 4).map(circle => circle[0]);
  sketch.circles.length = 0; sketch.draw();
  assert.deepEqual(dots(), [0, 15, 30], "as the code makes it");
  const base = record();
  assert.deepEqual(base.terms, ["tree/push"]);
  assert.deepEqual(base.events.filter(event => event.kind === "trace").map(event => event.terms?.push), [undefined, undefined, { last: 10, mean: 5, n: 3 }, undefined, undefined], "on the constraint step whose compute function computed it");
  assert.ok(base.events.filter(event => event.kind === "circle").every(event => Array.isArray(event.pts) && event.pts.length > 0), "drawing calls keep a few of their points when asked");
  assert.equal(record(false).events.find(event => event.kind === "circle")!.pts, undefined, "and only then");
  // Scaled to 0 on the held step: every dot back on its own place; the scale is gone after.
  sketch.read(`rulegenSetTermScales({ "tree/push": 0 })`);
  const without = record();
  assert.deepEqual(dots(), [0, 10, 20]);
  sketch.read("rulegenSetTermScales({})"); sketch.circles.length = 0; sketch.draw();
  assert.deepEqual(dots(), [0, 15, 30]);
  // Compared mark by mark: the last dot moves 10px without the term; the step whose drawing changes is the color step.
  const lastDot = base.events.filter(event => event.kind === "circle")[2].index;
  const effect = JSON.parse(JSON.stringify(sketch.read(`rulegenCompareRuns(${JSON.stringify(base)}, ${JSON.stringify(without)}, ${lastDot})`)));
  assert.deepEqual(effect, { moved: 10, gone: false, steps: [2] });
  assert.deepEqual(JSON.parse(JSON.stringify(sketch.read(`rulegenCompareRuns(${JSON.stringify(base)}, ${JSON.stringify(base)}, ${lastDot})`))), { moved: 0, gone: false, steps: [] }, "the same run: nothing");
  assert.throws(() => connectScene({ title: "Tree", explanation: "", code: sceneProgram.replace("    draw() {", "    draw() {\n      const termed = m.term(name, 3);") }, sampleScene()), /m\.term is called as/);
  assert.doesNotThrow(() => connectScene({ title: "Tree", explanation: "", code: sceneProgram.replace("    draw() {", "    draw() {\n      const termed = m.term(\"push\", 3);") }, sampleScene()), "kept by generated code that has it");
});

test("edits may name inner terms: an m.term wrapper around an expression as it is passes, a checkpoint or anything that changes the code does not", () => {
  assert.equal(withoutTerms("x += m.term(\"drift\", vx * 2);"), "x += (vx * 2);");
  assert.equal(withoutTerms("x += m.term(name, vx);"), null, "the name is a short lowercase literal");
  const find = "const field = attract + broad + detail * (a + b);";
  assert.ok(traceOnly({ find, replace: "const field = m.term(\"attract\", attract) + m.term(\"broad\", broad) + m.term(\"detail\", detail * (a + b));" }));
  assert.ok(!traceOnly({ find, replace: "m.trace(\"field\", { op: 1 }); const field = m.term(\"attract\", attract) + broad + detail * (a + b);" }), "no checkpoints: the steps are the state machine steps");
  assert.ok(!traceOnly({ find, replace: "const field = m.term(\"attract\", attract * 2) + broad + detail * (a + b);" }), "a changed expression");
  assert.ok(!traceOnly({ find, replace: "const field = m.term(\"attract\", attract) + broad;" }), "code taken out");
  assert.ok(!traceOnly({ find, replace: find }), "nothing added");
});

test("a run stops at its state machine steps: each state visit (with its constraints) and each transition starts one; a long run keeps an even spread, the end and any step jumped to", () => {
  type Step = [fsm: string, state: string, extra?: string];
  const runOf = (steps: Step[]) => ({ events: steps.map(([fsm, state, extra], index) => ({ index, kind: "trace", label: "", data: { fsm, nodeId: "orb", node: "orb", key: "", state, ...(fsm === "constraint" ? { constraint: extra, property: extra } : fsm === "transition" ? { to: extra, event: "go", transition: "go" } : {}) } })) });
  const short = runOf([["state", "a"], ["constraint", "a", "size"], ["constraint", "a", "x"], ["state", "b"], ["constraint", "b", "size"], ["transition", "b", "c"], ["state", "c", ""]]);
  assert.deepEqual(keySteps(short), [0, 3, 5, 6, 7], "a step forward runs a whole visit with its constraints, or a transition");
  const { fsmVisits } = { fsmVisits: (run: ReturnType<typeof runOf>) => run.events.filter(event => event.data.fsm !== "constraint").length };
  assert.equal(fsmVisits(short), 4);
  // 150 visits of two constraints each: an even spread of visit starts.
  const long = runOf(Array.from({ length: 150 }, (_, i): Step[] => [["state", `s${i % 2}`], ["constraint", `s${i % 2}`, "size"], ["constraint", `s${i % 2}`, "x"]]).flat()), keys = keySteps(long);
  assert.ok(keys.length <= KEY_STEPS + 1, `${keys.length} stops`);
  assert.deepEqual(keys.slice(0, 3), [0, 3, 6], "the first visits in full");
  assert.equal(keys.at(-1), 450); assert.ok(keys.every((stop, i) => !i || stop > keys[i - 1]));
  assert.ok(keys.slice(0, -1).every(stop => stop % 3 === 0), "every stop is where a visit starts");
  assert.ok(keySteps(long, KEY_STEPS, [212]).includes(212), "a step jumped to is one");
  // A run with no FSM steps (code that evaluates none): its drawing calls, spread evenly.
  const flat = keySteps({ events: Array.from({ length: 500 }, (_, index) => ({ index, kind: "line", label: "" })) });
  assert.ok(flat.length <= KEY_STEPS + 1 && flat[0] === 0 && flat.at(-1) === 500);
  assert.equal(keyStep(keys, 3, 1), keys[2]); assert.equal(keyStep(keys, keys[2], -1), 3); assert.equal(keyStep(keys, 0, -1), 0);
});

test("the Execution frame steps by state machine step or by constraint and shows what each step read; pressing a part only moves execution there; the prompt asks for no checkpoints", () => {
  const frame = readFileSync("app/components/explore-frame.tsx", "utf8"), preview = readFileSync("app/components/code-preview.tsx", "utf8"), prompt = readFileSync("prompts/explore.md", "utf8");
  assert.match(frame, /keySteps\(run, KEY_STEPS, jumped !== null \? \[jumped\] : \[\]\)/, "the step jumped to is a key step"); assert.match(frame, /State step <b>\{Math\.max\(0, visits\.filter\(item => item\.start < done\)\.length\)\}<\/b> \/ \{visits\.length\}/);
  assert.match(frame, /aria-label="Execute one state machine step"/); assert.match(frame, /▶ \{visits\.length \? "Constraint"/); assert.match(frame, /className="explore-fsm" aria-label="State machine step"/);
  assert.match(frame, /if \(target\) \{ setPlaying\(false\); setJumped\(target\.done\); goTo\(target\.done\); \}/, "jumping only moves execution, the run stays as it is");
  assert.match(frame, /className="explore-step-values"/, "what the step just executed read");
  assert.doesNotMatch(frame, /explore-influence|Measure what shapes it|follow the mark|focus,|solo:/, "no following a mark, no measuring what shapes it");
  assert.match(preview, /JSON\.stringify\(props\.restore\?\.fields \?\? null\), JSON\.stringify\(props\.restore\?\.terms \?\? null\), props\.restore\?\.playOn\?\.id \?\? null\]\)/, "combs, term scales and playing on redraw the held step");
  assert.match(prompt, /executed STATE MACHINE STEP BY STATE MACHINE STEP/); assert.match(prompt, /You add NO checkpoints/);
  assert.match(prompt, /### inner terms: what shapes each mark/); assert.match(prompt, /`m\.term\("<short-lowercase-name>", <the expression as it is>\)`/);
});

test("following one mark: m.focus says which item the code works on (every drawing call after it belongs to it) and takes the steps of the item followed besides the representatives", async () => {
  const followed = connectScene({ title: "Tree", explanation: "", code: sceneProgram }, sampleScene()).code.replace("    draw() {",
    "    draw() {\n      for (let i = 0; i < 3; i++) { m.focus(i, i === 0); p.circle(i * 10, 5, 4); }");
  const sketch = run(followed);
  type Event = { index: number; kind: string; label: string; item?: string };
  const record = (options: object): { events: Event[] } => { sketch.read(`rulegenRunStart(null, ["tree"], null, ${JSON.stringify(options)})`); sketch.draw(); return JSON.parse(JSON.stringify(sketch.read("rulegenRunEnd()"))); };
  const plain = record({});
  assert.deepEqual(plain.events.filter(event => event.kind === "circle").slice(0, 3).map(event => event.item), ["0", "1", "2"], "each drawing call knows its item");
  // Compared by item: all of its drawing calls.
  const base = record({ points: true }), moved = JSON.parse(JSON.stringify(sketch.read(`rulegenCompareRuns(${JSON.stringify(base)}, ${JSON.stringify({ ...base, events: base.events.map((event: Event & { pts?: number[][] }) => event.item === "1" && event.pts ? { ...event, pts: event.pts.map(([x, y]) => [x + 6, y + 8]) } : event) })}, { item: "1" })`)));
  assert.equal(moved.moved, 10); assert.equal(moved.gone, false);
  // Outside a run it is the representative condition, and nothing is recorded.
  sketch.circles.length = 0; sketch.draw(); assert.equal(sketch.circles.filter(circle => circle[2] === 4).length, 3);
  assert.ok(!traceOnly({ find: "p.circle(i * 10, 5, 4);", replace: "if (m.focus(i, i === 0)) m.trace(\"dot\", { op: 1 }); p.circle(i * 10, 5, 4);" }), "no checkpoints are added any more");
});

test("what a step changed is colored over the picture: drawn blue, gone orange, thickened", async () => {
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
  assert.match(frame, /pictureDiff\(from, image, CHANGE_COLORS\)/);
  assert.match(frame, /className="explore-bar board-scroll"/); assert.match(board, /closest\("\.board-scroll"\)/, "the bar scrolls inside instead of running off");
  assert.doesNotMatch(prompt, /m\.trace\(/, "the steps are the brush's own state machine steps");
});

test("an Execution frame explains itself on the picture with overlays that hold no grips, asked to be visual", () => {
  const frame = readFileSync("app/components/explore-frame.tsx", "utf8"), overlay = readFileSync("app/components/inspection-overlay.tsx", "utf8"), prompt = readFileSync("prompts/explore.md", "utf8");
  assert.match(frame, /className=\{`explore-caption \$\{lastPlace && lastPlace\.x \+ lastPlace\.w \/ 2 < 450 \? "right" : "left"\}`\}/, "a caption in the corner away from the step");
  assert.match(frame, /className="explore-step-mark last"/); assert.match(frame, /className="explore-step-mark next"/);
  assert.doesNotMatch(frame, /Step by gesture|nextStepGrip|gestureRange|latched/, "no execution handle: steps go by the buttons, the keys and pressing a part");
  assert.match(frame, /result\.overlays\.map\(item => \(\{ \.\.\.item, handle: null \}\)\)/, "the frame's own overlays hold no grip");
  assert.doesNotMatch(frame, /explore-sketch|recognizeMark/, "steps are never run by drawing a mark");
  assert.match(frame, /plain specs=\{specs\} textSize=\{textSize\}/, "the words on the picture take the size chosen");
  assert.match(frame, /aria-label="Larger text on the picture"/); assert.match(frame, /localStorage\.setItem\("rulegen:explore-text", String\(next\)\)/); assert.match(overlay, /const text = textSize \/ Math\.max\(\.2, zoom\);/);
  assert.match(prompt, /explain the step VISUALLY, so the picture alone is understandable without reading any text/);
  assert.match(prompt, /SHOW THE OPERATION AS GEOMETRY on the thing it works on/);
});

test("a step is shown by its own geometry on the picture, for any brush: its data's points and paths, its vector terms as arrows; the caption says only what it did", async () => {
  const { dataShapes, termGlyphs } = await import("../app/lib/explore");
  const shapes = dataShapes({ op: 2, x: 10, y: 20, w: 0, h: 0, path: [{ x: 1, y: 2 }, { x: 3, y: 4 }, { x: 5, y: 6 }], pair: { a: { x: 7, y: 8 }, b: { x: 9, y: 10 } }, gap: 12, far: { x: 5000, y: 0 } });
  assert.deepEqual(shapes.map(shape => [shape.key, shape.points.length]), [["path", 3], ["pair.a", 1], ["pair.b", 1]], "point lists as paths, points by name; the step's own place, plain numbers and points off the canvas are not");
  const glyphs = termGlyphs({ push: { last: [3, 4], mean: 5, n: 1 }, wind: { last: { x: -1, y: 0 }, mean: 1, n: 1 }, jitter: { last: -.4, mean: .4, n: 2 }, name: { last: "x", mean: null, n: 1 } });
  assert.deepEqual(glyphs.vectors, [{ name: "push", v: [3, 4] }, { name: "wind", v: [-1, 0] }]); assert.deepEqual(glyphs.scalars, [{ name: "jitter", value: -.4 }]);
  const frame = readFileSync("app/components/explore-frame.tsx", "utf8"), prompt = readFileSync("prompts/explore.md", "utf8");
  assert.match(frame, /className="explore-data last"/); assert.doesNotMatch(frame, /explore-term-bars/, "numbers are read in the bar, not drawn over the picture"); assert.match(frame, /\{ key: "@sum", v: sum, color: "#1f2a24", label: "together", className: "sum" \}/);
  // The picture points at the thing; the caption says briefly what the step did and what it decided (one verdict, how many more were compared), nothing ahead.
  for (const part of ["explore-caption-now", "explore-caption-verdict"]) assert.match(frame, new RegExp(`className=[^>]*${part}`));
  assert.doesNotMatch(frame, /explore-caption-why|explore-caption-next|<em>Next<\/em>|<em>Just executed<\/em>/, "no principle repeated on the picture, no next step told ahead");
  assert.match(prompt, /name NO terms/);
  // The execution state a step worked with shows as values on the picture: its points with their coordinates, its numbers beside it.
  assert.match(frame, /\$\{shape\.points\.length === 1 \? ` \(\$\{Math\.round\(end\.x\)\}, \$\{Math\.round\(end\.y\)\}\)` : ""\}/);
  assert.match(frame, /className="explore-data-values"/);
  // No text covers another: the frame's own are laid out together (clear of the step numbers and the caption), and the overlays' labels clear of them.
  assert.match(frame, /const lay = \(requests: LabelRequest\[\], size: number\) => \{ const out = layoutLabels\(requests, size, \{ width: 900, height: 600 \}, taken\);/);
  assert.match(frame, /reserved=\{sheet\.taken\}/); assert.match(readFileSync("app/components/inspection-overlay.tsx", "utf8"), /\[\.\.\.reserved, \.\.\.badges\.map/);
  const { layoutLabels } = await import("../app/lib/inspection");
  const held = { x: 90, y: 80, width: 200, height: 40 };
  const [label] = layoutLabels([{ key: "a", text: "distance 42", anchor: { x: 100, y: 100 }, shape: { x: 100, y: 100, w: 20, h: 20 } }], 17, { width: 900, height: 600 }, [held]);
  assert.ok(label && !(label.x < held.x + held.width && label.x + label.width > held.x && label.y - label.height * .8 < held.y + held.height && label.y + label.height * .2 > held.y), "placed clear of what another text holds"); assert.match(prompt, /The app DRAWS each step's data on the picture where it works, AS VALUES/);
  assert.doesNotMatch(frame, /explore-caption-values|className="explore-test pending"|className="explore-data next"/, "no list of values, nothing drawn ahead for the next step");
  assert.match(frame, /verdict = tested\.find\(test => test\.pass\) \?\? tested\[0\] \?\? null/, "one decision drawn per step");
  assert.match(frame, /className="explore-regenerate"/); assert.match(frame, /onRetry\(remake\)/, "the frame can be made again, saying what to change");
  assert.match(prompt, /The app DRAWS each step's data on the picture where it works/);
});
