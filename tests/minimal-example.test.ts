import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { sampleScene } from "./fixtures/scene";
import { PropertyInspector } from "../app/components/scene/property-inspector";

test("adding or modifying with AI opens a composer: what is attached, a text box, drawing on the frame, then the AI's clarification to apply", () => {
  const scene = sampleScene(), node = scene.nodes.find(item => item.id === "tree")!, noop = () => {};
  const render = (draft: unknown) => renderToStaticMarkup(createElement(PropertyInspector, new Proxy({ node, transformations: node.transformations, state: null, busy: false, library: scene.algorithms, draft,
    describeClarification: () => "「Tree」의 「Ink wash」 수정" } as Record<string, unknown>,
    { get: (target, key) => key in target ? target[key as string] : noop }) as never));
  assert.doesNotMatch(render(null), /ADD OR MODIFY WITH AI/, "nothing runs or opens until a button is pressed");
  const html = render({ nodeId: "tree", target: { transformationId: "ink-wash" }, instruction: "", annotating: false, marks: [], markPens: [], clarification: null, answer: "" });
  assert.equal(html.match(/ADD OR MODIFY WITH AI/g)?.length, 1);
  assert.match(html, /<b>Transformation<\/b>[^<]*첨부됨/); assert.match(html, /Draw on frame/); assert.match(html, /aria-label="What to add or change"/);
  assert.match(html, />Clarify<\/button>/); assert.doesNotMatch(html, /Apply<\/button>/, "nothing is applied before the AI clarifies");
  const drawn = render({ nodeId: "tree", target: {}, instruction: "흔들리게", annotating: true, marks: [[{ x: .1, y: .1 }, { x: .2, y: .2 }]], markPens: [""], clarification: null, answer: "" });
  assert.match(drawn, /<b>New transformation<\/b>/); assert.match(drawn, /Annotation<\/b>1획 첨부됨/); assert.match(drawn, /Done drawing/);
  // The AI's clarification: what it understood, the target, the plan and questions; then Apply or Clarify again.
  const clarified = render({ nodeId: "tree", target: { transformationId: "ink-wash" }, instruction: "더 진하게", annotating: false, marks: [], markPens: [], answer: "",
    clarification: { understanding: "번짐을 더 진하게 하려는 것으로 이해했습니다.", action: "modify", nodeId: "tree", transformationId: "ink-wash", propertyId: "", plan: "Ink 색을 더 어둡게 바꿉니다.", questions: ["번짐 범위도 넓힐까요?"] } });
  assert.match(clarified, /AI가 이해한 내용/); assert.match(clarified, /<b>수정<\/b>「Tree」의 「Ink wash」 수정/); assert.match(clarified, /Ink 색을 더 어둡게/);
  assert.match(clarified, /번짐 범위도 넓힐까요\?/); assert.match(clarified, /aria-label="Answer the questions"/); assert.match(clarified, /Apply<\/button>/); assert.match(clarified, /Clarify again/);
});

test("the bottom panel (code, state machine) has a height handle on its top edge", async () => {
  const { RawCodePanel } = await import("../app/components/raw-code-panel");
  const html = renderToStaticMarkup(createElement(RawCodePanel, { code: "p.circle(1,1,1);", sketchName: "A", fileName: "a", onCopy: () => {}, onError: () => {} }));
  assert.match(html, /role="separator" aria-orientation="horizontal" aria-label="Resize bottom panel"/);
});


test("a transformation taken from a pen shows the example it came from, and goes there", () => {
  const scene = sampleScene(), node = scene.nodes.find(item => item.id === "tree")!, noop = () => {}, visited: string[] = [];
  const taken = { ...node, transformations: [{ ...node.transformations[0], origin: { frameId: "sketch-ex", transformationId: "branching", label: "Branching" } }, node.transformations[1]] };
  const html = renderToStaticMarkup(createElement(PropertyInspector, new Proxy({ node: taken, transformations: taken.transformations, state: null, busy: false, library: scene.algorithms, onOrigin: (id: string) => { visited.push(id); return true; } } as Record<string, unknown>,
    { get: (target, key) => key in target ? target[key as string] : noop }) as never));
  assert.equal(html.match(/From pen · Branching example/g)?.length, 1, "only the one from a pen");
  assert.doesNotMatch(html, /Create Minimal Example|Make pen|PROXY HANDLE/);
});
