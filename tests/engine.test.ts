import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { prepareCode } from "../app/server/code.server";
import { brushSchema, requestSchema } from "../app/lib/schema";
import { stamp, drawBrushPath, brushCode } from "../app/lib/brush-engine";
import { projectSchema, exampleStrokes } from "../app/lib/project";
const recipe = brushSchema.parse({ name: "Branch ink", description: "Recursive motif", settings: { spacing: 12, size: 30, spread: 35, variation: 20, taper: 60, color: "#547d64" }, primitives: [{ kind: "branch", coords: [0, 0, .6, -1.5], weight: .05, filled: false, depth: 3 }] });
function fakePainter() { const lines: number[][] = []; return { lines, color: () => ({ setAlpha() {} }), push() {}, pop() {}, translate() {}, rotate() {}, scale() {}, stroke() {}, noFill() {}, fill() {}, strokeWeight() {}, line: (...args: number[]) => lines.push(args) } as unknown as Parameters<typeof stamp>[0] & { lines: number[][] }; }
test("generated loops are bounded before they can freeze the browser", () => {
  const code = prepareCode("p.setup=()=>{p.createCanvas(900,600);while(true){p.line(0,0,1,1)}};");
  let budget = 0; const p = { setup() {}, createCanvas() {}, line() {} };
  vm.runInNewContext(code, { p, __rulegenGuard() { if (++budget > 50) throw new Error("budget"); } });
  assert.throws(() => p.setup(), /budget/);
});
test("recursive functions are guarded too", () => { const code = prepareCode("function grow(){grow()}p.setup=()=>{p.createCanvas(900,600);grow()}"); let budget = 0; const p = { setup() {}, createCanvas() {} }; vm.runInNewContext(code, { p, __rulegenGuard() { if (++budget > 20) throw new Error("budget"); } }); assert.throws(() => p.setup(), /budget/); });
test("network, dynamic evaluation, and DOM APIs cannot enter generated sketches", () => { for (const extra of ["fetch('x')", "document.body.innerHTML='x'", "p['constructor']('x')", "import('x')"]) assert.throws(() => prepareCode(`p.setup=()=>{p.createCanvas(900,600);${extra}}`)); });
test("regular p5 drawing remains executable", () => { let lines = 0; const p = { setup() {}, createCanvas() {}, line() { lines++; } }; vm.runInNewContext(prepareCode("p.setup=()=>{p.createCanvas(900,600);for(let i=0;i<3;i++)p.line(i,0,i,3)}"), { p, __rulegenGuard() {} }); p.setup(); assert.equal(lines, 3); });
test("brush recursion and density produce actual p5 marks", () => { const p = fakePainter(); stamp(p, recipe, 0, 0, 0, 1); assert.equal(p.lines.length, 7); p.lines.length = 0; drawBrushPath(p, recipe, [{ x: 0, y: 0 }, { x: 120, y: 0 }]); assert.equal(p.lines.length, 77); });
test("spacing changes the number of motif stamps", () => { const a = fakePainter(), b = fakePainter(); drawBrushPath(a, recipe, [{ x: 0, y: 0 }, { x: 120, y: 0 }]); drawBrushPath(b, { ...recipe, settings: { ...recipe.settings, spacing: 24 } }, [{ x: 0, y: 0 }, { x: 120, y: 0 }]); assert.ok(a.lines.length > b.lines.length); });
test("exported brush JavaScript is self contained", () => { const code = brushCode(recipe); assert.doesNotThrow(() => prepareCode(code)); const p = fakePainter(); Object.assign(p, { setup() {}, draw() {}, createCanvas() {}, background() {} }); vm.runInNewContext(code, { p, Math }); (p as unknown as { setup(): void }).setup(); });
test("remote image URLs are rejected", () => { assert.equal(requestSchema.safeParse({ intent: "analyze", image: "https://example.com/private" }).success, false); });
test("brush bounds reject runaway recursion and malformed settings", () => { assert.equal(brushSchema.safeParse({ ...recipe, primitives: [{ ...recipe.primitives[0], depth: 99 }] }).success, false); assert.equal(brushSchema.safeParse({ ...recipe, settings: { ...recipe.settings, spacing: 0 } }).success, false); });
test("projects serialize actual strokes and editable results without secrets", () => { const artwork = { strokes: exampleStrokes(), photo: null, name: "Branch studies", revision: 1 }; const saved = projectSchema.parse({ version: 1, name: artwork.name, artwork, features: [], groups: [], analysisRevision: -1, generated: null, brush: recipe, savedBrushes: [recipe] }); const restored = projectSchema.parse(JSON.parse(JSON.stringify(saved))); assert.equal(restored.artwork.strokes.length, 63); assert.equal(restored.brush!.name, recipe.name); assert.equal(JSON.stringify(saved).includes("OPENAI_API_KEY"), false); });

test("zoom keeps the world point beneath the cursor fixed", async () => {
  const { zoomAt } = await import("../app/lib/workspace");
  const camera = { zoom: .5, x: -130, y: 80 }, anchor = { x: 340, y: 210 };
  const next = zoomAt(camera, 1.4, anchor);
  assert.ok(Math.abs((anchor.x - camera.x) / camera.zoom - (anchor.x - next.x) / next.zoom) < 1e-9);
  assert.ok(Math.abs((anchor.y - camera.y) / camera.zoom - (anchor.y - next.y) / next.zoom) < 1e-9);
});
test("fit includes freely moved frames at negative world coordinates", async () => {
  const { fitFrames } = await import("../app/lib/workspace");
  const frames = [{ x: -800, y: -200 }, { x: 240, y: 0 }], view = fitFrames(frames, 900, 650);
  for (const f of frames) { assert.ok(f.x * view.zoom + view.x >= 0); assert.ok(f.y * view.zoom + view.y >= 0); assert.ok((f.x + 900) * view.zoom + view.x <= 900); assert.ok((f.y + 600) * view.zoom + view.y <= 650); }
});
test("older projects gain frames and camera positions survive export", () => {
  const old = { version: 1, name: "Old", artwork: { strokes: [], photo: null, name: "Old", revision: 0 }, features: [], groups: [], analysisRevision: -1, generated: null, brush: null, savedBrushes: [] };
  const migrated = projectSchema.parse(old); assert.equal(migrated.workspace.camera, null);
  migrated.workspace.frames.result = { x: -250, y: 980 }; migrated.workspace.camera = { zoom: .6, x: 45, y: -160 };
  assert.deepEqual(projectSchema.parse(JSON.parse(JSON.stringify(migrated))).workspace, migrated.workspace);
});


test("locally declared geometry coordinates named top or parent are allowed while browser globals stay blocked", () => {
  const code = "p.setup=()=>{p.createCanvas(900,600);const top=10,parent={x:20};p.line(parent.x,top,30,40);}";
  assert.doesNotThrow(() => prepareCode(code));
  assert.throws(() => prepareCode("p.setup=()=>{p.createCanvas(900,600);top.location='x';}"));
  assert.throws(() => prepareCode("p.setup=()=>{p.createCanvas(900,600);parent.postMessage('x','*');}"));
});
