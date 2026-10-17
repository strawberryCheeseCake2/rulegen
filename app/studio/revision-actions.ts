import { clarificationSchema, generatedSchema } from "../lib/schema";
import { annotatedResultImage } from "../lib/result-revisions";
import { clearedResultAnnotations, type SketchPanel } from "../lib/sketch-panels";
import { sceneProposalSchema } from "../lib/scene/validate";
import { sceneRevisionSnapshot } from "../lib/scene/revisions";
import { liveSceneSource } from "../lib/scene/live";
import * as ops from "../lib/scene/panel-ops";
import type { StudioDeps } from "./deps";

export const clarificationLabel = "AI가 annotation 스케치를 보고 설명 초안을 만들고 있습니다…";

export const revisionSnapshot = (panel: SketchPanel, instruction = panel.revisionInstruction) =>
  sceneRevisionSnapshot(panel.scene, liveSceneSource(panel.generated, panel.scene), panel.annotationHistory.present, instruction, panel.annotationImage);

/** Annotation sketch → AI clarification → scene proposal → confirm (code regenerated before anything changes). */
export function revisionActions(deps: StudioDeps, owner: string) {
  const current = () => deps.panel(owner);
  // A request is stale when the sketch, clarification or scene changed meanwhile.
  const unchanged = (number: number, snapshot: string) => number === deps.requestId(owner) && revisionSnapshot(current()) === snapshot;
  async function requestClarification() {
    const panel = current();
    if (!panel.generated || !panel.annotationImage || !panel.annotationHistory.present.length) return;
    const snapshot = revisionSnapshot(panel), sketch = revisionSnapshot(panel, "");
    await deps.task(clarificationLabel, async () => {
      const number = deps.requestId(owner), annotations = panel.annotationHistory.present;
      const image = await annotatedResultImage(panel.annotationImage, annotations);
      if (!unchanged(number, snapshot)) return;
      const result = clarificationSchema.parse(await deps.request("clarification", { image, resultImage: panel.annotationImage, annotations, scene: panel.scene, previous: liveSceneSource(panel.generated, panel.scene), instruction: panel.revisionInstruction }, owner));
      if (!unchanged(number, snapshot)) return;
      deps.updatePanel(owner, { revisionInstruction: result.clarification, clarificationContext: sketch, revisionProposal: null });
    }, owner);
  }
  return {
    requestClarification,
    async beginClarification() {
      const panel = current();
      if (!panel.annotationHistory.present.length) return;
      deps.updatePanel(owner, { clarifying: true });
      if (panel.revisionInstruction.trim() && panel.clarificationContext === revisionSnapshot(panel, "")) return;
      await requestClarification();
    },
    async requestRevision() {
      const panel = current();
      if (!panel.generated || !panel.annotationImage || !panel.annotationHistory.present.length || !panel.revisionInstruction.trim()) return;
      const snapshot = revisionSnapshot(panel);
      await deps.task("스케치와 clarification을 바탕으로 collection·property 변경안을 만들고 있습니다…", async () => {
        const number = deps.requestId(owner), annotations = panel.annotationHistory.present;
        const image = await annotatedResultImage(panel.annotationImage, annotations);
        if (!unchanged(number, snapshot)) return;
        const proposal = sceneProposalSchema.parse(await deps.request("revision", { image, annotations, scene: panel.scene, previous: liveSceneSource(panel.generated, panel.scene), instruction: panel.revisionInstruction }, owner));
        if (!unchanged(number, snapshot)) return;
        deps.updatePanel(owner, { revisionProposal: { proposal, snapshot } });
      }, owner);
    },
    async confirmRevision() {
      const panel = current(), review = panel.revisionProposal;
      if (!review || !panel.generated || review.snapshot !== revisionSnapshot(panel)) return;
      await deps.task("확인한 변경안을 collection과 p5.js 결과에 적용하고 있습니다…", async () => {
        const number = deps.requestId(owner), annotations = panel.annotationHistory.present;
        const image = await annotatedResultImage(panel.annotationImage, annotations);
        if (!unchanged(number, review.snapshot)) return;
        const result = generatedSchema.parse(await deps.request("code", { scene: review.proposal.scene, previous: liveSceneSource(panel.generated, panel.scene), image, annotations, revisionSummary: review.proposal.summary, instruction: panel.revisionInstruction }, owner));
        if (!unchanged(number, review.snapshot)) return;
        // Validate execution before committing any scene or code changes.
        await deps.request("prepare", { code: result.code }, owner);
        if (!unchanged(number, review.snapshot)) return;
        deps.updatePanel(owner, latest => ({ ...ops.commitScene(latest, review.proposal.scene), generated: result, codeDraft: result.code, executable: "", preparedCode: "", runtimeError: "", runtimeStates: {}, dirtyNodeIds: [], hovered: null, ...clearedResultAnnotations() }));
        deps.toast("확인한 collection·property 변경안을 적용하고 결과를 업데이트했습니다.");
      }, owner);
    },
  };
}
