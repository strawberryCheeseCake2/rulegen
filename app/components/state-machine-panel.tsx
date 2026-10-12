import { useId, useState } from "react";
import type { SceneState, StateMachine, Parameter, RuleGroup, Feature } from "../lib/schema";
import { Icon } from "./icons";
import { NumberWidget } from "./subfeature-controls";

type Props = {
  machine: StateMachine | null; hasCode: boolean; selectedId: string | null; runtimeId: string | null; playing: boolean; busy: boolean; dirty: boolean;
  onGenerate: () => void; onJump: (id: string) => void; onPlay: (playing: boolean) => void; onRestart: () => void;
  onEvent: (id: string) => void; onState: (id: string, patch: Partial<Pick<SceneState, "label" | "description">>) => void;
  onFeature: (stateId: string, featureId: string, patch: Partial<Pick<Feature, "label" | "description">>) => void;
  onMethod: (stateId: string, featureId: string, subId: string, methodId: string) => void;
  onParameter: (stateId: string, featureId: string, subId: string, methodId: string, parameterId: string, value: Parameter["value"]) => void;
  onTransition: (id: string, patch: Partial<StateMachine["transitions"][number]>) => void; onApply: () => void;
};

function StateRuleControls({ stateId, group, name, props }: { stateId: string; group: RuleGroup; name: string; props: Props }) {
  return <div className="state-rule-group"><h4>{name}</h4>{group.subfeatures.map(sub => {
    const method = sub.implementations.find(item => item.id === sub.selectedImplementation)!;
    return <details key={sub.id} open className="state-subfeature"><summary>{sub.label}</summary>
      <label className="state-method"><span>Implementation</span><select aria-label={`${name} · ${sub.label} implementation`} value={sub.selectedImplementation} onChange={event => props.onMethod(stateId, group.featureId, sub.id, event.target.value)}>{sub.implementations.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <div className="state-parameters" key={`${stateId}-${method.id}`}>{method.parameters.map(parameter => {
        const label = `${name} · ${sub.label} · ${parameter.label}`;
        const change = (value: Parameter["value"]) => props.onParameter(stateId, group.featureId, sub.id, method.id, parameter.id, value);
        return <div key={parameter.id} className={`state-parameter parameter-${parameter.type}`}><span>{parameter.label}</span>
          {parameter.type === "number" && <NumberWidget parameter={parameter} label={label} onChange={change} />}
          {parameter.type === "color" && <span className="state-color"><input aria-label={label} type="color" value={parameter.value} onChange={event => change(event.target.value)} /><output>{parameter.value}</output></span>}
          {parameter.type === "select" && <select aria-label={label} value={parameter.value} onChange={event => change(event.target.value)}>{parameter.options.map(option => <option key={option} value={option}>{option}</option>)}</select>}
          {parameter.type === "toggle" && <button type="button" className={`parameter-switch ${parameter.value ? "on" : ""}`} role="switch" aria-label={label} aria-checked={parameter.value} onClick={() => change(!parameter.value)}><span /></button>}
        </div>;
      })}</div><p className="state-method-description">{method.description}</p>
    </details>;
  })}</div>;
}

export function StateMachinePanel(props: Props) {
  const marker = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [view, setView] = useState<"features" | "rules" | "transitions">("rules");
  const { machine, busy } = props;
  if (!machine) return <div className="machine-empty"><Icon name="grid" size={24} /><strong>No state machine</strong>{props.hasCode && <button disabled={busy} onClick={props.onGenerate}><Icon name="spark" size={14} />{busy ? "Generating…" : "Generate state machine"}</button>}</div>;
  const state = machine.states.find(item => item.id === props.selectedId) || machine.states.find(item => item.id === props.runtimeId) || machine.states.find(item => item.id === machine.initialState)!;
  const runtimeId = props.runtimeId || machine.initialState;
  const current = machine.states.find(item => item.id === runtimeId);
  const position = (id: string) => { const index = machine.states.findIndex(item => item.id === id); return { x: 32 + index % 3 * 320, y: 64 + Math.floor(index / 3) * 196 }; };
  const width = Math.min(3, machine.states.length) * 320 + 24, height = Math.ceil(machine.states.length / 3) * 196 + 64;
  return <div className="state-machine-body">
    <div className="machine-navigation">
      <div className="machine-toolbar"><div className="machine-live-state"><i />{current?.label}</div><span>{props.playing ? "Playing" : "Paused"}</span>
        <button aria-label={props.playing ? "Pause state machine" : "Play state machine"} title={props.playing ? "Pause" : "Play"} disabled={busy} onClick={() => props.onPlay(!props.playing)}><Icon name={props.playing ? "pause" : "play"} size={15} /></button>
        <button aria-label="Restart state machine" title="Restart" disabled={busy} onClick={props.onRestart}><Icon name="undo" size={15} /></button>
        <button className="machine-refine" aria-label="Generate detailed state machine" title="Regenerate with detailed states" disabled={busy} onClick={props.onGenerate}><Icon name="spark" size={13} />Refine states</button>
      </div>
      <div className="machine-graph-scroll"><div className="machine-graph" style={{ width, height }} role="group" aria-label="Scene states">
        <svg className="machine-edges" width={width} height={height} role="img" aria-label="Semantic state transitions"><defs><marker id={marker} markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0L7 3.5L0 7" fill="context-stroke" /></marker></defs>{machine.transitions.map((transition, index) => {
          const from = position(transition.from), to = position(transition.to);
          const sameRow = from.y === to.y, self = transition.from === transition.to;
          const x1 = from.x + (sameRow && to.x >= from.x ? 154 : 77), y1 = from.y + (sameRow && to.x > from.x ? 36 : 72);
          const x2 = to.x + (sameRow && to.x > from.x ? 0 : 77), y2 = to.y + (sameRow && to.x > from.x ? 36 : 0);
          const lane = index % 3 * 14;
          const path = self ? `M${from.x + 154} ${from.y + 20} C${from.x + 205} ${from.y - 46},${from.x + 80} ${from.y - 46},${from.x + 80} ${from.y}`
            : sameRow && to.x > from.x ? `M${x1} ${y1} C${x1 + 18} ${y1},${x2 - 18} ${y2},${x2} ${y2}`
            : sameRow ? `M${from.x + 77} ${from.y} C${from.x + 77} ${from.y - 46 - lane},${to.x + 77} ${to.y - 46 - lane},${to.x + 77} ${to.y}`
            : `M${x1} ${y1} C${x1} ${y1 + 28 + lane},${x2} ${y2 - 28},${x2} ${y2}`;
          const labelPoint = self ? { x: from.x + 136, y: from.y - 22 }
            : sameRow && to.x > from.x ? { x: (x1 + x2) / 2, y: y1 }
            : sameRow ? { x: (from.x + to.x) / 2 + 77, y: from.y - (46 + lane) * .75 }
            : { x: (x1 + x2) / 2, y: (y1 + y2) / 2 + lane * .375 };
          const chars = Array.from(transition.label), label = chars.length > 20 ? `${chars.slice(0, 19).join("")}…` : transition.label;
          const labelWidth = Math.min(180, Math.max(60, Array.from(label).reduce((sum, char) => sum + (char.charCodeAt(0) > 127 ? 10 : 5.5), 16)));
          const description = `${machine.states.find(item => item.id === transition.from)?.label} → ${machine.states.find(item => item.id === transition.to)?.label}: ${transition.label}`;
          return <g key={transition.id} className={`machine-transition-edge ${transition.from === runtimeId ? "active-transition" : ""}`}><title>{description}</title><path d={path} className={`transition-path ${transition.trigger === "event" ? "event-edge" : ""} ${transition.from === runtimeId ? "active-edge" : ""}`} markerEnd={`url(#${marker})`} /><g className="transition-label" transform={`translate(${labelPoint.x},${labelPoint.y})`}><rect x={-labelWidth / 2} y={-10} width={labelWidth} height={20} rx={4} /><text textAnchor="middle" dominantBaseline="central">{label}</text></g></g>;
        })}</svg>
        {machine.states.map(item => { const point = position(item.id); return <button key={item.id} className={`machine-state ${state.id === item.id ? "selected-state" : ""} ${runtimeId === item.id ? "current-state" : ""}`} style={{ left: point.x, top: point.y }} aria-label={`Jump to state ${item.label}`} aria-pressed={state.id === item.id} disabled={busy} onClick={() => props.onJump(item.id)}><span><i /><strong>{item.label}</strong></span><small>{item.features.length} features · {item.groups.length} rules{machine.initialState === item.id ? " · initial" : ""}</small></button>; })}
      </div></div>
      <div className="machine-events">{machine.transitions.filter(transition => transition.from === runtimeId && transition.trigger === "event").map(transition => <button key={transition.id} disabled={busy} onClick={() => props.onEvent(transition.id)}><Icon name="play" size={12} />{transition.label}<Icon name="arrow" size={12} /></button>)}</div>
    </div>
    <div className="state-constraints" key={state.id}>
      <header><strong>State constraints</strong><button disabled={busy} className={props.dirty ? "constraints-dirty" : ""} onClick={props.onApply}><Icon name="spark" size={13} />{busy ? "Applying…" : "Apply constraints"}</button></header>
      <div className="state-constraint-tabs" role="tablist" aria-label="State constraints view">{(["features", "rules", "transitions"] as const).map(tab => <button key={tab} role="tab" aria-selected={view === tab} onClick={() => setView(tab)}>{tab === "features" ? "Features" : tab === "rules" ? "Rules" : "Transitions"}</button>)}</div>
      <fieldset disabled={busy}>
        <details className="state-description"><summary>{state.label}</summary><input aria-label="State name" maxLength={100} value={state.label} onChange={event => { if (event.target.value.trim()) props.onState(state.id, { label: event.target.value }); }} /><textarea aria-label="State description" maxLength={1000} rows={2} value={state.description} onChange={event => props.onState(state.id, { description: event.target.value })} /></details>
        {view === "features" && <><h3>Visual features</h3>{state.features.map(feature => <div className="state-feature" key={feature.id}><input aria-label={`State feature ${feature.id} name`} maxLength={100} value={feature.label} onChange={event => { if (event.target.value.trim()) props.onFeature(state.id, feature.id, { label: event.target.value }); }} /><textarea aria-label={`State feature ${feature.id} description`} maxLength={600} rows={2} value={feature.description} onChange={event => props.onFeature(state.id, feature.id, { description: event.target.value })} /></div>)}</>}
        {view === "rules" && <>{state.groups.map(group => <StateRuleControls key={group.featureId} stateId={state.id} group={group} name={state.features.find(feature => feature.id === group.featureId)?.label || group.title} props={props} />)}{!state.groups.length && <p className="state-method-description">No rules</p>}</>}
        {view === "transitions" && <>{machine.transitions.filter(transition => transition.from === state.id).map(transition => <div className="state-transition" key={transition.id}><input className="transition-semantic-input" aria-label={`Transition ${transition.id} semantic label`} maxLength={100} value={transition.label} onChange={event => { if (event.target.value.trim()) props.onTransition(transition.id, { label: event.target.value }); }} /><strong><Icon name="arrow" size={12} />{machine.states.find(item => item.id === transition.to)?.label}</strong><select aria-label={`Transition ${transition.label} trigger`} value={transition.trigger} onChange={event => props.onTransition(transition.id, { trigger: event.target.value as "after" | "event" })}><option value="after">After delay</option><option value="event">Event</option></select>{transition.trigger === "after" && <label><input type="number" min={100} max={60000} step={100} aria-label={`Transition ${transition.label} delay`} value={transition.afterMs} onChange={event => { const value = event.currentTarget.valueAsNumber; if (Number.isFinite(value)) props.onTransition(transition.id, { afterMs: Math.max(100, Math.min(60000, Math.round(value))) }); }} /><span>ms</span></label>}</div>)}{!machine.transitions.some(transition => transition.from === state.id) && <p className="state-method-description">No outgoing transitions</p>}</>}
      </fieldset>
    </div>
  </div>;
}
