import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Loaded before every test file. AI and error logs go to a folder of this test run (removed after it), never to the
// project's ai-generations / error-logs: those are the user's AI history. A test that wants its own folder sets it.
const logs = mkdtempSync(path.join(tmpdir(), "rulegen-test-logs-"));
process.env.RULEGEN_AI_LOG_DIR = path.join(logs, "ai");
process.env.RULEGEN_ERROR_LOG_DIR = path.join(logs, "errors");
process.on("exit", () => rmSync(logs, { recursive: true, force: true }));

// Loaded before every test file: tests must never reach the network (a real key may be in .env.local).
// Tests that exercise AI calls replace globalThis.fetch with a mock and restore this guard afterwards.
globalThis.fetch = async (input: string | URL | Request) => {
  throw new Error(`Network access is disabled in tests: ${input instanceof Request ? input.url : String(input)}`);
};
