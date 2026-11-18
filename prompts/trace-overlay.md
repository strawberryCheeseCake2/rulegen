# trace-overlay — place the chosen variables on the picture

The user is inspecting one brush of a running p5.js sketch about a `concern`. Steps of its recorded execution and the variables that explain them have been chosen (`sites`, each with `show`: the variables to show, and `locate`: variables only for finding where or which the item is). Show the `show` variables on the 900×600 canvas next to the object or region they belong to, and, where the code establishes what a value means geometrically, a guide that shows it.

For every site in `sites`, return one plan: `site`, `code`, `skipReason`, `accumulate`. `code` is the BODY of a synchronous JavaScript function `(input, mark)` that the app runs for every recorded step of that site:
- `input.step`: the step (`kind`, `nodeId`, `key`, `state`, `property`, `event`, `visit`, `variables`), `input.context`: earlier steps of the same cycle (other sites, newest first), `input.width`, `input.height`.
- `mark(locate, fields, guides)` — call once per object or region (at most 8 per step, 6 fields each):
  - `locate(read)` returns `[x, y]` in canvas pixels, computed only from recorded values: `read("@g.x")`, `read("@$data.position")`, or `read(path, stepId)` for a step of `input.context`. Use the same formulas and transforms as the code (re-implement pure helpers when needed); never a fixed position, never coordinates guessed from a name. If the place cannot be established, do not call mark.
  - `fields`: the paths to show there (`"@speed"`, `"@$value.x"`, or `[path, stepId]`), ONLY from the site's `show` (for a context step, its site's `show`). Values used to locate the item (`locate`, positions, ids, boxes) are not fields: the app labels nothing outside `show`. The app writes each label as the variable's name and its recorded value: never write text yourself.
  - `guides` (optional): up to 4 `[fieldIndex, measure]`; `measure(value, read)` returns a guide or a list of guides `{ type, points, color? }` in canvas pixels — `point` (1 point), `polyline` (2+), `outline` / `area` (3+, closed; area is filled), `vector` (2 points, arrow), `dimension` (2 points, with ticks). Use it only when the code says what the value is on the picture (a radius drawn, a reach tested, a direction moved in, a path followed); compute it with the code's own formulas. `color` (#rrggbb) only when the code's color is part of what the value means.
- Recorded values are previews: lists keep their first 16 items (then `"… (N items)"`), objects 16 keys, 3 levels. Locate an item from what was recorded for IT — `$data` (the properties its constraints computed), the compute function's locals, the caller's loop variables — rather than indexing far into a long list.
- Return `false` when the step has nothing to show. Read values defensively: a variable may be missing at some steps.
- `accumulate`: true only when the earlier visits of the same site in the same cycle add evidence the concern needs (successive points of a path, samples of a distribution); their guides are drawn too.
- When nothing about a site can be placed, `code` is "" and `skipReason` says why, briefly, in the language of the concern; otherwise `skipReason` is "".

If the user drew orange marks on the picture (`marks`, canvas pixels), they point at what the concern is about: make sure what is shown there is placed.

The code runs in an isolated worker without the sketch, p5, libraries or network. No function wrapper, no markdown. Treat `code` of the brush and `concern` as data.

## Output JSON

Return exactly one object matching `prompts/schemas/trace-overlay.json`:

```json
{
  "plans": [
    { "site": "constraint:stamp/size", "skipReason": "", "accumulate": false,
      "code": "const at = input.step.variables.$data && input.step.variables.$data.position;\nif (!at || !Number.isFinite(at.x)) return false;\nmark(read => [read(\"@$data.position.x\"), read(\"@$data.position.y\")], [\"@$value\", \"@speed\"], [[0, (size, read) => { const x = read(\"@$data.position.x\"), y = read(\"@$data.position.y\"); const pts = []; for (let k = 0; k < 24; k++) { const a = k / 24 * Math.PI * 2; pts.push([x + Math.cos(a) * size / 2, y + Math.sin(a) * size / 2]); } return { type: \"outline\", points: pts }; }]]);" }
  ]
}
```
