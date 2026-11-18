import { frameIds, type TargetedTool } from "./brushes";
import { parameterStatus, recordingApplied } from "./hidden-parameters";
import { markStyleAt, resultInFrame } from "./inspection";
import type { GeneratedCode } from "./schema";
import { nodeMachine, stateConstraints } from "./scene/machines";
import { liveSceneSource } from "./scene/live";
import type { Param, Scene, SceneNode, Value } from "./scene/schema";
import { bindingKey, valueLeaves } from "./scene/values";

// One frame as a single JSON document, to copy out of the app: every node with its
// constraints (the property each controls, its params with ranges), its FSM with
// each state's constraints in evaluation order, the frame's full code as the code panel shows it, and each
// brush in the frame with its targeted inspection tools (concern, annotation,
// overlays, suggestions) in this frame's ids.

export const FRAME_EXPORT_FORMAT = "rulegen-frame/2";
const CANVAS = { width: 900, height: 600 };

/** Every scalar a node's params hold: key (as in the code's rulegenParams) → value. */
function paramValues(node: SceneNode) {
  return Object.fromEntries(node.constraints.flatMap(constraint => constraint.params).flatMap(param => valueLeaves(param.value, [node.id, param.id])).map(leaf => [bindingKey(leaf.path), leaf.value.value]));
}
/** A param for reading: its value (a slider, with its range) and its live key. Widget code is left out. */
function exportParam(node: SceneNode, param: Param) {
  return {
    id: param.id, label: param.label, effect: param.effect, description: param.description, value: param.value,
    scalars: valueLeaves(param.value, [node.id, param.id]).map(leaf => ({ key: bindingKey(leaf.path), path: leaf.path.slice(2).join("/"), ...leaf.value })),
    ...(param.handle ? { handle: { hint: param.handle.hint, paths: param.handle.paths } } : {}),
  };
}

export type FrameExportInput = {
  id: string; name: string; scene: Scene; generated: GeneratedCode | null;
  /** Which brush each root belongs to (master or instance), if any. */
  brushOf?: (nodeId: string) => { name: string; master: boolean } | null;
  /** The brushes in this frame (their roots here) with their targeted inspection tools. */
  brushes?: { id: string; name: string; roots: string[]; targeted: TargetedTool[] }[];
};
/** A targeted tool as it reads in this frame: its result in this frame's node ids (overlays on every stamp, the rest for the first). */
function exportTargeted(scene: Scene, roots: string[], tool: TargetedTool, code = "") {
  const result = roots.length ? resultInFrame(tool.result, roots.map(root => frameIds(scene, root))) : tool.result;
  const px = (point: { x: number; y: number }) => ({ x: Math.round(point.x * CANVAS.width * 10) / 10, y: Math.round(point.y * CANVAS.height * 10) / 10 });
  return {
    id: tool.id, name: tool.name, concern: tool.concern,
    /** The inspection annotation it was made from, in canvas pixels, with each mark's color, width and opacity. */
    annotation: tool.marks.map((mark, i) => ({ style: markStyleAt(tool.markStyles, i), points: mark.map(px) })),
    summary: result.summary, overlays: result.overlays,
    /** Hard-coded constants suggested as parameters, with whether they were accepted (on the node now), rejected or are still open. */
    hiddenParameters: result.parameters.map(item => ({ ...item, status: parameterStatus(item, scene) })),
    /** Fields the code was made to record on each drawn item for these overlays, and whether the code has them now. */
    itemRecords: result.records ? { ...result.records, applied: recordingApplied(scene, code, result.records) } : null,
  };
}
export function frameExport({ id, name, scene, generated, brushOf, brushes = [] }: FrameExportInput) {
  const code = liveSceneSource(generated, scene);
  return {
    format: FRAME_EXPORT_FORMAT, frame: { id, name }, canvas: CANVAS,
    nodes: scene.nodes.map(node => {
      const machine = nodeMachine(node), brush = !node.parentId ? brushOf?.(node.id) ?? null : null;
      return {
        id: node.id, name: node.name, kind: node.kind, description: node.description, parentId: node.parentId ?? null, visible: node.visible,
        ...(brush ? { brush: { name: brush.name, role: brush.master ? "master" : "instance" } } : {}),
        /** Its box in canvas pixels. */
        box: { x: Math.round(node.region.x * CANVAS.width * 10) / 10, y: Math.round(node.region.y * CANVAS.height * 10) / 10, w: Math.round(node.region.w * CANVAS.width * 10) / 10, h: Math.round(node.region.h * CANVAS.height * 10) / 10 },
        constraints: node.constraints.map(constraint => ({ id: constraint.id, property: constraint.property, description: constraint.description, params: constraint.params.map(param => exportParam(node, param)) })),
        /** Every param value of its constraints. */
        values: paramValues(node),
        /** Its FSM (a node without one of its own: the implicit single state). */
        machine: {
          implicit: !node.machine, initialState: machine.initialState,
          states: machine.states.map(state => ({ id: state.id, label: state.label, description: state.description, constraints: stateConstraints(node, state.id).map(constraint => ({ id: constraint.id, property: constraint.property })) })),
          transitions: machine.transitions,
        },
      };
    }),
    brushes: brushes.map(brush => ({ id: brush.id, name: brush.name, roots: brush.roots, targetedInspections: brush.targeted.map(tool => exportTargeted(scene, brush.roots, tool, generated?.code)) })),
    code: code ? { title: generated?.title ?? "", explanation: generated?.explanation ?? "", source: code } : null,
  };
}
export type FrameExport = ReturnType<typeof frameExport>;
