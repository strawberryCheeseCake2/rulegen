import { useEffect, useState } from "react";
import { MANIP_HOST } from "../lib/execution/manipulate";
import { sandboxRunner } from "../lib/execution/sandbox";
import type { RestructureOption } from "../lib/execution/sandbox-restructure";

// The previews of a mini sandbox's structural options, drawn in the isolated worker the direct manipulation tools
// draw theirs in, at the canvas's own size so each lies over the sandbox's picture. Drawn again for new options.

const SIZE = { w: 900, h: 600 };
let runner: ReturnType<typeof sandboxRunner> | null = null;
const sandbox = () => runner ??= sandboxRunner(MANIP_HOST);
const dataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob);
});
export type OptionThumb = { src: string; note: string };

/** Each option's preview (by option id; missing while it is drawn). */
export function useRestructureThumbs(options: RestructureOption[] | undefined): Record<string, OptionThumb> {
  const [drawn, setDrawn] = useState<{ options: unknown; thumbs: Record<string, OptionThumb> }>({ options: null, thumbs: {} });
  useEffect(() => {
    if (!options?.length) return;
    let live = true;
    setDrawn({ options, thumbs: {} });
    void (async () => {
      for (const option of options) {
        let thumb: OptionThumb;
        if (!option.thumbnail) thumb = { src: "", note: "No preview." };
        else try {
          const reply = await sandbox().run({ kind: "thumbnail", code: option.thumbnail, input: { ...SIZE, data: { width: SIZE.w, height: SIZE.h } } });
          thumb = reply.blob instanceof Blob
            ? { src: reply.empty ? "" : await dataUrl(reply.blob), note: reply.empty ? "The preview came out empty." : "" }
            : { src: "", note: `The preview could not be drawn: ${String(reply.error ?? "no image")}` };
        } catch (error) { thumb = { src: "", note: `The preview could not be drawn: ${error instanceof Error ? error.message : String(error)}` }; }
        if (!live) return;
        setDrawn(current => current.options === options ? { options, thumbs: { ...current.thumbs, [option.id]: thumb } } : current);
      }
    })();
    return () => { live = false; };
  }, [options]);
  return drawn.options === options ? drawn.thumbs : {};
}
