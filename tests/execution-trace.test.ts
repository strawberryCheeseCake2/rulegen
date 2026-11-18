import { test } from "node:test";
import assert from "node:assert/strict";
import { addCycle, emptyTrace, formatValue, matchSteps, MAX_CYCLES, nextIds, pathLabel, readCycle, readPath, siteOf, variableCatalog, type ExecTrace } from "../app/lib/execution/trace";
import { checkedPlans, occurrences, packLabels, placeLabels, resolveMarks } from "../app/lib/execution/overlay";

const rawCycle = (n: number) => ({ at: n, runtime: { seed: n }, params: { "a/size": n }, steps: [
  { kind: "state", nodeId: "dot", root: "dot", key: "1", state: "idle", label: "dot #1 · Idle", index: 0, variables: { $state: "idle" } },
  { kind: "constraint", nodeId: "dot", root: "dot", key: "1", state: "idle", constraintId: "size", property: "size", label: "dot #1 · Idle · size", index: 1, variables: { $value: 10 * n, speed: 3, g: { id: 1, points: [{ x: 5, y: 6 }] }, i: 0 } },
  { kind: "constraint", nodeId: "dot", root: "dot", key: "2", state: "idle", constraintId: "size", property: "size", label: "dot #2 · Idle · size", index: 3, variables: { $value: 20 * n, speed: 5, i: 1 } },
  { kind: "transition", nodeId: "dot", root: "dot", key: "2", state: "idle", to: "big", event: "grow", transitionId: "grow", label: "dot #2 · Idle → Big", index: 4, variables: { $event: "grow" } },
] });
function traceOf(count: number): ExecTrace {
  let trace = emptyTrace();
  for (let n = 1; n <= count; n++) { const ids = nextIds(trace); trace = addCycle(trace, readCycle(rawCycle(n), ids.cycle, ids.step)!); }
  return trace;
}

test("cycles keep every step with its variables, visits counted per site, the oldest dropped past the limit", () => {
  const trace = traceOf(MAX_CYCLES + 3);
  assert.equal(trace.cycles.length, MAX_CYCLES);
  assert.equal(trace.cycles[0].id, 4);
  const steps = trace.cycles.at(-1)!.steps;
  assert.deepEqual(steps.map(step => step.visit), [1, 1, 2, 1]);
  assert.equal(siteOf(steps[1]), "constraint:dot/size");
  assert.equal(siteOf(steps[3]), "transition:dot/grow");
  const ids = trace.cycles.flatMap(cycle => cycle.steps.map(step => step.id));
  assert.equal(new Set(ids).size, ids.length, "step ids are unique");
});

test("paths read variables and fields; labels show FSM values by their names", () => {
  const step = traceOf(1).cycles[0].steps[1];
  assert.equal(readPath(step, "@g.points.0.x"), 5);
  assert.equal(readPath(step, "@$value"), 10);
  assert.equal(readPath(step, "property"), "size");
  assert.equal(readPath(step, "@nope.x"), undefined);
  assert.equal(pathLabel("@$data.position.x"), "data.position.x");
  assert.equal(pathLabel("@g.points.0.x"), "g.points[0].x");
  assert.equal(formatValue(1.23456), "1.23");
});

test("an analysis selects the steps of its sites in the newest cycles, within the visit range", () => {
  const trace = traceOf(3);
  const matches = matchSteps(trace, { summary: "", cycleCount: 2, sites: [{ site: "constraint:dot/size", note: "", show: ["@$value"], locate: [], range: { start: 2, end: 2 } }] });
  assert.deepEqual(matches.map(step => [step.cycle, step.key]), [[2, "2"], [3, "2"]]);
  const catalog = variableCatalog(trace);
  const size = catalog.find(entry => entry.site === "constraint:dot/size")!;
  assert.deepEqual(Object.keys(size.variables).sort(), ["$value", "g", "i", "speed"], "every variable seen at a site is a candidate");
});

test("overlay plans keep code that calls mark; marks get their labels from the record", () => {
  const plans = checkedPlans({ plans: [
    { site: "a", code: "mark(read => [read('@x'), 0], ['@x']);", skipReason: "", accumulate: false },
    { site: "b", code: "return 1 +", skipReason: "", accumulate: false },
    { site: "c", code: "", skipReason: "no place", accumulate: true },
    { site: "zz", code: "mark(() => [0, 0], ['@x'])", skipReason: "", accumulate: false },
  ] }, ["a", "b", "c"]);
  assert.deepEqual(Object.keys(plans).sort(), ["a", "c"]);
  assert.equal(plans.c.accumulate, false);
  const trace = traceOf(1), step = trace.cycles[0].steps[2];
  const [mark] = resolveMarks([{ x: 1, y: 2, fields: ["@speed", "@$value", "@g.points"], guides: [] }], step, [], { [siteOf(step)]: ["@speed", "@$value"] });
  assert.deepEqual(mark.labels.map(label => `${label.name}: ${label.value}`), ["speed: 5", "value: 20"], "fields not chosen to show (placing values) are not labeled");
  assert.deepEqual(occurrences(trace.cycles[0].steps, step, true).map(item => item.key), ["2", "1"]);
});

test("labels are placed beside their marks without overlapping, or packed when they cannot be", () => {
  const boxes = placeLabels([{ anchor: { x: 100, y: 100 }, width: 80, height: 20 }, { anchor: { x: 105, y: 100 }, width: 80, height: 20 }], 900, 600)!;
  assert.equal(boxes.length, 2);
  const [a, b] = boxes, apart = a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
  assert.ok(apart);
  assert.equal(placeLabels([{ anchor: { x: 10, y: 10 }, width: 2000, height: 20 }], 900, 600), null);
  assert.equal(packLabels([{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 9, y: 9 }], 900, 600).length, 3);
});
