import type { Route } from "./+types/api.errors";
import { clientErrorSchema, logError } from "../server/error-log.server";

/** Errors seen in the browser (sketch runtime, on-screen messages) are written to error-logs/. */
export async function action({ request }: Route.ActionArgs) {
  const headers = { "Cache-Control": "no-store" };
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405, headers });
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return Response.json({ error: "허용되지 않은 요청입니다." }, { status: 403, headers });
  const raw = await request.text();
  if (raw.length > 200_000) return Response.json({ error: "오류 기록이 너무 큽니다." }, { status: 413, headers });
  let parsed;
  try { parsed = clientErrorSchema.safeParse(JSON.parse(raw)); } catch { return Response.json({ error: "오류 기록 형식이 올바르지 않습니다." }, { status: 400, headers }); }
  if (!parsed.success) return Response.json({ error: "오류 기록 형식이 올바르지 않습니다." }, { status: 400, headers });
  const key = await logError(parsed.data);
  return Response.json({ logged: key }, { status: key ? 200 : 500, headers });
}
