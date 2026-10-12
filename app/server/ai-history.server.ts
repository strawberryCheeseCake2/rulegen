import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import "./ai.server"; // Load the configured log destination from server env files.
import { aiLogRoot } from "./ai-log.server";
import { requestSchema } from "../lib/schema";
import { recoverGeneration, recoveredGenerationSchema, recoveryContextSchema } from "../lib/generation-recovery";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const idPattern = /^[a-zA-Z0-9-]{1,180}$/;
export type GenerationSummary = { key: string; intent: string; model: string; startedAt: string; status: string; durationMs?: number };
async function safeFile(directory: string, name: string) {
  const target = path.join(directory, name);
  const info = await lstat(target);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 64_000_000) throw new Error("올바른 로그 파일이 아닙니다.");
  return readFile(target);
}
async function json(directory: string, name: string) { return JSON.parse((await safeFile(directory, name)).toString("utf8")); }
async function optionalJson(directory: string, name: string) {
  try { return await json(directory, name); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}
async function logDirectory(key: string) {
  const parts = key.split("/");
  if (parts.length !== 2 || !datePattern.test(parts[0]) || !idPattern.test(parts[1])) throw new Error("올바른 로그 ID가 아닙니다.");
  const root = await realpath(aiLogRoot());
  const directory = path.join(root, ...parts);
  if (await realpath(directory) !== directory) throw new Error("로그 폴더 밖의 파일은 열 수 없습니다.");
  return directory;
}
export async function listGenerations(cursor = "") {
  const root = aiLogRoot();
  let dates;
  try { dates = await readdir(root, { withFileTypes: true }); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { entries: [], nextCursor: null }; throw error; }
  const keys: string[] = [];
  for (const date of dates.filter(item => item.isDirectory() && datePattern.test(item.name)).sort((a, b) => b.name.localeCompare(a.name))) {
    const folders = await readdir(path.join(root, date.name), { withFileTypes: true });
    for (const folder of folders.filter(item => item.isDirectory() && idPattern.test(item.name)).sort((a, b) => b.name.localeCompare(a.name))) {
      const key = `${date.name}/${folder.name}`;
      if (!cursor || key < cursor) keys.push(key);
      if (keys.length >= 51) break;
    }
    if (keys.length >= 51) break;
  }
  const entries: GenerationSummary[] = [];
  for (const key of keys.slice(0, 50)) {
    try { const log = await json(await logDirectory(key), "log.json"); entries.push({ key, intent: String(log.intent), model: String(log.model), startedAt: String(log.startedAt), status: String(log.status), durationMs: typeof log.durationMs === "number" ? log.durationMs : undefined }); }
    catch { /* Incomplete or damaged directories must not hide the rest of the history. */ }
  }
  return { entries, nextCursor: keys.length > 50 ? keys[49] : null };
}
async function hydrate(directory: string, value: unknown): Promise<unknown> {
  if (Array.isArray(value)) return Promise.all(value.map(item => hydrate(directory, item)));
  if (value && typeof value === "object") {
    const reference = value as Record<string, unknown>;
    if (typeof reference.file === "string" && typeof reference.mimeType === "string") {
      if (!/^image-\d+\.(png|jpg|webp)$/.test(reference.file) || !/^image\/(png|jpeg|webp)$/.test(reference.mimeType)) throw new Error("이미지 로그 형식이 올바르지 않습니다.");
      return `data:${reference.mimeType};base64,${(await safeFile(directory, reference.file)).toString("base64")}`;
    }
    return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, item]) => [key, await hydrate(directory, item)])));
  }
  return value;
}
export async function readGeneration(key: string) {
  const directory = await logDirectory(key);
  const metadata = await json(directory, "log.json");
  const result = await optionalJson(directory, "result.json");
  const error = await optionalJson(directory, "error.json");
  return { metadata, result, error };
}
export async function restoreGeneration(key: string) {
  const directory = await logDirectory(key);
  const metadata = await json(directory, "log.json");
  if (metadata.status !== "success") throw new Error("완료된 AI 생성만 복원할 수 있습니다.");
  const recovery = await optionalJson(directory, "recovery.json");
  if (recovery) return recoveredGenerationSchema.parse(await hydrate(directory, recovery));
  const rawInput = await hydrate(directory, await json(directory, "request.json")) as Record<string, unknown>;
  // Older releases generated creative code under this intent name.
  const input = requestSchema.parse({ ...rawInput, intent: rawInput.intent === "constraint-code" ? "code" : rawInput.intent });
  const context = await optionalJson(directory, "context.json");
  return recoverGeneration(input, await hydrate(directory, await json(directory, "result.json")), context ? recoveryContextSchema.parse(await hydrate(directory, context)) : undefined);
}
