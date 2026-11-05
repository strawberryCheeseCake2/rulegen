import { clarificationSchema, generatedSchema } from "../lib/schema";
import { annotatedResultImage } from "../lib/result-revisions";
import { clearedResultAnnotations, type SketchPanel } from "../lib/sketch-panels";
import { sceneProposalSchema } from "../lib/scene/validate";
import { sceneRevisionSnapshot } from "../lib/scene/revisions";
import { liveSceneSource } from "../lib/scene/live";
import * as ops from "../lib/scene/panel-ops";
import type { StudioDeps } from "./deps";

export const clarificationLabel = "AI is reading the annotation sketch and drafting a description…";

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
      await deps.task("Drafting collection and property changes from the sketch and clarification…", async () => {
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
      await deps.task("Applying the confirmed changes to the collection and the p5.js result…", async () => {
        const number = deps.requestId(owner), annotations = panel.annotationHistory.present;
        const image = await annotatedResultImage(panel.annotationImage, annotations);
        if (!unchanged(number, review.snapshot)) return;
        const result = generatedSchema.parse(await deps.request("code", { scene: review.proposal.scene, previous: liveSceneSource(panel.generated, panel.scene), image, annotations, revisionSummary: review.proposal.summary, instruction: panel.revisionInstruction }, owner));
        if (!unchanged(number, review.snapshot)) return;
        // Validate execution before committing any scene or code changes.
        await deps.request("prepare", { code: result.code }, owner);
        if (!unchanged(number, review.snapshot)) return;
        deps.updatePanel(owner, latest => ({ ...ops.commitScene(latest, review.proposal.scene), generated: result, codeDraft: result.code, executable: "", preparedCode: "", runtimeError: "", runtimeStates: {}, dirtyNodeIds: [], hovered: null, ...clearedResultAnnotations() }));
        deps.toast("Applied the confirmed collection and property changes and updated the result.");
      }, owner);
    },
  };
}
