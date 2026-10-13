import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RecoveryContext, RecoveredGeneration } from "../lib/generation-recovery";

export const aiLogRoot = () => path.resolve(process.env.RULEGEN_AI_LOG_DIR || "ai-generations");

type Status = "started" | "success" | "failed" | "cancelled";

/** Server-only, one durable directory per generation; never save request headers. */
export class AIGenerationLog {
  private readonly started = new Date();
  private readonly id: string;
  private readonly directory: string;
  private readonly images = new Map<string, string>();
  private readonly secrets = [process.env.OPENAI_API_KEY].filter((value): value is string => Boolean(value));
  private metadata: Record<string, unknown>;

  private constructor(intent: string, model: string) {
    const timestamp = this.started.toISOString();
    this.id = `${timestamp.replace(/[:.]/g, "-")}-${intent}-${randomUUID()}`;
    const root = aiLogRoot();
    this.directory = path.join(root, timestamp.slice(0, 10), this.id);
    this.metadata = { id: this.id, intent, model, startedAt: timestamp, status: "started" satisfies Status };
  }

  /** `<date>/<id>`, the key AI history uses. */
  get key() { return `${this.started.toISOString().slice(0, 10)}/${this.id}`; }

  /** Transient provider failures that were retried, kept beside the final response. */
  async retried(attempt: number, retry: number, status: number, body: string) {
    await this.io(async () => {
      this.metadata.retries = [...(this.metadata.retries as unknown[] || []), { attempt, retry, status, at: new Date().toISOString() }];
      await this.file(`response-${attempt}-retry${retry}.txt`, this.redact(body));
      await this.json("log.json", this.metadata);
    });
  }

  static async start(intent: string, model: string, input: unknown, context?: RecoveryContext) {
    const log = new AIGenerationLog(intent, model);
    await log.io(async () => {
      await mkdir(log.directory, { recursive: true, mode: 0o700 });
      await log.json("log.json", log.metadata);
      await log.json("request.json", input);
      if (context) await log.json("context.json", context);
    });
    return log;
  }

  /** Later attempts (repair rounds) are kept next to the first: prompt-2.json, response-2.json … */
  private attemptName = (name: string, attempt: number) => attempt > 1 ? name.replace(/\.(\w+)$/, `-${attempt}.$1`) : name;

  async prompt(body: unknown, attempt = 1) { await this.io(() => this.json(this.attemptName("prompt.json", attempt), body)); }

  async response(response: Response, body: string, attempt = 1) {
    await this.io(async () => {
      this.metadata.httpStatus = response.status;
      this.metadata.openaiRequestId = response.headers.get("x-request-id");
      let parsed: unknown;
      try { parsed = JSON.parse(body); } catch { /* Preserve non-JSON provider responses too. */ }
      if (parsed !== undefined) {
        await this.json(this.attemptName("response.json", attempt), parsed);
        if (parsed && typeof parsed === "object") {
          const details = parsed as Record<string, unknown>;
          this.metadata.responseId = details.id;
          this.metadata.usage = details.usage;
        }
      } else await this.file(this.attemptName("response.txt", attempt), this.redact(body));
      await this.json("log.json", this.metadata);
    });
  }

  async success(result: unknown, recovery?: RecoveredGeneration) {
    await this.io(async () => {
      await this.json("result.json", result);
      if (recovery) await this.json("recovery.json", recovery);
      if (result && typeof result === "object" && "code" in result && typeof result.code === "string") {
        await this.file("generated.js", this.redact(result.code));
      }
      await this.finish("success");
    });
  }

  async failure(error: unknown, cancelled: boolean) {
    await this.io(async () => {
      await this.json("error.json", this.errorDetails(error));
      await this.finish(cancelled ? "cancelled" : "failed");
    });
  }

  private async finish(status: Status) {
    this.metadata = { ...this.metadata, status, finishedAt: new Date().toISOString(), durationMs: Date.now() - this.started.getTime() };
    await this.json("log.json", this.metadata);
  }

  private errorDetails(error: unknown, depth = 0): unknown {
    if (!(error instanceof Error)) return String(error);
    return { name: error.name, message: error.message, stack: error.stack, ...(error.cause && depth < 4 ? { cause: this.errorDetails(error.cause, depth + 1) } : {}) };
  }

  private redact(value: string) {
    for (const secret of this.secrets) value = value.replaceAll(secret, "[REDACTED]");
    return value.replace(/Bearer\s+[^\s"\\]+/gi, "Bearer [REDACTED]").replace(/\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}/g, "[REDACTED]");
  }

  private async sanitize(value: unknown): Promise<unknown> {
    if (typeof value === "string") {
      const image = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(value);
      if (!image) return this.redact(value);
      let filename = this.images.get(value);
      if (!filename) {
        filename = `image-${this.images.size + 1}.${image[1] === "jpeg" ? "jpg" : image[1]}`;
        this.images.set(value, filename);
        await this.file(filename, Buffer.from(image[2], "base64"));
      }
      return { file: filename, mimeType: `image/${image[1]}` };
    }
    if (Array.isArray(value)) return Promise.all(value.map(item => this.sanitize(item)));
    if (value && typeof value === "object") {
      const entries = await Promise.all(Object.entries(value).map(async ([key, item]) => [key, /^(?:authorization|api[_-]?key|openai_api_key)$/i.test(key) ? "[REDACTED]" : await this.sanitize(item)]));
      return Object.fromEntries(entries);
    }
    return value;
  }

  private async json(filename: string, value: unknown) {
    await this.file(filename, `${JSON.stringify(await this.sanitize(value), null, 2)}\n`);
  }

  private async file(filename: string, data: string | Buffer) {
    const target = path.join(this.directory, filename);
    const temporary = `${target}.${randomUUID()}.tmp`;
    await writeFile(temporary, data, { mode: 0o600 });
    await rename(temporary, target);
  }

  private async io(operation: () => Promise<void>) {
    try { await operation(); }
    catch (cause) { throw new Error("AI 생성 로그를 저장하지 못했습니다. 로그 폴더의 경로와 쓰기 권한을 확인해주세요.", { cause }); }
  }
}
