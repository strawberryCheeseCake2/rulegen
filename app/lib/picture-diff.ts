// What changed between two pictures of the same canvas (two moments of execution, or the picture as it is and with
// something changed): where there is more ink, and where there is less, as a transparent picture drawn over it.

export type Rgb = [number, number, number];
/** Ink at a pixel: how dark it is (0 white or transparent … 255 black). */
const ink = (data: Uint8ClampedArray, i: number) => (255 - (data[i] * .299 + data[i + 1] * .587 + data[i + 2] * .114)) * data[i + 3] / 255;

/**
 * Into `out` (RGBA, the same size): `added` where `after` has more ink than `before`, `removed` where it has less,
 * transparent elsewhere; a change under `threshold` is none. Both are thickened by `grow` pixels so a thin line
 * changed stands out. Returns how many pixels changed each way (before thickening).
 */
export function diffPixels(before: Uint8ClampedArray, after: Uint8ClampedArray, width: number, height: number, out: Uint8ClampedArray,
  colors: { added: Rgb; removed: Rgb }, threshold = 28, grow = 1) {
  const n = width * height, more = new Uint8Array(n), less = new Uint8Array(n);
  let added = 0, removed = 0;
  for (let p = 0; p < n; p++) {
    const d = ink(after, p * 4) - ink(before, p * 4);
    if (d > threshold) { more[p] = Math.min(255, 90 + d); added++; }
    else if (d < -threshold) { less[p] = Math.min(255, 90 - d); removed++; }
  }
  const thick = (mask: Uint8Array) => {
    if (grow < 1) return mask;
    const wide = new Uint8Array(n);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      let top = 0;
      for (let dy = -grow; dy <= grow; dy++) { const yy = y + dy; if (yy < 0 || yy >= height) continue;
        for (let dx = -grow; dx <= grow; dx++) { const xx = x + dx; if (xx < 0 || xx >= width) continue; const v = mask[yy * width + xx]; if (v > top) top = v; } }
      wide[y * width + x] = top;
    }
    return wide;
  };
  const a = thick(more), r = thick(less);
  for (let p = 0; p < n; p++) {
    const [color, alpha] = a[p] >= r[p] ? [colors.added, a[p]] : [colors.removed, r[p]];
    out[p * 4] = color[0]; out[p * 4 + 1] = color[1]; out[p * 4 + 2] = color[2]; out[p * 4 + 3] = alpha;
  }
  return { added, removed };
}

/** The change from one picture (a data URL) to another, as a transparent picture (a data URL) to draw over them; null when it cannot be made. */
export async function pictureDiff(before: string, after: string, colors: { added: Rgb; removed: Rgb }) {
  if (typeof document === "undefined" || !before || !after) return null;
  try {
    const load = async (src: string) => { const image = new Image(); image.src = src; await image.decode(); return image; };
    const [one, two] = await Promise.all([load(before), load(after)]);
    // Worked out at most 900 px wide (enough to see; fast), the second picture's shape.
    const scale = Math.min(1, 900 / Math.max(1, two.naturalWidth)), width = Math.max(1, Math.round(two.naturalWidth * scale)), height = Math.max(1, Math.round(two.naturalHeight * scale));
    const read = (image: HTMLImageElement) => { const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!; ctx.drawImage(image, 0, 0, width, height); return ctx.getImageData(0, 0, width, height); };
    const a = read(one), b = read(two), canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext("2d")!, out = ctx.createImageData(width, height);
    const counts = diffPixels(a.data, b.data, width, height, out.data, colors);
    ctx.putImageData(out, 0, 0);
    return { image: canvas.toDataURL("image/png"), ...counts };
  } catch { return null; }
}
