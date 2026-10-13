// Writes the exact structured-output JSON schema of every AI intent to prompts/schemas/<intent>.json.
// Run with `npm run prompts:schemas` after changing a schema; tests fail when the files are stale.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { intents, outputSchema, type IntentName } from "../app/server/intents.server";
import { promptRoot } from "../app/server/prompts.server";

export const schemaFile = (intent: string) => path.join(promptRoot(), "schemas", `${intent}.json`);
export const schemaText = (intent: IntentName) => `${JSON.stringify(outputSchema(intent), null, 2)}\n`;
if (process.argv[1]?.endsWith("prompt-schemas.ts")) {
  for (const intent of Object.keys(intents) as IntentName[]) writeFileSync(schemaFile(intent), schemaText(intent));
  console.log(`Wrote ${Object.keys(intents).length} schemas to prompts/schemas`);
}
