import { z } from "zod";
import { aiConstraintSchema } from "../scene/ai-schema";
import { convertConstraints } from "../scene/convert";
import { descendantIds, findNode } from "../scene/graph";
import { constraintSchema, idSchema, type Constraint, type Scene, type SceneNode } from "../scene/schema";
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

/** The example target of a sandbox part, and the scene it is made from (a computation: the node with only it). */
export function sandboxTarget(scene: Scene, sandbox: SandboxPart): ExampleTarget & { from?: Scene } {
  const part: Constraint | null = sandbox.part, { nodeId } = sandbox.target;
  if (!part) return { ...sandbox.target };
  return { nodeId, scope: "constraint", constraintId: part.id, from: { nodes: scene.nodes.map(node => node.id === nodeId ? { ...node, constraints: [part] } : node) } };
}

/** What the sandbox frame's code is told besides its part (kept with it for every generation). */
export const sandboxInstruction = (concern: string) =>
  `This frame is a mini sandbox for what the user asked about the original brush: "${concern.slice(0, 600)}". Make that clearly visible here, so changing this part's values shows how it comes about.`;
/** What the handles of a sandbox are designed for (every param still gets its own). */
export const sandboxHandleInstruction = (concern: string) =>
  `The user is looking into this about the brush: "${concern.slice(0, 600)}". Design each param's widget so the part of the picture this is about is easy to see and change through it. Every param still gets its own widget.`;
