import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { analysisSchema, rulesSchema, requestSchema, activeWidgetKindSchema, type RuleGroup } from "../app/lib/schema";
import { activeGroups, savedGroupSchema, updateParameter, validateGroups } from "../app/lib/subfeatures";
import { projectSchema } from "../app/lib/project";
const wave: RuleGroup = { featureId: "wave", title: "Wave", subfeatures: [{ id: "curve", label: "Curvy shape", selectedImplementation: "sine", implementations: [
  { id: "sine", label: "Sine", description: "y=amplitude*sin(x*frequency)", parameters: [{ id: "amplitude", label: "Amplitude", type: "number", value: 40, min: 0, max: 100, step: 5, unit: "px" }, { id: "color", label: "Color", type: "color", value: "#397461" }, { id: "decay", label: "Decay", type: "toggle", value: false }, { id: "direction", label: "Direction", type: "select", value: "Horizontal", options: ["Horizontal", "Vertical"] }] },
  { id: "bezier", label: "Bezier", description: "Control point curvature", parameters: [{ id: "bend", label: "Bend", type: "number", value: .5, min: 0, max: 1, step: .1, unit: "" }] },
] }] };
test("feature analysis accepts 2 through 6, rejects padded or undersized results", () => {
  const feature = { id: "f", label: "Curve", description: "", region: { x: .1, y: .1, w: .2, h: .2 } };
  for (let count = 1; count <= 7; count++) assert.equal(analysisSchema.safeParse({ features: Array.from({ length: count }, (_, i) => ({ ...feature, id: String(i) })) }).success, count >= 2 && count <= 6);
});
test("widget edits respect step and bounds without mutating other methods", () => {
  const edited = updateParameter([wave], "wave", "curve", "sine", "amplitude", 73);
  assert.equal(edited[0].subfeatures[0].implementations[0].parameters[0].value, 75);
  assert.equal(wave.subfeatures[0].implementations[0].parameters[0].value, 40);
  assert.equal(updateParameter(edited, "wave", "curve", "sine", "amplitude", 900)[0].subfeatures[0].implementations[0].parameters[0].value, 100);
  assert.deepEqual(edited[0].subfeatures[0].implementations[1], wave.subfeatures[0].implementations[1]);
});
test("code and brush requests contain selected methods and exact widget values", () => {
  let groups = updateParameter([wave], "wave", "curve", "sine", "color", "#1122ff");
  groups = updateParameter(groups, "wave", "curve", "sine", "decay", true);
  groups = updateParameter(groups, "wave", "curve", "sine", "direction", "Vertical");
  const request = requestSchema.parse({ intent: "code", groups: activeGroups(groups) });
  assert.equal(request.groups[0].subfeatures[0].implementations.length, 1);
  assert.deepEqual(request.groups[0].subfeatures[0].implementations[0].parameters.map(p => p.value), [40, "#1122ff", true, "Vertical"]);
  groups[0].subfeatures[0].selectedImplementation = "bezier";
  assert.equal(activeGroups(groups)[0].subfeatures[0].implementations[0].parameters[0].value, .5);
});
test("invalid selected methods, slider ranges and choice values are rejected", () => {
  for (const mutate of [(g: RuleGroup) => { g.subfeatures[0].selectedImplementation = "missing"; }, (g: RuleGroup) => { const p = g.subfeatures[0].implementations[0].parameters[0]; if (p.type === "number") p.min = p.max; }, (g: RuleGroup) => { const p = g.subfeatures[0].implementations[0].parameters[3]; if (p.type === "select") p.value = "missing"; }]) { const bad = structuredClone(wave); mutate(bad); assert.throws(() => validateGroups([bad])); assert.equal(savedGroupSchema.safeParse(bad).success, false); }
});
test("legacy prose is preserved on migration and parameter widgets survive saving", () => {
  const legacy = savedGroupSchema.parse({ featureId: "wave", title: "Wave", rules: [{ label: "Curve", text: "Use sine with amplitude 40" }] });
  assert.equal(legacy.subfeatures[0].implementations[0].description, "Use sine with amplitude 40");
  const saved = projectSchema.parse({ version: 1, name: "Wave", artwork: { strokes: [], photo: null, name: "Wave", revision: 1 }, features: [], groups: [wave], analysisRevision: 1, generated: null, brush: null, savedBrushes: [] });
  assert.deepEqual(projectSchema.parse(JSON.parse(JSON.stringify(saved))).groups, [wave]);
});
test("legacy widget types and the three active extraction types are distinct without optional properties", () => {
  assert.deepEqual(activeWidgetKindSchema.options, ["spatial", "stylistic", "object"]);
  const json = JSON.stringify(z.toJSONSchema(rulesSchema, { target: "draft-7" }));
  for (const type of ["number", "color", "select", "toggle"]) assert.ok(json.includes(`"const":"${type}"`));
  assert.ok(json.includes("anyOf")); assert.equal(json.includes("oneOf"), false);
  assert.doesNotThrow(() => rulesSchema.parse({ groups: [wave] }));
});
