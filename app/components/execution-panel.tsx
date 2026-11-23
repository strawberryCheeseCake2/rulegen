import { useEffect, useMemo, useRef, useState } from "react";
import { thumbKey, useStepThumbnails } from "./step-thumbnails";
import type { RestorePoint } from "./code-preview";
import { formatValue, pathLabel, readPath, siteOf, type Analysis, type ExecStep, type ExecTrace } from "../lib/execution/trace";

// The execution of one brush, as recorded: its cycles and their steps (FSM state visits, constraints, transitions),
// every variable at the step looked at, and a concern that selects the steps and variables that explain it (shown
// on the picture by the overlay). ← → step, ⇧← ⇧→ cycle.

export type ExecutionPanelProps = {
  brushName: string;
  trace: ExecTrace;
  recording: boolean;
  /** The steps the timeline goes through: the concern's matches, else every recorded step. */
  steps: ExecStep[];
  /** The step looked at (null: live). */
  step: ExecStep | null;
  analysis: Analysis | null;
  busy: boolean;
  status: string;
  /** Why a site shows nothing on the picture (by site). */
  skipped: Record<string, string>;
  onSelect: (stepId: number | null) => void;
  /**
   * stepping: step through the concern's recorded steps in an Execution frame; else a temporary fork is made with tools for it.
   * sandbox: also a mini sandbox of the part of the brush the concern is about, with handles for its params.
   */
  onInspect: (concern: string, stepping: boolean, tools: boolean, sandbox: boolean) => void;
  onClearAnalysis: () => void;
  /** Inspection annotation marks drawn on the picture (sent with the concern). */
  marks: number;
  onClearMarks: () => void;
  onClearTrace: () => void;
  onClose: () => void;
  /** Draws thumbnails of the steps (the result as execution had made it at each): the frame's code and how a step is held. */
  thumbnails?: { executable: string; restoreOf: (step: ExecStep) => RestorePoint | null };
};
/** How many steps around the one looked at get thumbnails. */
const THUMB_REACH = 60;

function Value({ value, depth = 0 }: { value: unknown; depth?: number }) {
  const [open, setOpen] = useState(depth === 0 && Array.isArray(value) ? value.length <= 4 : false);
  if (value === null || typeof value !== "object") return <output className="exec-value" title={String(value)}>{formatValue(value, 120)}</output>;
  const entries = Array.isArray(value) ? value.map((item, i) => [String(i), item] as const) : Object.entries(value as Record<string, unknown>);
  return <details className="exec-tree" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>{Array.isArray(value) ? `[${value.length}]` : `{${entries.length}}`} <span>{formatValue(value, 60)}</span></summary>
    {open && <dl>{entries.map(([key, item]) => <div key={key}><dt>{key}</dt><dd><Value value={item} depth={depth + 1} /></dd></div>)}</dl>}
  </details>;
}

const KIND_MARK = { state: "◆", constraint: "▸", transition: "→" } as const;
const noRestore = () => null;

export function ExecutionPanel(props: ExecutionPanelProps) {
  const { trace, steps, step, analysis } = props;
  const [concern, setConcern] = useState("");
  const [stepping, setStepping] = useState(false), [tools, setTools] = useState(true), [sandbox, setSandbox] = useState(false);
  const index = step ? steps.findIndex(item => item.id === step.id) : -1;
  const go = (to: number) => { const target = steps[Math.max(0, Math.min(steps.length - 1, to))]; if (target) props.onSelect(target.id); };
  const cycleJump = (direction: 1 | -1) => {
    if (!steps.length) return;
    const from = index < 0 ? steps.length - 1 : index;
    const startOf = (at: number) => { let k = at; while (k > 0 && steps[k - 1].cycle === steps[at].cycle) k--; return k; };
    if (direction < 0) { const start = startOf(from); go(start < from && index >= 0 ? start : start > 0 ? startOf(start - 1) : 0); }
    else { let k = from; while (k < steps.length && steps[k].cycle === steps[from].cycle) k++; go(Math.min(k, steps.length - 1)); }
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const direction = event.key === "ArrowLeft" ? -1 : 1;
      if (event.shiftKey) cycleJump(direction);
      else go(index < 0 ? (direction < 0 ? steps.length - 1 : steps.length - 1) : index + direction);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const site = step ? analysis?.sites.find(item => item.site === siteOf(step)) : undefined;
  const chosen = site?.show ?? [];
  const variables = step ? Object.entries(step.variables) : [];
  // The timeline shows a window of steps around the one looked at (the newest when live).
  const focus = index < 0 ? steps.length - 1 : index, from = Math.max(0, Math.min(focus - 120, steps.length - 240)), shown = steps.slice(from, from + 240);
  // Thumbnails for the steps shown, nearest to the one looked at first.
  const wanted = useMemo(() => shown.map((item, i) => ({ item, distance: Math.abs(from + i - focus) })).filter(entry => entry.distance <= THUMB_REACH)
    .sort((a, b) => a.distance - b.distance).map(entry => entry.item), [shown, from, focus]);
  // The current step is kept in view inside the timeline only (scrollIntoView would also scroll the panel and the page).
  const timeline = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const list = timeline.current, row = step && list ? list.querySelector<HTMLElement>(`[data-step="${CSS.escape(String(step.id))}"]`) : null;
    if (!list || !row) return;
    const top = row.offsetTop, bottom = top + row.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
  }, [step?.id]);
  const cycleCount = trace.cycles.length, stepCount = trace.cycles.reduce((n, cycle) => n + cycle.steps.length, 0);
  const { thumbs, renderer } = useStepThumbnails(props.thumbnails?.executable ?? "", props.thumbnails ? wanted : [], props.thumbnails?.restoreOf ?? noRestore, stepCount === 0);
  return <aside className="exec-panel" aria-label="Execution">
    <header className="exec-head">
      <div><span className="section-kicker">EXECUTION</span><strong>{props.brushName}</strong></div>
      <span className={`exec-recording ${props.recording ? "on" : ""}`} title={props.recording ? "Recording: a cycle is kept whenever what the frame is drawn from changes" : "Not recording"}>{props.recording ? "● REC" : "○"} {cycleCount} cycles · {stepCount} steps</span>
      <button type="button" className="exec-close" onClick={props.onClose} aria-label="Close">×</button>
    </header>
    <form className="exec-concern" onSubmit={event => { event.preventDefault(); if (concern.trim()) props.onInspect(concern.trim(), stepping, tools, sandbox); }}>
      <textarea value={concern} onChange={event => setConcern(event.target.value)} placeholder="What do you want to understand? e.g. why do the stamps get smaller at the end?" rows={2} />
      <div>
        <label className="exec-stepping" title={stepping ? "Choose the steps and variables that explain it and step through them in an Execution frame" : "Make a temporary fork of this frame with tools for the concern: what you show with them changes the fork at once, and only the values they set are shown on it"}>
          <input type="checkbox" checked={stepping} onChange={event => setStepping(event.target.checked)} />Execution stepping</label>
        {!stepping && <label className="exec-stepping" title={tools ? "Make direct manipulation tools for the concern on the fork: what you show with them changes it" : "No tools: the fork is changed to meet the concern at once"}>
          <input type="checkbox" checked={tools} onChange={event => setTools(event.target.checked)} />Make tools</label>}
        <label className="exec-stepping" title="Also take the part of the brush this is about out on its own (as Decompose would, only that part) into a frame of its own, with direct manipulation handles for its params">
          <input type="checkbox" checked={sandbox} onChange={event => setSandbox(event.target.checked)} />Mini sandbox &amp; handles</label>
        <button type="submit" className="exec-button primary" disabled={props.busy || !concern.trim() || !stepCount}>{props.busy ? "Inspecting…" : stepping ? "Inspect" : tools ? "Make tools" : "Change on a fork"}</button>
        {analysis && <button type="button" className="exec-button" onClick={props.onClearAnalysis}>All steps</button>}
        <button type="button" className="exec-button" onClick={props.onClearTrace} disabled={!stepCount}>Clear record</button>
      </div>
      {props.marks > 0 && <p className="exec-marks-note">✎ {props.marks} mark{props.marks === 1 ? "" : "s"} on the picture go with the concern<button type="button" className="exec-button" onClick={props.onClearMarks}>Clear marks</button></p>}
      {props.status && <p className="exec-status">{props.status}</p>}
    </form>
    {analysis && <div className="exec-summary"><p>{analysis.summary}</p>
      {analysis.sites.map(item => <p key={item.site} className={step && siteOf(step) === item.site ? "current" : ""}><b>{item.site.replace(/^[a-z]+:/, "")}</b> {item.note}{props.skipped[item.site] ? <em> — {props.skipped[item.site]}</em> : null}</p>)}
    </div>}
    <div className="exec-nav">
      <button type="button" onClick={() => cycleJump(-1)} disabled={!steps.length} title="Previous cycle (⇧←)">⇤</button>
      <button type="button" onClick={() => go(index < 0 ? steps.length - 1 : index - 1)} disabled={!steps.length || index === 0} title="Previous step (←)">◀</button>
      <output>{index < 0 ? `Live · ${steps.length}` : `${index + 1} / ${steps.length}`}</output>
      <button type="button" onClick={() => go(index + 1)} disabled={!steps.length || index < 0 || index >= steps.length - 1} title="Next step (→)">▶</button>
      <button type="button" onClick={() => cycleJump(1)} disabled={!steps.length} title="Next cycle (⇧→)">⇥</button>
      <button type="button" className={index < 0 ? "active" : ""} onClick={() => props.onSelect(null)}>Live</button>
    </div>
    {steps.length > 1 && <input className="exec-slider" type="range" aria-label="Step" min={0} max={steps.length - 1} value={index < 0 ? steps.length - 1 : index}
      onChange={event => go(Number(event.target.value))} />}
    <ol className="exec-timeline" ref={timeline}>
      {from > 0 && <li className="exec-empty">… {from} earlier steps</li>}
      {shown.map((item, i) => <li key={item.id} data-step={item.id} className={`${item.id === step?.id ? "current" : ""} ${from + i > 0 && steps[from + i - 1].cycle !== item.cycle ? "cycle-start" : ""}`}>
        <button type="button" onClick={() => props.onSelect(item.id)} title={`Cycle ${item.cycle} · visit ${item.visit}`}>
          {props.thumbnails && (thumbs[thumbKey(item)] ? <img className="exec-thumb" src={thumbs[thumbKey(item)]} alt="" /> : <i className={`exec-thumb ${thumbKey(item) in thumbs ? "none" : "pending"}`} />)}
          <span>{KIND_MARK[item.kind]}</span><b>{item.label}</b></button>
      </li>)}
      {!steps.length && <li className="exec-empty">{props.recording ? "Use the brush on this frame: every frame it draws differently is recorded as a cycle." : "Play this frame's brush to record its execution."}</li>}
    </ol>
    {step && <section className="exec-vars">
      <h3>{KIND_MARK[step.kind]} {step.label}<small>cycle {step.cycle} · visit {step.visit}</small></h3>
      {chosen.length > 0 && <dl className="exec-chosen">{chosen.map(path => <div key={path}><dt title={path}>{pathLabel(path)}</dt><dd><Value value={readPath(step, path)} /></dd></div>)}</dl>}
      <details className="exec-all" open={!chosen.length}>
        <summary>All variables ({variables.length})</summary>
        <dl>{variables.map(([name, value]) => <div key={name}><dt>{pathLabel("@" + name)}</dt><dd><Value value={value} /></dd></div>)}</dl>
      </details>
    </section>}
    {renderer}
  </aside>;
}
