import { z } from "zod";
import { generatedSchema, MAX_CODE_LENGTH, type GeneratedCode, type MachineTarget } from "./schema";
import { emptyAnnotationHistory, type AnnotationHistory } from "./annotation-history";
import { emptyScene, type Scene } from "./scene/schema";
import { sceneSchema } from "./scene/validate";
import { composeTagSchema, MAX_COMPOSE_TAGS } from "./compose-tags";
import { refreshProgram } from "./scene/machines";
import { liveSceneSource } from "./scene/live";
import type { SceneProposal } from "./scene/revisions";
import type { SketchClarifyState } from "./sketch-clarify";
import type { RestructureOption } from "./execution/sandbox-restructure";
import { keptToolSetSchema, MAX_KEPT_SETS } from "./execution/kept-tools";
import { propagationBaseSchema } from "./scene/propagation";
import { sandboxLogicSchema } from "./execution/concern-sandbox";

const point = z.object({ x: z.number().min(-5000).max(20000), y: z.number().min(-5000).max(20000) });
export const sketchPanelSchema = z.object({
  scene: sceneSchema.default(emptyScene), selectedNodeIds: z.array(z.string().max(80)).max(48).default([]),
  editingStates: z.record(z.string().max(80), z.string().max(80)).default({}), dirtyNodeIds: z.array(z.string().max(80)).max(48).default([]),
  machinePlaying: z.boolean().default(true),
  /** The sketch this frame's scene was extracted or composed from (for code context and staleness). */
  sourceFrameId: z.string().max(80).nullable().default(null),
  /**
   * For a decomposed part (minimal example) frame: the frame it was decomposed from (drawn as a line to it) and what it shows:
   * one constraint of the node (no scope), the node's own constraints together ("constraints"), or the node whole ("node").
   */
  exampleOf: z.object({ frameId: z.string().max(80), nodeId: z.string().max(80), constraintId: z.string().max(80), scope: z.enum(["constraints", "node"]).optional() }).nullable().default(null),
  analysisRevision: z.number().default(-1), generated: generatedSchema.nullable().default(null),
  codeDraft: z.string().max(MAX_CODE_LENGTH).optional(),
  composePrompt: z.string().max(2000).default(""),
  /** What the AI read in the sketch when it wrote the Compose prompt (tags on the sketch), and the sketch revision it read. */
  composeTags: z.array(composeTagSchema).max(MAX_COMPOSE_TAGS).default([]), composeTagsRevision: z.number().default(-1),
  /** Whether Compose sends the text prompt; off, it composes from the tags on the sketch alone. */
  composeWithText: z.boolean().default(true),
  generationMode: z.enum(["extract", "compose"]).default("extract"),
  instruction: z.string().max(2000).default(""),
  /** Where the user moved each node's state boxes and transition labels in the State Machine panel. */
  machineLayouts: z.record(z.string().max(80), z.object({ states: z.record(z.string().max(80), point), labels: z.record(z.string().max(80), point) })).default({}),
  /** Direct manipulation tools kept with the frame (from a kept fork): its code reads what they show (m.demo). */
  keptTools: z.array(keptToolSetSchema).transform(sets => sets.slice(-MAX_KEPT_SETS)).default([]).catch([]),
  /** A part frame (exampleOf) as it was last in step with the frames it came from: what changed since is offered to pass up. */
  propagationBase: propagationBaseSchema.nullable().default(null).catch(null),
  /** A mini sandbox (made from an inspection concern): the concern, and how its program works (shown under its proxy frames). */
  sandboxLogic: sandboxLogicSchema.extend({ concern: z.string().max(2000) }).nullable().default(null).catch(null),
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
  /** An open AI regeneration of a constraint/param (or a new one): the user's text and the annotation drawn on the frame. */
  transformDraft: TransformDraft | null;
  /** The runtime the frame's result starts from (once per id; not saved). */
  seed: { id: string; runtime: unknown } | null;
  /** The open clarification before Extract / Compose (its stages, questions and answers). */
  sketchClarify: SketchClarifyState | null;
  /** A mini sandbox's structural options (asked for when its params alone may not do): the question, the options, the picture they are previewed over. */
  restructure: SandboxRestructure | null;
};
export type SandboxRestructure = { busy: string; question: string; options: RestructureOption[]; picture: string };
export type MachineDraft = { nodeId: string; open: boolean; instruction: string; annotating: boolean; strokes: { x: number; y: number }[][] };
/** What a regeneration targets: a param, a constraint, or (neither) a new stacked constraint. */
export type TransformTarget = { constraintId?: string; paramId?: string };
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
    runtimeStates: {}, stateJump: null, pendingResult: false, machineTarget: null, machineDraft: emptyMachineDraft(), transformDraft: null, seed: null, sketchClarify: null, restructure: null };
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
