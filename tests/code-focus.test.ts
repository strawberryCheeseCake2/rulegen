import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { sampleScene, sceneProgram } from "./fixtures/scene";
import { connectScene } from "../app/server/scene-code.server";
import { assignedAt, focusLines } from "../app/lib/code-focus";
import { RawCodePanel } from "../app/components/raw-code-panel";

const scene = sampleScene(), code = connectScene({ title: "Tree", explanation: "", code: sceneProgram }, scene).code, lines = code.split("\n");
const at = (text: string) => lines.findIndex(line => line.includes(text));

test("an inspection's focus in the code: where the code refers to it (by the code contract), and the lines using what those read", () => {
  // A param: its value key; the variables they are read into, where those are used.
  const structure = focusLines(code, scene, { kind: "param", nodeId: "tree", id: "structure" })!;
  assert.deepEqual(structure.lines, [at('m.v("tree/structure")')]);
  assert.deepEqual(structure.related, [at("lengths.push(decayed(base, ratio, i))")], "the depth it is read into is used there");
  assert.equal(structure.label, 'm.v("tree/structure…")');
  // A constraint: its compute function (named in the module's constraints map), and its params' reads and that entry.
  const branches = focusLines(code, scene, { kind: "constraint", nodeId: "tree", id: "branching-growth" })!;
  assert.deepEqual(branches.lines, Array.from({ length: at("return lengths;") + 2 - at("function computeBranches") }, (_, k) => at("function computeBranches") + k), "the whole function");
  assert.deepEqual(branches.related, [at('"branching-growth": computeBranches')]);
  assert.equal(branches.label, "computeBranches() computes branches");
  assert.deepEqual(focusLines(code, scene, { kind: "constraint", nodeId: "orb", id: "pulse" })!.lines, [at("function computeSize")]);
  // A state: where an owner's state is compared with it, and where the node's FSM is used; a transition: where its event is dispatched.
  const moving = focusLines(code, scene, { kind: "state", nodeId: "orb", id: "moving" })!;
  assert.deepEqual([moving.lines, moving.related, moving.kind], [[at('orb.state === "moving"')], [at('const orb = m.fsm("orb")'), at('mousePressed() { m.fsm("orb")')], "state"]);
  assert.deepEqual(focusLines(code, scene, { kind: "transition", nodeId: "orb", id: "press" })!.lines, [at('dispatch("press")')]);
  assert.equal(focusLines(code, scene, { kind: "transition", nodeId: "orb", id: "settle" })!.label, 'owner.dispatch("settle")');
  assert.equal(focusLines(code, scene, { kind: "state", nodeId: "orb", id: "idle" }), null, "never compared in the code");
  assert.equal(focusLines(code, scene, { kind: "param", nodeId: "tree", id: "missing" }), null);
});

test("the variable a read is given: the declarator it is in, not one around a call it is an argument of", () => {
  assert.equal(assignedAt('const h = height(d, id), r = m.v("k", id);', 28), "r");
  assert.equal(assignedAt('const x = a + m.v("k") * 2;', 18), "x");
  assert.equal(assignedAt('if (m.v("k") > 3) {', 8), null);
  assert.equal(assignedAt('p.circle(0, 0, m.v("k"));', 19), null);
  assert.equal(assignedAt('for (const item of items) { const s = m.v("k");', 44), "s");
});

test("the code panel: the code is edited in place (highlighted as typed), run with the button or ⌘/Ctrl+Enter, put back; a focus marks its lines", () => {
  const panel = (draft: string, focus = focusLines(code, scene, { kind: "param", nodeId: "tree", id: "structure" })) => renderToStaticMarkup(createElement(RawCodePanel, {
    code, sketchName: "Sketch", fileName: "sketch", onCopy: () => {}, onError: () => {}, focus,
    editor: { draft, busy: false, runtimeError: "", onDraft: () => {}, onRun: () => {}, onFix: () => {} } }));
  const same = panel(code);
  assert.match(same, /<textarea class="raw-code-input measuring"[^>]*aria-label="p5.js code \(edit it here; ⌘\/Ctrl\+Enter runs it\)"/, "editable without switching modes");
  assert.match(same, /aria-label="Run edited code" disabled=""/, "nothing edited: nothing to run"); assert.doesNotMatch(same, /Edited|Revert edits/);
  assert.equal(same.match(/class="raw-code-line focused"/g)?.length, 1); assert.equal(same.match(/class="raw-code-line related"/g)?.length, 1);
  assert.match(same, /class="raw-code-focus"[^>]*>m.v\(&quot;tree\/structure…&quot;\) · 1<\/span>/);
  const edited = panel(code.replace("const depth", "let depth"));
  assert.match(edited, /class="raw-code-edited">Edited · ⌘↵ runs/); assert.match(edited, /aria-label="Revert edits"/); assert.doesNotMatch(edited, /aria-label="Run edited code" disabled=""/);
  assert.match(edited, /<span class="token keyword">let<\/span><span> depth <\/span>/, "shown as typed, highlighted");
});
