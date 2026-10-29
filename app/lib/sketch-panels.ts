import { z } from "zod";
import { generatedSchema, MAX_CODE_LENGTH, type GeneratedCode, type MachineTarget } from "./schema";
import type { InspectionState } from "./inspection";
import { emptyAnnotationHistory, type AnnotationHistory } from "./annotation-history";
import { emptyScene, type Scene } from "./scene/schema";
import { sceneSchema } from "./scene/validate";
import { refreshProgram } from "./scene/machines";
import { liveSceneSource } from "./scene/live";
import type { SceneProposal } from "./scene/revisions";

const point = z.object({ x: z.number().min(-5000).max(20000), y: z.number().min(-5000).max(20000) });
export const sketchPanelSchema = z.object({
  scene: sceneSchema.default(emptyScene), selectedNodeIds: z.array(z.string().max(80)).max(48).default([]),
  editingStates: z.record(z.string().max(80), z.string().max(80)).default({}), dirtyNodeIds: z.array(z.string().max(80)).max(48).default([]),
  machinePlaying: z.boolean().default(true),
  /** The sketch this frame's scene was extracted or composed from (for code context and staleness). */
  sourceFrameId: z.string().max(80).nullable().default(null),
  /** For a minimal example frame: the frame, node and transformation it shows on its own (drawn as a line to that frame). */
  exampleOf: z.object({ frameId: z.string().max(80), nodeId: z.string().max(80), transformationId: z.string().max(80) }).nullable().default(null),
  analysisRevision: z.number().default(-1), generated: generatedSchema.nullable().default(null),
  codeDraft: z.string().max(MAX_CODE_LENGTH).optional(),
  composePrompt: z.string().max(2000).default(""), generationMode: z.enum(["extract", "compose"]).default("extract"),
  instruction: z.string().max(2000).default(""),
  /** Where the user moved each node's state boxes and transition labels in the State Machine panel. */
  machineLayouts: z.record(z.string().max(80), z.object({ states: z.record(z.string().max(80), point), labels: z.record(z.string().max(80), point) })).default({}),
}).transform(panel => {
  const ids = new Set(panel.scene.nodes.map(node => node.id));
  return { ...panel, codeDraft: panel.codeDraft ?? liveSceneSource(panel.generated, panel.scene),
    selectedNodeIds: panel.selectedNodeIds.filter(id => ids.has(id)),
    editingStates: Object.fromEntries(Object.entries(panel.editingStates).filter(([nodeId, stateId]) => panel.scene.nodes.find(node => node.id === nodeId)?.machine?.states.some(state => state.id === stateId))),
    dirtyNodeIds: panel.dirtyNodeIds.filter(id => ids.has(id)) };
});
export type SavedSketchPanel = z.infer<typeof sketchPanelSchema>;
export type SketchPanel = SavedSketchPanel & {
  hovered: string | null; executable: string; preparedCode: string; runtimeError: string;
  renderRevision: number; annotating: boolean; annotationImage: string; annotationSource: string; annotationRenderRevision: number;
  annotationHistory: AnnotationHistory; clarifying: boolean; clarificationContext: string | null; revisionInstruction: string;
  revisionProposal: { proposal: SceneProposal; snapshot: string } | null;
  sceneHistory: Scene[]; sceneFuture: Scene[];
  loading: string; error: string;
  /** Live state per node reported by the running sketch. */
  runtimeStates: Record<string, string>;
  /** The latest requested jump, sent to the preview once per revision. */
  stateJump: { nodeId: string; stateId: string; revision: number } | null;
  /** A result is being generated for a sketch that has none yet (e.g. after a layer drop). */
  pendingResult: boolean;
  /** The state or transition picked in the state machine panel (attached to a refinement). */
  machineTarget: (MachineTarget & { nodeId: string }) | null;
  /** The open refinement of a node's machine: its text and the annotation drawn on the graph. */
  machineDraft: MachineDraft;
  /** Inspection per brush (recorded steps, annotation draft, focus). */
  inspections: Record<string, InspectionState>;
  /** An open AI regeneration of a transformation/property (or a new one): the user's text and the annotation drawn on the frame. */
  transformDraft: TransformDraft | null;
  /** The runtime the frame's result starts from (a fork keeps the brush marks it was made with; not saved). */
  seed: { id: string; runtime: unknown } | null;
  /** Inspection recommendations applied in this frame, undoable and redoable as a whole (scene, code and prompt together). */
  applied: { past: AppliedEntry[]; future: AppliedEntry[] };
};
/** What a recommendation changes in a frame: kept before and after it was applied. */
export type AppliedSnapshot = Pick<SketchPanel, "scene" | "generated" | "codeDraft" | "executable" | "preparedCode" | "composePrompt" | "dirtyNodeIds">;
export type AppliedEntry = { id: string; title: string; key: string; before: AppliedSnapshot; after: AppliedSnapshot };
export type MachineDraft = { nodeId: string; open: boolean; instruction: string; annotating: boolean; strokes: { x: number; y: number }[][] };
/** What a regeneration targets: a property, a transformation, or (neither) a new stacked transformation. */
export type TransformTarget = { transformationId?: string; propertyId?: string };
export type TransformDraft = { nodeId: string; target: TransformTarget; instruction: string; annotating: boolean; marks: { x: number; y: number }[][] };
export const emptyMachineDraft = (nodeId = ""): MachineDraft => ({ nodeId, open: false, instruction: "", annotating: false, strokes: [] });
export function clearedResultAnnotations(): Partial<SketchPanel> {
  return { annotating: false, annotationImage: "", annotationSource: "", annotationHistory: emptyAnnotationHistory(), clarifying: false, clarificationContext: null, revisionInstruction: "", revisionProposal: null };
}
export function createSketchPanel(saved?: Partial<SavedSketchPanel> | z.input<typeof sketchPanelSchema>): SketchPanel {
  const parsed = sketchPanelSchema.parse(saved || {});
  // Saved programs get the current host runtime (it is prepared again on load anyway).
  const generated = parsed.generated && { ...parsed.generated, code: refreshProgram(parsed.generated.code) };
  return { ...parsed, generated, codeDraft: parsed.codeDraft && refreshProgram(parsed.codeDraft), hovered: null, executable: "", preparedCode: "", runtimeError: "", renderRevision: 0,
    annotating: false, annotationImage: "", annotationSource: "", annotationRenderRevision: 0, annotationHistory: emptyAnnotationHistory(),
    clarifying: false, clarificationContext: null, revisionInstruction: "", revisionProposal: null, sceneHistory: [], sceneFuture: [],
    loading: "", error: "",
    runtimeStates: {}, stateJump: null, pendingResult: false, machineTarget: null, machineDraft: emptyMachineDraft(), inspections: {}, transformDraft: null, seed: null, applied: { past: [], future: [] } };
}
export function updateSketchPanel<K extends keyof SketchPanel>(panels: Record<string, SketchPanel>, id: string, key: K, value: SketchPanel[K] | ((previous: SketchPanel[K]) => SketchPanel[K])) {
  const panel = panels[id] || createSketchPanel();
  const next = typeof value === "function" ? (value as (previous: SketchPanel[K]) => SketchPanel[K])(panel[key]) : value;
  if (Object.is(panel[key], next)) return panels;
  const patch = key === "generated" ? { codeDraft: liveSceneSource(next as GeneratedCode | null, panel.scene), executable: "", preparedCode: "", runtimeStates: {}, dirtyNodeIds: [] } : {};
  return { ...panels, [id]: { ...panel, ...patch, [key]: next } };
}
export function savedSketchPanels(panels: Record<string, SketchPanel>): Record<string, SavedSketchPanel> {
  return Object.fromEntries(Object.entries(panels).map(([id, panel]) => [id, sketchPanelSchema.parse({ ...panel, generated: panel.generated ? { ...panel.generated, code: liveSceneSource(panel.generated, panel.scene) } : null })]));
}
