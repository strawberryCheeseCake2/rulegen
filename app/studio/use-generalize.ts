import { useRef, useState } from "react";
import type { StudioDeps } from "./deps";
import { manipSandbox } from "./use-manipulation";
import { generatedSchema } from "../lib/schema";
import { sceneProposalSchema } from "../lib/scene/validate";
import { liveSceneSource } from "../lib/scene/live";
import * as ops from "../lib/scene/panel-ops";
import { markBrushes } from "../lib/brushes";
import { annotatedResultImage } from "../lib/result-revisions";
import { siteOf, variableCatalog, type ExecTrace } from "../lib/execution/trace";
import { CANVAS_H, CANVAS_W, placedPoints, strokeFeatures } from "../lib/execution/strokes";
import { generalizeQuestion, generalizeRequest, generalizeSchema, type Demonstration, type Generalize } from "../lib/execution/generalize";

// Make what was shown with direct manipulation tools the brush's own rule (see lib/execution/generalize): AI lists the
// rules the demonstration could be, each previewed over the frame; the one picked is written into the original's model
// (constraints, params, states) and code, which then draws it everywhere with nothing shown.

export type GeneralizeStart = {
  /** The frame whose brush changes (the original). */
  frameId: string;
  /** The frame the demonstration was shown on (a temporary fork, or the frame itself with tools kept with it). */
  from: string;
  kind: "fork" | "kept";
  /** Kept tools: the set shown with (it goes once its rule is the brush's own). */
  setId?: string;
  demonstration: Demonstration;
  /** What the brush recorded while it drew with what was shown (may be empty). */
  trace: ExecTrace;
};
export type GeneralizeView = GeneralizeStart & {
  /** The original as it draws now (the previews are drawn over it), and the demonstration on its frame. */
  picture: string;
  shownImage: string;
  result: Generalize | null;
  previews: Record<string, { src: string; note: string }>;
  busy: boolean;
  status: string;
};

const THUMB = { w: 600, h: 400 };
const dataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob); });
/** The demonstration's strokes as annotations (normalized, at most 600 points each). */
const annotationsOf = (demo: Demonstration) => demo.strokes.map(stroke => ({ id: stroke.id, points: placedPoints(stroke).slice(0, 600)
  .map(point => ({ x: Math.min(1, Math.max(0, point.x / CANVAS_W)), y: Math.min(1, Math.max(0, point.y / CANVAS_H)) })) })).filter(item => item.points.length >= 2).slice(0, 128);
/** What the previews draw from: every site of the newest recorded cycle, as recorded at each visit. */
export function previewSites(trace: ExecTrace) {
  const out: Record<string, Record<string, unknown>[]> = {}, cycle = [...trace.cycles].reverse().find(item => item.steps.length);
  for (const step of cycle?.steps ?? []) {
    const site = siteOf(step), list = out[site] ?? (Object.keys(out).length < 40 ? out[site] = [] : null);
    if (list && list.length < 80) list.push(step.variables);
  }
  return out;
}

export function useGeneralize(deps: StudioDeps) {
  const [view, setView] = useState<GeneralizeView | null>(null);
  const viewRef = useRef(view); viewRef.current = view;
  /** Called once the original follows the rule picked (a fork session ends with it). */
  const done = useRef<(() => void) | null>(null);
  const patch = (from: string, change: Partial<GeneralizeView> | ((current: GeneralizeView) => Partial<GeneralizeView>)) =>
    setView(current => current && current.from === from ? { ...current, ...(typeof change === "function" ? change(current) : change) } : current);

  async function ask(from: string) {
    const current = viewRef.current;
    if (!current || current.from !== from) return;
    const base = deps.panel(from);
    if (!base.generated) { patch(from, { status: "This frame has no result to change." }); return; }
    patch(from, { busy: true, status: "Finding the rules what you showed could be…", result: null, previews: {} });
    try {
      const annotations = annotationsOf(current.demonstration);
      if (!annotations.length) throw new Error("Show something with the tools first.");
      const shown = (await deps.capture(from, true)).image, shownImage = await annotatedResultImage(shown, annotations);
      // The original as it draws now: the fork's original, or (tools kept with a frame) the frame itself.
      const picture = current.kind === "fork" ? (await deps.capture(current.frameId, true)).image : shown;
      const nodeIds = base.scene.nodes.map(node => node.id).slice(0, 64);
      const result = generalizeSchema.parse(await deps.request("trace-generalize", { scene: base.scene, previous: liveSceneSource(base.generated, base.scene), image: shownImage,
        ...(current.kind === "fork" ? { resultImage: picture } : {}), annotations, instruction: generalizeQuestion(current.demonstration),
        trace: { concern: current.demonstration.concern.slice(0, 2000) || "Make what was shown the brush's rule.", nodeIds, cycles: current.trace.cycles.length, sites: variableCatalog(current.trace).slice(-200), marks: [] } }, current.frameId));
      if (viewRef.current?.from !== from) return;
      patch(from, { picture, shownImage, result, busy: false, status: "" });
      void drawPreviews(from, result);
    } catch (error) {
      patch(from, { busy: false, status: error instanceof Error ? error.message : "Could not find the rules." });
    }
  }
  async function drawPreviews(from: string, result: Generalize) {
    const current = viewRef.current;
    if (!current) return;
    const data = { width: CANVAS_W, height: CANVAS_H, sites: previewSites(current.trace), strokes: current.demonstration.strokes.map(strokeFeatures), shown: current.demonstration.values };
    for (const option of result.options) {
      if (!option.thumbnail) continue;
      let preview: { src: string; note: string };
      try {
        const reply = await manipSandbox().run({ kind: "thumbnail", code: option.thumbnail, input: { ...THUMB, data } });
        preview = reply.blob instanceof Blob ? { src: reply.empty ? "" : await dataUrl(reply.blob), note: reply.empty ? "The preview drew nothing." : "" }
          : { src: "", note: `The preview could not be drawn: ${String(reply.error ?? "no image")}` };
      } catch (error) { preview = { src: "", note: `The preview could not be drawn: ${error instanceof Error ? error.message : String(error)}` }; }
      if (viewRef.current?.from !== from || viewRef.current.result !== result) return;
      patch(from, current => ({ previews: { ...current.previews, [option.id]: preview } }));
    }
  }

  return {
    view,
    /** Ask for the rules a demonstration could be (another one open is left). */
    start(info: GeneralizeStart, onDone?: () => void) {
      done.current = onDone ?? null;
      const next: GeneralizeView = { ...info, picture: "", shownImage: "", result: null, previews: {}, busy: false, status: "" };
      viewRef.current = next; setView(next);
      void ask(info.from);
    },
    /** The rule picked becomes the original's own: its model (revision) and its code, without the shown values. */
    async choose(optionId: string) {
      const current = viewRef.current, option = current?.result?.options.find(item => item.id === optionId);
      if (!current || !option || current.busy) return;
      const { frameId, from, demonstration } = current, base = deps.panel(from);
      if (!base.generated) return;
      const annotations = annotationsOf(demonstration), image = current.shownImage, instruction = generalizeRequest(demonstration, current.result!.question, option);
      const previous = liveSceneSource(base.generated, base.scene);
      patch(from, { busy: true, status: `Making "${option.rule}" the brush's rule: its constraints and states, then its code…` });
      let changed = false;
      await deps.task("Making what you showed the brush's rule…", async () => {
        const proposal = sceneProposalSchema.parse(await deps.request("revision", { image, annotations, scene: base.scene, previous, instruction }, frameId));
        const result = generatedSchema.parse(await deps.request("code", { scene: proposal.scene, previous, image, annotations, revisionSummary: proposal.summary, instruction }, frameId));
        await deps.request("prepare", { code: result.code }, frameId);
        if (viewRef.current?.from !== from) return;
        deps.updatePanel(frameId, latest => ({ ...ops.commitScene(latest, proposal.scene), generated: result, codeDraft: result.code, executable: "", preparedCode: "", runtimeError: "", runtimeStates: {}, dirtyNodeIds: [], hovered: null,
          // Its code no longer reads what this set shows.
          ...(current.kind === "kept" ? { keptTools: latest.keptTools.filter(set => set.id !== current.setId) } : {}) }));
        deps.refreshBrushCode?.(frameId, result.code);
        if (deps.brushesOf && !deps.brushesOf(frameId).length) {
          const made = deps.addBrushes(frameId, deps.panel(frameId).scene);
          if (made.length) deps.updatePanel(frameId, latest => ({ scene: markBrushes(latest.scene, made) }));
        }
        changed = true;
      }, frameId);
      if (!changed) { patch(from, { busy: false, status: "The brush could not be changed. Pick a rule again, or retry." }); return; }
      setView(null);
      deps.toast(`The brush now follows "${option.rule}" by itself.`);
      const after = done.current; done.current = null; after?.();
    },
    retry() { const current = viewRef.current; if (current && !current.busy) void ask(current.from); },
    close: () => { done.current = null; setView(null); },
  };
}
export type GeneralizeActions = ReturnType<typeof useGeneralize>;
