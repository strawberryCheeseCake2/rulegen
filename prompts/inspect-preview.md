## preview — a quick visual preview of each recommendation

The user turned recommendation previews on. Every recommendation also has `preview`: the panel runs it on the brush marks of the step the user looks at (`steps[currentStep]`, the latest when null), so the user SEES what the recommendation would do before applying it. Nothing is applied; it is a sketch of the outcome, not the real fix.

- `kind: "value"`: `preview` is `null` (its `changes` are drawn as they are).
- Any other kind: `preview` is REQUIRED (never `null` for these). It shows THE OUTCOME ITS TITLE NAMES, plainly, on these marks.

### What the preview must look like

- It shows the END RESULT the recommendation promises, as the user would recognize it at a glance: for "dissolve the outlines where hearts overlap into one shape" the overlapping hearts drawn as ONE outline (the inner borders gone); for "replace overlapping hearts with one new heart" those hearts gone and ONE bigger heart drawn where they were.
- Recommendations that differ must LOOK different: show exactly what makes this one's outcome differ from the others listed (one merged outline vs one new heart), not a shared approximation.
- Approximate how, not what: it need not do the real algorithm. Use the cheapest drawing that produces the right picture, e.g.:
  - one shape from overlapping shapes: draw every overlapping shape's outline thick in the ink color, then fill all their interiors with the paper color (`#fffefa`) — what remains is the outer outline only;
  - one new shape instead of several: skip drawing the ones that overlap (one condition where they are drawn) and draw one shape with the module's own drawing helper at their center, sized to cover them;
  - removing or hiding something: a condition that skips drawing it; adding something: one extra call of the module's own helper.
- Read what the module already has (its local variables in `draw`, the items it keeps in `m.store`, its helpers): no new data structures, no geometry algorithms (no polygon union, clustering loops over everything, physics).

### How small

- 1–3 edits, together about 25 lines at most. Prefer ONE edit that adds drawing at the end of `draw` (after the module draws) plus, if needed, one small condition where items are drawn.
- Each edit is `{ nodeId, find, replace }`: `nodeId` a node of the brush (its module is edited), `find` copied EXACTLY from `code` (whitespace included) occurring exactly once in that module, `replace` the new code (keep the found text in it when you only add after it). Valid JavaScript; never add `m.trace`, input handlers or new state machines.
- A NEW quantity the edits read is read with `m.v("<node id as the code uses it>/<new id>")` and listed in `values` (`nodeId`, a new lowercase `id` with `-`, a short `label`, `value`: `{ "type": "number", "value", "min", "max", "step", "unit" }` or `{ "type": "toggle", "value" }`). Usually `[]`.
- `caption`: one short Korean sentence on what to look at (e.g. "겹친 하트의 안쪽 윤곽이 사라지고 바깥 윤곽만 남습니다").

Code that does not apply or does not parse is dropped (the user then sees no preview), so copy `find` exactly.

THE BEHAVIOR IS IN THE STATE MACHINE. When the recommendation makes the brush REACT to something that happens while it runs (things meet, touch, overlap, merge, split, a limit is reached, an item dies or is born from another), that reaction is part of the brush's behavior and goes in its state machine too, or the machine no longer describes the brush. `preview.machine` gives it: `nodeId` the node whose code emits it (a brush node with a machine; one without gets one, its first new state the initial one), `transitions` (1–4) with trigger `"event"`, a new lowercase id with `-` and a short Korean `label` naming what happens (e.g. `"하트끼리 겹침 → 합치기"`), and `afterMs` 1000. Prefer a transition from each state it can happen in BACK TO THE SAME STATE (an instant reaction: the code's own checks of its state keep working); add a new state (`states`: `id`, `label`, `description`, `like` the existing state whose values it starts with) only when the brush then behaves differently for a while, with an `"after"` transition back. The edits emit it with `m.emit("<node id as the code uses it>", "<transition id>")` AT THE MOMENT IT HAPPENS: once per happening (e.g. when a new pair starts to overlap, remembered in `m.store`), never every frame while it lasts. Each emit becomes a recorded step the user can inspect. `preview.machine` is `null` when the recommendation changes no behavior (only how something looks, or a value).
