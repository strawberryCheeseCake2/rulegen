import { useEffect, useMemo, useRef, useState } from "react";
import { CodePreview, type CodePreviewHandle, type ExecutionRun, type RunVariant, type VariantEffect } from "./code-preview";
import { InspectionOverlay } from "./inspection-overlay";
import { Icon } from "./icons";
import { EditSheet, EditTools, pictureEdited } from "./picture-edit";
import { dataShapes, termGlyphs, testGlyphs, type TestShape, emptyExploreEdit, EXEC_KEY, exploreStep, jumpTarget, keyStep, keySteps, KEY_STEPS, markSteps, runSteps, stepsAt, inputPath, LAST_ROOT, NEXT_ROOT, PATH_ROOT, previewKey, RUN_ROOT, gestureRange, runStores, stageCounts, STEPS_ROOT, stepOp, type ExecutionMoment, type ExecutionPart, type ExploreEdit, type ExploreFrame } from "../lib/explore";
import { evaluate, formatScalar, handleGrips, pathValue, stepContext, type InspectionState, type InspectResult, type Overlay, type Scalar } from "../lib/inspection";
import type { ScalarValue } from "../lib/scene/schema";
import { editRuntime, isRuntimeKey, INPUT_KEY, STORE_KEY, targetNumber } from "../lib/runtime-edits";
import { pictureDiff, type Rgb } from "../lib/picture-diff";

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
  /** Make the frame again (`note`: what to change, optional). */ onRetry: (note?: string) => void; onActivate: () => void;
  /**
   * Showing on an Execution frame's picture, at one moment of execution, how it should come out (annotation, crops
   * moved, scaled or rotated, a note), and asking AI for a new recommendation from it (on this picture).
   */
  onEdit?: (patch: Partial<ExploreEdit>) => void; onRecommend?: (image: string, moment: ExecutionMoment) => void; onCancelRecommend?: () => void;
  /** What a part of the brush (a semantic transformation, state or transition) is called, and on which node; null when it is gone. */
  partName?: (part: ExecutionPart) => { name: string; node: string } | null;
  /** Show a part in the frame's panels: a transformation in the properties panel, a state or transition in the state machine panel. */
  onPart?: (part: ExecutionPart) => void;
  /** Show a value of the brush (a constraint key) where it is edited: its property in the properties panel. */
  onVariable?: (key: string) => void;
};
const PART_KINDS: Record<ExecutionPart["kind"], string> = { transformation: "Transformation", state: "State", transition: "Transition" };
/**
 * One thing that may shape a mark: a value of the brush, an inner term of its code (m.term), or execution state it keeps
 * (a store value a handle moves). `nudge` changes it a little (to measure what it does), `strong` a lot (to compare by eye).
 */
type Influence = { id: string; kind: "value" | "term" | "state"; label: string; key: string; nudge: RunVariant; strong: RunVariant | null };
const INFLUENCE_KINDS: Record<Influence["kind"], string> = { value: "Value", term: "Inner term", state: "Execution state" };
/** A value read at a step, short. */
const shortValue = (value: unknown): string => typeof value === "number" ? formatScalar(Math.round(value * 100) / 100)
  : Array.isArray(value) && value.length <= 3 && value.every(item => typeof item === "number") ? `(${value.map(item => formatScalar(Math.round(item * 100) / 100)).join(", ")})`
  : value && typeof value === "object" && Number.isFinite((value as { x?: number }).x) && Number.isFinite((value as { y?: number }).y) ? shortValue([(value as { x: number }).x, (value as { y: number }).y])
  : typeof value === "string" ? value.slice(0, 24) : typeof value === "boolean" ? String(value) : "…";
/** A vector a value holds ([x, y] or { x, y }), or null. */
const vectorOf = (value: unknown): [number, number] | null => Array.isArray(value) && typeof value[0] === "number" && typeof value[1] === "number" ? [value[0], value[1]]
  : value && typeof value === "object" && Number.isFinite((value as { x?: number }).x) && Number.isFinite((value as { y?: number }).y) ? [(value as { x: number }).x, (value as { y: number }).y] : null;
type Step = { label: string; none: number; op: number; step: number };
/** What a step changed: drawn (blue) and gone (orange). What an influence would change: where it would be (purple) and where it is now (orange). */
/** One color per inner term (arrows and bars). */
const TERM_COLORS = ["#d9480f", "#0b7285", "#7048e8", "#2b8a3e", "#c2255c", "#e67700", "#1864ab", "#5f3dc4"];
const CHANGE_COLORS: { added: Rgb; removed: Rgb } = { added: [37, 99, 235], removed: [234, 88, 12] }, COMPARE_COLORS: { added: Rgb; removed: Rgb } = { added: [124, 58, 237], removed: [234, 88, 12] };
/** Canvas pixels a hand moves before a gesture counts (and the least distance from a pivot a gesture can be measured by). */
const STEP_SLOP = 12;
/** A plain grip on the next step: dragging it any way executes that step. */
const nextStepGrip = (link: Overlay["link"], stage: string | undefined): Overlay => ({ id: "@next-step", kind: "ellipse", name: "Next step", x: 's("@next", "cx") - 14', y: 's("@next", "cy") - 14', w: "28", h: "28", label: "",
  color: "#2a4f86", link, when: "", each: "", handle: { key: EXEC_KEY, gesture: "drag", x: 's("@next", "cx")', y: 's("@next", "cy")', pivotX: "", pivotY: "", value: "start + max(abs(dx), abs(dy)) / 40", hint: `Drag to run ${stage ?? "the next step"}` } });

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
export function ExploreFrameView({ frame, zoom, specs, labelOf, expand, onProgress, onValue, onRetry, onActivate, onEdit, onRecommend, onCancelRecommend, partName, onPart, onVariable }: Props) {
  const result = frame.result, execution = frame.mode === "execution", running = result?.axis === "run";
  // The code's run as last recorded (its events do not depend on how much of it is drawn).
  const [run, setRun] = useState<ExecutionRun | null>(null);
  const step = exploreStep(frame, running ? run : null), stepwise = running && step.done !== null && step.count !== null;
  const done = step.done ?? 0, count = step.count ?? 0;
  // Partway through, the brush is drawn as it is after the step just executed (its checkpoint's picture, when the code draws nothing until later).
  const pictured = step.budget !== null && done > 0 && run?.events.some(event => event.kind === "trace") ? done - 1 : null;
  const params = { ...frame.base.params, ...Object.fromEntries(Object.entries(frame.values).flatMap(([key, value]) => expand(key).map(each => [each, value]))) };
  const restoreId = `${frame.id}:${step.key}`;
  // The moment as the handles here moved its state (the input bent, a store value changed).
  const runtime = useMemo(() => editRuntime(step.runtime, frame.values), [step.runtime, frame.values]);
  const [drawn, setDrawn] = useState<{ restore: string; stores: Record<string, unknown> } | null>(null);
  // The frame's code failing as it runs (e.g. a recommendation's preview code): shown under the frame, cleared with new code.
  const [runError, setRunError] = useState("");
  useEffect(() => { setRunError(""); }, [frame.executable]);
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
    steps: [{ id: 1, at: 0, nodeId: null, from: null, to: null, transitionId: null, values: { ...step.values, ...previews, ...params, ...frame.values, [EXEC_KEY]: position }, runtime }] };
  const context = stepContext(state.steps, 0, {}, stores);
  // Execution goes on by gesture (an operation's handle), unless turned off: then only by the buttons (kept in this browser).
  const [gestures, setGesturesState] = useState(true);
  useEffect(() => { try { setGesturesState(localStorage.getItem("rulegen:explore-gestures") !== "0"); } catch { /* storage unavailable */ } }, []);
  const setGestures = (on: boolean) => { setGesturesState(on); try { localStorage.setItem("rulegen:explore-gestures", on ? "1" : "0"); } catch { /* storage unavailable */ } };
  // Every step can be executed by hand: when no handle of the next step's operation can be placed there (it
  // reads data the step does not have), a plain grip on the step does it.
  const unhandled = Boolean(gestures && result && stepwise && next && !next.none
    && !handleGrips(result.overlays, context).some(grip => grip.handle.key === EXEC_KEY));
  // Without gestures the overlays stay (what they show), their execution grips go.
  const overlays = result ? [...result.overlays.map(item => !gestures && item.handle?.key === EXEC_KEY ? { ...item, handle: null } : item),
    ...(unhandled ? [nextStepGrip(result.overlays[0]?.link ?? { kind: "constraint", nodeId: frame.nodeIds[0] ?? "", id: "" }, stageOf(next!.op)?.name)] : [])] : [];
  // Value handles that read a place this step's picture does not have (only once the picture's stores are in).
  const unplaced = result && drawn?.restore === restoreId ? result.overlays.filter(item => item.handle && item.handle.key !== EXEC_KEY && !handleGrips([item], context).length
    && (() => { try { return !item.when?.trim() || Boolean(evaluate(item.when, context)); } catch { return true; } })()).length : 0;
  const shown: InspectResult | null = result && { summary: result.summary, overlays: overlays as InspectResult["overlays"], valueFixes: [], recommendations: [], parameters: [], records: null };
  const from = result?.from ?? 0, to = result?.to ?? 1;
  const allSpecs: Record<string, ScalarValue> = { ...specs, ...Object.fromEntries((result?.values ?? []).map(value => [previewKey(value), value.value])),
    [EXEC_KEY]: stepwise ? { type: "number", value: done, min: 0, max: count, step: 1, unit: "" } : { type: "number", value: frame.progress, min: from, max: to, step: .001, unit: "" } };
  /** Execute (or take back) up to `target` steps done. */
  const goTo = (target: number) => { if (stepwise) onProgress(Math.max(0, Math.min(count, Math.round(target))) / Math.max(1, count)); };
  // A mark of the picture looked at closely (pressed while jumping, or the one the step just executed drew): what shapes it is measured on it.
  // Picked, the mark is FOLLOWED: execution takes the steps of its item (m.focus) and goes through only the steps where it
  // changes; the other marks are drawn faint (`solo`). A mark of no item is followed by its own drawing call.
  const [picked, setPicked] = useState<{ x: number; y: number; index: number; done: number; item: string | null } | null>(null), [solo, setSolo] = useState(true);
  useEffect(() => { setPicked(null); }, [frame.executable]);
  const focus = picked?.item ?? null, focusNow = useRef(focus); focusNow.current = focus;
  // The item the recorded run followed (it is recorded again once a mark is picked), and going to its first step once it is.
  const [runFocus, setRunFocus] = useState<string | null>(null), toFirst = useRef(false);
  const marked = useMemo(() => picked && run && runFocus === focus ? markSteps(run, picked) : [], [picked, run, runFocus, focus]);
  useEffect(() => { if (toFirst.current && marked.length) { toFirst.current = false; goTo(marked[0] - 1); } }, [marked]);
  const follow = (mark: NonNullable<typeof picked>) => { setPicked(mark); setChosen(null); toFirst.current = true; };
  // A long run stops only at its KEY steps (one round of its operations in full, then chunks, and the step jumped to), unless all steps are asked for;
  // following a mark, at the steps where it changes (and just before the first).
  const [allSteps, setAllSteps] = useState(false);
  const keys = useMemo(() => !run || !stepwise ? [] : marked.length ? [...new Set([0, marked[0] - 1, ...marked, count])].sort((a, b) => a - b)
    : keySteps(run, KEY_STEPS, picked ? [picked.done] : []), [run, stepwise, picked, marked, count]);
  const keyed = !allSteps && keys.length > 0 && (marked.length > 0 || keys.length < count + 1), keyAt = keys.filter(stop => stop > 0 && stop <= done).length;
  const stepBy = (way: 1 | -1) => goTo(keyed ? keyStep(keys, done, way) : done + way);
  // What shapes the picked mark: each value of the brush, inner term of its code (m.term) and execution state a handle moves, changed in turn.
  const preview = useRef<CodePreviewHandle>(null);
  const [termScales, setTermScales] = useState<Record<string, number>>({});
  const influences = useMemo<Influence[]>(() => {
    if (!run || !stepwise) return [];
    const now = state.steps[0].values, out: Influence[] = [];
    for (const [key, spec] of Object.entries(allSpecs)) {
      if (key === EXEC_KEY || spec.type !== "number" || spec.max <= spec.min) continue;
      const at = typeof now[key] === "number" ? now[key] as number : spec.value, span = spec.max - spec.min;
      const nudged = at + span * .1 <= spec.max ? at + span * .1 : at - span * .1, far = at - spec.min > spec.max - at ? spec.min : spec.max;
      const set = (value: number) => Object.fromEntries(expand(key).map(each => [each, value]));
      out.push({ id: `value:${key}`, kind: "value", label: labelOf(key), key, nudge: { id: `value:${key}`, params: set(nudged) }, strong: { id: `strong:${key}`, params: set(far) } });
    }
    for (const name of run.terms ?? []) out.push({ id: `term:${name}`, kind: "term", label: name.slice(name.indexOf("/") + 1), key: name, nudge: { id: `term:${name}`, terms: { [name]: 0 } }, strong: { id: `strong:${name}`, terms: { [name]: 0 } } });
    // Execution state the handles move (a store point or number), from this frame's overlays and the inspection's.
    const stores = (runtime && typeof runtime === "object" ? (runtime as { stores?: Record<string, unknown> }).stores : null) ?? {}, seen = new Set<string>();
    for (const overlay of [...(result?.overlays ?? []), ...frame.request.inspection.overlays]) {
      const key = overlay.handle?.key; if (!key || !key.startsWith(STORE_KEY) || key.includes("${") || seen.has(key)) continue; seen.add(key);
      const number = targetNumber(key, stores), moved = (amount: number) => editRuntime(runtime, { [key]: Number.isFinite(number) ? number + amount * (Math.abs(number) || 1) : `${amount * 70},${amount * 70}` });
      out.push({ id: `state:${key}`, kind: "state", label: overlay.name || key.slice(STORE_KEY.length), key, nudge: { id: `state:${key}`, runtime: moved(.2) }, strong: { id: `strong:${key}`, runtime: moved(.6) } });
    }
    return out.slice(0, 20);
  }, [run, stepwise, JSON.stringify(state.steps[0].values), JSON.stringify(allSpecs), runtime, result, frame.request.inspection.overlays]);
  const [measured, setMeasured] = useState<{ key: string; effects: VariantEffect[] } | null>(null), [measuring, setMeasuring] = useState(false);
  const measureKey = picked ? JSON.stringify([picked.index, frame.values, termScales, frame.executable.length, influences.map(item => item.id)]) : "";
  const effects = measured && measured.key === measureKey ? measured.effects : null;
  const measure = async () => {
    if (!picked || !preview.current) return;
    const key = measureKey; setPlaying(false); setMeasuring(true);
    try { const out = await preview.current.influence(influences.map(item => item.nudge), picked.item !== null ? { item: picked.item } : picked.index); setMeasured(out ? { key, effects: out } : null); } finally { setMeasuring(false); }
  };
  // The ones that move the mark (or take it away), most first.
  const ranked = (effects ? influences.flatMap(item => { const effect = effects.find(each => each.id === item.nudge.id); return effect && (effect.gone || effect.moved >= .3) ? [{ item, effect }] : []; }) : [])
    .sort((a, b) => Number(b.effect.gone) - Number(a.effect.gone) || b.effect.moved - a.effect.moved);
  const most = Math.max(1, ...ranked.map(row => row.effect.moved));
  const [chosen, setChosen] = useState<string | null>(null), choice = ranked.find(row => row.item.id === chosen) ?? null;
  // The chosen one changed a lot, drawn faintly over the picture as far as execution is now (to see where it parts from it).
  const [compare, setCompare] = useState<{ key: string; image: string } | null>(null);
  const compareKey = choice?.item.strong ? `${choice.item.id}|${restoreId}|${JSON.stringify(frame.values)}|${JSON.stringify(termScales)}` : "";
  useEffect(() => {
    const strong = choice?.item.strong; if (!compareKey || !strong) return;
    let live = true; const timer = setTimeout(() => { void preview.current?.variantShot(strong).then(async image => {
      if (!live || !image) return;
      // Drawn as what differs from the picture now: where it would be (purple) and where it is now (orange).
      const diff = await pictureDiff(shots.current.get(shotKeyNow.current) ?? latestShot.current, image, COMPARE_COLORS);
      if (live && diff) setCompare({ key: compareKey, image: diff.image }); }); }, 150);
    return () => { live = false; clearTimeout(timer); };
  }, [compareKey]);
  // Each moment's picture as last drawn (by moment and the values it is drawn with), and what changed from the moment
  // shown before to this one: drawn (blue) and gone (orange), so a step's change shows even among many marks.
  const shotKey = `${restoreId}|${JSON.stringify([frame.values, termScales])}`, shotKeyNow = useRef(shotKey); shotKeyNow.current = shotKey;
  const shots = useRef(new Map<string, string>()), previousShot = useRef<{ key: string; restore: string } | null>(null);
  const [change, setChange] = useState<{ key: string; image: string; added: number; removed: number; byStep: boolean } | null>(null), [showChange, setShowChangeState] = useState(false), [captions, setCaptions] = useState(true);
  // How big the words on the picture are (overlay labels, step numbers, verdicts), kept in this browser.
  const [textSize, setTextSizeState] = useState(17), [remake, setRemake] = useState("");
  // Coloring what a step changed (blue drawn, orange gone) is off unless turned on (kept in this browser): it is busy.
  useEffect(() => { try { setShowChangeState(localStorage.getItem("rulegen:explore-change") === "1"); } catch { /* storage unavailable */ } }, []);
  const showChangeNow = useRef(showChange); showChangeNow.current = showChange;
  const setShowChange = (on: boolean) => { setShowChangeState(on); try { localStorage.setItem("rulegen:explore-change", on ? "1" : "0"); } catch { /* storage unavailable */ } };
  useEffect(() => { try { const kept = Number(localStorage.getItem("rulegen:explore-text")); if (kept >= 10 && kept <= 36) setTextSizeState(kept); } catch { /* storage unavailable */ } }, []);
  const setTextSize = (size: number) => { const next = Math.max(10, Math.min(36, Math.round(size))); setTextSizeState(next); try { localStorage.setItem("rulegen:explore-text", String(next)); } catch { /* storage unavailable */ } };
  const noteShot = (restore: string) => {
    const image = latestShot.current, key = shotKeyNow.current;
    if (!image || !key.startsWith(`${restore}|`)) return;
    shots.current.set(key, image); if (shots.current.size > 60) shots.current.delete(shots.current.keys().next().value!);
    const before = previousShot.current; previousShot.current = { key, restore };
    // The change is worked out only while it is shown.
    const from = before && before.key !== key ? shots.current.get(before.key) : undefined; if (!from || !showChangeNow.current) return;
    void pictureDiff(from, image, CHANGE_COLORS).then(diff => { if (diff && previousShot.current?.key === key) setChange({ key, image: diff.image, added: diff.added, removed: diff.removed, byStep: before!.restore !== restore }); });
  };
  // What the step just executed read: its checkpoint's data and the inner terms it computed.
  const lastStep = run && stepwise && done > 0 ? runSteps(run)[done - 1] : null, nextStep = run && stepwise && done < count ? runSteps(run)[done] : null;
  /** Where a step is on the picture (canvas pixels), when it has a place. */
  const placeOf = (event: typeof lastStep) => event && Number.isFinite(event.x) && Number.isFinite(event.y) && (event.w ?? 0) * (event.h ?? 0) < 900 * 600 * .5 ? { x: event.x!, y: event.y!, w: event.w ?? 0, h: event.h ?? 0 } : null;
  const lastPlace = placeOf(lastStep), nextPlace = placeOf(nextStep);
  const readValues = lastStep ? [
    ...Object.entries(lastStep.data && typeof lastStep.data === "object" ? lastStep.data as Record<string, unknown> : {}).filter(([key, value]) => !["op", "x", "y", "w", "h"].includes(key) && (typeof value === "number" || vectorOf(value))).slice(0, 6).map(([key, value]) => ({ key, text: shortValue(value), term: "" })),
    ...Object.entries(lastStep.terms ?? {}).map(([key, term]) => ({ key, text: shortValue(term.last), term: `${lastStep.root ?? ""}/${key}` })) ] : [];
  // What the step worked on and what made its result, drawn where it works: the geometry in its data (point lists as
  // paths, points; the next step's dashed) and its inner terms, each an arrow (a vector) or a signed bar (a number) in
  // a color of its own, with the arrows' sum. The chosen influence stands out.
  const lastShapes = useMemo(() => lastStep ? dataShapes(lastStep.data) : [], [lastStep]);
  // The decisions the step made (m.test): the range, region or distance tested, colored by how it came out, with the
  // verdict on it ("not merged!"); the next step's, dashed, still undecided.
  // Only the decision that settled the step is drawn (the first that held, else the first tested), so the picture stays
  // readable when a step compares many things; how many more it tested is said in the caption.
  const tested = testGlyphs(lastStep?.tests), verdict = tested.find(test => test.pass) ?? tested[0] ?? null, othersTested = Math.max(0, tested.length - 1);
  const glyphs = termGlyphs(lastStep?.terms), anchor = lastPlace ? { x: lastPlace.x + lastPlace.w / 2, y: lastPlace.y + lastPlace.h / 2 } : lastShapes[0]?.points.at(-1) ?? null;
  const termColor = (name: string) => { const all = (run?.terms ?? []).map(key => key.slice(key.indexOf("/") + 1)), at = all.indexOf(name); return TERM_COLORS[(at < 0 ? all.length : at) % TERM_COLORS.length]; };
  const faded = (name: string) => choice?.item.kind === "term" && choice.item.label !== name;
  /** The mark the step just executed drew (the last one drawn so far), looked at closely. */
  const pickStep = () => { if (!run) return; const limit = step.budget ?? Infinity, event = [...run.events].reverse().find(item => item.kind !== "trace" && item.index < limit && Number.isFinite(item.x));
    if (event) follow({ x: event.x! + (event.w ?? 0) / 2, y: event.y! + (event.h ?? 0) / 2, index: event.index, done, item: event.item ?? null }); };
  // Play: one step at a time (or the progress through the process), from where it is (the start, when it is at the end).
  const [playing, setPlaying] = useState(false), latest = useRef({ done, count, progress: frame.progress, stepBy, onProgress }); latest.current = { done, count, progress: frame.progress, stepBy, onProgress };
  useEffect(() => {
    if (!playing) return;
    if (stepwise) {
      const timer = setInterval(() => { const now = latest.current; if (now.done >= now.count) { setPlaying(false); return; } now.stepBy(1); }, 700);
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
  // Showing how it should come out, at this moment of execution: on the picture as it is drawn now (the latest one a little after it is drawn).
  const edit = frame.edit ?? emptyExploreEdit(), showing = Boolean(onEdit && execution && result);
  const [shot, setShot] = useState(""), wantShot = useRef(true), latestShot = useRef("");
  const take = (image: string) => { if (!wantShot.current || !image) return; wantShot.current = false; setShot(image); };
  const [selected, setSelected] = useState<number | null>(null);
  const stage = stageOf(currentOp), says = (item: Step | undefined, n: number) => item && !item.none ? [item.label || `Step ${n}`, stageOf(item.op)?.name].filter(Boolean).join(" · ") : "";
  const moment: ExecutionMoment = { summary: result?.summary ?? "", axis: result?.axis ?? "run", done: stepwise ? done : null, count: stepwise ? count : null, progress: frame.progress,
    last: says(last, done), next: says(next, done + 1), stage: stepwise && stage ? { name: stage.name, explain: stage.explain } : null };
  // What was shown belongs to the moment it was shown at: elsewhere it is not drawn (and can be gone back to).
  const here = !edit.at || edit.at.key === restoreId;
  // The bar stays short: the summary folded to two lines, showing how it should be folded until asked for (open while it holds something).
  const [summaryOpen, setSummaryOpen] = useState(false), [recommendAsked, setRecommendOpen] = useState(false);
  const recommendOpen = recommendAsked || pictureEdited(edit) || edit.making || Boolean(edit.reply || edit.error);
  const editHere = (patch: Partial<ExploreEdit>) => { if (!onEdit) return; const next = { ...edit, ...patch }, empty = !next.marks.length && !next.manipulations.length;
    onEdit({ ...patch, at: empty ? null : edit.at ?? { key: restoreId, progress: frame.progress, moment } }); };
  // Jumping: pressing a part of the picture executes up to the step that draws it (pressed again: the next step that draws there).
  const [jumping, setJumping] = useState(false), [aim, setAim] = useState<{ x: number; y: number } | null>(null), jumpSheet = useRef<SVGSVGElement>(null);
  const jumpOn = jumping && stepwise && Boolean(run) && edit.mode === "run";
  const jumpPoint = (e: React.PointerEvent) => { const box = jumpSheet.current!.getBoundingClientRect(); return { x: (e.clientX - box.left) / Math.max(1, box.width) * 900, y: (e.clientY - box.top) / Math.max(1, box.height) * 600 }; };
  const aimed = jumpOn && aim && run ? jumpTarget(stepsAt(run, aim), done) : null;
  const stepLabel = (n: number) => { if (!run || n <= 0) return "Before start"; const item = runSteps(run)[n - 1]; return [item?.label || `Step ${n}`, stageOf(stepOp(run, n - 1))?.name].filter(Boolean).join(" · "); };
  // The parts of the brush (semantic transformations, states, transitions) the execution, or one of its operations, belongs to.
  const parts = (list: ExecutionPart[] | undefined) => (list ?? []).flatMap(part => { const named = partName?.(part); return named ? [{ ...part, ...named }] : []; });
  const partChips = (list: ExecutionPart[] | undefined, small = false) => parts(list).map(part => <button key={`${part.kind}:${part.nodeId}:${part.id}`} type="button" className={`explore-part ${part.kind} ${small ? "small" : ""}`}
    title={`${PART_KINDS[part.kind]} “${part.name}” · ${part.node} · click to view in the ${part.kind === "transformation" ? "transformation panel on the right" : "state machine panel below"}`}
    onClick={() => onPart?.({ kind: part.kind, nodeId: part.nodeId, id: part.id })}><em>{PART_KINDS[part.kind]}</em>{part.name}</button>);
  const where = (at: NonNullable<ExploreEdit["at"]>) => at.moment.done !== null ? `Step ${at.moment.done}/${at.moment.count}` : `${Math.round(at.progress * 100)}%`;
  return <div className={`explore-frame-surface explore-${frame.mode} ${showing && here ? `edit-${edit.mode}` : ""}`} tabIndex={-1} onPointerDownCapture={onActivate}
    style={{ "--explore-text": `${textSize}px` } as React.CSSProperties}
    onKeyDown={e => { if (e.key === "Escape" && selected !== null) { e.preventDefault(); e.stopPropagation(); setSelected(null); return; }
      if (e.key === "Escape" && jumping) { e.preventDefault(); e.stopPropagation(); setJumping(false); return; }
      if (!stepwise || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return; e.preventDefault(); e.stopPropagation(); setPlaying(false);
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") stepBy(e.key === "ArrowLeft" ? -1 : 1); else goTo(e.key === "Home" ? 0 : count); }}>
    {frame.executable ? <CodePreview ref={preview} executable={frame.executable} onError={setRunError} restore={{ id: restoreId, runtime, params, ...(Object.keys(termScales).length ? { terms: termScales } : {}), ...(running ? { run: { budget: step.budget, roots: frame.nodeIds, show: pictured, focus, solo: picked && solo ? { item: picked.item, index: picked.item === null ? picked.index : null } : null } } : {}) }}
      onCapture={image => { if (running && budget.current === null) setGhost(image); latestShot.current = image; take(image); }}
      onDrawn={(restore, stored, recorded) => { setDrawn({ restore, stores: stored }); if (recorded) { setRun(recorded); setRunFocus(focusNow.current); } noteShot(restore); wantShot.current = true; setTimeout(() => take(latestShot.current), 300); }} />
      : <div className="frame-render-status"><span className="loading-spinner" /><strong>Preparing the preview…</strong></div>}
    {stepwise && ghost && step.budget !== null && <img className="explore-ghost" src={ghost} alt="" aria-hidden="true" />}
    {/* What the step (or the value) just changed in the picture. */}
    {showChange && change?.key === shotKey && change.added + change.removed > 0 && <img className="explore-change" src={change.image} alt="" aria-hidden="true" />}
    {/* The chosen influence changed a lot, as far as execution is now: where it parts from the picture. */}
    {choice && compare?.key === compareKey && <img className="explore-compare" src={compare.image} alt="" aria-hidden="true" />}
    {/* The mark looked at closely. */}
    {picked && stepwise && <svg className="explore-influence-sheet" viewBox="0 0 900 600" preserveAspectRatio="none" aria-hidden="true">
      <circle className="explore-picked" cx={picked.x} cy={picked.y} r={11} vectorEffect="non-scaling-stroke" />
    </svg>}
    {/* The picture explains itself: where the step just executed worked (its number) and where the next one will, what it
        worked on and what made its result (drawn, not written); in the corner away from it only which step and the colors. */}
    {stepwise && run && captions && <>
      <svg className="explore-step-sheet" viewBox="0 0 900 600" preserveAspectRatio="none" aria-hidden="true">
        {nextPlace && <g className="explore-step-mark next">{nextPlace.w * nextPlace.h > 0 ? <rect x={nextPlace.x} y={nextPlace.y} width={nextPlace.w} height={nextPlace.h} vectorEffect="non-scaling-stroke" /> : <circle cx={nextPlace.x} cy={nextPlace.y} r={16} vectorEffect="non-scaling-stroke" />}
          <text x={nextPlace.x + (nextPlace.w * nextPlace.h > 0 ? nextPlace.w : 18)} y={nextPlace.y - 6}>{done + 1}</text></g>}
        {lastPlace && <g className="explore-step-mark last">{lastPlace.w * lastPlace.h > 0 ? <rect x={lastPlace.x} y={lastPlace.y} width={lastPlace.w} height={lastPlace.h} vectorEffect="non-scaling-stroke" /> : <circle cx={lastPlace.x} cy={lastPlace.y} r={16} vectorEffect="non-scaling-stroke" />}
          <text x={lastPlace.x - 4} y={lastPlace.y - 6} textAnchor="end">{done}</text></g>}
        {/* What this step worked on (solid), named. */}
        {lastShapes.map(shape => { const end = shape.points.at(-1)!; return <g key={`l:${shape.key}`} className="explore-data last">
          {shape.points.length > 1 ? <polyline points={shape.points.map(q => `${q.x},${q.y}`).join(" ")} vectorEffect="non-scaling-stroke" /> : null}
          <circle cx={end.x} cy={end.y} r={shape.points.length > 1 ? 4 : 7} />
          <text x={end.x + 9} y={end.y - 8}>{shape.key.split(".").at(-1)}</text></g>; })}
        {/* What this step decided: what it tested, in the outcome's color, and the verdict on it. */}
        {verdict && <g className={`explore-test ${verdict.pass ? "pass" : "fail"}`}>
          {verdict.shapes.map((shape, j) => <TestShapeView key={j} shape={shape} />)}
          <text className="verdict" x={verdict.at.x} y={verdict.at.y - 10} textAnchor="middle">{verdict.pass ? "✓ " : "✗ "}{verdict.verdict}</text></g>}
        {/* What made this step's result: its inner terms where it works. Arrows (vectors) scaled to the largest, and their sum. */}
        {anchor && glyphs.vectors.length > 0 && (() => {
          const top = Math.max(1e-9, ...glyphs.vectors.map(item => Math.hypot(item.v[0], item.v[1]))), scale = (v: [number, number], most = 80) => { const size = Math.hypot(v[0], v[1]); if (size < 1e-9) return null; const length = Math.min(130, 22 + most * size / top); return [v[0] / size * length, v[1] / size * length] as const; };
          const arrow = (key: string, v: [number, number], color: string, label: string, className = "") => { const d = scale(v); if (!d) return null; const tx = anchor.x + d[0], ty = anchor.y + d[1], a = Math.atan2(d[1], d[0]);
            const head = [[tx, ty], [tx - 11 * Math.cos(a - .45), ty - 11 * Math.sin(a - .45)], [tx - 11 * Math.cos(a + .45), ty - 11 * Math.sin(a + .45)]].map(q => q.join(",")).join(" ");
            return <g key={key} className={`explore-term-glyph ${className}`} style={{ color }}><line x1={anchor.x} y1={anchor.y} x2={tx} y2={ty} vectorEffect="non-scaling-stroke" /><polygon points={head} /><text x={tx + 6} y={ty - 6}>{label}</text></g>; };
          const sum: [number, number] = [glyphs.vectors.reduce((n, item) => n + item.v[0], 0), glyphs.vectors.reduce((n, item) => n + item.v[1], 0)];
          return <>{glyphs.vectors.map(item => arrow(item.name, item.v, termColor(item.name), item.name, faded(item.name) ? "faded" : ""))}{glyphs.vectors.length > 1 && arrow("@sum", sum, "#1f2a24", "together", "sum")}</>;
        })()}
        {/* Numbers (signed bars) next to where it works: how much each term gives, and which way. */}
        {anchor && glyphs.scalars.length > 0 && (() => {
          // Laid out for the text size (17 as drawn first).
          const k = textSize / 17, rows = glyphs.scalars.slice(0, 6), most = Math.max(1e-9, ...rows.map(item => Math.abs(item.value))), height = (rows.length * 24 + 12) * k;
          const ox = Math.min(900 - 250 * k, Math.max(4, anchor.x + 26)), oy = Math.min(600 - height - 4, Math.max(4, anchor.y - height / 2)), axis = ox + 110 * k;
          return <g className="explore-term-bars"><rect x={ox} y={oy} width={244 * k} height={height} rx={8} />
            <line className="axis" x1={axis} y1={oy + 6} x2={axis} y2={oy + height - 6} vectorEffect="non-scaling-stroke" />
            {rows.map((item, row) => { const y = oy + (12 + row * 24) * k, length = 60 * k * item.value / most;
              return <g key={item.name} className={faded(item.name) ? "faded" : ""} style={{ color: termColor(item.name) }}>
                <text className="name" x={axis - 66 * k} y={y + 12 * k} textAnchor="end">{item.name}</text>
                <rect className="bar" x={Math.min(axis, axis + length)} y={y + 2 * k} width={Math.max(2, Math.abs(length))} height={14 * k} rx={3} />
                <text className="value" x={axis + 66 * k} y={y + 13 * k}>{shortValue(item.value)}</text></g>; })}</g>;
        })()}
      </svg>
      <div className={`explore-caption ${lastPlace && lastPlace.x + lastPlace.w / 2 < 450 ? "right" : "left"}`} aria-live="polite">
        <span className="explore-caption-head"><b>{marked.length ? "This mark · step" : "Step"} {done}</b> / {count}{stage && <i>{stage.name}</i>}</span>
        {/* In words, next to what the picture shows: what the step did, why it matters, what it decided, what comes next. */}
        {last && !last.none && <span className="explore-caption-now">{last.label || `Step ${done}`}</span>}
        {stage?.explain && <span className="explore-caption-why">{stage.explain}</span>}
        {verdict && <span className={`explore-caption-verdict ${verdict.pass ? "pass" : "fail"}`}>{verdict.pass ? "✓" : "✗"} {verdict.verdict}{othersTested > 0 && <small> · {othersTested} more compared</small>}</span>}
        {next && !next.none && <span className="explore-caption-next">Next: {next.label || `Step ${done + 1}`}</span>}
        {showChange && change?.key === shotKey && change.added + change.removed > 0 && <span className="explore-caption-legend"><i className="added" />drawn by this step{change.removed > 0 && <><i className="removed" />gone</>}</span>}
      </div>
    </>}
    {shown && <InspectionOverlay state={state} marks={[]} result={shown} drawn={stores} liveValues={{}} clickable zoom={zoom} onFocus={() => {}} plain specs={allSpecs} textSize={textSize}
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
              const reached = Math.max(drag.range[0], Math.min(drag.range[1], !motion || motion.moved < STEP_SLOP ? drag.start : motion.reach < STEP_SLOP ? drag.start + 1 : Number(value)));
              // Over key steps, one gesture goes to the next (or previous) key step.
              const target = keyed && !drag.many && reached !== drag.start ? keyStep(keys, drag.start, reached > drag.start ? 1 : -1) : reached;
              if (!drag.many && target !== drag.start) drag.latched = target;
              goTo(target);
            } else onProgress(Number(value));
          }
          else onValue(key, value);
        }
        if (phase === "end") block.current = null;
      }} />}
    {/* What the user shows at this moment: over the handles while cropping or annotating, under them (drawn only) while running. */}
    {showing && here && <EditSheet className="explore-edit-sheet" edit={edit} onEdit={editHere} shot={shot || latestShot.current} editable={!edit.making} selected={selected} onSelect={setSelected} />}
    {/* Jumping: the part under the pointer, and the step that draws it (pressing executes up to there). */}
    {jumpOn && <svg ref={jumpSheet} className="explore-jump-sheet" viewBox="0 0 900 600" preserveAspectRatio="none" aria-label="Press a part to jump execution to the step that draws it"
      onPointerMove={e => setAim(jumpPoint(e))} onPointerLeave={() => setAim(null)}
      onPointerDown={e => { if (e.button !== 0 || !run) return; e.preventDefault(); e.stopPropagation(); const at = jumpPoint(e), target = jumpTarget(stepsAt(run, at), done);
        setAim(at); if (target) { setPlaying(false); goTo(target.done); follow({ ...at, index: target.event.index, done: target.done, item: target.event.item ?? null }); } }}>
      {aimed && <>
        <rect className="explore-jump-box" x={aimed.event.x} y={aimed.event.y} width={Math.max(4, aimed.event.w ?? 0)} height={Math.max(4, aimed.event.h ?? 0)} vectorEffect="non-scaling-stroke" />
        <text className="explore-jump-label" x={Math.min(880, Math.max(8, aim!.x + 14))} y={Math.max(18, aim!.y - 12)} textAnchor={aim!.x > 600 ? "end" : "start"}>{`Step ${aimed.done}/${count} · ${stepLabel(aimed.done)}`}</text>
      </>}
    </svg>}
    <div className="explore-bar board-scroll" onPointerDown={e => e.stopPropagation()}>
      <span className="section-kicker">{execution ? "EXECUTION · STEP BY STEP" : "KEY PARAMETERS"} · {frame.source.kind === "cause" ? "Cause" : frame.source.title}</span>
      {frame.status === "idle" && <span className="explore-status" role="status">Not generated yet. {execution ? "Press to have the AI split this process into steps and make a gesture to run at each step." : "Press to have the AI make key parameter handles."}{frame.source.kind === "recommendation" ? " (“Continue generating” on the fork frame makes both.)" : ""}<button onClick={() => onRetry()}>Generate</button></span>}
      {frame.status === "queued" && <span className="explore-status" role="status"><span className="loading-spinner" />Waiting in line. The AI will generate this once the earlier exploration frames finish…</span>}
      {frame.status === "loading" && <span className="explore-status" role="status"><span className="loading-spinner" />{execution ? "The AI is splitting the inner workings into steps and making a gesture to run at each step…" : "The AI is making key parameter handles…"}</span>}
      {frame.status === "error" && <span className="explore-status error" role="alert">{frame.error}<button onClick={() => onRetry()}>Retry</button></span>}
      {/* Make the frame again, optionally saying what to change. */}
      {(frame.status === "ready" || frame.status === "error") && <form className="explore-regenerate" onSubmit={e => { e.preventDefault(); onRetry(remake); setRemake(""); }}>
        <input value={remake} onChange={e => setRemake(e.currentTarget.value)} maxLength={400} placeholder="What to change (optional), e.g. fewer marks, explain the test" aria-label="What to change when regenerating" />
        <button type="submit" title="Have the AI make this frame again (with what you wrote)"><Icon name="undo" size={12} />Regenerate</button></form>}
      {runError && <span className="explore-status error" role="alert">Code execution error{frame.result?.edits.length ? " (recommendation preview code)" : ""}: {runError}<button onClick={() => onRetry()}>Regenerate</button></span>}
      {/* Handles AI made that cannot be placed at this moment (they read something this step does not have). */}
      {!runError && unplaced > 0 && <span className="explore-status error" role="alert">Couldn't find a place for {unplaced} handle(s). Their positions read values that aren't in this step's picture.<button onClick={() => onRetry()}>Regenerate</button></span>}
      {/* The parts of the brush this execution runs. */}
      {result && execution && parts(result.of).length > 0 && <div className="explore-parts"><span>Part of</span>{partChips(result.of)}</div>}
      {result && <p className={`explore-summary ${summaryOpen ? "open" : ""}`} title={summaryOpen ? "Click to fold" : "Click to read all"} onClick={() => setSummaryOpen(!summaryOpen)}>{result.summary}</p>}
      {result && execution && running && !stepwise && <span className="explore-status" role="status"><span className="loading-spinner" />Recording the code execution as steps…</span>}
      {/* Step by step: execute or take back one internal operation at a time; what was just done and what comes next. */}
      {result && execution && stepwise && <>
        <div className="explore-stepper" role="group" aria-label="Execution steps">
          <button aria-label="Back to the first step" title="First (Home)" disabled={done <= 0} onClick={() => { setPlaying(false); goTo(0); }}><Icon name="undo" size={12} /></button>
          <button aria-label="Take back one step" title={keyed ? "Back to the previous key step (←)" : "Back one step (←)"} disabled={done <= 0} onClick={() => { setPlaying(false); stepBy(-1); }}>◀</button>
          <output>{keyed ? <>{marked.length ? "This mark's step" : "Key step"} <b>{keyAt}</b> / {keys.length - 1} <small>· step {done}/{count}</small></> : <>Step <b>{done}</b> / {count}</>}</output>
          <button aria-label="Execute one step" title={keyed ? "Execute up to the next key step (→)" : "Execute one step (→)"} className="primary" disabled={done >= count} onClick={() => { setPlaying(false); stepBy(1); }}>▶ {keyed ? "Next key step" : "One step"}</button>
          <button aria-label="Execute all steps" title="To the end (End)" disabled={done >= count} onClick={() => { setPlaying(false); goTo(count); }}>⏭</button>
          <button aria-label={playing ? "Pause stepping" : "Play step by step"} title={playing ? "Pause" : "Play step by step"} onClick={play}><Icon name={playing ? "pause" : "play"} size={12} /></button>
          <button className={jumpOn ? "active" : ""} aria-pressed={jumpOn} title="Moves execution to the step that draws the part you press in the picture (Esc to turn off)"
            onClick={() => { const next = !jumpOn; setJumping(next); setAim(null); if (next) { setPlaying(false); if (edit.mode !== "run") onEdit?.({ mode: "run" }); } }}>◎ Jump to pressed</button>
          {count > KEY_STEPS && <button className={allSteps ? "active" : ""} aria-pressed={allSteps} title={allSteps ? "Stop only at the key steps: one round of the operations in full, then the rest in chunks" : `Go through every one of the ${count} steps`}
            onClick={() => setAllSteps(!allSteps)}>{allSteps ? "Key steps only" : `All ${count} steps`}</button>}
          <button className={showChange ? "active" : ""} aria-pressed={showChange} title="Color what the step just changed in the picture: drawn blue, gone orange" onClick={() => setShowChange(!showChange)}>Show change</button>
          <label className="explore-toggle" title="Write on the picture what the step did, where, what it read and what comes next"><input type="checkbox" checked={captions} onChange={e => setCaptions(e.currentTarget.checked)} />Explain on picture</label>
          <label className="explore-toggle" title="Run steps by dragging the operation's handle on the picture (off: only with the buttons and keys)"><input type="checkbox" checked={gestures} onChange={e => setGestures(e.currentTarget.checked)} />Step by gesture</label>
          <span className="explore-text-size" role="group" aria-label="Text size on the picture" title="How big the words on the picture are">
            <button aria-label="Smaller text on the picture" disabled={textSize <= 10} onClick={() => setTextSize(textSize - 2)}>A−</button><output>{textSize}</output>
            <button aria-label="Larger text on the picture" disabled={textSize >= 36} onClick={() => setTextSize(textSize + 2)}>A+</button></span>
        </div>
        {showChange && change?.key === shotKey && <span className="explore-change-legend">{change.added + change.removed > 0
          ? <><i className="added" />{change.byStep ? "drawn by this step" : "drawn with this value"}{change.removed > 0 && <><i className="removed" />gone</>}</>
          : change.byStep ? "This step changed nothing in the picture (it only computes; its result shows at a later step)." : "Nothing changed in the picture."}</span>}
        {/* Where execution is, the key steps, and the steps the chosen influence changes (click one to go there). */}
        {count > 1 && <div className="explore-timeline">
          <div className="explore-timeline-track" title="Click to go to that point of execution"
            onClick={e => { const box = e.currentTarget.getBoundingClientRect(), at = Math.round((e.clientX - box.left) / Math.max(1, box.width) * count); setPlaying(false);
              goTo(keyed ? keys.reduce((best, stop) => Math.abs(stop - at) < Math.abs(best - at) ? stop : best, 0) : at); }}>
            {keyed && keys.map(stop => <i key={stop} className="key" style={{ left: `${stop / count * 100}%` }} />)}
            {choice && choice.effect.steps.slice(0, 200).map(i => <button key={i} className="hit" style={{ left: `${(i + 1) / count * 100}%` }} aria-label={`Go to step ${i + 1}`}
              title={`Step ${i + 1} · ${stepLabel(i + 1)} · comes out different with ${choice.item.label} changed`} onClick={e => { e.stopPropagation(); setPlaying(false); goTo(i + 1); }} />)}
            <b className="now" style={{ left: `${done / count * 100}%` }} />
          </div>
          {choice && <small>{choice.effect.steps.length ? `${choice.effect.steps.length} step(s) come out different with “${choice.item.label}” changed (marked) · click one to go there` : `No step's data or drawing changes with “${choice.item.label}”`}</small>}
        </div>}
        {jumpOn && <span className="explore-explain">Press the picture to execute up to the step that draws that part · press the same spot again for the next step that draws there · Esc to turn off</span>}
        <div className="explore-step-now">
          <span><em>Just executed</em>{last && !last.none ? <><b>{last.label || `Step ${done}`}</b>{stageOf(last.op) && <i>{stageOf(last.op)!.name}</i>}{partChips(stageOf(last.op)?.of, true)}</> : "Nothing executed yet"}</span>
          <span><em>Next</em>{next && !next.none ? <><b>{next.label || `Step ${done + 1}`}</b>{stageOf(next.op) && <i>{stageOf(next.op)!.name}</i>}{partChips(stageOf(next.op)?.of, true)}</> : "All steps executed"}</span>
        </div>
        {/* What the step just executed worked with: its data and the inner terms it computed (the chosen one stands out). */}
        {readValues.length > 0 && <div className="explore-step-values" aria-label="Values the step just executed read">
          <em>Read</em>{readValues.map(item => <span key={`${item.term}:${item.key}`} className={`${item.term ? "term" : ""} ${choice && item.term && choice.item.key === item.term ? "chosen" : ""}`}
            title={item.term ? "Inner term (m.term) computed in this step: its last value" : "Value this step's checkpoint recorded"}>{item.key} <b>{item.text}</b></span>)}
        </div>}
        {/* What shapes a mark, only when one is looked at closely: each influence changed a little, how far the mark moves. */}
        {picked ? <div className="explore-influence" role="group" aria-label="What shapes the picked mark">
          <div className="explore-influence-head"><span className="section-kicker">FOLLOWING ONE MARK</span>
            <small>{picked.item !== null ? `Item ${picked.item}` : "One drawing call"} · {marked.length ? `changes at ${marked.length} step(s): ◀ ▶ go through them` : "recording its steps…"}</small>
            <label title="Draw the other marks faint, so this one stands out"><input type="checkbox" checked={solo} onChange={e => setSolo(e.currentTarget.checked)} />Dim the rest</label>
            <button aria-label="Stop following this mark" title="Stop following this mark" onClick={() => { setPicked(null); setChosen(null); }}><Icon name="close" size={10} /></button></div>
          <span className="section-kicker">WHAT SHAPES IT</span>
          {measuring ? <span className="explore-status" role="status"><span className="loading-spinner" />Drawing this step again with each of {influences.length} values, inner terms and execution states changed a little…</span>
            : !effects ? <span className="explore-influence-ask">{influences.length ? <button className="primary" onClick={() => { void measure(); }}>Measure what shapes it</button> : null}
              <small>{influences.length ? `Changes each of ${influences.length} values, inner terms and execution states a little and measures how far this mark moves.` : "This brush has no values, inner terms or execution state to change here."}</small></span>
            : ranked.length === 0 ? <span className="explore-status">Nothing measured moves this mark.<button onClick={() => { void measure(); }}>Measure again</button></span>
            : <div className="explore-influence-list">{ranked.map(({ item, effect }) => <button key={item.id} className={chosen === item.id ? "active" : ""} aria-pressed={chosen === item.id}
                title={`${INFLUENCE_KINDS[item.kind]} “${item.label}”: ${effect.gone ? "changing it takes this mark away" : `changed a little, the mark moves ${effect.moved}px`} · ${effect.steps.length} step(s) change · click to compare`}
                onClick={() => setChosen(chosen === item.id ? null : item.id)}>
                <em className={item.kind}>{INFLUENCE_KINDS[item.kind]}</em><span>{item.label}</span>
                <i className="explore-influence-bar"><i style={{ width: `${effect.gone ? 100 : Math.max(4, effect.moved / most * 100)}%` }} /></i>
                <small>{effect.gone ? "takes it away" : `${effect.moved}px`}</small></button>)}</div>}
          {/* The chosen one: compared on the picture (faint, as far as execution is now), and tried by hand. */}
          {choice && <div className="explore-influence-try">
            <span>{choice.item.kind === "term" ? "Faint: without this term" : choice.item.kind === "value" ? "Faint: this value at the far end of its range" : "Faint: this state moved further"} · as far as execution is now</span>
            {choice.item.kind === "term" && <label>Scale<input type="range" min={0} max={2} step={.05} value={termScales[choice.item.key] ?? 1}
              onChange={e => { const value = e.currentTarget.valueAsNumber; setTermScales(current => { const next = { ...current }; if (Math.abs(value - 1) < 1e-9) delete next[choice.item.key]; else next[choice.item.key] = value; return next; }); }} />
              <output>×{(termScales[choice.item.key] ?? 1).toFixed(2)}</output></label>}
            {choice.item.kind === "value" && allSpecs[choice.item.key]?.type === "number" && (() => { const spec = allSpecs[choice.item.key] as Extract<ScalarValue, { type: "number" }>, now = state.steps[0].values[choice.item.key];
              return <label>{choice.item.label}<input type="range" min={spec.min} max={spec.max} step={spec.step} value={typeof now === "number" ? now : spec.value} onChange={e => onValue(choice.item.key, e.currentTarget.valueAsNumber)} />
                <output>{formatScalar(typeof now === "number" ? now : spec.value)}</output></label>; })()}
            {choice.item.kind === "value" && specs[choice.item.key] && onVariable && <button onClick={() => onVariable(choice.item.key)}>Show in properties<Icon name="arrow" size={11} /></button>}
            {choice.item.kind === "state" && <span>{overlays.some(item => item.handle?.key === choice.item.key) ? "Move it with its handle on the picture." : "Move it with its handle in the targeted inspection of the original frame."}</span>}
            {Object.keys(termScales).length > 0 && <button onClick={() => setTermScales({})}>Reset terms</button>}
          </div>}
        </div> : <span className="explore-explain">To see how one mark is made, step by step: <button className="link" onClick={pickStep} disabled={!run}>follow the mark this step drew</button> or press one with ◎ Jump to pressed.</span>}
        {/* The kinds of operation the run is made of: how far each is, and what it does (the one now explained). */}
        {result.stages.length > 0 && <div className="explore-stages">{result.stages.map(stage => { const entry = counts.get(stage.op);
          return <button key={stage.op} className={stage.op === currentOp ? "current" : ""} disabled={!entry} title={[stage.explain, ...parts(stage.of).map(part => `${PART_KINDS[part.kind]} “${part.name}”`)].filter(Boolean).join("\n")}
            onClick={() => { setPlaying(false); if (entry) goTo(entry.first); }}>{stage.name}<small>{entry ? `${entry.done}/${entry.count}` : "0"}</small></button>; })}</div>}
        {stageOf(currentOp)?.explain && <span className="explore-explain">{stageOf(currentOp)!.explain}</span>}
      </>}
      {result && execution && !running && <div className="explore-scrub">
        <button aria-label={playing ? "Pause execution" : "Play execution"} title={playing ? "Pause" : "Play the process"} onClick={play}><Icon name={playing ? "pause" : "play"} size={12} /></button>
        <input type="range" aria-label="Execution progress" min={from} max={to} step={.001} value={Math.min(to, Math.max(from, frame.progress))} onChange={e => { setPlaying(false); onProgress(e.currentTarget.valueAsNumber); }} />
        <output>{Math.round((frame.progress - from) / Math.max(.001, to - from) * 100)}%</output>
      </div>}
      {result && !execution && tried.length > 0 && <div className="explore-values">{tried.map(([key, value]) => <span key={key}>{isRuntimeKey(key) ? <>{key.startsWith(INPUT_KEY) ? "Moved input path" : "Changed run state"} <b>{typeof value === "number" ? formatScalar(value) : `${String(value).replace(",", ", ")}px`}</b></>
          : <>{labelOf(key)} <b>{typeof value === "number" ? formatScalar(value) : String(value)}</b></>}
        <button aria-label={`Reset ${labelOf(key)}`} title="Back to the start value" onClick={() => onValue(key, null)}><Icon name="close" size={9} /></button></span>)}</div>}
      {/* Show how it should come out at this moment, and get a recommendation from it. */}
      {showing && !recommendOpen && <button className="explore-recommend-open" onClick={() => setRecommendOpen(true)}><Icon name="spark" size={12} />Show how it should be at this moment → recommendation</button>}
      {showing && recommendOpen && <div className="fork-slot-revise explore-recommend">
        <button className="explore-recommend-close" aria-label="Fold" title="Fold" onClick={() => setRecommendOpen(false)}><Icon name="close" size={10} /></button>
        <span className="section-kicker">Show it at this execution moment and make a RECOMMENDATION · crop to move, scale, rotate, annotation</span>
        {here ? <EditTools edit={edit} onEdit={editHere} editable={!edit.making} busy={edit.making} selected={selected} onSelect={setSelected} run="Execution handles" />
          : <span className="explore-status">There are marks made at {where(edit.at!)} (drawn only at that moment).
            <button onClick={() => { setPlaying(false); onProgress(edit.at!.progress); }}>Go to that moment</button>
            <button disabled={edit.making} onClick={() => { setSelected(null); editHere({ marks: [], manipulations: [], image: "" }); }}>Clear</button></span>}
        <textarea value={edit.note} rows={2} maxLength={2000} placeholder="What should happen at this moment (optional) · e.g. this size at the overlapping step, rotated along the stroke" disabled={edit.making}
          onChange={e => onEdit!({ note: e.target.value })}
          onKeyDown={e => { e.stopPropagation(); if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && pictureEdited(edit)) onRecommend?.(edit.image || shot || latestShot.current, edit.at?.moment ?? moment); }} />
        <div className="fork-slot-actions">
          {edit.making ? <><span className="fork-slot-message waiting"><span className="loading-spinner" />The AI is making a recommendation and preview from what you showed…</span><button onClick={onCancelRecommend}>Cancel</button></>
            : <button className="primary" disabled={!pictureEdited(edit)} onClick={() => onRecommend?.(edit.image || shot || latestShot.current, edit.at?.moment ?? moment)}><Icon name="spark" size={13} />Make recommendation</button>}
        </div>
        {edit.reply && <span className="fork-slot-message">{edit.reply}</span>}
        {edit.error && <span className="fork-slot-message error" role="alert">{edit.error}</span>}
      </div>}
    </div>
  </div>;
}

/** A shape a decision tested: a reach as its circle, a region, a distance as the line between the two, a point. */
function TestShapeView({ shape }: { shape: TestShape }) {
  if (shape.kind === "circle") return <circle cx={shape.x} cy={shape.y} r={Math.max(3, shape.r)} vectorEffect="non-scaling-stroke" />;
  if (shape.kind === "rect") return <rect x={Math.min(shape.x, shape.x + shape.w)} y={Math.min(shape.y, shape.y + shape.h)} width={Math.abs(shape.w)} height={Math.abs(shape.h)} vectorEffect="non-scaling-stroke" />;
  if (shape.kind === "line") return <><line x1={shape.x1} y1={shape.y1} x2={shape.x2} y2={shape.y2} vectorEffect="non-scaling-stroke" /><circle className="end" cx={shape.x1} cy={shape.y1} r={4} /><circle className="end" cx={shape.x2} cy={shape.y2} r={4} /></>;
  return <circle className="end" cx={shape.x} cy={shape.y} r={6} />;
}
