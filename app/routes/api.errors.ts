import type { Route } from "./+types/api.errors";
import { clientErrorSchema, logError } from "../server/error-log.server";

/** Errors seen in the browser (sketch runtime, on-screen messages) are written to error-logs/. */
export async function action({ request }: Route.ActionArgs) {
  const headers = { "Cache-Control": "no-store" };
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405, headers });
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return Response.json({ error: "This request is not allowed." }, { status: 403, headers });
  const raw = await request.text();
  if (raw.length > 200_000) return Response.json({ error: "The error log is too large." }, { status: 413, headers });
  let parsed;
  try { parsed = clientErrorSchema.safeParse(JSON.parse(raw)); } catch { return Response.json({ error: "The error log format is invalid." }, { status: 400, headers }); }
  if (!parsed.success) return Response.json({ error: "The error log format is invalid." }, { status: 400, headers });
  const key = await logError(parsed.data);
  return Response.json({ logged: key }, { status: key ? 200 : 500, headers });
}
