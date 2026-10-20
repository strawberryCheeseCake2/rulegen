import { frameIds, type TargetedTool } from "./brushes";
import { currentRecommendation, markStyleAt, resultInFrame } from "./inspection";
import type { GeneratedCode } from "./schema";
import { stateTransformations } from "./scene/machines";
import { liveSceneSource } from "./scene/live";
import type { Property, Scene, SceneNode, SemanticTransformation, Value } from "./scene/schema";
import { bindingKey, isAlgorithm, valueLeaves } from "./scene/values";

// One frame as a single JSON document, to copy out of the app: every node with its
// semantic transformations (constraints, with their ranges and algorithm structure),
// its state machine with each state's full constraint values (the base merged with
// that state's changes), the algorithms they use, the frame's full code as the
// code panel shows it, and each brush in the frame with its targeted inspection
// tools (concern, annotation, overlays, fixes, recommendations) in this frame's ids.

export const FRAME_EXPORT_FORMAT = "rulegen-frame/1";
const CANVAS = { width: 900, height: 600 };

/** Every scalar a set of transformations holds: key (as in the code's rulegenParams) → value. */
function constraintValues(node: SceneNode, transformations: SemanticTransformation[]) {
  return Object.fromEntries(transformations.flatMap(item => item.properties).flatMap(property => valueLeaves(property.value, [node.id, property.id])).map(leaf => [bindingKey(leaf.path), leaf.value.value]));
}
/** A property for reading: its value (algorithms kept as blocks) and each scalar it holds with its range. Widget code is left out. */
function exportProperty(node: SceneNode, property: Property) {
  return {
    id: property.id, label: property.label, effect: property.effect, description: property.description, value: property.value,
    constraints: valueLeaves(property.value, [node.id, property.id]).map(leaf => ({ key: bindingKey(leaf.path), path: leaf.path.slice(2).join("/"), ...leaf.value })),
    ...(property.handle ? { handle: { hint: property.handle.hint, paths: property.handle.paths } } : {}),
  };
}
function usedAlgorithms(scene: Scene) {
  const used = new Set<string>();
  const walk = (value: Value) => { if (isAlgorithm(value)) { used.add(value.algorithmId); value.args.forEach(arg => walk(arg.value)); } };
  for (const node of scene.nodes) for (const item of node.transformations) for (const property of item.properties) walk(property.value);
  for (const node of scene.nodes) for (const state of node.machine?.states ?? []) for (const change of state.values) walk(change.value);
  return scene.algorithms.filter(algorithm => used.has(algorithm.id));
}

export type FrameExportInput = {
  id: string; name: string; scene: Scene; generated: GeneratedCode | null;
  /** Which brush each root belongs to (master or instance), if any. */
  brushOf?: (nodeId: string) => { name: string; master: boolean } | null;
  /** The brushes in this frame (their roots here) with their targeted inspection tools. */
  brushes?: { id: string; name: string; roots: string[]; targeted: TargetedTool[] }[];
};
/** A targeted tool as it reads in this frame: its result in this frame's node ids (overlays on every stamp, fixes and recommendations for the first). */
function exportTargeted(scene: Scene, roots: string[], tool: TargetedTool) {
  const result = roots.length ? resultInFrame(tool.result, roots.map(root => frameIds(scene, root))) : tool.result;
  const px = (point: { x: number; y: number }) => ({ x: Math.round(point.x * CANVAS.width * 10) / 10, y: Math.round(point.y * CANVAS.height * 10) / 10 });
  return {
    id: tool.id, name: tool.name, concern: tool.concern,
    /** The inspection annotation it was made from, in canvas pixels, with each mark's color, width and opacity. */
    annotation: tool.marks.map((mark, i) => ({ style: markStyleAt(tool.markStyles, i), points: mark.map(px) })),
    summary: result.summary, overlays: result.overlays, valueFixes: result.valueFixes,
    /** As listed; `current` is how it reads now (a new transformation it added reads as that transformation). */
    recommendations: result.recommendations.map(item => { const current = currentRecommendation(item, scene); return current === item ? item : { ...item, current: { kind: current.kind, targetId: current.targetId } }; }),
  };
}
export function frameExport({ id, name, scene, generated, brushOf, brushes = [] }: FrameExportInput) {
  const code = liveSceneSource(generated, scene);
  return {
    format: FRAME_EXPORT_FORMAT, frame: { id, name }, canvas: CANVAS,
    nodes: scene.nodes.map(node => {
      const base = constraintValues(node, node.transformations), brush = !node.parentId ? brushOf?.(node.id) ?? null : null;
      return {
        id: node.id, name: node.name, kind: node.kind, description: node.description, parentId: node.parentId ?? null, visible: node.visible,
        ...(brush ? { brush: { name: brush.name, role: brush.master ? "master" : "instance" } } : {}),
        /** Its box in canvas pixels. */
        box: { x: Math.round(node.region.x * CANVAS.width * 10) / 10, y: Math.round(node.region.y * CANVAS.height * 10) / 10, w: Math.round(node.region.w * CANVAS.width * 10) / 10, h: Math.round(node.region.h * CANVAS.height * 10) / 10 },
        transformations: node.transformations.map(item => ({ id: item.id, label: item.label, description: item.description, properties: item.properties.map(property => exportProperty(node, property)) })),
        /** Base value of every constraint (what applies without a state). */
        constraints: base,
        machine: node.machine ? {
          initialState: node.machine.initialState,
          states: node.machine.states.map(state => {
            const values = constraintValues(node, stateTransformations(node, state.id));
            return { id: state.id, label: state.label, description: state.description, constraints: values, changed: Object.keys(values).filter(key => JSON.stringify(values[key]) !== JSON.stringify(base[key])) };
          }),
          transitions: node.machine.transitions,
        } : null,
      };
    }),
    algorithms: usedAlgorithms(scene),
    brushes: brushes.map(brush => ({ id: brush.id, name: brush.name, roots: brush.roots, targetedInspections: brush.targeted.map(tool => exportTargeted(scene, brush.roots, tool)) })),
    code: code ? { title: generated?.title ?? "", explanation: generated?.explanation ?? "", source: code } : null,
  };
}
export type FrameExport = ReturnType<typeof frameExport>;
