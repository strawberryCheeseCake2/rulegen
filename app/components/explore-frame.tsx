import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CodePreview, type CodePreviewHandle, type ExecutionRun } from "./code-preview";
import { InspectionOverlay } from "./inspection-overlay";
import { Icon } from "./icons";
import { IdealSheet, IdealTools, kitTool, objectAt, RefInput, refChoices, blockSize, controlSize, tagBlocks, tagBox, TagControl, tagTarget, VariableMarks, widgetCan, type WidgetControl } from "./ideal-state";
import { applyWidget, behaviorFallbacks, behaviorProbe, behaviorValues, behaviorValuesOf, boxOf, decidedSpecs, type IdealObject, describeRefs, specExamples, expandRefs, idealEdited, MAX_PICKED, pickedRecord, PICKED_ROOT, placedOutline, readsPicked, readVariables, refsIn, removeObjects, specScope, stateChanges, type AlignRefs, type SpecReader, type TagWidgetSpec } from "../lib/alignment";
import { fsmName, fsmOf, fsmVisits, visitOf, dataShapes, termGlyphs, testGlyphs, type TestShape, emptyExploreEdit, EXEC_KEY, exploreStep, jumpTarget, keyStep, keySteps, KEY_STEPS, runSteps, stepsAt, inputPath, LAST_ROOT, NEXT_ROOT, PATH_ROOT, RUN_ROOT, runStores, stageCounts, STEPS_ROOT, stepOp, type ExecutionMoment, type ExecutionPart, type ExploreEdit, type ExploreFrame } from "../lib/explore";
import { evaluate, formatScalar, handleGrips, INPUT_ROOT, layoutBlocks, layoutLabels, stepContext, textWidth, type LabelRequest, type PlacedLabel, type InspectionState, type InspectResult, type Scalar } from "../lib/inspection";
import type { ScalarValue, Scene } from "../lib/scene/schema";
import { editRuntime, targetNumber, targetPoint } from "../lib/runtime-edits";
import { pictureDiff, type Rgb } from "../lib/picture-diff";
import type { WidgetWorld } from "../lib/tag-widget-runtime";
import { TagWidgetLayer } from "./tag-widget";

/** What a widget is asked for with: the drawn object, where it is, the rules on its tag with what each reads now, the widget it has, and the runtime state. */
export type WidgetRequest = { object: string; box: { x: number; y: number; w: number; h: number }; rules: { aspect: string; expr: string; now: number | null }[];
  current: TagWidgetSpec | null; refs: AlignRefs };
type Props = {
  frame: ExploreFrame; zoom: number;
  /** The spec of each value of the brush a handle may change (its params). */
  specs: Record<string, ScalarValue>;
  onProgress: (progress: number) => void;
  /** A value dragged in this frame (null: back to how the frame started). */
  onValue: (key: string, value: Scalar | null) => void;
  /** The execution state set by hand (runtime keys) replaced with these values. */
  onStateValues?: (values: Record<string, Scalar>) => void;
  /** Make the frame again (`note`: what to change, optional). */ onRetry: (note?: string) => void; onActivate: () => void;
  /**
   * Debugging intent alignment at one moment of execution: the state the user draws on the picture (`onEdit`), AI
   * making the tools to draw it for the concern at this moment (`onKit`, from the picture as drawn now), and fixing
   * the brush to what was drawn (`onFix`); `onCancel` stops either, `onOpenFork` goes to the fork a fix was applied to.
   */
  onEdit?: (patch: Partial<ExploreEdit>) => void; onKit?: (image: string, moment: ExecutionMoment, request?: string) => void;
  /** `refs`: the runtime state what was drawn and said refers to, as it reads at this moment. */
  onFix?: (image: string, moment: ExecutionMoment, refs: AlignRefs) => void;
  /** AI makes a widget for the rules on a drawn object's tag (`refs`: all the runtime state there is, as it reads now). */
  onWidget?: (image: string, moment: ExecutionMoment, request: WidgetRequest) => void;
  /** The objects of the brush (its nodes) what is drawn can be tagged as. */
  objects?: { id: string; name: string }[];
  onCancel?: () => void; onOpenFork?: (forkId: string) => void;
  /** The target frame's scene: what each state machine step is (its owner, state, constraint or transition) in the brush's own words. */
  scene?: Scene;
  /** What a part of the brush (a constraint, state or transition) is called, and on which node; null when it is gone. */
  partName?: (part: ExecutionPart) => { name: string; node: string } | null;
  /** Show a part in the frame's panels: a constraint in the params panel, a state or transition in the state machine panel. */
  onPart?: (part: ExecutionPart) => void;
};
const PART_KINDS: Record<ExecutionPart["kind"], string> = { constraint: "Constraint", state: "State", transition: "Transition" };
/** A value read at a step, short. */
const shortValue = (value: unknown): string => typeof value === "number" ? formatScalar(Math.round(value * 100) / 100)
  : Array.isArray(value) && value.length <= 3 && value.every(item => typeof item === "number") ? `(${value.map(item => formatScalar(Math.round(item * 100) / 100)).join(", ")})`
  : value && typeof value === "object" && Number.isFinite((value as { x?: number }).x) && Number.isFinite((value as { y?: number }).y) ? shortValue([(value as { x: number }).x, (value as { y: number }).y])
  : typeof value === "string" ? value.slice(0, 24) : typeof value === "boolean" ? String(value) : "…";
/** A vector a value holds ([x, y] or { x, y }), or null. */
const vectorOf = (value: unknown): [number, number] | null => Array.isArray(value) && typeof value[0] === "number" && typeof value[1] === "number" ? [value[0], value[1]]
  : value && typeof value === "object" && Number.isFinite((value as { x?: number }).x) && Number.isFinite((value as { y?: number }).y) ? [(value as { x: number }).x, (value as { y: number }).y] : null;
type Step = { label: string; none: number; op: number; step: number };
/** A part of the picture (canvas pixels). */
type Area = { x: number; y: number; width: number; height: number };
/** One color per inner term (arrows and bars). */
const TERM_COLORS = ["#d9480f", "#0b7285", "#7048e8", "#2b8a3e", "#c2255c", "#e67700", "#1864ab", "#5f3dc4"];
/** What a step changed: drawn (blue) and gone (orange). */
const CHANGE_COLORS: { added: Rgb; removed: Rgb } = { added: [37, 99, 235], removed: [234, 88, 12] };

/**
 * An exploration frame: the brush marks of the step the inspection held, run by
 * their own copy of the program and held still, with overlays that explain them.
 * Execution of the code's run goes STEP BY STEP: each step is one internal operation
 * (a checkpoint the code passes), executed or taken back one at a time with the step
 * buttons, the keys or by pressing a part of the picture; the picture shows what is
 * drawn by then over a faint picture of the finished marks, and the step just executed
 * says what it did. Execution can also go along the recorded input or
 * the recorded steps. A state tool's grips set the execution state at the moment by hand
 * and redraw it from there. Nothing outside this frame changes.
 */
export function ExploreFrameView({ frame, zoom, specs, onProgress, onValue, onStateValues, onRetry, onActivate, onEdit, onKit, onFix, onWidget, onCancel, onOpenFork, partName, onPart, objects = [], scene }: Props) {
  const result = frame.result, running = result?.axis === "run";
  // The code's run as last recorded (its events do not depend on how much of it is drawn).
  const [run, setRun] = useState<ExecutionRun | null>(null);
  const step = exploreStep(frame, running ? run : null), stepwise = running && step.done !== null && step.count !== null;
  const done = step.done ?? 0, count = step.count ?? 0;
  // Partway through, the brush is drawn as it is after the step just executed (its checkpoint's picture, when the code draws nothing until later).
  const pictured = step.budget !== null && done > 0 && run?.events.some(event => event.kind === "trace") ? done - 1 : null;
  const params = frame.values;
  const restoreId = `${frame.id}:${step.key}`;
  // The moment as the handles here moved its state (the input bent, a store value changed).
  const runtime = useMemo(() => editRuntime(step.runtime, frame.values), [step.runtime, frame.values]);
  const [drawn, setDrawn] = useState<{ restore: string; stores: Record<string, unknown> } | null>(null);
  // The frame's code failing as it runs: shown under the frame, cleared with new code.
  const [runError, setRunError] = useState("");
  useEffect(() => { setRunError(""); }, [frame.executable]);
  // The finished marks (the whole run drawn), shown faintly while execution is partway.
  const [ghost, setGhost] = useState(""), budget = useRef(step.budget); budget.current = step.budget;
  const path = useMemo(() => inputPath(frame.base.runtime), [frame.base.runtime]);
  const traced = useMemo(() => stepwise && run ? runStores(run, done) : null, [stepwise, run, done]);
  // The overlays read the stores as this moment is drawn now and the path execution goes along: the run's steps
  // (every event and step, the next and the last one), or the recorded input.
  // The things pressed with a state tool that reads them (an object drawn follows it where it is moved), in order.
  const [selected, setSelected] = useState<string[]>([]);
  const [picks, setPicks] = useState<{ id: string | null; box: Area }[]>([]);
  useEffect(() => { setPicks([]); }, [frame.edit?.mode, restoreId]);
  const picked = picks.flatMap(pick => { if (!pick.id) return [pick.box]; const item = frame.edit?.ideal.objects.find(object => object.id === pick.id);
    return item ? [(({ x, y, w, h }) => ({ x, y, width: w, height: h }))(boxOf(placedOutline(item)))] : []; });
  const stores = { [PICKED_ROOT]: picked.map(box => pickedRecord({ x: box.x, y: box.y, w: box.width, h: box.height })), ...(drawn?.restore === restoreId ? drawn.stores : {}),
    ...(traced ? { [RUN_ROOT]: traced[RUN_ROOT], [STEPS_ROOT]: traced[STEPS_ROOT], [NEXT_ROOT]: traced[NEXT_ROOT], [LAST_ROOT]: traced[LAST_ROOT], [PATH_ROOT]: traced.path } : { [PATH_ROOT]: path }) };
  const next = traced?.[NEXT_ROOT] as Step | undefined, last = traced?.[LAST_ROOT] as Step | undefined;
  const counts = useMemo(() => run && stepwise ? stageCounts(run, done) : new Map<number, { count: number; done: number; first: number }>(), [run, stepwise, done]);
  // The run's state machine steps: each visit (or transition) with its constraint steps, and the one execution is in.
  const visits = useMemo(() => run && stepwise ? fsmVisits(run) : [], [run, stepwise]);
  const steps = useMemo(() => run && stepwise ? runSteps(run) : [], [run, stepwise]);
  // What a step does, in the brush's own words (its owner and state, the constraint's property and description, the transition).
  const nameOfStep = (index: number) => scene && steps[index] ? fsmName(scene, steps[index].data) : null;
  const stageOf = (op: number) => { const at = steps.findIndex((_, i) => stepOp(run!, i) === op); return at < 0 ? undefined : nameOfStep(at) ?? undefined; };
  const currentOp = run && stepwise ? stepOp(run, Math.min(done, count - 1)) : 0;
  const visitNow = visitOf(visits, Math.min(done, count - 1)), visit = visits[visitNow];
  // The execution value handles read and change: steps done (step by step), else the progress.
  const position = stepwise ? done : frame.progress;
  const state: InspectionState = { brushId: frame.brushId, cursor: 0, marks: [], markStyles: [], concern: "", focus: null,
    steps: [{ id: 1, at: 0, nodeId: null, from: null, to: null, transitionId: null, values: { ...step.values, ...frame.values, [EXEC_KEY]: position }, runtime }] };
  const context = stepContext(state.steps, 0, {}, stores);
  // Drawing the state wanted at this moment of execution: on the picture as it is drawn now (the latest one a little after it is drawn).
  const edit = frame.edit ?? emptyExploreEdit(), showing = Boolean(onEdit && result);
  // A state tool chosen: its grips set the execution state at this moment (as a targeted inspection's handles do).
  // They are the only grips on the frame, and only while it is chosen; the frame's own overlays only explain.
  const stateTool = showing ? kitTool(edit.mode, edit.kit?.tools ?? []) : undefined, setting = stateTool?.kind === "state" ? stateTool : undefined;
  const overlays: InspectResult["overlays"] = result ? [...result.overlays.map(item => ({ ...item, handle: null })),
    ...(setting ? setting.handles.map(item => ({ ...item, id: `state:${setting.id}:${item.id}`, color: item.color || setting.color })) : [])] : [];
  // Grips of the state tool that read a place this moment does not have (only once the picture's stores are in).
  // A grip on each item of a list that has none at this moment has nothing to grab here: that is not a fault (nothing to say).
  const emptyList = (each: string) => { if (!each.trim()) return false; const cut = each.indexOf(":"), root = cut < 0 ? each : each.slice(0, cut), path = cut < 0 ? "" : each.slice(cut + 1);
    try { return !(Number(evaluate(`len(${JSON.stringify(root)}, ${JSON.stringify(path)})`, context)) > 0); } catch { return false; } };
  const unplaced = setting && drawn?.restore === restoreId ? setting.handles.filter(item => item.handle && !emptyList(item.each ?? "") && !handleGrips([item], context).length
    && (() => { try { return !item.when?.trim() || Boolean(evaluate(item.when, context)); } catch { return true; } })()).length : 0;
  // What the chosen state tool's grips hold at this moment (as drawn now), item by item.
  const holding = setting ? handleGrips(setting.handles, context).flatMap(grip => {
    const key = grip.handle.key, number = targetNumber(key, context.stores), point = Number.isFinite(number) ? null : targetPoint(key, context.stores, context.stores[INPUT_ROOT]);
    const text = Number.isFinite(number) ? formatScalar(Math.round(number * 10) / 10) : point ? `(${Math.round(point.x)}, ${Math.round(point.y)})` : "";
    return text ? [{ key, name: grip.overlay.name || setting.name, text }] : [];
  }).filter((item, i, all) => all.findIndex(other => other.key === item.key) === i).slice(0, 8) : [];
  // The rules on tags read on the frame at this moment (the stores as drawn now), with the object's own box as item("…")
  // and the runtime state the kit refers to as `@id.field`.
  const variables = edit.kit?.variables ?? [];
  const readIn = (expr: string, scope: typeof context) => { try { const value = Number(evaluate(expandRefs(expr, variables), scope)); return Number.isFinite(value) ? value : null; } catch { return null; } };
  const read: SpecReader = (expr, item) => readIn(expr, { ...context, item: specScope(item), itemIndex: 0 });
  // The runtime state at this moment: shown on the picture while inspected, or while the tag of what is selected refers to it.
  const readings = readVariables(variables, expr => readIn(expr, context)), [inspecting, setInspecting] = useState<string[]>([]);
  // What the behaviors drawn give the brush's code: the frame runs with them (at any moment: a behavior is the brush's, not one moment's).
  const kitTools = edit.kit?.tools ?? [], behaving = useMemo(() => behaviorValues(edit.ideal, kitTools, read), [edit.ideal, kitTools, drawn, traced]);
  // Which behavior tools change what the brush draws: a typical drawing of each (its probe) against none, over the WHOLE run
  // drawn by the brush's own code (a behavior is the brush's, not one moment's; partway, the frame may show a checkpoint's
  // own picture of what is kept, which a behavior need not change). Checked once per program; unknown where the frame
  // cannot draw a variant (it stays offered), and kept as it was found when a probe does not read (not hidden for that).
  const preview = useRef<CodePreviewHandle>(null), [effects, setEffects] = useState<Record<string, boolean>>({});
  useEffect(() => setEffects({}), [frame.executable]);
  const behaviorTools = kitTools.filter(tool => tool.kind === "behavior"), storesIn = drawn?.restore === restoreId;
  useEffect(() => {
    const todo = behaviorTools.filter(tool => effects[tool.id] === undefined);
    if (!showing || !storesIn || !frame.executable || !todo.length) return;
    let cancelled = false;
    void (async () => {
      const none = { ...frame.values, ...behaviorFallbacks(kitTools) }, base = await preview.current?.variantShot({ id: "none", params: none }, true);
      if (!base || cancelled) return;
      const found: Record<string, boolean> = {};
      for (const tool of todo) {
        const probe = behaviorProbe(tool, kitTools), values = probe ? behaviorValuesOf(tool, probe, read) : {};
        if (!Object.keys(values).length) continue;
        const shot = await preview.current?.variantShot({ id: tool.id, params: { ...none, ...values } }, true);
        const diff = shot ? await pictureDiff(base, shot, CHANGE_COLORS) : null;
        if (diff) found[tool.id] = diff.added + diff.removed > 24;
      }
      if (!cancelled) setEffects(current => ({ ...current, ...found }));
    })();
    return () => { cancelled = true; };
  }, [showing, storesIn, frame.executable, behaviorTools.map(tool => tool.id).join(" ")]);
  // A behavior drawn: the picture is the whole run as the brush's code draws it with what was drawn (partway, a step's own
  // picture would not show it); the steps still explain.
  const behaviorOn = Object.keys(behaving).length > 0;
  // Left out: behaviors whose drawing changes nothing the brush draws; runtime state that reads nothing at this moment (once the stores are in).
  const dead = { tools: behaviorTools.filter(tool => effects[tool.id] === false).map(tool => tool.id),
    variables: storesIn ? readings.filter(item => item.fields.every(field => field.value === null)).map(item => item.variable.id) : [] };
  const texts = [edit.note, ...edit.ideal.merges.map(merge => merge.label), ...edit.ideal.objects.flatMap(item => [item.label, ...item.specs.map(spec => spec.expr)])];
  // What was drawn belongs to the moment it was drawn at: elsewhere it is not shown (and can be gone back to).
  const here = !edit.at || edit.at.key === restoreId;
  const tagRefs = refsIn(edit.ideal.objects.filter(item => selected.includes(item.id)).flatMap(item => [item.label, ...item.specs.map(spec => spec.expr)]), variables).map(item => item.id);
  // The tag of what is selected is edited on the picture (a tag pressed there selects what it is on).
  const tagEditing = tagTarget(edit.ideal, selected);
  // The widget open on a drawn object (AI made it for the rules on its tag): drawn over the picture, it takes its input.
  const widget = here && edit.widgetOn ? edit.widgets[edit.widgetOn] : undefined, widgetItem = widget && edit.ideal.objects.find(item => item.id === widget.id);
  const inspected = readings.filter(item => inspecting.includes(item.variable.id) || (here && tagRefs.includes(item.variable.id)));
  const objectNames = Object.fromEntries(objects.map(item => [item.id, item.name]));
  const shown: InspectResult | null = result && { summary: result.summary, overlays, parameters: [], records: null };
  const from = result?.from ?? 0, to = result?.to ?? 1;
  /** Execute (or take back) up to `target` steps done. */
  const goTo = (target: number) => { if (stepwise) onProgress(Math.max(0, Math.min(count, Math.round(target))) / Math.max(1, count)); };
  // A long run stops only at its KEY steps (one round of its operations in full, then chunks, and the step jumped to), unless all steps are asked for.
  const [allSteps, setAllSteps] = useState(false), [jumped, setJumped] = useState<number | null>(null);
  useEffect(() => { setJumped(null); }, [frame.executable]);
  const keys = useMemo(() => !run || !stepwise ? [] : keySteps(run, KEY_STEPS, jumped !== null ? [jumped] : []), [run, stepwise, jumped]);
  const keyed = !allSteps && keys.length > 0 && keys.length < count + 1, keyAt = keys.filter(stop => stop > 0 && stop <= done).length;
  const stepBy = (way: 1 | -1) => goTo(keyed ? keyStep(keys, done, way) : done + way);
  // State machine stepping: a whole visit (a state entered or evaluated, its constraints in order) or a transition at a time.
  const visitBy = (way: 1 | -1) => { const starts = [...visits.map(item => item.start).filter(start => start > 0), count];
    goTo(way > 0 ? starts.find(start => start > done) ?? count : [0, ...starts].filter(start => start < done).at(-1) ?? 0); };
  // Each moment's picture as last drawn (by moment and the values it is drawn with), and what changed from the moment
  // shown before to this one: drawn (blue) and gone (orange), so a step's change shows even among many marks.
  const shotKey = `${restoreId}|${JSON.stringify(frame.values)}`, shotKeyNow = useRef(shotKey); shotKeyNow.current = shotKey;
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
  // The numbers of the state the step worked with (its data, the concern's quantities): on the picture beside where it
  // works; in the bar when the picture is not explained, with the inner terms it computed.
  const stepNumbers = lastStep ? Object.entries(lastStep.data && typeof lastStep.data === "object" ? lastStep.data as Record<string, unknown> : {})
    .filter(([key, value]) => !["op", "x", "y", "w", "h"].includes(key) && (typeof value === "number" || typeof value === "boolean" || (Array.isArray(value) && vectorOf(value)))).slice(0, 4)
    .map(([key, value]) => ({ key, text: shortValue(value) })) : [];
  const readValues = lastStep ? [...(captions ? [] : stepNumbers.map(item => ({ ...item, term: "" }))),
    ...Object.entries(lastStep.terms ?? {}).map(([key, term]) => ({ key, text: shortValue(term.last), term: `${lastStep.root ?? ""}/${key}` }))] : [];
  // What the step worked on and what made its result, drawn where it works: the geometry in its data (point lists as
  // paths, points; the next step's dashed) and its inner terms that are vectors, each an arrow in a color of its own,
  // with the arrows' sum (numbers are read in the bar).
  const lastShapes = useMemo(() => lastStep ? dataShapes(lastStep.data) : [], [lastStep]);
  // The decisions the step made (m.test): the range, region or distance tested, colored by how it came out, with the
  // verdict on it ("not merged!"); the next step's, dashed, still undecided.
  // Only the decision that settled the step is drawn (the first that held, else the first tested), so the picture stays
  // readable when a step compares many things; how many more it tested is said in the caption.
  const tested = testGlyphs(lastStep?.tests), verdict = tested.find(test => test.pass) ?? tested[0] ?? null, othersTested = Math.max(0, tested.length - 1);
  const glyphs = termGlyphs(lastStep?.terms), anchor = lastPlace ? { x: lastPlace.x + lastPlace.w / 2, y: lastPlace.y + lastPlace.h / 2 } : lastShapes[0]?.points.at(-1) ?? null;
  const termColor = (name: string) => { const all = (run?.terms ?? []).map(key => key.slice(key.indexOf("/") + 1)), at = all.indexOf(name); return TERM_COLORS[(at < 0 ? all.length : at) % TERM_COLORS.length]; };
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
  const [shot, setShot] = useState(""), wantShot = useRef(true), latestShot = useRef("");
  const take = (image: string) => { if (!wantShot.current || !image) return; wantShot.current = false; setShot(image); };
  const stage = stageOf(currentOp), says = (item: Step | undefined, n: number) => item && !item.none ? [item.label || `Step ${n}`, stageOf(item.op)?.name].filter(Boolean).join(" · ") : "";
  const moment: ExecutionMoment = { summary: result?.summary ?? "", axis: result?.axis ?? "run", done: stepwise ? done : null, count: stepwise ? count : null, progress: frame.progress,
    last: says(last, done), next: says(next, done + 1), stage: stepwise && stage ? { name: stage.name, explain: stage.explain } : null };
  // The bar stays short: the summary folded to two lines, the drawing tools folded until asked for (open while they hold something).
  const [summaryOpen, setSummaryOpen] = useState(false), [alignAsked, setAlignOpen] = useState(false);
  // The execution state set by hand with state tools, against what it was at this moment.
  const changes = stateChanges(frame.values, step.runtime, edit.kit?.tools ?? []);
  const sketched = idealEdited(edit.ideal, edit.marks, edit.note) || changes.length > 0;
  const alignOpen = alignAsked || sketched || Boolean(edit.kit) || edit.kitting || edit.making || Boolean(edit.reply || edit.error || edit.kitError);
  const picture = edit.image || shot || latestShot.current;
  const editHere = (patch: Partial<ExploreEdit>) => { if (!onEdit) return; const next = { ...edit, ...patch }, empty = !next.marks.length && !next.ideal.objects.length;
    // Lifted parts are cut from the picture as it was when the first was lifted.
    const image = next.ideal.objects.some(item => item.kind === "crop") ? edit.image || picture : "";
    onEdit({ ...patch, image, at: empty ? null : edit.at ?? { key: restoreId, progress: frame.progress, moment } }); };
  /** Make the tools for this moment (opening the tools the first time makes them); AI's guesses are drawn at this moment. */
  /** `request`: a tool asked for in words, added to the tools there are. */
  const makeKit = (request = "") => { if (!picture || edit.kitting) return; if (!request) onEdit?.({ kitAt: restoreId }); onKit?.(picture, moment, request); };
  /** Fix the brush to what was drawn, with the runtime state it refers to as it reads now. */
  const fix = () => onFix?.(picture, edit.at?.moment ?? moment, describeRefs(readings, texts));
  /** AI makes the widget for the rules on an object's tag as they are now (the one it has, to make a better one). */
  const makeWidget = (item: IdealObject) => { if (!picture || edit.widgeting) return; const made = edit.widgets[item.id];
    onWidget?.(picture, edit.at?.moment ?? moment, { object: item.id, box: boxOf(placedOutline(item)), rules: decidedSpecs(item.specs).map(spec => ({ aspect: spec.aspect.trim(), expr: spec.expr.trim(), now: read(spec.expr, item) })),
      current: made ? { reading: made.reading, hint: made.hint, params: made.params, rules: made.rules, code: made.code } : null, refs: describeRefs(readings, readings.map(item => `@${item.variable.id}`)) }); };
  const widgetControl = (item: IdealObject): WidgetControl => { const made = edit.widgets[item.id], on = Boolean(made) && edit.widgetOn === item.id;
    return { on, can: widgetCan(item), made: Boolean(made), making: edit.widgeting === item.id, error: edit.widgeting ? "" : edit.widgetError, hint: made?.hint ?? "",
      toggle: () => on ? onEdit?.({ widgetOn: "" }) : made ? onEdit?.({ widgetOn: item.id, widgetError: "" }) : makeWidget(item), remake: () => makeWidget(item) }; };
  /** What the open widget reads: its values, the object where it is, the other objects, what its rules read and the runtime state. */
  const widgetWorld = (item: IdealObject, values: Record<string, number | string | boolean>): Omit<WidgetWorld, "px"> => { const at = (other: IdealObject) => { const box = boxOf(placedOutline(other));
    return { x: box.x, y: box.y, w: box.w, h: box.h, cx: box.x + box.w / 2, cy: box.y + box.h / 2, rotate: other.rotate, id: other.id, label: other.label }; };
    return { values, item: at(item), others: edit.ideal.objects.filter(other => other.id !== item.id).map(at), rules: Object.fromEntries(decidedSpecs(item.specs).map(spec => [spec.aspect.trim(), read(spec.expr, item)])),
      refs: Object.fromEntries(readings.flatMap(entry => entry.fields.map(field => [field.ref, field.value]))) }; };
  const openAlign = () => { setAlignOpen(true); if (!edit.kit && !edit.kitting) makeKit(); };
  // Jumping: pressing a part of the picture executes up to the step that draws it (pressed again: the next step that draws there).
  const [jumping, setJumping] = useState(false), [aim, setAim] = useState<{ x: number; y: number } | null>(null), jumpSheet = useRef<SVGSVGElement>(null);
  const jumpOn = jumping && stepwise && Boolean(run) && edit.mode === "run";
  const jumpPoint = (e: React.PointerEvent) => { const box = jumpSheet.current!.getBoundingClientRect(); return { x: (e.clientX - box.left) / Math.max(1, box.width) * 900, y: (e.clientY - box.top) / Math.max(1, box.height) * 600 }; };
  const aimed = jumpOn && aim && run ? jumpTarget(stepsAt(run, aim), done) : null;
  /** The item of the picture drawn at a point as far as execution is now (its box), for a tag. */
  const itemAt = (at: { x: number; y: number }) => { const found = run && stepwise ? stepsAt(run, at).filter(moment => moment.done <= done).at(-1)?.event : undefined;
    return found && Number.isFinite(found.x) && Number.isFinite(found.y) ? { x: found.x!, y: found.y!, w: found.w ?? 0, h: found.h ?? 0 } : null; };
  const stepLabel = (n: number) => { if (!run || n <= 0) return "Before start"; const item = runSteps(run)[n - 1]; return [item?.label || `Step ${n}`, stageOf(stepOp(run, n - 1))?.name].filter(Boolean).join(" · "); };
  // The parts of the brush (constraints, states, transitions) the execution, or one of its operations, belongs to.
  const parts = (list: ExecutionPart[] | undefined) => (list ?? []).flatMap(part => { const named = partName?.(part); return named ? [{ ...part, ...named }] : []; });
  const partChips = (list: ExecutionPart[] | undefined, small = false) => parts(list).map(part => <button key={`${part.kind}:${part.nodeId}:${part.id}`} type="button" className={`explore-part ${part.kind} ${small ? "small" : ""}`}
    title={`${PART_KINDS[part.kind]} “${part.name}” · ${part.node} · click to view in the ${part.kind === "constraint" ? "constraint panel on the right" : "state machine panel below"}`}
    onClick={() => onPart?.({ kind: part.kind, nodeId: part.nodeId, id: part.id })}><em>{PART_KINDS[part.kind]}</em>{part.name}</button>);
  const where = (at: NonNullable<ExploreEdit["at"]>) => at.moment.done !== null ? `Step ${at.moment.done}/${at.moment.count}` : `${Math.round(at.progress * 100)}%`;
  // Every text the frame writes on the picture is laid out together, so none covers another: the decision first, then
  // the state the step worked with (its points, its numbers), then its arrows' names; the step numbers and the caption
  // are kept clear, and what is left is given to the overlays' labels (`reserved`).
  const surface = useRef<HTMLDivElement>(null), caption = useRef<HTMLDivElement>(null);
  const [captionBox, setCaptionBox] = useState<Area | null>(null), [unit, setUnit] = useState(1);
  useLayoutEffect(() => {
    const at = surface.current?.getBoundingClientRect(), box = caption.current?.getBoundingClientRect();
    const next = at && box && at.width > 0 ? { x: (box.left - at.left) / at.width * 900, y: (box.top - at.top) / at.height * 600, width: box.width / at.width * 900, height: box.height / at.height * 600 } : null;
    if (JSON.stringify(next && Object.values(next).map(Math.round)) !== JSON.stringify(captionBox && Object.values(captionBox).map(Math.round))) setCaptionBox(next);
    const px = at && at.width > 0 ? Math.round(at.width / 900 * 100) / 100 : 1; if (px !== unit) setUnit(px);
  });
  const k = textSize / 17, explained = stepwise && Boolean(run) && captions;
  const arrows = useMemo(() => {
    if (!anchor || !glyphs.vectors.length) return [];
    const top = Math.max(1e-9, ...glyphs.vectors.map(item => Math.hypot(item.v[0], item.v[1])));
    const sum: [number, number] = [glyphs.vectors.reduce((n, item) => n + item.v[0], 0), glyphs.vectors.reduce((n, item) => n + item.v[1], 0)];
    return [...glyphs.vectors.map(item => ({ key: item.name, v: item.v, color: termColor(item.name), label: item.name, className: "" })), ...(glyphs.vectors.length > 1 ? [{ key: "@sum", v: sum, color: "#1f2a24", label: "together", className: "sum" }] : [])]
      .flatMap(item => { const size = Math.hypot(item.v[0], item.v[1]); if (size < 1e-9) return []; const length = Math.min(130, 22 + 80 * size / top);
        return [{ ...item, tx: anchor.x + item.v[0] / size * length, ty: anchor.y + item.v[1] / size * length }]; });
  }, [anchor?.x, anchor?.y, JSON.stringify(glyphs.vectors)]);
  // The tags written on the picture and the one edited there come first (they are what the user wrote), clear of the
  // caption and the step numbers; the frame's other texts keep clear of them.
  const tagged = showing && here, editingTag = tagged && !edit.making ? tagEditing : null;
  const tagRequests = tagged ? [...(editingTag && tagBox(edit.ideal, editingTag) ? [{ key: `edit:${editingTag}`, ...controlSize(edit.ideal, editingTag, unit), shape: tagBox(edit.ideal, editingTag)! }] : []),
    ...tagBlocks(edit.ideal, objectNames, read, editingTag).map(block => ({ key: block.key, ...blockSize(block), shape: block.box }))] : [];
  const layTags = (taken: Area[]) => layoutBlocks(tagRequests, { width: 900, height: 600 }, taken);
  const sheet = (() => {
    if (!explained) { const tags = layTags(captionBox ? [captionBox] : []); return { verdict: null, points: new Map<string, PlacedLabel>(), numbers: new Map<string, PlacedLabel>(), arrows: new Map<string, PlacedLabel>(), tags, taken: [...(captionBox ? [captionBox] : []), ...tags] }; }
    const number = (place: typeof lastPlace, text: string, end: boolean) => { const size = textSize * 1.3, width = textWidth(text, size), x = end ? place!.x - 4 - width : place!.x + (place!.w * place!.h > 0 ? place!.w : 18);
      return { x, y: place!.y - 6 - size * .8, width, height: size }; };
    let taken: Area[] = [...(captionBox ? [captionBox] : []), ...(lastPlace ? [number(lastPlace, String(done), true)] : []), ...(nextPlace ? [number(nextPlace, String(done + 1), false)] : [])];
    const tags = layTags(taken); taken = [...taken, ...tags];
    const lay = (requests: LabelRequest[], size: number) => { const out = layoutLabels(requests, size, { width: 900, height: 600 }, taken);
      taken = [...taken, ...out.map(label => ({ x: label.x, y: label.y - label.height * .8, width: label.width, height: label.height }))]; return new Map(out.map(label => [label.key, label])); };
    const verdictText = verdict ? `${verdict.pass ? "✓ " : "✗ "}${verdict.verdict}` : "", verdictSize = textSize * 1.35 * 1.08;
    const verdictLabel = verdict ? lay([{ key: "verdict", text: verdictText, anchor: { x: verdict.at.x - textWidth(verdictText, verdictSize) / 2, y: verdict.at.y - 10 }, shape: { x: verdict.at.x, y: verdict.at.y, w: 0, h: 0 } }], verdictSize).get("verdict") ?? null : null;
    const points = lay(lastShapes.map(shape => { const end = shape.points.at(-1)!;
      return { key: shape.key, text: `${shape.key.split(".").at(-1)}${shape.points.length === 1 ? ` (${Math.round(end.x)}, ${Math.round(end.y)})` : ""}`, anchor: { x: end.x + 9, y: end.y - 8 }, shape: { x: end.x - 7, y: end.y - 7, w: 14, h: 14 } }; }), textSize * .95 * 1.05);
    const valueSize = textSize * .85, right = lastPlace ? lastPlace.x + lastPlace.w + 10 + 190 * k < 900 : true;
    const numbers = lastPlace ? lay(stepNumbers.map((item, row) => { const text = `${item.key} ${item.text}`;
      return { key: item.key, text, anchor: { x: right ? lastPlace.x + lastPlace.w + 10 : lastPlace.x - 10 - textWidth(text, valueSize), y: lastPlace.y + (14 + row * 22) * k }, shape: { x: lastPlace.x, y: lastPlace.y, w: lastPlace.w, h: lastPlace.h } }; }), valueSize) : new Map<string, PlacedLabel>();
    const named = lay(arrows.map(item => ({ key: item.key, text: item.label, anchor: { x: item.tx + 6, y: item.ty - 6 }, shape: { x: item.tx - 4, y: item.ty - 4, w: 8, h: 8 } })), textSize * .95 * 1.08);
    return { verdict: verdictLabel, points, numbers, arrows: named, tags, taken };
  })();
  return <div ref={surface} className={`explore-frame-surface explore-${frame.mode} ${showing && here ? `edit-${edit.mode.startsWith("tool:") ? "tool" : edit.mode}` : ""}`} tabIndex={-1} onPointerDownCapture={onActivate}
    style={{ "--explore-text": `${textSize}px` } as React.CSSProperties}
    onKeyDown={e => { if (e.key === "Escape" && selected.length) { e.preventDefault(); e.stopPropagation(); setSelected([]); return; }
      if ((e.key === "Delete" || e.key === "Backspace") && selected.length && here && !edit.making) { e.preventDefault(); e.stopPropagation(); editHere({ ideal: removeObjects(edit.ideal, selected) }); setSelected([]); return; }
      if (e.key === "Escape" && jumping) { e.preventDefault(); e.stopPropagation(); setJumping(false); return; }
      if (!stepwise || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return; e.preventDefault(); e.stopPropagation(); setPlaying(false);
      // ←/→: one constraint (one step); with ⇧: one state machine step. Without FSM steps: the key steps as before.
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") { const way = e.key === "ArrowLeft" ? -1 : 1; if (!visits.length) stepBy(way); else if (e.shiftKey) visitBy(way); else goTo(done + way); }
      else goTo(e.key === "Home" ? 0 : count); }}>
    {frame.executable ? <CodePreview ref={preview} executable={frame.executable} onError={setRunError} restore={{ id: restoreId, runtime, params: { ...params, ...behaving }, ...(running ? { run: behaviorOn ? { budget: null, roots: frame.nodeIds, show: null } : { budget: step.budget, roots: frame.nodeIds, show: pictured } } : {}) }}
      onCapture={image => { if (running && budget.current === null) setGhost(image); latestShot.current = image; take(image); }}
      onDrawn={(restore, stored, recorded) => { setDrawn({ restore, stores: stored }); if (recorded) setRun(recorded); noteShot(restore); wantShot.current = true; setTimeout(() => take(latestShot.current), 300); }} />
      : <div className="frame-render-status"><span className="loading-spinner" /><strong>Preparing the preview…</strong></div>}
    {stepwise && ghost && step.budget !== null && !behaviorOn && <img className="explore-ghost" src={ghost} alt="" aria-hidden="true" />}
    {/* What the step (or the value) just changed in the picture. */}
    {showChange && change?.key === shotKey && change.added + change.removed > 0 && <img className="explore-change" src={change.image} alt="" aria-hidden="true" />}
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
          {sheet.points.get(shape.key) && <text x={sheet.points.get(shape.key)!.x} y={sheet.points.get(shape.key)!.y}>{sheet.points.get(shape.key)!.text}</text>}</g>; })}
        {/* The step's numbers, beside where it works (where there is room). */}
        <g className="explore-data-values">{stepNumbers.map(item => { const placed = sheet.numbers.get(item.key);
          return placed && <text key={item.key} x={placed.x} y={placed.y}>{item.key} <tspan>{item.text}</tspan></text>; })}</g>
        {/* What this step decided: what it tested, in the outcome's color, and the verdict on it. */}
        {verdict && <g className={`explore-test ${verdict.pass ? "pass" : "fail"}`}>
          {verdict.shapes.map((shape, j) => <TestShapeView key={j} shape={shape} />)}
          {sheet.verdict && <text className="verdict" x={sheet.verdict.x} y={sheet.verdict.y}>{sheet.verdict.text}</text>}</g>}
        {/* What made this step's result: its inner terms where it works. Arrows (vectors) scaled to the largest, and their sum. */}
        {anchor && arrows.map(item => { const a = Math.atan2(item.ty - anchor.y, item.tx - anchor.x), placed = sheet.arrows.get(item.key);
          const head = [[item.tx, item.ty], [item.tx - 11 * Math.cos(a - .45), item.ty - 11 * Math.sin(a - .45)], [item.tx - 11 * Math.cos(a + .45), item.ty - 11 * Math.sin(a + .45)]].map(q => q.join(",")).join(" ");
          return <g key={item.key} className={`explore-term-glyph ${item.className}`} style={{ color: item.color }}><line x1={anchor.x} y1={anchor.y} x2={item.tx} y2={item.ty} vectorEffect="non-scaling-stroke" />
            <polygon points={head} />{placed && <text x={placed.x} y={placed.y}>{placed.text}</text>}</g>; })}
      </svg>
      <div ref={caption} className={`explore-caption ${lastPlace && lastPlace.x + lastPlace.w / 2 < 450 ? "right" : "left"}`} aria-live="polite">
        <span className="explore-caption-head"><b>Step {done}</b> / {count}{stage && <i>{stage.name}</i>}</span>
        {/* In words, next to what the picture shows: what the step did, why it matters, what it decided, what comes next. */}
        {last && !last.none && <span className="explore-caption-now">{last.label || (lastStep && lastStep.kind !== "trace" ? `Draws: ${lastStep.kind}` : `Step ${done}`)}</span>}
        {verdict && <span className={`explore-caption-verdict ${verdict.pass ? "pass" : "fail"}`}>{verdict.pass ? "✓" : "✗"} {verdict.verdict}{othersTested > 0 && <small> · {othersTested} more compared</small>}</span>}
        {showChange && change?.key === shotKey && change.added + change.removed > 0 && <span className="explore-caption-legend"><i className="added" />drawn by this step{change.removed > 0 && <><i className="removed" />gone</>}</span>}
      </div>
    </>}
    {/* A state tool that reads things pressed: pressing an item of the picture or something drawn picks it (again: unpicks it); its grips stay on top. */}
    {setting && readsPicked(setting) && here && <svg className="explore-pick-sheet" viewBox="0 0 900 600" preserveAspectRatio="none" aria-label="Press things to check them with this tool"
      onPointerDown={e => { if (e.button !== 0) return; e.preventDefault(); e.stopPropagation(); const box = e.currentTarget.getBoundingClientRect(), at = { x: (e.clientX - box.left) / Math.max(1, box.width) * 900, y: (e.clientY - box.top) / Math.max(1, box.height) * 600 };
        const object = objectAt(edit.ideal, at), item = object ? null : itemAt(at);
        const pick = object ? { id: object.id, box: { x: 0, y: 0, width: 0, height: 0 } } : item ? { id: null, box: item.w * item.h > 0 ? { x: item.x, y: item.y, width: item.w, height: item.h } : { x: item.x - 12, y: item.y - 12, width: 24, height: 24 } } : null;
        if (!pick) return;
        const same = (other: typeof pick) => pick.id ? other.id === pick.id : !other.id && JSON.stringify(other.box) === JSON.stringify(pick.box);
        setPicks(list => list.some(same) ? list.filter(other => !same(other)) : [...list, pick].slice(-MAX_PICKED)); }}>
      {picked.map((box, i) => <g key={i} className="explore-pick" style={{ color: setting.color }}><rect x={box.x - 4} y={box.y - 4} width={box.width + 8} height={box.height + 8} vectorEffect="non-scaling-stroke" />
        <text x={box.x - 6} y={box.y - 8} textAnchor="end">{i + 1}</text></g>)}
    </svg>}
    {shown && <InspectionOverlay state={state} marks={[]} result={shown} drawn={stores} liveValues={{}} clickable zoom={zoom} onFocus={() => {}} plain specs={specs} textSize={textSize} reserved={sheet.taken}
      onHandle={(phase, key, value) => { if (phase === "start") setPlaying(false); if (value !== null) onValue(key, value); }} />}
    {/* The runtime state inspected (or referred to by the tag of what is selected), where it is at this moment. */}
    {showing && inspected.length > 0 && <VariableMarks readings={inspected} avoid={sheet.taken} />}
    {/* The state wanted at this moment: over the overlays while drawing, under them (shown only) while looking or setting state. */}
    {showing && here && <IdealSheet className="explore-edit-sheet" state={edit.ideal} onState={ideal => editHere({ ideal })} tools={edit.kit?.tools ?? []} mode={edit.mode}
      marks={edit.marks} onMarks={marks => editHere({ marks })} shot={picture} selected={selected} onSelect={setSelected} editable={!edit.making}
      onMode={mode => onEdit?.({ mode })} itemAt={itemAt} objectNames={objectNames} read={read}
      onTagPress={id => setSelected(edit.ideal.merges.find(merge => merge.id === id)?.members ?? [id])} tagEditing={editingTag} placedTags={sheet.tags} />}
    {/* The widget made for the rules on a tag: manipulated on the picture, it writes the rules (the object follows them). */}
    {showing && widget && widgetItem && <TagWidgetLayer widget={widget} world={widgetWorld(widgetItem, widget.values)} disabled={edit.making}
      onValues={values => { const next = { ...widget.values, ...values }; editHere({ ideal: applyWidget(edit.ideal, widget.id, widget, next, read), widgets: { ...edit.widgets, [widget.id]: { ...widget, values: next } } }); }}
      onError={message => onEdit?.({ widgetError: `The widget stopped: ${message}` })} />}
    {editingTag && (() => { const item = edit.ideal.objects.find(entry => entry.id === editingTag), spot = sheet.tags.find(entry => entry.key === `edit:${editingTag}`);
      return <TagControl state={edit.ideal} onState={ideal => editHere({ ideal })} id={editingTag} objects={objects} tools={edit.kit?.tools ?? []} refs={refChoices(readings)} editable
        examples={specExamples(edit.kit)} read={read} at={spot ? { x: spot.x, y: spot.y } : undefined} widget={item ? widgetControl(item) : undefined} />; })()}
    {/* Jumping: the part under the pointer, and the step that draws it (pressing executes up to there). */}
    {jumpOn && <svg ref={jumpSheet} className="explore-jump-sheet" viewBox="0 0 900 600" preserveAspectRatio="none" aria-label="Press a part to jump execution to the step that draws it"
      onPointerMove={e => setAim(jumpPoint(e))} onPointerLeave={() => setAim(null)}
      onPointerDown={e => { if (e.button !== 0 || !run) return; e.preventDefault(); e.stopPropagation(); const at = jumpPoint(e), target = jumpTarget(stepsAt(run, at), done);
        setAim(at); if (target) { setPlaying(false); setJumped(target.done); goTo(target.done); } }}>
      {aimed && <>
        <rect className="explore-jump-box" x={aimed.event.x} y={aimed.event.y} width={Math.max(4, aimed.event.w ?? 0)} height={Math.max(4, aimed.event.h ?? 0)} vectorEffect="non-scaling-stroke" />
        <text className="explore-jump-label" x={Math.min(880, Math.max(8, aim!.x + 14))} y={Math.max(18, aim!.y - 12)} textAnchor={aim!.x > 600 ? "end" : "start"}>{`Step ${aimed.done}/${count} · ${stepLabel(aimed.done)}`}</text>
      </>}
    </svg>}
    <div className="explore-bar board-scroll" onPointerDown={e => e.stopPropagation()}>
      <span className="section-kicker">EXECUTION · STEP BY STEP</span>
      {frame.status === "idle" && <span className="explore-status" role="status">Not generated yet. Press to have the AI split this process into steps.<button onClick={() => onRetry()}>Generate</button></span>}
      {frame.status === "queued" && <span className="explore-status" role="status"><span className="loading-spinner" />Waiting in line. The AI will generate this once the earlier exploration frames finish…</span>}
      {frame.status === "loading" && <span className="explore-status" role="status"><span className="loading-spinner" />The AI is splitting the inner workings into steps…</span>}
      {frame.status === "error" && <span className="explore-status error" role="alert">{frame.error}<button onClick={() => onRetry()}>Retry</button></span>}
      {/* Make the frame again, optionally saying what to change. */}
      {(frame.status === "ready" || frame.status === "error") && <form className="explore-regenerate" onSubmit={e => { e.preventDefault(); onRetry(remake); setRemake(""); }}>
        <input value={remake} onChange={e => setRemake(e.currentTarget.value)} maxLength={400} placeholder="What to change (optional), e.g. fewer marks, explain the test" aria-label="What to change when regenerating" />
        <button type="submit" title="Have the AI make this frame again (with what you wrote)"><Icon name="undo" size={12} />Regenerate</button></form>}
      {runError && <span className="explore-status error" role="alert">Code execution error{frame.result?.edits.length ? " (with the execution checkpoints)" : ""}: {runError}<button onClick={() => onRetry()}>Regenerate</button></span>}
      {/* Handles AI made that cannot be placed at this moment (they read something this step does not have). */}
      {!runError && setting && unplaced > 0 && <span className="explore-status error" role="alert">Couldn't place {unplaced} grip(s) of “{setting.name}” at this moment. They read values this moment's state doesn't have.</span>}
      {/* The parts of the brush this execution runs. */}
      {result && parts(result.of).length > 0 && <div className="explore-parts"><span>Part of</span>{partChips(result.of)}</div>}
      {result && <p className={`explore-summary ${summaryOpen ? "open" : ""}`} title={summaryOpen ? "Click to fold" : "Click to read all"} onClick={() => setSummaryOpen(!summaryOpen)}>{result.summary}</p>}
      {result && running && !stepwise && <span className="explore-status" role="status"><span className="loading-spinner" />Recording the code execution as steps…</span>}
      {behaviorOn && stepwise && done < count && <span className="explore-status" role="status">The picture is the whole run with the behavior you drew; the steps explain the run.</span>}
      {/* Step by step: execute or take back one internal operation at a time; what was just done and what comes next. */}
      {result && stepwise && <>
        <div className="explore-stepper" role="group" aria-label="Execution steps">
          <button aria-label="Back to the first step" title="First (Home)" disabled={done <= 0} onClick={() => { setPlaying(false); goTo(0); }}><Icon name="undo" size={12} /></button>
          {visits.length > 0 && <button aria-label="Back one state machine step" title="Back to where the previous state machine step starts (⇧←)" disabled={done <= 0} onClick={() => { setPlaying(false); visitBy(-1); }}>◀◀ State</button>}
          <button aria-label="Take back one step" title={visits.length ? "Back one constraint (←)" : keyed ? "Back to the previous key step (←)" : "Back one step (←)"} disabled={done <= 0} onClick={() => { setPlaying(false); visits.length ? goTo(done - 1) : stepBy(-1); }}>◀</button>
          <output>{visits.length ? <>State step <b>{Math.max(0, visits.filter(item => item.start < done).length)}</b> / {visits.length} <small>· step {done}/{count}</small></>
            : keyed ? <>Key step <b>{keyAt}</b> / {keys.length - 1} <small>· step {done}/{count}</small></> : <>Step <b>{done}</b> / {count}</>}</output>
          <button aria-label="Execute one step" title={visits.length ? "Execute the next constraint (→)" : keyed ? "Execute up to the next key step (→)" : "Execute one step (→)"} disabled={done >= count} onClick={() => { setPlaying(false); visits.length ? goTo(done + 1) : stepBy(1); }}>▶ {visits.length ? "Constraint" : keyed ? "Next key step" : "One step"}</button>
          {visits.length > 0 && <button aria-label="Execute one state machine step" title="Execute the whole state machine step: the state visit with its constraints in order, or the transition (⇧→)" className="primary" disabled={done >= count} onClick={() => { setPlaying(false); visitBy(1); }}>▶▶ State</button>}
          <button aria-label="Execute all steps" title="To the end (End)" disabled={done >= count} onClick={() => { setPlaying(false); goTo(count); }}>⏭</button>
          <button aria-label={playing ? "Pause stepping" : "Play step by step"} title={playing ? "Pause" : "Play step by step"} onClick={play}><Icon name={playing ? "pause" : "play"} size={12} /></button>
          <button className={jumpOn ? "active" : ""} aria-pressed={jumpOn} title="Moves execution to the step that draws the part you press in the picture (Esc to turn off)"
            onClick={() => { const next = !jumpOn; setJumping(next); setAim(null); if (next) { setPlaying(false); if (edit.mode !== "run") onEdit?.({ mode: "run" }); } }}>◎ Jump to pressed</button>
          {count > KEY_STEPS && <button className={allSteps ? "active" : ""} aria-pressed={allSteps} title={allSteps ? "Stop only at the key steps: one round of the operations in full, then the rest in chunks" : `Go through every one of the ${count} steps`}
            onClick={() => setAllSteps(!allSteps)}>{allSteps ? "Key steps only" : `All ${count} steps`}</button>}
          <button className={showChange ? "active" : ""} aria-pressed={showChange} title="Color what the step just changed in the picture: drawn blue, gone orange" onClick={() => setShowChange(!showChange)}>Show change</button>
          <label className="explore-toggle" title="Write on the picture what the step did, where, the state it worked with and what it decided"><input type="checkbox" checked={captions} onChange={e => setCaptions(e.currentTarget.checked)} />Explain on picture</label>
          <span className="explore-text-size" role="group" aria-label="Text size on the picture" title="How big the words on the picture are">
            <button aria-label="Smaller text on the picture" disabled={textSize <= 10} onClick={() => setTextSize(textSize - 2)}>A−</button><output>{textSize}</output>
            <button aria-label="Larger text on the picture" disabled={textSize >= 36} onClick={() => setTextSize(textSize + 2)}>A+</button></span>
        </div>
        {showChange && change?.key === shotKey && <span className="explore-change-legend">{change.added + change.removed > 0
          ? <><i className="added" />{change.byStep ? "drawn by this step" : "drawn with this value"}{change.removed > 0 && <><i className="removed" />gone</>}</>
          : change.byStep ? "This step changed nothing in the picture (it only computes; its result shows at a later step)." : "Nothing changed in the picture."}</span>}
        {/* Where execution is and the key steps. */}
        {count > 1 && <div className="explore-timeline">
          <div className="explore-timeline-track" title="Click to go to that point of execution"
            onClick={e => { const box = e.currentTarget.getBoundingClientRect(), at = Math.round((e.clientX - box.left) / Math.max(1, box.width) * count); setPlaying(false);
              goTo(keyed ? keys.reduce((best, stop) => Math.abs(stop - at) < Math.abs(best - at) ? stop : best, 0) : at); }}>
            {keyed && keys.map(stop => <i key={stop} className="key" style={{ left: `${stop / count * 100}%` }} />)}
            <b className="now" style={{ left: `${done / count * 100}%` }} />
          </div>
        </div>}
        {jumpOn && <span className="explore-explain">Press the picture to execute up to the step that draws that part · press the same spot again for the next step that draws there · Esc to turn off</span>}
        {/* What the step just did, here when it is not written on the picture (only what was done: what comes next shows when it is done). */}
        {!captions && <div className="explore-step-now"><b>{last && !last.none ? last.label || `Step ${done}` : "Nothing executed yet"}</b>{last && stageOf(last.op) && <i>{stageOf(last.op)!.name}</i>}</div>}
        {/* What the step just executed worked with: its data and the inner terms it computed. */}
        {readValues.length > 0 && <div className="explore-step-values" aria-label="Values the step just executed read">
          <em>Read</em>{readValues.map(item => <span key={`${item.term}:${item.key}`} className={item.term ? "term" : ""}
            title={item.term ? "Inner term (m.term) computed in this step: its last value" : "Value this step's checkpoint recorded"}>{item.key} <b>{item.text}</b></span>)}
        </div>}
        {/* The state machine step execution is in: its owner and state, then its constraints in evaluation order (done, now, to come). */}
        {visit && <div className="explore-fsm" aria-label="State machine step">
          <button type="button" className={`explore-fsm-head ${visit.head.fsm}`} title={nameOfStep(visit.start)?.explain || undefined} onClick={() => { setPlaying(false); goTo(visit.start + 1); }}>
            <em>{visit.head.fsm === "transition" ? "Transition" : "State"}</em>{nameOfStep(visit.start)?.name ?? (visit.head.fsm === "transition" ? `${visit.head.state} → ${visit.head.to}` : visit.head.state)}</button>
          {visit.steps.slice(1).map((index, order) => { const named = nameOfStep(index), item = fsmOf(steps[index]?.data);
            return <button key={index} type="button" className={`explore-fsm-constraint ${index < done ? "done" : ""} ${index === done - 1 ? "current" : ""}`} title={named?.explain || undefined}
              onClick={() => { setPlaying(false); goTo(index + 1); }}><small>{order + 1}</small>{item?.property ?? named?.name}{index < done && item && "value" in item && <b>{shortValue(item.value)}</b>}</button>; })}
        </div>}
        {stageOf(currentOp)?.explain && <span className="explore-explain">{stageOf(currentOp)!.explain}</span>}
      </>}
      {result && !running && <div className="explore-scrub">
        <button aria-label={playing ? "Pause execution" : "Play execution"} title={playing ? "Pause" : "Play the process"} onClick={play}><Icon name={playing ? "pause" : "play"} size={12} /></button>
        <input type="range" aria-label="Execution progress" min={from} max={to} step={.001} value={Math.min(to, Math.max(from, frame.progress))} onChange={e => { setPlaying(false); onProgress(e.currentTarget.valueAsNumber); }} />
        <output>{Math.round((frame.progress - from) / Math.max(.001, to - from) * 100)}%</output>
      </div>}
      {/* Draw the state wanted at this moment with the tools AI makes for the concern, then fix the brush to it. */}
      {showing && !alignOpen && <button className="explore-recommend-open" onClick={openAlign}><Icon name="spark" size={12} />Draw the state you want at this moment</button>}
      {showing && alignOpen && <div className="explore-recommend explore-align">
        <button className="explore-recommend-close" aria-label="Fold" title="Fold" onClick={() => setAlignOpen(false)}><Icon name="close" size={10} /></button>
        <span className="section-kicker">THE STATE YOU WANT · draw it at this moment of execution</span>
        {/* The tools stay: elsewhere than the drawing's moment they only inspect (drawing waits until it is gone back to or cleared). */}
        {!here && <span className="explore-status">There is a drawing made at {where(edit.at!)} · go there to draw on, or clear it to draw at this moment.
          <button onClick={() => { setPlaying(false); onProgress(edit.at!.progress); }}>Go to that moment</button>
          <button disabled={edit.making} onClick={() => { setSelected([]); editHere({ ideal: { objects: [], merges: [] }, marks: [], preset: "" }); }}>Clear</button></span>}
        <IdealTools state={edit.ideal} onState={ideal => editHere({ ideal })} kit={edit.kit} mode={edit.mode} onMode={mode => onEdit?.({ mode })} selected={here ? selected : []} onSelect={setSelected}
          changes={changes} onStateValues={values => onStateValues?.(values)}
          marks={edit.marks} onMarks={marks => editHere({ marks })} editable={here && !edit.making} busy={edit.making} preset={edit.preset} onPreset={preset => onEdit?.({ preset })} making={edit.kitting} onMake={makeKit}
          presetsElsewhere={Boolean(edit.kitAt && edit.kitAt !== restoreId)} objects={objects} current={holding} read={read} variables={readings} inspecting={inspecting} onInspect={setInspecting}
          dead={dead} behaving={behaving} />
        {edit.kitError && <span className="fork-slot-message error" role="alert">{edit.kitError}</span>}
        <RefInput multiline value={edit.note} onValue={note => onEdit!({ note })} refs={refChoices(readings)} rows={2} maxLength={2000} disabled={edit.making}
          placeholder={`Say it in words too (optional) · e.g. they become one where they touch${readings.length ? " · @ refers to runtime state" : ""}`}
          onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && sketched) fix(); }} />
        <div className="fork-slot-actions">
          {edit.making ? <><span className="fork-slot-message waiting"><span className="loading-spinner" />The AI is reading what you drew and fixing a fork of the brush to it…</span><button onClick={onCancel}>Cancel</button></>
            : <button className="primary" disabled={!sketched || edit.kitting} title="AI reads the state you drew and changes a fork of the brush so it does that (the brush stays as it is)"
              onClick={fix}><Icon name="spark" size={13} />Fix the brush to this</button>}
          {edit.kitting && <button onClick={onCancel}>Stop making tools</button>}
        </div>
        {edit.reply && <span className="fork-slot-message">{edit.reply}{edit.forkId && onOpenFork && <button onClick={() => onOpenFork(edit.forkId)}>Go to the fork<Icon name="arrow" size={11} /></button>}</span>}
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
