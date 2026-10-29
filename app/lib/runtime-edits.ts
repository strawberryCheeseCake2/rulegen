/**
 * Handles that change the running sketch's state at the step looked at, not only its values: the user moves the
 * recorded input (bends the stroke the brush was drawn with) or a value the code keeps in its store, and the step is
 * drawn again from the changed state, so the mechanism (what overlaps, what is near, what crosses a threshold) can be
 * tried by hand. The change is a what-if value of the step like any other (its `edits`, a frame's `values`), under a
 * key that names the state it changes:
 *
 * - `@input:<g>` the whole gesture `g`, `@input:<g>:<at>` one point of it (the gesture bends around it, its ends stay):
 *   `g` its index in the recorded input (negative: from the last), `at` a point index (negative: from the end) or,
 *   written with a dot, a fraction of the gesture's length (`0.5`: halfway);
 * - `@store:<root>:<path>` a number, or a point (`{ x, y }`), in the store of the module drawn at `root`.
 *
 * A move (gesture `"move"`) is kept as `"dx,dy"`, a number as itself.
 */
type Scalar = number | string | boolean;

export const INPUT_KEY = "@input:", STORE_KEY = "@store:";
export const isRuntimeKey = (key: string) => key.startsWith(INPUT_KEY) || key.startsWith(STORE_KEY);

type Point = { x: number; y: number };
export type RuntimeTarget = { kind: "input"; gesture: number; at: { index: number } | { fraction: number } | null } | { kind: "store"; root: string; path: string[] };

/** What a runtime key changes; null when it is not one (or is malformed). */
export function runtimeTarget(key: string): RuntimeTarget | null {
  if (key.startsWith(INPUT_KEY)) {
    const [gesture, at, extra] = key.slice(INPUT_KEY.length).split(":");
    if (extra !== undefined || !/^-?\d+$/.test(gesture ?? "")) return null;
    if (at === undefined) return { kind: "input", gesture: Number(gesture), at: null };
    if (/^-?\d+$/.test(at)) return { kind: "input", gesture: Number(gesture), at: { index: Number(at) } };
    const fraction = Number(at);
    return at.includes(".") && Number.isFinite(fraction) && fraction >= 0 && fraction <= 1 ? { kind: "input", gesture: Number(gesture), at: { fraction } } : null;
  }
  if (key.startsWith(STORE_KEY)) {
    const rest = key.slice(STORE_KEY.length), cut = rest.indexOf(":");
    const root = cut > 0 ? rest.slice(0, cut) : "", path = cut > 0 ? rest.slice(cut + 1).split(".").filter(Boolean) : [];
    return root && path.length ? { kind: "store", root, path } : null;
  }
  return null;
}

/** A move as it is kept ("dx,dy", to a tenth of a pixel), and read back (none: no move). */
export const moveValue = (dx: number, dy: number) => `${Math.round(dx * 10) / 10},${Math.round(dy * 10) / 10}`;
export function parseMove(value: Scalar | null | undefined): Point {
  const [dx, dy] = typeof value === "string" ? value.split(",").map(Number) : [NaN, NaN];
  return Number.isFinite(dx) && Number.isFinite(dy) ? { x: dx, y: dy } : { x: 0, y: 0 };
}

const isPoint = (value: unknown): value is Point => Boolean(value) && typeof value === "object" && Number.isFinite((value as Point).x) && Number.isFinite((value as Point).y);
const wrap = (index: number, length: number) => index < 0 ? length + index : index;
/** One step down a store path (a negative array index counts from the end). */
const child = (value: unknown, part: string): unknown => {
  if (Array.isArray(value) && /^-?\d+$/.test(part)) return value[wrap(Number(part), value.length)];
  return value && typeof value === "object" ? (value as Record<string, unknown>)[part] : undefined;
};
type Gesture = { id?: number; rev?: number; points: Point[] };
const gesturesOf = (history: unknown): Gesture[] => Array.isArray(history) ? history.filter((g): g is Gesture => Boolean(g) && Array.isArray((g as Gesture).points)) : [];
/** Distance along the points, at each point. */
const lengths = (points: Point[]) => points.reduce<number[]>((out, q, i) => [...out, i ? out[i - 1] + Math.hypot(q.x - points[i - 1].x, q.y - points[i - 1].y) : 0], []);
/** The point index a target names in a gesture (a fraction: the point nearest that far along). */
function pointIndex(points: Point[], at: { index: number } | { fraction: number }) {
  if (!points.length) return -1;
  if ("index" in at) { const i = wrap(at.index, points.length); return i >= 0 && i < points.length ? i : -1; }
  const along = lengths(points), goal = along[along.length - 1] * at.fraction;
  let best = 0; for (let i = 1; i < along.length; i++) if (Math.abs(along[i] - goal) < Math.abs(along[best] - goal)) best = i;
  return best;
}

/** Where a target is now (the grip of a move): a gesture's point (its middle, for the whole gesture) or a store's point. */
export function targetPoint(key: string, stores: Record<string, unknown>, history: unknown): Point | null {
  const target = runtimeTarget(key); if (!target) return null;
  if (target.kind === "store") { const value = target.path.reduce(child, stores[target.root]); return isPoint(value) ? { x: value.x, y: value.y } : null; }
  const gestures = gesturesOf(history), g = gestures[wrap(target.gesture, gestures.length)];
  if (!g) return null;
  const i = pointIndex(g.points, target.at ?? { fraction: .5 }), q = g.points[i];
  return isPoint(q) ? { x: q.x, y: q.y } : null;
}
/** The number a store target holds now (NaN when it holds none). */
export function targetNumber(key: string, stores: Record<string, unknown>) {
  const target = runtimeTarget(key); if (target?.kind !== "store") return NaN;
  const value = target.path.reduce(child, stores[target.root]);
  return typeof value === "number" ? value : NaN;
}

const hash = (text: string) => { let h = 0; for (let i = 0; i < text.length; i++) h = (Math.imul(h, 31) + text.charCodeAt(i)) >>> 0; return h % 1000003; };
/** Move one gesture: all of it, or bend it around one point (nearby points follow, less with distance; its ends stay). */
function moveGesture(g: Gesture, at: RuntimeTarget & { kind: "input" }, move: Point, key: string): Gesture {
  if (!move.x && !move.y) return g;
  const n = g.points.length, i = at.at ? pointIndex(g.points, at.at) : -1;
  if (at.at && i < 0) return g;
  const along = lengths(g.points), reach = Math.max(48, along[n - 1] * .3);
  const weight = (k: number) => {
    if (!at.at || k === i) return 1;
    if (k === 0 || k === n - 1) return 0;
    const d = Math.abs(along[k] - along[i]) / reach;
    return d >= 1 ? 0 : (1 + Math.cos(Math.PI * d)) / 2;
  };
  // A new rev: what the code memoized from the gesture as it was is not reused.
  return { ...g, rev: (Number.isInteger(g.rev) ? g.rev! : 0) + 1 + hash(`${key}=${move.x},${move.y}`),
    points: g.points.map((q, k) => { const w = weight(k); return w ? { ...q, x: q.x + move.x * w, y: q.y + move.y * w } : q; }) };
}
/** Set a value down a store path (copying what it changes). */
function setIn(value: unknown, path: string[], change: (old: unknown) => unknown): unknown {
  if (!path.length) return change(value);
  const [part, ...rest] = path;
  if (Array.isArray(value) && /^-?\d+$/.test(part)) { const i = wrap(Number(part), value.length); if (i < 0 || i >= value.length) return value; const copy = value.slice(); copy[i] = setIn(value[i], rest, change); return copy; }
  if (!value || typeof value !== "object" || !(part in value)) return value;
  return { ...(value as Record<string, unknown>), [part]: setIn((value as Record<string, unknown>)[part], rest, change) };
}

/**
 * The runtime (a recorded step's snapshot: `history`, `stores`, …) with the runtime keys among `values` applied;
 * the same object when there are none.
 */
export function editRuntime<T>(runtime: T, values: Record<string, Scalar> | null | undefined): T {
  const keys = Object.keys(values ?? {}).filter(isRuntimeKey);
  if (!keys.length || !runtime || typeof runtime !== "object") return runtime;
  let out = runtime as Record<string, unknown>;
  for (const key of keys) {
    const target = runtimeTarget(key), value = values![key]; if (!target) continue;
    if (target.kind === "input") {
      const history = Array.isArray(out.history) ? out.history : [], gestures = gesturesOf(history), g = gestures[wrap(target.gesture, gestures.length)];
      if (!g) continue;
      out = { ...out, history: history.map(item => item === g ? moveGesture(g, target, parseMove(value), key) : item) };
    } else {
      const stores = out.stores && typeof out.stores === "object" ? out.stores as Record<string, unknown> : {};
      if (!(target.root in stores)) continue;
      const move = parseMove(value);
      const changed = setIn(stores[target.root], target.path, old => typeof value === "number" && typeof old === "number" ? value
        : typeof value === "string" && isPoint(old) ? { ...old, x: old.x + move.x, y: old.y + move.y } : old);
      out = { ...out, stores: { ...stores, [target.root]: changed } };
    }
  }
  return out as T;
}
