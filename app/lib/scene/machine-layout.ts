import type { MachineMark, MachineTarget } from "../schema";
import type { NodeMachine } from "./schema";

// Layout of a node's state machine graph, shared by the panel and the
// snapshot image sent to AI when the user refines the machine.

export const STATE_WIDTH = 154, STATE_HEIGHT = 72;
type Point = { x: number; y: number };
export type GraphStroke = Point[];
export type StateBox = { id: string; label: string; x: number; y: number; initial: boolean };
export type EdgeLayout = { id: string; label: string; fullLabel: string;
  /** The label wrapped to fit its box (never cut), and the box's height. */
  lines: string[]; labelHeight: number; event: string; from: string; to: string;
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
    const label = transition.label, lines = wrapLabel(label);
    const labelWidth = Math.max(60, ...lines.map(line => textWidth(line) + 16)), labelHeight = lines.length * LINE_HEIGHT + 8;
    const name = (id: string) => machine.states.find(item => item.id === id)?.label;
    return { id: transition.id, label, fullLabel: transition.label, lines, labelHeight, event: transition.event, from: transition.from, to: transition.to, curve,
      labelPoint: middle, labelWidth, description: `${name(transition.from)} → ${name(transition.to)}: ${transition.label} (event “${transition.event}”)` };
  });
  const width = Math.max(320, ...states.map(state => state.x + STATE_WIDTH + 24), ...edges.map(edge => edge.labelPoint.x + edge.labelWidth / 2 + 24));
  const height = Math.max(160, ...states.map(state => state.y + STATE_HEIGHT + 32), ...edges.map(edge => edge.labelPoint.y + edge.labelHeight / 2 + 22));
  return { width, height, states, edges };
}

/** Transition labels: wrapped (at spaces, or anywhere in words without them) to at most LABEL_MAX wide, never cut. */
const LABEL_MAX = 180, LINE_HEIGHT = 13;
const charWidth = (char: string) => char.charCodeAt(0) > 127 ? 10 : 5.5;
const textWidth = (text: string) => Array.from(text).reduce((sum, char) => sum + charWidth(char), 0);
export function wrapLabel(text: string, max = LABEL_MAX - 16) {
  const lines: string[] = [];
  let line = "";
  for (const word of text.trim().split(/(\s+)/).filter(Boolean)) {
    if (/^\s+$/.test(word)) { if (line) line += " "; continue; }
    if (textWidth(line + word) <= max) { line += word; continue; }
    if (line.trim()) { lines.push(line.trim()); line = ""; }
    // A word wider than a line is broken by characters.
    for (const char of Array.from(word)) { if (line && textWidth(line + char) > max) { lines.push(line); line = ""; } line += char; }
  }
  if (line.trim()) lines.push(line.trim());
  return lines.length ? lines : [""];
}
/** The baseline of line i of a label, centered in its box. */
export const lineY = (edge: Pick<EdgeLayout, "lines">, i: number) => (i - (edge.lines.length - 1) / 2) * LINE_HEIGHT;

export const bezier = ([a, b, c, d]: EdgeLayout["curve"], t: number) => {
  const u = 1 - t, k = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return { x: k[0] * a.x + k[1] * b.x + k[2] * c.x + k[3] * d.x, y: k[0] * a.y + k[1] * b.y + k[2] * c.y + k[3] * d.y };
};
const near = (p: Point, box: { x: number; y: number; w: number; h: number }, pad: number) => p.x >= box.x - pad && p.x <= box.x + box.w + pad && p.y >= box.y - pad && p.y <= box.y + box.h + pad;

/** The states and transitions an annotation stroke touches, as readable references. */
export function strokeTargets(layout: MachineLayout, stroke: GraphStroke) {
  const hits: string[] = [];
  for (const state of layout.states) if (stroke.some(p => near(p, { x: state.x, y: state.y, w: STATE_WIDTH, h: STATE_HEIGHT }, 16))) hits.push(`state ${state.id} “${state.label}”`);
  for (const edge of layout.edges) {
    const samples = Array.from({ length: 21 }, (_, i) => bezier(edge.curve, i / 20));
    const label = { x: edge.labelPoint.x - edge.labelWidth / 2, y: edge.labelPoint.y - edge.labelHeight / 2, w: edge.labelWidth, h: edge.labelHeight };
    if (stroke.some(p => near(p, label, 10) || samples.some(s => Math.hypot(s.x - p.x, s.y - p.y) < 14))) hits.push(`transition ${edge.id} “${edge.fullLabel}”`);
  }
  return hits.slice(0, 16);
}

/** Bounds of the graph plus every annotation stroke (strokes may go past the grid). */
export function snapshotBounds(layout: MachineLayout, strokes: GraphStroke[]) {
  // Labels can be dragged above/left of the grid, and self loops rise above their state.
  const points = [...strokes.flat(), ...layout.edges.flatMap(edge => [{ x: edge.labelPoint.x - edge.labelWidth / 2, y: edge.labelPoint.y - edge.labelHeight / 2 },
    { x: edge.labelPoint.x + edge.labelWidth / 2, y: edge.labelPoint.y + edge.labelHeight / 2 }, ...edge.curve])];
  const x = Math.min(0, ...points.map(p => p.x - 12)), y = Math.min(0, ...points.map(p => p.y - 12));
  const right = Math.max(layout.width, ...points.map(p => p.x + 12)), bottom = Math.max(layout.height, ...points.map(p => p.y + 12));
  return { x, y, w: right - x, h: bottom - y };
}

/** Annotation strokes for AI: points normalized to the snapshot image and the items each touches. */
export function machineMarks(layout: MachineLayout, strokes: GraphStroke[]): MachineMark[] {
  const box = snapshotBounds(layout, strokes);
  return strokes.slice(0, 64).map(stroke => {
    const step = Math.max(1, Math.ceil(stroke.length / 64));
    const points = stroke.filter((_, i) => i % step === 0).slice(0, 64).map(p => ({ x: Math.min(1, Math.max(0, (p.x - box.x) / box.w)), y: Math.min(1, Math.max(0, (p.y - box.y) / box.h)) }));
    return { points, targets: strokeTargets(layout, stroke) };
  });
}

const escape = (text: string) => text.replace(/[&<>"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[char]!);

/** A standalone SVG of the graph, the attached item and the annotation (rasterized before sending). */
export function machineSnapshotSvg(layout: MachineLayout, strokes: GraphStroke[], target: MachineTarget | null) {
  const box = snapshotBounds(layout, strokes), font = "font-family=\"Inter, Arial, 'Apple SD Gothic Neo', sans-serif\"";
  const picked = (kind: MachineTarget["kind"], id: string) => target?.kind === kind && target.id === id;
  const edges = layout.edges.map(edge => {
    const on = picked("transition", edge.id), color = on ? "#e07b00" : "#8fa79a";
    return `<path d="${curvePath(edge.curve)}" fill="none" stroke="${color}" stroke-width="${on ? 3 : 1.4}" marker-end="url(#${on ? "arrow-on" : "arrow"})"/>`
      + `<g transform="translate(${edge.labelPoint.x},${edge.labelPoint.y})"><rect x="${-edge.labelWidth / 2}" y="${-edge.labelHeight / 2}" width="${edge.labelWidth}" height="${edge.labelHeight}" rx="4" fill="#fffefa" stroke="${on ? "#e07b00" : "#c9d6cd"}" stroke-width="${on ? 2.5 : .8}"/>`
      + `<text text-anchor="middle" dominant-baseline="central" font-size="10" fill="#4f6b5c" ${font}>${edge.lines.map((line, i) => `<tspan x="0" y="${lineY(edge, i)}">${escape(line)}</tspan>`).join("")}</text></g>`;
  }).join("");
  const states = layout.states.map(state => {
    const on = picked("state", state.id);
    return `<rect x="${state.x}" y="${state.y}" width="${STATE_WIDTH}" height="${STATE_HEIGHT}" rx="6" fill="#ffffff" stroke="${on ? "#e07b00" : "#b9c9bf"}" stroke-width="${on ? 3.5 : 1}"/>`
      + `<text x="${state.x + 12}" y="${state.y + 30}" font-size="12" font-weight="600" fill="#24342b" ${font}>${escape(Array.from(state.label).slice(0, 18).join(""))}</text>`
      + `<text x="${state.x + 12}" y="${state.y + 52}" font-size="9" fill="#7d8e84" ${font}>${escape(state.id)}${state.initial ? " · initial" : ""}</text>`;
  }).join("");
  const marks = strokes.map(stroke => `<polyline points="${stroke.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")}" fill="none" stroke="#ff5a4e" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(box.w)}" height="${Math.ceil(box.h)}" viewBox="${box.x} ${box.y} ${box.w} ${box.h}">`
    + `<defs><marker id="arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0L7 3.5L0 7" fill="#8fa79a"/></marker><marker id="arrow-on" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0L7 3.5L0 7" fill="#e07b00"/></marker></defs>`
    + `<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" fill="#fbfcfa"/>${edges}${states}${marks}</svg>`;
}

/** Browser only: the snapshot SVG as a PNG data URL (at most 1600px wide). */
export async function rasterizeSnapshot(svg: string) {
  const size = /width="(\d+)" height="(\d+)"/.exec(svg)!, width = Number(size[1]), height = Number(size[2]);
  const scale = Math.min(2, 1600 / width, 1600 / height);
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale); ctx.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL("image/png");
}
