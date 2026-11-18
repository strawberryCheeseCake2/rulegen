import { z } from "zod";
import { parse } from "@babel/parser";
import { sandboxHost } from "./overlay";
import { formatValue, readPath, siteOf, type ExecTrace } from "./trace";

// Direct manipulation in an Execution frame: to make clear what a concern wants, the user shows it on the picture with
// a few tools made for that concern (brush, pencil, select / scale / rotate). What they show is measured into values
// of the brush's execution variables it is about (a value read straight from a param is set at once; a value the code
// computes, or a variable it does not have yet, is changed by revising the code when the user applies it). When the
// rules the tools could follow would make the picture very different, the user first picks one from thumbnails.

export const MANIP_TOOLS = ["brush", "pencil", "select"] as const;
export type ManipTool = (typeof MANIP_TOOLS)[number];
export const MAX_TARGETS = 4, MAX_OPTIONS = 4;

const toolSchema = z.object({ kind: z.enum(MANIP_TOOLS), purpose: z.string().max(200) });
export const clarifySchema = z.object({
  /** Whether variables of the current code bear on the concern (false: a new behavior nothing in the code is about yet). */
  related: z.boolean(),
  /** What is being made clear and how (the concern's language). */
  summary: z.string().max(600),
  /** Whether meeting the concern changes how the code computes (not only values it already reads). */
  needsCode: z.boolean(),
  /**
   * The ways the concern could be met, listed before deciding anything: each a different mechanism (how the code
   * would compute it), with the tools that would show what the user wants under it and a thumbnail of its outcome.
   */
  rules: z.array(z.object({
    id: z.string().max(40),
    /** The rule in a few words. */
    rule: z.string().max(140),
    /** Its logic in one short line (a formula or the condition), written over the thumbnail. */
    logic: z.string().max(160),
    detail: z.string().max(300),
    tools: z.array(toolSchema).max(3),
    /** The body of `(ctx, input)` drawing the rule's outcome on a 900×600 canvas 2D context. */
    thumbnail: z.string().max(8000),
  })).max(MAX_OPTIONS),
  /** Ask the user to pick one of `rules` first. */
  ask: z.boolean(),
  /** The question when asking (else ""). */
  question: z.string().max(300),
  /** Why it asks, or why one rule is clearly meant. */
  reason: z.string().max(300),
  /** The tools offered (empty while a rule is to be picked). */
  tools: z.array(toolSchema).max(3),
  /** The execution variables the demonstration sets (empty for a new behavior with nothing related). */
  targets: z.array(z.object({
    id: z.string().max(40),
    name: z.string().max(80),
    /** Where it is recorded ("constraint:<node>/<constraint>", …), "" for a variable the code does not have yet. */
    site: z.string().max(200),
    /** "@name.field" at that site ("" with no site). */
    path: z.string().max(160),
    /** The param key ("<node>/<param>") when the variable is that param's value as is, else "". */
    param: z.string().max(200),
    /** How the demonstration sets it (the concern's language). */
    meaning: z.string().max(300),
    /** The body of `(strokes, input)` returning the value the demonstration shows (null when it shows none yet). */
    measure: z.string().max(6000),
  })).max(MAX_TARGETS),
});
export type Clarify = z.infer<typeof clarifySchema>;
export type ClarifyTarget = Clarify["targets"][number];
export type ClarifyRule = Clarify["rules"][number];
/** The rule picked, sent back to get the tools for it. */
export const choiceSchema = z.object({ question: z.string().max(300), rule: z.string().max(140), logic: z.string().max(160), detail: z.string().max(300), tools: z.array(z.enum(MANIP_TOOLS)).max(3) });
export type Choice = z.infer<typeof choiceSchema>;
/** Whether the user is to pick a rule first. */
export const asks = (clarify: Clarify | null) => Boolean(clarify?.ask && clarify.rules.length >= 2);

/** Whether `body` parses as the body of a function with these parameters. */
export function compiles(body: string, params: string[]) {
  if (!body.trim()) return false;
  try { parse(`function f(${params.join(", ")}) {\n${body}\n}`, { sourceType: "script" }); return true; } catch { return false; }
}
type Param = { key: string; type: string; options?: string[] };
/**
 * Keep what can be used: targets at recorded sites with variables seen there (or a new variable: no site), param keys
 * of the brush, code that parses. A question (2+ rules) waits for its pick (no tools until then); without one there
 * are tools.
 */
export function settleClarify(output: Clarify, sites: { site: string; variables: string[] }[], params: Param[], picked: boolean): Clarify {
  const known = new Map(sites.map(site => [site.site, new Set(site.variables)])), keys = new Set(params.map(param => param.key));
  const ids = new Set<string>();
  const unique = (id: string) => { let out = id.trim() || "t", k = 2; while (ids.has(out)) out = `${id}-${k++}`; ids.add(out); return out; };
  const kinds = (tools: Clarify["tools"]) => { const seen = new Set<ManipTool>(); return tools.filter(tool => !seen.has(tool.kind) && Boolean(seen.add(tool.kind))); };
  const targets = output.targets.flatMap(target => {
    if (!compiles(target.measure, ["strokes", "input"])) return [];
    const names = known.get(target.site);
    const recorded = Boolean(names && target.path.startsWith("@") && names.has(target.path.slice(1).split(".")[0]));
    return [{ ...target, id: unique(target.id), site: recorded ? target.site : "", path: recorded ? target.path : "", param: keys.has(target.param) ? target.param : "" }];
  }).slice(0, MAX_TARGETS);
  const rules = picked ? [] : output.rules.map(rule => ({ ...rule, id: unique(rule.id), tools: kinds(rule.tools), thumbnail: compiles(rule.thumbnail, ["ctx", "input"]) ? rule.thumbnail : "" }));
  const ask = !picked && output.ask && rules.length >= 2;
  if (ask) return { ...output, rules, ask, question: output.question || output.summary, tools: [], targets: [] };
  const tools = kinds(output.tools);
  if (!tools.some(tool => tool.kind !== "select")) throw new Error("No direct manipulation tool fits this concern. Describe what should change a little more and ask again.");
  return { ...output, rules, ask: false, tools, targets };
}

/** The value a param takes from a measured one, or undefined when it does not fit the param. */
export function paramValue(value: unknown, param: { type: string; options?: string[] }): number | string | boolean | undefined {
  if (param.type === "number") return typeof value === "number" && Number.isFinite(value) ? value : undefined;
  if (param.type === "color") return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value : undefined;
  if (param.type === "toggle") return typeof value === "boolean" ? value : undefined;
  if (param.type === "select") return typeof value === "string" && param.options?.includes(value) ? value : undefined;
  return undefined;
}

/** The values a variable had at each visit of its site in the newest cycle (of those `keep` allows) that has the site. */
export function recordedAt(trace: ExecTrace, site: string, path: string, keep: (cycleId: number) => boolean = () => true): unknown[] {
  if (!site || !path) return [];
  for (let i = trace.cycles.length - 1; i >= 0; i--) {
    const cycle = trace.cycles[i];
    if (!keep(cycle.id)) continue;
    const steps = cycle.steps.filter(step => siteOf(step) === site);
    if (steps.length) return steps.map(step => readPath(step, path));
  }
  return [];
}
/** A short reading of values: a number range with how many, or the first different values. */
export function summarize(values: unknown[]): string {
  const present = values.filter(value => value !== undefined);
  if (!present.length) return "—";
  if (present.every(value => typeof value === "number")) {
    const numbers = present as number[], min = Math.min(...numbers), max = Math.max(...numbers);
    return min === max ? formatValue(min) : `${formatValue(min)} – ${formatValue(max)} (${numbers.length})`;
  }
  const distinct = [...new Set(present.map(value => formatValue(value, 40)))];
  return distinct.slice(0, 3).join(", ") + (distinct.length > 3 ? ` … (${distinct.length})` : "");
}

/** The request to revise the brush from a demonstration (its rule, what the tools were for, the values shown). */
export function revisionRequest(input: { concern: string; summary: string; choice: Choice | null; tools: Clarify["tools"]; targets: (ClarifyTarget & { before: string; shown: string })[] }) {
  const lines = [`Concern: ${input.concern}`, `What the demonstration makes clear: ${input.summary}`];
  if (input.choice) lines.push(`Rule chosen for "${input.choice.question}": ${input.choice.rule} (${input.choice.logic})${input.choice.detail ? ` — ${input.choice.detail}` : ""}`);
  lines.push("The user showed it on the result with direct manipulation strokes (drawn in the annotation):", ...input.tools.map(tool => `- ${tool.kind}: ${tool.purpose}`));
  if (input.targets.length) lines.push("Execution variables it sets (now → shown):", ...input.targets.map(target =>
    `- ${target.name}${target.site ? ` (${target.site} ${target.path})` : " (new: the code does not have it yet)"}: ${target.before} → ${target.shown}. ${target.meaning}`));
  lines.push("Change the brush so that its execution follows the rule and produces these values where the strokes show them; change the code where needed, add a variable or param if it is missing. Keep everything else as it is.");
  return lines.join("\n").slice(0, 6000);
}

// The worker: measures a demonstration (a target's code over the strokes) or draws a rule's thumbnail (to a PNG).
export const MANIP_WORKER = `
const clone=v=>v===undefined?null:JSON.parse(JSON.stringify(v));
self.onmessage=async e=>{const {id,kind,code,input}=e.data;
  try{
    if(kind==='measure'){const f=new Function('strokes','input','"use strict";\\n'+code);self.postMessage({id,value:clone(f(clone(input.strokes),clone(input)))});return;}
    if(kind==='thumbnail'){const canvas=new OffscreenCanvas(input.w,input.h),ctx=canvas.getContext('2d');ctx.scale(input.w/900,input.h/600);
      new Function('ctx','input','"use strict";\\n'+code)(ctx,clone(input.data));
      const pixels=ctx.getImageData(0,0,input.w,input.h).data;let empty=true;for(let k=3;k<pixels.length;k+=4)if(pixels[k]){empty=false;break;}
      self.postMessage({id,empty,blob:await canvas.convertToBlob({type:'image/png'})});return;}
    self.postMessage({id,error:'Unknown request.'});
  }catch(error){self.postMessage({id,error:String(error&&error.message||error).slice(0,200)});}};
`;
export const MANIP_HOST = sandboxHost(MANIP_WORKER, 2500);
