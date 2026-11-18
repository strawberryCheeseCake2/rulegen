import { brushNodeIds, type Brush } from "../lib/brushes";
import { behaviorProgram, exploreProgram, exploreResultSchema, inputPath, type ExploreResult } from "../lib/explore";
import { behaviorFallbacks, type AlignTool } from "../lib/alignment";
import { paramRows, heldIndex, runtimeForAI, stepValues, type InspectResult } from "../lib/inspection";
import { liveSceneSource } from "../lib/scene/live";
import { programModules, withBlockParams } from "../lib/scene/machines";
import { moduleKeyOf } from "../lib/hidden-parameters";
import { prepareProgram } from "../lib/prepared";
import { inspectionFor } from "./inspection-actions";
import type { StudioDeps } from "./deps";

/**
 * Ask AI for a targeted inspection's Execution frame: the steps of the execution the
 * concern is about and the metaphoric handle that runs them. Quiet: it is not a frame
 * task (the sketch frame stays free); the caller shows progress on the Execution frame
 * and may abort it. With it come the brush's modules as AI read them (what its checkpoints were written for).
 */
export async function requestExplore(deps: StudioDeps, owner: string, brush: Brush, request: { concern: string; inspection: InspectResult }, signal: AbortSignal): Promise<{ result: ExploreResult; modules: Record<string, string> }> {
  const panel = deps.panel(owner), state = inspectionFor(panel, brush.id), nodeIds = brushNodeIds(panel.scene, brush, owner);
  const at = heldIndex(state), runtime = at === null ? null : state.steps[at].runtime;
  const history = runtime && typeof runtime === "object" ? (runtime as { history?: unknown[] }).history ?? [] : [];
  const image = (await deps.capture(owner, true)).image;
  const rows = paramRows(panel.scene, nodeIds), code = panel.generated?.code ?? "";
  const response = await fetch("/api/generate", { method: "POST", headers: { "Content-Type": "application/json" }, signal, body: JSON.stringify({ intent: "explore", scene: panel.scene, targetNodeId: nodeIds[0], instruction: request.concern.slice(0, 2000), image, previous: code,
    inspection: { brushName: brush.name, nodeIds, cursor: at, marks: [], markStyles: [],
      params: rows.map(row => ({ key: row.key, nodeId: row.binding.nodeId, constraintId: row.constraintId, constraint: row.constraint, paramId: row.binding.path[0], param: row.param, type: row.binding.type })),
      steps: state.steps.map(step => ({ id: step.id, nodeId: step.nodeId, from: step.from, to: step.to, transitionId: step.transitionId, values: stepValues(step)!, runtime: runtimeForAI(step, nodeIds) })) },
    explore: { summary: request.inspection.summary, overlays: request.inspection.overlays.map(overlay => ({ name: overlay.name ?? "", label: overlay.label, link: overlay.link })),
      input: { gestures: history.length, points: inputPath(runtime).length } } }) });
  const result = await response.json();
  if (!response.ok || result.error) throw new Error(result.error || "Could not create the Execution frame.");
  const found = exploreResultSchema.parse(result), sent = programModules(code);
  const keys = new Set(found.edits.map(edit => moduleKeyOf(panel.scene, edit.nodeId)).filter((key): key is string => Boolean(key && sent.has(key))));
  return { result: found, modules: Object.fromEntries([...keys].map(key => [key, sent.get(key)!])) };
}

/**
 * The prepared program an Execution frame runs: the frame's own, or with its checkpoints in it. When the brush's code
 * changed after they were written (`modules`: the code they were written for), they go into that copy of it. The kit's
 * behavior tools (`tools`) go in too, each with its code reading what is drawn with it; those whose code cannot go in
 * are `failed`. `executable` null: the frame's own program as it is.
 */
export async function exploreExecutable(deps: StudioDeps, owner: string, result: Pick<ExploreResult, "edits"> | null, modules: Record<string, string> = {}, tools: AlignTool[] = []): Promise<{ executable: string | null; failed: string[]; reasons: Record<string, string> }> {
  const panel = deps.panel(owner);
  if (!panel.generated) throw new Error("This frame has no code.");
  const code = liveSceneSource(panel.generated, panel.scene), behaving = tools.some(tool => tool.kind === "behavior");
  if (!result?.edits.length && !behaving) return { executable: panel.executable && panel.preparedCode === panel.generated.code ? null : await prepareProgram(code), failed: [], reasons: {} };
  // The behaviors go into the code as AI read it when it wrote them; the checkpoints after (one whose code a behavior
  // changed is left out: they only explain the run).
  const made = behaving ? behaviorProgram(code, panel.scene, tools) : { code, failed: [], reasons: {} };
  let program: { code: string } | { error: string } = { code: made.code };
  if (result?.edits.length) {
    program = exploreProgram(made.code, panel.scene, result, {}, behaving);
    if ("error" in program && Object.keys(modules).length) program = exploreProgram(made.code, panel.scene, result, modules);
    if ("error" in program) throw new Error(`Could not add the execution checkpoints: ${program.error}. The brush's code changed since this frame was made; regenerate it.`);
  }
  // A prepared program is shared by programs of the same structure: the behavior values go into its block again.
  const ready = await prepareProgram(program.code), values = behaviorFallbacks(tools.filter(tool => !made.failed.includes(tool.id)));
  return { executable: Object.keys(values).length ? withBlockParams(ready, values) ?? ready : ready, failed: made.failed, reasons: made.reasons };
}
