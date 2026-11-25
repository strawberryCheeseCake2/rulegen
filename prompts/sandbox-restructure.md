# sandbox-restructure — structural changes for a mini sandbox, as a multiple choice with previews

The user took one part of a brush out into a MINI SANDBOX to work on a `concern` (what they want to understand or change about the brush). The sandbox's handles change the part's params, but the outcome the concern asks for may not be reachable by values alone: the way the part computes (its formula, rule, structure, what it depends on) may have to change. Offer that change as a multiple choice question: 2 to 4 STRUCTURAL CHANGES of the part, each a different way the part could compute so the concern is met, with a preview, so the user picks one by how it would look.

You get:
- `concern`; `node` (the part's node); `constraint`: the part as it is now (its `description` and `params` with their values); `code`: the module that draws the node (the part computed in it).
- the picture of the sandbox now.

## Whether to offer changes

Read the code and the concern: what outcome does the concern ask for, and can some values of the params give it? When they can, answer `question` saying which params to change and how, and `options` `[]`. Otherwise `question` says in one sentence (in the language of the `concern`) why the values alone cannot do it and what the options choose between.

## The options

Each option is a different MECHANISM — not the same one with other values: what the part depends on, the rule or formula it follows, where or to which items it applies, how it combines with what comes into it. Each is plausible for the concern and gives a visibly different outcome.
- `id` (short, lowercase, `-`), `label` (a few words, in the language of the `concern`), `change` (one sentence: what changes in how the part computes, in the language of the `concern`), `logic` (its rule or formula in one short line, in the code's terms).
- `constraint`: the part's constraint as it would be after the change, in the scene model below, with the SAME `id` as `constraint` now: a `property`, an English `description` that says concretely what it computes as the code would do it, and its `params` — keep the ids, labels and values of the params it still has, and add the new quantities the mechanism needs (with values that give the outcome the concern asks for, so it shows at once). At most 8 params.
- `thumbnail`: the preview, below.

## thumbnail

The BODY of a short synchronous JavaScript function `(ctx, input, note)` that SKETCHES the outcome of the option on a transparent 900×600 canvas 2D context, laid over the faded picture of the sandbox (same canvas pixels). It is a preview for telling the options apart at a glance, not a render of the brush: draw only the part the concern is about (a few representative items, the place or quantity that differs between the options), with the brush's recognizable look (its shape, colors, proportions, direction from the code), and leave out everything else. Keep it short — about 10 to 30 lines.
- `input`: `{ width, height }`. Take places and sizes from the picture and the code (the node's box, where items are drawn).
- `note`: in-situ explanation of the option's logic, drawn ON the sketch where it applies (at most about 4 notes). Canvas pixels, angles in degrees clockwise from →:
  - `note.label(x, y, text)` — a short label on the visual.
  - `note.arrow([x0, y0], [x1, y1], text)` — points at something from (x0, y0), with the label at the tail.
  - `note.dim([x0, y0], [x1, y1], text)` — a length or a distance the logic uses, with ticks.
  - `note.angle([cx, cy], fromDeg, toDeg, radius, text)` — a turn or a difference of direction, on the item that turns.
  - `note.region(points, text)` — a dashed outline of an area the logic depends on.
  Write no text with `ctx` (only through `note`). The app writes `label` and `logic` in the top-left corner: keep that corner (about 420×130) free. No external images or fonts.

{{include:contracts/scene-model}}

## Output JSON

Return exactly one object matching `prompts/schemas/sandbox-restructure.json`, e.g. for "the stripes should change color more often near the edges" on a sandbox whose `color-repeat` part keeps the previous stripe's color with a keep chance:

```json
{
  "question": "유지 확률은 모든 줄무늬에 같게 적용되어, 값만으로는 가장자리에서만 더 자주 바꿀 수 없습니다. 어디서 더 자주 바뀌게 할지 고르세요.",
  "options": [
    { "id": "edge-falloff", "label": "가장자리로 갈수록 확률 감소", "change": "유지 확률이 리본 중앙에서 가장자리로 갈수록 줄어듭니다.", "logic": "keep = keepChance × (1 − edgeFalloff × |t − 0.5| × 2)",
      "constraint": { "id": "color-repeat", "property": "color", "description": "Each stripe keeps the previous stripe's color with a chance that falls from the keep chance at the middle of the ribbon toward the edges by the edge falloff; otherwise it picks another palette color.", "params": [
        { "id": "keep-chance", "label": "Keep chance", "effect": "stylistic", "description": "Chance a stripe keeps the previous color at the middle", "value": { "type": "number", "value": 0.35, "min": 0, "max": 1, "step": 0.01, "unit": "" } },
        { "id": "edge-falloff", "label": "Edge falloff", "effect": "stylistic", "description": "How much less likely a color is kept at the edges", "value": { "type": "number", "value": 0.8, "min": 0, "max": 1, "step": 0.01, "unit": "" } }
      ], "inputs": [], "drags": [] },
      "thumbnail": "…" },
    { "id": "edge-band", "label": "가장자리 띠에서만 매번 변경", "change": "가장자리 띠 안의 줄무늬는 항상 새 색을 고르고, 안쪽은 지금처럼 유지 확률을 따릅니다.", "logic": "keep = inBand ? 0 : keepChance",
      "constraint": { "id": "color-repeat", "property": "color", "description": "Stripes within the edge band of the ribbon always pick a new palette color; the others keep the previous stripe's color with the keep chance.", "params": [
        { "id": "keep-chance", "label": "Keep chance", "effect": "stylistic", "description": "Chance an inner stripe keeps the previous color", "value": { "type": "number", "value": 0.35, "min": 0, "max": 1, "step": 0.01, "unit": "" } },
        { "id": "band", "label": "Edge band", "effect": "spatial", "description": "Width of the band at each end where every stripe changes color", "value": { "type": "number", "value": 0.2, "min": 0, "max": 0.5, "step": 0.01, "unit": "ribbon length" } }
      ], "inputs": [], "drags": [] },
      "thumbnail": "…" }
  ]
}
```
