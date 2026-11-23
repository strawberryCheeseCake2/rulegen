import { useEffect, useState } from "react";
import { MANIP_HOST } from "../lib/execution/manipulate";
import { sandboxRunner } from "../lib/execution/sandbox";
import { drawingKey, sketchInput, type ClarifyDrawing, type SketchClarifyState } from "../lib/sketch-clarify";

// The in-situ drawings of a clarification's choice options (their logic drawn over the sketch, with notes), drawn in
// the isolated worker the direct manipulation tools draw their previews in, at the canvas's own size so a drawing
// lies over the frame as it is. Drawn again for each stage; kept only while it is open.

const SIZE = { w: 900, h: 600 };
let runner: ReturnType<typeof sandboxRunner> | null = null;
const sandbox = () => runner ??= sandboxRunner(MANIP_HOST);
const dataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob);
});

/** Each option's drawing in the current stage (by drawingKey; missing while it is drawn). */
export function useClarifyDrawings(open: SketchClarifyState | null): Record<string, ClarifyDrawing> {
  // Answering keeps the stage's questions as they are: only a new stage draws again.
  const stage = open?.stages.at(-1)?.questions;
  const [drawn, setDrawn] = useState<{ stage: unknown; drawings: Record<string, ClarifyDrawing> }>({ stage: null, drawings: {} });
  useEffect(() => {
    if (!stage) return;
    let live = true;
    const data = sketchInput(open?.strokes);
    setDrawn({ stage, drawings: {} });
    void (async () => {
      for (const question of stage) for (const option of question.options) {
        if (!option.sketch) continue;
        let drawing: ClarifyDrawing;
        try {
          const reply = await sandbox().run({ kind: "thumbnail", code: option.sketch, input: { ...SIZE, data } });
          drawing = reply.blob instanceof Blob
            ? { src: reply.empty ? "" : await dataUrl(reply.blob), note: reply.empty ? "The drawing came out empty." : "" }
            : { src: "", note: `Could not be drawn: ${String(reply.error ?? "no image")}` };
        } catch (error) { drawing = { src: "", note: `Could not be drawn: ${error instanceof Error ? error.message : String(error)}` }; }
        if (!live) return;
        setDrawn(current => current.stage === stage ? { stage, drawings: { ...current.drawings, [drawingKey(question.id, option.id)]: drawing } } : current);
      }
    })();
    return () => { live = false; };
    // The strokes come with the stage (kept with it when asked): a new stage is what draws again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);
  return drawn.stage === stage ? drawn.drawings : {};
}
