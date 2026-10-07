import test, { after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { MAX_RESULT_STROKES, requestSchema, revisionProposalSchema, generatedSchema, type Feature, type RuleGroup, type RevisionProposal } from "../app/lib/schema";
import { clarificationSchema } from "../app/lib/schema";
import { revisionChanges, revisionSnapshot, revisionCodeGroups, revisionCodeFeatures, validateRevisionProposal } from "../app/lib/result-revisions";
import { runAI } from "../app/server/ai.server";
import { parameterKey } from "../app/lib/live-parameters";

const logDirectory = mkdtempSync(path.join(tmpdir(), "rulegen-revision-tests-"));
const previousLogDirectory = process.env.RULEGEN_AI_LOG_DIR;
process.env.RULEGEN_AI_LOG_DIR = logDirectory;
after(() => { rmSync(logDirectory, { recursive: true, force: true }); if (previousLogDirectory === undefined) delete process.env.RULEGEN_AI_LOG_DIR; else process.env.RULEGEN_AI_LOG_DIR = previousLogDirectory; });

const features: Feature[] = [{ id: "curve", label: "Curve", description: "곡선", region: { x: .1, y: .2, w: .5, h: .5 } }];
const groups: RuleGroup[] = [{ featureId: "curve", title: "Curve", subfeatures: [{ kind: "spatial", primitive: null, id: "shape", label: "Shape", selectedImplementation: "sine", implementations: [{ id: "sine", label: "Sine", description: "Amplitude controls curve height", parameters: [{ id: "amplitude", label: "Amplitude", type: "number", value: 30, min: 0, max: 200, step: 1, unit: "px" }] }] }] }];
const proposal = (): RevisionProposal => {
  const result = structuredClone({ summary: "곡선을 더 크게 만듭니다.", features, groups });
  result.groups[0].subfeatures[0].implementations[0].parameters[0].value = 70;
  return result;
};
const annotations = [{ id: "note-1", points: [{ x: .2, y: .3 }, { x: .4, y: .5 }] }];
const image = "data:image/png;base64,AAAA";

test("review reports exact widget and feature edits without mutating the current project", () => {
  const next = proposal(); next.features[0].description = "더 큰 곡선";
  validateRevisionProposal(next, features, groups);
  const changes = revisionChanges(features, groups, next);
  assert.equal(changes.length, 2);
  assert.match(changes[1].before, /Value: 30 px/);
  assert.match(changes[1].after, /Value: 70 px/);
  assert.equal(groups[0].subfeatures[0].implementations[0].parameters[0].value, 30);
  assert.equal(features[0].description, "곡선");
});
test("proposals reject orphaned and duplicate groups, invalid widgets and relocated source features", () => {
  const variants = [
    (p: RevisionProposal) => { p.groups[0].featureId = "missing"; },
    (p: RevisionProposal) => { p.groups.push(structuredClone(p.groups[0])); },
    (p: RevisionProposal) => { p.features.push(structuredClone(p.features[0])); },
    (p: RevisionProposal) => { p.groups[0].subfeatures[0].selectedImplementation = "missing"; },
    (p: RevisionProposal) => { p.groups[0].subfeatures[0].implementations[0].parameters[0].value = 999; },
    (p: RevisionProposal) => { p.features[0].region.x = .3; },
  ];
  for (const mutate of variants) { const p = proposal(); mutate(p); assert.throws(() => validateRevisionProposal(p, features, groups)); }
  assert.throws(() => validateRevisionProposal({ summary: "No change", features, groups }, features, groups));
});
test("review includes added and removed controls, and excludes untouched rules from regeneration", () => {
  const next = proposal();
  next.groups[0].subfeatures[0].implementations[0].parameters.push({ id: "color", label: "Color", type: "color", value: "#3355bb" });
  assert.ok(revisionChanges(features, groups, next).some(c => c.kind === "add"));
  const removed = proposal(); removed.groups[0].subfeatures[0].implementations[0].parameters = [];
  assert.ok(revisionChanges(features, groups, removed).some(c => c.kind === "remove"));
  const extraFeature = { ...features[0], id: "texture", label: "Texture" };
  const extraGroup = { ...structuredClone(groups[0]), featureId: "texture" };
  next.features.push(structuredClone(extraFeature)); next.groups.push(structuredClone(extraGroup));
  assert.equal(revisionCodeGroups(next, [...features, extraFeature], [...groups, extraGroup], ["curve"]).length, 1);
  next.groups[1].title = "Changed texture";
  assert.equal(revisionCodeGroups(next, [...features, extraFeature], [...groups, extraGroup], ["curve"]).length, 2);
});
test("suggestions can add a visual feature and new rules while preserving existing items and connecting the additions", () => {
  const next: RevisionProposal = structuredClone({ summary: "새 잎 특징과 반복 규칙을 추가합니다.", features, groups });
  next.features.push({ id: "leaves", label: "Leaves", description: "새 잎 모티프", region: { x: .2, y: .3, w: .4, h: .4 } });
  next.groups.push({ ...structuredClone(groups[0]), featureId: "leaves", title: "Leaf repetition" });
  validateRevisionProposal(next, features, groups);
  const changes = revisionChanges(features, groups, next);
  assert.ok(changes.length > 0);
  assert.ok(changes.every(c => c.kind === "add"));
  assert.deepEqual(next.groups[0], groups[0]);
  assert.deepEqual(next.features[0], features[0]);
  const scope = revisionCodeGroups(next, features, groups, ["curve"]);
  assert.deepEqual(scope.map(g => g.featureId), ["curve", "leaves"]);
});
test("new visual features reach rendering even when no new rule group is proposed", () => {
  const next: RevisionProposal = structuredClone({ summary: "새 특징을 추가합니다.", features, groups });
  next.features.push({ id: "accent", label: "Accent", description: "작은 점 추가", region: { x: .3, y: .3, w: .1, h: .1 } });
  validateRevisionProposal(next, features, groups);
  const scope = revisionCodeGroups(next, features, groups, ["curve"]);
  assert.deepEqual(revisionCodeFeatures(next, features, scope).map(f => f.id), ["curve", "accent"]);
});
test("annotations are bounded, old requests remain valid, and feedback edits invalidate a review snapshot", () => {
  assert.ok(requestSchema.safeParse({ intent: "code", features, groups }).success);
  assert.ok(requestSchema.safeParse({ intent: "revision", features, groups, image, previous: "code", annotations, instruction: "곡선을 더 크게" }).success);
  assert.ok(requestSchema.safeParse({ intent: "revision", annotations: Array(20).fill(annotations[0]) }).success);
  assert.equal(requestSchema.safeParse({ intent: "revision", annotations: Array(MAX_RESULT_STROKES + 1).fill(annotations[0]) }).success, false);
  assert.equal(requestSchema.safeParse({ intent: "revision", annotations: [{ ...annotations[0], points: [{ x: 2, y: 0 }, { x: 0, y: 0 }] }] }).success, false);
  const snapshot = revisionSnapshot(features, groups, "code", annotations, "", image);
  assert.notEqual(snapshot, revisionSnapshot(features, groups, "code", annotations, "다르게", image));
  assert.notEqual(snapshot, revisionSnapshot(features, groups, "edited code", annotations, "", image));
});
test("AI clarification interprets before and after images without user text and accepts an editable draft on regeneration", async () => {
  const savedFetch = globalThis.fetch, savedKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-only";
  const calls: Record<string, any>[] = [];
  let output = "곡선을 위로 크게 휘게 하고 오른쪽에는 작은 잎 모티프를 추가해주세요.";
  globalThis.fetch = async (_url, options) => {
    calls.push(JSON.parse(options!.body as string));
    return Response.json({ output: [{ content: [{ type: "output_text", text: JSON.stringify({ clarification: output }) }] }] });
  };
  const input = { intent: "clarification", image, resultImage: image, annotations, features, groups, previous: "current rendering code" };
  try {
    const original = JSON.stringify({ features, groups });
    const result = clarificationSchema.parse(await runAI(requestSchema.parse(input), new AbortController().signal));
    assert.equal(result.clarification, output);
    assert.equal(calls[0].text.format.name, "rulegen_clarification");
    const context = JSON.parse(calls[0].input[0].content[0].text);
    assert.equal(context.instruction, ""); assert.deepEqual(context.annotations, annotations);
    assert.equal(calls[0].input[0].content.filter((c: any) => c.type === "input_image").length, 2);
    assert.match(calls[0].instructions, /editable Korean/);
    assert.equal(JSON.stringify({ features, groups }), original);
    await runAI(requestSchema.parse({ ...input, instruction: "잎 대신 작은 점을 추가해줘" }), new AbortController().signal);
    assert.equal(JSON.parse(calls[1].input[0].content[0].text).instruction, "잎 대신 작은 점을 추가해줘");
    const count = calls.length;
    await assert.rejects(() => runAI(requestSchema.parse({ ...input, annotations: [] }), new AbortController().signal));
    await assert.rejects(() => runAI(requestSchema.parse({ ...input, resultImage: undefined }), new AbortController().signal));
    assert.equal(calls.length, count);
    output = " ";
    await assert.rejects(() => runAI(requestSchema.parse(input), new AbortController().signal));
  } finally { globalThis.fetch = savedFetch; if (savedKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = savedKey; }
});
test("revision API sends annotated result context and returns a validated proposal; confirm code retains live bindings", async () => {
  const savedFetch = globalThis.fetch, savedKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-only";
  const calls: Record<string, any>[] = [];
  const key = parameterKey("curve", "shape", "sine", "amplitude");
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options!.body as string); calls.push(body);
    const output = body.text.format.name === "rulegen_revision" ? proposal() : { title: "Curve", explanation: "큰 곡선", code: `p.setup=()=>{p.createCanvas(900,600);p.background(255);p.line(0,0,100,rulegenParams[${JSON.stringify(key)}]);p.noLoop();}` };
    return Response.json({ output: [{ content: [{ type: "output_text", text: JSON.stringify(output) }] }] });
  };
  try {
    const result = revisionProposalSchema.parse(await runAI(requestSchema.parse({ intent: "revision", image, annotations, features, groups, previous: "code", instruction: "곡선을 더 크게" }), new AbortController().signal));
    assert.equal(result.groups[0].subfeatures[0].implementations[0].parameters[0].value, 70);
    const context = JSON.parse(calls[0].input[0].content[0].text);
    assert.deepEqual(context.annotations, annotations);
    assert.equal(context.instruction, "곡선을 더 크게");
    assert.match(calls[0].instructions, /ADD new visual features/);
    assert.equal(calls[0].input[0].content[1].image_url, image);
    assert.match(calls[0].instructions, /GENERATED RESULT/);
    const code = generatedSchema.parse(await runAI(requestSchema.parse({ intent: "code", features: result.features, groups: result.groups, image, annotations, revisionSummary: result.summary, instruction: "곡선을 더 크게" }), new AbortController().signal));
    assert.equal(code.bindings.length, 1);
    assert.match(code.code, /70/);
    assert.equal(JSON.parse(calls[1].input[0].content[0].text).confirmedRevisionSummary, result.summary);
    await assert.rejects(() => runAI(requestSchema.parse({ intent: "revision", features, groups, image, previous: "code", annotations, instruction: " " }), new AbortController().signal));
  } finally { globalThis.fetch = savedFetch; if (savedKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = savedKey; }
});
