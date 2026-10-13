import { semanticPenSchema, ART_WIDTH, ART_HEIGHT, type SemanticPen, type Artwork } from "./schema";

export function createInteractionPen(): SemanticPen {
  const meaning = "사용자 interaction을 스케치로 annotate하는 펜입니다. 클릭·탭 위치, 호버 영역, 드래그 경로와 방향, 놓기 위치, 키 입력에 따른 반응을 표시합니다. 주변 스케치와 prompt를 함께 보고 입력 대상·동작·결과를 해석하세요. 이 자국은 최종 작품에 그릴 모양이 아니라 사용자가 어떻게 조작할지에 대한 설명입니다. 대기·접근·누름·드래그·놓기·반응·복귀를 의미 있는 상태와 전이로 나누세요.";
  return semanticPenSchema.parse({ kind: "interaction", id: "builtin-interaction", name: "Interaction pen", color: "#e06438", sourceSketchId: "source", source: { nodeId: "", label: "User interaction" }, meaning });
}

export const semanticPenColors = ["#3b73c4", "#c4547d", "#8b61b6", "#cf8c2e", "#2e938b", "#bb583b", "#567e38", "#6e70ad", "#ac6d25", "#2d819e", "#ba4471", "#78692c", "#634fa4", "#267b60", "#b65427", "#5677ac", "#994899", "#377a85", "#8a7330", "#74589b", "#a64e4e", "#4077a0", "#798044", "#915b83", "#a36e3d", "#428b77", "#7568aa", "#aa5874", "#44749a", "#876b40", "#58845d", "#934e71"];
// References come from stroke snapshots, including pens removed from the toolbar.
export function compositionContext(artwork: Artwork) {
  const compositionPens: SemanticPen[] = [], identities = new Map<string, string>();
  const compositionStrokes = artwork.strokes.filter(stroke => stroke.points.length).map((stroke, i) => {
    let semanticPenId: string | null = null;
    if (stroke.semanticPen && stroke.tool !== "eraser") {
      const key = JSON.stringify(stroke.semanticPen);
      semanticPenId = identities.get(key) || `mark-pen-${compositionPens.length + 1}`;
      if (!identities.has(key)) { identities.set(key, semanticPenId); compositionPens.push({ ...structuredClone(stroke.semanticPen), id: semanticPenId }); }
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
