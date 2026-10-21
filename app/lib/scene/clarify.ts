import type { Clarification, SemanticPen } from "../schema";
import { findNode } from "./graph";
import type { Scene } from "./schema";
import { canAddTransformation, findTransformation } from "./transformations";

// Clarify before changing: an annotation (and text) on a frame first comes back as
// text (what the AI understood, where it will add or modify a transformation, the
// concrete change, open questions). Only when the user applies it does the
// `transform` step run, with that plan as its brief. Strokes drawn with a
// transformation pen point at where that pen's transformation goes: added exactly
// as its minimal example has it, or the reference for a modification.

/** A fixed target (a regeneration opened on a node, property or transformation); none: the AI chooses from the annotation. */
export type ClarifyTarget = { nodeId: string; transformationId: string; propertyId: string };

/**
 * The model's clarification made sound against the scene (and the fixed target, which it cannot change).
 * `pens`: the transformation pens the user drew with (a pen it names must be one of them).
 */
export function settleClarification(scene: Scene, output: Clarification, fixed?: ClarifyTarget | null, pens: string[] = []): Clarification {
  const pick = fixed?.nodeId ? fixed : output, node = findNode(scene, pick.nodeId);
  if (!node) throw new Error("AI가 고른 대상(collection/object)을 찾지 못했습니다. 다시 시도해주세요.");
  let transformationId = fixed?.nodeId ? fixed.transformationId : output.action === "modify" ? output.transformationId : "";
  let propertyId = fixed?.nodeId || output.action === "modify" ? pick.propertyId : "";
  // A property alone names the transformation it is in.
  if (propertyId && !transformationId) transformationId = node.transformations.find(item => item.properties.some(property => property.id === propertyId))?.id ?? "";
  const transformation = transformationId ? findTransformation(node, transformationId) : undefined;
  if (transformationId && !transformation) throw new Error("AI가 고른 semantic transformation을 찾지 못했습니다. 다시 시도해주세요.");
  if (!transformation?.properties.some(property => property.id === propertyId)) propertyId = "";
  if (!transformation && !canAddTransformation(node)) throw new Error("이 노드에는 더 이상 semantic transformation을 추가할 수 없습니다.");
  return { ...output, action: transformation ? "modify" : "add", nodeId: node.id, transformationId: transformation?.id ?? "", propertyId, penId: pens.includes(output.penId) ? output.penId : "",
    understanding: output.understanding.trim(), plan: output.plan.trim(), questions: output.questions.map(item => item.trim()).filter(Boolean) };
}

/** What a clarification will change, in words (for the user to confirm); `pen` names the pen it uses. */
export function clarificationTarget(scene: Scene, clarification: Clarification, pen?: (id: string) => SemanticPen | undefined) {
  const node = findNode(scene, clarification.nodeId), transformation = node && findTransformation(node, clarification.transformationId);
  const property = transformation?.properties.find(item => item.id === clarification.propertyId), used = clarification.penId ? pen?.(clarification.penId) : undefined;
  if (!node) return "대상 없음";
  if (!transformation) return used ? `「${node.name}」에 펜 「${used.name}」의 transformation을 그대로 추가` : `「${node.name}」에 새 transformation 추가`;
  if (used) return `「${node.name}」의 「${transformation.label || transformation.id}」${property ? ` · property 「${property.label}」` : ""}을 펜 「${used.name}」을 참고해 수정`;
  return property ? `「${node.name}」 · ${transformation.label || transformation.id}의 property 「${property.label}」 수정` : `「${node.name}」의 「${transformation.label || transformation.id}」 수정`;
}

/** The brief the transform step gets once the user applies a clarification: their request, the confirmed plan, their answers. */
export function clarifiedInstruction(instruction: string, clarification: Clarification, answer: string) {
  return [instruction.trim() && `User request: ${instruction.trim()}`, `Confirmed plan (follow it exactly): ${clarification.plan}`,
    clarification.penId && `Reference: the transformation of pen "${clarification.penId}" in \`pens\` (reuse its operation and algorithms as the plan says; copy any algorithm you use into \`algorithms\`).`,
    clarification.questions.length > 0 && answer.trim() && `The user's answers to "${clarification.questions.join(" / ")}": ${answer.trim()}`]
    .filter(Boolean).join("\n").slice(0, 4000);
}
