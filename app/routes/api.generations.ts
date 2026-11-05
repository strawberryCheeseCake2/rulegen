import type { Route } from "./+types/api.generations";
import { listGenerations, readGeneration, restoreGeneration } from "../server/ai-history.server";

export async function loader({ request }: Route.LoaderArgs) {
  const headers = { "Cache-Control": "no-store" };
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin) return Response.json({ error: "This request is not allowed." }, { status: 403, headers });
  try {
    const key = url.searchParams.get("key");
    const data = key ? url.searchParams.get("restore") === "1" ? await restoreGeneration(key) : await readGeneration(key) : await listGenerations(url.searchParams.get("cursor") || "");
    return Response.json(data, { headers });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not open the AI log." }, { status: 400, headers });
  }
}
