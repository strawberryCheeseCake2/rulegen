import type { Route } from "./+types/api.generate";
import { requestSchema } from "../lib/schema";
import { runAI, configuration } from "../server/ai.server";
import { prepareCode } from "../server/code.server";
export function loader() { return Response.json(configuration()); }
export async function action({ request }: Route.ActionArgs) {
  const headers = { "Cache-Control": "no-store" };
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405, headers });
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return Response.json({ error: "허용되지 않은 요청입니다." }, { status: 403, headers });
  try {
    if (Number(request.headers.get("content-length")) > 9_000_000) throw new Error("이미지가 너무 큽니다.");
    const raw = await request.text();
    if (raw.length > 9_000_000) throw new Error("이미지가 너무 큽니다.");
    const parsed = JSON.parse(raw);
    if (parsed.intent === "prepare") {
      if (typeof parsed.code !== "string" || parsed.code.length > 200000) throw new Error("코드가 너무 길거나 형식이 올바르지 않습니다.");
      return Response.json({ executable: prepareCode(parsed.code) }, { headers });
    }
    const checked = requestSchema.safeParse(parsed);
    if (!checked.success) return Response.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400, headers });
    const result = await runAI(checked.data, request.signal);
    return Response.json(result, { headers });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "요청을 처리하지 못했습니다." }, { status: 400, headers });
  }
}
