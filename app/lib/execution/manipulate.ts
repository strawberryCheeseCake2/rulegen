import { z } from "zod";
import { parse } from "@babel/parser";
import { sandboxHost } from "./overlay";
import { formatValue, readPath, siteOf, type Analysis, type ExecTrace } from "./trace";

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
    /** The body of `(ctx, input, note)` sketching the rule's outcome (the concern's part) on a 900×600 canvas 2D context, with in-situ notes. */
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
    /** The body of `(value, x, y)` returning the part of the measured value that applies at canvas point (x, y) — the
     *  element the code reads for an item there — or "" when the value is one value (the same everywhere). */
    at: z.string().max(3000),
  })).max(MAX_TARGETS),
});
export type Clarify = z.infer<typeof clarifySchema>;
export type ClarifyTarget = Clarify["targets"][number];
export type ClarifyRule = Clarify["rules"][number];
/** The rule picked, sent back to get the tools for it. */
export const choiceSchema = z.object({ question: z.string().max(300), rule: z.string().max(140), logic: z.string().max(160), detail: z.string().max(300), tools: z.array(z.enum(MANIP_TOOLS)).max(3) });
export type Choice = z.infer<typeof choiceSchema>;
/**
 * What the user said about something made that did not fit, with text and marks drawn on the picture (canvas pixels):
 * none of the rules offered ("options": they are listed again, different), or the tools made do not do what they want
 * ("tools": alternatives are asked for, each a different correction).
 */
export const feedbackSchema = z.object({
  kind: z.enum(["options", "tools"]),
  text: z.string().max(1000),
  marks: z.array(z.array(z.object({ x: z.number(), y: z.number() })).max(400)).max(24).default([]),
  /** options: the rules offered that did not fit. */
  rejected: z.array(z.object({ rule: z.string().max(140), logic: z.string().max(160), detail: z.string().max(300) })).max(MAX_OPTIONS * 3).default([]),
  /** tools: the tools made, what each target was measured as and what the strokes shown with them measured to. */
  made: z.object({ summary: z.string().max(600), rule: z.string().max(400), tools: z.array(toolSchema).max(3),
    targets: z.array(z.object({ name: z.string().max(80), site: z.string().max(200), path: z.string().max(160), param: z.string().max(200), meaning: z.string().max(300), measure: z.string().max(6000), shown: z.string().max(600) })).max(MAX_TARGETS) }).nullable().default(null),
});
export type Feedback = z.infer<typeof feedbackSchema>;
/** Whether feedback says something (text or a mark). */
export const saysSomething = (feedback: Pick<Feedback, "text" | "marks">) => Boolean(feedback.text.trim() || feedback.marks.some(mark => mark.length >= 2));
/** Direct manipulation tools made before (a trace-clarify generation in AI history), to use again without AI: the
 *  frame they were made for, the concern, the rule picked and the tools (or the rule question). */
export const savedToolsSchema = z.object({ owner: z.string(), concern: z.string(), choice: choiceSchema.nullable(), marks: z.array(z.array(z.object({ x: z.number(), y: z.number() }))).default([]), clarify: clarifySchema });
export type SavedTools = z.infer<typeof savedToolsSchema>;
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
  // Ids are also what the code reads a shown value by (m.demo("<id>")): letters, digits, _ and -.
  const unique = (raw: string) => { const id = raw.trim().replace(/[^\w-]+/g, "-").slice(0, 34) || "t"; let out = id, k = 2; while (ids.has(out)) out = `${id}-${k++}`; ids.add(out); return out; };
  const kinds = (tools: Clarify["tools"]) => { const seen = new Set<ManipTool>(); return tools.filter(tool => !seen.has(tool.kind) && Boolean(seen.add(tool.kind))); };
  const targets = output.targets.flatMap(target => {
    if (!compiles(target.measure, ["strokes", "input"])) return [];
    const names = known.get(target.site);
    const recorded = Boolean(names && target.path.startsWith("@") && names.has(target.path.slice(1).split(".")[0]));
    return [{ ...target, id: unique(target.id), site: recorded ? target.site : "", path: recorded ? target.path : "", param: keys.has(target.param) ? target.param : "", at: compiles(target.at, ["value", "x", "y"]) ? target.at : "" }];
  }).slice(0, MAX_TARGETS);
  const rules = picked ? [] : output.rules.map(rule => ({ ...rule, id: unique(rule.id), tools: kinds(rule.tools), thumbnail: compiles(rule.thumbnail, ["ctx", "input", "note"]) ? rule.thumbnail : "" }));
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
/** A reading of values: a number range with how many, or the first different values (each cut at `max` characters). */
export function summarize(values: unknown[], max = 40): string {
  const present = values.filter(value => value !== undefined);
  if (!present.length) return "—";
  if (present.every(value => typeof value === "number")) {
    const numbers = present as number[], min = Math.min(...numbers), max = Math.max(...numbers);
    return min === max ? formatValue(min) : `${formatValue(min)} – ${formatValue(max)} (${numbers.length})`;
  }
  const distinct = [...new Set(present.map(value => formatValue(value, max)))];
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

/** The host value a temporary fork reads a target's shown value from (m.demo("<id>")). */
export const demoKey = (id: string) => `~demo/${id}`;
/** Targets the fork's code reads live with m.demo: all but params read as is (those are set on the param). */
export const liveTargets = (clarify: Clarify | null) => clarify?.targets.filter(target => !target.param) ?? [];

/** The request to make a temporary fork follow the rule, with the values the tools show coming in live (m.demo). */
export function liveRequest(input: { concern: string; summary: string; choice: Choice | null; tools: Clarify["tools"]; targets: ClarifyTarget[] }) {
  const lines = [`Concern: ${input.concern}`, `What is being made clear: ${input.summary}`];
  if (input.choice) lines.push(`Rule chosen for "${input.choice.question}": ${input.choice.rule} (${input.choice.logic})${input.choice.detail ? ` — ${input.choice.detail}` : ""}`);
  lines.push("This is a temporary fork the user tries the rule on. They show what they want on its picture with direct manipulation tools:", ...input.tools.map(tool => `- ${tool.kind}: ${tool.purpose}`));
  const live = input.targets.filter(target => !target.param), params = input.targets.filter(target => target.param);
  if (live.length) lines.push("Where a shown value acts, keep what it gives THIS item (e.g. the probability at this item's place, looked up from a shown grid) in a named local variable declared before any return of that compute function (also when the shown value is null: then it holds what applies without it), so it is recorded at every step and can be inspected; return the property's value as before.", "What the tools show comes in LIVE, read with m.demo(\"<id>\") (null while nothing is shown; then keep the current behavior). Each is the value this code computes (the function body is how it is measured from the strokes, canvas pixels 900×600; `input.mask` is 30 rows × 45 columns of 20 px cells, each the number of brush coats over it, 0 unpainted; each further coat takes the change further where it applies):",
    ...live.map(target => `- m.demo("${target.id}") — ${target.name}${target.site ? ` (now ${target.site} ${target.path})` : " (new: the code does not have it yet)"}: ${target.meaning}\n  measured by: ${target.measure.replace(/\s+/g, " ").slice(0, 900)}`));
  if (params.length) lines.push("Params the tools set directly (keep reading them with m.v):", ...params.map(target => `- ${target.param}: ${target.meaning}`));
  lines.push("Change the code so that its execution follows the rule and uses these values where they act, in the compute functions of the constraints they decide, so that the picture changes at once as the user shows them. Read each m.demo id with the literal id. Keep everything else as it is.");
  return lines.join("\n").slice(0, 8000);
}
/** The concern a fork's inspection is asked with: only what the tools set. */
export function liveConcern(concern: string, targets: ClarifyTarget[]) {
  return [`${concern}`, "Show ONLY the values the direct manipulation tools set, as each item gets them: the value at that item (e.g. the probability at its place, a local variable of the code that reads the shown value), not the whole shown structure (a grid, a mask, a list) and not the outcome it leads to (its color, size…). Nothing else: no ids or positions (those go to locate). When one step holds the value of many items (a list: one per item), show the whole list and locate with the whole list of positions — never one index of it.",
    ...targets.map(target => `- ${target.name}: ${target.meaning}${target.param ? ` (param ${target.param})` : ` (the code reads it with m.demo("${target.id}"); the whole shown value is @$demo.${target.id} — show it only if it is one value)`}`)].join("\n").slice(0, 2000);
}

// Values the tools set are shown per item, at any item clicked: a path into one index of a list ("@values.1") would
// show only that item, so it is widened to the list (each item's value is shown at its own place).
const indexed = (path: string) => path.split(".").findIndex((part, k) => k > 0 && /^\d+$/.test(part));
/** Whether an analysis shows only one index of a list somewhere (made before it was widened). */
export const pinsItem = (analysis: Analysis) => analysis.sites.some(site => site.show.some(path => indexed(path) > 0));
/** The analysis with every path into one index of a list widened to the list. */
export function everyItem(analysis: Analysis): Analysis {
  const widen = (path: string) => { const at = indexed(path); return at > 0 ? path.split(".").slice(0, at).join(".") : path; };
  return { ...analysis, sites: analysis.sites.map(site => {
    const show = [...new Set(site.show.map(widen))];
    return { ...site, show, locate: [...new Set(site.locate.map(widen))].filter(path => !show.includes(path)) };
  }) };
}

// The worker: measures a demonstration (a target's code over the strokes) or draws a rule's thumbnail (to a PNG).
export const MANIP_WORKER = `
const clone=v=>v===undefined?null:JSON.parse(JSON.stringify(v));
// In-situ notes on a thumbnail (canvas pixels, 900×600): short labels, arrows, dimensions, angles, regions and tool
// icons, all in one legible style (ink over a white halo) at a size that reads when the thumbnail is small.
const makeNote=(ctx,sx,sy)=>{
  const INK='#1f3d2c',W=900,H=600,placed=[];let left=14;
  const ok=p=>Array.isArray(p)&&Number.isFinite(+p[0])&&Number.isFinite(+p[1]);
  const text=t=>String(t==null?'':t).trim().slice(0,36);
  const draw=f=>{if(left<=0)return;left--;ctx.save();ctx.setTransform(sx,0,0,sy,0,0);ctx.globalAlpha=1;ctx.setLineDash([]);try{f();}catch(_){}ctx.restore();};
  const line=(pts,closed,dash)=>{ctx.lineCap='round';ctx.lineJoin='round';ctx.beginPath();pts.forEach((p,i)=>i?ctx.lineTo(+p[0],+p[1]):ctx.moveTo(+p[0],+p[1]));if(closed)ctx.closePath();
    ctx.setLineDash([]);ctx.strokeStyle='rgba(255,255,255,.9)';ctx.lineWidth=11;ctx.stroke();ctx.setLineDash(dash||[]);ctx.strokeStyle=INK;ctx.lineWidth=4;ctx.stroke();ctx.setLineDash([]);};
  const head=(a,b)=>{const t=Math.atan2(b[1]-a[1],b[0]-a[0]),l=24;line([[b[0]-l*Math.cos(t-.5),b[1]-l*Math.sin(t-.5)],b,[b[0]-l*Math.cos(t+.5),b[1]-l*Math.sin(t+.5)]]);};
  const pill=(x,y,t)=>{t=text(t);if(!t||!Number.isFinite(x)||!Number.isFinite(y))return;ctx.font='600 32px system-ui,-apple-system,"Segoe UI",sans-serif';ctx.textBaseline='middle';ctx.textAlign='left';
    const w=ctx.measureText(t).width+24,h=46,fit=(v,size,max)=>Math.min(max-size-4,Math.max(4,v-size/2)),hits=(x0,y0)=>placed.some(b=>x0<b[0]+b[2]+6&&b[0]<x0+w+6&&y0<b[1]+b[3]+6&&b[1]<y0+h+6);
    let bx=fit(x,w,W),by=fit(y,h,H);
    for(const [dx,dy] of [[0,0],[0,-52],[0,52],[0,-104],[0,104],[-w/2-20,0],[w/2+20,0]]){const cx=fit(x+dx,w,W),cy=fit(y+dy,h,H);if(!hits(cx,cy)){bx=cx;by=cy;break;}}
    placed.push([bx,by,w,h]);
    ctx.beginPath();if(ctx.roundRect)ctx.roundRect(bx,by,w,h,10);else ctx.rect(bx,by,w,h);ctx.fillStyle='rgba(255,255,255,.94)';ctx.fill();ctx.strokeStyle=INK;ctx.lineWidth=3;ctx.stroke();
    ctx.fillStyle=INK;ctx.fillText(t,bx+12,by+h/2+1);};
  const glyph=(kind,x,y)=>{placed.push([x-32,y-32,64,64]);ctx.beginPath();ctx.arc(x,y,30,0,Math.PI*2);ctx.fillStyle='#fff';ctx.fill();ctx.strokeStyle=INK;ctx.lineWidth=3;ctx.stroke();
    ctx.translate(x,y);ctx.fillStyle=INK;ctx.strokeStyle=INK;
    if(kind==='select'){ctx.beginPath();[[-8,-15],[-8,12],[-1,5],[5,16],[10,13],[4,3],[13,2]].forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));ctx.closePath();ctx.fill();return;}
    ctx.rotate(-Math.PI/4);
    if(kind==='brush'){ctx.fillRect(-20,-3,18,6);ctx.fillRect(-3,-6,6,12);ctx.beginPath();ctx.ellipse(11,0,9,7,0,0,Math.PI*2);ctx.fill();return;}
    ctx.fillRect(-18,-6,24,12);ctx.beginPath();ctx.moveTo(6,-6);ctx.lineTo(18,0);ctx.lineTo(6,6);ctx.closePath();ctx.fill();};
  return {
    /** A short label on the visual at (x, y). */
    label:(x,y,t)=>draw(()=>pill(+x,+y,t)),
    /** An arrow from a point to what it points at, with an optional label at its tail. */
    arrow:(from,to,t)=>{if(ok(from)&&ok(to))draw(()=>{const a=[+from[0],+from[1]],b=[+to[0],+to[1]];line([a,b]);head(a,b);pill(a[0],a[1],t);});},
    /** A measured length between two points (ticks at the ends) with its label in the middle. */
    dim:(a,b,t)=>{if(ok(a)&&ok(b))draw(()=>{const t0=Math.atan2(b[1]-a[1],b[0]-a[0])+Math.PI/2,d=12,n=[Math.cos(t0)*d,Math.sin(t0)*d];
      line([a,b]);line([[a[0]-n[0],a[1]-n[1]],[+a[0]+n[0],+a[1]+n[1]]]);line([[b[0]-n[0],b[1]-n[1]],[+b[0]+n[0],+b[1]+n[1]]]);const up=n[1]>0||(n[1]===0&&n[0]>0)?-1:1;pill((+a[0]+ +b[0])/2+n[0]*up*3.4,(+a[1]+ +b[1])/2+n[1]*up*3.4,t);});},
    /** A turn around a center from one direction to another (degrees, clockwise from →), with its label. */
    angle:(center,from,to,radius,t)=>{if(ok(center)&&Number.isFinite(+from)&&Number.isFinite(+to))draw(()=>{const r=Number.isFinite(+radius)&&+radius>10?+radius:70,c=[+center[0],+center[1]],a0=+from*Math.PI/180,a1=+to*Math.PI/180,pts=[];
      for(let k=0;k<=24;k++){const a=a0+(a1-a0)*k/24;pts.push([c[0]+Math.cos(a)*r,c[1]+Math.sin(a)*r]);}
      line([c,[c[0]+Math.cos(a0)*r,c[1]+Math.sin(a0)*r]],false,[8,10]);line(pts);head(pts[22],pts[24]);const m=(a0+a1)/2;pill(c[0]+Math.cos(m)*(r+64),c[1]+Math.sin(m)*(r+64),t);});},
    /** A dashed outline around a region (3+ points), labeled at its top. */
    region:(points,t)=>{if(Array.isArray(points)&&points.filter(ok).length>=3)draw(()=>{const pts=points.filter(ok);line(pts,true,[14,12]);const top=pts.reduce((m,p)=>+p[1]<+m[1]?p:m);pill(+top[0],+top[1]-30,t);});},
    /** A tool icon at (x, y): "pencil" (drawn by hand), "brush" (painted), "select" (moved / scaled), with an optional label beside it. */
    icon:(kind,x,y,t)=>{if(Number.isFinite(+x)&&Number.isFinite(+y))draw(()=>{glyph(kind,+x,+y);ctx.setTransform(sx,0,0,sy,0,0);if(text(t)){ctx.font='600 32px system-ui,-apple-system,"Segoe UI",sans-serif';pill(+x+40+(ctx.measureText(text(t)).width+24)/2,+y,t);}});},
  };
};
self.onmessage=async e=>{const {id,kind,code,input}=e.data;
  try{
    if(kind==='measure'){const f=new Function('strokes','input','"use strict";\\n'+code);self.postMessage({id,value:clone(f(clone(input.strokes),clone(input)))});return;}
    if(kind==='at'){const f=new Function('value','x','y','"use strict";\\n'+code),value=clone(input.value);self.postMessage({id,values:input.points.map(([x,y])=>{try{return clone(f(value,x,y));}catch(_){return null;}})});return;}
    if(kind==='thumbnail'){const canvas=new OffscreenCanvas(input.w,input.h),ctx=canvas.getContext('2d');ctx.scale(input.w/900,input.h/600);
      new Function('ctx','input','note','"use strict";\\n'+code)(ctx,clone(input.data),makeNote(ctx,input.w/900,input.h/600));
      const pixels=ctx.getImageData(0,0,input.w,input.h).data;let empty=true;for(let k=3;k<pixels.length;k+=4)if(pixels[k]){empty=false;break;}
      self.postMessage({id,empty,blob:await canvas.convertToBlob({type:'image/png'})});return;}
    self.postMessage({id,error:'Unknown request.'});
  }catch(error){self.postMessage({id,error:String(error&&error.message||error).slice(0,200)});}};
`;
export const MANIP_HOST = sandboxHost(MANIP_WORKER, 2500);
