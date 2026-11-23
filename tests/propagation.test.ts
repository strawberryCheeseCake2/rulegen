import { test } from "node:test";
import assert from "node:assert/strict";
import { mergePart, partChanges, propagationBase } from "../app/lib/scene/propagation";
import type { Scene } from "../app/lib/scene/schema";

const param = (id: string, value: number) => ({ id, label: id, effect: "size", description: "", value: { type: "number" as const, value, min: 0, max: 100, step: 1, unit: "px" } });
const constraint = (id: string, params: ReturnType<typeof param>[], description = "") => ({ id, property: id, description, params } as never);
const node = (id: string, constraints: unknown[], parentId: string | null = null) => ({ id, kind: "collection", parentId, name: id, description: "", primitive: "group", region: { x: 0, y: 0, w: 1, h: 1 }, constraints, visible: true, machine: null } as never);
const module = (body: string) => `// @rulegen-modules:start\n// @rulegen-module "stripe"\n${body}\n// @rulegen-module-end\n// @rulegen-modules:end`;

test("a part's change since it was in step: values set above as they are, constraints replaced, code noticed", () => {
  const of = { frameId: "parent", nodeId: "stripe", constraintId: "width" };
  const part: Scene = { nodes: [node("collection", []), node("stripe", [constraint("width", [param("w", 10)])], "collection")] };
  const base = propagationBase(part, of, module("a"), []);
  assert.equal(partChanges(part, of, module("a"), [], base), null, "in step: nothing to ask");

  const changed: Scene = { nodes: [part.nodes[0], node("stripe", [constraint("width", [param("w", 14)])], "collection")] };
  const values = partChanges(changed, of, module("a"), [], base)!;
  assert.deepEqual(values.params.map(item => [item.paramId, item.before.value, item.after.value]), [["w", 10, 14]]);
  assert.equal(values.structure, false);

  const above: Scene = { nodes: [node("stripe", [constraint("width", [param("w", 10)]), constraint("color", [param("c", 1)])]), node("other", [constraint("width", [param("w", 3)])])] };
  const merged = mergePart(above, changed, of, base, values);
  assert.equal((merged.nodes[0] as any).constraints[0].params[0].value.value, 14);
  assert.equal((merged.nodes[0] as any).constraints[1].params[0].value.value, 1, "its other constraints stay");
  assert.equal((merged.nodes[1] as any).constraints[0].params[0].value.value, 3, "other nodes stay");

  const redescribed: Scene = { nodes: [part.nodes[0], node("stripe", [constraint("width", [param("w", 10)], "skips overlaps"), constraint("gap", [param("g", 2)])], "collection")] };
  const structural = partChanges(redescribed, of, module("b"), ["tools-1"], base)!;
  assert.equal(structural.structure, true); assert.equal(structural.code, true); assert.deepEqual(structural.tools, ["tools-1"]);
  const rebuilt = mergePart(above, redescribed, of, base, structural);
  assert.deepEqual((rebuilt.nodes[0] as any).constraints.map((item: any) => [item.id, item.description]), [["width", "skips overlaps"], ["color", ""], ["gap", ""]]);
});
