import { z } from "zod";
import { aiConstraintSchema } from "../scene/ai-schema";
import { convertConstraints } from "../scene/convert";
import { descendantIds, findNode } from "../scene/graph";
import { constraintSchema, idSchema, type Constraint, type Scene, type SceneNode } from "../scene/schema";
import { nodeParams } from "../scene/constraints";
import { bindingKey } from "../scene/values";
import { valueText } from "../scene/propagation";
import type { ExampleTarget } from "../scene/minimal-example";

// A mini sandbox for an inspection concern: like decompose, but only the one part of the brush the concern is about
// (a node whole, a node's own constraints together, one constraint, or one computation inside a constraint), made
// into a part frame of its own, with direct manipulation handles (visual proxies) for its params.

export const SANDBOX_SCOPES = ["node", "constraints", "constraint", "computation"] as const;
/** How the sandbox's program works, in a few plain words: its mechanism, and what each param it is tuned by does in it. */
export const sandboxLogicSchema = z.object({
  summary: z.string().max(600),
  params: z.array(z.object({ id: z.string().max(80), how: z.string().max(300) })).max(16),
});
export type SandboxLogic = z.infer<typeof sandboxLogicSchema>;
/** trace-part, as the model answers: where the concern is, and (for a computation) that computation as a constraint. */
export const aiSandboxSchema = z.object({
  reason: z.string().max(400),
  nodeId: z.string().max(80),
  scope: z.enum(SANDBOX_SCOPES),
  constraintId: z.string().max(80),
  computation: aiConstraintSchema.nullable(),
  logic: sandboxLogicSchema,
});
export type AISandbox = z.infer<typeof aiSandboxSchema>;
/** trace-part, as the app takes it: the part to make a frame of (a computation is the node with only it as its constraint). */
export const sandboxSchema = z.object({
  reason: z.string().max(400),
  target: z.object({ nodeId: idSchema, scope: z.enum(["node", "constraints", "constraint"]), constraintId: z.string().max(80) }),
  part: constraintSchema.nullable(),
  logic: sandboxLogicSchema,
});
export type SandboxPart = z.infer<typeof sandboxSchema>;
/** A concern may be about more than one part of the brush: each gets a sandbox of its own. */
export const MAX_SANDBOXES = 3;
export const aiSandboxesSchema = z.object({ parts: z.array(aiSandboxSchema).min(1).max(MAX_SANDBOXES) });
export type AISandboxes = z.infer<typeof aiSandboxesSchema>;
export const sandboxesSchema = z.object({ parts: z.array(sandboxSchema).min(1).max(MAX_SANDBOXES) });

const tunable = (node: SceneNode) => node.constraints.filter(item => item.params.length);
const hasTunable = (scene: Scene, node: SceneNode) => [node.id, ...descendantIds(scene, node.id)].some(id => { const item = findNode(scene, id); return Boolean(item && tunable(item).length); });

/**
 * The model's answer made into a part that can be shown: a node of the inspected brush, a constraint it has (with
 * params), a computation with params of its own; what does not hold falls back one level up (the constraint, the
 * node's constraints, the node whole).
 */
export function settleSandbox(scene: Scene, nodeIds: string[], output: AISandbox): SandboxPart {
  const allowed = new Set(nodeIds), within = (node: SceneNode | undefined) => Boolean(node && allowed.has(node.id) && hasTunable(scene, node));
  let node = findNode(scene, output.nodeId);
  if (!within(node)) node = scene.nodes.find(item => !item.parentId && within(item)) ?? scene.nodes.find(within);
  if (!node) throw new Error("There is no part of this brush with values to try out on its own.");
  const reason = output.reason.slice(0, 400), logic = output.logic, own = tunable(node), constraint = own.find(item => item.id === output.constraintId);
  if (output.scope === "computation" && constraint && output.computation) {
    // Its id must not be one the node has (the constraint it is inside of keeps its own).
    const taken = new Set(node.constraints.map(item => item.id)), [converted] = convertConstraints([output.computation]);
    let id = converted.id, n = 2;
    while (taken.has(id)) id = `${converted.id.slice(0, 70)}-${n++}`;
    if (converted.params.length) return { reason, logic, target: { nodeId: node.id, scope: "constraint", constraintId: id }, part: { ...converted, id } };
  }
  if ((output.scope === "computation" || output.scope === "constraint") && constraint) return { reason, logic, target: { nodeId: node.id, scope: "constraint", constraintId: constraint.id }, part: null };
  if (output.scope !== "node" && own.length > 1) return { reason, logic, target: { nodeId: node.id, scope: "constraints", constraintId: "" }, part: null };
  if (output.scope !== "node" && own.length === 1 && !scene.nodes.some(item => item.parentId === node!.id)) return { reason, logic, target: { nodeId: node.id, scope: "constraint", constraintId: own[0].id }, part: null };
  return { reason, logic, target: { nodeId: node.id, scope: "node", constraintId: "" }, part: null };
}

/**
 * The model's parts, each settled as `settleSandbox` does; one that lands on a part already taken (a fallback to the
 * same constraint or node) is dropped, and a computation gets an id no other part has (they may meet in a frame above).
 */
export function settleSandboxes(scene: Scene, nodeIds: string[], output: AISandboxes): { parts: SandboxPart[] } {
  const parts: SandboxPart[] = [], seen = new Set<string>(), ids = new Set<string>();
  let failure: unknown = null;
  for (const answer of output.parts.slice(0, MAX_SANDBOXES)) {
    let settled: SandboxPart;
    try { settled = settleSandbox(scene, nodeIds, answer); } catch (error) { failure ??= error; continue; }
    if (settled.part) {
      const taken = new Set([...ids, ...(findNode(scene, settled.target.nodeId)?.constraints.map(item => item.id) ?? [])]);
      let id = settled.part.id, n = 2;
      while (taken.has(id)) id = `${settled.part.id.slice(0, 70)}-${n++}`;
      ids.add(id);
      settled = { ...settled, target: { ...settled.target, constraintId: id }, part: { ...settled.part, id } };
    } else {
      const key = `${settled.target.nodeId}|${settled.target.scope}|${settled.target.constraintId}`;
      if (seen.has(key)) continue;
      seen.add(key);
    }
    parts.push(settled);
  }
  if (!parts.length) throw failure instanceof Error ? failure : new Error("There is no part of this brush with values to try out on its own.");
  return { parts };
}

/** The example target of a sandbox part, and the scene it is made from (a computation: the node with only it). */
export function sandboxTarget(scene: Scene, sandbox: SandboxPart): ExampleTarget & { from?: Scene } {
  const part: Constraint | null = sandbox.part, { nodeId } = sandbox.target;
  if (!part) return { ...sandbox.target };
  return { nodeId, scope: "constraint", constraintId: part.id, from: { nodes: scene.nodes.map(node => node.id === nodeId ? { ...node, constraints: [part] } : node) } };
}

/**
 * The code hint of a sandbox frame (in place of a minimal example's plain member): its part runs inside the rest of the
 * original brush, kept as it is there — the items, places, shapes and look its code makes, with the values it has now
 * written in — so the sandbox looks like the brush and only the part's params change it.
 */
export function sandboxExampleInstruction(original: Scene, sandbox: Scene, nodeId: string, constraintId: string) {
  const node = findNode(sandbox, nodeId), part = node?.constraints.find(item => item.id === constraintId);
  if (!node || !part) return "";
  const own = new Set(sandbox.nodes.flatMap(item => nodeParams(item).map(param => bindingKey([item.id, param.id]))));
  const fixed = sandbox.nodes.flatMap(item => { const was = findNode(original, item.id); return was ? nodeParams(was).map(param => [bindingKey([item.id, param.id]), param] as const) : []; })
    .filter(([key]) => !own.has(key)).map(([key, param]) => `${key} = ${valueText(param.value)}`);
  return [
    `This frame is a mini sandbox of one part of the original brush (its code is \`previous\` when this frame has none yet; afterwards this frame's own code keeps it): "${part.property}" of "${node.name}". What it does: ${part.description}`,
    "Show it AS IT ACTS IN THE BRUSH, not on a plain member: keep everything else of the original brush around it as the original code does it — how many items there are, where they are, their shapes, widths, colors and texture — so the picture looks like the brush. Only this part is computed by its constraint from its params; where the original code computes it, use this constraint instead, so changing its params changes the picture as it would in the brush.",
    "Also make what this part itself computes visible — its output (the value it gives at each place, item or moment), so the user sees it change with the part's params as well as the brush it makes. Choose the form that shows this part's output most clearly, as fits it: drawn where it acts over the picture, or beside it (an inset, a graph of the value against what it depends on, a strip or legend…), in a color apart from the brush's own. For example, a direction or a flow could be a grid of arrows across the area it covers, a size, weight or chance marks scaled by it, a choice a mark per item, a value over time a curve.",
    fixed.length ? `The original reads params this frame does not have: write them in as the constants they are now (${fixed.join(", ")}).`.slice(0, 1600) : "",
    "Whether it needs input: keep an interaction only where this part is ABOUT the input itself. Otherwise it must NOT need any input: where the original brush makes things from the user's input, make them here from a fixed sample laid out in the code across the node's box, so the part shows from the first frame.",
  ].filter(Boolean).join("\n").slice(0, 3200);
}

/** What the sandbox frame's code is told besides its part (kept with it for every generation). */
export const sandboxInstruction = (concern: string) =>
  `This frame is a mini sandbox for what the user asked about the original brush: "${concern.slice(0, 600)}". Make that clearly visible here, so changing this part's values shows how it comes about.`;
/** What the handles of a sandbox are designed for (every param still gets its own). */
export const sandboxHandleInstruction = (concern: string) =>
  `The user is looking into this about the brush: "${concern.slice(0, 600)}". Design each param's widget so the part of the picture this is about is easy to see and change through it. Every param still gets its own widget.`;
