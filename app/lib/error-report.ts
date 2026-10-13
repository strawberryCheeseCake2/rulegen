// Browser side of error-logs/: errors shown in the studio are sent to /api/errors.
// Messages the server has already logged (AI, code checks) are skipped once.

const serverLogged = new Set<string>();
/** The server logged this error itself (its response carried `logged`). */
export function markLogged(message: string) {
  serverLogged.add(message);
  if (serverLogged.size > 50) serverLogged.delete(serverLogged.values().next().value!);
}
export type ClientError = { source: "runtime" | "ui"; message: string; owner?: string; frame?: string; code?: string };
export function reportError(entry: ClientError) {
  if (!entry.message || serverLogged.delete(entry.message)) return;
  if (typeof fetch !== "function" || typeof window === "undefined") return;
  const body = { ...entry, message: entry.message.slice(0, 4000), code: (entry.code || "").slice(0, 120000), url: window.location.pathname, userAgent: navigator.userAgent.slice(0, 500) };
  void fetch("/api/errors", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => {});
}
