import { z } from "zod";
import { featureSchema, generatedSchema, brushSchema, MAX_CODE_LENGTH, MAX_MACHINE_STATES, type Artwork, type RuleGroup, type GeneratedCode, type RevisionProposal } from "./schema";
import { savedGroupSchema } from "./subfeatures";
import { emptyAnnotationHistory, type AnnotationHistory } from "./annotation-history";
import { generatedSource } from "./state-machine";

export const sketchPanelSchema = z.object({
  stage: z.enum(["features", "rules", "code", "brush"]).default("features"),
  features: z.array(featureSchema).max(8).default([]), groups: z.array(savedGroupSchema).max(8).default([]),
  analysisRevision: z.number().default(-1), generated: generatedSchema.nullable().default(null),
  codeDraft: z.string().max(MAX_CODE_LENGTH).optional(), selected: z.string().max(80).nullable().default(null),
  selectedStateId: z.string().max(80).nullable().default(null), machinePlaying: z.boolean().default(true),
  dirtyStateIds: z.array(z.string().max(80)).max(MAX_MACHINE_STATES).default([]),
  composePrompt: z.string().max(2000).default(""), generationMode: z.enum(["rules", "compose"]).default("rules"),
  instruction: z.string().max(2000).default(""), brush: brushSchema.nullable().default(null),
  brushDescription: z.string().max(2000).default(""), blend: z.array(z.string().max(80)).max(8).default([]),
}).transform(panel => {
  const machine = panel.generated?.stateMachine;
  const state = machine?.states.find(state => state.id === panel.selectedStateId) || machine?.states.find(state => state.id === machine.initialState);
  return { ...panel, codeDraft: panel.codeDraft ?? (panel.generated ? generatedSource(panel.generated, panel.groups) : ""),
    selected: (state?.features || panel.features).some(feature => feature.id === panel.selected) ? panel.selected : null, selectedStateId: state?.id || null };
});
export type SavedSketchPanel = z.infer<typeof sketchPanelSchema>;
export type SketchPanel = SavedSketchPanel & {
  hovered: string | null; executable: string; preparedCode: string; runtimeError: string;
  renderRevision: number; annotating: boolean; annotationImage: string; annotationSource: string; annotationRenderRevision: number;
  annotationHistory: AnnotationHistory; clarifying: boolean; clarificationContext: string | null; revisionInstruction: string;
  revisionProposal: { proposal: RevisionProposal; snapshot: string } | null;
  removedControls: { groups: RuleGroup[]; generated: GeneratedCode | null }[];
  lab: Artwork; labFuture: Artwork["strokes"]; gesture: string; loading: string; error: string;
  runtimeStateId: string | null; stateJumpRevision: number;
};
export function selectedSceneState(panel?: SketchPanel) {
  const machine = panel?.generated?.stateMachine;
  return machine?.states.find(state => state.id === panel?.selectedStateId) || machine?.states.find(state => state.id === machine.initialState);
}
export function clearedResultAnnotations(): Partial<SketchPanel> {
  return { annotating: false, annotationImage: "", annotationSource: "", annotationHistory: emptyAnnotationHistory(), clarifying: false, clarificationContext: null, revisionInstruction: "", revisionProposal: null };
}
export function createSketchPanel(saved?: SavedSketchPanel): SketchPanel {
  return { ...sketchPanelSchema.parse(saved || {}), hovered: null, executable: "", preparedCode: "", runtimeError: "", renderRevision: 0,
    annotating: false, annotationImage: "", annotationSource: "", annotationRenderRevision: 0, annotationHistory: emptyAnnotationHistory(),
    clarifying: false, clarificationContext: null, revisionInstruction: "", revisionProposal: null, removedControls: [],
    lab: { strokes: [], photo: null, name: "Brush playground", revision: 0 }, labFuture: [], gesture: "curve", loading: "", error: "",
    runtimeStateId: null, stateJumpRevision: 0 };
}
export function updateSketchPanel<K extends keyof SketchPanel>(panels: Record<string, SketchPanel>, id: string, key: K, value: SketchPanel[K] | ((previous: SketchPanel[K]) => SketchPanel[K])) {
  const panel = panels[id] || createSketchPanel();
  const next = typeof value === "function" ? (value as (previous: SketchPanel[K]) => SketchPanel[K])(panel[key]) : value;
  if (Object.is(panel[key], next)) return panels;
  const nextMachine = key === "generated" ? (next as GeneratedCode | null)?.stateMachine : null;
  const patch = key === "generated" ? { codeDraft: next ? generatedSource(next as GeneratedCode, panel.groups) : "", executable: "", preparedCode: "", selectedStateId: nextMachine?.states.some(state => state.id === panel.selectedStateId) ? panel.selectedStateId : nextMachine?.initialState || null, runtimeStateId: null, dirtyStateIds: [] } : {};
  return { ...panels, [id]: { ...panel, ...patch, [key]: next } };
}
export function savedSketchPanels(panels: Record<string, SketchPanel>): Record<string, SavedSketchPanel> {
  return Object.fromEntries(Object.entries(panels).map(([id, panel]) => [id, sketchPanelSchema.parse({ ...panel, generated: panel.generated ? { ...panel.generated, code: generatedSource(panel.generated, panel.groups) } : null })]));
}
