import { z } from "zod";
import { MAX_SKETCH_FRAMES, projectSchema } from "./project";
import { compositionPromptSchema, generatedSchema, type requestSchema } from "./schema";
import { besideFrameGrid, showWorkspaceFrame } from "./workspace";
import { sketchPanelSchema } from "./sketch-panels";
import { decompositionSchema, exampleFrames } from "./scene/minimal-example";
import { sceneSchema } from "./scene/validate";

export const recoveryContextSchema = z.object({
  project: projectSchema, owner: z.string().max(80),
}).superRefine((context, ctx) => {
  if (context.owner !== "source" && !context.project.sketchFrames.some(frame => frame.id === context.owner)) ctx.addIssue({ code: "custom", message: "복원할 스케치를 찾지 못했습니다." });
});
export type RecoveryContext = z.infer<typeof recoveryContextSchema>;
export const recoveredGenerationSchema = z.object({ project: projectSchema, owner: z.string() });
export type RecoveredGeneration = z.infer<typeof recoveredGenerationSchema>;

/** Rebuild the generated state without calling AI, including logs without project snapshots. */
export function recoverGeneration(input: z.infer<typeof requestSchema>, result: unknown, context?: RecoveryContext): RecoveredGeneration {
  let owner = context?.owner || "source";
  const project = context ? structuredClone(context.project) : projectSchema.parse({
    version: 2, name: "Recovered generation", artwork: { name: "Recovered sketch", strokes: [], photo: input.image || null, revision: 0 },
    sketchPanels: { source: { scene: input.scene || undefined, generated: input.previous ? { title: "Previous result", explanation: "", code: input.previous } : null } },
  });
  const panel = project.sketchPanels[owner];
  const artwork = owner === "source" ? project.artwork : project.sketchFrames.find(frame => frame.id === owner)!.artwork;
  switch (input.intent) {
    case "decompose": {
      // Its minimal example frames (the sketch's objects, then the transformations; without their code yet), as the decomposition made them (pens are made by the user).
      // (An example split into one piece was already minimal: nothing was made.)
      const decomposition = decompositionSchema.parse(result), split = Boolean(input.targetTransformationId);
      const frames = exampleFrames(decomposition), room = split && decomposition.items.length < 2 ? 0 : Math.min(frames.length, MAX_SKETCH_FRAMES - project.sketchFrames.length);
      const spots = besideFrameGrid(project.workspace.frames, owner, room);
      for (const [i, { name, scene, example }] of frames.slice(0, room).entries()) {
        const id = `sketch-${crypto.randomUUID()}` as const;
        project.sketchFrames.push({ id, artwork: { strokes: [], photo: null, name: name.slice(0, 200), revision: 0 } });
        project.sketchPanels[id] = sketchPanelSchema.parse({ role: "example", scene, sourceFrameId: owner, analysisRevision: artwork.revision, example: { ...example, sourceFrameId: owner, penId: "" } });
        project.workspace.frames[id] = spots[i];
      }
      break;
    }
    case "compose": {
      // A new composition frame beside the sketch (its code is generated again from there).
      if (project.sketchFrames.length >= MAX_SKETCH_FRAMES) throw new Error("프레임이 가득 차 Compose 결과를 복원할 수 없습니다.");
      const id = `sketch-${crypto.randomUUID()}` as const;
      project.sketchFrames.push({ id, artwork: { strokes: [], photo: null, name: `${artwork.name} · composed`.slice(0, 200), revision: 0 } });
      project.sketchPanels[id] = sketchPanelSchema.parse({ role: "composition", scene: sceneSchema.parse(result), sourceFrameId: owner, analysisRevision: artwork.revision, composePrompt: input.instruction });
      project.workspace.frames[id] = besideFrameGrid(project.workspace.frames, owner, 1)[0];
      owner = id; break;
    }
    case "transform": panel.scene = sceneSchema.parse(result); panel.selectedNodeIds = input.targetNodeId ? [input.targetNodeId] : panel.selectedNodeIds; break;
    case "code":
      panel.generated = generatedSchema.parse(result); panel.codeDraft = panel.generated.code; panel.dirtyNodeIds = [];
      if (input.scene) panel.scene = input.scene;
      break;
    case "compose-prompt": panel.composePrompt = compositionPromptSchema.parse(result).prompt; break;
  }
  if (!project.sketchPanels[owner]) owner = "source";
  project.activeSketchId = owner;
  if (owner === "source") project.workspace = showWorkspaceFrame(project.workspace, "source");
  return recoveredGenerationSchema.parse({ project, owner });
}
