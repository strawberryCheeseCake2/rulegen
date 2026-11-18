import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { z } from "zod";
import type { requestSchema } from "../lib/schema";
import { AIGenerationLog } from "./ai-log.server";
import { recoverGeneration, type RecoveryContext } from "../lib/generation-recovery";
import { intents, isIntent, outputSchema, type AIInput } from "./intents.server";
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
/** No data from OpenAI for this long is a stalled connection (it is retried); a call is never longer than `AI_LIMIT_MS`. */
const idleMs = () => Number(process.env.RULEGEN_AI_IDLE_MS ?? 90_000), AI_LIMIT_MS = 600_000;
/** A connection that stalled or dropped (not one the user canceled): retried like an overloaded server. */
class StalledError extends Error {}
/**
 * The response body: streamed, the final response of the stream (as the API returns it without streaming), with the
 * connection given up when nothing comes for `idleMs`; not streamed (an error, a test), as it is.
 */
async function readBody(response: Response, stall: AbortController) {
  if (!response.ok || !response.body || !response.headers.get("content-type")?.includes("text/event-stream")) return response.text();
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = "", final = "", timer: ReturnType<typeof setTimeout> | undefined;
  // Given up: the read waiting is ended too (whether or not the connection heeds the abort).
  stall.signal.addEventListener("abort", () => { reader.cancel(stall.signal.reason).catch(() => {}); }, { once: true });
  const watch = () => { clearTimeout(timer); timer = setTimeout(() => stall.abort(new StalledError(`OpenAI sent nothing for ${Math.round(idleMs() / 1000)}s`)), idleMs()); };
  try {
    for (watch(); ;) {
      const { done, value } = await reader.read();
      if (done) break;
      watch(); buffer += decoder.decode(value, { stream: true });
      for (let at = buffer.indexOf("\n\n"); at >= 0; at = buffer.indexOf("\n\n")) {
        const data = buffer.slice(0, at).split("\n").filter(line => line.startsWith("data:")).map(line => line.slice(5).trim()).join("\n");
        buffer = buffer.slice(at + 2);
        if (!data || data === "[DONE]") continue;
        const event = JSON.parse(data);
        if (event.type === "error") throw new StalledError(`OpenAI stream error${event.code ? ` · ${event.code}` : ""}: ${event.message ?? ""}`);
        if (["response.completed", "response.incomplete", "response.failed"].includes(event.type)) final = JSON.stringify(event.response);
      }
    }
  } catch (error) { throw stall.signal.aborted ? stall.signal.reason : error; } finally { clearTimeout(timer); }
  if (stall.signal.aborted) throw stall.signal.reason;
  if (!final) throw new StalledError("The OpenAI stream ended without a response");
  return final;
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
  const interaction = input.compositionPens.some(pen => pen.kind === "interaction") && ["compose-prompt", "extract", "compose", "state-machine", "machine-refine", "code"].includes(input.intent);
  const extra = intents[input.intent as keyof typeof intents]?.variant?.(input)?.prompts ?? [];
  return loadPrompt(input.intent) + (interaction ? `\n\n${loadPrompt("contracts/interaction")}` : "") + extra.map(name => `\n\n${loadPrompt(name)}`).join("");
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
  // Params' direct manipulation widgets are UI: their code never goes to the model with the scene.
  const content: object[] = [{ type: "input_text", text: JSON.stringify(intent.context(input), (key, value) => key === "handle" && value && typeof value === "object" && "prepared" in value ? undefined : value) }];
  if (input.intent === "clarification" && input.resultImage) content.push({ type: "input_text", text: "Clean generated result before annotation:" }, { type: "input_image", image_url: input.resultImage, detail: "high" }, { type: "input_text", text: "Same result with the user's coral annotation sketch:" });
  if (input.image) content.push({ type: "input_image", image_url: input.image, detail: "high" });
  if (input.intent === "machine-refine" && input.machineImage) content.push({ type: "input_text", text: "The target node's state machine graph as the user sees it (attached item outlined in orange, the user's annotation strokes in coral):" }, { type: "input_image", image_url: input.machineImage, detail: "high" });
  if (intent.strokes && input.compositionStrokes.length) content.push({ type: "input_text", text: JSON.stringify({ compositionPens: input.compositionPens, compositionStrokes: input.compositionStrokes, canvas: { width: 900, height: 600 } }) });
  return content;
}

type Message = { role: "user" | "assistant"; content: object[] | string };

async function runGeneration(input: AIInput, signal: AbortSignal, log: AIGenerationLog) {
  if (!process.env.OPENAI_API_KEY) throw new Error("Set OPENAI_API_KEY in the server's .env.local.");
  if (!isIntent(input.intent)) throw new Error("Unknown generation request.");
  if (inFlight >= 2) throw new Error("A request is in progress. Please try again in a moment.");
  const intent = intents[input.intent];
  const problem = intent.check?.(input);
  if (problem) throw new Error(problem);
  inFlight++;
  try {
    return (await respond(input, [{ role: "user", content: userContent(input) }], signal, log, 1)).result;
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) throw new Error("Could not parse the model response. Please generate again.", { cause: error });
    if (signal.aborted) throw new Error("The request was canceled.", { cause: error });
    if (error instanceof StalledError || (error instanceof Error && /timeout|abort|fetch failed/i.test(error.message))) throw new Error("OpenAI stopped responding, and automatic retries kept failing. Please try again in a moment.", { cause: error });
    throw error;
  } finally { inFlight--; }
}

const providerCode = (body: string) => { try { return String(JSON.parse(body)?.error?.code ?? ""); } catch { return ""; } };

/** One Responses API call → parsed, finalized result (and the raw text for a follow-up round). */
async function respond(input: AIInput, messages: Message[], signal: AbortSignal, log: AIGenerationLog, attempt: number) {
  const intent = intents[input.intent as keyof typeof intents];
  const model = configuration().model;
  const payload = { model, store: false, stream: true, instructions: instructionsFor(input), input: messages, max_output_tokens: intent.maxTokens(input),
    ...(/^gpt-[56]/.test(model) ? { reasoning: { effort: intent.effort || "low" } } : {}),
    text: { format: { type: "json_schema", name: `rulegen_${input.intent}`, strict: true, schema: outputSchema(input.intent as keyof typeof intents, input) } } };
  await log.prompt(payload, attempt);
  let response: Response, rawBody: string;
  // Transient provider failures (overload, 5xx, rate limit, a stalled or dropped connection) are retried with backoff.
  for (let retry = 0; ; retry++) {
    const stall = new AbortController(), waiting = setTimeout(() => stall.abort(new StalledError(`OpenAI did not answer for ${Math.round(idleMs() / 1000)}s`)), idleMs());
    try {
      response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST", headers: { "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
        signal: AbortSignal.any([signal, stall.signal, AbortSignal.timeout(AI_LIMIT_MS)]),
        body: JSON.stringify(payload),
      });
      clearTimeout(waiting);
      rawBody = await readBody(response, stall);
    } catch (caught) {
      clearTimeout(waiting);
      const error = stall.signal.aborted ? stall.signal.reason : caught;
      const stalled = !signal.aborted && (error instanceof StalledError || (error instanceof Error && /fetch failed|terminated|ECONNRESET|socket/i.test(error.message)));
      if (!stalled || retry >= RETRIES) throw error;
      await log.retried(attempt, retry + 1, 0, error instanceof Error ? error.message : String(error));
      await wait(retryDelay(retry + 1, null), signal);
      continue;
    }
    if (response.ok || retry >= RETRIES || !isTransient(response.status, providerCode(rawBody))) break;
    await log.retried(attempt, retry + 1, response.status, rawBody);
    await wait(retryDelay(retry + 1, response.headers.get("retry-after")), signal);
  }
  await log.response(response, rawBody, attempt);
  if (!response.ok) {
    const code = providerCode(rawBody);
    const message: Record<number, string> = { 400: "The model does not support images or structured output, or the request format is invalid. Check OPENAI_MODEL.", 401: "Check your OpenAI API key.", 403: "This API key does not have access to the model.", 404: `The configured model ${model} is not available. Check OPENAI_MODEL.`,
      429: code === "insufficient_quota" ? "The OpenAI usage quota has been reached. Check your billing and usage." : "The OpenAI rate limit was reached and persisted after automatic retries, so the request was stopped. Please try again in a moment.",
      503: "The OpenAI server is overloaded. Automatic retries kept failing. Please try again in a moment." };
    throw new OpenAIError(message[response.status] || `OpenAI server error (${response.status})${code ? ` · ${code}` : ""}. It still failed after automatic retries. Please try again in a moment.`, response.status, code);
  }
  const body = JSON.parse(rawBody);
  if (body.status === "failed") throw new Error(`The generation failed at OpenAI${body.error?.message ? `: ${body.error.message}` : ""}. Please try again.`);
  if (body.status === "incomplete") throw new Error("The generation response was incomplete. Please try again with a simpler scene.");
  const text: string = body.output?.flatMap((item: { content?: { type: string; text?: string }[] }) => item.content || []).filter((item: { type: string }) => item.type === "output_text").map((item: { text: string }) => item.text).join("");
  if (!text) throw new Error("The model returned no result. Try a different image or description.");
  const output = (intent.variant?.(input)?.schema ?? intent.schema).parse(JSON.parse(text));
  return { text, result: intent.finalize ? intent.finalize(input, output) : output };
}
