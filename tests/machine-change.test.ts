import test from "node:test";
import assert from "node:assert/strict";
import { run, sampleScene, sceneProgram } from "./fixtures/scene";
import { connectScene } from "../app/server/scene-code.server";
import { applyMachineChange, cleanMachineChange, type MachineChange } from "../app/lib/machine-change";
import { exploreProgram } from "../app/lib/explore";
import { previewFork } from "../app/lib/preview-fork";
import { readSceneValues } from "../app/lib/scene/machines";
import { findNode } from "../app/lib/scene/graph";

// A behavior the recommendation adds: the orb reacts when it reaches the right edge (it bounces), emitted by the edits.
const emit = { nodeId: "tree", find: "p.stroke(m.v(\"tree/ink\"));", replace: "p.stroke(m.v(\"tree/ink\")); if (m.state(\"orb\").elapsed > 500 && !m.store.hit) { m.store.hit = true; m.emit(\"orb\", \"hit-edge\"); }" };
const change: MachineChange = { nodeId: "orb", states: [{ id: "bounced", label: "튕김", description: "벽에 닿아 튕긴 직후", like: "moving" }, { id: "nowhere", label: "안 감", description: "", like: "idle" }],
  transitions: [
    { id: "hit-edge", from: "moving", to: "bounced", label: "벽에 닿음 → 튕기기", trigger: "event", afterMs: 1000 },
    { id: "calm", from: "bounced", to: "moving", label: "다시 이동", trigger: "after", afterMs: 400 },
    { id: "never-emitted", from: "idle", to: "idle", label: "안 보냄", trigger: "event", afterMs: 1000 },
    { id: "press", from: "idle", to: "moving", label: "이미 있음", trigger: "event", afterMs: 1000 },
    { id: "lost", from: "idle", to: "ghost", label: "없는 상태로", trigger: "after", afterMs: 400 },
  ] };

test("a machine change keeps only what the scene and the edits support: new ids, known states, event transitions the edits emit, states something reaches", () => {
  const clean = cleanMachineChange(sampleScene(), change, [emit])!;
  assert.deepEqual(clean.transitions.map(item => item.id), ["hit-edge", "calm"]);
  assert.deepEqual(clean.states.map(state => state.id), ["bounced"], "a state no transition goes to is dropped");
  assert.equal(cleanMachineChange(sampleScene(), change, []), null, "nothing emitted: only the after transition would be left, from a state nothing reaches");
  assert.equal(cleanMachineChange(sampleScene(), { ...change, nodeId: "nope" }, [emit]), null);
});

test("the change goes into the scene's machine (a new state starting with the values of the one it is like) and into the program's machines", () => {
  const scene = sampleScene(), clean = cleanMachineChange(scene, change, [emit])!;
  const machine = findNode(applyMachineChange(scene, clean), "orb")!.machine!;
  assert.deepEqual(machine.states.map(state => state.id), ["idle", "moving", "bounced"]);
  assert.deepEqual(machine.states[2].values, machine.states[1].values);
  assert.ok(machine.transitions.some(item => item.id === "hit-edge" && item.trigger === "event"));
  // An exploration frame runs it: the program's machine has it, and the emit moves the orb into the new state.
  const generated = connectScene({ title: "Tree", explanation: "", code: sceneProgram }, scene);
  const program = exploreProgram(generated.code, scene, { edits: [emit], values: [], machine: clean });
  assert.ok(!("error" in program));
  const block = readSceneValues((program as { code: string }).code)!;
  assert.deepEqual(block.machines.orb.states.map(state => state.id), ["idle", "moving", "bounced"]);
  assert.equal(block.machines.orb.states[2].params["orb/radius"], 80, "the new state starts with the values of moving");
  const sketch = run((program as { code: string }).code);
  sketch.read("rulegenJumpState('orb', 'moving'); rulegenState.orb.elapsed = 900;"); sketch.draw();
  assert.equal(sketch.read("rulegenState.orb.id"), "bounced");
});

test("a fork made without AI from a preview that adds a behavior has it in its state machine", () => {
  const scene = sampleScene(), generated = connectScene({ title: "Tree", explanation: "", code: sceneProgram }, scene);
  const machine = cleanMachineChange(scene, change, [emit]);
  const built = previewFork(scene, generated, { kind: "add-transformation", nodeId: "orb", targetId: "", title: "벽에 닿으면 튕기기", detail: "오른쪽 벽에 닿으면 튕깁니다" }, { edits: [emit], values: [], machine });
  assert.ok(!("error" in built));
  const fork = built as Exclude<typeof built, { error: string }>;
  assert.ok(findNode(fork.scene, "orb")!.machine!.transitions.some(item => item.id === "hit-edge"));
  assert.ok(readSceneValues(fork.generated.code)!.machines.orb.transitions.some(item => item.id === "calm"));
  // Without one, the machine is as it was.
  const plain = previewFork(scene, generated, { kind: "add-transformation", nodeId: "orb", targetId: "", title: "t", detail: "d" }, { edits: [emit], values: [] }) as typeof fork;
  assert.deepEqual(findNode(plain.scene, "orb")!.machine, findNode(scene, "orb")!.machine);
});
