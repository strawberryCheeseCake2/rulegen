import { useId } from "react";
import type { NodeMachine } from "../../lib/scene/schema";

type Props = { machine: NodeMachine; selectedId: string | null; runtimeId: string; busy: boolean; onState: (id: string) => void; summary: (stateId: string) => string };

const position = (index: number) => ({ x: 32 + index % 3 * 320, y: 64 + Math.floor(index / 3) * 196 });

/** States laid out on a grid with semantic transition labels on the edges. */
export function MachineGraph({ machine, selectedId, runtimeId, busy, onState, summary }: Props) {
  const marker = useId().replace(/[^a-zA-Z0-9]/g, "");
  const at = (id: string) => position(machine.states.findIndex(item => item.id === id));
  const width = Math.min(3, machine.states.length) * 320 + 24, height = Math.ceil(machine.states.length / 3) * 196 + 64;
  return <div className="machine-graph-scroll"><div className="machine-graph" style={{ width, height }} role="group" aria-label="Node states">
    <svg className="machine-edges" width={width} height={height} role="img" aria-label="Semantic state transitions"><defs><marker id={marker} markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0L7 3.5L0 7" fill="context-stroke" /></marker></defs>{machine.transitions.map((transition, index) => {
      const from = at(transition.from), to = at(transition.to);
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
    {machine.states.map(item => { const point = at(item.id); return <button key={item.id} className={`machine-state ${selectedId === item.id ? "selected-state" : ""} ${runtimeId === item.id ? "current-state" : ""}`} style={{ left: point.x, top: point.y }} aria-label={`Jump to state ${item.label}`} aria-pressed={selectedId === item.id} disabled={busy} onClick={() => onState(item.id)}><span><i /><strong>{item.label}</strong></span><small>{summary(item.id)}{machine.initialState === item.id ? " · initial" : ""}</small></button>; })}
  </div></div>;
}
