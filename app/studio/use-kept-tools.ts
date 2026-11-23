import { useEffect, useMemo, useRef, useState } from "react";
import type { StudioDeps } from "./deps";
import { sceneEdits } from "./scene-actions";
import { placeAnalysis } from "./use-execution";
import { manipSandbox, type ForkOverlay, type LayerTool } from "./use-manipulation";
import { liveSceneSource } from "../lib/scene/live";
import { sceneBindings, sceneValues } from "../lib/scene/values";
import { addCycle, analysisSchema, emptyTrace, nextIds, readCycle, shownPaths, siteOf, variableCatalog, type ExecTrace } from "../lib/execution/trace";
import { demoKey, everyItem, liveConcern, paramValue, pinsItem, recordedAt, summarize } from "../lib/execution/manipulate";
import { demoValues, MAX_KEPT_STROKES, type KeptToolSet } from "../lib/execution/kept-tools";
import type { GeneralizeStart } from "./use-generalize";
import { shownText } from "../lib/execution/generalize";
import { CANVAS_H, CANVAS_W, paintedMask, strokeFeatures, toggleProbe, type ManipStroke, type Point } from "../lib/execution/strokes";

// Tools kept with a frame (from a kept fork), used on the frame itself: what is shown with them is measured into the
// values its code reads (m.demo) or its params, and the frame redraws at once; the inspect tool shows those values on
// its picture (the fork's placement of them, or placed again for the frame when there is none).

export type KeptActive = { frameId: string; setId: string; tool: LayerTool };

export function useKeptTools(deps: StudioDeps) {
  const [active, setActive] = useState<KeptActive | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [probes, setProbes] = useState<Point[]>([]);
  const [recorded, setRecorded] = useState<{ frameId: string; trace: ExecTrace; from: number }>({ frameId: "", trace: emptyTrace(), from: 0 });
  const [status, setStatus] = useState("");
  /** The marks shown with the tools are hidden on the frame for now (what they show still applies). */
  const [hidden, setHidden] = useState(false);
  const activeRef = useRef(active); activeRef.current = active;
  const set = active ? deps.panel(active.frameId).keptTools.find(item => item.id === active.setId) : undefined;
  // A set or frame that is gone takes its tool with it.
  useEffect(() => { if (active && !set) setActive(null); }, [active, set]);

  const update = (frameId: string, setId: string, change: (set: KeptToolSet) => Partial<KeptToolSet>) =>
    deps.updatePanel(frameId, latest => ({ keptTools: latest.keptTools.map(item => item.id === setId ? { ...item, ...change(item) } : item) }));
  const updateActive = (change: (set: KeptToolSet) => Partial<KeptToolSet>) => { const now = activeRef.current; if (now) update(now.frameId, now.setId, change); };

  // What the strokes show, measured whenever they change: values the code reads with m.demo, and params set at once.
  const strokes = set?.strokes;
  useEffect(() => {
    if (!active || !set) return;
    const { frameId, setId } = active, shown = set.strokes, targets = set.targets, rule = set.rule;
    const timer = setTimeout(async () => {
      const features = shown.map(strokeFeatures), mask = paintedMask(shown), trace = recorded.frameId === frameId ? recorded.trace : emptyTrace();
      const measured: Record<string, unknown> = {};
      for (const target of targets) {
        const newest = trace.cycles.flatMap(cycle => cycle.steps).filter(step => siteOf(step) === target.site).at(-1);
        const reply = await manipSandbox().run({ kind: "measure", code: target.measure, input: { strokes: features, mask, recorded: recordedAt(trace, target.site, target.path).slice(0, 64),
          variables: newest?.variables ?? {}, rule, width: CANVAS_W, height: CANVAS_H } });
        measured[target.id] = reply.error ? null : reply.value ?? null;
      }
      const now = deps.panel(frameId).keptTools.find(item => item.id === setId);
      if (!now || now.strokes !== shown) return;
      const panel = deps.panel(frameId), bindings = sceneBindings(panel.scene), values = sceneValues(panel.scene);
      for (const target of targets) {
        const binding = target.param && bindings.find(item => item.key === target.param), value = measured[target.id];
        if (!binding || value === undefined || value === null) continue;
        const param = panel.scene.nodes.find(item => item.id === binding.nodeId)?.constraints.flatMap(item => item.params).find(item => item.id === binding.path[0]);
        const fit = param && paramValue(value, param.value.type === "select" ? { type: "select", options: param.value.options } : { type: param.value.type });
        if (fit !== undefined && values[target.param] !== fit) sceneEdits(deps, frameId).scalar(binding.nodeId, binding.path[0], binding.path.slice(1), fit);
      }
      update(frameId, setId, () => ({ values: demoValues(targets, measured) }));
    }, 160);
    return () => clearTimeout(timer);
  }, [active?.frameId, active?.setId, strokes]);

  // The inspect tool: the frame is recorded while it is in use, and the values the tools set are shown on it.
  const inspecting = active?.tool === "inspect" ? active.frameId : null;
  useEffect(() => { if (inspecting) setRecorded({ frameId: inspecting, trace: emptyTrace(), from: 0 }); }, [inspecting]);
  const pending = useRef<unknown[]>([]), timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const onCycle = (frameId: string, raw: unknown) => {
    if (activeRef.current?.frameId !== frameId) return;
    pending.current.push(raw);
    if (timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      const items = pending.current; pending.current = [];
      setRecorded(current => {
        if (current.frameId !== frameId) return current;
        let trace = current.trace;
        for (const item of items) { const ids = nextIds(trace), cycle = readCycle(item, ids.cycle, ids.step); if (cycle && cycle.steps.length) trace = addCycle(trace, cycle); }
        return { ...current, trace };
      });
    }, 200);
  };
  // Kept without the fork's placement (or one showing only one item of a list): placed again for the frame, once it has recorded.
  const placing = useRef("");
  useEffect(() => {
    if (!inspecting || !set || (set.analysis && !pinsItem(set.analysis)) || !recorded.trace.cycles.length || placing.current === set.id) return;
    const frameId = inspecting, setId = set.id, concern = liveConcern(set.concern, set.targets), trace = recorded.trace;
    placing.current = setId; setStatus("Finding where the values go on the picture…");
    void (async () => {
      try {
        const panel = deps.panel(frameId);
        if (!panel.generated) return;
        const nodeIds = panel.scene.nodes.map(node => node.id).slice(0, 64);
        const base = { scene: panel.scene, previous: liveSceneSource(panel.generated, panel.scene), image: (await deps.capture(frameId, true)).image };
        const analysis = everyItem(analysisSchema.parse(await deps.request("trace-analyze", { ...base, trace: { concern, nodeIds, cycles: trace.cycles.length, sites: variableCatalog(trace).slice(-200), marks: [], analysis: null } }, frameId)));
        const plans = await placeAnalysis(deps, frameId, { base, trace, concern, nodeIds, marks: [], analysis });
        update(frameId, setId, () => ({ analysis, plans }));
        setStatus("");
      } catch (error) {
        setStatus(`The values could not be shown: ${error instanceof Error ? error.message : "inspection failed"}`);
      } finally { placing.current = ""; }
    })();
  }, [inspecting, set?.analysis, recorded.trace]);

  /** The overlays on the frame while inspecting: one per site the tools set (its newest step in the newest cycle). */
  const overlays: ForkOverlay[] = useMemo(() => {
    if (!inspecting || !set?.analysis) return [];
    const cycle = [...recorded.trace.cycles].reverse().find(item => item.steps.length);
    if (!cycle) return [];
    const sites = new Set(set.analysis.sites.map(site => site.site)), steps = cycle.steps.filter(step => sites.has(siteOf(step))).slice(-600);
    return set.analysis.sites.flatMap(site => { const step = steps.filter(item => siteOf(item) === site.site).at(-1); return step ? [{ site: site.site, step, steps, plan: set.plans[site.site] }] : []; });
  }, [inspecting, recorded.trace, set?.analysis, set?.plans]);
  const shown = useMemo(() => shownPaths(set?.analysis ?? null), [set?.analysis]);

  return {
    active, set, selected, probes, overlays, shown, status, onCycle, hidden,
    toggleMarks: () => { setHidden(value => !value); setSelected(null); },
    /** Use a kept tool on its frame (the same again: stop). */
    use(frameId: string, setId: string, tool: LayerTool) {
      setSelected(null); setStatus("");
      setActive(current => current && current.frameId === frameId && current.setId === setId && current.tool === tool ? null : { frameId, setId, tool });
      if (tool !== "inspect") setProbes([]);
    },
    stop: () => { setActive(null); setSelected(null); setProbes([]); setStatus(""); },
    add: (stroke: ManipStroke) => updateActive(item => ({ strokes: [...item.strokes, stroke].slice(-MAX_KEPT_STROKES) })),
    change: (stroke: ManipStroke) => updateActive(item => ({ strokes: item.strokes.map(old => old.id === stroke.id ? stroke : old) })),
    select: setSelected,
    removeSelected: () => { const id = selected; if (id) { updateActive(item => ({ strokes: item.strokes.filter(old => old.id !== id) })); setSelected(null); } },
    /** Nothing shown with a set any more (its values back to none). */
    clear: (frameId: string, setId: string) => { update(frameId, setId, () => ({ strokes: [] })); setSelected(null); },
    /** Forget a set of tools (the code keeps reading its values as none). */
    remove: (frameId: string, setId: string) => {
      deps.updatePanel(frameId, latest => ({ keptTools: latest.keptTools.filter(item => item.id !== setId) }));
      if (activeRef.current?.setId === setId) setActive(null);
    },
    probe: (at: Point) => setProbes(current => toggleProbe(current, at)),
    /** What is shown with a set on its frame (values, what the frame drew with them if it was recorded, strokes), to make it the brush's own rule. */
    generalizeSource(frameId: string, setId: string): GeneralizeStart | null {
      const panel = deps.panel(frameId), set = panel.keptTools.find(item => item.id === setId);
      if (!set || !set.strokes.length) return null;
      const trace = recorded.frameId === frameId ? recorded.trace : emptyTrace(), values = sceneValues(panel.scene);
      const value = (target: KeptToolSet["targets"][number]) => target.param ? values[target.param] ?? null : set.values[demoKey(target.id)] ?? null;
      return { frameId, from: frameId, kind: "kept", setId, trace, demonstration: { concern: set.concern, rule: set.rule, tools: set.tools,
        targets: set.targets.map(target => { const drawn = trace.cycles.length && target.site ? summarize(recordedAt(trace, target.site, target.path), 600) : "";
          return { id: target.id, name: target.name, where: target.site ? `${target.site} ${target.path}` : "", param: target.param, meaning: target.meaning, shown: shownText(value(target)).slice(0, 600), drawn: drawn === "—" ? "" : drawn }; }),
        values: Object.fromEntries(set.targets.map(target => [target.id, value(target)])), strokes: set.strokes } };
    },
  };
}
export type KeptTools = ReturnType<typeof useKeptTools>;
