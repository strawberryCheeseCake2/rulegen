import { readFileSync } from "node:fs";
import path from "node:path";

// Prompts live as Markdown in /prompts so they can be read and edited directly.
// `{{include:contracts/name}}` pulls in a shared contract. Files are re-read on
// every request: editing a prompt takes effect without restarting the server.

export const promptRoot = () => path.resolve(process.env.RULEGEN_PROMPT_DIR || "prompts");

export function loadPrompt(name: string, depth = 0): string {
  if (!/^[a-z0-9-]+(\/[a-z0-9-]+)?$/.test(name)) throw new Error(`올바르지 않은 prompt 이름: ${name}`);
  let text: string;
  try { text = readFileSync(path.join(promptRoot(), `${name}.md`), "utf8"); }
  catch { throw new Error(`prompts/${name}.md 파일을 읽지 못했습니다.`); }
  return text.replace(/\{\{include:([a-z0-9/-]+)\}\}/g, (_, include: string) => {
    if (depth >= 3) throw new Error("prompt include가 너무 깊게 중첩되었습니다.");
    return loadPrompt(include, depth + 1);
  }).trim();
}
