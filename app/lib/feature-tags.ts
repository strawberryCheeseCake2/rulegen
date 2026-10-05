import { ART_WIDTH, ART_HEIGHT, type Feature } from "./schema";
export type TagBox = { x: number; y: number; width: number; height: number };
export type FeatureTag = TagBox & { feature: Feature; index: number; compact: boolean; cx: number; cy: number };
const gap = 6;
export function tagsOverlap(a: TagBox, b: TagBox, padding = gap) {
  return a.x < b.x + b.width + padding && a.x + a.width + padding > b.x && a.y < b.y + b.height + padding && a.y + a.height + padding > b.y;
}
// Work in screen pixels: tags stay readable and their spacing stays consistent through zoom.
export function layoutFeatureTags(features: Feature[], zoom: number, selected: string | null): FeatureTag[] {
  const frameWidth = ART_WIDTH * zoom, frameHeight = ART_HEIGHT * zoom;
  const placed: TagBox[] = [];
  const tags = features.map((feature, index) => {
    const r = feature.region, compact = zoom < .65 && selected !== feature.id;
    const compactSize = Math.min(28, Math.floor((frameHeight - 32 - gap * 4) / 2));
    const width = compact ? compactSize : Math.min(196, frameWidth - 12), height = compact ? compactSize : 32;
    const cx = (r.x + r.w / 2) * frameWidth, cy = (r.y + r.h / 2) * frameHeight;
    const clampX = (x: number) => Math.max(gap, Math.min(frameWidth - width - gap, x));
    const clampY = (y: number) => Math.max(gap, Math.min(frameHeight - height - gap, y));
    const idealX = clampX(cx - width / 2);
    const above = r.y * frameHeight - height - gap;
    const idealY = clampY(above >= gap ? above : (r.y + r.h) * frameHeight + gap);
    const xs = [idealX, cx - width / 2, r.x * frameWidth - width - gap, (r.x + r.w) * frameWidth + gap, gap, frameWidth - width - gap, ...placed.flatMap(p => [p.x - width - gap, p.x + p.width + gap])];
    const ys = [idealY, cy - height / 2, above, (r.y + r.h) * frameHeight + gap, gap, frameHeight - height - gap, ...placed.flatMap(p => [p.y - height - gap, p.y + p.height + gap])];
    function candidates(inside: boolean) {
      const candidates: TagBox[] = [];
      for (const x of new Set(xs.map(x => inside ? clampX(x) : x))) for (const y of new Set(ys.map(y => inside ? clampY(y) : y))) {
        const box = { x, y, width, height };
        if (!placed.some(p => tagsOverlap(box, p))) candidates.push(box);
      }
      return candidates.sort((a, b) => Math.hypot(a.x - idealX, a.y - idealY) - Math.hypot(b.x - idealX, b.y - idealY));
    }
    // If greedy placement runs out of room, the row layout below repositions all tags.
    const fallback = { x: idealX, y: Math.max(frameHeight, ...placed.map(p => p.y + p.height)) + gap, width, height };
    const box = candidates(true)[0] || candidates(false)[0] || fallback;
    placed.push(box);
    return { ...box, feature, index, compact, cx, cy };
  });
  if (tags.every(t => t.x >= gap && t.y >= gap && t.x + t.width <= frameWidth - gap && t.y + t.height <= frameHeight - gap)) return tags;
  // A dense cluster at a frame edge can exhaust greedy placement despite having room.
  // Pack rows within the sketch so no tag gets clipped, keeping feature anchors unchanged.
  const rows: FeatureTag[][] = [[]];
  for (const tag of [...tags].sort((a, b) => Number(b.feature.id === selected) - Number(a.feature.id === selected))) {
    let row = rows[rows.length - 1];
    if (row.length && row.reduce((total, t) => total + t.width + gap, 0) + tag.width > frameWidth - gap * 2) { row = []; rows.push(row); }
    row.push(tag);
  }
  const totalHeight = rows.reduce((total, row) => total + Math.max(...row.map(t => t.height)), 0) + gap * (rows.length - 1);
  let y = Math.max(gap, Math.min(frameHeight - gap - totalHeight, tags.reduce((total, t) => total + t.cy, 0) / tags.length - totalHeight / 2));
  for (const row of rows) {
    const rowWidth = row.reduce((total, t) => total + t.width, 0) + gap * (row.length - 1);
    let x = (frameWidth - rowWidth) / 2;
    for (const tag of row) { tag.x = x; tag.y = y; x += tag.width + gap; }
    y += Math.max(...row.map(t => t.height)) + gap;
  }
  return tags;
}
