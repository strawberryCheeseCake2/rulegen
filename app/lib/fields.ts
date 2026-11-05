import { z } from "zod";
import { applyParameterEdits, moduleKeyOf } from "./hidden-parameters";
import { findNode } from "./scene/graph";
import { programModules } from "./scene/machines";
import type { Scene } from "./scene/schema";
import type { GeneratedCode } from "./schema";

// Fields a brush is driven by (m.field in its module: a direction at every point of the canvas, e.g. a flow field).
// An inspection shows them sampled on a grid and lets the user comb them: what-if strokes, drawn on the held step only.

/** One comb of a field: along `points` (canvas pixels, [x, y]) the field turns toward the stroke's direction within `radius`, by `strength`. */
export type FieldStroke = { points: [number, number][]; radius: number; strength: number };
/** A field a brush drew with, sampled on a grid over the canvas: each cell's direction (radians) and strength. */
export type FieldSamples = { root: string; id: string; cols: number; rows: number; w: number; h: number; cells: [number, number][];
  /** How many times the module declared it in the frame drawn (more than once: per mark, and only the last one is sampled). */ declared?: number };
/** Where the held step's drawing reports its fields (by "<root>/<field id>"), next to the module stores. */
export const FIELD_ROOT = "@field";
export const MAX_FIELD_STROKES = 24;

/** The fields among a drawing's stores, of the given roots only. */
export function fieldsIn(stores: Record<string, unknown> | null | undefined, roots: string[]): [string, FieldSamples][] {
  const all = stores?.[FIELD_ROOT];
  if (!all || typeof all !== "object") return [];
  return Object.entries(all as Record<string, FieldSamples>).filter(([, field]) => field && roots.includes(field.root) && Array.isArray(field.cells) && field.cols > 0 && field.rows > 0);
}
/** A drag as a comb stroke: points kept at least `gap` pixels apart (at most 200), rounded; null for a click. */
export function combStroke(points: { x: number; y: number }[], radius: number, strength: number, gap = 6): FieldStroke | null {
  const kept: [number, number][] = [];
  for (const point of points) {
    const last = kept.at(-1);
    if (!last || Math.hypot(point.x - last[0], point.y - last[1]) >= gap) kept.push([Math.round(point.x * 10) / 10, Math.round(point.y * 10) / 10]);
  }
  const end = points.at(-1);
  if (end && kept.length && (kept.at(-1)![0] !== Math.round(end.x * 10) / 10 || kept.at(-1)![1] !== Math.round(end.y * 10) / 10)) kept.push([Math.round(end.x * 10) / 10, Math.round(end.y * 10) / 10]);
  // A click (or a drag that hardly moves) is no comb.
  const length = kept.reduce((sum, point, i) => i ? sum + Math.hypot(point[0] - kept[i - 1][0], point[1] - kept[i - 1][1]) : 0, 0);
  return kept.length > 1 && length >= 8 ? { points: kept.slice(0, 200), radius, strength } : null;
}

/**
 * A field a targeted inspection found the concern to be about: which field of the brush (`id`, in the module of root
 * node `nodeId`), what to call it, why it matters, and — when the code does not declare it as it should yet — the exact
 * edits that make the module declare it once (the direction its marks travel) and trace the marks along it, so it can
 * be shown and combed.
 */
export const fieldHookSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/), nodeId: z.string().max(80), name: z.string().min(1).max(60), reason: z.string().max(400),
  edits: z.array(z.object({ find: z.string().min(1).max(3000), replace: z.string().min(1).max(6000) })).max(4),
});
export type FieldHook = z.infer<typeof fieldHookSchema>;
export const MAX_FIELD_HOOKS = 2;
const fieldCall = (id: string) => `m\\.field\\(\\s*["'\`]${id.replace(/[-]/g, "\\-")}["'\`]`;
/** Whether a module declares the field (m.field("<id>", …)). */
export const declaresField = (module: string, id: string) => new RegExp(fieldCall(id)).test(module);
/** What is wrong with how a module declares a field (null: nothing): once only, and the sampler it returns used. */
function declarationProblem(module: string, id: string): string | null {
  const calls = module.match(new RegExp(fieldCall(id), "g"))?.length ?? 0;
  if (!calls) return `The code does not declare the field “${id}” with m.field`;
  if (calls > 1) return `The field “${id}” is declared more than once (declare it once per draw, not per mark)`;
  const declaration = new RegExp(`(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*${fieldCall(id)}`).exec(module), named = declaration?.[1];
  // Sampled where it is declared, or passed on to the functions that trace the marks.
  const rest = declaration ? module.slice(0, declaration.index) + module.slice(declaration.index + declaration[0].length) : module;
  if (named && !new RegExp(`(?<![\\w$.])${named.replace(/\$/g, "\\$")}(?![\\w$])`).test(rest)) return `The marks do not sample the field “${id}” (${named} is never used)`;
  return null;
}
/** The module with the hook's edits, or why it cannot be (edits applied before — their results there, or their finds gone with the field declared — count as applied). */
function hookedModule(module: string, hook: FieldHook): { module: string } | { error: string } {
  if (!hook.edits.length || hook.edits.every(edit => module.includes(edit.replace))) return { module };
  const edited = applyParameterEdits(module, hook.edits);
  if ("error" in edited) return declaresField(module, hook.id) && !hook.edits.some(edit => module.includes(edit.find)) ? { module } : { error: edited.error };
  return { module: edited.module };
}
/** Why a field hook cannot be applied to the code (null: it can): its module, its edits, and the field declared after them. */
export function fieldHookProblem(scene: Scene, code: string, hook: FieldHook, parses: (module: string) => boolean = () => true): string | null {
  if (!findNode(scene, hook.nodeId)) return "Could not find the node";
  const key = moduleKeyOf(scene, hook.nodeId), module = key ? programModules(code).get(key) : undefined;
  if (!module) return "Could not find the node's code module";
  const edited = hookedModule(module, hook);
  if ("error" in edited) return edited.error;
  const problem = declarationProblem(edited.module, hook.id);
  if (problem) return problem;
  return edited.module === module || parses(edited.module) ? null : "The edited code is invalid";
}
/** The program with the field declared and its marks traced along it (unchanged when it already is). */
export function hookField(scene: Scene, generated: GeneratedCode, hook: FieldHook): { generated: GeneratedCode } | { error: string } {
  const problem = fieldHookProblem(scene, generated.code, hook);
  if (problem) return { error: problem };
  const module = programModules(generated.code).get(moduleKeyOf(scene, hook.nodeId)!)!;
  const edited = hookedModule(module, hook) as { module: string };
  return edited.module === module ? { generated } : { generated: { ...generated, code: generated.code.replace(module, () => edited.module) } };
}
