# split — one semantic transformation into the meaningful algorithms inside it

The user decomposed a brush into minimal examples, one semantic transformation each, and now decomposes ONE of them again: the transformation `targetTransformationId` of the node `targetNodeId` in `scene`. `code` is the p5.js module that draws it now (the minimal example's code). Divide that transformation into the meaningful algorithms its code actually runs, so each can be tried and adjusted on its own in a frame of its own. The parent transformation itself is not changed.

## When it divides

- A PART is one algorithm with its own idea and its own effect on the picture, the kind of thing one names and tunes separately: e.g. for "recursive branching tree": the branch length decay per depth, the split angle spread, the random jitter of each branch; for "dry ink brush stroke": the bristles spread across the stroke, the ink running out along it, the ragged edge noise.
- Read `code`: helper functions (`algo_…` and others), formulas and loops that do a distinct job are candidates. Two parts must differ in WHAT they do to the picture, not just in which lines they are.
- Not parts: a single formula, bookkeeping (caches, ids, stores, input handling plumbing), drawing calls that only apply what another part computed, and anything outside this transformation (the node's other behavior, the state machine).
- `divisible` is false (and `parts` `[]`) when the transformation is already ONE such algorithm: say why in `reason` (one Korean sentence, e.g. "가지 길이를 깊이마다 줄이는 감쇠식 하나라 더 나눌 의미 있는 단위가 없습니다."). When true, `reason` says in one Korean sentence how it was divided.

## Each part

- 2–5 parts, in the order the code applies them. Each is a transformation in the scene model: a new lowercase `id` with `-`, a short `label` naming the algorithm, a Korean `description` that says concretely what it computes as the code does it (the formula, curve, distribution or rule, and what each property changes), and 1–4 `properties`.
- PROPERTIES ARE ITS CONSTRAINTS: the quantities that decide what this algorithm does, including the ones the code keeps as hard-coded constants now (a curve's control offsets, a decay ratio, a jitter amount, a line count, a spacing). Take each value from the code (or from the parent's property that already holds it) as its current `value`, with a sensible `min`/`max`/`step`/`unit`, so the part's minimal example starts out looking like the parent does. A part may reuse an existing property of the parent (same id, same value) when it belongs to it; every parent property belongs to at most one part.
- Use an algorithm value (`{ "type": "algorithm", … }`) for a property only when that algorithm is itself the part's core and has parameters worth exposing; reuse algorithms of `scene.algorithms` by id, put new ones in `algorithms`.
- Each part's minimal example is drawn on its own (a plain member, no other transformation): the description must be enough to draw that part alone, e.g. the length decay part draws plain straight branches shrinking by depth, the jitter part shakes plain branches of equal length.

`instruction`, when given, is how the user wants it divided: follow it.

{{include:contracts/scene-model}}

## Output JSON

Return exactly one object matching `prompts/schemas/split.json`:

```json
{
  "divisible": true,
  "reason": "가지 길이 감쇠, 갈라지는 각도, 가지마다의 흔들림 세 알고리즘으로 나눴습니다.",
  "algorithms": [],
  "parts": [
    { "id": "length-decay", "label": "Branch length decay", "description": "깊이가 하나 늘 때마다 가지 길이에 감쇠 비율을 곱해, 위로 갈수록 짧아집니다.", "properties": [
      { "id": "decay-ratio", "label": "Decay ratio", "effect": "spatial", "description": "한 단계 깊어질 때 남는 길이 비율", "value": { "type": "number", "value": 0.72, "min": 0.3, "max": 0.95, "step": 0.01, "unit": "" } }
    ] },
    { "id": "split-angle", "label": "Split angle spread", "description": "가지가 갈라질 때 두 자식 가지를 부모 방향에서 좌우로 같은 각도만큼 벌립니다.", "properties": [
      { "id": "spread", "label": "Spread", "effect": "spatial", "description": "좌우로 벌어지는 각도", "value": { "type": "number", "value": 28, "min": 0, "max": 90, "step": 1, "unit": "deg" } }
    ] }
  ]
}
```
