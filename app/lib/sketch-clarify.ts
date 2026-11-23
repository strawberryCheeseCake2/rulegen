import { z } from "zod";
import { compiles } from "./execution/manipulate";

// Progressive clarification before Extract / Compose: each stage the AI asks only what is still ambiguous and would
// critically change the generated artwork (or says it is clear enough). The answers go with the request as text.

export const MAX_CLARIFY_STAGES = 5;
export const MAX_STAGE_QUESTIONS = 4;
export type ClarifyMode = "extract" | "compose";

/**
 * One interpretation of a choice question, drawn as a small SVG thumbnail. When the readings differ in their logic (how
 * the artwork comes about), it also has `logic` (one line) and `sketch`: a drawing of that logic in situ, over the
 * sketch itself (the body of `(ctx, input, note)` on the 900×600 canvas, with in-situ notes as the tools' previews have).
 */
const optionSchema = z.object({ id: z.string().max(40), label: z.string().max(120), svg: z.string().max(6000), logic: z.string().max(200), sketch: z.string().max(8000) });
/** A missing quantity the user sets: a number (slider) or a color. */
const valueParamSchema = z.object({ id: z.string().max(40), label: z.string().max(80), kind: z.enum(["number", "color"]),
  min: z.number(), max: z.number(), step: z.number(), unit: z.string().max(12), value: z.number(), color: z.string().max(20) });
const questionSchema = z.object({
  id: z.string().max(40),
  /** choice: several plausible interpretations · text: an abstract/symbolic mark only words can pin down · confirm: one likely reading to check · value: missing parameters to set. */
  kind: z.enum(["choice", "text", "confirm", "value"]),
  question: z.string().max(400),
  /** What in the artwork it decides (shown small under the question). */
  why: z.string().max(300),
  options: z.array(optionSchema).max(4),
  placeholder: z.string().max(200),
  params: z.array(valueParamSchema).max(4),
  /** value: an SVG showing the params, with {{<param id>}} where each value goes ("" for none). */
  preview: z.string().max(6000),
});
export const aiSketchClarifySchema = z.object({
  /** True when nothing left is ambiguous enough to change the artwork critically (questions then empty). */
  done: z.boolean(),
  /** Why these questions (or why it is clear enough). */
  reason: z.string().max(400),
  questions: z.array(questionSchema).max(MAX_STAGE_QUESTIONS),
});
export type ClarifyQuestion = z.infer<typeof questionSchema>;
export type ClarifyParam = z.infer<typeof valueParamSchema>;
export type SketchClarifyResult = z.infer<typeof aiSketchClarifySchema>;

/** What the user answered (unset: no preference). */
export type ClarifyAnswer = { choice?: string; text?: string; confirm?: boolean; values?: Record<string, number | string> };
export type ClarifyStage = { questions: ClarifyQuestion[]; answers: Record<string, ClarifyAnswer> };
/** An option's in-situ drawing as drawn (a 900×600 PNG data URL, "" when it could not be), and why not. */
export type ClarifyDrawing = { src: string; note: string };
/** Where an option's drawing is kept: its question and option in the current stage. */
export const drawingKey = (questionId: string, optionId: string) => `${questionId}\n${optionId}`;
/** The open clarification of a frame (not saved). */
export type SketchClarifyState = { mode: ClarifyMode; stages: ClarifyStage[]; reason: string;
  /** The AI found nothing critical to ask before any stage: why (the user extracts / composes, or asks anyway). */
  clear?: string;
  /** The sketch as it was asked about (the in-situ drawings are shown over it in the option thumbnails). */
  picture?: string;
  /** Its strokes as the AI was given them (the in-situ drawings place what they draw from them). */
  strokes?: SketchStroke[] };

/** A stroke as the AI is given it (compositionStrokes: points 0–1 of the canvas). */
export type SketchStroke = { id: string; tool: string; color: string; width: number; points: { x: number; y: number }[]; semanticPenId: string | null };
const CANVAS = { width: 900, height: 600 };
/**
 * What an option's in-situ drawing gets as `input`: the canvas and the sketch's strokes in canvas pixels (the same ids
 * as compositionStrokes), each with its box and center, so the drawing places what it draws by computing from them.
 */
export function sketchInput(strokes: SketchStroke[] = []) {
  const round = (value: number) => Math.round(value * 10) / 10;
  return { ...CANVAS, strokes: strokes.filter(stroke => stroke.tool !== "eraser" && stroke.points.length).slice(0, 200).map(stroke => {
    const all = stroke.points.map(point => [round(point.x * CANVAS.width), round(point.y * CANVAS.height)] as [number, number]);
    const step = Math.max(1, Math.ceil(all.length / 64)), points = all.filter((_, k) => k % step === 0 || k === all.length - 1);
    const xs = all.map(point => point[0]), ys = all.map(point => point[1]);
    const box = { x: Math.min(...xs), y: Math.min(...ys), w: round(Math.max(...xs) - Math.min(...xs)), h: round(Math.max(...ys) - Math.min(...ys)) };
    return { id: stroke.id, tool: stroke.tool, color: stroke.color, width: stroke.width, pen: stroke.semanticPenId, points, box, center: [round(box.x + box.w / 2), round(box.y + box.h / 2)] };
  }) };
}

/** A stage as sent back to the AI: each question with what was answered. */
export const answeredSchema = z.object({ question: z.string().max(400), kind: z.string().max(10), answer: z.string().max(600) });
export const clarifyRequestSchema = z.object({ mode: z.enum(["extract", "compose"]),
  /** The user asked for questions although the AI found it clear: ask about what is most uncertain. */
  askAnyway: z.boolean().default(false), stages: z.array(z.array(answeredSchema).max(MAX_STAGE_QUESTIONS)).max(MAX_CLARIFY_STAGES) });

const HEX = /^#[0-9a-fA-F]{6}$/;
const SVG = /^\s*<svg[\s>][\s\S]*<\/svg>\s*$/i;
/** Only a plain drawing: no scripts, handlers, links or embedded documents (it is shown as an image anyway). */
export const safeSvg = (svg: string) => SVG.test(svg) && !/<\s*(script|foreignObject|iframe|image|use)\b|\bon\w+\s*=|javascript:|href\s*=/i.test(svg) ? svg.trim() : "";
const slug = (value: string, fallback: string) => value.replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 34) || fallback;
const unique = (taken: Set<string>, id: string) => { let next = id, n = 2; while (taken.has(next)) next = `${id}-${n++}`; taken.add(next); return next; };

/** The AI's stage as the app takes it: well-formed questions only, none once the stages are used up. */
export function settleSketchClarify(output: SketchClarifyResult, asked: number): SketchClarifyResult {
  if (asked >= MAX_CLARIFY_STAGES) return { done: true, reason: output.reason.slice(0, 400), questions: [] };
  const ids = new Set<string>();
  const questions = output.done ? [] : output.questions.flatMap((question, q): ClarifyQuestion[] => {
    const text = question.question.trim();
    if (!text) return [];
    const base = { ...question, id: unique(ids, slug(question.id, `q${q + 1}`)), question: text, why: question.why.trim(), options: [], params: [], placeholder: "", preview: "" };
    if (question.kind === "choice") {
      const taken = new Set<string>();
      const options = question.options.filter(option => option.label.trim()).map((option, k) => ({ id: unique(taken, slug(option.id, `o${k + 1}`)), label: option.label.trim(), svg: safeSvg(option.svg),
        logic: option.logic.trim(), sketch: compiles(option.sketch, ["ctx", "input", "note"]) ? option.sketch : "" }));
      return options.length >= 2 ? [{ ...base, options }] : [];
    }
    if (question.kind === "text") return [{ ...base, placeholder: question.placeholder.trim() }];
    if (question.kind === "confirm") return [base];
    const taken = new Set<string>();
    const params = question.params.filter(param => param.label.trim()).map((param, k): ClarifyParam => {
      const id = unique(taken, slug(param.id, `p${k + 1}`));
      if (param.kind === "color") return { ...param, id, label: param.label.trim(), color: HEX.test(param.color) ? param.color : "#808080", min: 0, max: 0, step: 0, value: 0, unit: "" };
      const min = Math.min(param.min, param.max), max = Math.max(param.min, param.max) > min ? Math.max(param.min, param.max) : min + 1;
      const step = param.step > 0 && param.step <= max - min ? param.step : (max - min) / 100;
      return { ...param, id, label: param.label.trim(), min, max, step, value: Math.min(max, Math.max(min, param.value)), color: "" };
    });
    return params.length ? [{ ...base, params, preview: safeSvg(question.preview) }] : [];
  }).slice(0, MAX_STAGE_QUESTIONS);
  return { done: !questions.length, reason: output.reason.trim().slice(0, 400), questions };
}

/** A value question's starting answer: every param at the value the AI proposed. */
export const startingAnswers = (questions: ClarifyQuestion[]): Record<string, ClarifyAnswer> => Object.fromEntries(questions.filter(question => question.kind === "value")
  .map(question => [question.id, { values: Object.fromEntries(question.params.map(param => [param.id, param.kind === "color" ? param.color : param.value])) }]));

const valueText = (param: ClarifyParam, value: number | string | undefined) => {
  const shown = value ?? (param.kind === "color" ? param.color : param.value);
  return `${param.label} = ${typeof shown === "number" ? `${Number(shown.toFixed(4))}${param.unit ? ` ${param.unit}` : ""}` : shown}`;
};
/** What was answered, in words ("" when left open). */
export function answerText(question: ClarifyQuestion, answer: ClarifyAnswer | undefined): string {
  if (question.kind === "choice") return question.options.find(option => option.id === answer?.choice)?.label ?? "";
  if (question.kind === "text") return (answer?.text ?? "").trim().slice(0, 600);
  if (question.kind === "confirm") return answer?.confirm === undefined ? "" : answer.confirm ? "yes" : "no";
  return question.params.map(param => valueText(param, answer?.values?.[param.id])).join(", ");
}

/** The stages as sent to the next request. */
export const answeredStages = (stages: ClarifyStage[]) => stages.map(stage => stage.questions.map(question =>
  ({ question: question.question, kind: question.kind, answer: answerText(question, stage.answers[question.id]) || "(no preference: decide from the sketch)" })));

/** The answers, as text that goes with the Extract / Compose request ("" when nothing was answered). */
export function clarifiedText(stages: ClarifyStage[]): string {
  const lines = stages.flatMap(stage => stage.questions.flatMap(question => {
    const answer = answerText(question, stage.answers[question.id]);
    return answer ? [`- ${question.question.slice(0, 200)} → ${answer.slice(0, 300)}`] : [];
  }));
  return lines.length ? `The user clarified:\n${lines.join("\n")}` : "";
}

/** A value question's preview with the current values in place. */
export function filledPreview(question: ClarifyQuestion, answer: ClarifyAnswer | undefined) {
  if (!question.preview) return "";
  return question.preview.replace(/\{\{\s*([\w-]+)\s*\}\}/g, (match, id: string) => {
    const param = question.params.find(item => item.id === id);
    if (!param) return match;
    const value = answer?.values?.[id] ?? (param.kind === "color" ? param.color : param.value);
    return typeof value === "number" ? String(Number(value.toFixed(4))) : HEX.test(value) ? value : param.color;
  });
}
export const svgSource = (svg: string) => svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : "";
