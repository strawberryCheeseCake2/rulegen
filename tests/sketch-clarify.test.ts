import { test } from "node:test";
import assert from "node:assert/strict";
import { answeredStages, clarifiedText, filledPreview, MAX_CLARIFY_STAGES, safeSvg, settleSketchClarify, sketchInput, startingAnswers, type ClarifyAnswer, type ClarifyQuestion, type SketchClarifyResult } from "../app/lib/sketch-clarify";
import { withMockedAI } from "./fixtures/scene";
import { runAI } from "../app/server/ai.server";
import { loadPrompt } from "../app/server/prompts.server";
import { schemaText } from "../scripts/prompt-schemas";
import { requestSchema } from "../app/lib/schema";

const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80">${body}</svg>`;
const question = (patch: Partial<ClarifyQuestion>): ClarifyQuestion => ({ id: "q", kind: "text", question: "What is it?", why: "", options: [], placeholder: "", params: [], preview: "", ...patch });
const param = (patch: Partial<ClarifyQuestion["params"][number]>) => ({ id: "p", label: "Count", kind: "number" as const, min: 1, max: 10, step: 1, unit: "", value: 5, color: "", ...patch });

test("a stage keeps only well-formed questions: choices need two options, values need params, unsafe SVG is dropped", () => {
  const output: SketchClarifyResult = { done: false, reason: " r ", questions: [
    question({ id: "one option", kind: "choice", options: [{ id: "a", label: "A", svg: svg(""), logic: "", sketch: "" }] }),
    question({ id: "what", kind: "choice", options: [{ id: "x y", label: " Grass ", svg: svg('<circle r="3"/>'), logic: "", sketch: "" }, { id: "x y", label: "Flames", svg: svg('<script>1</script>'), logic: "", sketch: "" }, { id: "z", label: " ", svg: "", logic: "", sketch: "" }] }),
    question({ id: "what", kind: "confirm", question: "Is it a tree?" }),
    question({ id: "v", kind: "value", params: [param({ min: 10, max: 2, value: 99, step: -1 }), param({ id: "tint", kind: "color", color: "red" })], preview: svg('<rect onload="x()"/>') }),
    question({ id: "empty", kind: "value", params: [] }),
    question({ id: "blank", question: "  " }),
  ] };
  const settled = settleSketchClarify(output, 0);
  assert.equal(settled.done, false); assert.equal(settled.reason, "r");
  assert.deepEqual(settled.questions.map(item => [item.id, item.kind]), [["what", "choice"], ["what-2", "confirm"], ["v", "value"]]);
  const [choice, , value] = settled.questions;
  assert.deepEqual(choice.options.map(option => [option.id, option.label]), [["x-y", "Grass"], ["x-y-2", "Flames"]]);
  assert.equal(choice.options[1].svg, "", "a thumbnail with a script is not shown");
  assert.deepEqual(value.params.map(item => [item.min, item.max, item.value, item.color]), [[2, 10, 10, ""], [0, 0, 0, "#808080"]]);
  assert.ok(value.params[0].step > 0);
  assert.equal(value.preview, "", "a preview with an event handler is not shown");
});

test("clarifying ends when nothing is left to ask, and after the last stage whatever the AI says", () => {
  assert.equal(settleSketchClarify({ done: false, reason: "", questions: [question({ question: "" })] }, 1).done, true);
  assert.deepEqual(settleSketchClarify({ done: true, reason: "clear", questions: [question({})] }, 0), { done: true, reason: "clear", questions: [] });
  assert.deepEqual(settleSketchClarify({ done: false, reason: "", questions: [question({})] }, MAX_CLARIFY_STAGES).questions, []);
  assert.equal(safeSvg('<svg><a href="javascript:x"/></svg>'), "");
  assert.equal(safeSvg("<div/>"), "");
});

test("answers go with the next stage and with the request as text; values start at the proposed ones and fill the preview", () => {
  const questions = settleSketchClarify({ done: false, reason: "", questions: [
    question({ id: "what", kind: "choice", question: "What are the curves?", options: [{ id: "grass", label: "Grass", svg: "", logic: "", sketch: "" }, { id: "fire", label: "Flames", svg: "", logic: "", sketch: "" }] }),
    question({ id: "ok", kind: "confirm", question: "Do they sway?" }),
    question({ id: "size", kind: "value", question: "How tall?", params: [param({ id: "h", label: "Height", unit: "px", value: 4 }), param({ id: "c", label: "Color", kind: "color", color: "#112233" })], preview: svg('<rect height="{{h}}" fill="{{ c }}"/>') }),
    question({ id: "free", question: "What is the symbol?" }),
  ] }, 0).questions;
  const answers: Record<string, ClarifyAnswer> = { ...startingAnswers(questions), what: { choice: "fire" }, ok: { confirm: false } };
  assert.deepEqual(answers.size, { values: { h: 4, c: "#112233" } });
  assert.equal(filledPreview(questions[2], { values: { h: 7, c: "#abcdef" } }), svg('<rect height="7" fill="#abcdef"/>'));
  assert.equal(filledPreview(questions[2], { values: { h: 7, c: '"/><script>' } }), svg('<rect height="7" fill="#112233"/>'), "only a color goes into the preview");
  const stages = [{ questions, answers }];
  assert.deepEqual(answeredStages(stages)[0].map(item => item.answer), ["Flames", "no", "Height = 4 px, Color = #112233", "(no preference: decide from the sketch)"]);
  assert.equal(clarifiedText(stages), "The user clarified:\n- What are the curves? → Flames\n- Do they sway? → no\n- How tall? → Height = 4 px, Color = #112233");
  assert.equal(clarifiedText([{ questions: [questions[3]], answers: {} }]), "");
});

test("sketch-clarify sends its prompt, strict schema and the answered stages, and returns a settled stage", async () => {
  const image = "data:image/png;base64,AAAA";
  await withMockedAI(() => ({ done: false, reason: "two readings", questions: [question({ id: "what", kind: "choice", options: [{ id: "a", label: "A", svg: "", logic: "", sketch: "" }, { id: "b", label: "B", svg: "", logic: "", sketch: "" }] })] }), async calls => {
    const result = await runAI(requestSchema.parse({ intent: "sketch-clarify", image, instruction: "a forest",
      sketchClarify: { mode: "compose", stages: [[{ question: "Trees?", kind: "confirm", answer: "yes" }]] } }), new AbortController().signal) as SketchClarifyResult;
    assert.equal(result.questions[0].options.length, 2);
    assert.equal(calls[0].instructions, loadPrompt("sketch-clarify"));
    assert.deepEqual(calls[0].text.format.schema, JSON.parse(schemaText("sketch-clarify")));
    const context = JSON.parse(calls[0].input[0].content[0].text);
    assert.equal(context.mode, "compose"); assert.equal(context.stage, 2); assert.equal(context.mustAsk, false); assert.equal(context.maxStages, MAX_CLARIFY_STAGES);
    assert.deepEqual(context.answered, [{ stage: 1, questions: [{ question: "Trees?", kind: "confirm", answer: "yes" }] }]);
  });
  await assert.rejects(runAI(requestSchema.parse({ intent: "sketch-clarify", sketchClarify: { mode: "extract", stages: [] } }), new AbortController().signal), /sketch image/);
});

test("with Clarify first, Extract asks stage by stage and then extracts with the answers", async () => {
  const { sceneAI } = await import("../app/studio/scene-actions");
  const { createSketchPanel } = await import("../app/lib/sketch-panels");
  const { aiScene } = await import("./fixtures/scene");
  const { convertScene } = await import("../app/lib/scene/convert");
  const panels: Record<string, ReturnType<typeof createSketchPanel>> = { source: { ...createSketchPanel(), instruction: "only the tree" } };
  const requests: { intent: string; body: any }[] = [];
  const stages: SketchClarifyResult[] = [
    { done: false, reason: "", questions: [question({ id: "kind", kind: "choice", question: "Which tree?", options: [{ id: "pine", label: "Pine", svg: "", logic: "", sketch: "" }, { id: "oak", label: "Oak", svg: "", logic: "", sketch: "" }] })] },
    { done: true, reason: "clear", questions: [] },
  ];
  const deps = {
    panel: (id: string) => panels[id], activate: () => {}, toast: () => {}, focus: () => {}, clarifyFirst: () => true,
    updatePanel: (id: string, patch: any) => { panels[id] = { ...panels[id], ...(typeof patch === "function" ? patch(panels[id]) : patch) }; },
    task: async (_label: string, work: () => Promise<void>) => { await work(); },
    request: async (intent: string, body: any) => { requests.push({ intent, body });
      return intent === "sketch-clarify" ? stages.shift() : intent === "extract" ? convertScene(structuredClone(aiScene)) : { title: "Tree", explanation: "", code: "p.setup=()=>{p.createCanvas(900,600);};" }; },
    capture: async () => ({ image: "data:image/png;base64,AAAA", region: { x: 0, y: 0, w: 1, h: 1 } }),
    artwork: (id: string) => id === "source" ? { name: "Tree sketch", photo: null, strokes: [], revision: 3 } : { name: "x", photo: null, strokes: [], revision: 0 },
    createFrame: () => { panels.derived = createSketchPanel(); return "derived"; },
    documentId: () => 1, requestId: () => 1, addPen: () => {}, addBrushes: () => [], preview: () => undefined,
  } as any;
  const ai = sceneAI(deps, "source");
  await ai.extract();
  assert.deepEqual(requests.map(item => item.intent), ["sketch-clarify"], "nothing is extracted before the questions are answered");
  assert.equal(panels.source.sketchClarify?.stages.length, 1);
  ai.answerClarify("kind", { choice: "oak" });
  await ai.continueClarify();
  assert.deepEqual(requests.map(item => item.intent), ["sketch-clarify", "sketch-clarify", "extract", "code"]);
  assert.deepEqual(requests[1].body.sketchClarify.stages, [[{ question: "Which tree?", kind: "choice", answer: "Oak" }]]);
  assert.equal(requests[2].body.instruction, "only the tree\n\nThe user clarified:\n- Which tree? → Oak");
  assert.equal(panels.derived.instruction, requests[2].body.instruction, "the extracted frame's code follows the answers too");
  assert.equal(panels.source.sketchClarify, null);
});

test("at least one stage is asked: found clear at first, it asks again for what is most uncertain (still clear: the panel says why)", async () => {
  const { sceneAI } = await import("../app/studio/scene-actions");
  const { createSketchPanel } = await import("../app/lib/sketch-panels");
  const panels: Record<string, ReturnType<typeof createSketchPanel>> = { source: { ...createSketchPanel(), composePrompt: "a forest", composeWithText: true } };
  const requests: any[] = [];
  const replies: SketchClarifyResult[] = [{ done: true, reason: "one reading", questions: [] }, { done: false, reason: "", questions: [question({ id: "move" })] },
    { done: true, reason: "one reading", questions: [] }, { done: true, reason: "still one", questions: [] }];
  const deps = {
    panel: (id: string) => panels[id], activate: () => {}, toast: () => {}, focus: () => {}, clarifyFirst: () => true,
    updatePanel: (id: string, patch: any) => { panels[id] = { ...panels[id], ...(typeof patch === "function" ? patch(panels[id]) : patch) }; },
    task: async (_label: string, work: () => Promise<void>) => { await work(); },
    request: async (intent: string, body: any) => { requests.push({ intent, body }); return replies.shift(); },
    capture: async () => ({ image: "data:image/png;base64,AAAA", region: { x: 0, y: 0, w: 1, h: 1 } }),
    artwork: () => ({ name: "s", photo: null, strokes: [], revision: 1 }), documentId: () => 1, requestId: () => 1,
  } as any;
  const ai = sceneAI(deps, "source");
  await ai.compose();
  assert.deepEqual(requests.map(item => [item.intent, item.body.sketchClarify.askAnyway]), [["sketch-clarify", false], ["sketch-clarify", true]]);
  assert.equal(panels.source.sketchClarify?.stages.length, 1, "the questions are shown, nothing composed");
  ai.cancelClarify();
  await ai.compose();
  assert.equal(requests.length, 4);
  assert.equal(panels.source.sketchClarify?.clear, "still one", "never composed without the user");
});

test("a choice whose readings differ in logic keeps each option's logic and its in-situ drawing (only code that parses)", () => {
  const output: SketchClarifyResult = { done: false, reason: "", questions: [question({ id: "how", kind: "choice", options: [
    { id: "even", label: "Even", svg: "", logic: " x = i × gap ", sketch: "ctx.fillRect(10, 10, 5, 5); note.label(20, 20, 'gap');" },
    { id: "broken", label: "Broken", svg: "", logic: "x = ?", sketch: "ctx.fillRect(10, 10," },
  ] })] };
  const [choice] = settleSketchClarify(output, 0).questions;
  assert.deepEqual(choice.options.map(option => [option.logic, Boolean(option.sketch)]), [["x = i × gap", true], ["x = ?", false]]);
});

test("the prompt asks for in-situ logic drawings for choices that differ in logic", async () => {
  const prompt = await loadPrompt("sketch-clarify");
  assert.match(prompt, /In-situ logic/); assert.match(prompt, /COMPUTE where and how big to draw from `input.strokes`/); assert.match(prompt, /note\.region/); assert.match(prompt, /"sketch"/);
});

test("an in-situ drawing gets the sketch's strokes in canvas pixels (same ids, with box and center) to place what it draws", () => {
  const input = sketchInput([
    { id: "stroke-1", tool: "semantic", color: "#4a7a3a", width: 4, semanticPenId: "mark-pen-1", points: [{ x: .4, y: .9 }, { x: .42, y: .6 }] },
    { id: "stroke-2", tool: "eraser", color: "#fff", width: 9, semanticPenId: null, points: [{ x: .1, y: .1 }] },
    { id: "stroke-3", tool: "pencil", color: "#000", width: 2, semanticPenId: null, points: Array.from({ length: 128 }, (_, k) => ({ x: k / 127, y: .5 })) },
  ]);
  assert.deepEqual([input.width, input.height], [900, 600]);
  assert.deepEqual(input.strokes.map(stroke => stroke.id), ["stroke-1", "stroke-3"], "erasers are left out");
  assert.deepEqual(input.strokes[0], { id: "stroke-1", tool: "semantic", color: "#4a7a3a", width: 4, pen: "mark-pen-1", points: [[360, 540], [378, 360]], box: { x: 360, y: 360, w: 18, h: 180 }, center: [369, 450] });
  assert.ok(input.strokes[1].points.length <= 65); assert.deepEqual(input.strokes[1].points.at(-1), [900, 300], "the last point stays");
  assert.deepEqual(sketchInput().strokes, []);
});
