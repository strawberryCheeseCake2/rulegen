import { useEffect, useRef, useState } from "react";
import type { TagWidget } from "../lib/alignment";
import { tagWidgetDocument, type WidgetWorld } from "../lib/tag-widget-runtime";

/** Canvas pixels per screen pixel of a box showing the 900 px wide canvas (the board may be zoomed). */
export const canvasPerScreen = (width: number) => Math.round(900 / Math.max(1, width) * 100) / 100;

/**
 * A tag's widget over the frame's picture: AI's code runs in an isolated iframe (reloaded only when the widget itself
 * changes; what it reads is sent in). While it is open, the picture's input goes to it: pointer and wheel are posted in
 * from a layer over the iframe (a sandboxed iframe is not always hit by the pointer). It is told how big a screen pixel is
 * on the canvas (`px`), so what it draws stays grabbable and readable however the board is zoomed.
 */
export function TagWidgetLayer({ widget, world: given, disabled = false, onValues, onError }: { widget: TagWidget; world: Omit<WidgetWorld, "px">; disabled?: boolean;
  /** The widget set some of its values (kept to their params). */
  onValues: (values: Record<string, number | string | boolean>) => void;
  onError: (message: string) => void }) {
  const frame = useRef<HTMLIFrameElement>(null), stage = useRef<HTMLDivElement>(null), token = useRef(""), ready = useRef(false);
  const [px, setPx] = useState(1), world: WidgetWorld = { ...given, px };
  // Measured after every render (a zoom of the board renders the frame again).
  useEffect(() => { const width = stage.current?.getBoundingClientRect().width; if (width) { const next = canvasPerScreen(width); if (next !== px) setPx(next); } });
  const current = useRef({ world, onValues, onError }); current.current = { world, onValues, onError };
  const [document, setDocument] = useState("");
  const structure = JSON.stringify([widget.id, widget.prepared, widget.params]), seen = JSON.stringify(world);
  const post = (message: Record<string, unknown>) => { if (ready.current) frame.current?.contentWindow?.postMessage({ channel: "rulegen-widget-control", token: token.current, ...message }, "*"); };
  useEffect(() => post({ type: "world", world: JSON.parse(seen) }), [seen]);
  useEffect(() => {
    const next = crypto.randomUUID(); token.current = next; ready.current = false;
    setDocument(tagWidgetDocument(next, window.location.origin, widget.prepared, widget.params, current.current.world));
    const receive = (event: MessageEvent) => {
      const data = event.data;
      if (event.source !== frame.current?.contentWindow || data?.channel !== "rulegen-widget" || data.token !== next) return;
      if (data.type === "ready") { ready.current = true; post({ type: "world", world: current.current.world }); return; }
      if (data.type === "set" && data.values && typeof data.values === "object") current.current.onValues(Object.fromEntries(Object.entries(data.values as Record<string, unknown>)
        .filter((entry): entry is [string, number | string | boolean] => ["number", "string", "boolean"].includes(typeof entry[1]))));
      if (data.type === "error" && typeof data.error === "string") current.current.onError(data.error.slice(0, 300));
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [structure]);
  const forward = (kind: "down" | "move" | "up" | "leave", e: React.PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    post({ type: "pointer", kind, x: (e.clientX - box.left) * 900 / Math.max(1, box.width), y: (e.clientY - box.top) * 600 / Math.max(1, box.height) });
  };
  return <div ref={stage} className={`tag-widget-stage ${disabled ? "off" : ""}`}>
    <iframe ref={frame} className="tag-widget-engine" title="Tag widget" sandbox="allow-scripts" srcDoc={document} tabIndex={-1} />
    <div className="tag-widget-input" aria-label={`Widget: ${widget.hint || widget.reading}`} title={widget.hint}
      onPointerDown={e => { if (disabled || e.button !== 0) return; e.preventDefault(); e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); forward("down", e); }}
      onPointerMove={e => { e.stopPropagation(); forward("move", e); }} onPointerUp={e => { e.stopPropagation(); forward("up", e); }} onPointerCancel={e => forward("up", e)} onPointerLeave={e => forward("leave", e)}
      onWheel={e => { if (!disabled) { e.stopPropagation(); post({ type: "wheel", delta: e.deltaY }); } }} />
  </div>;
}
