import { semanticPenSchema, ART_WIDTH, ART_HEIGHT, type SemanticPen, type Feature, type RuleGroup, type Artwork, type BrushRecipe } from "./schema";

export const semanticPenColors = ["#3b73c4", "#c4547d", "#8b61b6", "#cf8c2e", "#2e938b", "#bb583b", "#567e38", "#6e70ad", "#ac6d25", "#2d819e", "#ba4471", "#78692c", "#634fa4", "#267b60", "#b65427", "#5677ac", "#994899", "#377a85", "#8a7330", "#74589b", "#a64e4e", "#4077a0", "#798044", "#915b83", "#a36e3d", "#428b77", "#7568aa", "#aa5874", "#44749a", "#876b40", "#58845d", "#934e71"];
export function makeSemanticPen(groups: RuleGroup[], feature: Feature, subfeatureId: string, sourceSketchId: string, id: string, color: string): SemanticPen {
  const sub = groups.find(g => g.featureId === feature.id)?.subfeatures.find(s => s.id === subfeatureId);
  const implementation = sub?.implementations.find(m => m.id === sub.selectedImplementation);
  if (!sub || !implementation) throw new Error("펜에 담을 알고리즘을 선택해주세요.");
  return semanticPenSchema.parse({ id, name: `${implementation.label} pen`, color, sourceSketchId, feature: structuredClone(feature), subfeatureId: sub.id, subfeatureLabel: sub.label, implementation: structuredClone(implementation), meaning: implementation.description });
}
export function legacySemanticPen(recipe: BrushRecipe, sourceSketchId = "source"): SemanticPen | null {
  const algorithm = recipe.algorithm; if (!algorithm) return null;
  let hash = 2166136261;
  for (const char of `${recipe.name}/${algorithm.featureId}/${algorithm.subfeatureId}/${algorithm.implementationId}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return semanticPenSchema.parse({ id: `legacy-${(hash >>> 0).toString(16)}`, name: recipe.name, color: recipe.settings.color, sourceSketchId,
    feature: { id: algorithm.featureId, label: algorithm.featureId || "Saved feature", description: algorithm.description.slice(0, 600), region: { x: 0, y: 0, w: 1, h: 1 } },
    subfeatureId: algorithm.subfeatureId, subfeatureLabel: algorithm.subfeatureId || algorithm.label,
    implementation: { id: algorithm.implementationId, label: algorithm.label, description: algorithm.description, parameters: algorithm.parameters }, meaning: algorithm.description });
}
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
    return { id: `stroke-${i + 1}`, tool: stroke.tool === "eraser" ? "eraser" as const : semanticPenId ? "semantic" as const : stroke.tool === "brush" ? "brush" as const : "pencil" as const, color: stroke.color, width: stroke.width, opacity: stroke.opacity, points, semanticPenId };
  });
  return { compositionPens, compositionStrokes };
}
