import { z } from "zod";
import { descendantIds, findNode } from "./graph";
import { programModules } from "./machines";
import type { Constraint, Param, Scene, SceneNode } from "./schema";

// Propagation in a decomposition: a part frame (a minimal example, exampleOf) that was changed on its own — its param
// values, its constraints, or its code (an inspection fork kept, a regeneration…) — can pass the change up to the
// frames it came from. What changed is measured against the part as it was last in step with them (its baseline):
// params and constraints that the frame above has too (same ids: decomposition keeps them) are set there as they
// are; a change of how the part computes is carried by rewriting the code above with the part's code as reference.

/** The part as it was last in step with the frames above: its nodes' constraints, and a hash of its code modules. */
export const propagationBaseSchema = z.object({
  nodes: z.array(z.object({ id: z.string().max(80), constraints: z.array(z.unknown()).max(64) })).max(64),
  code: z.string().max(40),
  tools: z.array(z.string().max(80)).max(16),
});
export type PropagationBase = z.infer<typeof propagationBaseSchema>;
export type PartOf = { frameId: string; nodeId: string; constraintId: string; scope?: "constraints" | "node" };

export type ParamChange = { nodeId: string; constraintId: string; paramId: string; label: string; before: Param["value"]; after: Param["value"] };
export type PartChanges = {
  params: ParamChange[];
  /** Constraints added, removed or redescribed (not only values). */
  structure: boolean;
  /** How the part computes (its code modules) changed. */
  code: boolean;
  /** Direct manipulation tools kept with the part since. */
  tools: string[];
};

const hash = (text: string) => { let h = 0x811c9dc5; for (let k = 0; k < text.length; k++) { h ^= text.charCodeAt(k); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(36); };
/** The code that counts: the modules only (the runtime around them is refreshed on load). */
const codeHash = (code: string | undefined) => code ? hash([...programModules(code).entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, text]) => text).join("\n")) : "";
/** A constraint without its param values (what it is, not where it is set). */
const shape = (constraint: Constraint) => JSON.stringify({ ...constraint, params: constraint.params.map(param => ({ ...param, value: { ...param.value, value: null } })) });

/** The nodes of a part that it is about (others are scaffolding: a plain collection or member around it). */
export function partNodes(scene: Scene, of: PartOf): SceneNode[] {
  const node = findNode(scene, of.nodeId);
  if (!node) return [];
  return of.scope === "node" ? [node, ...descendantIds(scene, node.id).map(id => findNode(scene, id)!).filter(Boolean)] : [node];
}

export function propagationBase(scene: Scene, of: PartOf, code: string | undefined, tools: string[]): PropagationBase {
  return { nodes: partNodes(scene, of).map(node => ({ id: node.id, constraints: structuredClone(node.constraints) })), code: codeHash(code), tools: tools.slice(0, 16) };
}

/** What changed in the part since its baseline (null when nothing did). */
export function partChanges(scene: Scene, of: PartOf, code: string | undefined, tools: string[], base: PropagationBase): PartChanges | null {
  const nodes = partNodes(scene, of), before = new Map(base.nodes.map(node => [node.id, node.constraints as Constraint[]]));
  const params: ParamChange[] = [];
  let structure = nodes.length !== base.nodes.length;
  for (const node of nodes) {
    const old = before.get(node.id);
    if (!old) { structure = true; continue; }
    if (old.length !== node.constraints.length || old.some((item, k) => shape(item) !== shape(node.constraints[k]))) structure = true;
    for (const constraint of node.constraints) {
      const was = old.find(item => item.id === constraint.id);
      for (const param of constraint.params) {
        const prior = was?.params.find(item => item.id === param.id);
        if (prior && prior.value.type === param.value.type && JSON.stringify(prior.value.value) !== JSON.stringify(param.value.value))
          params.push({ nodeId: node.id, constraintId: constraint.id, paramId: param.id, label: `${constraint.property} · ${param.label}`, before: prior.value, after: param.value });
      }
    }
  }
  const changed = { params, structure, code: codeHash(code) !== base.code, tools: tools.filter(id => !base.tools.includes(id)) };
  return changed.params.length || changed.structure || changed.code || changed.tools.length ? changed : null;
}

/**
 * The frame above with the part's change put in: param values of the params it has too, and (when the part's
 * constraints changed) the part's constraints in place of its own for the same node — added and removed ones too.
 * Nodes or constraints it does not have (a split's inner computation) are left to the code rewrite.
 */
export function mergePart(above: Scene, part: Scene, of: PartOf, base: PropagationBase, changes: PartChanges): Scene {
  const nodes = new Map(partNodes(part, of).map(node => [node.id, node])), before = new Map(base.nodes.map(node => [node.id, node.constraints as Constraint[]]));
  return { ...above, nodes: above.nodes.map(node => {
    const now = nodes.get(node.id);
    if (!now) return node;
    let constraints = node.constraints;
    if (changes.structure) {
      const old = before.get(node.id) ?? [], had = new Set(old.map(item => item.id)), kept = new Set(now.constraints.map(item => item.id)), own = new Set(node.constraints.map(item => item.id));
      // The part's constraints replace the same ones above; ones the part dropped go; ones it added are added (only
      // when the frame above has the constraint the part was made from, so a split's inner computation is not added).
      const related = now.constraints.some(item => own.has(item.id)) || old.some(item => own.has(item.id));
      if (related) constraints = [
        ...node.constraints.filter(item => !(had.has(item.id) && !kept.has(item.id))).map(item => now.constraints.find(next => next.id === item.id) ?? item),
        ...now.constraints.filter(item => !own.has(item.id) && !had.has(item.id)),
      ];
    }
    const values = changes.params.filter(change => change.nodeId === node.id);
    if (values.length) constraints = constraints.map(constraint => ({ ...constraint, params: constraint.params.map(param => {
      const change = values.find(item => item.constraintId === constraint.id && item.paramId === param.id);
      return change && change.after.type === param.value.type ? { ...param, value: { ...param.value, value: change.after.value } as Param["value"] } : param;
    }) }));
    return constraints === node.constraints ? node : { ...node, constraints };
  }) };
}

/** The part's code modules for the nodes it is about (what the code above is rewritten to follow). */
export function partModules(code: string, scene: Scene, of: PartOf, max = 6000) {
  const modules = programModules(code), keys = partNodes(scene, of).map(node => node.codeModule ?? node.id);
  return [...new Set(keys)].map(key => modules.get(key)).filter(Boolean).join("\n").slice(0, max);
}
/** A param value in words. */
export const valueText = (value: Param["value"]) => value.type === "number" ? `${Number(value.value.toFixed(4))}${value.unit ? ` ${value.unit}` : ""}` : String(value.value);
