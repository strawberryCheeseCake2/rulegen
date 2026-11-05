import { readFileSync } from "node:fs";
import path from "node:path";

// Prompts live as Markdown in /prompts so they can be read and edited directly.
// `{{include:contracts/name}}` pulls in a shared contract. Files are re-read on
// every request: editing a prompt takes effect without restarting the server.

export const promptRoot = () => path.resolve(process.env.RULEGEN_PROMPT_DIR || "prompts");

export function loadPrompt(name: string, depth = 0): string {
  if (!/^[a-z0-9-]+(\/[a-z0-9-]+)?$/.test(name)) throw new Error(`Invalid prompt name: ${name}`);
  let text: string;
  try { text = readFileSync(path.join(promptRoot(), `${name}.md`), "utf8"); }
  catch { throw new Error(`Could not read prompts/${name}.md.`); }
  return text.replace(/\{\{include:([a-z0-9/-]+)\}\}/g, (_, include: string) => {
    if (depth >= 3) throw new Error("Prompt includes are nested too deeply.");
    return loadPrompt(include, depth + 1);
  }).trim();
}
