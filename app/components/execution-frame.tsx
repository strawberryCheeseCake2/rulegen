import type { ReactNode } from "react";
import { CodePreview, type RestorePoint } from "./code-preview";
import { ExecutionOverlay } from "./execution-overlay";
import { ExecutionMarks } from "./execution-marks";
import type { SitePlan } from "../lib/execution/overlay";
import { siteOf, type Analysis, type ExecStep } from "../lib/execution/trace";

// The Execution frame of an inspected frame: the brush's code run on its own and held at a recorded step of the
// concern (drawn as execution had made it there), the chosen variables on the picture, the annotation it was asked
// with, and the controls to step through the concern's steps (← → step, ⇧← ⇧→ cycle). The inspected frame stays live.

type Props = {
  executable: string;
  steps: ExecStep[];
  step: ExecStep | null;
  restore: RestorePoint | null;
  analysis: Analysis | null;
  plan: SitePlan | undefined;
  /** The variables shown on the picture at each chosen site. */
  shown: Record<string, string[]>;
  marks: { x: number; y: number }[][];
  markColor: string;
  busy: boolean;
  status: string;
  /** Why the chosen variables are not on the picture at this step (empty when they are). */
  overlayStatus: string;
  /** Direct manipulation strokes over the picture. */
  layer?: ReactNode;
  onSelect: (stepId: number | null) => void;
  onOverlayStatus: (message: string) => void;
  onError: (message: string) => void;
};

const KIND_MARK = { state: "◆", constraint: "▸", transition: "→" } as const;

export function ExecutionFrame(props: Props) {
  const { steps, step } = props;
  const index = step ? steps.findIndex(item => item.id === step.id) : -1;
  const go = (to: number) => { const target = steps[Math.max(0, Math.min(steps.length - 1, to))]; if (target) props.onSelect(target.id); };
  const cycleStart = (at: number) => { let k = at; while (k > 0 && steps[k - 1].cycle === steps[at].cycle) k--; return k; };
  const prevCycle = () => { if (index < 0) return; const start = cycleStart(index); go(start < index ? start : start > 0 ? cycleStart(start - 1) : 0); };
  const nextCycle = () => { if (index < 0) return; let k = index; while (k < steps.length && steps[k].cycle === steps[index].cycle) k++; go(Math.min(k, steps.length - 1)); };
  const note = step && props.analysis?.sites.find(site => site.site === siteOf(step))?.note;
  return <div className="exec-frame">
    <div className="exec-frame-picture">
      {props.executable ? <CodePreview executable={props.executable} onError={props.onError} restore={props.restore ?? undefined} playing={false} />
        : <div className="frame-render-status"><strong>Preparing p5.js…</strong></div>}
      {step && <ExecutionOverlay steps={steps} step={step} plan={props.plan} shown={props.shown} onStatus={props.onOverlayStatus} />}
      <ExecutionMarks marks={props.marks} active={false} color={props.markColor} onAdd={() => undefined} />
      {props.layer}
      {props.busy && <div className="frame-render-badge" role="status"><span className="loading-spinner" />{props.status || "Inspecting…"}</div>}
    </div>
    <div className="exec-frame-bar" onPointerDown={event => event.stopPropagation()}>
      <button type="button" onClick={prevCycle} disabled={index <= 0} title="Previous cycle (⇧←)">⇤</button>
      <button type="button" onClick={() => go(index - 1)} disabled={index <= 0} title="Previous step (←)">◀</button>
      <div className="exec-frame-step">
        <strong>{step ? <>{KIND_MARK[step.kind]} {step.label}</> : steps.length ? "—" : "No recorded step matches yet"}</strong>
        <span>{step ? `step ${index + 1} / ${steps.length} · cycle ${step.cycle} · visit ${step.visit}` : ""}{note ? ` — ${note}` : ""}</span>
        {props.overlayStatus && !props.busy && <em>{props.overlayStatus}</em>}
      </div>
      <button type="button" onClick={() => go(index + 1)} disabled={index < 0 || index >= steps.length - 1} title="Next step (→)">▶</button>
      <button type="button" onClick={nextCycle} disabled={index < 0 || index >= steps.length - 1} title="Next cycle (⇧→)">⇥</button>
      <input type="range" aria-label="Step" min={0} max={Math.max(0, steps.length - 1)} value={Math.max(0, index)} disabled={steps.length < 2} onChange={event => go(Number(event.target.value))} />
    </div>
  </div>;
}
