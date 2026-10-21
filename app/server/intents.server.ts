import { z } from "zod";
import { codeSchema, compositionPromptSchema, generatedSchema, type requestSchema } from "../lib/schema";
import { aiComposeSchema, aiDecompositionSchema, aiTransformSchema, type AICompose } from "../lib/scene/ai-schema";
import { convertComposition, convertTransformation, mergeAIAlgorithms } from "../lib/scene/convert";
import { algorithmClosure, algorithmRefs } from "../lib/scene/algorithms";
import { descendantIds, updateNode } from "../lib/scene/graph";
import { conformMachine } from "../lib/scene/machines";
import { collectionCount, convertDecomposition } from "../lib/scene/minimal-example";
import { canAddTransformation, placeTransformation } from "../lib/scene/transformations";
import { validateScene } from "../lib/scene/validate";
import { sceneBindings, sceneValues } from "../lib/scene/values";
import { connectScene } from "./scene-code.server";
import { prepareCode } from "./code.server";

// One entry per AI intent: its structured output schema, prompt file, budget,
// preconditions, the request context and how the model output is finalized.
// The workflow: decompose a sketch into independent transformations (each then
// rendered as a minimal example and made a pen; an example can be decomposed again) → compose a sketch drawn with
// those pens → code. `transform` regenerates one transformation in place.

export type AIInput = z.infer<typeof requestSchema>;
type Intent = {
  schema: z.ZodType; maxTokens: (input: AIInput) => number; effort?: "low" | "medium";
  /** Returns an error message when the request cannot run. */
  check?: (input: AIInput) => string | void;
  context: (input: AIInput) => Record<string, unknown>;
  /** Attach the sketch's pen/stroke context as a separate part. */
  strokes?: boolean;
  finalize?: (input: AIInput, output: any) => unknown;
};

const canvas = { width: 900, height: 600 };
const targetNode = (input: AIInput) => input.scene?.nodes.find(node => node.id === input.targetNodeId);
const needsTarget = (input: AIInput) => !targetNode(input) ? "대상 Collection 또는 Object를 찾지 못했습니다." : undefined;
/** The modules the code must define: one per root node, with the node ids it draws. */
const codeModules = (scene: NonNullable<AIInput["scene"]>) => scene.nodes.filter(node => !node.parentId).map(root => ({ key: root.id, nodes: [root.id, ...descendantIds(scene, root.id)] }));
const needsScene = (input: AIInput) => !input.scene?.nodes.length ? "먼저 스케치를 Decompose하거나 Compose해주세요." : undefined;
/** What the model reads of a pen: its transformation and algorithms (the example frame and the objects it was shown on are the app's business). */
const penForModel = (pen: AIInput["compositionPens"][number]) => pen.kind === "interaction" ? { id: pen.id, kind: pen.kind, color: pen.color, meaning: pen.meaning }
  : { id: pen.id, kind: pen.kind, color: pen.color, name: pen.name, meaning: pen.meaning, appliesTo: pen.transformation!.target,
    transformation: pen.transformation!.transformation, algorithms: pen.transformation!.library };
export const strokeContext = (input: AIInput) => ({ compositionPens: input.compositionPens.map(penForModel), compositionStrokes: input.compositionStrokes, canvas });
/** Decomposing a minimal example: the one transformation it shows, its example structure and carrier, and the algorithms it calls (to split further). */
function splitContext(input: AIInput) {
  const scene = input.scene, node = scene && targetNode(input), transformation = node?.transformations.find(item => item.id === input.targetTransformationId);
  if (!scene || !node || !transformation) return null;
  // Its example's structure, as the model wrote it for decompose (the carrier and the nodes around it), every object a plain stand-in: the pieces keep nothing of the sketch.
  return { transformation, carrier: node.id,
    nodes: scene.nodes.map(item => ({ id: item.id, kind: item.kind, parentId: item.parentId, shape: item.kind === "collection" ? null : item.primitive === "rect" ? "square" : "circle", count: collectionCount(item), object: null })),
    algorithms: algorithmClosure(scene.algorithms, transformation.properties.flatMap(property => algorithmRefs(property.value))) };
}

export const intents: Record<"decompose" | "compose" | "compose-prompt" | "transform" | "code", Intent> = {
  decompose: {
    schema: aiDecompositionSchema, maxTokens: () => 40000, strokes: true,
    check: input => !input.image ? "분석할 이미지가 없습니다." : input.targetTransformationId && !splitContext(input) ? "나눌 transformation을 찾지 못했습니다." : undefined,
    // A sketch, or (with `split`) a minimal example's one transformation to split into smaller ones.
    context: input => { const split = splitContext(input); return { instruction: input.instruction, ...(split ? { split } : {}) }; },
    // Splitting an example: no sketch objects, every object a stand-in.
    finalize: (input, output) => convertDecomposition(output, Boolean(input.targetTransformationId)),
  },
  compose: {
    schema: aiComposeSchema, maxTokens: () => 44000, strokes: true,
    check: input => !input.image || !input.instruction.trim() ? "스케치와 Compose prompt가 필요합니다." : undefined,
    context: input => ({ instruction: input.instruction }),
    // Pen transformations are copied in exactly (the model only says which node takes which pen).
    finalize: (input, output: AICompose) => convertComposition(output, input.compositionPens),
  },
  "compose-prompt": {
    schema: compositionPromptSchema, maxTokens: () => 2000, strokes: true,
    check: input => !input.image ? "프롬프트를 만들 스케치 이미지가 필요합니다." : undefined,
    context: input => ({ instruction: input.instruction }),
  },
  transform: {
    schema: aiTransformSchema, maxTokens: () => 10000,
    check: input => needsTarget(input) || (!input.targetPropertyId && !input.targetTransformationId && !canAddTransformation(targetNode(input)!) ? "이 노드에는 더 이상 semantic transformation을 추가할 수 없습니다." : undefined),
    context: input => ({ scene: input.scene, targetNodeId: input.targetNodeId, targetTransformationId: input.targetTransformationId, targetPropertyId: input.targetPropertyId,
      mode: input.targetPropertyId ? "property" : input.targetTransformationId ? "replace" : "add", alternative: input.alternative, instruction: input.instruction, annotationMarks: input.transformMarks, canvas }),
    finalize: (input, output: z.infer<typeof aiTransformSchema>) => {
      const scene = input.scene!, { library, ids } = mergeAIAlgorithms(scene.algorithms, output.algorithms);
      const generated = convertTransformation(output.transformation, library, ids);
      const target = { transformationId: input.targetTransformationId || undefined, propertyId: input.targetPropertyId || undefined };
      return validateScene(updateNode({ ...scene, algorithms: library }, input.targetNodeId, node => conformMachine(placeTransformation(node, generated, target))));
    },
  },
  code: {
    schema: codeSchema, strokes: true, check: needsScene,
    maxTokens: input => input.scene?.nodes.some(node => node.machine) ? 32000 : 24000,
    context: input => ({ scene: input.scene, modules: codeModules(input.scene!), parameterBindings: sceneBindings(input.scene!), parameterValues: sceneValues(input.scene!), previous: input.previous, instruction: input.instruction,
      ...(input.references.length ? { references: input.references } : {}) }),
    finalize: (input, output: z.infer<typeof codeSchema>) => {
      const generated = generatedSchema.parse(connectScene(output, input.scene!));
      prepareCode(generated.code);
      return generated;
    },
  },
};
export type IntentName = keyof typeof intents;
export const isIntent = (name: string): name is IntentName => name in intents;
/** JSON schema sent as the structured output format; `npm run prompts:schemas` writes it to prompts/schemas. */
export const outputSchema = (intent: IntentName) => z.toJSONSchema(intents[intent].schema, { target: "draft-7" });
