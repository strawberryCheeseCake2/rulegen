import test from "node:test";
import assert from "node:assert/strict";
import { sampleScene, sceneProgram, withMockedAI } from "./fixtures/scene";
import { runAI } from "../app/server/ai.server";
import { loadPrompt } from "../app/server/prompts.server";
import { requestSchema } from "../app/lib/schema";
import { connectScene } from "../app/server/scene-code.server";
import { demoIds, generalizeQuestion, generalizeRequest, generalizeSchema, settleGeneralize, shownText, type Demonstration, type Generalize } from "../app/lib/execution/generalize";
import { previewSites } from "../app/studio/use-generalize";

const signal = () => new AbortController().signal;
const demo: Demonstration = {
  concern: "색이 덜 자주 바뀌게", rule: "Group stripes by hand (pencil loops)",
  tools: [{ kind: "pencil", purpose: "같은 색이 될 줄무늬를 묶어 그리세요." }],
  targets: [
    { id: "groups", name: "묶음", where: "constraint:tree/stripes @groups", param: "", meaning: "묶은 줄무늬는 한 색", shown: "[3, 4, 3, 4]", drawn: "3 – 4 (4)" },
    { id: "ratio", name: "Ratio", where: "", param: "tree/ratio", meaning: "그대로 param", shown: "0.6", drawn: "" },
  ],
  values: { groups: [3, 4, 3, 4], ratio: .6 },
  strokes: [{ id: "a", tool: "pencil", points: [{ x: 10, y: 10 }, { x: 80, y: 40 }], width: 3, dx: 0, dy: 0, scale: 1, rotate: 0 }],
};
const option = (change: Partial<Generalize["options"][number]> = {}) => ({ id: "random-run", rule: "Runs of 3–4 at random", logic: "run = randInt(3, 4)", detail: "Each color lasts 3 or 4 stripes.",
  fromShown: "groups of 3 and 4 → run length random in [3, 4]", thumbnail: "note.label(100, 200, 'x');", ...change });
const answer = (options = [option(), option({ id: "random-run", rule: "3 and 4 in turn", thumbnail: "return (" })]): Generalize => ({ summary: "묶음은 3개와 4개", question: "", reason: "범위인지 패턴인지", options });

test("the rules a demonstration could be: ids made unique, previews that do not parse dropped, at least one rule", () => {
  const settled = settleGeneralize(answer());
  assert.deepEqual(settled.options.map(item => item.id), ["random-run", "random-run-2"]);
  assert.equal(settled.options[1].thumbnail, "", "a preview that does not parse is not drawn");
  assert.equal(settled.question, "묶음은 3개와 4개", "no question: the summary asks");
  assert.throws(() => settleGeneralize(answer([])), /No rule/);
  assert.throws(() => settleGeneralize(answer([option({ rule: " " })])), /No rule/);
});

test("the request says what was shown and, for the rule picked, that the code computes it itself without the shown values", () => {
  const asked = generalizeQuestion(demo);
  assert.match(asked, /색이 덜 자주/); assert.match(asked, /m\.demo\("groups"\)/); assert.match(asked, /param tree\/ratio/); assert.match(asked, /shown: \[3, 4, 3, 4\]/); assert.match(asked, /drawn with it: 3 – 4/);
  assert.deepEqual(demoIds(demo), ["groups"], "a param is set as is, not read with m.demo");
  const request = generalizeRequest(demo, "How should it group colors?", option());
  assert.match(request, /Rule chosen for "How should it group colors\?": Runs of 3–4 at random \(run = randInt\(3, 4\)\)/);
  assert.match(request, /run length random in \[3, 4\]/);
  assert.match(request, /nothing reads m\.demo\("groups"\) any more/);
  assert.match(request, /constraints that decide this outcome describe the rule/);
  assert.match(request, /state or a transition only when the rule needs one/);
  assert.equal(shownText(null), "—"); assert.equal(shownText([3, 4, 3]), "3 – 4 (3)");
});

test("trace-generalize is asked with the demonstration, the brush's code, what it recorded and both pictures", async () => {
  const scene = sampleScene(), code = connectScene({ title: "Tree", explanation: "", code: sceneProgram }, scene).code;
  await withMockedAI(() => answer(), async calls => {
    const result = generalizeSchema.parse(await runAI(requestSchema.parse({ intent: "trace-generalize", scene, previous: code, image: "data:image/png;base64,BBBB", resultImage: "data:image/png;base64,AAAA",
      annotations: [{ id: "a", points: [{ x: .1, y: .1 }, { x: .2, y: .2 }] }], instruction: generalizeQuestion(demo),
      trace: { concern: demo.concern, nodeIds: ["tree"], cycles: 1, sites: [{ site: "constraint:tree/stripes", variables: { groups: "[3, 4]" } }], marks: [] } }), signal()));
    assert.equal(result.options.length, 2);
    const sent = JSON.stringify(calls[0]);
    assert.match(sent, /색이 덜 자주/); assert.match(sent, /rulegenModule/); assert.match(sent, /constraint:tree\/stripes/);
    assert.ok(sent.indexOf("AAAA") < sent.indexOf("BBBB"), "the brush without what was shown comes first");
    assert.match(sent, /The brush as it draws without what was shown/);
  });
  await assert.rejects(runAI(requestSchema.parse({ intent: "trace-generalize", scene, previous: code, instruction: "x", trace: { concern: "c", nodeIds: ["tree"], cycles: 0, sites: [] } }), signal()), /Show something/);
  const prompt = loadPrompt("trace-generalize");
  assert.match(prompt, /EVERYWHERE/); assert.match(prompt, /COMPUTE positions and sizes/); assert.match(prompt, /fromShown/); assert.match(prompt, /illustrate the reasoning, not a set to choose from/);
});

test("previews draw from every site of the newest cycle recorded", () => {
  const step = (id: number, site: string, n: number) => ({ id, cycleId: 1, kind: "constraint" as const, nodeId: site, constraintId: "c", state: null, transitionId: null, event: null, property: "p", key: "", variables: { n }, at: 0 });
  const trace = { bytes: 0, cycles: [{ id: 1, steps: [step(1, "a", 1)] }, { id: 2, steps: [step(2, "a", 2), step(3, "a", 3), step(4, "b", 4)] }, { id: 3, steps: [] }] } as any;
  const sites = previewSites(trace);
  assert.deepEqual(Object.values(sites).map(list => list.map(item => item.n)), [[2, 3], [4]]);
});
