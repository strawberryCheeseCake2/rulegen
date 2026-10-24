import { useEffect, useMemo, useRef, useState } from "react";
import { CodePreview, type ExecutionRun } from "./code-preview";
import { InspectionOverlay } from "./inspection-overlay";
import { Icon } from "./icons";
import { EXEC_KEY, exploreStep, inputPath, LAST_ROOT, NEXT_ROOT, PATH_ROOT, previewKey, RUN_ROOT, gestureRange, runStores, stageCounts, STEPS_ROOT, stepOp, type ExploreFrame } from "../lib/explore";
import { formatScalar, handleGrips, stepContext, type InspectionState, type InspectResult, type Overlay, type Scalar } from "../lib/inspection";
import type { ScalarValue } from "../lib/scene/schema";

type Props = {
  frame: ExploreFrame; zoom: number;
  /** The spec of each value of the brush a handle may change (its constraints). */
  specs: Record<string, ScalarValue>;
  /** What each value is called (for the list of values tried here). */
  labelOf: (key: string) => string;
  /** The program's keys a dragged value is drawn with (a preview value: one per stamp of the brush). */
  expand: (key: string) => string[];
  onProgress: (progress: number) => void;
  /** A value dragged in this frame (null: back to how the frame started). */
  onValue: (key: string, value: Scalar | null) => void;
  onRetry: () => void; onActivate: () => void;
};
type Step = { label: string; none: number; op: number; step: number };
/** Canvas pixels a hand moves before a gesture counts (and the least distance from a pivot a gesture can be measured by). */
const STEP_SLOP = 12;
/** A plain grip on the next step: dragging it any way executes that step. */
const nextStepGrip = (link: Overlay["link"], stage: string | undefined): Overlay => ({ id: "@next-step", kind: "ellipse", name: "다음 단계", x: 's("@next", "cx") - 14', y: 's("@next", "cy") - 14', w: "28", h: "28", label: "",
  color: "#2a4f86", link, when: "", each: "", handle: { key: EXEC_KEY, gesture: "drag", x: 's("@next", "cx")', y: 's("@next", "cy")', pivotX: "", pivotY: "", value: "start + max(abs(dx), abs(dy)) / 40", hint: `끌어서 ${stage ?? "다음 단계"} 실행` } });

/**
 * An exploration frame: the brush marks of the step the inspection held, run by
 * their own copy of the program and held still, with the frame's handles over them.
 * Execution of the code's run goes STEP BY STEP: each step is one internal operation
 * (a checkpoint the code passes), executed or taken back one at a time with the
 * operation's own metaphoric handle (or the step buttons); the picture shows what is
 * drawn by then over a faint picture of the finished marks, and the step just executed
 * and the next one say what they do. Execution can also go along the recorded input or
 * the recorded steps. Value handles redraw it with the value. Nothing outside this
 * frame changes.
 */
export function ExploreFrameView({ frame, zoom, specs, labelOf, expand, onProgress, onValue, onRetry, onActivate }: Props) {
  const result = frame.result, execution = frame.mode === "execution", running = result?.axis === "run";
  // The code's run as last recorded (its events do not depend on how much of it is drawn).
  const [run, setRun] = useState<ExecutionRun | null>(null);
  const step = exploreStep(frame, running ? run : null), stepwise = running && step.done !== null && step.count !== null;
  const done = step.done ?? 0, count = step.count ?? 0;
  const params = { ...frame.base.params, ...Object.fromEntries(Object.entries(frame.values).flatMap(([key, value]) => expand(key).map(each => [each, value]))) };
  const restoreId = `${frame.id}:${step.key}`;
  const [drawn, setDrawn] = useState<{ restore: string; stores: Record<string, unknown> } | null>(null);
  // The finished marks (the whole run drawn), shown faintly while execution is partway.
  const [ghost, setGhost] = useState(""), budget = useRef(step.budget); budget.current = step.budget;
  const path = useMemo(() => inputPath(frame.base.runtime), [frame.base.runtime]);
  const traced = useMemo(() => stepwise && run ? runStores(run, done) : null, [stepwise, run, done]);
  // The overlays read the stores as this moment is drawn now and the path execution goes along: the run's steps
  // (every event and step, the next and the last one), or the recorded input.
  const stores = { ...(drawn?.restore === restoreId ? drawn.stores : {}),
    ...(traced ? { [RUN_ROOT]: traced[RUN_ROOT], [STEPS_ROOT]: traced[STEPS_ROOT], [NEXT_ROOT]: traced[NEXT_ROOT], [LAST_ROOT]: traced[LAST_ROOT], [PATH_ROOT]: traced.path } : { [PATH_ROOT]: path }) };
  const next = traced?.[NEXT_ROOT] as Step | undefined, last = traced?.[LAST_ROOT] as Step | undefined;
  const counts = useMemo(() => run && stepwise ? stageCounts(run, done) : new Map<number, { count: number; done: number; first: number }>(), [run, stepwise, done]);
  const stageOf = (op: number) => result?.stages.find(stage => stage.op === op);
  const currentOp = run && stepwise ? stepOp(run, Math.min(done, count - 1)) : 0;
  // A preview's new values, as the program starts with them.
  const previews = Object.fromEntries((result?.values ?? []).map(value => [previewKey(value), value.value.value]));
  // The execution value handles read and change: steps done (step by step), else the progress.
  const position = stepwise ? done : frame.progress;
  const state: InspectionState = { brushId: frame.brushId, cursor: 0, marks: [], markStyles: [], concern: "", focus: null,
    steps: [{ id: 1, at: 0, nodeId: null, from: null, to: null, transitionId: null, values: { ...step.values, ...previews, ...params, ...frame.values, [EXEC_KEY]: position }, runtime: step.runtime }] };
  // Every step can be executed by hand: when no handle of the next step's operation can be placed there (its gesture
  // reads data the step does not have), a plain grip on the step does it.
  const unhandled = Boolean(result && stepwise && next && !next.none
    && !handleGrips(result.overlays, stepContext(state.steps, 0, {}, stores)).some(grip => grip.handle.key === EXEC_KEY));
  const overlays = result ? [...result.overlays, ...(unhandled ? [nextStepGrip(result.overlays[0]?.link ?? { kind: "constraint", nodeId: frame.nodeIds[0] ?? "", id: "" }, stageOf(next!.op)?.name)] : [])] : [];
  const shown: InspectResult | null = result && { summary: result.summary, overlays: overlays as InspectResult["overlays"], valueFixes: [], recommendations: [], parameters: [], records: null };
  const from = result?.from ?? 0, to = result?.to ?? 1;
  const allSpecs: Record<string, ScalarValue> = { ...specs, ...Object.fromEntries((result?.values ?? []).map(value => [previewKey(value), value.value])),
    [EXEC_KEY]: stepwise ? { type: "number", value: done, min: 0, max: count, step: 1, unit: "" } : { type: "number", value: frame.progress, min: from, max: to, step: .001, unit: "" } };
  /** Execute (or take back) up to `target` steps done. */
  const goTo = (target: number) => { if (stepwise) onProgress(Math.max(0, Math.min(count, Math.round(target))) / Math.max(1, count)); };
  // Play: one step at a time (or the progress through the process), from where it is (the start, when it is at the end).
  const [playing, setPlaying] = useState(false), latest = useRef({ done, count, progress: frame.progress, goTo, onProgress }); latest.current = { done, count, progress: frame.progress, goTo, onProgress };
  useEffect(() => {
    if (!playing) return;
    if (stepwise) {
      const timer = setInterval(() => { const now = latest.current; if (now.done >= now.count) { setPlaying(false); return; } now.goTo(now.done + 1); }, 700);
      return () => clearInterval(timer);
    }
    let previous = performance.now(), id = 0;
    const tick = (time: number) => {
      const value = Math.min(to, latest.current.progress + (to - from) * (time - previous) / 4000); previous = time;
      latest.current.onProgress(value);
      if (value >= to) { setPlaying(false); return; }
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [playing, stepwise]);
  const play = () => { if (!playing && (stepwise ? done >= count : frame.progress >= to)) { if (stepwise) goTo(0); else onProgress(from); } setPlaying(!playing); };
  const tried = Object.entries(frame.values);
  // The steps the handle being dragged may reach (fixed when the drag starts): one step forward or back, unless its operation is one continuous motion.
  // A drag that has executed (or taken back) its step keeps that until it is released (`latched`), so moving on never undoes it.
  const block = useRef<{ range: [number, number]; start: number; many: boolean; latched: number | null } | null>(null);
  return <div className={`explore-frame-surface explore-${frame.mode}`} tabIndex={-1} onPointerDownCapture={onActivate}
    onKeyDown={e => { if (!stepwise || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return; e.preventDefault(); e.stopPropagation(); setPlaying(false);
      goTo(e.key === "ArrowLeft" ? done - 1 : e.key === "ArrowRight" ? done + 1 : e.key === "Home" ? 0 : count); }}>
    {frame.executable ? <CodePreview executable={frame.executable} onError={() => {}} restore={{ id: restoreId, runtime: step.runtime, params, ...(running ? { run: { budget: step.budget, roots: frame.nodeIds } } : {}) }}
      onCapture={image => { if (running && budget.current === null) setGhost(image); }}
      onDrawn={(restore, stored, recorded) => { setDrawn({ restore, stores: stored }); if (recorded) setRun(recorded); }} />
      : <div className="frame-render-status"><span className="loading-spinner" /><strong>Preparing the preview…</strong></div>}
    {stepwise && ghost && step.budget !== null && <img className="explore-ghost" src={ghost} alt="" aria-hidden="true" />}
    {shown && <InspectionOverlay state={state} marks={[]} result={shown} drawn={stores} liveValues={{}} clickable zoom={zoom} onFocus={() => {}} plain specs={allSpecs}
      onHandle={(phase, key, value, _item, _each, motion) => {
        if (phase === "start") { setPlaying(false); const many = Boolean(run && stageOf(stepOp(run, done))?.many);
          block.current = stepwise && run ? { range: gestureRange(run, done, many), start: done, many, latched: null } : null; }
        if (value !== null) {
          // One gesture executes (or takes back) one step of its operation, never into another operation.
          if (key === EXEC_KEY) {
            if (stepwise) {
              const drag = block.current ?? { range: [0, count] as [number, number], start: done, many: false, latched: null };
              if (drag.latched !== null) return;
              // A hand still settling is no step; a gesture that cannot measure itself (its pivot on the grip) runs one step forward once clearly dragged.
              const target = Math.max(drag.range[0], Math.min(drag.range[1], !motion || motion.moved < STEP_SLOP ? drag.start : motion.reach < STEP_SLOP ? drag.start + 1 : Number(value)));
              if (!drag.many && target !== drag.start) drag.latched = target;
              goTo(target);
            } else onProgress(Number(value));
          }
          else onValue(key, value);
        }
        if (phase === "end") block.current = null;
      }} />}
    <div className="explore-bar" onPointerDown={e => e.stopPropagation()}>
      <span className="section-kicker">{execution ? "EXECUTION · STEP BY STEP" : "KEY PARAMETERS"} · {frame.source.kind === "cause" ? "원인" : frame.source.title}</span>
      {frame.status === "loading" && <span className="explore-status" role="status"><span className="loading-spinner" />{execution ? "AI가 내부 동작을 단계로 나누고 단계마다 실행할 gesture를 만들고 있습니다…" : "AI가 핵심 파라미터 손잡이를 만들고 있습니다…"}</span>}
      {frame.status === "error" && <span className="explore-status error" role="alert">{frame.error}<button onClick={onRetry}>다시 시도</button></span>}
      {result && <p>{result.summary}</p>}
      {result && execution && running && !stepwise && <span className="explore-status" role="status"><span className="loading-spinner" />코드 실행을 단계로 기록하고 있습니다…</span>}
      {/* Step by step: execute or take back one internal operation at a time; what was just done and what comes next. */}
      {result && execution && stepwise && <>
        <div className="explore-stepper" role="group" aria-label="Execution steps">
          <button aria-label="Back to the first step" title="처음 (Home)" disabled={done <= 0} onClick={() => { setPlaying(false); goTo(0); }}><Icon name="undo" size={12} /></button>
          <button aria-label="Take back one step" title="한 단계 되돌리기 (←)" disabled={done <= 0} onClick={() => { setPlaying(false); goTo(done - 1); }}>◀</button>
          <output>단계 <b>{done}</b> / {count}</output>
          <button aria-label="Execute one step" title="한 단계 실행 (→)" className="primary" disabled={done >= count} onClick={() => { setPlaying(false); goTo(done + 1); }}>▶ 한 단계</button>
          <button aria-label="Execute all steps" title="끝까지 (End)" disabled={done >= count} onClick={() => { setPlaying(false); goTo(count); }}>⏭</button>
          <button aria-label={playing ? "Pause stepping" : "Play step by step"} title={playing ? "Pause" : "한 단계씩 재생"} onClick={play}><Icon name={playing ? "pause" : "play"} size={12} /></button>
        </div>
        <div className="explore-step-now">
          <span><em>방금 실행</em>{last && !last.none ? <><b>{last.label || `단계 ${done}`}</b>{stageOf(last.op) && <i>{stageOf(last.op)!.name}</i>}</> : "아직 아무것도 실행하지 않았습니다"}</span>
          <span><em>다음</em>{next && !next.none ? <><b>{next.label || `단계 ${done + 1}`}</b>{stageOf(next.op) && <i>{stageOf(next.op)!.name}</i>}</> : "모든 단계를 실행했습니다"}</span>
        </div>
        {/* The kinds of operation the run is made of: how far each is, and what it does (the one now explained). */}
        {result.stages.length > 0 && <div className="explore-stages">{result.stages.map(stage => { const entry = counts.get(stage.op);
          return <button key={stage.op} className={stage.op === currentOp ? "current" : ""} disabled={!entry} title={stage.explain}
            onClick={() => { setPlaying(false); if (entry) goTo(entry.first); }}>{stage.name}<small>{entry ? `${entry.done}/${entry.count}` : "0"}</small></button>; })}</div>}
        {stageOf(currentOp)?.explain && <span className="explore-explain">{stageOf(currentOp)!.explain}</span>}
      </>}
      {result && execution && !running && <div className="explore-scrub">
        <button aria-label={playing ? "Pause execution" : "Play execution"} title={playing ? "Pause" : "Play the process"} onClick={play}><Icon name={playing ? "pause" : "play"} size={12} /></button>
        <input type="range" aria-label="Execution progress" min={from} max={to} step={.001} value={Math.min(to, Math.max(from, frame.progress))} onChange={e => { setPlaying(false); onProgress(e.currentTarget.valueAsNumber); }} />
        <output>{Math.round((frame.progress - from) / Math.max(.001, to - from) * 100)}%</output>
      </div>}
      {result && !execution && tried.length > 0 && <div className="explore-values">{tried.map(([key, value]) => <span key={key}>{labelOf(key)} <b>{typeof value === "number" ? formatScalar(value) : String(value)}</b>
        <button aria-label={`Reset ${labelOf(key)}`} title="Back to the start value" onClick={() => onValue(key, null)}><Icon name="close" size={9} /></button></span>)}</div>}
    </div>
  </div>;
}
