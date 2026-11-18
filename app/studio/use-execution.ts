import { useEffect, useMemo, useRef, useState } from "react";
import type { StudioDeps } from "./deps";
import type { RestorePoint } from "../components/code-preview";
import type { MachineInspection } from "../components/scene/machine-graph";
import { addCycle, analysisSchema, emptyTrace, matchSteps, nextIds, readCycle, shownPaths, siteOf, traceSteps, variableCatalog, type Analysis, type ExecStep, type ExecTrace } from "../lib/execution/trace";
import { checkedPlans, overlayPlanSchema, stepRecord, type SitePlan } from "../lib/execution/overlay";
import { liveSceneSource } from "../lib/scene/live";
import { annotatedImage, type Marks } from "./annotated-image";

/** The color of inspection annotation marks (on the picture and in the image AI sees). */
export const MARK_COLOR = "#e8590c";

// Execution inspection of one frame at a time: while it is open the frame's running result is recorded by cycle
// (every variable at every FSM step), a step can be held (the frame is drawn as execution had made it there), and a
// concern asks AI which steps and variables explain it and how to place them on the picture.

export type ExecutionView = {
  frameId: string;
  trace: ExecTrace;
  analysis: Analysis | null;
  concern: string;
  plans: Record<string, SitePlan>;
  /** The step held (null: live). */
  stepId: number | null;
  /** The concern's steps are stepped through in an Execution frame of their own (the inspected frame stays live). */
  framed: boolean;
  /** The cycles the concern was asked about (new cycles recorded after it do not change its steps). */
  cycleIds: number[] | null;
  /** Inspection annotation: strokes drawn on the picture (0..1 of the frame), sent with the concern. */
  marks: Marks;
  busy: boolean;
  status: string;
  overlayStatus: string;
};
const fresh = (frameId: string): ExecutionView => ({ frameId, trace: emptyTrace(), analysis: null, concern: "", plans: {}, stepId: null, framed: false, cycleIds: null, marks: [], busy: false, status: "", overlayStatus: "" });
/** Steps the timeline goes through without a concern: the newest of all recorded. */
const MAX_TIMELINE = 3000;
/** Cycles arriving while the brush is used are taken in at most this often (ms). */
const FLUSH_MS = 200;

/** A value made small for AI: long texts and large values cut. */
function compact(variables: Record<string, unknown>, keep: Set<string>, budget = 9000) {
  const out: Record<string, unknown> = {};
  let used = 0;
  for (const [name, value] of Object.entries(variables).sort(([a], [b]) => Number(keep.has(b)) - Number(keep.has(a)))) {
    let text = JSON.stringify(value) ?? "null";
    const limit = keep.has(name) ? 3000 : 400;
    if (text.length > limit) text = JSON.stringify(text.slice(0, limit - 1) + "…");
    if (used + text.length > budget) continue;
    used += text.length; out[name] = JSON.parse(text);
  }
  return out;
}

/** What a concern's analysis hands on to direct manipulation. */
export type Analyzed = { frameId: string; concern: string; picture: string; image: string; marks: { x: number; y: number }[][]; analysis: Analysis; cycleIds: number[] };

export function useExecution(deps: StudioDeps, onFramed?: (frameId: string) => void, onAnalyzed?: (analyzed: Analyzed) => void) {
  const [view, setView] = useState<ExecutionView | null>(null);
  const viewRef = useRef(view); viewRef.current = view;
  const pending = useRef<{ frameId: string; raw: unknown[] }>({ frameId: "", raw: [] });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const flush = () => {
    timer.current = null;
    const { frameId, raw } = pending.current;
    pending.current = { frameId, raw: [] };
    if (!raw.length) return;
    setView(current => {
      if (!current || current.frameId !== frameId) return current;
      let trace = current.trace;
      for (const item of raw) { const ids = nextIds(trace), cycle = readCycle(item, ids.cycle, ids.step); if (cycle && cycle.steps.length) trace = addCycle(trace, cycle); }
      return { ...current, trace };
    });
  };
  /** A cycle the frame's running result recorded. */
  const onCycle = (frameId: string, raw: unknown) => {
    if (viewRef.current?.frameId !== frameId) return;
    if (pending.current.frameId !== frameId) pending.current = { frameId, raw: [] };
    pending.current.raw.push(raw);
    if (!timer.current) timer.current = setTimeout(flush, FLUSH_MS);
  };

  const all = useMemo(() => view ? traceSteps(view.trace).slice(-MAX_TIMELINE) : [], [view?.trace]);
  const steps = useMemo(() => {
    if (!view?.analysis) return all;
    const asked = view.cycleIds ? new Set(view.cycleIds) : null;
    return matchSteps(asked ? { ...view.trace, cycles: view.trace.cycles.filter(cycle => asked.has(cycle.id)) } : view.trace, view.analysis);
  }, [view?.trace, view?.analysis, view?.cycleIds, all]);
  // An Execution frame always holds a step (the newest of its steps when none is chosen).
  const step = useMemo(() => !view ? null : view.stepId === null ? (view.framed ? steps.at(-1) ?? null : null)
    : all.find(item => item.id === view.stepId) ?? steps.find(item => item.id === view.stepId) ?? null, [view?.stepId, view?.framed, all, steps]);
  /** The held step: its cycle's state put back and drawn up to the step (steps before the drawing: the whole drawing). */
  const restore: RestorePoint | null = useMemo(() => {
    if (!step || !view) return null;
    const cycle = view.trace.cycles.find(item => item.id === step.cycle);
    if (!cycle?.runtime) return null;
    return { id: `exec-${step.cycle}-${step.index}`, runtime: cycle.runtime, params: cycle.params, run: { budget: step.index >= 0 ? step.index + 1 : null } };
  }, [step, view?.trace]);
  const machine = (nodeId: string | null): MachineInspection | null => {
    if (!step || !nodeId || step.nodeId !== nodeId) return null;
    const sites = view?.analysis?.sites.map(site => site.site) ?? [];
    return { state: step.kind === "transition" ? step.to ?? null : step.state, from: step.kind === "transition" ? step.state : null, transition: step.transitionId ?? null,
      states: sites.filter(site => site.startsWith(`state:${nodeId}/`)).map(site => site.split("/").pop()!), transitions: sites.filter(site => site.startsWith(`transition:${nodeId}/`)).map(site => site.split("/").pop()!) };
  };

  const patch = (frameId: string, change: Partial<ExecutionView>) => setView(current => current && current.frameId === frameId ? { ...current, ...change } : current);
  /** Ask which recorded steps and variables explain the concern, then how to place them on the picture. */
  async function inspect(concern: string) {
    const current = viewRef.current;
    if (!current || current.busy) return;
    const frameId = current.frameId, panel = deps.panel(frameId), trace = current.trace;
    if (!panel.generated) { patch(frameId, { status: "Generate this frame's result first." }); return; }
    patch(frameId, { busy: true, concern, status: "Choosing the steps and variables that explain it…", overlayStatus: "" });
    try {
      const nodeIds = panel.scene.nodes.map(node => node.id).slice(0, 64);
      const marks = current.marks, picture = (await deps.capture(frameId, true)).image, image = await annotatedImage(picture, marks, MARK_COLOR);
      const base = { scene: panel.scene, previous: liveSceneSource(panel.generated, panel.scene), image };
      const pixels = marks.slice(-24).map(mark => mark.slice(0, 400).map(point => ({ x: Math.round(point.x * 900), y: Math.round(point.y * 600) })));
      const catalog = variableCatalog(trace).slice(-200);
      const cycleIds = trace.cycles.map(cycle => cycle.id);
      const analysis = analysisSchema.parse(await deps.request("trace-analyze", { ...base, trace: { concern, nodeIds, cycles: trace.cycles.length, sites: catalog, marks: pixels, analysis: null } }, frameId));
      const matches = matchSteps(trace, analysis);
      // The steps go to an Execution frame of their own, holding the newest of them.
      patch(frameId, { analysis, cycleIds, plans: {}, stepId: matches.at(-1)?.id ?? null, framed: true, status: "Placing them on the picture…" });
      onFramed?.(frameId);
      onAnalyzed?.({ frameId, concern, picture, image, marks: pixels, analysis, cycleIds });
      // Samples of each chosen site: the newest, the first and one between.
      const sites = analysis.sites.map(site => {
        const own = matches.filter(item => siteOf(item) === site.site), keep = new Set([...site.show, ...site.locate].map(path => path.replace(/^@/, "").split(".")[0]));
        const samples = [...new Set([own.at(-1), own[0], own[Math.floor(own.length / 2)]])].filter((item): item is ExecStep => Boolean(item))
          .map(item => ({ ...stepRecord(item), variables: compact(item.variables, keep) }));
        return { site: site.site, note: site.note, show: site.show, locate: site.locate, samples };
      });
      const plan = overlayPlanSchema.parse(await deps.request("trace-overlay", { ...base, trace: { concern, nodeIds, cycles: trace.cycles.length, sites, marks: pixels, analysis } }, frameId));
      const plans = checkedPlans(plan, analysis.sites.map(site => site.site));
      const missing = analysis.sites.filter(site => !plans[site.site]).length;
      patch(frameId, { plans, busy: false, status: missing ? `${missing} of the chosen steps could not be placed on the picture.` : "" });
    } catch (error) {
      patch(frameId, { busy: false, status: error instanceof Error ? error.message : "The inspection failed." });
    }
  }
  const shown = useMemo(() => shownPaths(view?.analysis ?? null), [view?.analysis]);
  const skipped = view ? Object.fromEntries(Object.entries(view.plans).filter(([, plan]) => !plan.code).map(([site, plan]) => [site, plan.skipReason])) : {};

  return {
    view, steps, step, restore, machine, skipped, onCycle, inspect,
    plan: step && view ? view.plans[siteOf(step)] : undefined,
    /** The variables shown on the picture at each chosen site (nothing else is labeled). */
    shown,
    open: (frameId: string) => setView(current => current?.frameId === frameId ? null : fresh(frameId)),
    close: () => setView(null),
    select: (stepId: number | null) => setView(current => current ? { ...current, stepId } : current),
    clearAnalysis: () => setView(current => current ? { ...current, analysis: null, cycleIds: null, plans: {}, status: "", overlayStatus: "" } : current),
    /** Follow the newest recording (after the brush was changed): the concern's sites in the newest cycles, the newest step held. */
    follow: () => setView(current => current ? { ...current, cycleIds: null, stepId: null } : current),
    /** The Execution frame was closed: steps are held on the inspected frame again. */
    unframe: () => setView(current => current ? { ...current, framed: false, stepId: null } : current),
    clearTrace: () => setView(current => current ? { ...current, trace: emptyTrace(), analysis: null, plans: {}, stepId: null, status: "" } : current),
    addMark: (points: { x: number; y: number }[]) => setView(current => current && points.length > 1 ? { ...current, marks: [...current.marks, points].slice(-24) } : current),
    clearMarks: () => setView(current => current ? { ...current, marks: [] } : current),
    setOverlayStatus: (message: string) => setView(current => current && current.overlayStatus !== message ? { ...current, overlayStatus: message } : current),
  };
}
