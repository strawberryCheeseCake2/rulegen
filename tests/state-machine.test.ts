import test, { after } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StateMachinePanel } from "../app/components/state-machine-panel";
import { createInteractionPen, compositionContext } from "../app/lib/algorithm-pens";
import { sceneMachine, sceneAlgorithm } from "./fixtures/state-machine";
import { stateMachineSchema, generatedSchema, requestSchema } from "../app/lib/schema";
import { syncStateMachine, generatedSource } from "../app/lib/state-machine";
import { updateParameter } from "../app/lib/subfeatures";
import { createSketchPanel, savedSketchPanels } from "../app/lib/sketch-panels";
import { projectSchema } from "../app/lib/project";
import { connectStateMachine } from "../app/server/state-code.server";
import { prepareCode } from "../app/server/code.server";
import { runAI } from "../app/server/ai.server";

const logDirectory = mkdtempSync(path.join(tmpdir(), "rulegen-state-tests-"));
const oldLogDirectory = process.env.RULEGEN_AI_LOG_DIR;
process.env.RULEGEN_AI_LOG_DIR = logDirectory;
after(() => { rmSync(logDirectory, { recursive: true, force: true }); if (oldLogDirectory === undefined) delete process.env.RULEGEN_AI_LOG_DIR; else process.env.RULEGEN_AI_LOG_DIR = oldLogDirectory; });

function render(source: string) {
  const calls: unknown[][] = [];
  const p = { setup() {}, draw() {}, deltaTime: 100, createCanvas() {}, background() {}, stroke() {}, fill() {}, noFill() {}, circle: (...args: number[]) => calls.push(args) };
  const context = vm.createContext({ p, __rulegenGuard() {} });
  vm.runInContext(prepareCode(source), context);
  p.setup();
  return { p, context, calls, read: (expression: string) => vm.runInContext(expression, context) };
}

test("state models reject orphan transitions, invalid initial states, duplicate IDs and invalid state constraints", () => {
  for (const change of [
    (m: ReturnType<typeof sceneMachine>) => { m.initialState = "unknown"; },
    (m: ReturnType<typeof sceneMachine>) => { m.transitions[0].to = "unknown"; },
    (m: ReturnType<typeof sceneMachine>) => { m.states[1].id = "idle"; },
    (m: ReturnType<typeof sceneMachine>) => { m.states[0].groups[0].featureId = "unknown"; },
    (m: ReturnType<typeof sceneMachine>) => { m.states[0].groups[0].subfeatures[0].implementations[0].parameters[0].value = 999; },
  ]) { const machine = sceneMachine(); change(machine); assert.equal(stateMachineSchema.safeParse(machine).success, false); }
});

test("fine-grained machines retain all 32 states, 128 semantic transitions and pending edits across project restoration", () => {
  const seed = sceneMachine().states[0];
  const states = Array.from({ length: 32 }, (_, i) => ({ ...structuredClone(seed), id: `phase-${i}`, label: `Phase ${i}` }));
  const transitions = Array.from({ length: 128 }, (_, i) => ({ id: `step-${i}`, from: states[i % 32].id, to: states[(i + 1) % 32].id, label: `동작 ${i} 완료 후 다음 단계 진입`, trigger: "event", afterMs: 1000 }));
  const machine = stateMachineSchema.parse({ initialState: states[0].id, states, transitions });
  const generated = generatedSchema.parse({ title: "Detailed", explanation: "", code: connectStateMachine(sceneAlgorithm, machine), stateMachine: machine });
  const artwork = { strokes: [], photo: null, name: "Detailed", revision: 0 };
  const project = projectSchema.parse({ version: 1, name: "Detailed", artwork, features: [], groups: [], analysisRevision: -1, generated, brush: null, savedBrushes: [], sketchPanels: { source: { generated, selectedStateId: "phase-31", dirtyStateIds: states.map(s => s.id) } } });
  const restored = projectSchema.parse(JSON.parse(JSON.stringify(project)));
  assert.deepEqual(restored.sketchPanels.source.generated?.stateMachine, machine);
  assert.equal(restored.sketchPanels.source.dirtyStateIds.length, 32);
  const scene = render(restored.generated!.code);
  scene.read("rulegenJumpState('phase-31');p.draw()");
  assert.equal(scene.read("rulegenState.id"), "phase-31");
  assert.equal(stateMachineSchema.safeParse({ ...machine, states: [...states, { ...seed, id: "extra" }] }).success, false);
  assert.equal(stateMachineSchema.safeParse({ ...machine, transitions: [...transitions, { ...transitions[0], id: "extra" }] }).success, false);
  assert.equal(stateMachineSchema.safeParse({ ...machine, transitions: [{ ...transitions[0], label: "   " }] }).success, false);
  assert.equal(stateMachineSchema.safeParse({ initialState: seed.id, states: [seed], transitions: [] }).success, true);
});

test("state graphs show semantic transition labels and offer refinement of an existing machine", () => {
  const machine = sceneMachine();
  machine.transitions[0].label = "원 위에서 누르면 이동 시작";
  const html = renderToStaticMarkup(createElement(StateMachinePanel, { machine, hasCode: true, selectedId: "idle", runtimeId: "idle", playing: true, busy: false, dirty: false,
    onGenerate() {}, onJump() {}, onPlay() {}, onRestart() {}, onEvent() {}, onState() {}, onFeature() {}, onMethod() {}, onParameter() {}, onTransition() {}, onApply() {} }));
  assert.match(html, /<text[^>]*>원 위에서 누르면 이동 시작<\/text>/);
  assert.match(html, /aria-label="Semantic state transitions"/);
  assert.match(html, /aria-label="Generate detailed state machine"/);
});

test("actual input callbacks emit a semantic transition only when the source state and hit target match", () => {
  const algorithm = sceneAlgorithm + `\np.mousePressed=()=>{if(rulegenState.id==='idle'&&(p.mouseX-250)**2+(p.mouseY-300)**2<24**2)rulegenEmit('start');};`;
  const scene = render(connectStateMachine(algorithm, sceneMachine()));
  scene.read("p.mouseX=50;p.mouseY=50;p.mousePressed()");
  assert.equal(scene.read("rulegenState.id"), "idle");
  scene.read("p.mouseX=250;p.mouseY=300;p.mousePressed()");
  assert.equal(scene.read("rulegenState.id"), "moving");
  scene.read("p.mousePressed()");
  assert.equal(scene.read("rulegenState.id"), "moving");
});

test("jumps reset state time, apply independent constraint values, and timed/event transitions obey pause and source state", () => {
  const scene = render(connectStateMachine(sceneAlgorithm, sceneMachine()));
  scene.p.draw(); assert.equal(scene.calls[0][2], 48);
  assert.equal(scene.read("rulegenEmit('finish')"), false);
  assert.equal(scene.read("rulegenEmit('start')"), true);
  assert.equal(scene.read("rulegenState.id"), "moving");
  scene.p.draw(); assert.equal(scene.calls[1][2], 160);
  scene.read("rulegenState.playing=false");
  for (let i = 0; i < 20; i++) scene.p.draw();
  assert.equal(scene.read("rulegenState.id"), "moving");
  assert.equal(scene.read("rulegenState.elapsed"), 100);
  scene.read("rulegenState.playing=true");
  for (let i = 0; i < 11; i++) scene.p.draw();
  assert.equal(scene.read("rulegenState.id"), "settled");
  assert.equal(scene.read("rulegenState.elapsed"), 0);
  assert.equal(scene.read("rulegenEmit('start')"), false);
  scene.read("rulegenJumpState('moving')"); assert.equal(scene.read("rulegenState.elapsed"), 0);
  assert.equal(scene.read("rulegenJumpState('unknown')"), false);
});

test("editing a state's widgets updates actual drawing without affecting another state, algorithms or code safety", () => {
  const machine = sceneMachine();
  const source = connectStateMachine(sceneAlgorithm, machine);
  machine.states[1].groups = updateParameter(machine.states[1].groups, "orb", "motion", "linear", "radius", 110);
  const edited = syncStateMachine(source, machine);
  assert.ok(edited.includes(sceneAlgorithm));
  const scene = render(edited);
  scene.p.draw(); assert.equal(scene.calls[0][2], 48);
  scene.read("rulegenJumpState('moving')"); scene.p.draw(); assert.equal(scene.calls[1][2], 220);
  scene.read("rulegenJumpState('settled')"); scene.p.draw(); assert.equal(scene.calls[2][2], 90);
  machine.states[0].features[0].description = '</script><script>throw new Error("injected")</script>';
  assert.doesNotThrow(() => prepareCode(syncStateMachine(edited, machine)));
  const changed = structuredClone(machine.states[1].groups[0].subfeatures[0].implementations[0]);
  changed.id = "alternate";
  machine.states[1].groups[0].subfeatures[0].implementations.push(changed);
  machine.states[1].groups[0].subfeatures[0].selectedImplementation = "alternate";
  assert.doesNotThrow(() => render(syncStateMachine(edited, machine)).read("rulegenJumpState('moving');p.draw()"));
});

test("state code contract rejects missing live widgets, shadowed runtime, direct writes and stopped drawing", () => {
  for (const source of [
    sceneAlgorithm.replace('rulegenState.params["orb/motion/linear/radius"]', "24"),
    sceneAlgorithm + "\nconst rulegenState={};",
    sceneAlgorithm + "\nrulegenState.id='moving';",
    sceneAlgorithm + "\nrulegenState.params['orb/motion/linear/radius']=1;",
    sceneAlgorithm + "\np.noLoop();",
  ]) assert.throws(() => connectStateMachine(source, sceneMachine()));
});

test("projects preserve per-frame state constraints, selected state and pending edits while restoring legacy scenes", () => {
  const machine = sceneMachine(), generated = generatedSchema.parse({ title: "Motion", explanation: "", code: connectStateMachine(sceneAlgorithm, machine), stateMachine: machine });
  const panel = createSketchPanel(); panel.generated = generated; panel.selectedStateId = "moving"; panel.machinePlaying = false; panel.dirtyStateIds = ["moving"];
  const artwork = { strokes: [], photo: null, name: "Scene", revision: 0 };
  const saved = projectSchema.parse({ version: 1, name: "States", artwork, features: [], groups: [], analysisRevision: -1, generated: null, brush: null, savedBrushes: [], sketchFrames: [{ id: "sketch-b", artwork }], sketchPanels: savedSketchPanels({ source: panel, "sketch-b": createSketchPanel() }) });
  const restored = projectSchema.parse(JSON.parse(JSON.stringify(saved)));
  assert.equal(restored.sketchPanels.source.selectedStateId, "moving");
  assert.equal(restored.sketchPanels.source.machinePlaying, false);
  assert.deepEqual(restored.sketchPanels.source.dirtyStateIds, ["moving"]);
  assert.equal(restored.sketchPanels["sketch-b"].generated, null);
  assert.deepEqual(restored.sketchPanels.source.generated?.stateMachine, machine);
  assert.equal(generatedSchema.parse({ title: "Old", explanation: "", code: "old source" }).stateMachine, null);
  assert.equal(generatedSource(generated, []), generated.code);
});

test("Compose generates an AI state plan from semantic marks, then binds every state's widgets to the scene; edits reuse the exact plan", async () => {
  const savedFetch = globalThis.fetch, savedKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-only";
  const machine = sceneMachine(), calls: any[] = [];
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options!.body as string); calls.push(body);
    const output = body.text.format.name === "rulegen_state-machine" ? machine : { title: "Motion", explanation: "Moving orb", code: sceneAlgorithm };
    return Response.json({ output: [{ content: [{ type: "output_text", text: JSON.stringify(output) }] }] });
  };
  try {
    const pen = { id: "motion-pen", name: "Motion", color: "#397461", sourceSketchId: "source", feature: machine.states[0].features[0], subfeatureId: "motion", subfeatureLabel: "Motion", implementation: machine.states[0].groups[0].subfeatures[0].implementations[0], meaning: "Move right" };
    const stroke = { id: "motion-path", tool: "semantic", color: "#397461", width: 3, opacity: 1, points: [{ x: .1, y: .2 }, { x: .8, y: .2 }], semanticPenId: pen.id };
    const result = generatedSchema.parse(await runAI(requestSchema.parse({ intent: "compose", withStateMachine: true, image: "data:image/png;base64,AAAA", instruction: "Move then settle", compositionPens: [pen], compositionStrokes: [stroke] }), new AbortController().signal));
    assert.equal(calls.length, 2);
    assert.equal(calls[0].text.format.name, "rulegen_state-machine");
    assert.match(calls[0].instructions, /FINE-GRAINED STATE PLANNING/);
    assert.match(calls[0].instructions, /SEMANTIC TRANSITION LABELS/);
    assert.doesNotMatch(calls[0].instructions, /2.?6 meaningful/);
    assert.equal(calls[0].text.format.schema.properties.states.maxItems, 32);
    assert.equal(calls[0].max_output_tokens, 32000);
    assert.ok(calls[0].input[0].content.some((part: any) => part.text?.includes('"motion-path"')));
    assert.deepEqual(result.stateMachine, machine);
    assert.match(calls[1].instructions, /STATE MACHINE CONTRACT/);
    assert.ok(calls[1].input[0].content.some((part: any) => part.text?.includes('"parameterBindings"')));
    assert.doesNotThrow(() => prepareCode(result.code));
    const edited = structuredClone(machine); edited.states[1].features[0].description = "Bigger motion";
    const applied = generatedSchema.parse(await runAI(requestSchema.parse({ intent: "code", stateMachine: edited, previous: result.code, instruction: "Apply constraints" }), new AbortController().signal));
    assert.equal(calls.length, 3);
    assert.equal(calls[2].text.format.name, "rulegen_code");
    assert.deepEqual(applied.stateMachine, edited);
  } finally { globalThis.fetch = savedFetch; if (savedKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = savedKey; }
});

test("interaction pen annotations reach AI prompt drafting, state planning and generated event code, including constraint edits", async () => {
  const savedFetch = globalThis.fetch, savedKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-only";
  const machine = sceneMachine(), calls: any[] = [];
  const algorithm = sceneAlgorithm + "\np.mousePressed=()=>{if(rulegenState.id==='idle')rulegenEmit('start');};";
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options!.body as string); calls.push(body);
    const output = body.text.format.name === "rulegen_compose-prompt" ? { prompt: "원을 누르면 오른쪽으로 움직이고 정착해줘" } : body.text.format.name === "rulegen_state-machine" ? machine : { title: "Interaction", explanation: "입력에 반응", code: algorithm };
    return Response.json({ output: [{ content: [{ type: "output_text", text: JSON.stringify(output) }] }] });
  };
  try {
    const pen = createInteractionPen();
    const context = compositionContext({ name: "Interaction sketch", photo: null, revision: 1, strokes: [{ tool: "pen", color: pen.color, width: 3, opacity: 1, points: [{ x: 250, y: 300 }, { x: 450, y: 300 }], semanticPen: pen }] });
    const input = { image: "data:image/png;base64,AAAA", ...context };
    const prompt = await runAI(requestSchema.parse({ intent: "compose-prompt", ...input }), new AbortController().signal) as { prompt: string };
    const result = generatedSchema.parse(await runAI(requestSchema.parse({ intent: "compose", withStateMachine: true, instruction: prompt.prompt, ...input }), new AbortController().signal));
    await runAI(requestSchema.parse({ intent: "code", stateMachine: result.stateMachine, previous: result.code, instruction: "Apply edited constraints", ...input }), new AbortController().signal);
    assert.equal(calls.length, 4);
    assert.deepEqual(calls.map(body => body.text.format.name), ["rulegen_compose-prompt", "rulegen_state-machine", "rulegen_compose", "rulegen_code"]);
    for (const body of calls) {
      assert.match(body.instructions, /INTERACTION ANNOTATION CONTRACT/);
      assert.match(body.instructions, /actual p5 input callbacks/);
      const contextPart = body.input[0].content.find((part: any) => part.text && JSON.parse(part.text).compositionPens);
      const sent = JSON.parse(contextPart.text);
      assert.equal(sent.compositionPens[0].kind, "interaction");
      assert.equal(sent.compositionStrokes[0].tool, "interaction");
      assert.equal(sent.compositionStrokes[0].points[0].x, 250 / 900);
      assert.ok(body.input[0].content.some((part: any) => part.image_url === input.image));
    }
    const scene = render(result.code);
    scene.read("p.mousePressed()");
    assert.equal(scene.read("rulegenState.id"), "moving");
  } finally { globalThis.fetch = savedFetch; if (savedKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = savedKey; }
});
