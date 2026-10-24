import type { Brush } from "../lib/brushes";
import { brushNodeIds } from "../lib/brushes";
import { concernSuggestionsSchema, constraintRows, emptyInspection, heldIndex, inspectResultSchema, markStyleAt, MAX_MARKS, recommendationTransformations, runtimeForAI, stepValues, type InspectResult, type InspectionState, type MarkStyle, type Recommendation } from "../lib/inspection";
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
import { annotatedImage, compactMarks } from "./annotated-image";
import type { StudioDeps } from "./deps";

type Change = { key: string; stateId: string; value: number | string | boolean };

/** The frame's inspection for this brush. */
export const inspectionFor = (panel: SketchPanel, brushId: string): InspectionState => panel.inspections[brushId] ?? emptyInspection(brushId);
/** Panel patch storing one brush's inspection. */
export const withInspection = (panel: SketchPanel, state: InspectionState) => ({ inspections: { ...panel.inspections, [state.brushId]: state } });

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
      const patch = ops.setPropertyScalar({ ...panel, scene, editingStates }, binding.nodeId, binding.path[0], binding.path.slice(1), value);
      if (patch.scene) { scene = patch.scene; applied++; }
    }
    return applied ? ops.commitScene(panel, scene) : { error: "적용할 수 있는 값이 없습니다." };
  });
}

/**
 * Targeted inspection: AI builds overlays for the concern (marked with the
 * inspection annotation and/or written) and suggests fixes. Returns the result.
 * With `update`, a recommendation just added a transformation and the overlays are rebuilt to show it.
 */
export async function inspectConcern(deps: StudioDeps, owner: string, brush: Brush, draft: { concern: string; marks: InspectionState["marks"]; markStyles?: MarkStyle[] }, update: InspectionInput["update"] = null) {
  const panel = deps.panel(owner), state = inspectionFor(panel, brush.id), nodeIds = brushNodeIds(panel.scene, brush, owner);
  if (!nodeIds.length) { deps.updatePanel(owner, { error: `이 프레임에는 ${brush.name} brush가 없습니다.` }); return null; }
  const snapshot = JSON.stringify(panel.scene), out: { result?: InspectResult } = {};
  await deps.task(update ? "AI가 추가된 transformation이 보이도록 targeted inspection overlay를 고치고 있습니다…" : "AI가 이 concern에 맞는 targeted inspection을 만들고 있습니다…", async () => {
    // The result is held at the selected step, so the live capture shows that moment.
    const styles = draft.marks.map((_, i) => markStyleAt(draft.markStyles, i));
    const image = await annotatedImage((await deps.capture(owner, true)).image, draft.marks, undefined, styles);
    const rows = constraintRows(panel.scene, nodeIds);
    // The code, so hard-coded constants the concern depends on can be suggested as parameters.
    const result = inspectResultSchema.parse(await deps.request("inspect", { scene: panel.scene, targetNodeId: nodeIds[0], instruction: draft.concern.trim(), image, previous: panel.generated?.code ?? "",
      inspection: { brushName: brush.name, nodeIds, cursor: heldIndex(state),
        constraints: rows.map(row => ({ key: row.key, nodeId: row.binding.nodeId, transformationId: row.transformationId, transformation: row.transformation, propertyId: row.binding.path[0], property: row.property, path: row.path, type: row.binding.type })),
        steps: state.steps.map(item => ({ id: item.id, nodeId: item.nodeId, from: item.from, to: item.to, transitionId: item.transitionId, values: stepValues(item)!, runtime: runtimeForAI(item, nodeIds) })),
        marks: compactMarks(draft.marks, MAX_MARKS), markStyles: styles.slice(-MAX_MARKS), update } }, owner));
    if (snapshot !== JSON.stringify(deps.panel(owner).scene)) throw new Error("검사 중 장면이 변경되었습니다. 다시 시도해주세요.");
    out.result = result;
  }, owner);
  // The overlays read a per-item quantity the module computes but did not keep on its items: it now records it (code only, nothing drawn changes).
  if (out.result?.records) await applyRecording(deps, owner, out.result.records);
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
    inspection: { brushName: brush.name, nodeIds, constraints: [], steps: [], cursor: null, marks: compactMarks(draft.marks, MAX_MARKS), markStyles: styles.slice(-MAX_MARKS) } }) });
  const result = await response.json();
  if (!response.ok || result.error) throw new Error(result.error || "concern을 제안하지 못했습니다.");
  return concernSuggestionsSchema.parse(result).suggestions;
}

/** A name for a new targeted tool: the start of its concern. */
export function targetedName(concern: string, count: number) {
  const text = concern.trim().replace(/\s+/g, " ");
  return text ? (Array.from(text).length > 24 ? `${Array.from(text).slice(0, 23).join("")}…` : text) : `Concern ${count + 1}`;
}

const snapshot = (panel: SketchPanel): AppliedSnapshot => ({ scene: panel.scene, generated: panel.generated, codeDraft: panel.codeDraft, executable: panel.executable, preparedCode: panel.preparedCode, composePrompt: panel.composePrompt, dirtyNodeIds: panel.dirtyNodeIds });
/** Same scene, code and prompt (what an applied recommendation changes). */
export const sameSnapshot = (a: AppliedSnapshot, b: AppliedSnapshot) => (a.scene === b.scene || JSON.stringify(a.scene) === JSON.stringify(b.scene)) && (a.generated?.code ?? "") === (b.generated?.code ?? "") && a.composePrompt === b.composePrompt;
/** Which recommendation an entry applied (to mark it in the list). */
export const recommendationKey = (item: Recommendation) => `${item.kind}:${item.nodeId}:${item.targetId}:${item.title}`;
/** The frame now is what an applied entry left (else undo/redo would also drop later edits). */
export const appliedCurrent = (panel: SketchPanel, direction: "undo" | "redo") => {
  const entry = direction === "undo" ? panel.applied.past.at(-1) : panel.applied.future.at(-1);
  return Boolean(entry && sameSnapshot(direction === "undo" ? entry.after : entry.before, snapshot(panel)));
};

/**
 * Apply a recommendation: values directly, a transformation/state/transition
 * through AI (with the code rewritten after a transformation). The frame before
 * and after is kept, so the whole application can be undone and redone (marked
 * with `key`, the recommendation as listed). Returns the transformation it added, if any.
 */
export async function applyRecommendation(deps: StudioDeps, owner: string, recommendation: Recommendation, key = recommendationKey(recommendation)) {
  const instruction = `${recommendation.title}\n${recommendation.detail}`.slice(0, 2000), before = snapshot(deps.panel(owner));
  const existing = new Set(findNode(before.scene, recommendation.nodeId)?.transformations.map(item => item.id));
  if (recommendation.kind === "value") applyChanges(deps, owner, recommendation.changes);
  else {
    const ai = sceneAI(deps, owner);
    // Every transformation the fix changes, in turn; the code is rewritten once at the end (and undo apply takes all of it back).
    if (recommendation.kind === "transformation") await ai.regenerateAll(recommendation.nodeId, recommendationTransformations(recommendation), instruction);
    // Nothing existing was related: a new semantic transformation is stacked on the node (then the code follows).
    else if (recommendation.kind === "add-transformation") await ai.regenerate(recommendation.nodeId, {}, instruction);
    else await ai.refineMachine(recommendation.nodeId, { target: { kind: recommendation.kind, id: recommendation.targetId }, instruction, marks: [] });
  }
  const after = snapshot(deps.panel(owner));
  if (sameSnapshot(before, after)) return null;
  deps.updatePanel(owner, panel => ({ applied: { past: [...panel.applied.past, { id: crypto.randomUUID(), title: recommendation.title, key, before, after: snapshot(panel) }].slice(-20), future: [] } }));
  return recommendation.kind === "add-transformation" ? findNode(after.scene, recommendation.nodeId)?.transformations.find(item => !existing.has(item.id)) ?? null : null;
}

/**
 * Accept a suggested hidden parameter: the constant becomes a property of its
 * transformation and the module reads it, with no regeneration. The new program
 * is prepared first and the module is swapped into the running result in place
 * (nothing drawn is lost); scene and code are then committed together as one
 * applied entry, so Undo apply takes both back. Returns whether it was added.
 */
export async function acceptParameter(deps: StudioDeps, owner: string, item: ParameterSuggestion) {
  const panel = deps.panel(owner), fail = (why: string) => { deps.updatePanel(owner, { error: `「${item.label}」을(를) 추가하지 못했습니다: ${why}` }); return false; };
  if (!panel.generated) return fail("이 프레임에 코드가 없습니다");
  const result = exposeParameter(panel.scene, panel.generated, item);
  if ("error" in result) return fail(`${result.error}. 코드가 바뀌었으면 Inspect again을 해주세요`);
  return swapModule(deps, owner, result, moduleKeyOf(panel.scene, item.nodeId)!, { title: `${item.label} 노출`, key: `parameter:${item.nodeId}:${item.id}` }, fail);
}

/**
 * Apply an inspection's recorded fields: the module also keeps the per-item
 * quantity on each item record, so overlays can show it per item. Only the code
 * changes (in place, one applied entry). Returns whether it was applied now.
 */
export async function applyRecording(deps: StudioDeps, owner: string, item: Recording) {
  const panel = deps.panel(owner), fail = (why: string) => { deps.updatePanel(owner, { error: `항목 기록(${item.fields.join(", ")})을 추가하지 못했습니다: ${why}` }); return false; };
  if (!panel.generated) return fail("이 프레임에 코드가 없습니다");
  if (recordingApplied(panel.scene, panel.generated.code, item)) return false;
  const result = recordFields(panel.scene, panel.generated, item);
  if ("error" in result) return fail(`${result.error}. 코드가 바뀌었으면 Inspect again을 해주세요`);
  return swapModule(deps, owner, { scene: panel.scene, generated: result.generated }, moduleKeyOf(panel.scene, item.nodeId)!, { title: `항목 기록: ${item.fields.join(", ")}`, key: `records:${item.nodeId}:${item.fields.join(",")}` }, fail);
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
  catch (error) { return fail(error instanceof Error ? error.message : "코드 검사를 통과하지 못했습니다"); }
  if (deps.panel(owner).generated?.code !== previous) return fail("그 사이 코드가 바뀌었습니다");
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

/** Undo (or redo) the last applied recommendation: the frame's scene, code and prompt go back (or forward) together. */
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
