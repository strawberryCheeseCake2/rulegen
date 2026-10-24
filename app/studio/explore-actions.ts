import { brushNodeIds, type Brush } from "../lib/brushes";
import { exploreProgram, exploreResultSchema, inputPath, type ExploreMode, type ExploreResult } from "../lib/explore";
import { constraintRows, heldIndex, runtimeForAI, stepValues, type InspectResult, type Recommendation } from "../lib/inspection";
import { liveSceneSource } from "../lib/scene/live";
import { prepareProgram } from "../lib/prepared";
import { inspectionFor } from "./inspection-actions";
import type { StudioDeps } from "./deps";

/**
 * Ask AI for an exploration frame of a targeted inspection's cause (no
 * recommendation) or of one recommendation: the metaphoric execution handle or the
 * recommendation's key values as handles, and a preview of a recommendation not
 * applied yet. Quiet: it is not a frame task (the sketch frame stays free); the
 * caller shows progress on the exploration frame and may abort it.
 */
export async function requestExplore(deps: StudioDeps, owner: string, brush: Brush, request: { mode: ExploreMode; concern: string; inspection: InspectResult; recommendation: (Recommendation & { applied: boolean }) | null }, signal: AbortSignal): Promise<ExploreResult> {
  const panel = deps.panel(owner), state = inspectionFor(panel, brush.id), nodeIds = brushNodeIds(panel.scene, brush, owner);
  const at = heldIndex(state), runtime = at === null ? null : state.steps[at].runtime;
  const history = runtime && typeof runtime === "object" ? (runtime as { history?: unknown[] }).history ?? [] : [];
  const image = (await deps.capture(owner, true)).image;
  const rows = constraintRows(panel.scene, nodeIds), item = request.recommendation;
  const response = await fetch("/api/generate", { method: "POST", headers: { "Content-Type": "application/json" }, signal, body: JSON.stringify({ intent: "explore", scene: panel.scene, targetNodeId: nodeIds[0], instruction: request.concern.slice(0, 2000), image, previous: panel.generated?.code ?? "",
    inspection: { brushName: brush.name, nodeIds, cursor: at, marks: [], markStyles: [],
      constraints: rows.map(row => ({ key: row.key, nodeId: row.binding.nodeId, transformationId: row.transformationId, transformation: row.transformation, propertyId: row.binding.path[0], property: row.property, path: row.path, type: row.binding.type })),
      steps: state.steps.map(step => ({ id: step.id, nodeId: step.nodeId, from: step.from, to: step.to, transitionId: step.transitionId, values: stepValues(step)!, runtime: runtimeForAI(step, nodeIds) })) },
    explore: { mode: request.mode, summary: request.inspection.summary, overlays: request.inspection.overlays.map(overlay => ({ name: overlay.name ?? "", label: overlay.label, link: overlay.link })),
      recommendation: item ? { kind: item.kind, nodeId: item.nodeId, targetId: item.targetId, targetIds: item.targetIds, title: item.title, detail: item.detail, changes: item.changes, applied: item.applied } : null,
      input: { gestures: history.length, points: inputPath(runtime).length } } }) });
  const result = await response.json();
  if (!response.ok || result.error) throw new Error(result.error || "탐색 프레임을 만들지 못했습니다.");
  return exploreResultSchema.parse(result);
}

/** The prepared program an exploration frame runs: the frame's own, or with a recommendation's preview edits. */
export async function exploreExecutable(deps: StudioDeps, owner: string, result: ExploreResult) {
  const panel = deps.panel(owner);
  if (!panel.generated) throw new Error("이 프레임에 코드가 없습니다.");
  const code = liveSceneSource(panel.generated, panel.scene);
  if (!result.edits.length) return panel.executable && panel.preparedCode === panel.generated.code ? null : prepareProgram(code);
  const program = exploreProgram(code, panel.scene, result);
  if ("error" in program) throw new Error(`추천 미리보기 코드를 적용하지 못했습니다: ${program.error}`);
  return prepareProgram(program.code);
}
