import { z } from "zod";
import { projectSchema } from "./project";
import { annotationSchema, imageSchema, requestSchema, generatedSchema, compositionPromptSchema, clarificationSchema, machineRefineResultSchema } from "./schema";
import { showWorkspaceFrame } from "./workspace";
import { sketchPanelSchema } from "./sketch-panels";
import { sceneProposalSchema, sceneSchema } from "./scene/validate";

export const recoveryContextSchema = z.object({
  project: projectSchema, owner: z.string().max(80),
  region: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), w: z.number().min(0).max(1), h: z.number().min(0).max(1) }).optional(),
  annotations: z.array(annotationSchema).max(128).default([]), annotationImage: imageSchema.or(z.literal("")).default(""),
  revisionInstruction: z.string().max(2000).default(""),
  proposal: sceneProposalSchema.nullable().default(null),
}).superRefine((context, ctx) => {
  if (context.owner !== "source" && !context.project.sketchFrames.some(frame => frame.id === context.owner)) ctx.addIssue({ code: "custom", message: "복원할 스케치를 찾지 못했습니다." });
});
export type RecoveryContext = z.infer<typeof recoveryContextSchema>;
export const recoveredGenerationSchema = z.object({ project: projectSchema, owner: z.string(), annotations: z.array(annotationSchema).max(128).default([]), annotationImage: imageSchema.or(z.literal("")).default(""), revisionInstruction: z.string().max(2000).default(""), proposal: sceneProposalSchema.nullable().default(null) });
export type RecoveredGeneration = z.infer<typeof recoveredGenerationSchema>;

const offsetRegion = <T extends { region: { x: number; y: number; w: number; h: number } }>(items: T[], region?: RecoveryContext["region"]) => region ? items.map(item => ({ ...item, region: { x: region.x + item.region.x * region.w, y: region.y + item.region.y * region.h, w: Math.max(.01, item.region.w * region.w), h: Math.max(.01, item.region.h * region.h) } })) : items;

/** Rebuild the generated state without calling AI, including logs without project snapshots. */
export function recoverGeneration(input: z.infer<typeof requestSchema>, result: unknown, context?: RecoveryContext): RecoveredGeneration {
  const owner = context?.owner || "source";
  const project = context ? structuredClone(context.project) : projectSchema.parse({
    version: 2, name: "Recovered generation", artwork: { name: "Recovered sketch", strokes: [], photo: input.image || null, revision: 0 },
    semanticPens: input.compositionPens.filter(pen => pen.kind === "algorithm").slice(0, 32),
    sketchPanels: { source: { scene: input.scene || undefined, generated: input.previous ? { title: "Previous result", explanation: "", code: input.previous } : null } },
  });
  const panel = project.sketchPanels[owner];
  const artwork = owner === "source" ? project.artwork : project.sketchFrames.find(frame => frame.id === owner)!.artwork;
  const recovery: RecoveredGeneration = { project, owner, annotations: context?.annotations || input.annotations, annotationImage: context?.annotationImage || input.resultImage || "", revisionInstruction: context?.revisionInstruction || input.instruction, proposal: null };
  const clearAnnotations = () => { recovery.annotations = []; recovery.annotationImage = ""; recovery.revisionInstruction = ""; };
  const isCode = (value: unknown) => Boolean(value && typeof value === "object" && "code" in value);
  switch (input.intent) {
    case "extract": {
      const scene = sceneSchema.parse(result);
      Object.assign(panel, sketchPanelSchema.parse({ scene: { ...scene, nodes: offsetRegion(scene.nodes, context?.region) }, analysisRevision: artwork.revision }));
      clearAnnotations(); break;
    }
    case "compose":
      if (isCode(result)) { panel.generated = generatedSchema.parse(result); panel.codeDraft = panel.generated.code; }
      else { panel.scene = sceneSchema.parse(result); panel.selectedNodeIds = []; panel.editingStates = {}; panel.analysisRevision = artwork.revision; }
      panel.generationMode = "compose"; panel.composePrompt = input.instruction; break;
    case "transform": panel.scene = sceneSchema.parse(result); panel.selectedNodeIds = input.targetNodeId ? [input.targetNodeId] : panel.selectedNodeIds; break;
    case "state-machine": {
      panel.scene = sceneSchema.parse(result); panel.selectedNodeIds = [input.targetNodeId];
      const machine = panel.scene.nodes.find(node => node.id === input.targetNodeId)?.machine;
      if (machine) panel.editingStates = { ...panel.editingStates, [input.targetNodeId]: machine.initialState };
      break;
    }
    case "machine-refine": {
      const refined = machineRefineResultSchema.parse(result);
      panel.scene = refined.scene; panel.selectedNodeIds = [input.targetNodeId]; panel.composePrompt = refined.composePrompt;
      break;
    }
    case "code":
      panel.generated = generatedSchema.parse(result); panel.codeDraft = panel.generated.code; panel.dirtyNodeIds = [];
      if (input.scene) panel.scene = context?.proposal && input.revisionSummary ? context.proposal.scene : input.scene;
      clearAnnotations(); break;
    case "compose-prompt": panel.composePrompt = compositionPromptSchema.parse(result).prompt; break;
    case "clarification": recovery.revisionInstruction = clarificationSchema.parse(result).clarification; break;
    case "revision": recovery.proposal = sceneProposalSchema.parse(result); break;
    case "inspect": break; // An inspection does not change the project.
  }
  project.activeSketchId = owner;
  if (owner === "source") project.workspace = showWorkspaceFrame(project.workspace, "source");
  return recoveredGenerationSchema.parse(recovery);
}
