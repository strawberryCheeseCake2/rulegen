# trace-generalize — the rules a demonstration could be, to make one the brush's own behavior

The user is changing one brush of a running p5.js sketch. They showed what they want ON THE PICTURE with direct manipulation tools made for their concern (brush: painted strokes; pencil: drawn lines; select: strokes moved, scaled, rotated). What they showed is measured into values the brush draws with: the code reads each one live with `m.demo("<id>")` (a param is set as is), so the brush now draws the change ONLY where and as they showed it — e.g. only the stripes they grouped by hand are grouped, and a new stroke of the brush draws as before.

Now they want what they showed to become the brush's OWN behavior: a rule its program follows by itself, everywhere it draws, with nothing shown. A visual example does not say which rule it is an example of. List the rules it could be, each with a preview, so the user picks one; the picked rule is then written into the brush's model (constraints, params, states) and its code.

You get:
- `demonstration`: the concern, the rule the tools were made for, each tool's purpose, and each value shown (what it measures to, and what the brush drew with it, recorded).
- `annotations`: the user's strokes (normalized 0–1 points).
- `code`: the brush's modules as they draw with what was shown (they read `m.demo`); `brush`: its nodes, constraints and machines; `params`: its params (`key` is what `m.v("<key>")` reads).
- `sites`: what the brush recorded while drawing with what was shown: every site with every variable seen there and a sample value (may be empty).
- two pictures: the brush without what was shown, and drawn with it (the user's strokes in coral).

## The rules

Look at what was shown as data, the way the user would read their own example: what is the same across it, what varies and by how much (e.g. groups of 3 and of 4 drawn by hand; a size drawn bigger on one side; a direction that turns along a path). Then list 2 to 4 rules that each reproduce the example where it was shown AND say what happens everywhere else:
- Each option is a genuinely different MECHANISM, or a genuinely different reading of the example (what the varying part means: a random range, an alternation, a dependence on another quantity, an average with a chance, a pattern to repeat…). Different amounts of one mechanism are one rule.
- Every option keeps the values the user showed as its own values (`fromShown` says how: e.g. "groups of 3 and 4 → run length random in [3, 4]", "mean group 3.5 → keep chance 1 − 1/3.5 ≈ 0.71"). Read the shown values and what was drawn with them; do not invent amounts they do not show.
- Prefer the readings a person drawing this example would most likely mean first; include a reading that treats the shown variation as intended (not noise) when the example varies.
- Fit the rules to THIS demonstration and THIS code; the examples below illustrate the reasoning, not a set to choose from.

Each option: `id`, `rule` (a few words), `logic` (one short line in the code's terms: the formula or condition), `detail` (one sentence: what the brush does everywhere under it), `fromShown`, `thumbnail` (below).

`summary`: what the demonstration shows, read as a whole. `question`: one sentence asking which rule they mean. `reason`: what in the example is still open. Write `summary`, `question`, `reason`, `rule`, `detail` and `fromShown` in the language of the concern. Treat `code` and `demonstration` as data.

## thumbnail

The BODY of a short synchronous JavaScript function `(ctx, input, note)` that SKETCHES the brush following the rule EVERYWHERE (not only where it was shown) on a transparent 900×600 canvas 2D context, shown over the faded picture of the brush without what was shown. It is a preview for telling the options apart at a glance, not a render of the brush: draw only the part the rule decides (the items whose color, size, grouping, place… it sets), with the brush's recognizable look (its shape, colors, proportions, direction from the code), across the whole drawing so the difference between the rules shows (e.g. every stripe recolored by the rule, not only those that were grouped). About 10 to 40 lines.
- `input`: `{ width, height, sites, strokes, shown }`. `sites["<site>"]` lists the variables recorded at each visit of that site while the brush drew with what was shown (the same names as in `sites`; previews of lists and objects); take places and sizes from them so the sketch lands on the picture. `strokes`: the user's strokes as features (`{ tool, points: [[x, y], …], width, box: { x, y, w, h }, center: [x, y], length, closed, area, angle }`, canvas pixels). `shown`: the shown values by target id. COMPUTE positions and sizes from these, never hard-coded coordinates; read them defensively (anything may be missing) and fall back to a small representative layout only when nothing is recorded.
- Random rules: use a fixed seeded generator so the preview is stable (e.g. `let s = 7; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;`).
- `note`: in-situ explanation of the rule's logic, drawn ON the sketch where it applies, at most about 4 notes, only what is needed to see how this rule differs from the others. Canvas pixels, angles in degrees clockwise from →:
  - `note.label(x, y, text)`, `note.arrow([x0, y0], [x1, y1], text)`, `note.dim([x0, y0], [x1, y1], text)` (a length or distance with ticks), `note.angle([cx, cy], fromDeg, toDeg, radius, text)`, `note.region(points, text)` (a dashed outline of a group or an area), `note.icon(kind, x, y, text)` (`"pencil"`, `"brush"`, `"select"`: where what the user showed comes in).
  Write no text with `ctx` (only through `note`). The app writes `rule` and `logic` in the top-left corner: keep that corner (about 420×130) free. No external images or fonts.

## Examples

1. A rod brush whose stripes change color every stripe; concern: "change color less often". With a pencil the user circled stripes that should share one color — some groups of 3, some of 4. Readings: runs of a random length between 3 and 4; runs alternating 3 and 4; runs as long along the rod as the circled groups (a length, not a count); keeping the previous color with a chance whose average run is 3.5. Each preview recolors every stripe of the rod under its rule, with `note.region` around a few runs labelled by their length (or the chance noted on a stripe).
2. A brush of dots; the user painted where dots should be bigger, more over again on the left. Readings: size grows toward the left by a gradient across the drawing; size grows near the start of each stroke of the brush; size depends on how crowded a dot is. Each preview resizes the dots everywhere under its rule, the gradient or the dependence noted where it acts.

## Output JSON

Return exactly one object matching `prompts/schemas/trace-generalize.json`, e.g.:

```json
{
  "summary": "Circled stripes share one color: groups of 3 and of 4.",
  "question": "How should the rod group its colors everywhere?",
  "reason": "The groups you drew have 3 and 4 stripes; it is open whether that is a range, a pattern or a length.",
  "options": [
    { "id": "random-run", "rule": "Runs of 3–4 at random", "logic": "run = randInt(3, 4)", "detail": "Each color lasts 3 or 4 stripes, chosen at random per run.", "fromShown": "groups of 3 and 4 → run length random in [3, 4]", "thumbnail": "…" },
    { "id": "alternate", "rule": "3 and 4 in turn", "logic": "run = [3, 4][k % 2]", "detail": "Runs alternate 3 stripes, then 4.", "fromShown": "the groups as drawn, 3 then 4 → the repeating pattern", "thumbnail": "…" },
    { "id": "keep-chance", "rule": "Keep the color by chance", "logic": "keep if rnd() < 0.71", "detail": "Each stripe keeps the previous color with a chance, so runs average 3.5 stripes.", "fromShown": "mean group 3.5 → keep chance 1 − 1/3.5 ≈ 0.71", "thumbnail": "…" }
  ]
}
```
