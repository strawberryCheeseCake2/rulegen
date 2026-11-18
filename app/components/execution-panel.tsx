import { useEffect, useState } from "react";
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
  onInspect: (concern: string) => void;
  onClearAnalysis: () => void;
  /** Inspection annotation marks drawn on the picture (sent with the concern). */
  marks: number;
  onClearMarks: () => void;
  onClearTrace: () => void;
  onClose: () => void;
};

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

export function ExecutionPanel(props: ExecutionPanelProps) {
  const { trace, steps, step, analysis } = props;
  const [concern, setConcern] = useState("");
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
  const cycleCount = trace.cycles.length, stepCount = trace.cycles.reduce((n, cycle) => n + cycle.steps.length, 0);
  return <aside className="exec-panel" aria-label="Execution">
    <header className="exec-head">
      <div><span className="section-kicker">EXECUTION</span><strong>{props.brushName}</strong></div>
      <span className={`exec-recording ${props.recording ? "on" : ""}`} title={props.recording ? "Recording: a cycle is kept whenever what the frame is drawn from changes" : "Not recording"}>{props.recording ? "● REC" : "○"} {cycleCount} cycles · {stepCount} steps</span>
      <button type="button" className="exec-close" onClick={props.onClose} aria-label="Close">×</button>
    </header>
    <form className="exec-concern" onSubmit={event => { event.preventDefault(); if (concern.trim()) props.onInspect(concern.trim()); }}>
      <textarea value={concern} onChange={event => setConcern(event.target.value)} placeholder="What do you want to understand? e.g. why do the stamps get smaller at the end?" rows={2} />
      <div>
        <button type="submit" className="exec-button primary" disabled={props.busy || !concern.trim() || !stepCount}>{props.busy ? "Inspecting…" : "Inspect"}</button>
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
    <ol className="exec-timeline">
      {from > 0 && <li className="exec-empty">… {from} earlier steps</li>}
      {shown.map((item, i) => <li key={item.id} ref={item.id === step?.id ? node => node?.scrollIntoView({ block: "nearest" }) : undefined} className={`${item.id === step?.id ? "current" : ""} ${from + i > 0 && steps[from + i - 1].cycle !== item.cycle ? "cycle-start" : ""}`}>
        <button type="button" onClick={() => props.onSelect(item.id)} title={`Cycle ${item.cycle} · visit ${item.visit}`}><span>{KIND_MARK[item.kind]}</span>{item.label}</button>
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
  </aside>;
}
