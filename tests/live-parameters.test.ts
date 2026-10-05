import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import type { RuleGroup } from "../app/lib/schema";
import { getBindings, parameterKey, syncParameters, liveStatus, detachControls } from "../app/lib/live-parameters";
import { connectParameters } from "../app/server/live-code.server";
import { prepareCode } from "../app/server/code.server";
import { replaceSubfeature, updateParameter, removeControl } from "../app/lib/subfeatures";
import { projectSchema } from "../app/lib/project";
const groups: RuleGroup[] = [{ featureId: "wave", title: "Wave", subfeatures: [{ id: "shape", label: "Wave path", selectedImplementation: "sine", implementations: [{ id: "sine", label: "Sine", description: "", parameters: [{ type: "number", id: "amplitude", label: "Amplitude", min: 0, max: 200, step: 1, unit: "px", value: 28 }, { type: "color", id: "color", label: "Color", value: "#397461" }, { type: "toggle", id: "filled", label: "Fill", value: false }, { type: "select", id: "orientation", label: "Orientation", value: "Horizontal", options: ["Horizontal", "Vertical"] }] }] }, { id: "decay", label: "Decay", selectedImplementation: "linear", implementations: [{ id: "linear", label: "Linear", description: "", parameters: [{ type: "number", id: "rate", label: "Rate", min: 0, max: 1, step: .1, value: .5, unit: "" }] }] }] }];
const key = (id: string) => JSON.stringify(parameterKey("wave", "shape", "sine", id));
const source = `p.setup=()=>{p.createCanvas(900,600);p.noLoop();p.line(0,0,10,rulegenParams[${key("amplitude")}]);p.stroke(rulegenParams[${key("color")}]);if(rulegenParams[${key("filled")}])p.fill(1);if(rulegenParams[${key("orientation")}] === 'Vertical')p.rotate(1);p.line(0,0,rulegenParams['wave/decay/linear/rate'],1)}`;
const connected = () => connectParameters({ title: "Wave", explanation: "", code: source }, groups);
test("widget edits update compiled code and actual drawing calls without another LLM call", () => {
  const generated = connected(); let edited = updateParameter(groups, "wave", "shape", "sine", "amplitude", 80);
  edited = updateParameter(edited, "wave", "shape", "sine", "color", "#1122ff"); edited = updateParameter(edited, "wave", "shape", "sine", "filled", true); edited = updateParameter(edited, "wave", "shape", "sine", "orientation", "Vertical");
  const executable = syncParameters(prepareCode(generated.code), edited, generated.bindings);
  const calls: unknown[][] = []; const p = { setup() {}, createCanvas() {}, noLoop() {}, line: (...args: number[]) => calls.push(args), stroke: (c: string) => calls.push([c]), fill: (n: number) => calls.push(["fill", n]), rotate: (n: number) => calls.push(["rotate", n]) };
  vm.runInNewContext(executable, { p, __rulegenGuard() {} }); p.setup();
  assert.deepEqual(calls, [[0, 0, 10, 80], ["#1122ff"], ["fill", 1], ["rotate", 1], [0, 0, .5, 1]]);
  assert.ok(syncParameters(generated.code, edited, generated.bindings).includes('"wave/shape/sine/amplitude": 80'));
});
test("live updates preserve algorithm edits, unrelated bindings and inactive method values", () => {
  const g = connected(), edited = updateParameter(groups, "wave", "shape", "sine", "amplitude", 45);
  const manual = g.code.replace("p.line(0,0,10,", "p.line(0,0,20,");
  assert.ok(syncParameters(manual, edited, g.bindings).includes("p.line(0,0,20,"));
  assert.ok(syncParameters(manual, edited, g.bindings).includes('"wave/decay/linear/rate": 0.5'));
  assert.equal(liveStatus(g.code, edited, g.bindings), "live");
  const switched = structuredClone(edited); switched[0].subfeatures[0].selectedImplementation = "bezier";
  assert.equal(liveStatus(g.code, switched, g.bindings), "changed");
  assert.ok(syncParameters(g.code, switched, g.bindings).includes('"wave/shape/sine/amplitude": 28'));
});
test("parameter identities cannot collide and string values cannot become JavaScript", () => {
  assert.notEqual(parameterKey("a/b", "c"), parameterKey("a", "b/c"));
  const malicious = structuredClone(groups); const p = malicious[0].subfeatures[0].implementations[0].parameters[3];
  if (p.type === "select") { p.value = '";throw new Error("injected");//'; p.options.push(p.value); }
  assert.doesNotThrow(() => prepareCode(syncParameters(connected().code, malicious, getBindings(groups))));
});
test("server rejects missing bindings, unknown keys, redeclarations and parameter writes", () => {
  assert.throws(() => connectParameters({ title: "", explanation: "", code: "p.setup=()=>p.createCanvas(900,600)" }, groups), /연결/);
  for (const extra of ["const rulegenParams={}", "rulegenParams['unknown']=1", `rulegenParams[${key("amplitude")}]=1`]) assert.throws(() => connectParameters({ title: "", explanation: "", code: source + ";" + extra }, groups));
});
test("regenerating one card preserves every other subfeature and its edited widget values", () => {
  const replacement = structuredClone(groups[0].subfeatures[0]); replacement.label = "Alternate wave";
  replacement.implementations[0].parameters[0].value = 60;
  const result = replaceSubfeature(groups, "wave", "shape", replacement);
  assert.equal(result[0].subfeatures[0].label, "Alternate wave");
  assert.equal(result[0].subfeatures[1], groups[0].subfeatures[1]);
  assert.equal(groups[0].subfeatures[0].label, "Wave path");
  assert.throws(() => replaceSubfeature(groups, "wave", "shape", { ...replacement, id: "other" }));
});
test("deleting controls freezes their edited values while other controls remain live and saveable", () => {
  const before = updateParameter(groups, "wave", "shape", "sine", "amplitude", 80);
  const after = removeControl(before, "wave", "shape", "sine", "amplitude");
  const detached = detachControls(connected(), before, after);
  assert.equal(detached.bindings.some(b => b.parameterId === "amplitude"), false);
  assert.equal(liveStatus(detached.code, after, detached.bindings), "live");
  assert.equal(after[0].subfeatures[1], before[0].subfeatures[1]);
  const edited = updateParameter(after, "wave", "decay", "linear", "rate", .9);
  const calls: unknown[][] = []; const p = { setup() {}, createCanvas() {}, noLoop() {}, line: (...args: number[]) => calls.push(args), stroke() {}, fill() {}, rotate() {} };
  vm.runInNewContext(prepareCode(syncParameters(detached.code, edited, detached.bindings)), { p, __rulegenGuard() {} }); p.setup();
  assert.deepEqual(calls, [[0, 0, 10, 80], [0, 0, .9, 1]]);
  const onlyDecay = removeControl(edited, "wave", "shape");
  assert.equal(onlyDecay[0].subfeatures.length, 1);
  const empty = removeControl(onlyDecay, "wave", "decay");
  assert.deepEqual(empty, []);
  const saved = projectSchema.parse({ version: 1, name: "Wave", artwork: { strokes: [], photo: null, name: "Wave", revision: 1 }, features: [], groups: after, analysisRevision: 1, generated: detached, brush: null, savedBrushes: [] });
  assert.equal(saved.groups[0].subfeatures[0].implementations[0].parameters.some(p => p.id === "amplitude"), false);
  assert.doesNotThrow(() => prepareCode(detachControls(detached, after, empty).code));
});
