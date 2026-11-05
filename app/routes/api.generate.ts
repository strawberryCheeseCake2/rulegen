import type { Route } from "./+types/api.generate";
import { requestSchema, MAX_CODE_LENGTH } from "../lib/schema";
import { runAI, configuration } from "../server/ai.server";
import { prepareCode } from "../server/code.server";
import { recoveryContextSchema } from "../lib/generation-recovery";
import { errorDetails, logError } from "../server/error-log.server";
export function loader() { return Response.json(configuration()); }
export async function action({ request }: Route.ActionArgs) {
  const headers = { "Cache-Control": "no-store" };
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405, headers });
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return Response.json({ error: "This request is not allowed." }, { status: 403, headers });
  try {
    if (Number(request.headers.get("content-length")) > 64_000_000) throw new Error("The project and images are too large.");
    const raw = await request.text();
    if (raw.length > 64_000_000) throw new Error("The project and images are too large.");
    const parsed = JSON.parse(raw);
    if (parsed.intent === "prepare") {
      if (typeof parsed.code !== "string" || parsed.code.length > MAX_CODE_LENGTH) throw new Error("The code is too long or malformed.");
      try { return Response.json({ executable: prepareCode(parsed.code) }, { headers }); }
      catch (error) { const logged = await logError({ source: "prepare", ...errorDetails(error), code: parsed.code }); return Response.json({ error: (error as Error).message, logged }, { status: 400, headers }); }
    }
    const checked = requestSchema.safeParse(parsed);
    if (!checked.success) { const logged = await logError({ source: "server", message: "The request format is invalid.", intent: String(parsed?.intent ?? ""), detail: checked.error.issues.slice(0, 20) }); return Response.json({ error: "The request format is invalid.", logged }, { status: 400, headers }); }
    const context = parsed.recoveryContext === undefined ? undefined : recoveryContextSchema.parse(parsed.recoveryContext);
    try { return Response.json(await runAI(checked.data, request.signal, context), { headers }); }
    // runAI has already written the error log.
    catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Could not process the request.", logged: true }, { status: 400, headers }); }
  } catch (error) {
    const logged = await logError({ source: "server", ...errorDetails(error) });
    return Response.json({ error: error instanceof Error ? error.message : "Could not process the request.", logged }, { status: 400, headers });
  }
}
