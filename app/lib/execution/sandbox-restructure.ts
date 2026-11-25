import { z } from "zod";
import { aiConstraintSchema } from "../scene/ai-schema";
import { convertConstraints } from "../scene/convert";
import { findNode, updateNode } from "../scene/graph";
import { constraintSchema, type Constraint, type Scene } from "../scene/schema";
import { compiles } from "./manipulate";

// Structural changes for a mini sandbox: when changing its params cannot give what the concern asks for, AI offers
// 2–4 ways to change how the part computes (a multiple choice question, each option with a preview sketched over the
// sandbox's picture). The one picked replaces the part's constraint, the sandbox's code follows it, and the change can
// be passed up to the frames above (Propagate, which asks before AI rewrites them).

export const MAX_RESTRUCTURE_OPTIONS = 4;
/** sandbox-restructure, as the model answers. */
export const aiRestructureSchema = z.object({
  /** Why its params alone may not do (one sentence), or that they can: then no options. */
  question: z.string().max(300),
  options: z.array(z.object({
    id: z.string().max(40),
    label: z.string().max(80),
    /** What changes in how it computes, in one sentence. */
    change: z.string().max(300),
    /** Its logic in one short line (the formula or rule), written over the preview. */
    logic: z.string().max(160),
    /** The part's constraint as it would be after the change (the same id: it replaces the part's). */
    constraint: aiConstraintSchema,
    /** The body of `(ctx, input, note)` sketching the outcome over the sandbox's picture (900×600). */
    thumbnail: z.string().max(8000),
  })).max(MAX_RESTRUCTURE_OPTIONS),
});
export type AIRestructure = z.infer<typeof aiRestructureSchema>;
export const restructureOptionSchema = z.object({ id: z.string().max(40), label: z.string().max(80), change: z.string().max(300), logic: z.string().max(160), constraint: constraintSchema, thumbnail: z.string().max(8000) });
export type RestructureOption = z.infer<typeof restructureOptionSchema>;
export const restructureSchema = z.object({ question: z.string().max(300), options: z.array(restructureOptionSchema).max(MAX_RESTRUCTURE_OPTIONS) });
export type Restructure = z.infer<typeof restructureSchema>;

/** Keep the options that can be used: each keeps the part's constraint id, has params, a unique id, and a preview that parses ("" otherwise). */
export function settleRestructure(output: AIRestructure, constraintId: string): Restructure {
  const seen = new Set<string>();
  const options = output.options.flatMap(option => {
    const [constraint] = convertConstraints([{ ...option.constraint, id: constraintId }]);
    let id = option.id.trim() || "option", n = 2;
    while (seen.has(id)) id = `${option.id.slice(0, 34)}-${n++}`;
    if (!constraint?.params.length) return [];
    seen.add(id);
    return [{ id, label: option.label, change: option.change, logic: option.logic, constraint: { ...constraint, id: constraintId }, thumbnail: compiles(option.thumbnail, ["ctx", "input", "note"]) ? option.thumbnail : "" }];
  });
  return { question: output.question.slice(0, 300), options: options.length >= 2 ? options : [] };
}

/** The scene with the option's constraint in place of the part's (its handles kept for params that are still there). */
export function applyRestructure(scene: Scene, nodeId: string, option: RestructureOption): Scene {
  return updateNode(scene, nodeId, node => ({ ...node, constraints: node.constraints.map(item => item.id !== option.constraint.id ? item : {
    ...option.constraint, params: option.constraint.params.map(param => {
      const was = item.params.find(old => old.id === param.id);
      return was?.handle && was.value.type === param.value.type ? { ...param, handle: was.handle } : param;
    }),
  } as Constraint) }));
}

/** The node and constraint a sandbox frame is about (its part), when it is one constraint. */
export function restructureTarget(scene: Scene, of: { nodeId: string; constraintId: string; scope?: string } | null) {
  if (!of || of.scope) return null;
  const node = findNode(scene, of.nodeId), constraint = node?.constraints.find(item => item.id === of.constraintId);
  return node && constraint ? { node, constraint } : null;
}
