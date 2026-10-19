import { sceneStructureKey } from "./scene/machines";

// Prepared programs (the server's execution guard) by structure: programs that
// differ only in their host values share one executable, so a frame can start
// running a program prepared ahead of time (e.g. a brush about to be added).

const MAX = 24;
const cache = new Map<string, string>(), pending = new Map<string, Promise<string>>();

/** An executable already prepared for this program's structure. */
export const preparedFor = (code: string) => cache.get(sceneStructureKey(code));
export function rememberPrepared(code: string, executable: string) {
  const key = sceneStructureKey(code);
  cache.delete(key); cache.set(key, executable);
  while (cache.size > MAX) cache.delete(cache.keys().next().value!);
}
/** Prepare a program on the server once per structure (concurrent requests share one). */
export function prepareProgram(code: string): Promise<string> {
  const key = sceneStructureKey(code), ready = cache.get(key);
  if (ready) return Promise.resolve(ready);
  const running = pending.get(key);
  if (running) return running;
  const request = fetch("/api/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ intent: "prepare", code }) })
    .then(async response => { const result = await response.json(); if (!response.ok || result.error) throw new Error(result.error || "코드를 실행하지 못했습니다."); rememberPrepared(code, result.executable); return result.executable as string; })
    .finally(() => pending.delete(key));
  pending.set(key, request);
  return request;
}
