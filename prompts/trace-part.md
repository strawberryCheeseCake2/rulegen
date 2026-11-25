# trace-part — the parts of a brush a concern is about, for a mini sandbox of each

The user is inspecting one brush of a running p5.js sketch and wrote a `concern` about what it does or should do. Besides inspecting it, they want MINI SANDBOXES: each part of the brush the concern is about, taken out on its own into a frame of its own (as decomposing the brush would, but only that part), with direct manipulation handles for its params, so they can try that part alone and see how its values make the outcome the concern is about.

You get:
- `concern`, and `marks` the user may have drawn on the picture (orange; canvas pixels) pointing at what it is about.
- `code`: the brush's modules; `brush`: its nodes (`parentId`: the collection a node is in) with their constraints and each constraint's params (id, label, type, value, range).
- the picture of the frame now.

## Find the parts

Follow the code from the visual outcome the concern is about (what is drawn, its size, color, shape, place, timing — where the marks point) back to what decides it.

How many: 1 to 3 parts in `parts`, most important first. Give more than one only when the outcome comes from separate parts that each decide a different side of it (e.g. where the strokes go and how wide they are, decided in two places of the code), so each is worth trying out on its own; when one part holds the whole of it, give that one. Parts must not overlap: never a part together with a piece of it, nor the same computation twice. Fit the number to what the concern is about.

For each part, choose the SMALLEST part that still holds the whole of what it decides:
- `scope: "computation"`: one computation inside a constraint decides it (a formula, a curve, a distribution, a rule its code runs — often with hard-coded constants), and the rest of that constraint does not matter to the concern. `constraintId` is the constraint it is inside of, and `computation` is that computation as a constraint of its own (below).
- `scope: "constraint"`: one constraint of the node decides it as a whole. `computation` is null.
- `scope: "constraints"`: several of the node's own constraints decide it together. `constraintId` is "", `computation` is null.
- `scope: "node"`: it comes from the node together with what is below it (its members and their constraints). `constraintId` is "", `computation` is null.

`nodeId` is a node of `brush` (the node whose constraint it is). Only constraints with params can be tried out; prefer the smallest scope that keeps what the concern is about whole — the sandbox should not need anything left out to show it. `reason`: one English sentence naming the part and why it is (that side of) what the concern is about.

## The computation (scope "computation" only)

A constraint in the scene model, holding only this computation, so it can be drawn on its own (on a plain member, no other constraint): a new lowercase `id` with `-` naming the computation, a `property` naming what it computes, an English `description` that says concretely what it computes as the code does it (the formula, curve, distribution or rule, and what each param changes), 1–4 scalar `params`, and `inputs` / `drags` as the scene model describes (`[]` when none).
- PARAMS ARE ITS PARAMS: the quantities that decide what this computation does, including those the code keeps as hard-coded constants now. Take each value from the code (or from the constraint's param that already holds it, same id and value) as its current `value`, with a sensible `min`/`max`/`step`/`unit`, so the sandbox starts out looking like the brush does there.
- Fit the computation to the concern: these are what the user will change with the handles to see how the outcome comes about.

## The logic (always)

`logic` (one per part) is shown under that sandbox's handles, so the user knows what they are changing: how this part's program turns its params into what is drawn, in plain words, as the code does it (not what it looks like). Write it in the language the `concern` is written in.
- `summary`: 1–3 short sentences on the mechanism the concern is about — the rule, condition, formula or sequence the code runs (e.g. which items it applies to and how it picks, alternates, accumulates or scales a value), naming the params where they come in.
- `params`: one entry per param of the part (`id`: the param id as the sandbox has it — the computation's own params for scope "computation", the constraint's params otherwise), `how`: one short sentence on what the code does with it (what it is multiplied, compared, counted or chosen by, and what changes in the picture as it goes up or down).
Fit it to this part and this concern; say only what the code does.

{{include:contracts/scene-model}}

## Output JSON

Return exactly one object matching `prompts/schemas/trace-part.json`: `{ "parts": [ … ] }`. E.g. for "why do the stripes repeat the same colors?" on a brush whose `stripes` constraint picks each stripe's color from a palette, keeping the previous color with a hard-coded chance (one part holds it all, so one part):

```json
{ "parts": [
    {
      "reason": "The repeated colors come from the chance of keeping the previous stripe's color, one computation inside the stripes constraint.",
      "nodeId": "ribbon",
      "scope": "computation",
      "constraintId": "stripes",
      "computation": { "id": "color-repeat", "property": "color", "description": "Each stripe keeps the previous stripe's palette color with the keep chance, otherwise it picks another palette color at random.", "params": [
        { "id": "keep-chance", "label": "Keep chance", "effect": "stylistic", "description": "Chance a stripe keeps the previous stripe's color", "value": { "type": "number", "value": 0.35, "min": 0, "max": 1, "step": 0.01, "unit": "" } }
      ], "inputs": [], "drags": [] },
      "logic": { "summary": "Stripes are colored in order: each one keeps the color of the stripe before it with the keep chance, otherwise takes a random other palette color, so runs of one color appear.", "params": [
        { "id": "keep-chance", "how": "Compared with a random number per stripe; higher makes longer runs of the same color, 0 changes color every stripe." }
      ] }
    }
] }
```
