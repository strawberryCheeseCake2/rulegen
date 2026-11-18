import { parse } from "@babel/parser";
import { z } from "zod";
import { formatValue, isShown, pathLabel, readPath, siteOf, type ExecStep } from "./trace";

// Overlays: the recorded variables a concern selected, shown on the picture where they belong. AI writes, for each
// selected site, the body of a function (input, mark) that places them: for every object or region concerned,
// mark(locate, fields, guides) with a locator computing the place from recorded values (read(path)), the paths of
// the variables to show there, and optional guides (geometry those values stand for: a reach, a path, a vector).
// The app writes the labels (actual names and recorded values) and places them next to their place without
// overlapping; AI never writes text. The code runs in a sandboxed worker, per step, against that step's record.

export const CANVAS = { width: 900, height: 600 };
export const MAX_MARKS = 8, MAX_MARK_FIELDS = 6, MAX_GUIDES = 4, MAX_GUIDE_SHAPES = 16, MAX_GUIDE_POINTS = 96;
export const GUIDE_TYPES = ["point", "polyline", "outline", "area", "vector", "dimension"] as const;
export type GuideType = (typeof GUIDE_TYPES)[number];
export type Guide = { type: GuideType; points: [number, number][]; color?: string; field: number };
export type Mark = { x: number; y: number; fields: string[]; guides: Guide[] };
export type Label = { path: string; name: string; value: string };
export type ResolvedMark = Mark & { labels: Label[] };

export const overlayPlanSchema = z.object({
  plans: z.array(z.object({
    site: z.string().max(200),
    /** The body of a synchronous function (input, mark); empty when nothing can be placed. */
    code: z.string().max(12000),
    /** Why nothing is shown for this site (the user's language), when code is empty. */
    skipReason: z.string().max(300),
    /** Also draw the guides of the earlier visits of the site in the same cycle (up to the step looked at). */
    accumulate: z.boolean(),
  })).max(8),
});
export type OverlayPlan = z.infer<typeof overlayPlanSchema>;
export type SitePlan = OverlayPlan["plans"][number];

/** The plans kept: one per site asked, code that parses and calls mark. */
export function checkedPlans(plan: OverlayPlan, sites: string[]): Record<string, SitePlan> {
  const out: Record<string, SitePlan> = {};
  for (const item of plan.plans) {
    if (!sites.includes(item.site) || out[item.site]) continue;
    if (!item.code.trim()) { out[item.site] = { ...item, code: "", accumulate: false }; continue; }
    try {
      const program = parse(`function overlay(input, mark) {\n${item.code}\n}`, { sourceType: "script" });
      if (!JSON.stringify(program).includes('"name":"mark"')) continue;
      out[item.site] = item;
    } catch { /* not code: left out */ }
  }
  return out;
}

/** What one run of a site's code gets: the step looked at and the earlier steps of its cycle it may read. */
export type OverlayInput = { step: StepRecord; context: StepRecord[]; width: number; height: number };
export type StepRecord = Pick<ExecStep, "id" | "kind" | "nodeId" | "key" | "state" | "property" | "event" | "label" | "variables" | "visit">;
export const stepRecord = (step: ExecStep): StepRecord => ({ id: step.id, kind: step.kind, nodeId: step.nodeId, key: step.key, state: step.state, property: step.property, event: step.event, label: step.label, variables: step.variables, visit: step.visit });
/** The earlier steps of the cycle a site's code may read (the newest of each other site, at most `limit`). */
export function overlayContext(steps: ExecStep[], step: ExecStep, limit = 12): StepRecord[] {
  const seen = new Set<string>(), out: StepRecord[] = [];
  for (let i = steps.length - 1; i >= 0 && out.length < limit; i--) {
    const other = steps[i];
    if (other.cycle !== step.cycle || other.id >= step.id) continue;
    const site = siteOf(other) + "|" + other.key;
    if (seen.has(site)) continue;
    seen.add(site); out.push(stepRecord(other));
  }
  return out;
}
/** The steps a site's guides are drawn for: the step, and with `accumulate` the earlier visits of its site in its cycle. */
export function occurrences(steps: ExecStep[], step: ExecStep, accumulate: boolean): ExecStep[] {
  if (!accumulate) return [step];
  const site = siteOf(step);
  return [step, ...steps.filter(other => other.cycle === step.cycle && other.id < step.id && siteOf(other) === site).reverse()];
}
/** Marks with their labels: each field's name and the value recorded at the step. Only fields the analysis chose to
 *  show at the field's site are labeled (values used to place or identify an item are not). */
export function resolveMarks(marks: Mark[], step: ExecStep, context: ExecStep[], shown: Record<string, string[]>): ResolvedMark[] {
  return marks.map(mark => ({ ...mark, labels: mark.fields.flatMap(path => {
    const [main, at] = path.split("#"), source = at ? context.find(item => String(item.id) === at) ?? step : step;
    return isShown(shown[siteOf(source)] ?? [], main) ? [{ path, name: pathLabel(main), value: formatValue(readPath(source, main)) }] : [];
  }) }));
}

// The worker: runs a site's code for each input, with mark() and read() as described above. It is created inside a
// sandboxed iframe (no access to the app), and a run that does not finish is stopped.
export const OVERLAY_WORKER = `
const MAX_MARKS=${MAX_MARKS},MAX_FIELDS=${MAX_MARK_FIELDS},MAX_GUIDES=${MAX_GUIDES},MAX_SHAPES=${MAX_GUIDE_SHAPES},MAX_POINTS=${MAX_GUIDE_POINTS},TYPES=${JSON.stringify(GUIDE_TYPES)};
function readFrom(step,path){if(!step||typeof path!=='string')return undefined;if(!path.startsWith('@'))return step[path];const parts=path.slice(1).split('.');let v=step.variables?step.variables[parts[0]]:undefined;for(const part of parts.slice(1)){if(v===null||typeof v!=='object')return undefined;v=v[part];}return v;}
function cleanGuide(g,w,h){if(!g||typeof g!=='object'||!TYPES.includes(g.type)||!Array.isArray(g.points))return null;
  const points=g.points.slice(0,MAX_POINTS).map(q=>Array.isArray(q)?[Number(q[0]),Number(q[1])]:null).filter(q=>q&&Number.isFinite(q[0])&&Number.isFinite(q[1]));
  const need={point:1,polyline:2,outline:3,area:3,vector:2,dimension:2}[g.type];if(points.length<need)return null;
  const out={type:g.type,points:g.type==='vector'||g.type==='dimension'?points.slice(0,2):g.type==='point'?points.slice(0,1):points};
  if(typeof g.color==='string'&&/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(g.color))out.color=g.color;return out;}
function runOne(draw,input){
  const steps=new Map([[input.step.id,input.step],...input.context.map(s=>[s.id,s])]);const marks=[];let tries=0;
  const reader=used=>(path,id)=>{const v=readFrom(steps.get(id===undefined?input.step.id:id),path);if(v===undefined||v===null)return undefined;used.n++;return typeof v==='object'?JSON.parse(JSON.stringify(v)):v;};
  function mark(locate,fields,guides){
    if(++tries>200||marks.length>=MAX_MARKS||typeof locate!=='function'||!Array.isArray(fields))return false;
    const kept=[],index=new Map();
    fields.slice(0,MAX_FIELDS).forEach((f,i)=>{let path=f,id;if(Array.isArray(f)){path=f[0];id=f[1];}if(typeof path!=='string')return;if(readFrom(steps.get(id===undefined?input.step.id:id),path)===undefined)return;index.set(i,kept.length);kept.push(id===undefined?path:path+'#'+id);});
    if(!kept.length)return false;
    const used={n:0},read=reader(used);let at;try{at=locate(read);}catch(e){return false;}
    if(!used.n||!Array.isArray(at))return false;const x=Number(at[0]),y=Number(at[1]);
    if(!Number.isFinite(x)||!Number.isFinite(y)||x<-20||y<-20||x>input.width+20||y>input.height+20)return false;
    const shapes=[];
    for(const g of Array.isArray(guides)?guides.slice(0,MAX_GUIDES):[]){if(!Array.isArray(g)||typeof g[1]!=='function')continue;const field=index.get(g[0]);if(field===undefined)continue;
      try{const [p,id]=kept[field].split('#');const value=read(p,id===undefined?undefined:Number(id));if(value===undefined)continue;const made=g[1](value,read);
        for(const item of Array.isArray(made)?made:[made]){const c=cleanGuide(item,input.width,input.height);if(c){c.field=field;shapes.push(c);}if(shapes.length>=MAX_SHAPES)break;}}catch(e){}
      if(shapes.length>=MAX_SHAPES)break;}
    marks.push({x,y,fields:kept,guides:shapes});return true;}
  const result=draw(JSON.parse(JSON.stringify(input)),mark);return result===false?[]:marks;}
self.onmessage=e=>{const {id,code,inputs}=e.data;let draw;
  try{draw=new Function('input','mark','"use strict";\\n'+code);}catch(error){self.postMessage({id,error:'The overlay code does not run.'});return;}
  self.postMessage({id,results:inputs.map(input=>{try{return {marks:runOne(draw,input)};}catch(error){return {error:String(error&&error.message||error).slice(0,200)};}})});};
`;
/** A sandboxed page that hosts a worker (its source) and relays messages to it through a port, each reply to its
 *  request (by id); a request that takes longer than `timeout` ms stops the worker (every pending request fails) and a
 *  new one starts. The worker inherits the page's CSP, so 'unsafe-eval' is needed for it to compile AI-written code
 *  (new Function); the page has no network (default-src 'none'). */
export const sandboxHost = (source: string, timeout = 1500) => `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; worker-src blob:"></head><body><script>
const source=${JSON.stringify(source).replace(/</g, "\\u003c")};let worker=null,port=null;const pending=new Map();
const start=()=>{worker=new Worker(URL.createObjectURL(new Blob([source],{type:'text/javascript'})));
  worker.onmessage=r=>{const timer=pending.get(r.data.id);if(timer===undefined)return;clearTimeout(timer);pending.delete(r.data.id);port.postMessage(r.data);};};start();
addEventListener('message',e=>{const p=e.ports&&e.ports[0];if(e.data!=='overlay-port'||!p)return;port=p;
  port.onmessage=m=>{const {id}=m.data;
    pending.set(id,setTimeout(()=>{worker.terminate();for(const [other,timer] of pending){clearTimeout(timer);port.postMessage({id:other,error:'The code took too long.'});}pending.clear();start();},${timeout}));
    worker.postMessage(m.data);};});
</script></body></html>`;
export const OVERLAY_HOST = sandboxHost(OVERLAY_WORKER);

// Label placement: each label goes next to its mark without overlapping the others, as near as it can (on the
// right, left, above, below, or pushed beside a label already placed); if one cannot be placed so, all are packed
// in a grid over the picture instead (each scrolls inside its cell).
export type Box = { x: number; y: number; width: number; height: number };
const GAP = 6, OFFSET = 10;
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const overlap = (a: Box, b: Box) => a.x < b.x + b.width + GAP && b.x < a.x + a.width + GAP && a.y < b.y + b.height + GAP && b.y < a.y + a.height + GAP;
/** The point of a box nearest to its anchor (where its leader line ends). */
export const nearestEdge = (anchor: { x: number; y: number }, box: Box): [number, number] => [clamp(anchor.x, box.x, box.x + box.width), clamp(anchor.y, box.y, box.y + box.height)];
export function placeLabels(labels: { anchor: { x: number; y: number }; width: number; height: number }[], width: number, height: number): Box[] | null {
  const placed: Box[] = [];
  for (const { anchor, width: w, height: h } of labels) {
    const maxX = width - w - GAP, maxY = height - h - GAP;
    if (maxX < GAP || maxY < GAP) return null;
    const xs = [anchor.x + OFFSET, anchor.x - w - OFFSET, anchor.x - w / 2], ys = [anchor.y - h / 2, anchor.y - h - OFFSET, anchor.y + OFFSET];
    for (const other of placed) { xs.push(other.x + other.width + GAP, other.x - w - GAP); ys.push(other.y + other.height + GAP, other.y - h - GAP); }
    let best: Box | null = null, bestDistance = Infinity;
    for (const left of xs) for (const top of ys) {
      const box = { x: clamp(left, GAP, maxX), y: clamp(top, GAP, maxY), width: w, height: h };
      if (placed.some(other => overlap(box, other))) continue;
      const [ex, ey] = nearestEdge(anchor, box), distance = Math.hypot(anchor.x - ex, anchor.y - ey);
      // A label never covers its own mark.
      if (distance < OFFSET - 0.5 || distance >= bestDistance) continue;
      best = box; bestDistance = distance;
    }
    if (!best) return null;
    placed.push(best);
  }
  return placed;
}
export function packLabels(anchors: { x: number; y: number }[], width: number, height: number): Box[] {
  const columns = Math.min(anchors.length, width >= 260 ? 2 : 1) || 1, rows = Math.ceil(anchors.length / columns) || 1;
  const cellWidth = (width - GAP * (columns + 1)) / columns, cellHeight = (height - GAP * (rows + 1)) / rows;
  const order = anchors.map((anchor, index) => ({ anchor, index })).sort((a, b) => a.anchor.y - b.anchor.y || a.anchor.x - b.anchor.x);
  const boxes: Box[] = [];
  order.forEach(({ index }, k) => { const row = Math.floor(k / columns), column = k % columns; boxes[index] = { x: GAP + column * (cellWidth + GAP), y: GAP + row * (cellHeight + GAP), width: cellWidth, height: cellHeight }; });
  return boxes;
}
const PALETTE = ["#0f9d74", "#c27c0e", "#2f6fd6", "#c2417f", "#6f8f12", "#7a52d1", "#d0622c", "#118a9c"];
/** One color per field path, in order of appearance (a guide's own color first when it gives one). */
export function fieldColors(marks: ResolvedMark[]) {
  const colors = new Map<string, string>();
  for (const mark of marks) for (const guide of mark.guides) { const path = mark.fields[guide.field]; if (guide.color && !colors.has(path)) colors.set(path, guide.color.slice(0, 7)); }
  let next = 0;
  for (const mark of marks) for (const path of mark.fields) if (!colors.has(path)) colors.set(path, PALETTE[next++ % PALETTE.length]);
  return colors;
}
