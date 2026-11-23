import { useEffect, useRef, useState } from "react";
import { CodePreview, type RestorePoint } from "./code-preview";
import type { ExecStep } from "../lib/execution/trace";

// Thumbnails of recorded steps: the result as execution had drawn it at each step. One hidden preview draws the
// wanted steps one at a time (held at the step, as the Execution frame does) and keeps a small image of each.

const WIDTH = 240, HEIGHT = 160, TIMEOUT = 4000, MAX_KEPT = 600;
/** A step's thumbnail key: the same step of the same cycle draws the same picture. */
export const thumbKey = (step: Pick<ExecStep, "cycle" | "index">) => `${step.cycle}:${step.index}`;

function shrink(image: string) {
  return new Promise<string>(resolve => {
    const source = new Image();
    source.onload = () => {
      const canvas = document.createElement("canvas"); canvas.width = WIDTH; canvas.height = HEIGHT;
      const context = canvas.getContext("2d");
      if (!context) { resolve(""); return; }
      context.fillStyle = "#fff"; context.fillRect(0, 0, WIDTH, HEIGHT);
      context.drawImage(source, 0, 0, WIDTH, HEIGHT);
      resolve(canvas.toDataURL("image/jpeg", .7));
    };
    source.onerror = () => resolve("");
    source.src = image;
  });
}

/**
 * Thumbnails (by thumbKey; "" when it could not be drawn) of `wanted`, nearest first, drawn from `executable`.
 * They start over when the code changes or the record is cleared.
 */
export function useStepThumbnails(executable: string, wanted: ExecStep[], restoreOf: (step: ExecStep) => RestorePoint | null, cleared = false) {
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [held, setHeld] = useState<{ key: string; point: RestorePoint } | null>(null);
  // The preview draws the held step and captures it, then reports it drawn: the capture just before is its picture.
  const captured = useRef(""), last = useRef<RestorePoint | null>(null);
  useEffect(() => { setThumbs({}); setHeld(null); }, [executable]);
  // A cleared record numbers its steps from the start again: the old pictures are not theirs.
  useEffect(() => { if (cleared) { setThumbs({}); setHeld(null); } }, [cleared]);
  // The next wanted step without a thumbnail is held in the hidden preview.
  useEffect(() => {
    if (held || !executable) return;
    for (const step of wanted) {
      const key = thumbKey(step);
      if (key in thumbs) continue;
      const point = restoreOf(step);
      if (!point) { setThumbs(current => ({ ...current, [key]: "" })); return; }
      setHeld({ key, point: { ...point, id: `thumb-${point.id}` } });
      return;
    }
  }, [held, wanted, thumbs, executable, restoreOf]);
  const done = (key: string, src: string) => {
    setThumbs(current => {
      const next = { ...current, [key]: src }, keys = Object.keys(next);
      for (const old of keys.slice(0, Math.max(0, keys.length - MAX_KEPT))) delete next[old];
      return next;
    });
    setHeld(current => current?.key === key ? null : current);
  };
  // A step that never draws (an error, a stalled sketch) is given up on.
  useEffect(() => {
    if (!held) return;
    const timer = setTimeout(() => done(held.key, ""), TIMEOUT);
    return () => clearTimeout(timer);
  }, [held]);
  if (held) last.current = held.point;
  // Kept loaded between steps (only the held step changes), so each step is one redraw, not a reload.
  const renderer = executable && wanted.length > 0 && last.current ? <div className="step-thumbnailer" aria-hidden="true">
    <CodePreview executable={executable} playing={false} restore={held?.point ?? last.current} onError={() => { if (held) done(held.key, ""); }}
      onCapture={image => { captured.current = image; }}
      onDrawn={id => { if (!held || id !== held.point.id) return; const key = held.key, image = captured.current; captured.current = "";
        if (image) void shrink(image).then(src => done(key, src)); else done(key, ""); }} />
  </div> : null;
  return { thumbs, renderer };
}
