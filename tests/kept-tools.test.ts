import { test } from "node:test";
import assert from "node:assert/strict";
import { createSketchPanel, savedSketchPanels } from "../app/lib/sketch-panels";
import { demoValues, keptValues, type KeptToolSet } from "../app/lib/execution/kept-tools";
import { demoKey, everyItem, pinsItem } from "../app/lib/execution/manipulate";

const target = (id: string, param = "") => ({ id, name: id, site: "", path: "", param, meaning: "", measure: "return 1;", at: "" });
const set = (patch: Partial<KeptToolSet>): KeptToolSet => ({ id: "s", concern: "안겹치게", rule: "", tools: [{ kind: "brush", purpose: "칠하세요" }], targets: [target("region")], strokes: [], values: {}, analysis: null, plans: {}, ...patch });

test("tools kept with a frame are saved with it, and their values are what its code reads with m.demo", () => {
  const stroke = { id: "a", tool: "brush" as const, points: [{ x: 1, y: 2 }, { x: 3, y: 4 }], width: 30, dx: 0, dy: 0, scale: 1, rotate: 0 };
  const values = demoValues([target("region"), target("size", "node/size")], { region: { cells: [[true]] }, size: 4 });
  assert.deepEqual(values, { [demoKey("region")]: { cells: [[true]] } }, "a param target is set on the param, not read with m.demo");
  const panel = { ...createSketchPanel(), keptTools: [set({ strokes: [stroke], values })] };
  const reloaded = createSketchPanel(savedSketchPanels({ f: panel }).f);
  assert.deepEqual(reloaded.keptTools[0].strokes, [stroke]);
  assert.deepEqual(keptValues(reloaded.keptTools), values);
  assert.deepEqual(keptValues([set({ values: { a: 1, b: 1 } }), set({ id: "t", values: { b: 2 } })]), { a: 1, b: 2 }, "a later set wins");
  assert.deepEqual(createSketchPanel({ keptTools: [{ broken: true }] } as never).keptTools, [], "a set that does not parse never breaks loading the frame");
});

test("values the tools set are shown per item: a path into one index of a list is widened to the list", () => {
  const analysis = { summary: "", cycleCount: 1, sites: [{ site: "constraint:stripes/color", note: "", show: ["@retain.1", "@speed"], locate: ["@$data.positions.1", "@box"], range: null }] };
  assert.equal(pinsItem(analysis), true);
  const wide = everyItem(analysis);
  assert.deepEqual(wide.sites[0].show, ["@retain", "@speed"]);
  assert.deepEqual(wide.sites[0].locate, ["@$data.positions", "@box"]);
  assert.equal(pinsItem(wide), false);
});
