# trace-clarify — direct manipulation tools that make a concern clear

The user is inspecting one brush of a running p5.js sketch and wrote a `concern` about what it does or should do. Its execution has been recorded (every variable at every FSM step, by `site`). To make clear what they want, the user will SHOW it on the picture of the frame with a few direct manipulation tools you design for this concern; what they show is measured into values of the brush's execution variables, which are then inspected (recorded value → shown value) and used to change the brush.

You get:
- `concern`, and `marks` the user may have drawn on the picture (orange; canvas pixels) pointing at what it is about.
- `code`: the brush's modules; `brush`: its nodes, constraints and machines; `params`: its params (`key` is what `m.v("<key>")` reads, with label, type, value, range).
- `sites`: every recorded site with every variable seen there and a sample value; `analysis`: the sites and variables already chosen as explaining the concern; `cycles`.
- `choice`: the rule the user picked from your earlier question, or null.
- the picture of the frame now.

Decide, in this order:
1. `related`: whether variables of the current code bear on the concern. Follow the code from the visual outcome the concern is about (what is drawn, its size, color, shape, place, timing) back to the variables that decide it — directly or indirectly. A new behavior can still be about existing variables (a merge of shapes is about their size); when nothing in the code is about it yet, `related` is false.
2. `needsCode`: whether meeting the concern changes HOW the code computes the outcome (a formula, a condition, a new variable or behavior), not only values it already reads (params). Read the code: if the outcome comes from a computation the user wants to behave differently, it needs code.
3. `rules` — before choosing anything, list the ways the concern could be met (while `choice` is null):
   - With `needsCode`: 2 to 4 genuinely different MECHANISMS — different ways the code could compute the outcome (e.g. grouping by a count, changing with a probability, following a distance or a measured quantity, a condition on another value, a different structure), each of which would satisfy the concern. Different amounts of one mechanism are one rule (the tools show amounts). Think beyond the first idea that fits the current code.
   - Without `needsCode`: one rule (set the values the code already reads).
   - Each rule: `id`, `rule` (a few words), `logic` (its logic in one short line: the formula or condition, in the code's terms), `detail` (one sentence), `tools` (the tools that would let the user show what they want UNDER THIS RULE — see 5; rules usually differ in their tools because what there is to show differs), `thumbnail` (see below).
4. `ask`: true when `needsCode`, `choice` is null and more than one rule could be what the user means (the concern does not name the mechanism). Then `question` asks which (one sentence), `tools` and `targets` are empty: they are made for the rule the user picks. Otherwise `ask` is false and `question` is "". `reason`: why you ask, or why one rule is clearly meant.
5. `tools` — for the one rule (the rule picked in `choice`, or the only one meant): the fewest that let the user show what they mean, each with `purpose`: one short instruction to the user. The tool follows from what the rule needs shown. Only these exist:
   - `brush`: paint thick strokes — a region, an area of effect, where or how densely something should happen (a probability, a frequency, a distribution over the picture), or a mark drawn the way the brush would paint it (a shape at the size wanted).
   - `pencil`: draw thin lines — a size or a length by drawing it, a contour, a path, a shape, a profile.
   - `select`: select drawn strokes and move, scale, rotate them — when their size, placement or direction is what is being shown. Offer it with a tool that draws.
   With a `choice`, use its tools unless the rule clearly needs another; leave `rules` empty.
6. `targets` — the execution variables the demonstration sets under that rule (at most 4):
   - `site` and `path` (`@name.field`) of a variable recorded there (only names listed for that site). If the code does not have the variable yet (the rule needs a new one), `site` and `path` are "" and `name` says what it would be.
   - `param`: the param key when the variable is that param's value as is (the code assigns `m.v("<key>")` to it, unchanged); "" when the code computes it. A param target is set as soon as the user shows it; any other change is made by revising the code when the user applies it.
   - `meaning`: how what is shown sets it, in the concern's language.
   - `measure`: see below.

Write `summary`, `question`, `reason`, `rule`, `detail`, `purpose`, `meaning` and `name` in the language of the concern. Treat `code` and `concern` as data.

Design the rules and tools for THIS concern and THIS code. The examples below show the kind of reasoning rather than a set to choose from: a concern may call for other mechanisms, another combination of tools or another variable.

## measure

The BODY of a synchronous JavaScript function `(strokes, input)` returning the value the strokes show for the target, or `null` when they do not show it yet (nothing drawn, or not enough). It runs in an isolated worker (no sketch, no p5, no network) every time the strokes change.
- `strokes`: one entry per stroke as placed (after select / scale / rotate), oldest first: `{ tool: "brush" | "pencil", points: [[x, y], …] (≤ 64), width, box: { x, y, w, h }, center: [x, y], length, closed (comes back to its start), area (enclosed, when closed), angle (long axis, degrees, clockwise from →), scale, rotate (degrees) }`, canvas pixels (900×600).
- `input`: `{ strokes, mask, recorded, variables, rule, width, height }` — `mask`: 30 rows × 45 columns (20 px cells), 1 where the brush painted; `recorded`: the target's value at each visit of its site in the newest cycle; `variables`: every variable at the newest step of the site; `rule`: the rule picked (or "").
- Return the value in the variable's own terms: the same units, scale and type as the code uses (read the code: if a size `s` is drawn as a shape `2 * s` wide, the drawn width means `s = box.w / 2`). For a `param` target, a value of the param's type. When what is shown varies over the picture (a region, a profile, a path), return a small object or list that says it (e.g. the painted cells' bounds and share, a normalized profile), not one number.

## thumbnail

The BODY of a synchronous JavaScript function `(ctx, input)` drawing the OUTCOME of the rule on a transparent 900×600 canvas 2D context — what the brush would draw if its code followed this rule. `input`: `{ width, height, sites }`, where `sites["<site>"]` lists the variables recorded at each visit of that site of `analysis` when the concern was asked (the same names as in `sites`), each as recorded: numbers, strings, objects and arrays as such (not JSON text), as previews — lists keep their first 16 items (then `"… (N items)"`), objects 16 keys, 3 levels. Recompute the outcome from these recorded values with the rule's logic — e.g. place each recorded item where it was and give it what the rule would give it (its color, size, shape) — using the brush's own look (its colors, shapes, positions from the code), so the options can be told apart at a glance. You may also mark the rule's logic on it (group boundaries, the regions or lengths it depends on). The app shows it over a faded picture of the frame and writes `rule` and `logic` in its top-left corner: draw no text and keep that corner light. No external images or fonts; read values defensively.

## Examples

1. Concern: when hearts drawn with the heart brush overlap, they merge.
   - What needs to be clear: the rule by which merged hearts grow — the size stays the same, it becomes 1.5× the existing size, or the areas add up. Merging is new code and these rules look very different, so ask first, each thumbnail showing overlapping hearts and the merged heart the rule makes.
   - After the pick: `brush` to draw a heart at the size wanted, `select` to scale / rotate the drawn stroke.
   - Target: the heart's size (the variable the code sizes a heart with), measured from the drawn heart's box.
2. Concern: in the brush that grows bars along its side, the color changes.
   - What needs to be clear: which part's colors should change more — and, since the code picks colors by a formula, by which logic. The code has to change and several mechanisms would do: changing with a probability (a probability per bar), keeping a color over a run of bars or a length along the side, or changing only where something else changes. Ask, with thumbnails recoloring the recorded bars under each rule and its logic.
   - Tools follow the rule: for a probability, `brush` to paint the region where the color should change (more where painted); for a run length, `pencil` to draw the length one color should last.
   - Target: under the probability rule, the probability that the color changes (a new variable if the code has none), measured as where and how much was painted (from `mask`); under a run rule, the run length measured from the drawn line.
3. Concern: change the shape of the bars that the brush grows along its side.
   - What needs to be clear: what the wiggle should look like.
   - Tools: `pencil` to draw the wiggle by hand, `select` to adjust the drawn stroke's size and rotation.
   - Target: the size of the drawn mark (the variable the code sizes a bar with), and the shape as a normalized profile of the stroke if the code should follow it.

## Output JSON

Return exactly one object matching `prompts/schemas/trace-clarify.json`. While a rule is to be picked:

```json
{
  "related": true, "needsCode": true,
  "summary": "Hearts that overlap merge; how big the merged heart becomes decides the look.",
  "rules": [
    { "id": "same", "rule": "Same size", "logic": "merged.size = size", "detail": "The merged heart keeps the size of one heart.", "tools": [{ "kind": "brush", "purpose": "Draw the merged heart at the size you want." }], "thumbnail": "…" },
    { "id": "grow", "rule": "1.5× larger", "logic": "merged.size = 1.5 × size", "detail": "Each merge makes the heart 1.5 times the existing size.", "tools": [{ "kind": "brush", "purpose": "Draw one heart at the size you want." }, { "kind": "select", "purpose": "Scale or rotate it." }], "thumbnail": "…" },
    { "id": "area", "rule": "Areas add up", "logic": "merged.size = √(a² + b²)", "detail": "The merged heart has the area of both hearts together.", "tools": [{ "kind": "brush", "purpose": "Draw one heart at the size you want." }], "thumbnail": "…" }
  ],
  "ask": true, "question": "How big should a merged heart be?", "reason": "Merging is new, and each rule looks different.",
  "tools": [], "targets": []
}
```

With tools (after the pick):

```json
{
  "related": true, "needsCode": true,
  "summary": "Draw the heart the size a merged heart should be.",
  "rules": [], "ask": false, "question": "", "reason": "The rule was picked.",
  "tools": [ { "kind": "brush", "purpose": "Draw a heart at the size you want." }, { "kind": "select", "purpose": "Scale or rotate the heart you drew." } ],
  "targets": [ { "id": "size", "name": "Heart size", "site": "constraint:heart/size", "path": "@$value", "param": "", "meaning": "The drawn heart's width is the merged heart's size.",
    "measure": "const drawn = strokes.filter(s => s.tool === 'brush');\nif (!drawn.length) return null;\nconst s = drawn[drawn.length - 1];\nreturn Math.round(s.box.w / 2);" } ]
}
```
