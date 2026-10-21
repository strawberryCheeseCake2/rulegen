import type { NodeMachine } from "./schema";

// Layout of a node's state machine graph, shared by the panel and the
// snapshot image sent to AI when the user refines the machine.

export const STATE_WIDTH = 154, STATE_HEIGHT = 72;
type Point = { x: number; y: number };
export type GraphStroke = Point[];
export type StateBox = { id: string; label: string; x: number; y: number; initial: boolean };
export type EdgeLayout = { id: string; label: string; fullLabel: string; event: boolean; from: string; to: string;
  /** Cubic Bézier: start, control 1, control 2, end. */
  curve: [Point, Point, Point, Point]; labelPoint: Point; labelWidth: number; description: string };
export type MachineLayout = { width: number; height: number; states: StateBox[]; edges: EdgeLayout[] };

export const statePosition = (index: number) => ({ x: 32 + index % 3 * 320, y: 64 + Math.floor(index / 3) * 196 });
export const curvePath = ([a, b, c, d]: EdgeLayout["curve"]) => `M${a.x} ${a.y} C${b.x} ${b.y},${c.x} ${c.y},${d.x} ${d.y}`;
/** User-moved positions: states absolute, transition labels as an offset from the curve's middle. */
export type LayoutOverride = { states: Record<string, Point>; labels: Record<string, Point> };
export const emptyLayoutOverride = (): LayoutOverride => ({ states: {}, labels: {} });

/** Where a ray from a state's center toward `toward` leaves its box. */
function boxExit(center: Point, toward: Point) {
  const dx = toward.x - center.x, dy = toward.y - center.y;
  if (!dx && !dy) return center;
  const scale = Math.min(dx ? STATE_WIDTH / 2 / Math.abs(dx) : Infinity, dy ? STATE_HEIGHT / 2 / Math.abs(dy) : Infinity);
  return { x: center.x + dx * scale, y: center.y + dy * scale };
}

/**
 * States on a 3-column grid unless moved; transitions are curves between the
 * box edges (parallel and opposite edges bend apart) with their labels in the middle.
 */
export function machineLayout(machine: NodeMachine, override: LayoutOverride = emptyLayoutOverride()): MachineLayout {
  const states = machine.states.map((state, i) => ({ id: state.id, label: state.label, ...(override.states[state.id] || statePosition(i)), initial: machine.initialState === state.id }));
  const byId = new Map(states.map(state => [state.id, state]));
  const center = (id: string) => { const box = byId.get(id) || states[0]; return { x: box.x + STATE_WIDTH / 2, y: box.y + STATE_HEIGHT / 2 }; };
  const seen = new Map<string, number>();
  const edges = machine.transitions.map((transition): EdgeLayout => {
    const key = `${transition.from}→${transition.to}`, lane = seen.get(key) || 0; seen.set(key, lane + 1);
    let curve: EdgeLayout["curve"];
    if (transition.from === transition.to) {
      const box = byId.get(transition.from) || states[0], lift = 46 + lane * 22;
      curve = [{ x: box.x + STATE_WIDTH, y: box.y + 20 }, { x: box.x + STATE_WIDTH + 51, y: box.y - lift }, { x: box.x + 80, y: box.y - lift }, { x: box.x + 80, y: box.y }];
    } else {
      const a = center(transition.from), b = center(transition.to), s = boxExit(a, b), e = boxExit(b, a);
      const length = Math.hypot(e.x - s.x, e.y - s.y) || 1, normal = { x: -(e.y - s.y) / length, y: (e.x - s.x) / length };
      // Opposite directions get opposite normals, so A→B and B→A never overlap.
      const bend = (22 + lane * 18) * 4 / 3;
      curve = [s, { x: s.x + (e.x - s.x) * .25 + normal.x * bend, y: s.y + (e.y - s.y) * .25 + normal.y * bend },
        { x: s.x + (e.x - s.x) * .75 + normal.x * bend, y: s.y + (e.y - s.y) * .75 + normal.y * bend }, e];
    }
    // A moved label bends its arrow so the curve still passes through the label.
    const auto = bezier(curve, .5), offset = override.labels[transition.id] || { x: 0, y: 0 };
    const middle = { x: auto.x + offset.x, y: auto.y + offset.y };
    if (offset.x || offset.y) {
      if (transition.from === transition.to) {
        // Shifting both control points by 4/3·offset moves the curve's middle by exactly the offset.
        const [a, b, c, d] = curve, k = 4 / 3;
        curve = [a, { x: b.x + offset.x * k, y: b.y + offset.y * k }, { x: c.x + offset.x * k, y: c.y + offset.y * k }, d];
      } else {
        // The ends leave the boxes toward the label; controls are placed so B(½) = label.
        const s = boxExit(center(transition.from), middle), e = boxExit(center(transition.to), middle);
        const lift = { x: (middle.x - (s.x + e.x) / 2) / .75, y: (middle.y - (s.y + e.y) / 2) / .75 };
        curve = [s, { x: s.x + (e.x - s.x) * .25 + lift.x, y: s.y + (e.y - s.y) * .25 + lift.y }, { x: s.x + (e.x - s.x) * .75 + lift.x, y: s.y + (e.y - s.y) * .75 + lift.y }, e];
      }
    }
    const chars = Array.from(transition.label), label = chars.length > 20 ? `${chars.slice(0, 19).join("")}…` : transition.label;
    const labelWidth = Math.min(180, Math.max(60, Array.from(label).reduce((sum, char) => sum + (char.charCodeAt(0) > 127 ? 10 : 5.5), 16)));
    const name = (id: string) => machine.states.find(item => item.id === id)?.label;
    return { id: transition.id, label, fullLabel: transition.label, event: transition.trigger === "event", from: transition.from, to: transition.to, curve,
      labelPoint: middle, labelWidth, description: `${name(transition.from)} → ${name(transition.to)}: ${transition.label}` };
  });
  const width = Math.max(320, ...states.map(state => state.x + STATE_WIDTH + 24), ...edges.map(edge => edge.labelPoint.x + edge.labelWidth / 2 + 24));
  const height = Math.max(160, ...states.map(state => state.y + STATE_HEIGHT + 32), ...edges.map(edge => edge.labelPoint.y + 32));
  return { width, height, states, edges };
}

export const bezier = ([a, b, c, d]: EdgeLayout["curve"], t: number) => {
  const u = 1 - t, k = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return { x: k[0] * a.x + k[1] * b.x + k[2] * c.x + k[3] * d.x, y: k[0] * a.y + k[1] * b.y + k[2] * c.y + k[3] * d.y };
};
