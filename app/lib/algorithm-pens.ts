import { semanticPenSchema, ART_WIDTH, ART_HEIGHT, type SemanticPen, type Artwork } from "./schema";
import { algorithmClosure, algorithmRefs } from "./scene/algorithms";
import { findNode } from "./scene/graph";
import type { Example } from "./scene/minimal-example";
import type { Scene } from "./scene/schema";
import { findTransformation } from "./scene/transformations";

export function createInteractionPen(): SemanticPen {
  const meaning = "사용자 interaction을 스케치로 annotate하는 펜입니다. 클릭·탭 위치, 호버 영역, 드래그 경로와 방향, 놓기 위치, 키 입력에 따른 반응을 표시합니다. 주변 스케치와 prompt를 함께 보고 입력 대상·동작·결과를 해석하세요. 이 자국은 최종 작품에 그릴 모양이 아니라 사용자가 어떻게 조작할지에 대한 설명입니다. 대기·접근·누름·드래그·놓기·반응·복귀를 의미 있는 상태와 전이로 나누세요.";
  return semanticPenSchema.parse({ kind: "interaction", id: "builtin-interaction", name: "Interaction pen", color: "#e06438", meaning });
}

export const semanticPenColors = ["#3b73c4", "#c4547d", "#8b61b6", "#cf8c2e", "#2e938b", "#bb583b", "#567e38", "#6e70ad", "#ac6d25", "#2d819e", "#ba4471", "#78692c", "#634fa4", "#267b60", "#b65427", "#5677ac", "#994899", "#377a85", "#8a7330", "#74589b", "#a64e4e", "#4077a0", "#798044", "#915b83", "#a36e3d", "#428b77", "#7568aa", "#aa5874", "#44749a", "#876b40", "#58845d", "#934e71"];

/** The transformation a minimal example frame shows, as a pen carries it (null when the frame no longer has it). */
export function examplePenTransformation(scene: Scene, frameId: string, example: Pick<Example, "nodeId" | "transformationId">) {
  const node = findNode(scene, example.nodeId), transformation = node && findTransformation(node, example.transformationId);
  if (!node || !transformation) return null;
  return { frameId, nodeId: node.id, target: node.kind, transformation: structuredClone(transformation), library: algorithmClosure(scene.algorithms, transformation.properties.flatMap(property => algorithmRefs(property.value))) };
}
/** A pen made from a minimal example frame: drawing with it means "this transformation goes here". */
export function examplePen(scene: Scene, frameId: string, example: Pick<Example, "nodeId" | "transformationId">, id: string, color: string): SemanticPen | null {
  const transformation = examplePenTransformation(scene, frameId, example);
  if (!transformation) return null;
  const label = transformation.transformation.label || transformation.transformation.id;
  return semanticPenSchema.parse({ kind: "transformation", id, name: label.slice(0, 100), color, transformation,
    meaning: transformation.transformation.description.slice(0, 2000) });
}
/**
 * A pen as it reads now: a transformation pen follows its minimal example frame
 * while that frame still shows the transformation (values edited or regenerated
 * there come along); otherwise its saved copy is used.
 */
export function livePen(pen: SemanticPen, frameScene: (frameId: string) => Scene | undefined): SemanticPen {
  const source = pen.transformation;
  if (pen.kind !== "transformation" || !source) return pen;
  const scene = frameScene(source.frameId), current = scene && examplePenTransformation(scene, source.frameId, { nodeId: source.nodeId, transformationId: source.transformation.id });
  return current ? { ...pen, transformation: current } : pen;
}

// References come from stroke snapshots, including pens removed from the toolbar; transformation pens read their example live (`resolve`).
export function compositionContext(artwork: Artwork, resolve: (pen: SemanticPen) => SemanticPen = pen => pen) {
  const compositionPens: SemanticPen[] = [], identities = new Map<string, string>();
  const compositionStrokes = artwork.strokes.filter(stroke => stroke.points.length).map((stroke, i) => {
    let semanticPenId: string | null = null;
    if (stroke.semanticPen && stroke.tool !== "eraser") {
      // The same pen (by id) is one entry; strokes made before an edit of an interaction pen keep their own meaning.
      const pen = resolve(stroke.semanticPen), key = pen.kind === "transformation" ? `pen:${pen.id}` : JSON.stringify(pen);
      semanticPenId = identities.get(key) || `mark-pen-${compositionPens.length + 1}`;
      if (!identities.has(key)) { identities.set(key, semanticPenId); compositionPens.push({ ...structuredClone(pen), id: semanticPenId }); }
    }
    const count = Math.min(128, stroke.points.length);
    const points = Array.from({ length: count }, (_, j) => {
      const point = stroke.points[count === 1 ? 0 : Math.round(j * (stroke.points.length - 1) / (count - 1))];
      return { x: Math.max(0, Math.min(1, point.x / ART_WIDTH)), y: Math.max(0, Math.min(1, point.y / ART_HEIGHT)) };
    });
    return { id: `stroke-${i + 1}`, tool: stroke.tool === "eraser" ? "eraser" as const : semanticPenId ? stroke.semanticPen?.kind === "interaction" ? "interaction" as const : "semantic" as const : "pencil" as const, color: stroke.color, width: stroke.width, opacity: stroke.opacity, points, semanticPenId };
  });
  return { compositionPens, compositionStrokes };
}
