import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { prepareCode } from "../app/server/code.server";
import { requestSchema } from "../app/lib/schema";
import { projectSchema, exampleStrokes } from "../app/lib/project";
test("generated loops are bounded before they can freeze the browser", () => {
  const code = prepareCode("p.setup=()=>{p.createCanvas(900,600);while(true){p.line(0,0,1,1)}};");
  let budget = 0; const p = { setup() {}, createCanvas() {}, line() {} };
  vm.runInNewContext(code, { p, __rulegenGuard() { if (++budget > 50) throw new Error("budget"); } });
  assert.throws(() => p.setup(), /budget/);
});
test("recursive functions are guarded too", () => { const code = prepareCode("function grow(){grow()}p.setup=()=>{p.createCanvas(900,600);grow()}"); let budget = 0; const p = { setup() {}, createCanvas() {} }; vm.runInNewContext(code, { p, __rulegenGuard() { if (++budget > 20) throw new Error("budget"); } }); assert.throws(() => p.setup(), /budget/); });
test("network, dynamic evaluation, and DOM APIs cannot enter generated sketches", () => { for (const extra of ["fetch('x')", "document.body.innerHTML='x'", "p['constructor']('x')", "import('x')"]) assert.throws(() => prepareCode(`p.setup=()=>{p.createCanvas(900,600);${extra}}`)); });
test("regular p5 drawing remains executable", () => { let lines = 0; const p = { setup() {}, createCanvas() {}, line() { lines++; } }; vm.runInNewContext(prepareCode("p.setup=()=>{p.createCanvas(900,600);for(let i=0;i<3;i++)p.line(i,0,i,3)}"), { p, __rulegenGuard() {} }); p.setup(); assert.equal(lines, 3); });
test("local coordinates and function parameters can share browser-global names", () => {
  const marks: number[][] = [];
  const p = { setup() {}, createCanvas() {}, rect(...args: number[]) { marks.push(args); } };
  const code = prepareCode(`
    function drawCell(top, parent) { p.rect(0, top, 20, parent); }
    p.setup = () => {
      p.createCanvas(900, 600);
      const top = 28;
      const parent = 40;
      drawCell(top, parent);
      { const top = 56; drawCell(top, parent); }
    };
  `);
  vm.runInNewContext(code, { p, __rulegenGuard() {} });
  p.setup();
  assert.deepEqual(marks, [[0, 28, 20, 40], [0, 56, 20, 40]]);
});
test("a local top binding does not permit browser globals or unsafe member access", () => {
  for (const extra of ["top.postMessage('x','*')", "parent.postMessage('x','*')", "window.top", "globalThis.top", "p.top", "p['top']", "p.constructor", "p['constructor']", "eval('1')", "Function('return 1')"]) {
    assert.throws(() => prepareCode(`p.setup=()=>{p.createCanvas(900,600);${extra}}`), /지원하지 않는/);
  }
  assert.throws(() => prepareCode("function local(){const top=28;return top;}p.setup=()=>{p.createCanvas(900,600);top.postMessage('x','*');}"), /API: top/);
  assert.throws(() => prepareCode("p.setup=()=>{p.createCanvas(900,600);const top=28;p.top;};"), /API: top/);
});
test("remote image URLs are rejected", () => { assert.equal(requestSchema.safeParse({ intent: "extract", image: "https://example.com/private" }).success, false); });
test("projects serialize actual strokes and editable results without secrets", () => { const artwork = { strokes: exampleStrokes(), photo: null, name: "Branch studies", revision: 1 }; const saved = projectSchema.parse({ version: 2, name: artwork.name, artwork }); const restored = projectSchema.parse(JSON.parse(JSON.stringify(saved))); assert.equal(restored.artwork.strokes.length, 63); assert.equal(JSON.stringify(saved).includes("OPENAI_API_KEY"), false); });

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
test("new projects gain frames and camera positions survive export", () => {
  const migrated = projectSchema.parse({ version: 2, name: "New", artwork: { strokes: [], photo: null, name: "New", revision: 0 } }); assert.equal(migrated.workspace.camera, null);
  migrated.workspace.frames.source = { x: -250, y: 980 }; migrated.workspace.camera = { zoom: .6, x: 45, y: -160 };
  assert.deepEqual(projectSchema.parse(JSON.parse(JSON.stringify(migrated))).workspace, migrated.workspace);
});
test("strings named like browser APIs are plain data unless used as a computed key or a reflection name", () => {
  const wrap = (body: string) => `p.setup=()=>{p.createCanvas(900,600);${body}};`;
  // A select value compared in generated code (the reported failure), object keys and labels.
  for (const ok of ["const alignment = 'top'; p.translate(0, alignment === 'top' ? -30 : 0);", "const box = { top: 4, parent: null }; p.rect(0, box['y'] || 0, 2, 2);", "const labels = ['window', 'location']; p.text(labels[0], 0, 0);", "const align = `top`;"])
    assert.doesNotThrow(() => prepareCode(wrap(ok)), ok);
  for (const bad of ["p['top']", "p[`window`]", "p?.['parent']", "const k = 'constructor';", "Reflect.get(p, '__proto__')", "({ constructor: 1 })", "box.top"])
    assert.throws(() => prepareCode(wrap(`const box = {}; ${bad}`)), bad);
});
