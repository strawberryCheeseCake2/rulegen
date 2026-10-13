import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

// Every error the studio shows or the server hits, one JSON file each:
// error-logs/<UTC date>/<timestamp>-<source>-<id>.json. AI failures also keep
// their full request/response in ai-generations/ (see `generation`).

export const errorLogRoot = () => path.resolve(process.env.RULEGEN_ERROR_LOG_DIR || "error-logs");

export const ERROR_SOURCES = ["ai", "prepare", "runtime", "ui", "server"] as const;
/** What the browser may report (AI and prepare errors are logged by the server itself). */
export const clientErrorSchema = z.object({
  source: z.enum(["runtime", "ui"]), message: z.string().min(1).max(4000),
  owner: z.string().max(80).default(""), frame: z.string().max(200).default(""),
  /** The program that failed, for runtime errors. */
  code: z.string().max(120000).default(""),
  url: z.string().max(2000).default(""), userAgent: z.string().max(500).default(""),
});
export type ErrorEntry = {
  source: (typeof ERROR_SOURCES)[number]; message: string;
  intent?: string; model?: string; status?: number; providerCode?: string; generation?: string;
  owner?: string; frame?: string; code?: string; stack?: string; detail?: unknown; url?: string; userAgent?: string;
};

const secrets = () => [process.env.OPENAI_API_KEY].filter((value): value is string => Boolean(value && value.length > 8));
/** No keys, no embedded images. */
function sanitize(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value ?? null, (_key, item) => typeof item === "string"
    ? secrets().reduce((text, secret) => text.split(secret).join("[redacted]"), item.replace(/data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]+/g, match => `[image ${match.length} chars omitted]`))
    : item));
}

/** Never throws: a failing log must not hide the original error. Returns the log key or null. */
export async function logError(entry: ErrorEntry): Promise<string | null> {
  try {
    const at = new Date(), stamp = at.toISOString();
    const date = stamp.slice(0, 10), name = `${stamp.replace(/[:.]/g, "-")}-${entry.source}-${randomUUID().slice(0, 8)}.json`;
    const directory = path.join(errorLogRoot(), date);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(path.join(directory, name), JSON.stringify(sanitize({ at: stamp, ...entry }), null, 2), { mode: 0o600 });
    return `${date}/${name}`;
  } catch { return null; }
}
export const errorDetails = (error: unknown) => error instanceof Error ? { message: error.message, stack: error.stack } : { message: String(error) };
