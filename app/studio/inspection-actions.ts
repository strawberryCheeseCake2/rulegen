import type { Brush } from "../lib/brushes";
import { brushNodeIds } from "../lib/brushes";
import { constraintRows, emptyInspection, inspectResultSchema, runtimeForAI, type InspectResult, type InspectionState } from "../lib/inspection";
import { findNode } from "../lib/scene/graph";
import * as ops from "../lib/scene/panel-ops";
import type { ScalarValue } from "../lib/scene/schema";
import { sceneBindings } from "../lib/scene/values";
import type { SketchPanel } from "../lib/sketch-panels";
import { sceneAI } from "./scene-actions";
import { annotatedImage, compactMarks } from "./annotated-image";
import type { StudioDeps } from "./deps";

type Change = { key: string; stateId: string; value: number | string | boolean };
type Recommendation = InspectResult["recommendations"][number];

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
 */
export async function inspectConcern(deps: StudioDeps, owner: string, brush: Brush, draft: { concern: string; marks: InspectionState["marks"] }) {
  const panel = deps.panel(owner), state = inspectionFor(panel, brush.id), nodeIds = brushNodeIds(panel.scene, brush, owner);
  if (!nodeIds.length) { deps.updatePanel(owner, { error: `이 프레임에는 ${brush.name} brush가 없습니다.` }); return null; }
  const snapshot = JSON.stringify(panel.scene), out: { result?: InspectResult } = {};
  await deps.task("AI가 이 concern에 맞는 targeted inspection을 만들고 있습니다…", async () => {
    // The result is held at the selected step, so the live capture shows that moment.
    const image = await annotatedImage((await deps.capture(owner, true)).image, draft.marks);
    const rows = constraintRows(panel.scene, nodeIds);
    const result = inspectResultSchema.parse(await deps.request("inspect", { scene: panel.scene, targetNodeId: nodeIds[0], instruction: draft.concern.trim(), image,
      inspection: { brushName: brush.name, nodeIds, cursor: state.cursor,
        constraints: rows.map(row => ({ key: row.key, nodeId: row.binding.nodeId, transformationId: row.transformationId, transformation: row.transformation, propertyId: row.binding.path[0], property: row.property, path: row.path, type: row.binding.type })),
        steps: state.steps.map(item => ({ id: item.id, nodeId: item.nodeId, from: item.from, to: item.to, transitionId: item.transitionId, values: item.values, runtime: runtimeForAI(item, nodeIds) })),
        marks: compactMarks(draft.marks) } }, owner));
    if (snapshot !== JSON.stringify(deps.panel(owner).scene)) throw new Error("검사 중 장면이 변경되었습니다. 다시 시도해주세요.");
    out.result = result;
  }, owner);
  return out.result ?? null;
}

/** A name for a new targeted tool: the start of its concern. */
export function targetedName(concern: string, count: number) {
  const text = concern.trim().replace(/\s+/g, " ");
  return text ? (Array.from(text).length > 24 ? `${Array.from(text).slice(0, 23).join("")}…` : text) : `Concern ${count + 1}`;
}

/** Apply a recommendation: values directly, a transformation/state/transition through AI. */
export async function applyRecommendation(deps: StudioDeps, owner: string, recommendation: Recommendation) {
  const instruction = `${recommendation.title}\n${recommendation.detail}`.slice(0, 2000);
  if (recommendation.kind === "value") { applyChanges(deps, owner, recommendation.changes); return; }
  const ai = sceneAI(deps, owner);
  if (recommendation.kind === "transformation") await ai.regenerate(recommendation.nodeId, { transformationId: recommendation.targetId }, instruction);
  else await ai.refineMachine(recommendation.nodeId, { target: { kind: recommendation.kind, id: recommendation.targetId }, instruction, marks: [] });
}
