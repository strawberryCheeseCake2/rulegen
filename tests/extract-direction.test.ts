import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("Extract takes the user's own direction: typed before the first extraction, sent with it, and followed by the prompt", () => {
  const home = readFileSync("app/routes/home.tsx", "utf8"), actions = readFileSync("app/studio/scene-actions.ts", "utf8"), prompt = readFileSync("prompts/extract.md", "utf8");
  assert.match(home, /<span>EXTRACTION DIRECTION <small>optional<\/small><\/span><textarea aria-label="Extraction direction"[^>]*value=\{panel\.instruction\}/, "an empty frame has a place to type it");
  assert.match(actions, /const instruction = \[deps\.panel\(owner\)\.instruction, clarified\]/, "the direction (with any clarified answers)…");
  assert.match(actions, /deps\.request\("extract", \{[^}]*instruction: instruction\.slice\(0, 6000\) \}/, "…is sent with the extraction");
  assert.match(prompt, /`instruction` \(may be empty\) is the user's own direction for this extraction/);
  assert.match(prompt, /it wins over FIDELITY for that point only/);
});
