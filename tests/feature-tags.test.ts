import test from "node:test";
import assert from "node:assert/strict";
import { layoutFeatureTags, tagsOverlap } from "../app/lib/feature-tags";
import type { Feature } from "../app/lib/schema";
test("six tags stay separate for identical regions, edges, and every supported zoom", () => {
  for (const zoom of [.15, .2, .43, .64, .65, 1, 3]) for (const region of [{ x: .4, y: .4, w: .1, h: .1 }, { x: 0, y: 0, w: .02, h: .02 }, { x: .95, y: .95, w: .05, h: .05 }, { x: 0, y: 0, w: 1, h: 1 }]) {
    const features: Feature[] = Array.from({ length: 6 }, (_, i) => ({ id: String(i), label: `Feature ${i}`, description: "", region }));
    for (const selected of [null, ...features.map(f => f.id)]) {
      const tags = layoutFeatureTags(features, zoom, selected);
      for (let i = 0; i < tags.length; i++) for (let j = i + 1; j < tags.length; j++) assert.equal(tagsOverlap(tags[i], tags[j], 0), false, `zoom ${zoom}, selected ${selected}, tags ${i}/${j}`);
      assert.equal(tags.every(t => t.x >= 0 && t.y >= 0 && t.x + t.width <= 900 * zoom + 1e-8 && t.y + t.height <= 600 * zoom + 1e-8), true, `tags remain inside frame at zoom ${zoom}`);
      assert.deepEqual(layoutFeatureTags(features, zoom, selected), tags);
      assert.equal(tags.every(t => Math.abs(t.cx - (region.x + region.w / 2) * 900 * zoom) < 1e-8 && Math.abs(t.cy - (region.y + region.h / 2) * 600 * zoom) < 1e-8), true);
      if (selected && zoom < .65) assert.equal(tags.find(t => t.feature.id === selected)?.compact, false);
    }
  }
});
