import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { z } from "zod";
import type { requestSchema } from "../lib/schema";
import { AIGenerationLog } from "./ai-log.server";
import { recoverGeneration, type RecoveryContext } from "../lib/generation-recovery";
import { intents, isIntent, outputSchema, strokeContext, type AIInput } from "./intents.server";
import { loadPrompt } from "./prompts.server";
import { errorDetails, logError } from "./error-log.server";
for (const file of [".env.local", ".env"]) if (existsSync(file)) loadEnvFile(file);
let inFlight = 0;
/** An HTTP error from the OpenAI API, with its status and provider error code. */
export class OpenAIError extends Error {
  constructor(message: string, readonly status: number, readonly providerCode: string) { super(message); }
}
/** Overload, server errors and rate limits pass; an exhausted quota does not. */
export const isTransient = (status: number, providerCode: string) => [500, 502, 503, 504].includes(status) || (status === 429 && providerCode !== "insufficient_quota");
const RETRIES = 3;
/** Wait before retry `n` (1-based): Retry-After when given, else 2s, 4s, 8s (scaled by RULEGEN_AI_RETRY_BASE_MS). */
function retryDelay(n: number, retryAfter: string | null) {
  const header = Number(retryAfter);
  if (Number.isFinite(header) && header > 0) return Math.min(header * 1000, 20_000);
  return Number(process.env.RULEGEN_AI_RETRY_BASE_MS ?? 2000) * 2 ** (n - 1);
}
const wait = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal.aborted) { reject(signal.reason); return; }
  const timer = setTimeout(() => { signal.removeEventListener("abort", stop); resolve(); }, ms);
  const stop = () => { clearTimeout(timer); reject(signal.reason); };
  signal.addEventListener("abort", stop, { once: true });
});

export const configuration = () => ({ configured: Boolean(process.env.OPENAI_API_KEY), model: process.env.OPENAI_MODEL || "gpt-6.1-sol" });

/** Instructions = prompts/<intent>.md (+ the interaction contract when interaction marks exist). */
export function instructionsFor(input: AIInput) {
  const interaction = input.compositionPens.some(pen => pen.kind === "interaction") && ["compose-prompt", "decompose", "compose", "code"].includes(input.intent);
  return loadPrompt(input.intent) + (interaction ? `\n\n${loadPrompt("contracts/interaction")}` : "");
}

export async function runAI(input: z.infer<typeof requestSchema>, signal: AbortSignal, context?: RecoveryContext) {
  const log = await AIGenerationLog.start(input.intent, configuration().model, input, context);
  try {
    const result = await runGeneration(input, signal, log);
    await log.success(result, context ? recoverGeneration(input, result, context) : undefined);
    return result;
  } catch (error) {
    await log.failure(error, signal.aborted);
    if (!signal.aborted) await logError({ source: "ai", intent: input.intent, model: configuration().model, generation: log.key, ...errorDetails(error),
      ...(error instanceof OpenAIError ? { status: error.status, providerCode: error.providerCode } : {}), ...(error instanceof Error && error.cause ? { detail: errorDetails(error.cause) } : {}) });
    throw error;
  }
}

function userContent(input: AIInput) {
  const intent = intents[input.intent as keyof typeof intents];
  const content: object[] = [{ type: "input_text", text: JSON.stringify(intent.context(input)) }];
  if (input.image) content.push({ type: "input_image", image_url: input.image, detail: "high" });
  if (intent.strokes && input.compositionStrokes.length) content.push({ type: "input_text", text: JSON.stringify(strokeContext(input)) });
  return content;
}

type Message = { role: "user" | "assistant"; content: object[] | string };

async function runGeneration(input: AIInput, signal: AbortSignal, log: AIGenerationLog) {
  if (!process.env.OPENAI_API_KEY) throw new Error("서버의 .env.local에 OPENAI_API_KEY를 설정해주세요.");
  if (!isIntent(input.intent)) throw new Error("알 수 없는 생성 요청입니다.");
  if (inFlight >= 4) throw new Error("요청이 진행 중입니다. 잠시 후 다시 시도해주세요.");
  const intent = intents[input.intent];
  const problem = intent.check?.(input);
  if (problem) throw new Error(problem);
  inFlight++;
  try {
    return (await respond(input, [{ role: "user", content: userContent(input) }], signal, log, 1)).result;
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) throw new Error("모델 응답을 해석하지 못했습니다. 다시 생성해주세요.", { cause: error });
    if (signal.aborted) throw new Error("요청이 취소되었습니다.", { cause: error });
    if (error instanceof Error && /timeout|abort|fetch failed/i.test(error.message)) throw new Error("OpenAI 연결 시간이 초과되었습니다. 네트워크를 확인하고 다시 시도해주세요.", { cause: error });
    throw error;
  } finally { inFlight--; }
}

const providerCode = (body: string) => { try { return String(JSON.parse(body)?.error?.code ?? ""); } catch { return ""; } };

/** One Responses API call → parsed, finalized result (and the raw text for a follow-up round). */
async function respond(input: AIInput, messages: Message[], signal: AbortSignal, log: AIGenerationLog, attempt: number) {
  const intent = intents[input.intent as keyof typeof intents];
  const model = configuration().model;
  const payload = { model, store: false, instructions: instructionsFor(input), input: messages, max_output_tokens: intent.maxTokens(input),
    ...(/^gpt-[56]/.test(model) ? { reasoning: { effort: intent.effort || "low" } } : {}),
    text: { format: { type: "json_schema", name: `rulegen_${input.intent}`, strict: true, schema: outputSchema(input.intent as keyof typeof intents) } } };
  await log.prompt(payload, attempt);
  let response: Response, rawBody: string;
  // Transient provider failures (overload, 5xx, rate limit) are retried with backoff.
  for (let retry = 0; ; retry++) {
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST", headers: { "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      signal: AbortSignal.any([signal, AbortSignal.timeout(180_000)]),
      body: JSON.stringify(payload),
    });
    rawBody = await response.text();
    if (response.ok || retry >= RETRIES || !isTransient(response.status, providerCode(rawBody))) break;
    await log.retried(attempt, retry + 1, response.status, rawBody);
    await wait(retryDelay(retry + 1, response.headers.get("retry-after")), signal);
  }
  await log.response(response, rawBody, attempt);
  if (!response.ok) {
    const code = providerCode(rawBody);
    const message: Record<number, string> = { 400: "모델이 이미지 또는 구조화된 응답을 지원하지 않거나 요청 형식이 맞지 않습니다. OPENAI_MODEL을 확인해주세요.", 401: "OpenAI API 키를 확인해주세요.", 403: "이 API 키에는 모델 사용 권한이 없습니다.", 404: `설정한 모델 ${model}을 사용할 수 없습니다. OPENAI_MODEL을 확인해주세요.`,
      429: code === "insufficient_quota" ? "OpenAI 사용 한도에 도달했습니다. 결제·사용량을 확인해주세요." : "OpenAI 요청 한도에 도달했습니다. 자동 재시도 후에도 계속되어 중단했습니다. 잠시 후 다시 시도해주세요.",
      503: "OpenAI 서버가 과부하 상태입니다. 자동으로 다시 시도했지만 계속 실패했습니다. 잠시 후 다시 시도해주세요." };
    throw new OpenAIError(message[response.status] || `OpenAI 서버 오류 (${response.status})${code ? ` · ${code}` : ""}. 자동 재시도 후에도 실패했습니다. 잠시 후 다시 시도해주세요.`, response.status, code);
  }
  const body = JSON.parse(rawBody);
  if (body.status === "incomplete") throw new Error("생성 응답이 완료되지 않았습니다. 더 간단한 장면으로 다시 시도해주세요.");
  const text: string = body.output?.flatMap((item: { content?: { type: string; text?: string }[] }) => item.content || []).filter((item: { type: string }) => item.type === "output_text").map((item: { text: string }) => item.text).join("");
  if (!text) throw new Error("모델이 결과를 반환하지 않았습니다. 다른 이미지나 설명으로 시도해주세요.");
  const output = intent.schema.parse(JSON.parse(text));
  return { text, result: intent.finalize ? intent.finalize(input, output) : output };
}
