import { z } from "zod";
import { projectSchema } from "./project";
import { annotationSchema, imageSchema, requestSchema, analysisSchema, rulesSchema, subfeatureSchema, generatedSchema, brushSchema, compositionPromptSchema, clarificationSchema, revisionProposalSchema, stateMachineSchema } from "./schema";
import { replaceSubfeature } from "./subfeatures";
import { showWorkspaceFrame } from "./workspace";
import { sketchPanelSchema } from "./sketch-panels";

export const recoveryContextSchema = z.object({
  project: projectSchema, owner: z.string().max(80),
  region: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), w: z.number().min(0).max(1), h: z.number().min(0).max(1) }).optional(),
  annotations: z.array(annotationSchema).max(128).default([]), annotationImage: imageSchema.or(z.literal("")).default(""),
  revisionInstruction: z.string().max(2000).default(""),
  proposal: revisionProposalSchema.nullable().default(null),
}).superRefine((context, ctx) => {
  if (context.owner !== "source" && !context.project.sketchFrames.some(frame => frame.id === context.owner)) ctx.addIssue({ code: "custom", message: "복원할 스케치를 찾지 못했습니다." });
});
export type RecoveryContext = z.infer<typeof recoveryContextSchema>;
export const recoveredGenerationSchema = z.object({ project: projectSchema, owner: z.string(), annotations: z.array(annotationSchema).max(128).default([]), annotationImage: imageSchema.or(z.literal("")).default(""), revisionInstruction: z.string().max(2000).default(""), proposal: revisionProposalSchema.nullable().default(null) });
export type RecoveredGeneration = z.infer<typeof recoveredGenerationSchema>;

/** Rebuild the generated state without calling AI, including older logs without snapshots. */
export function recoverGeneration(input: z.infer<typeof requestSchema>, result: unknown, context?: RecoveryContext): RecoveredGeneration {
  const owner = context?.owner || "source";
  const project = context ? structuredClone(context.project) : projectSchema.parse({
    version: 1, name: "Recovered generation", artwork: { name: "Recovered sketch", strokes: [], photo: input.image || null, revision: 0 },
    features: input.features, groups: input.groups, analysisRevision: 0,
    generated: input.previous ? { title: "Previous result", explanation: "", code: input.previous, stateMachine: input.stateMachine } : null,
    brush: null, savedBrushes: [], semanticPens: input.compositionPens.slice(0, 32),
  });
  const panel = project.sketchPanels[owner];
  const artwork = owner === "source" ? project.artwork : project.sketchFrames.find(frame => frame.id === owner)!.artwork;
  const recovery: RecoveredGeneration = { project, owner, annotations: context?.annotations || input.annotations, annotationImage: context?.annotationImage || input.resultImage || "", revisionInstruction: context?.revisionInstruction || input.instruction, proposal: null };
  switch (input.intent) {
    case "analyze": {
      const features = analysisSchema.parse(result).features;
      const region = context?.region;
      panel.features = region ? features.map(feature => ({ ...feature, region: { x: region.x + feature.region.x * region.w, y: region.y + feature.region.y * region.h, w: Math.max(.01, feature.region.w * region.w), h: Math.max(.01, feature.region.h * region.h) } })) : features;
      Object.assign(panel, sketchPanelSchema.parse({ features: panel.features, analysisRevision: artwork.revision }));
      recovery.annotations = []; recovery.annotationImage = ""; recovery.revisionInstruction = "";
      break;
    }
    case "rules": {
      const groups = rulesSchema.parse(result).groups;
      const merge = (current: typeof groups) => [...current.filter(group => !groups.some(next => next.featureId === group.featureId)), ...groups];
      const state = panel.generated?.stateMachine?.states.find(state => state.id === panel.selectedStateId);
      if (state) state.groups = merge(state.groups); else panel.groups = merge(panel.groups);
      panel.stage = "rules"; break;
    }
    case "subfeature": {
      const replacement = subfeatureSchema.parse(result);
      const state = panel.generated?.stateMachine?.states.find(state => state.id === panel.selectedStateId);
      if (state) state.groups = replaceSubfeature(state.groups, input.targetFeatureId, input.targetSubfeatureId, replacement);
      else panel.groups = replaceSubfeature(panel.groups, input.targetFeatureId, input.targetSubfeatureId, replacement);
      panel.stage = "rules"; break;
    }
    case "code": case "compose":
      panel.generated = generatedSchema.parse(result); panel.codeDraft = panel.generated.code; panel.stage = "code";
      panel.selectedStateId = panel.generated.stateMachine?.initialState || null; panel.dirtyStateIds = [];
      if (input.intent === "compose") { panel.generationMode = "compose"; panel.composePrompt = input.instruction; }
      if (input.revisionSummary) { panel.features = context?.proposal?.features || input.features; panel.groups = context?.proposal?.groups || input.groups; }
      recovery.annotations = []; recovery.annotationImage = ""; recovery.revisionInstruction = "";
      break;
    case "brush": panel.brush = brushSchema.parse(result); panel.brushDescription = input.brushDescription; panel.stage = "brush"; break;
    case "compose-prompt": panel.composePrompt = compositionPromptSchema.parse(result).prompt; break;
    case "clarification": recovery.revisionInstruction = clarificationSchema.parse(result).clarification; break;
    case "revision": recovery.proposal = revisionProposalSchema.parse(result); break;
    case "state-machine": {
      const stateMachine = stateMachineSchema.parse(result);
      panel.generated = generatedSchema.parse({ ...(panel.generated || { title: "Recovered state machine", explanation: "상태를 복원했습니다. Apply constraints로 장면 코드를 생성해주세요.", code: input.previous || "p.setup=()=>{p.createCanvas(900,600);p.background(250);p.noLoop();};" }), stateMachine });
      panel.codeDraft = panel.generated.code; panel.selectedStateId = stateMachine.initialState; panel.stage = "code"; break;
    }
  }
  project.activeSketchId = owner; project.featureSourceId = owner;
  project.features = panel.features; project.groups = panel.groups; project.generated = panel.generated; project.brush = panel.brush; project.analysisRevision = panel.analysisRevision;
  if (owner === "source") project.workspace = showWorkspaceFrame(project.workspace, "source");
  if (panel.generated) project.workspace = showWorkspaceFrame(project.workspace, "result");
  return recoveredGenerationSchema.parse(recovery);
}
