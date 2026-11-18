import { z } from "zod";
import type { Brush } from "../lib/brushes";
import { brushNodeIds } from "../lib/brushes";
import { concernSuggestionsSchema, paramRows, type Scalar, emptyInspection, fixConstraints, heldIndex, inspectResultSchema, markStyleAt, MAX_MARKS, runtimeForAI, stepValues, type Fix, type InspectResult, type InspectionState, type MarkStyle } from "../lib/inspection";
import { exposeParameter, moduleKeyOf, recordFields, recordingApplied, type ParameterSuggestion, type Recording } from "../lib/hidden-parameters";
import type { GeneratedCode } from "../lib/schema";
import type { Scene } from "../lib/scene/schema";
import { preparedFor, prepareProgram } from "../lib/prepared";
import { findNode } from "../lib/scene/graph";
import { liveSceneSource } from "../lib/scene/live";
import { programModules } from "../lib/scene/machines";
import * as ops from "../lib/scene/panel-ops";
import type { ScalarValue } from "../lib/scene/schema";
import type { InspectionInput } from "../lib/schema";
import { sceneBindings } from "../lib/scene/values";
import type { AppliedSnapshot, SketchPanel } from "../lib/sketch-panels";
import { sceneAI } from "./scene-actions";
import { annotatedImage, compactMarks, idealImage } from "./annotated-image";
import { alignFixSchema, alignKitSchema, tagWidgetSchema, type AlignFix, type AlignKit, type AlignRefs, type AlignTool, type IdealState, type RuntimeVar, type StateChange, type TagWidgetSpec } from "../lib/alignment";
import type { ExecutionMoment } from "../lib/explore";
import { hookField, type FieldHook } from "../lib/fields";
import type { StudioDeps } from "./deps";

type Change = { key: string; stateId: string; value: number | string | boolean };

/** The frame's inspection for this brush. */
export const inspectionFor = (panel: SketchPanel, brushId: string): InspectionState => panel.inspections[brushId] ?? emptyInspection(brushId);
/** Panel patch storing one brush's inspection. */
export const withInspection = (panel: SketchPanel, state: InspectionState) => ({ inspections: { ...panel.inspections, [state.brushId]: state } });
/** Panel patch deleting every brush's recorded history in the frame (as Reset history does): run again from the start, it is recorded anew. */
export const withoutHistory = (panel: SketchPanel) => ({ inspections: Object.fromEntries(Object.entries(panel.inspections).map(([id, state]) => [id, { ...state, steps: [], cursor: null, focus: null }])) });

/** Set scalar values (base or a state's) in one undo step. Values of the wrong type are skipped. */
export function applyChanges(deps: StudioDeps, owner: string, changes: Change[]) {
  deps.updatePanel(owner, panel => {
    const bindings = new Map(sceneBindings(panel.scene).map(binding => [binding.key, binding]));
    let scene = panel.scene, applied = 0;
    for (const change of changes) {
      const binding = bindings.get(change.key); if (!binding) continue;
      const value: ScalarValue["value"] | null = binding.type === "number" ? (Number.isFinite(Number(change.value)) ? Number(change.value) : null)
        : binding.type === "toggle" ? (typeof change.value === "boolean" ? change.value : change.value === "true")
        : String(change.value);
      if (value === null) continue;
      const editingStates = { ...panel.editingStates };
      if (change.stateId && findNode(scene, binding.nodeId)?.machine?.states.some(state => state.id === change.stateId)) editingStates[binding.nodeId] = change.stateId; else delete editingStates[binding.nodeId];
      const patch = ops.setParamScalar({ ...panel, scene, editingStates }, binding.nodeId, binding.path[0], binding.path.slice(1), value);
      if (patch.scene) { scene = patch.scene; applied++; }
    }
    return applied ? ops.commitScene(panel, scene) : { error: "There are no values that can be applied." };
  });
}

/**
 * Targeted inspection: AI builds overlays for the concern (marked with the
 * inspection annotation and/or written). Returns the result.
 * With `update`, a fix was just applied and the overlays are rebuilt to show it.
 */
export async function inspectConcern(deps: StudioDeps, owner: string, brush: Brush, draft: { concern: string; marks: InspectionState["marks"]; markStyles?: MarkStyle[] }, update: InspectionInput["update"] = null,
  /** `onTimed`: how long the AI took (ms). */
  options: { onTimed?: (ms: number) => void } = {}) {
  const panel = deps.panel(owner), state = inspectionFor(panel, brush.id), nodeIds = brushNodeIds(panel.scene, brush, owner);
  if (!nodeIds.length) { deps.updatePanel(owner, { error: `This frame has no ${brush.name} brush.` }); return null; }
  const snapshot = JSON.stringify(panel.scene), out: { result?: InspectResult } = {};
  await deps.task(update ? "AI is updating the targeted inspection overlay to show the fix…" : "AI is creating a targeted inspection for this concern…", async () => {
    // The result is held at the selected step, so the live capture shows that moment.
    const styles = draft.marks.map((_, i) => markStyleAt(draft.markStyles, i));
    const image = await annotatedImage((await deps.capture(owner, true)).image, draft.marks, undefined, styles);
    const rows = paramRows(panel.scene, nodeIds), started = performance.now();
    // The code, so hard-coded constants the concern depends on can be suggested as parameters.
    const result: InspectResult = inspectResultSchema.parse(await deps.request("inspect", { scene: panel.scene, targetNodeId: nodeIds[0], instruction: draft.concern.trim(), image, previous: panel.generated?.code ?? "",
      inspection: { brushName: brush.name, nodeIds, cursor: heldIndex(state),
        params: rows.map(row => ({ key: row.key, nodeId: row.binding.nodeId, constraintId: row.constraintId, constraint: row.constraint, paramId: row.binding.path[0], param: row.param, type: row.binding.type })),
        steps: state.steps.map(item => ({ id: item.id, nodeId: item.nodeId, from: item.from, to: item.to, transitionId: item.transitionId, values: stepValues(item)!, runtime: runtimeForAI(item, nodeIds) })),
        marks: compactMarks(draft.marks, MAX_MARKS), markStyles: styles.slice(-MAX_MARKS), update } }, owner));
    options.onTimed?.(performance.now() - started);
    if (snapshot !== JSON.stringify(deps.panel(owner).scene)) throw new Error("The scene changed during inspection. Please try again.");
    out.result = result;
  }, owner);
  // The overlays read a per-item quantity the module computes but did not keep on its items: it now records it (code only, nothing drawn changes).
  if (out.result?.records) await applyRecording(deps, owner, out.result.records);
  // The fields the concern is about are declared in the code, so they can be shown and combed (nothing drawn changes).
  for (const hook of out.result?.fields ?? []) await applyFieldHook(deps, owner, hook);
  return out.result ?? null;
}

/** What concern suggestions were read from: the marks (cheap to compare). */
export const concernMarksKey = (marks: InspectionState["marks"]) => marks.map(mark => `${mark.length}:${mark[0]?.x.toFixed(3)},${mark[0]?.y.toFixed(3)}:${mark.at(-1)?.x.toFixed(3)},${mark.at(-1)?.y.toFixed(3)}`).join("|");
/**
 * Concern autocomplete: AI reads the inspection annotation (and what has been
 * typed) and suggests concerns. Quiet on purpose: it is not a frame task (no
 * busy state, no frame error, not cancelled with the frame's work) and the
 * caller drops answers that came too late.
 */
export async function suggestConcerns(deps: StudioDeps, owner: string, brush: Brush, draft: { concern: string; marks: InspectionState["marks"]; markStyles?: MarkStyle[] }, signal: AbortSignal) {
  const panel = deps.panel(owner), nodeIds = brushNodeIds(panel.scene, brush, owner);
  if (!nodeIds.length || (!draft.marks.length && !draft.concern.trim())) return [];
  const styles = draft.marks.map((_, i) => markStyleAt(draft.markStyles, i));
  const image = await annotatedImage((await deps.capture(owner, true)).image, draft.marks, undefined, styles);
  if (signal.aborted) return [];
  const response = await fetch("/api/generate", { method: "POST", headers: { "Content-Type": "application/json" }, signal, body: JSON.stringify({ intent: "concern", scene: panel.scene, targetNodeId: nodeIds[0], instruction: draft.concern.slice(0, 2000), image,
    inspection: { brushName: brush.name, nodeIds, params: [], steps: [], cursor: null, marks: compactMarks(draft.marks, MAX_MARKS), markStyles: styles.slice(-MAX_MARKS) } }) });
  const result = await response.json();
  if (!response.ok || result.error) throw new Error(result.error || "Could not suggest concerns.");
  return concernSuggestionsSchema.parse(result).suggestions;
}

/** Where alignment happens: the concern, the inspection's summary, the moment of execution, and that moment's brush marks (values and run state). */
export type AlignContext = { concern: string; summary: string; moment: ExecutionMoment; step: { runtime: unknown; values: Record<string, Scalar> } };
/** The request both alignment steps send: the brush, its params, and the moment as one step. */
function alignRequest(deps: StudioDeps, owner: string, brush: Brush, intent: "align-kit" | "align" | "tag-widget", context: AlignContext, image: string, note: string, marks: InspectionState["marks"], align: Record<string, unknown>) {
  const panel = deps.panel(owner), nodeIds = brushNodeIds(panel.scene, brush, owner);
  if (!nodeIds.length) throw new Error("This frame's brush is needed.");
  const rows = paramRows(panel.scene, nodeIds), moment = context.moment;
  const step = { id: 1, at: 0, nodeId: null, from: null, to: null, transitionId: null, values: context.step.values, runtime: context.step.runtime };
  return { intent, scene: panel.scene, targetNodeId: nodeIds[0], instruction: note.trim().slice(0, 2000), image, previous: panel.generated?.code ?? "",
    inspection: { brushName: brush.name, nodeIds, cursor: 0, marks: compactMarks(marks, MAX_MARKS), markStyles: [],
      params: rows.map(row => ({ key: row.key, nodeId: row.binding.nodeId, constraintId: row.constraintId, constraint: row.constraint, paramId: row.binding.path[0], param: row.param, type: row.binding.type })),
      steps: [{ id: step.id, nodeId: null, from: null, to: null, transitionId: null, values: step.values, runtime: runtimeForAI(step, nodeIds) }],
      align: { concern: context.concern.slice(0, 2000), summary: context.summary.slice(0, 1500),
        execution: { ...moment, summary: moment.summary.slice(0, 1200), last: moment.last.slice(0, 200), next: moment.next.slice(0, 200), stage: moment.stage && { name: moment.stage.name.slice(0, 40), explain: moment.stage.explain.slice(0, 300) } },
        ...align } } };
}
async function post<T>(body: unknown, signal: AbortSignal, parse: (value: unknown) => T, fallback: string) {
  const response = await fetch("/api/generate", { method: "POST", headers: { "Content-Type": "application/json" }, signal, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok || result.error) throw new Error(result.error || fallback);
  return parse(result);
}
/**
 * Debugging intent alignment, first half: AI reads the concern at the moment the Execution frame shows (`image`, as
 * drawn there) and makes the micro direct manipulation tools to draw the state wanted, and presets made with them.
 */
export async function requestAlignKit(deps: StudioDeps, owner: string, brush: Brush, context: AlignContext, image: string, signal: AbortSignal, request = "", tools: AlignTool[] = [], variables: RuntimeVar[] = []): Promise<AlignKit> {
  // A tool asked for in words: AI makes it beside the tools (and the runtime state referred to) there are.
  return post(alignRequest(deps, owner, brush, "align-kit", context, image, request, [], request ? { tools, variables } : {}), signal, value => alignKitSchema.parse(value), "Could not make the tools.");
}
/**
 * A widget on the tag of a drawn object: AI reads what the rules written there mean (with the moment's picture as drawn,
 * the drawing, the runtime state as it reads now) and makes a direct manipulation interface on the picture for trying what
 * they could be instead; `request`: how to change the one it has.
 */
export async function requestTagWidget(deps: StudioDeps, owner: string, brush: Brush, context: AlignContext, image: string,
  drawn: { ideal: IdealState; tools: AlignTool[]; reading: string; refs: AlignRefs; widget: { object: string; box: { x: number; y: number; w: number; h: number }; rules: { aspect: string; expr: string; now: number | null }[]; current: TagWidgetSpec | null } },
  request: string, signal: AbortSignal): Promise<TagWidgetSpec & { prepared: string }> {
  return post(alignRequest(deps, owner, brush, "tag-widget", context, image, request, [], drawn), signal, value => tagWidgetSchema.extend({ prepared: z.string().min(1).max(200000) }).parse(value), "Could not make the widget.");
}
/**
 * Debugging intent alignment, second half: AI reads the state the user drew at that moment (objects made with the
 * kit's tools, notes, a note in words, the execution state set by hand; `image` is the moment's picture as drawn now) and
 * returns the change of the brush that makes it so.
 */
export async function requestAlignFix(deps: StudioDeps, owner: string, brush: Brush, context: AlignContext,
  drawn: { image: string; ideal: IdealState; marks: InspectionState["marks"]; note: string; kit: AlignKit | null; preset: { title: string; detail: string } | null; state: StateChange[]; refs: AlignRefs }, signal: AbortSignal): Promise<AlignFix> {
  const image = await annotatedImage(await idealImage(drawn.image, drawn.ideal), drawn.marks);
  return post(alignRequest(deps, owner, brush, "align", context, image, drawn.note, drawn.marks,
    { reading: drawn.kit?.reading ?? "", tools: drawn.kit?.tools ?? [], preset: drawn.preset, ideal: drawn.ideal, state: drawn.state, refs: drawn.refs }), signal, value => alignFixSchema.parse(value), "Could not fix the brush.");
}

/** A name for a new targeted tool: the start of its concern. */
export function targetedName(concern: string, count: number) {
  const text = concern.trim().replace(/\s+/g, " ");
  return text ? (Array.from(text).length > 24 ? `${Array.from(text).slice(0, 23).join("")}…` : text) : `Concern ${count + 1}`;
}

const snapshot = (panel: SketchPanel): AppliedSnapshot => ({ scene: panel.scene, generated: panel.generated, codeDraft: panel.codeDraft, executable: panel.executable, preparedCode: panel.preparedCode, composePrompt: panel.composePrompt, dirtyNodeIds: panel.dirtyNodeIds });
/** Same scene, code and prompt (what an applied fix changes). */
export const sameSnapshot = (a: AppliedSnapshot, b: AppliedSnapshot) => (a.scene === b.scene || JSON.stringify(a.scene) === JSON.stringify(b.scene)) && (a.generated?.code ?? "") === (b.generated?.code ?? "") && a.composePrompt === b.composePrompt;
/** Which fix an applied entry is. */
export const fixKey = (item: Fix) => `${item.kind}:${item.nodeId}:${item.targetId}:${item.title}`;
/** The frame now is what an applied entry left (else undo/redo would also drop later edits). */
export const appliedCurrent = (panel: SketchPanel, direction: "undo" | "redo") => {
  const entry = direction === "undo" ? panel.applied.past.at(-1) : panel.applied.future.at(-1);
  return Boolean(entry && sameSnapshot(direction === "undo" ? entry.after : entry.before, snapshot(panel)));
};

/**
 * Apply a fix: values directly, a constraint/state/transition through AI
 * (with the code rewritten after a constraint). The frame before and after is
 * kept, so the whole application can be undone and redone (marked with `key`).
 * Returns the constraint it added, if any.
 */
export async function applyFix(deps: StudioDeps, owner: string, fix: Fix, key = fixKey(fix)) {
  const instruction = `${fix.title}\n${fix.detail}`.slice(0, 2000), before = snapshot(deps.panel(owner));
  const existing = new Set(findNode(before.scene, fix.nodeId)?.constraints.map(item => item.id));
  if (fix.kind === "value") applyChanges(deps, owner, fix.changes);
  else {
    const ai = sceneAI(deps, owner);
    // Every constraint the fix changes, in turn; the code is rewritten once at the end (and undo apply takes all of it back).
    if (fix.kind === "constraint") await ai.regenerateAll(fix.nodeId, fixConstraints(fix), instruction);
    // Nothing existing was related: a new constraint is stacked on the node (then the code follows).
    else if (fix.kind === "add-constraint") await ai.regenerate(fix.nodeId, {}, instruction);
    // A state or transition refined: the code is rewritten to it too (else the frame would draw as before).
    else await ai.refineMachine(fix.nodeId, { target: { kind: fix.kind, id: fix.targetId }, instruction, marks: [], code: true });
  }
  const after = snapshot(deps.panel(owner));
  if (sameSnapshot(before, after)) return null;
  deps.updatePanel(owner, panel => ({ applied: { past: [...panel.applied.past, { id: crypto.randomUUID(), title: fix.title, key, before, after: snapshot(panel) }].slice(-20), future: [] } }));
  return fix.kind === "add-constraint" ? findNode(after.scene, fix.nodeId)?.constraints.find(item => !existing.has(item.id)) ?? null : null;
}

/**
 * Accept a suggested hidden parameter: the constant becomes a param of its
 * constraint and the module reads it, with no regeneration. The new program
 * is prepared first and the module is swapped into the running result in place
 * (nothing drawn is lost); scene and code are then committed together as one
 * applied entry, so Undo apply takes both back. Returns whether it was added.
 */
export async function acceptParameter(deps: StudioDeps, owner: string, item: ParameterSuggestion) {
  const panel = deps.panel(owner), fail = (why: string) => { deps.updatePanel(owner, { error: `Could not add “${item.label}”: ${why}` }); return false; };
  if (!panel.generated) return fail("This frame has no code");
  const result = exposeParameter(panel.scene, panel.generated, item);
  if ("error" in result) return fail(`${result.error}. If the code changed, use Inspect again`);
  return swapModule(deps, owner, result, moduleKeyOf(panel.scene, item.nodeId)!, { title: `Expose ${item.label}`, key: `parameter:${item.nodeId}:${item.id}` }, fail);
}

/**
 * Apply an inspection's recorded fields: the module also keeps the per-item
 * quantity on each item record, so overlays can show it per item. Only the code
 * changes (in place, one applied entry). Returns whether it was applied now.
 */
export async function applyRecording(deps: StudioDeps, owner: string, item: Recording) {
  const panel = deps.panel(owner), fail = (why: string) => { deps.updatePanel(owner, { error: `Could not add item records (${item.fields.join(", ")}): ${why}` }); return false; };
  if (!panel.generated) return fail("This frame has no code");
  if (recordingApplied(panel.scene, panel.generated.code, item)) return false;
  const result = recordFields(panel.scene, panel.generated, item);
  if ("error" in result) return fail(`${result.error}. If the code changed, use Inspect again`);
  return swapModule(deps, owner, { scene: panel.scene, generated: result.generated }, moduleKeyOf(panel.scene, item.nodeId)!, { title: `Item records: ${item.fields.join(", ")}`, key: `records:${item.nodeId}:${item.fields.join(",")}` }, fail);
}

/** Declare a field the concern is about in the frame's code (m.field around where the code computes it); nothing drawn changes. */
export async function applyFieldHook(deps: StudioDeps, owner: string, hook: FieldHook) {
  const panel = deps.panel(owner), fail = (why: string) => { deps.updatePanel(owner, { error: `Could not show the field “${hook.name}”: ${why}` }); return false; };
  if (!panel.generated) return fail("This frame has no code");
  const result = hookField(panel.scene, panel.generated, hook);
  if ("error" in result) return fail(`${result.error}. If the code changed, use Inspect again`);
  if (result.generated === panel.generated) return true;
  return swapModule(deps, owner, { scene: panel.scene, generated: result.generated }, moduleKeyOf(panel.scene, hook.nodeId)!, { title: `Field: ${hook.name}`, key: `field:${hook.nodeId}:${hook.id}` }, fail);
}

/**
 * Put a program with one module edited in place: it is prepared first, the module
 * is swapped into the running result (nothing drawn is lost), and scene and code
 * are committed together as one applied entry, so Undo apply takes both back.
 */
async function swapModule(deps: StudioDeps, owner: string, next: { scene: Scene; generated: GeneratedCode }, moduleKey: string, entry: { title: string; key: string }, fail: (why: string) => boolean) {
  const panel = deps.panel(owner), before = snapshot(panel), code = next.generated.code, previous = panel.generated?.code;
  let executable: string;
  try { executable = preparedFor(code) ?? await prepareProgram(code); }
  catch (error) { return fail(error instanceof Error ? error.message : "The code did not pass the check"); }
  if (deps.panel(owner).generated?.code !== previous) return fail("The code changed in the meantime");
  const preview = deps.preview(owner), text = programModules(executable).get(moduleKey);
  if (text && panel.executable && preview?.isReadyFor(panel.executable)) preview.inject(text, executable, moduleKey);
  deps.updatePanel(owner, current => {
    const patch = { ...ops.commitScene(current, next.scene), generated: next.generated, codeDraft: liveSceneSource(next.generated, next.scene), executable, preparedCode: code, runtimeError: "", error: "" };
    const applied = { id: crypto.randomUUID(), ...entry, before, after: snapshot({ ...current, ...patch } as SketchPanel) };
    return { ...patch, applied: { past: [...current.applied.past, applied].slice(-20), future: [] } };
  });
  // A brush made from this frame keeps running the module as it is now.
  deps.refreshBrushCode?.(owner, code);
  return true;
}

/** Undo (or redo) the last applied entry: the frame's scene, code and prompt go back (or forward) together. */
export function stepApplied(deps: StudioDeps, owner: string, direction: "undo" | "redo") {
  const panel = deps.panel(owner), entry = direction === "undo" ? panel.applied.past.at(-1) : panel.applied.future.at(-1);
  if (!entry || panel.loading) return null;
  const target = direction === "undo" ? entry.before : entry.after;
  deps.updatePanel(owner, current => ({ ...ops.commitScene(current, target.scene), generated: target.generated, codeDraft: target.codeDraft, executable: target.executable, preparedCode: target.preparedCode,
    composePrompt: target.composePrompt, dirtyNodeIds: target.dirtyNodeIds, runtimeError: "",
    applied: direction === "undo" ? { past: current.applied.past.slice(0, -1), future: [...current.applied.future, entry] } : { past: [...current.applied.past, entry], future: current.applied.future.slice(0, -1) } }));
  // A brush made from this frame keeps running the restored module.
  if (target.generated) deps.refreshBrushCode?.(owner, target.generated.code);
  return entry;
}
