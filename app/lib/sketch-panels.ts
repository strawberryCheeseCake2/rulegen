import { z } from "zod";
import { featureSchema, generatedSchema, brushSchema, type Artwork, type RuleGroup, type GeneratedCode, type RevisionProposal } from "./schema";
import { savedGroupSchema } from "./subfeatures";
import { emptyAnnotationHistory, type AnnotationHistory } from "./annotation-history";
import { syncParameters } from "./live-parameters";

export const sketchPanelSchema = z.object({
  stage: z.enum(["features", "rules", "code", "brush"]).default("features"),
  features: z.array(featureSchema).max(8).default([]), groups: z.array(savedGroupSchema).max(8).default([]),
  analysisRevision: z.number().default(-1), generated: generatedSchema.nullable().default(null),
  codeDraft: z.string().max(26000).optional(), selected: z.string().max(80).nullable().default(null),
  instruction: z.string().max(2000).default(""), brush: brushSchema.nullable().default(null),
  brushDescription: z.string().max(2000).default(""), blend: z.array(z.string().max(80)).max(8).default([]),
}).transform(panel => ({ ...panel, codeDraft: panel.codeDraft ?? (panel.generated ? syncParameters(panel.generated.code, panel.groups, panel.generated.bindings) : ""), selected: panel.features.some(f => f.id === panel.selected) ? panel.selected : null }));
export type SavedSketchPanel = z.infer<typeof sketchPanelSchema>;
export type SketchPanel = SavedSketchPanel & {
  hovered: string | null; executable: string; preparedCode: string; runtimeError: string;
  renderRevision: number; annotating: boolean; annotationImage: string; annotationSource: string; annotationRenderRevision: number;
  annotationHistory: AnnotationHistory; clarifying: boolean; clarificationContext: string | null; revisionInstruction: string;
  revisionProposal: { proposal: RevisionProposal; snapshot: string } | null;
  removedControls: { groups: RuleGroup[]; generated: GeneratedCode | null }[];
  lab: Artwork; labFuture: Artwork["strokes"]; gesture: string; loading: string; error: string;
};
export function clearedResultAnnotations(): Partial<SketchPanel> {
  return { annotating: false, annotationImage: "", annotationSource: "", annotationHistory: emptyAnnotationHistory(), clarifying: false, clarificationContext: null, revisionInstruction: "", revisionProposal: null };
}
export function createSketchPanel(saved?: SavedSketchPanel): SketchPanel {
  return { ...sketchPanelSchema.parse(saved || {}), hovered: null, executable: "", preparedCode: "", runtimeError: "", renderRevision: 0,
    annotating: false, annotationImage: "", annotationSource: "", annotationRenderRevision: 0, annotationHistory: emptyAnnotationHistory(),
    clarifying: false, clarificationContext: null, revisionInstruction: "", revisionProposal: null, removedControls: [],
    lab: { strokes: [], photo: null, name: "Brush playground", revision: 0 }, labFuture: [], gesture: "curve", loading: "", error: "" };
}
export function updateSketchPanel<K extends keyof SketchPanel>(panels: Record<string, SketchPanel>, id: string, key: K, value: SketchPanel[K] | ((previous: SketchPanel[K]) => SketchPanel[K])) {
  const panel = panels[id] || createSketchPanel();
  const next = typeof value === "function" ? (value as (previous: SketchPanel[K]) => SketchPanel[K])(panel[key]) : value;
  if (Object.is(panel[key], next)) return panels;
  const patch = key === "generated" ? { codeDraft: next ? syncParameters((next as GeneratedCode).code, panel.groups, (next as GeneratedCode).bindings) : "", executable: "", preparedCode: "" } : {};
  return { ...panels, [id]: { ...panel, ...patch, [key]: next } };
}
export function savedSketchPanels(panels: Record<string, SketchPanel>): Record<string, SavedSketchPanel> {
  return Object.fromEntries(Object.entries(panels).map(([id, panel]) => [id, sketchPanelSchema.parse({ ...panel, generated: panel.generated ? { ...panel.generated, code: syncParameters(panel.generated.code, panel.groups, panel.generated.bindings) } : null })]));
}
