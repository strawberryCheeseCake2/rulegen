import { useEffect, useMemo, useRef, useState } from "react";
import type { StudioDeps } from "./deps";
import { generatedSchema } from "../lib/schema";
import { sceneProposalSchema } from "../lib/scene/validate";
import { liveSceneSource } from "../lib/scene/live";
import { sceneBindings, sceneValues } from "../lib/scene/values";
import * as ops from "../lib/scene/panel-ops";
import { annotatedResultImage } from "../lib/result-revisions";
import { addCycle, analysisSchema, emptyTrace, matchSteps, nextIds, readCycle, shownPaths, siteOf, variableCatalog, type Analysis, type ExecStep, type ExecTrace } from "../lib/execution/trace";
import type { SitePlan } from "../lib/execution/overlay";
import { asks, clarifySchema, demoKey, everyItem, liveConcern, liveRequest, liveTargets, MANIP_HOST, paramValue, pinsItem, recordedAt, revisionRequest, summarize, type Choice, type Clarify, type ClarifyRule, type ManipTool } from "../lib/execution/manipulate";
import { CANVAS_H, CANVAS_W, paintedMask, placedPoints, strokeFeatures, strokeSpots, toggleProbe, type ManipStroke, type Point } from "../lib/execution/strokes";
import { sandboxRunner } from "../lib/execution/sandbox";
import { sceneEdits } from "./scene-actions";
import { markBrushes } from "../lib/brushes";
import { demoValues, MAX_KEPT_SETS, MAX_KEPT_STROKES, type KeptToolSet } from "../lib/execution/kept-tools";
import { placeAnalysis } from "./use-execution";
import type { GeneralizeStart } from "./use-generalize";

// Direct manipulation in an Execution frame (see lib/execution/manipulate): once a concern is analyzed, the user can
// ask for tools that make it clear; AI lists the rules the concern could follow and, when the code has to change and
// more than one would do, asks which first (with thumbnails of their outcomes), then makes the tools for that rule;
// what the user shows with them is measured into the execution variables it is about. A param read as is takes the
// shown value at once; other changes are made to the code when the user applies the demonstration.
// Two modes: with execution stepping, the tools come after the concern's steps are inspected in an Execution frame
// (and are made when asked for). Without it (the default), a temporary fork of the frame is made at once with the
// tools: once the fork's code follows the rule, what the tools show goes into it live (m.demo values, params), and the
// fork shows on its picture only the execution values the tools set.

/** What the strokes show for a target: the value, and the parts of it at the spots drawn (when it varies over the picture). */
export type Measured = { value?: unknown; at?: unknown[]; error?: string; applied?: boolean };
export type ManipMode = "stepping" | "fork";
export type LayerTool = ManipTool | "inspect";
type Panel = ReturnType<StudioDeps["panel"]>;
/** A picked rule's identity: the same rule picked again is the same key. */
const ruleKey = (choice: Pick<Choice, "rule" | "logic">) => `${choice.rule}\n${choice.logic}`;
export type ManipView = {
  frameId: string;
  /** stepping: tools below the Execution frame; fork: tools on a temporary fork that changes live. */
  mode: ManipMode;
  /** Fork mode without tools: the fork's code was changed from the concern at once (kept or discarded as it is). */
  direct?: boolean;
  concern: string;
  /** The frame's picture when the concern was sent (thumbnails are drawn over it). */
  picture: string;
  image: string;
  marks: { x: number; y: number }[][];
  analysis: Analysis | null;
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
  /** The brush / pencil marks are hidden on the picture for now (what they show still applies). */
  marksHidden?: boolean;
  /** A tool that changes what is shown, or "inspect": clicking spots to see the execution values there (fork mode). */
  tool: LayerTool | null;
  /** Fork mode: spots clicked with the inspect tool; the fork's overlay shows the values of the items there. */
  probes: Point[];
  selected: string | null;
  measured: Record<string, Measured>;
  /** Cycles recorded from this id on come after a change made from the demonstration. */
  changedFrom: number | null;
  /** A temporary fork of the inspected frame (its sketch and result copied) the demonstration is tried on, if any. */
  fork: string | null;
  /** The fork's own recording, and from which of its cycles on they come after a change tried there. */
  forkTrace: ExecTrace;
  forkChangedFrom: number | null;
  /** Fork mode: the values the tools show, as host values the fork's code reads with m.demo (by demoKey). */
  demo: Record<string, unknown>;
  /** Fork mode: whether the fork's code follows the rule yet (making it, ready, or it failed). */
  live: "" | "making" | "ready" | "failed";
  /** Fork mode: the fork's own inspection, of the values the tools set only (sites, and how they are placed on its picture). */
  forkAnalysis: Analysis | null;
  forkPlans: Record<string, SitePlan>;
  forkInspect: "" | "busy" | "done" | "failed";
  /** Fork mode: why an overlay on the fork could not be drawn, by site. */
  overlayErrors: Record<string, string>;
  busy: boolean;
  status: string;
};
/** What of a fork-mode session is kept across a page reload (the fork frame and its code are kept with the project). */
export type ManipSaved = Pick<ManipView, "frameId" | "fork" | "direct" | "concern" | "picture" | "marks" | "asked" | "choice" | "clarify" | "thumbnails" | "strokes" | "probes" | "live" | "forkAnalysis" | "forkPlans">;
export type ManipStart = { frameId: string; concern: string; picture: string; image: string; marks: { x: number; y: number }[][]; analysis: Analysis | null; cycleIds: number[]; direct?: boolean };
/** An overlay on the fork: a site the tools set, its newest step and the steps around it. */
export type ForkOverlay = { site: string; step: ExecStep; steps: ExecStep[]; plan: SitePlan | undefined };
/** A target row: the variable's value recorded before, what the strokes show, and recorded after a change. */
export type TargetRow = { id: string; name: string; where: string; param: boolean; meaning: string; before: string; shown: string; after: string; error: string; applied: boolean };

const THUMB = { w: 600, h: 400 };
/** Whether a fork's cycle was drawn with a value the user showed (a constraint read a non-null m.demo value). */
const drawnWithShown = (steps: ExecStep[]) => steps.some(step => { const shown = step.variables.$demo; return Boolean(shown && typeof shown === "object" && Object.values(shown).some(value => value !== null && value !== undefined)); });
/** Rows show values whole (long ones wrap in the table). */
const FULL = 20000;
const dataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob); });
let runner: ReturnType<typeof sandboxRunner> | null = null;
const sandbox = () => runner ??= sandboxRunner(MANIP_HOST);
/** The worker that measures demonstrations (shared with the tools kept with frames). */
export const manipSandbox = sandbox;

type Execution = { view: { frameId: string; trace: ExecTrace; framed: boolean; analysis: Analysis | null } | null; follow: () => void };

export function useManipulation(deps: StudioDeps, execution: Execution) {
  const [view, setView] = useState<ManipView | null>(null);
  const viewRef = useRef(view); viewRef.current = view;
  // The recording of the frame the demonstration is about: kept after its inspection closes (or moves to another frame).
  const traceRef = useRef(execution.view?.trace);
  if (execution.view && (!view || execution.view.frameId === view.frameId)) traceRef.current = execution.view.trace;
  /** The inspection is told the frame changed, when it is still on the frame the demonstration is about. */
  const follow = (frameId: string) => { if (execution.view?.frameId === frameId) execution.follow(); };
  /** What was made for each rule picked in this session (by ruleKey): its tools, the fork's code following it and
   *  the strokes shown with them, so picking it again (after Pick another) brings them back without AI. */
  const made = useRef<Record<string, { clarify: Clarify; fork?: { generated: NonNullable<Panel["generated"]>; scene: Panel["scene"] }; strokes: ManipStroke[] }>>({});
  const patch = (frameId: string, change: Partial<ManipView> | ((current: ManipView) => Partial<ManipView>)) =>
    setView(current => current && current.frameId === frameId ? { ...current, ...(typeof change === "function" ? change(current) : change) } : current);

  // With stepping, the demonstration ends with its Execution frame; a temporary fork (fork mode) stays, with its tools
  // and what was shown, until it is kept or discarded, whether the inspection is open or not.
  const inspected = execution.view, alive = Boolean(view && (view.mode === "fork" || (inspected?.frameId === view.frameId && inspected.framed && inspected.analysis)));
  useEffect(() => { if (view && !alive) { dropFork(view); setView(null); } }, [alive]);

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
        if (choice) made.current[ruleKey(choice)] = { clarify: result, strokes: [] };
        patch(frameId, { clarify: result, tool, busy: false, status: "", live: "", forkAnalysis: null, forkPlans: {}, forkInspect: "", overlayErrors: {}, demo: {} });
        if (current.mode === "fork") void goLive(frameId, result);
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
    if (current.analysis) for (const site of current.analysis.sites) {
      const cycle = [...trace.cycles].reverse().find(item => asked.has(item.id) && item.steps.some(step => siteOf(step) === site.site));
      out[site.site] = (cycle?.steps.filter(step => siteOf(step) === site.site) ?? []).slice(0, 200).map(step => step.variables);
    }
    else {
      // No sites chosen (fork mode): every site of the newest cycle the concern was asked about.
      const cycle = [...trace.cycles].reverse().find(item => asked.has(item.id) && item.steps.length);
      for (const step of cycle?.steps ?? []) {
        const site = siteOf(step), list = out[site] ?? (Object.keys(out).length < 40 ? out[site] = [] : null);
        if (list && list.length < 80) list.push(step.variables);
      }
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
        // A value that varies over the picture is read where it was shown, as the code reads it for an item there.
        const value = measured[target.id].value;
        if (target.at && value !== undefined && value !== null && typeof value === "object") {
          const spots = strokeSpots(current.strokes).map(point => [Math.round(point.x), Math.round(point.y)]);
          const read = spots.length ? await sandbox().run({ kind: "at", code: target.at, input: { value, points: spots } }) : null;
          if (Array.isArray(read?.values)) measured[target.id].at = (read.values as unknown[]).filter(item => item !== null && item !== undefined);
        }
      }
      if (viewRef.current?.frameId !== frameId || viewRef.current.strokes !== current.strokes) return;
      // On a fork, what the code computes comes in live as m.demo values (null while nothing is shown).
      const demo = current.mode === "fork" ? Object.fromEntries(liveTargets(clarify).map(target => [demoKey(target.id), measured[target.id]?.value ?? null])) : {};
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
      patch(frameId, change => ({ measured, demo, ...(!changed ? {} : change.fork ? (change.forkChangedFrom === null ? { forkChangedFrom: nextIds(change.forkTrace).cycle } : {})
        : change.changedFrom === null && trace ? { changedFrom: nextIds(trace).cycle } : {}) }));
      if (changed && !current.fork) follow(frameId);
    }, 160);
    return () => clearTimeout(timer);
  }, [strokes, clarify]);

  /** Fork mode: the fork's code is made to follow the rule, reading what the tools show live (m.demo). */
  async function goLive(frameId: string, clarify: Clarify, failed = "") {
    const current = viewRef.current, fork = current?.fork;
    if (!current || current.frameId !== frameId || !fork) return;
    // From the original's code (the fork is its copy), so picking another rule does not build on the last one.
    const panel = deps.panel(frameId);
    if (!panel.generated || !deps.panel(fork).generated) { patch(frameId, { live: "failed", status: "The temporary fork has no result." }); return; }
    // Only params the tools set, and the rule asks nothing of the code: the fork is live as it is.
    if (!clarify.needsCode && !liveTargets(clarify).length) { patch(frameId, change => ({ live: "ready", forkChangedFrom: nextIds(change.forkTrace).cycle })); return; }
    patch(frameId, { live: "making", busy: true, status: "Making the fork follow the rule, so what you show changes it at once…" });
    try {
      const instruction = liveRequest({ concern: current.concern, summary: clarify.summary, choice: current.choice, tools: clarify.tools, targets: clarify.targets })
        + (failed ? `\nThe code made for this before failed while running: ${failed.slice(0, 600)}. Write it so it does not.` : "");
      const previous = liveSceneSource(panel.generated, panel.scene), image = (await deps.capture(fork, true)).image;
      const result = generatedSchema.parse(await deps.request("code", { scene: panel.scene, previous, image, instruction }, fork));
      await deps.request("prepare", { code: result.code }, fork);
      if (viewRef.current?.fork !== fork || viewRef.current.clarify !== clarify) return;
      deps.updatePanel(fork, latest => ({ ...ops.commitScene(latest, panel.scene), generated: result, codeDraft: result.code, executable: "", preparedCode: "", runtimeError: "", runtimeStates: {}, dirtyNodeIds: [], hovered: null }));
      const kept = current.choice && made.current[ruleKey(current.choice)];
      if (kept && kept.clarify === clarify) kept.fork = { generated: result, scene: panel.scene };
      patch(frameId, change => ({ live: "ready", busy: false, forkChangedFrom: nextIds(change.forkTrace).cycle, status: "", forkAnalysis: null, forkPlans: {}, forkInspect: "", overlayErrors: {} }));
    } catch (error) {
      patch(frameId, { live: "failed", busy: false, status: error instanceof Error ? error.message : "The fork could not be made to follow the rule." });
    }
  }
  /** Fork mode without tools: the fork's code is changed to meet the concern (with the marks drawn for it), at once. */
  async function changeDirectly(frameId: string) {
    const current = viewRef.current, fork = current?.fork;
    if (!current || current.frameId !== frameId || !fork) return;
    const panel = deps.panel(fork);
    if (!panel.generated) { patch(frameId, { live: "failed", status: "The temporary fork has no result." }); return; }
    patch(frameId, { live: "making", busy: true, status: "Changing the fork to meet the concern…" });
    try {
      const annotations = current.marks.map((points, k) => ({ id: `mark-${k + 1}`, points: points.slice(0, 600).map(point => ({ x: Math.min(1, Math.max(0, point.x / CANVAS_W)), y: Math.min(1, Math.max(0, point.y / CANVAS_H)) })) })).filter(item => item.points.length >= 2);
      const picture = (await deps.capture(fork, true)).image, image = annotations.length ? await annotatedResultImage(picture, annotations) : picture;
      const instruction = [`Concern: ${current.concern}`, annotations.length ? "The user marked what it is about on the result (drawn in the annotation)." : "",
        "Change the brush so that it meets the concern; change the code where needed, add a variable or param if it is missing. Keep everything else as it is."].filter(Boolean).join("\n").slice(0, 6000);
      const result = generatedSchema.parse(await deps.request("code", { scene: panel.scene, previous: liveSceneSource(panel.generated, panel.scene), image, annotations, instruction }, fork));
      await deps.request("prepare", { code: result.code }, fork);
      if (viewRef.current?.fork !== fork) return;
      deps.updatePanel(fork, latest => ({ ...latest, generated: result, codeDraft: result.code, executable: "", preparedCode: "", runtimeError: "", runtimeStates: {}, dirtyNodeIds: [], hovered: null }));
      patch(frameId, change => ({ live: "ready", busy: false, forkChangedFrom: nextIds(change.forkTrace).cycle, status: "" }));
    } catch (error) {
      patch(frameId, { live: "failed", busy: false, status: error instanceof Error ? error.message : "The fork could not be changed." });
    }
  }
  /** Fork mode: which of the fork's recorded values the tools set, and how they go on its picture (once it runs the rule). */
  async function inspectFork(frameId: string) {
    const current = viewRef.current, fork = current?.fork;
    if (!current?.clarify || !fork || current.forkChangedFrom === null) return;
    const live = liveTargets(current.clarify).length > 0, from = current.forkChangedFrom;
    const trace = { ...current.forkTrace, cycles: current.forkTrace.cycles.filter(cycle => cycle.id >= from && (!live || drawnWithShown(cycle.steps))) };
    const panel = deps.panel(fork);
    if (!panel.generated || !trace.cycles.length) return;
    patch(frameId, { forkInspect: "busy" });
    try {
      const concern = liveConcern(current.concern, current.clarify.targets), nodeIds = panel.scene.nodes.map(node => node.id).slice(0, 64);
      const base = { scene: panel.scene, previous: liveSceneSource(panel.generated, panel.scene), image: (await deps.capture(fork, true)).image };
      const analysis = everyItem(analysisSchema.parse(await deps.request("trace-analyze", { ...base, trace: { concern, nodeIds, cycles: trace.cycles.length, sites: variableCatalog(trace).slice(-200), marks: [], analysis: null } }, fork)));
      if (viewRef.current?.fork !== fork) return;
      patch(frameId, { forkAnalysis: analysis });
      const plans = await placeAnalysis(deps, fork, { base, trace, concern, nodeIds, marks: [], analysis });
      if (viewRef.current?.fork !== fork) return;
      patch(frameId, { forkPlans: plans, forkInspect: "done" });
    } catch (error) {
      patch(frameId, { forkInspect: "failed", status: `The fork's values could not be shown on it: ${error instanceof Error ? error.message : "inspection failed"}` });
    }
  }
  // Once the fork runs the rule and has recorded a cycle drawn with what the user showed, the values the tools set are
  // inspected (once per set of tools): before that, code reading a shown value may not have computed from it at all.
  const forkReady = view?.mode === "fork" && view.live === "ready" && view.forkInspect === "" && view.forkChangedFrom !== null && (view.strokes.length > 0 || view.probes.length > 0)
    && view.forkTrace.cycles.some(cycle => cycle.id >= view.forkChangedFrom! && (!liveTargets(view.clarify).length || drawnWithShown(cycle.steps)));
  useEffect(() => { if (forkReady && viewRef.current) void inspectFork(viewRef.current.frameId); }, [forkReady]);
  // Shown at one item of a list only (made before values were shown per item): inspected again.
  const pinned = Boolean(view?.forkAnalysis && pinsItem(view.forkAnalysis));
  useEffect(() => { const current = viewRef.current; if (pinned && current && current.forkInspect !== "busy") patch(current.frameId, { forkAnalysis: null, forkPlans: {}, forkInspect: "" }); }, [pinned]);

  /** The frame's brushes are in the toolbar: made from its scene when it has none yet. */
  function ensureBrushes(frameId: string) {
    if (!deps.brushesOf || deps.brushesOf(frameId).length) return;
    const scene = deps.panel(frameId).scene, made = deps.addBrushes(frameId, scene);
    if (made.length) deps.updatePanel(frameId, latest => ({ scene: markBrushes(latest.scene, made) }));
  }
  /** Change the brush's code from the demonstration (its rule, tools and the values shown), in the inspected frame or
   *  in its fork (`into`). */
  async function change(rows: TargetRow[], into: string) {
    const current = viewRef.current;
    if (!current?.clarify) return false;
    const frameId = current.frameId, panel = deps.panel(into);
    if (!panel?.generated) return false;
    let done = false;
    const annotations = current.strokes.map(stroke => ({ id: stroke.id, points: placedPoints(stroke).slice(0, 600).map(point => ({ x: Math.min(1, Math.max(0, point.x / CANVAS_W)), y: Math.min(1, Math.max(0, point.y / CANVAS_H)) })) })).filter(item => item.points.length >= 2);
    if (!annotations.length) { patch(frameId, { status: "Show it on the picture with the tools first." }); return false; }
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
        follow(frameId);
      }
      done = true;
    }, into);
    return done;
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
  /** Fork mode: the fork is made at once, then the tools (or the rule question first) — made by AI, or saved ones used again. */
  async function startFork(frameId: string, saved?: { clarify: Clarify; choice: Choice | null }, direct = false) {
    patch(frameId, { busy: true, status: "Making a temporary fork of this frame…" });
    try { await makeFork(); }
    catch (error) { patch(frameId, { busy: false, status: error instanceof Error ? error.message : "Could not make a fork." }); return; }
    patch(frameId, { busy: false, status: "" });
    if (direct) { await changeDirectly(frameId); return; }
    if (!saved) { await request(frameId, null); return; }
    if (asks(saved.clarify) && !saved.choice) { patch(frameId, { asked: saved.clarify }); void drawThumbnails(frameId, saved.clarify.rules); return; }
    const tool = saved.clarify.tools.find(item => item.kind !== "select")?.kind ?? null;
    patch(frameId, { clarify: saved.clarify, choice: saved.choice, tool });
    await goLive(frameId, saved.clarify);
  }
  const freshView = (info: ManipStart, mode: ManipMode): ManipView => ({ ...info, mode, asked: null, choice: null, clarify: null, thumbnails: {}, strokes: [], tool: null, selected: null, measured: {}, changedFrom: null, fork: null, forkTrace: emptyTrace(), forkChangedFrom: null,
    demo: {}, live: "", forkAnalysis: null, forkPlans: {}, forkInspect: "", overlayErrors: {}, probes: [], busy: false, status: "" });
  /** A fork of the inspected frame (sketch, scene, result and its input), placed beside it; made once. */
  async function makeFork() {
    const current = viewRef.current!;
    if (current.fork && deps.panel(current.fork).generated) return current.fork;
    const id = deps.fork?.(current.frameId) ?? null;
    if (!id) throw new Error("Could not make a fork of this frame (too many frames?).");
    // It starts from what the original has drawn (its newest recorded runtime: the strokes made with the brush), not
    // from an empty canvas, so the tools act on that drawing; the seed is kept, so the fork's new code starts from it too.
    const newest = [...(traceRef.current?.cycles ?? [])].reverse().find(cycle => cycle.runtime);
    if (newest) deps.updatePanel(id, { seed: { id: `fork-${id}-${newest.id}`, runtime: newest.runtime } });
    patch(current.frameId, { fork: id, forkTrace: emptyTrace(), forkChangedFrom: null });
    viewRef.current = { ...viewRef.current!, fork: id };
    // Its result is prepared and drawn before it is changed.
    for (let i = 0; i < 100 && !deps.preview(id); i++) await new Promise(resolve => setTimeout(resolve, 100));
    return id;
  }
  const dropFork = (current: ManipView | null) => { if (current?.fork) deps.removeFrame?.(current.fork); };
  /** The tools of a fork-mode demonstration, with what was shown with them, as a set kept with a frame (none without tools). */
  const keptSet = (current: ManipView): KeptToolSet[] => current.mode === "fork" && !current.direct && current.clarify?.tools.length ? [{
    id: crypto.randomUUID(), concern: current.concern.slice(0, 2000), rule: current.choice ? `${current.choice.rule} (${current.choice.logic})`.slice(0, 400) : "",
    tools: current.clarify.tools, targets: current.clarify.targets, strokes: current.strokes.slice(-MAX_KEPT_STROKES),
    values: demoValues(current.clarify.targets, Object.fromEntries(Object.entries(current.measured).map(([id, item]) => [id, item.value ?? null]))),
    analysis: current.forkAnalysis, plans: current.forkPlans }] : [];
  /** Another demonstration starts: a temporary fork is not thrown away but stays as a frame of its own, its tools and
   *  what was shown with them kept with it (its code goes on reading them); in stepping mode it goes as before. */
  const leaveFork = (current: ManipView | null) => {
    if (!current?.fork) return;
    if (current.mode !== "fork" || !deps.panel(current.fork).generated) { dropFork(current); return; }
    const kept = keptSet(current);
    if (kept.length) deps.updatePanel(current.fork, latest => ({ keptTools: [...latest.keptTools, ...kept].slice(-MAX_KEPT_SETS) }));
    deps.toast(kept.length ? "The last temporary fork stays as a frame, its tools kept with it." : "The last temporary fork stays as a frame.");
  };
  // Cycles the fork records, taken in at most every 200 ms.
  const forkPending = useRef<{ fork: string; raw: unknown[] }>({ fork: "", raw: [] });
  const forkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (forkTimer.current) clearTimeout(forkTimer.current); }, []);

  /** Fork mode: the overlays on the fork's picture, one per site the tools set (its newest step in the newest cycle). */
  const forkOverlays: ForkOverlay[] = useMemo(() => {
    if (!view || view.mode !== "fork" || !view.forkAnalysis || view.forkChangedFrom === null) return [];
    const cycle = [...view.forkTrace.cycles].reverse().find(item => item.id >= view.forkChangedFrom! && item.steps.length);
    if (!cycle) return [];
    // Every item of the cycle (the overlay keeps those under the strokes).
    const sites = new Set(view.forkAnalysis.sites.map(site => site.site)), steps = cycle.steps.filter(step => sites.has(siteOf(step))).slice(-600);
    return view.forkAnalysis.sites.flatMap(site => { const step = steps.filter(item => siteOf(item) === site.site).at(-1); return step ? [{ site: site.site, step, steps, plan: view.forkPlans[site.site] }] : []; });
  }, [view?.forkTrace, view?.forkAnalysis, view?.forkPlans, view?.forkChangedFrom, view?.mode]);
  const forkShown = useMemo(() => shownPaths(view?.forkAnalysis ?? null), [view?.forkAnalysis]);

  const rows: TargetRow[] = !view?.clarify || !traceRef.current ? [] : view.clarify.targets.map(target => {
    const trace = traceRef.current!, asked = new Set(view.cycleIds), measured = view.measured[target.id];
    return {
      id: target.id, name: target.name, where: target.site ? `${target.site} ${target.path}` : "new variable", param: Boolean(target.param), meaning: target.meaning,
      before: target.site ? summarize(recordedAt(trace, target.site, target.path, id => asked.has(id)), FULL) : "—",
      shown: measured?.value === undefined ? "—" : measured.at ? (measured.at.length ? `${summarize(measured.at, FULL)} where drawn` : "—")
        : summarize(Array.isArray(measured.value) && measured.value.every(item => typeof item === "number") ? measured.value : [measured.value], FULL),
      after: !target.site ? "" : view.fork ? (view.forkChangedFrom === null ? "" : summarize(recordedAt(view.forkTrace, target.site, target.path, id => id >= view.forkChangedFrom!), FULL))
        : view.changedFrom === null ? "" : summarize(recordedAt(trace, target.site, target.path, id => id >= view.changedFrom!), FULL),
      error: measured?.error ?? "", applied: Boolean(measured?.applied),
    };
  });

  return {
    view, rows, forkOverlays, forkShown,
    /** A concern was sent: with its analysis (stepping) the tools are made when the user asks for them (begin); without,
     *  a temporary fork is made at once with them. */
    start(info: ManipStart, saved?: { clarify: Clarify; choice: Choice | null }) {
      leaveFork(viewRef.current);
      traceRef.current = execution.view?.frameId === info.frameId ? execution.view.trace : traceRef.current;
      made.current = {};
      const mode: ManipMode = info.analysis ? "stepping" : "fork";
      const next: ManipView = { ...freshView(info, mode), choice: saved?.choice ?? null };
      viewRef.current = next; setView(next);
      if (mode === "fork") void startFork(info.frameId, saved, info.direct);
    },
    /** Fork mode: what was shown on the fork (values, what the fork drew with them, strokes), to make it the brush's own rule. */
    generalizeSource(): GeneralizeStart | null {
      const current = viewRef.current;
      if (!current || current.mode !== "fork" || !current.fork || !current.clarify || !current.strokes.length) return null;
      const byId = new Map(rows.map(row => [row.id, row])), from = current.forkChangedFrom ?? 0, live = liveTargets(current.clarify).length > 0;
      const trace = { ...current.forkTrace, cycles: current.forkTrace.cycles.filter(cycle => cycle.id >= from && (!live || drawnWithShown(cycle.steps))) };
      return { frameId: current.frameId, from: current.fork, kind: "fork", trace, demonstration: {
        concern: current.concern, rule: current.choice ? `${current.choice.rule} (${current.choice.logic})` : "", tools: current.clarify.tools,
        targets: current.clarify.targets.map(target => ({ id: target.id, name: target.name, where: target.site ? `${target.site} ${target.path}` : "", param: target.param, meaning: target.meaning,
          shown: (byId.get(target.id)?.shown ?? "—").slice(0, 600), drawn: (byId.get(target.id)?.after ?? "").slice(0, 600) })),
        values: Object.fromEntries(Object.entries(current.measured).map(([id, item]) => [id, item.value ?? null])), strokes: current.strokes } };
    },
    /** What to keep across a reload (fork mode, with its fork), or null. */
    snapshot(): ManipSaved | null {
      const current = viewRef.current;
      if (!current || current.mode !== "fork" || !current.fork) return null;
      const { frameId, fork, direct, concern, picture, marks, asked, choice, clarify, thumbnails, strokes, probes, live, forkAnalysis, forkPlans } = current;
      // Images only while small: the project is kept in the same storage.
      const small = JSON.stringify(thumbnails).length < 600_000;
      return { frameId, fork, direct, concern, picture: picture.length < 300_000 ? picture : "", marks, asked, choice, clarify, thumbnails: small ? thumbnails : {}, strokes, probes, live, forkAnalysis, forkPlans };
    },
    /** A session kept across a reload comes back: its fork already runs the rule (unless making that was cut off). */
    resume(saved: ManipSaved) {
      const interrupted = (saved.clarify || saved.direct) && saved.live !== "ready";
      const next: ManipView = { ...freshView({ frameId: saved.frameId, concern: saved.concern, picture: saved.picture, image: "", marks: saved.marks, analysis: null, cycleIds: [] }, "fork"),
        ...saved, live: interrupted ? "failed" : saved.live, forkChangedFrom: saved.live === "ready" ? 0 : null, forkInspect: saved.forkAnalysis ? "done" : "",
        status: interrupted ? `${saved.direct ? "Changing the fork" : "Making the fork follow the rule"} was cut off by the reload.` : "" };
      viewRef.current = next; setView(next);
    },
    begin() { const current = viewRef.current; if (current && !current.busy) void request(current.frameId, null); },
    choose(option: ClarifyRule) {
      const current = viewRef.current;
      if (!current?.asked || current.busy) return;
      const choice: Choice = { question: current.asked.question, rule: option.rule, logic: option.logic, detail: option.detail, tools: option.tools.map(tool => tool.kind) };
      const kept = made.current[ruleKey(choice)];
      if (!kept) { void request(current.frameId, choice); return; }
      // Picked before: its tools (and strokes) come back as they were made, nothing is generated again.
      const tool = kept.clarify.tools.find(item => item.kind !== "select")?.kind ?? null, fork = current.mode === "fork" ? current.fork : null;
      patch(current.frameId, { choice, clarify: kept.clarify, tool, strokes: kept.strokes, selected: null, measured: {}, demo: {}, probes: [], status: "",
        live: "", forkAnalysis: null, forkPlans: {}, forkInspect: "", overlayErrors: {} });
      if (!fork) return;
      if (!kept.fork) { void goLive(current.frameId, kept.clarify); return; }
      // The fork follows this rule again: its code back as made for it (reloaded only when another rule's code is on it).
      const saved = kept.fork;
      if (deps.panel(fork).generated?.code !== saved.generated.code)
        deps.updatePanel(fork, latest => ({ ...ops.commitScene(latest, saved.scene), generated: saved.generated, codeDraft: saved.generated.code, executable: "", preparedCode: "", runtimeError: "", runtimeStates: {}, dirtyNodeIds: [], hovered: null }));
      patch(current.frameId, change => ({ live: "ready", forkChangedFrom: nextIds(change.forkTrace).cycle }));
    },
    /** Back to the rule question (the tools made for the rule picked are dropped). */
    rechoose: () => {
      const current = viewRef.current;
      if (!current?.asked) return;
      const kept = current.choice && made.current[ruleKey(current.choice)];
      if (kept && kept.clarify === current.clarify) kept.strokes = current.strokes;
      // The inspect markers (probes) and the fork's overlay belong to the rule left.
      setView(view => view && view.asked ? { ...view, choice: null, clarify: null, strokes: [], selected: null, measured: {}, tool: null, demo: {}, probes: [], live: "", forkAnalysis: null, forkPlans: {}, forkInspect: "", overlayErrors: {} } : view);
    },
    /**
     * Make again what failed: the rule question (and its previews), the tools for the rule picked, the fork's code
     * (told why it failed), or the fork's overlay (which values, and where they go).
     */
    regenerate(what: "rules" | "tools" | "live" | "overlay", failed = "") {
      const current = viewRef.current;
      if (!current || current.busy) return;
      if (what === "rules") void request(current.frameId, null);
      else if (what === "tools") void request(current.frameId, current.choice);
      else if (what === "live" && current.clarify) void goLive(current.frameId, current.clarify, failed);
      else if (what === "overlay") patch(current.frameId, { forkAnalysis: null, forkPlans: {}, forkInspect: "", overlayErrors: {}, status: "" });
    },
    /** An overlay on the fork could not be drawn (or works again). */
    overlayFailed: (site: string, message: string | null) => setView(current => !current || (current.overlayErrors[site] ?? null) === message ? current
      : { ...current, overlayErrors: message ? { ...current.overlayErrors, [site]: message } : Object.fromEntries(Object.entries(current.overlayErrors).filter(([key]) => key !== site)) }),
    retry() {
      const current = viewRef.current;
      if (!current || current.busy) return;
      if (current.mode === "fork" && !current.fork) void startFork(current.frameId, undefined, current.direct);
      else if (current.direct && current.live === "failed") void changeDirectly(current.frameId);
      else if (current.mode === "fork" && current.clarify && current.live === "failed") void goLive(current.frameId, current.clarify);
      else if (current.mode === "fork" && current.clarify && current.forkInspect === "failed") { patch(current.frameId, { forkInspect: "", status: "" }); }
      else void request(current.frameId, current.choice);
    },
    /** Change the inspected frame's brush from the demonstration. */
    apply: () => run(async () => { await change(rows, viewRef.current!.frameId); }, "Changing the brush from what you showed…"),
    /** Try the change on a temporary fork of the inspected frame (made the first time). */
    tryOnFork: () => run(async () => { await change(rows, await makeFork()); }, "Making a fork and trying the change there…"),
    /** The fork's scene and result become the inspected frame's; the fork goes. In fork mode (the fork's code reads
     *  the tools live) the original is revised from what was shown instead, and the demonstration ends. */
    /**
     * Keep: the fork becomes the original — its scene and code replace the original's, which goes on from the fork's
     * drawing; the original's brushes take the new code (made if it had none). The tools it was shown with stay with
     * the frame (its code reads what they show), with what was shown, as sub tools of its brush.
     */
    keepFork() {
      const current = viewRef.current, fork = current?.fork ? deps.panel(current.fork) : undefined;
      if (!current || current.busy || !fork?.generated) return;
      const generated = fork.generated, trace = traceRef.current, runtime = [...current.forkTrace.cycles].reverse().find(cycle => cycle.runtime)?.runtime;
      const kept = keptSet(current);
      deps.updatePanel(current.frameId, latest => ({ ...ops.commitScene(latest, fork.scene), generated, codeDraft: generated.code, executable: "", preparedCode: "", runtimeError: "", runtimeStates: {}, dirtyNodeIds: [], hovered: null,
        keptTools: [...fork.keptTools, ...kept].slice(-MAX_KEPT_SETS),
        ...(runtime ? { seed: { id: `kept-${current.fork}-${Date.now()}`, runtime } } : {}) }));
      deps.refreshBrushCode?.(current.frameId, generated.code);
      ensureBrushes(current.frameId);
      dropFork(current);
      if (current.mode === "fork") { deps.toast(kept.length ? "The original is now the fork. Its tools are kept as sub tools of the brush." : "The original is now the fork."); setView(null); follow(current.frameId); return; }
      patch(current.frameId, change => ({ fork: null, forkTrace: emptyTrace(), forkChangedFrom: null, changedFrom: change.changedFrom ?? (trace ? nextIds(trace).cycle : null), status: "Kept: the original now has the fork's change." }));
      follow(current.frameId);
    },
    discardFork() {
      const current = viewRef.current;
      if (!current?.fork || current.busy) return;
      dropFork(current);
      if (current.mode === "fork") { setView(null); return; }
      patch(current.frameId, { fork: null, forkTrace: emptyTrace(), forkChangedFrom: null, status: "" });
    },
    /** The fork frame was deleted on the board. */
    forkGone: (id: string) => setView(current => current?.fork !== id ? current : current.mode === "fork" ? null : { ...current, fork: null, forkTrace: emptyTrace(), forkChangedFrom: null }),
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
    setTool: (tool: LayerTool) => setView(current => current ? { ...current, tool, selected: tool === "select" ? current.selected : null } : current),
    /** A spot clicked with the inspect tool (again near one: it goes). */
    probe: (at: Point) => setView(current => current ? { ...current, probes: toggleProbe(current.probes, at) } : current),
    clearProbes: () => setView(current => current ? { ...current, probes: [] } : current),
    add: (stroke: ManipStroke) => setView(current => current ? { ...current, strokes: [...current.strokes, stroke].slice(-40) } : current),
    change: (stroke: ManipStroke) => setView(current => current ? { ...current, strokes: current.strokes.map(item => item.id === stroke.id ? stroke : item) } : current),
    select: (id: string | null) => setView(current => current ? { ...current, selected: id } : current),
    remove: () => setView(current => current && current.selected ? { ...current, strokes: current.strokes.filter(item => item.id !== current.selected), selected: null } : current),
    clear: () => setView(current => current ? { ...current, strokes: [], selected: null, measured: {} } : current),
    toggleMarks: () => setView(current => current ? { ...current, marksHidden: !current.marksHidden, selected: null } : current),
    close: () => { dropFork(viewRef.current); setView(null); },
  };
}
