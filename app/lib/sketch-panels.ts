import { z } from "zod";
import { generatedSchema, MAX_CODE_LENGTH, type GeneratedCode } from "./schema";
import { emptyScene, type Scene } from "./scene/schema";
import { sceneSchema } from "./scene/validate";
import { refreshProgram } from "./scene/machines";
import { liveSceneSource } from "./scene/live";
import { exampleSchema } from "./scene/minimal-example";

const point = z.object({ x: z.number().min(-5000).max(20000), y: z.number().min(-5000).max(20000) });
/**
 * A frame is one of three things in the workflow:
 * - a sketch (drawn with the pencil and transformation pens; decomposed or composed from),
 * - a minimal example (one transformation of a decomposed sketch, alone; it backs one pen),
 * - a composition (a scene composed from a sketch drawn with pens).
 */
export const frameRoleSchema = z.enum(["sketch", "example", "composition"]);
export type FrameRole = z.infer<typeof frameRoleSchema>;
export const sketchPanelSchema = z.object({
  role: frameRoleSchema.catch("sketch").default("sketch"),
  scene: sceneSchema.default(emptyScene), selectedNodeIds: z.array(z.string().max(80)).max(48).default([]),
  editingStates: z.record(z.string().max(80), z.string().max(80)).default({}), dirtyNodeIds: z.array(z.string().max(80)).max(48).default([]),
  machinePlaying: z.boolean().default(true),
  /** The sketch this frame was decomposed or composed from. */
  sourceFrameId: z.string().max(80).nullable().default(null),
  /** The source sketch's revision when this frame was made from it (to tell it changed since). */
  analysisRevision: z.number().default(-1), generated: generatedSchema.nullable().default(null),
  codeDraft: z.string().max(MAX_CODE_LENGTH).optional(),
  /** A sketch: the prompt it is composed with. A composition: the prompt it was composed from. */
  composePrompt: z.string().max(2000).default(""),
  /** The user's extra direction for this frame's code. */
  instruction: z.string().max(2000).default(""),
  /** A minimal example: which transformation it shows, and the pen made from it. */
  example: exampleSchema.extend({ penId: z.string().max(80) }).nullable().catch(null).default(null),
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
  renderRevision: number;
  sceneHistory: Scene[]; sceneFuture: Scene[];
  loading: string; error: string;
  /** Live state per node reported by the running sketch. */
  runtimeStates: Record<string, string>;
  /** The latest requested jump, sent to the preview once per revision. */
  stateJump: { nodeId: string; stateId: string; revision: number } | null;
  /** A result is being generated for a frame that has none yet (a new example or composition). */
  pendingResult: boolean;
  /** The state or transition picked in the state machine panel. */
  machineTarget: { nodeId: string; kind: "state" | "transition"; id: string } | null;
  /** An open AI regeneration of a transformation/property (or a new one): the user's text and the annotation drawn on the frame. */
  transformDraft: TransformDraft | null;
};
/** What a regeneration targets: a property, a transformation, or (neither) a new stacked transformation. */
export type TransformTarget = { transformationId?: string; propertyId?: string };
export type TransformDraft = { nodeId: string; target: TransformTarget; instruction: string; annotating: boolean; marks: { x: number; y: number }[][] };
export function createSketchPanel(saved?: Partial<SavedSketchPanel> | z.input<typeof sketchPanelSchema>): SketchPanel {
  const parsed = sketchPanelSchema.parse(saved || {});
  // Saved programs get the current host runtime (it is prepared again on load anyway).
  const generated = parsed.generated && { ...parsed.generated, code: refreshProgram(parsed.generated.code) };
  return { ...parsed, generated, codeDraft: parsed.codeDraft && refreshProgram(parsed.codeDraft), hovered: null, executable: "", preparedCode: "", runtimeError: "", renderRevision: 0,
    sceneHistory: [], sceneFuture: [], loading: "", error: "", runtimeStates: {}, stateJump: null, pendingResult: false, machineTarget: null, transformDraft: null };
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
