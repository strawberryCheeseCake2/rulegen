import { useEffect, useRef, useState } from "react";
import type { StudioDeps } from "./deps";
import { generatedSchema } from "../lib/schema";
import { sceneProposalSchema } from "../lib/scene/validate";
import { liveSceneSource } from "../lib/scene/live";
import { sceneBindings, sceneValues } from "../lib/scene/values";
import * as ops from "../lib/scene/panel-ops";
import { annotatedResultImage } from "../lib/result-revisions";
import { addCycle, emptyTrace, nextIds, readCycle, siteOf, variableCatalog, type Analysis, type ExecTrace } from "../lib/execution/trace";
import { asks, clarifySchema, MANIP_HOST, paramValue, recordedAt, revisionRequest, summarize, type Choice, type Clarify, type ClarifyRule, type ManipTool } from "../lib/execution/manipulate";
import { CANVAS_H, CANVAS_W, paintedMask, placedPoints, strokeFeatures, type ManipStroke } from "../lib/execution/strokes";
import { sandboxRunner } from "../lib/execution/sandbox";
import { sceneEdits } from "./scene-actions";

// Direct manipulation in an Execution frame (see lib/execution/manipulate): once a concern is analyzed, the user can
// ask for tools that make it clear; AI lists the rules the concern could follow and, when the code has to change and
// more than one would do, asks which first (with thumbnails of their outcomes), then makes the tools for that rule;
// what the user shows with them is measured into the execution variables it is about. A param read as is takes the
// shown value at once; other changes are made to the code when the user applies the demonstration.

export type Measured = { value?: unknown; error?: string; applied?: boolean };
export type ManipView = {
  frameId: string;
  concern: string;
  /** The frame's picture when the concern was sent (thumbnails are drawn over it). */
  picture: string;
  image: string;
  marks: { x: number; y: number }[][];
  analysis: Analysis;
  /** The cycles the concern was asked about (the values before any change). */
  cycleIds: number[];
  /** The rule question, kept while tools are made for the rule picked. */
  asked: Clarify | null;
  choice: Choice | null;
  /** The tools and targets (null while a rule is to be picked or they are being made). */
  clarify: Clarify | null;
  /** Each rule's thumbnail (a data URL; none when it could not be drawn) and why not, if so. */
  thumbnails: Record<string, { src: string; note: string }>;
  strokes: ManipStroke[];
  tool: ManipTool | null;
  selected: string | null;
  measured: Record<string, Measured>;
  /** Cycles recorded from this id on come after a change made from the demonstration. */
  changedFrom: number | null;
  /** A temporary fork of the inspected frame (its sketch and result copied) the demonstration is tried on, if any. */
  fork: string | null;
  /** The fork's own recording, and from which of its cycles on they come after a change tried there. */
  forkTrace: ExecTrace;
  forkChangedFrom: number | null;
  busy: boolean;
  status: string;
};
export type ManipStart = { frameId: string; concern: string; picture: string; image: string; marks: { x: number; y: number }[][]; analysis: Analysis; cycleIds: number[] };
/** A target row: the variable's value recorded before, what the strokes show, and recorded after a change. */
export type TargetRow = { id: string; name: string; where: string; param: boolean; meaning: string; before: string; shown: string; after: string; error: string; applied: boolean };

const THUMB = { w: 360, h: 240 };
const dataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob); });
let runner: ReturnType<typeof sandboxRunner> | null = null;
const sandbox = () => runner ??= sandboxRunner(MANIP_HOST);

type Execution = { view: { frameId: string; trace: ExecTrace; framed: boolean; analysis: Analysis | null } | null; follow: () => void };

export function useManipulation(deps: StudioDeps, execution: Execution) {
  const [view, setView] = useState<ManipView | null>(null);
  const viewRef = useRef(view); viewRef.current = view;
  const traceRef = useRef(execution.view?.trace); traceRef.current = execution.view?.trace;
  const patch = (frameId: string, change: Partial<ManipView> | ((current: ManipView) => Partial<ManipView>)) =>
    setView(current => current && current.frameId === frameId ? { ...current, ...(typeof change === "function" ? change(current) : change) } : current);

  // The demonstration ends with the inspection it belongs to.
  const inspected = execution.view?.framed && execution.view.analysis ? execution.view.frameId : null;
  useEffect(() => { if (view && view.frameId !== inspected) { dropFork(view); setView(null); } }, [inspected]);

  /** Ask for the tools (or the rule question first) for the concern, with the rule picked if any. */
  async function request(frameId: string, choice: Choice | null) {
    const current = viewRef.current, trace = traceRef.current;
    if (!current || current.frameId !== frameId || !trace) return;
    const panel = deps.panel(frameId);
    if (!panel.generated) return;
    patch(frameId, { busy: true, status: choice ? "Making the tools for the rule you picked…" : "Designing the tools to show what you mean…", clarify: null, choice, strokes: [], selected: null, measured: {}, tool: null });
    try {
      const nodeIds = panel.scene.nodes.map(node => node.id).slice(0, 64);
      const result = clarifySchema.parse(await deps.request("trace-clarify", { scene: panel.scene, previous: liveSceneSource(panel.generated, panel.scene), image: current.image,
        trace: { concern: current.concern, nodeIds, cycles: trace.cycles.length, sites: variableCatalog(trace).slice(-200), marks: current.marks, analysis: current.analysis, choice } }, frameId));
      if (viewRef.current?.frameId !== frameId) return;
      if (asks(result)) {
        patch(frameId, { asked: result, busy: false, status: "" });
        void drawThumbnails(frameId, result.rules);
      } else {
        const tool = result.tools.find(item => item.kind !== "select")?.kind ?? null;
        patch(frameId, { clarify: result, tool, busy: false, status: "" });
      }
    } catch (error) {
      patch(frameId, { busy: false, status: error instanceof Error ? error.message : "Could not make the tools." });
    }
  }
  async function drawThumbnails(frameId: string, options: ClarifyRule[]) {
    const data = { width: CANVAS_W, height: CANVAS_H, sites: recordedSites(viewRef.current) };
    for (const option of options) {
      if (!option.thumbnail) continue;
      const reply = await sandbox().run({ kind: "thumbnail", code: option.thumbnail, input: { ...THUMB, data } });
      const thumbnail = reply.blob instanceof Blob
        ? { src: reply.empty ? "" : await dataUrl(reply.blob), note: reply.empty ? "The preview drew nothing from the recorded values." : "" }
        : { src: "", note: `The preview could not be drawn: ${String(reply.error ?? "no image")}` };
      // The view may have moved on meanwhile (another concern or frame): then the image is not kept.
      if (viewRef.current?.frameId !== frameId || viewRef.current.asked?.rules !== options) return;
      setView(current => current && current.frameId === frameId ? { ...current, thumbnails: { ...current.thumbnails, [option.id]: thumbnail } } : current);
    }
  }

  /** What the thumbnails draw the brush from: every variable at each visit of the concern's sites when it was asked
   *  (the recorded previews as they are, not cut into text). */
  function recordedSites(current: ManipView | null) {
    const trace = traceRef.current, out: Record<string, Record<string, unknown>[]> = {};
    if (!current || !trace) return out;
    const asked = new Set(current.cycleIds);
    for (const site of current.analysis.sites) {
      const cycle = [...trace.cycles].reverse().find(item => asked.has(item.id) && item.steps.some(step => siteOf(step) === site.site));
      out[site.site] = (cycle?.steps.filter(step => siteOf(step) === site.site) ?? []).slice(0, 200).map(step => step.variables);
    }
    return out;
  }
  // What the strokes show, measured for every target whenever they change; a param target takes it at once.
  const strokes = view?.strokes, clarify = view?.clarify;
  useEffect(() => {
    const current = viewRef.current;
    if (!current || !clarify?.targets.length) return;
    const frameId = current.frameId;
    const timer = setTimeout(async () => {
      const features = current.strokes.map(strokeFeatures), mask = paintedMask(current.strokes), trace = traceRef.current;
      const measured: Record<string, Measured> = {};
      for (const target of clarify.targets) {
        const recorded = trace ? recordedAt(trace, target.site, target.path) : [];
        const newest = trace?.cycles.flatMap(cycle => cycle.steps).filter(step => siteOf(step) === target.site).at(-1);
        const reply = await sandbox().run({ kind: "measure", code: target.measure, input: { strokes: features, mask, recorded: recorded.slice(0, 64), variables: newest?.variables ?? {}, rule: current.choice ? `${current.choice.rule} (${current.choice.logic})` : "", width: CANVAS_W, height: CANVAS_H } });
        measured[target.id] = reply.error ? { error: String(reply.error) } : { value: reply.value ?? undefined };
      }
      if (viewRef.current?.frameId !== frameId || viewRef.current.strokes !== current.strokes) return;
      // Params read as is take what was shown (only when it differs from what they hold), on the fork when there is one.
      const into = current.fork ?? frameId, panel = deps.panel(into), bindings = sceneBindings(panel.scene), values = sceneValues(panel.scene);
      let changed = false;
      for (const target of clarify.targets) {
        const binding = target.param && bindings.find(item => item.key === target.param), result = measured[target.id];
        if (!binding || result.value === undefined || result.value === null) continue;
        const node = panel.scene.nodes.find(item => item.id === binding.nodeId);
        const param = node?.constraints.flatMap(item => item.params).find(item => item.id === binding.path[0]);
        const value = param && paramValue(result.value, param.value.type === "select" ? { type: "select", options: param.value.options } : { type: param.value.type });
        if (value === undefined) { result.error = "This value does not fit the param."; continue; }
        result.applied = true;
        if (values[target.param] === value) continue;
        sceneEdits(deps, into).scalar(binding.nodeId, binding.path[0], binding.path.slice(1), value);
        changed = true;
      }
      patch(frameId, change => ({ measured, ...(!changed ? {} : change.fork ? (change.forkChangedFrom === null ? { forkChangedFrom: nextIds(change.forkTrace).cycle } : {})
        : change.changedFrom === null && trace ? { changedFrom: nextIds(trace).cycle } : {}) }));
      if (changed && !current.fork) execution.follow();
    }, 160);
    return () => clearTimeout(timer);
  }, [strokes, clarify]);

  /** Change the brush's code from the demonstration (its rule, tools and the values shown), in the inspected frame or
   *  in its fork (`into`). */
  async function change(rows: TargetRow[], into: string) {
    const current = viewRef.current;
    if (!current?.clarify) return;
    const frameId = current.frameId, panel = deps.panel(into);
    if (!panel?.generated) return;
    const annotations = current.strokes.map(stroke => ({ id: stroke.id, points: placedPoints(stroke).slice(0, 600).map(point => ({ x: Math.min(1, Math.max(0, point.x / CANVAS_W)), y: Math.min(1, Math.max(0, point.y / CANVAS_H)) })) })).filter(item => item.points.length >= 2);
    if (!annotations.length) { patch(frameId, { status: "Show it on the picture with the tools first." }); return; }
    const byId = new Map(rows.map(row => [row.id, row]));
    const instruction = revisionRequest({ concern: current.concern, summary: current.clarify.summary, choice: current.choice, tools: current.clarify.tools,
      targets: current.clarify.targets.map(target => ({ ...target, before: byId.get(target.id)?.before ?? "—", shown: byId.get(target.id)?.shown ?? "—" })) });
    const onFork = into !== frameId;
    await deps.task(onFork ? "Trying the change on the fork…" : "Changing the brush from the demonstration…", async () => {
      const previous = liveSceneSource(panel.generated!, panel.scene);
      const image = await annotatedResultImage((await deps.capture(into, true)).image, annotations);
      const proposal = sceneProposalSchema.parse(await deps.request("revision", { image, annotations, scene: panel.scene, previous, instruction }, into));
      const result = generatedSchema.parse(await deps.request("code", { scene: proposal.scene, previous, image, annotations, revisionSummary: proposal.summary, instruction }, into));
      await deps.request("prepare", { code: result.code }, into);
      if (onFork && viewRef.current?.fork !== into) return;
      const trace = traceRef.current;
      deps.updatePanel(into, latest => ({ ...ops.commitScene(latest, proposal.scene), generated: result, codeDraft: result.code, executable: "", preparedCode: "", runtimeError: "", runtimeStates: {}, dirtyNodeIds: [], hovered: null }));
      if (onFork) patch(frameId, change => ({ forkChangedFrom: nextIds(change.forkTrace).cycle, status: "Tried on the fork. Keep it to change the original, or discard it." }));
      else {
        deps.refreshBrushCode?.(frameId, result.code);
        patch(frameId, change => ({ changedFrom: change.changedFrom ?? (trace ? nextIds(trace).cycle : null), status: "Changed. The values after the change appear as the brush runs." }));
        execution.follow();
      }
    }, into);
  }
  async function run(work: () => Promise<void>, label: string) {
    const current = viewRef.current;
    if (!current || current.busy) return;
    const frameId = current.frameId;
    patch(frameId, { busy: true, status: label });
    try { await work(); }
    catch (error) { patch(frameId, { status: error instanceof Error ? error.message : "It did not work." }); }
    finally { patch(frameId, change => ({ busy: false, status: change.status === label ? "" : change.status })); }
  }
  /** A fork of the inspected frame (sketch, scene, result and its input), placed beside it; made once. */
  async function makeFork() {
    const current = viewRef.current!;
    if (current.fork && deps.panel(current.fork).generated) return current.fork;
    const id = deps.fork?.(current.frameId) ?? null;
    if (!id) throw new Error("Could not make a fork of this frame (too many frames?).");
    patch(current.frameId, { fork: id, forkTrace: emptyTrace(), forkChangedFrom: null });
    viewRef.current = { ...viewRef.current!, fork: id };
    // Its result is prepared and drawn before it is changed.
    for (let i = 0; i < 100 && !deps.preview(id); i++) await new Promise(resolve => setTimeout(resolve, 100));
    return id;
  }
  const dropFork = (current: ManipView | null) => { if (current?.fork) deps.removeFrame?.(current.fork); };
  // Cycles the fork records, taken in at most every 200 ms.
  const forkPending = useRef<{ fork: string; raw: unknown[] }>({ fork: "", raw: [] });
  const forkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (forkTimer.current) clearTimeout(forkTimer.current); }, []);

  const rows: TargetRow[] = !view?.clarify || !execution.view ? [] : view.clarify.targets.map(target => {
    const trace = execution.view!.trace, asked = new Set(view.cycleIds), measured = view.measured[target.id];
    return {
      id: target.id, name: target.name, where: target.site ? `${target.site} ${target.path}` : "new variable", param: Boolean(target.param), meaning: target.meaning,
      before: target.site ? summarize(recordedAt(trace, target.site, target.path, id => asked.has(id))) : "—",
      shown: measured?.value === undefined ? "—" : summarize(Array.isArray(measured.value) && measured.value.every(item => typeof item === "number") ? measured.value : [measured.value]),
      after: !target.site ? "" : view.fork ? (view.forkChangedFrom === null ? "" : summarize(recordedAt(view.forkTrace, target.site, target.path, id => id >= view.forkChangedFrom!)))
        : view.changedFrom === null ? "" : summarize(recordedAt(trace, target.site, target.path, id => id >= view.changedFrom!)),
      error: measured?.error ?? "", applied: Boolean(measured?.applied),
    };
  });

  return {
    view, rows,
    /** A concern was analyzed: the tools are made when the user asks for them (begin). */
    start(info: ManipStart) {
      dropFork(viewRef.current);
      const next: ManipView = { ...info, asked: null, choice: null, clarify: null, thumbnails: {}, strokes: [], tool: null, selected: null, measured: {}, changedFrom: null, fork: null, forkTrace: emptyTrace(), forkChangedFrom: null, busy: false, status: "" };
      viewRef.current = next; setView(next);
    },
    begin() { const current = viewRef.current; if (current && !current.busy) void request(current.frameId, null); },
    choose(option: ClarifyRule) {
      const current = viewRef.current;
      if (!current?.asked || current.busy) return;
      void request(current.frameId, { question: current.asked.question, rule: option.rule, logic: option.logic, detail: option.detail, tools: option.tools.map(tool => tool.kind) });
    },
    /** Back to the rule question (the tools made for the rule picked are dropped). */
    rechoose: () => setView(current => current && current.asked ? { ...current, choice: null, clarify: null, strokes: [], selected: null, measured: {}, tool: null } : current),
    retry: () => { const current = viewRef.current; if (current && !current.busy) void request(current.frameId, current.choice); },
    /** Change the inspected frame's brush from the demonstration. */
    apply: () => run(() => change(rows, viewRef.current!.frameId), "Changing the brush from what you showed…"),
    /** Try the change on a temporary fork of the inspected frame (made the first time). */
    tryOnFork: () => run(async () => change(rows, await makeFork()), "Making a fork and trying the change there…"),
    /** The fork's scene and result become the inspected frame's; the fork goes. */
    keepFork() {
      const current = viewRef.current, fork = current?.fork ? deps.panel(current.fork) : undefined;
      if (!current || current.busy || !fork?.generated) return;
      const trace = traceRef.current, generated = fork.generated;
      deps.updatePanel(current.frameId, latest => ({ ...ops.commitScene(latest, fork.scene), generated, codeDraft: generated.code, executable: "", preparedCode: "", runtimeError: "", runtimeStates: {}, dirtyNodeIds: [], hovered: null }));
      deps.refreshBrushCode?.(current.frameId, generated.code);
      dropFork(current);
      patch(current.frameId, change => ({ fork: null, forkTrace: emptyTrace(), forkChangedFrom: null, changedFrom: change.changedFrom ?? (trace ? nextIds(trace).cycle : null), status: "Kept: the original now has the fork's change." }));
      execution.follow();
    },
    discardFork() {
      const current = viewRef.current;
      if (!current?.fork || current.busy) return;
      dropFork(current);
      patch(current.frameId, { fork: null, forkTrace: emptyTrace(), forkChangedFrom: null, status: "" });
    },
    /** The fork frame was deleted on the board. */
    forkGone: (id: string) => setView(current => current?.fork === id ? { ...current, fork: null, forkTrace: emptyTrace(), forkChangedFrom: null } : current),
    /** A cycle the fork recorded. */
    onForkCycle(raw: unknown) {
      const fork = viewRef.current?.fork;
      if (!fork) return;
      if (forkPending.current.fork !== fork) forkPending.current = { fork, raw: [] };
      forkPending.current.raw.push(raw);
      if (forkTimer.current) return;
      forkTimer.current = setTimeout(() => {
        forkTimer.current = null;
        const { fork: from, raw: items } = forkPending.current;
        forkPending.current = { fork: from, raw: [] };
        setView(current => {
          if (!current || current.fork !== from) return current;
          let trace = current.forkTrace;
          for (const item of items) { const ids = nextIds(trace), cycle = readCycle(item, ids.cycle, ids.step); if (cycle && cycle.steps.length) trace = addCycle(trace, cycle); }
          return { ...current, forkTrace: trace };
        });
      }, 200);
    },
    setTool: (tool: ManipTool) => setView(current => current ? { ...current, tool, selected: tool === "select" ? current.selected : null } : current),
    add: (stroke: ManipStroke) => setView(current => current ? { ...current, strokes: [...current.strokes, stroke].slice(-40) } : current),
    change: (stroke: ManipStroke) => setView(current => current ? { ...current, strokes: current.strokes.map(item => item.id === stroke.id ? stroke : item) } : current),
    select: (id: string | null) => setView(current => current ? { ...current, selected: id } : current),
    remove: () => setView(current => current && current.selected ? { ...current, strokes: current.strokes.filter(item => item.id !== current.selected), selected: null } : current),
    clear: () => setView(current => current ? { ...current, strokes: [], selected: null, measured: {} } : current),
    close: () => { dropFork(viewRef.current); setView(null); },
  };
}
