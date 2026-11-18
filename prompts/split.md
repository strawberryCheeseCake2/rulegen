# split — one constraint into the meaningful algorithms inside it

The user decomposed a brush into minimal examples, one constraint each, and now decomposes ONE of them again: the constraint `targetConstraintId` of the node `targetNodeId` in `scene`. `code` is the p5.js module that draws it now (the minimal example's code). Divide that constraint (the compute function that determines its `property`) into the meaningful algorithms its code actually runs, so each can be tried and adjusted on its own in a frame of its own. The parent constraint itself is not changed.

## When it divides

- A PART is one algorithm with its own idea and its own effect on the picture, the kind of thing one names and tunes separately: e.g. for a `branches` constraint "branches split recursively from the trunk": the branch length decay per depth, the split angle spread, the random jitter of each branch; for a `shape` constraint "a dry ink brush stroke": the bristles spread across the stroke, the ink running out along it, the ragged edge noise.
- Read `code`: the constraint's compute function and the helper functions (`algo_…` and others), formulas and loops that do a distinct job are candidates. Two parts must differ in WHAT they do to the picture, not just in which lines they are.
- Not parts: a single formula, bookkeeping (caches, ids, stores, input handling plumbing), drawing calls that only apply what another part computed, and anything outside this constraint's compute function (the node's other constraints, the state machine).
- `divisible` is false (and `parts` `[]`) when the constraint is already ONE such algorithm: say why in `reason` (one English sentence, e.g. "It is a single decay formula that shortens branches by depth, so there is no meaningful unit to split it into."). When true, `reason` says in one English sentence how it was divided.

## Each part

- 2–5 parts, in the order the code applies them. Each is a constraint in the scene model: a new lowercase `id` with `-` naming the algorithm, a `property` naming what it computes (the parent's property, or the part of it this algorithm decides, e.g. `"length"`, `"angle"`, `"jitter"`), an English `description` that says concretely what it computes as the code does it (the formula, curve, distribution or rule, and what each param changes), 1–4 `params`, and `inputs` / `drags` as the scene model describes (the parent's pointer inputs and drags go with the part that holds their param; `[]` when none).
- PARAMS ARE ITS PARAMS: the quantities that decide what this algorithm does, including the ones the code keeps as hard-coded constants now (a curve's control offsets, a decay ratio, a jitter amount, a line count, a spacing). Take each value from the code (or from the parent's param that already holds it) as its current `value`, with a sensible `min`/`max`/`step`/`unit`, so the part's minimal example starts out looking like the parent does. A part may reuse an existing param of the parent (same id, same value) when it belongs to it; every parent param belongs to at most one part.
- Use an algorithm value (`{ "type": "algorithm", … }`) for a param only when that algorithm is itself the part's core and has parameters worth exposing; reuse algorithms of `scene.algorithms` by id, put new ones in `algorithms`.
- Each part's minimal example is drawn on its own (a plain member, no other constraint): the description must be enough to draw that part alone, e.g. the length decay part draws plain straight branches shrinking by depth, the jitter part shakes plain branches of equal length.

`instruction`, when given, is how the user wants it divided: follow it.

{{include:contracts/scene-model}}

## Output JSON

Return exactly one object matching `prompts/schemas/split.json`:

```json
{
  "divisible": true,
  "reason": "Divided into three algorithms: branch length decay, split angle, and per-branch jitter.",
  "algorithms": [],
  "parts": [
    { "id": "length-decay", "property": "length", "description": "Each time the depth increases by one, the branch length is multiplied by the decay ratio, so branches get shorter toward the top.", "params": [
      { "id": "decay-ratio", "label": "Decay ratio", "effect": "spatial", "description": "Fraction of length kept at each deeper level", "value": { "type": "number", "value": 0.72, "min": 0.3, "max": 0.95, "step": 0.01, "unit": "" } }
    ], "inputs": [], "drags": [ { "paramId": "decay-ratio", "path": "", "source": "y", "mode": "range", "invert": false, "how": "drag up to keep the branches longer" } ] },
    { "id": "split-angle", "property": "angle", "description": "When a branch splits, its two child branches spread left and right from the parent's direction by the same angle.", "params": [
      { "id": "spread", "label": "Spread", "effect": "spatial", "description": "Angle spread to each side", "value": { "type": "number", "value": 28, "min": 0, "max": 90, "step": 1, "unit": "deg" } }
    ], "inputs": [], "drags": [ { "paramId": "spread", "path": "", "source": "x", "mode": "range", "invert": false, "how": "drag right to spread the branches" } ] }
  ]
}
```
