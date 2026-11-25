# trace-clarify — direct manipulation tools that make a concern clear

The user is inspecting one brush of a running p5.js sketch and wrote a `concern` about what it does or should do. Its execution has been recorded (every variable at every FSM step, by `site`). To make clear what they want, the user will SHOW it on the picture of the frame with a few direct manipulation tools you design for this concern; what they show is measured into values of the brush's execution variables, which are then inspected (recorded value → shown value) and used to change the brush.

You get:
- `concern`, and `marks` the user may have drawn on the picture (orange; canvas pixels) pointing at what it is about.
- `code`: the brush's modules; `brush`: its nodes, constraints and machines; `params`: its params (`key` is what `m.v("<key>")` reads, with label, type, value, range).
- `sites`: every recorded site with every variable seen there and a sample value; `analysis`: the sites and variables already chosen as explaining the concern, or null when the user went straight to the tools (then find the variables yourself from `code` and `sites`); `cycles`.
- `choice`: the rule the user picked from your earlier question, or null.
- `feedback`: what the user said about rules or tools you made before that did not fit, or absent (see Feedback).
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
   - `at`: when the measured value varies over the picture (a grid, a mask, a list by region), the BODY of a synchronous function `(value, x, y)` returning the part of it that applies at canvas point (x, y) — exactly the element the code would read for an item there (e.g. `value.probabilities[Math.floor(y / value.cellSize)][Math.floor(x / value.cellSize)]`), or null outside it. The app reads it where the user drew, to show those values rather than the whole structure. "" when the value is one value.

When `analysis` is null, the tools act LIVE on a temporary fork of the frame: once the rule is picked, the fork's code is changed once to follow it and to read each target that is not a `param` with `m.demo("<target id>")`; from then on every stroke is measured and the fork redraws at once with the measured values, and only these targets are shown on its picture. So choose targets that are the values the changed code would read directly at the place they act (a probability per region, a size, a run length, a profile), and make `measure` return exactly what that code would use — its units, range and shape — or null while nothing is shown (the code then behaves as before). With `analysis`, the change is made when the user applies it, as below.

Write `summary`, `question`, `reason`, `rule`, `detail`, `purpose`, `meaning` and `name` in the language of the concern. Treat `code` and `concern` as data.

Design the rules and tools for THIS concern and THIS code. The examples below show the kind of reasoning rather than a set to choose from: a concern may call for other mechanisms, another combination of tools or another variable.

## Feedback

With `feedback`, the user has seen what you made before and it is not what they want. `text` and `marks` (drawn in coral on the picture, canvas pixels) say what they want instead; read the marks against the picture (what they circle, cross out, point at or draw the way it should look). Take what they say literally and fit the rules and tools to it — the feedback outranks your earlier reading of the concern.
- `kind: "options"`: none of the rules offered (`rejected`) is what they mean. List new `rules` (2 to 4) that follow the text and marks, none repeating a rejected one (a rejected mechanism comes back only when the feedback asks for it with a change, and then the change is what differs). Ask, as in 4, unless exactly one rule is clearly meant.
- `kind: "tools"`: the tools made (`made`: the rule they were for, each tool's purpose, each target with how it was measured and what the user's strokes measured to) do not do what they want. The picture shows the frame drawn with what they showed (their strokes with the tools in blue); the marks point at where the outcome went wrong or show how it should be. Find what could have gone wrong — the tool (another kind would let them show it), the measurement (what the strokes are read as: units, a region instead of a count, an average instead of a profile, a direction, coats), the variable it sets or where it acts, or the rule itself — and list 2 to 4 ALTERNATIVE corrections as `rules`, each a different reading of what the user wants, its `detail` saying what changes from the tools made, with `tools` and a `thumbnail` as usual (the thumbnail sketches the outcome the correction gives, noted where it differs). Ask (`ask: true`, `question` naming what is unclear) unless exactly one correction is clearly meant: then make its tools at once (`ask: false`).
- With a `choice` and `feedback`: make the tools for that choice, following the feedback (keep what it does not object to).

## measure

The BODY of a synchronous JavaScript function `(strokes, input)` returning the value the strokes show for the target, or `null` when they do not show it yet (nothing drawn, or not enough). It runs in an isolated worker (no sketch, no p5, no network) every time the strokes change.
- `strokes`: one entry per stroke as placed (after select / scale / rotate), oldest first: `{ tool: "brush" | "pencil", points: [[x, y], …] (≤ 64), width, box: { x, y, w, h }, center: [x, y], length, closed (comes back to its start), area (enclosed, when closed), angle (long axis, degrees, clockwise from →), scale, rotate (degrees) }`, canvas pixels (900×600).
- `input`: `{ strokes, mask, recorded, variables, rule, width, height }` — `mask`: 30 rows × 45 columns (20 px cells), each the number of brush strokes painted over it (its coats: 0 unpainted, 1 painted once, 2 painted over again…); `recorded`: the target's value at each visit of its site in the newest cycle; `variables`: every variable at the newest step of the site; `rule`: the rule picked (or "").
- The brush works like paint: painting over a place again lays another coat, and each coat changes that place FURTHER in the direction the tool changes it — whatever the change is (it happens more often or less often, goes further, is more pronounced, shifts further from how it is now, spreads wider). Design the measured value so that one coat makes the change and every further coat adds to it, approaching its limit (e.g. `1 - (1 - step) ** coats`, or `min(max, coats * step)`) and never leaving the variable's range; say so in the `purpose` (e.g. "paint over again to change it further"). This applies when the change can go further by degree; when it cannot (only where was painted matters: a region, a boundary, a selection), any coat counts the same.
- Return the value in the variable's own terms: the same units, scale and type as the code uses (read the code: if a size `s` is drawn as a shape `2 * s` wide, the drawn width means `s = box.w / 2`). For a `param` target, a value of the param's type. When what is shown varies over the picture (a region, a profile, a path), return a small object or list that says it (e.g. the painted cells' bounds and share, a normalized profile), not one number.

## thumbnail

The BODY of a short synchronous JavaScript function `(ctx, input, note)` that SKETCHES the outcome of the rule on a transparent 900×600 canvas 2D context. It is a preview for telling the options apart at a glance, not a render of the brush: draw only the part the concern is about (the few items, the quantity or the place that changes between the rules), with the brush's recognizable look (its shape, colors, proportions, direction from the code), and leave out everything else (backgrounds, textures, unrelated parts, full loops over every item). Keep it short — about 10 to 30 lines; a few representative items are enough.
- `input`: `{ width, height, sites }`, where `sites["<site>"]` lists the variables recorded at each visit of that site of `analysis` (with no `analysis`: of every site of the newest cycle) when the concern was asked (the same names as in `sites`), as recorded: numbers, strings, objects and arrays as such, as previews (lists keep their first 16 items, then `"… (N items)"`; objects 16 keys, 3 levels). Take places and sizes from them (where the items were, how big) so the sketch lands on the faded picture of the frame shown under it; read values defensively.
- `note`: in-situ explanation of the rule's logic, drawn ON the sketch where it applies (on the item or the place it is about, not in a caption or a legend). Use it to make the formula readable from the picture: put the value or the condition right on the visual it decides, and only what is needed to see how this rule differs from the others (a few words or a number, at most about 4 notes). Canvas pixels, angles in degrees clockwise from →:
  - `note.label(x, y, text)` — a short label on the visual (e.g. the value at that item).
  - `note.arrow([x0, y0], [x1, y1], text)` — points at something from (x0, y0), with the label at the tail.
  - `note.dim([x0, y0], [x1, y1], text)` — a length or a distance the rule uses, with ticks.
  - `note.angle([cx, cy], fromDeg, toDeg, radius, text)` — a turn or a difference of direction, on the item that turns.
  - `note.region(points, text)` — a dashed outline of an area the rule depends on (where it happens, a group).
  - `note.icon(kind, x, y, text)` — `kind` "pencil" (drawn by hand by the user), "brush" (painted by the user), "select" (moved / scaled by the user): where what the user will show is used, e.g. an arrow to a hand-drawn path with `note.icon("pencil", …, "your line")`.
  For example, a difference of direction gets the angle labelled on the items themselves; a size taken from a drawn mark gets a pencil icon and an arrow to the mark; a probability by region gets the region outlined with its value. These illustrate: note what THIS rule's logic depends on.
  Write no text with `ctx` (only through `note`). The app writes `rule` and `logic` in the top-left corner: keep that corner (about 420×130) free. No external images or fonts.

## Examples

1. Concern: when hearts drawn with the heart brush overlap, they merge.
   - What needs to be clear: the rule by which merged hearts grow — the size stays the same, it becomes 1.5× the existing size, or the areas add up. Merging is new code and these rules look very different, so ask first, each thumbnail sketching two overlapping hearts and the merged heart the rule makes, its size noted on it (`note.dim` across the merged heart: "1.5 × size").
   - After the pick: `brush` to draw a heart at the size wanted, `select` to scale / rotate the drawn stroke.
   - Target: the heart's size (the variable the code sizes a heart with), measured from the drawn heart's box.
2. Concern: in the brush that grows bars along its side, the color changes.
   - What needs to be clear: which part's colors should change more — and, since the code picks colors by a formula, by which logic. The code has to change and several mechanisms would do: changing with a probability (a probability per bar), keeping a color over a run of bars or a length along the side, or changing only where something else changes. Ask, with thumbnails recoloring a few recorded bars under each rule, the logic noted where it acts (the probability on the bars that may change, a run's length with `note.dim` along the side).
   - Tools follow the rule: for a probability, `brush` to paint the region where the color should change (more where painted); for a run length, `pencil` to draw the length one color should last.
   - Target: under the probability rule, the probability that the color changes (a new variable if the code has none), measured as where and how much was painted (from `mask`; each coat painted over again changes the colors further); under a run rule, the run length measured from the drawn line. On a live fork, painting more over some bars makes their colors change more right away.
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
    "measure": "const drawn = strokes.filter(s => s.tool === 'brush');\nif (!drawn.length) return null;\nconst s = drawn[drawn.length - 1];\nreturn Math.round(s.box.w / 2);", "at": "" } ]
}
```
