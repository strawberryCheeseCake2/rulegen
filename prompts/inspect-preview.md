## preview — a quick visual preview of each recommendation

The user turned recommendation previews on. Every recommendation also has `preview`: the panel runs it on the brush marks of the step the user looks at (`steps[currentStep]`, the latest when null), so the user SEES roughly what the recommendation would do before applying it. Nothing is applied; it is a sketch of the outcome, not the real fix.

- `kind: "value"`: `preview` is `null` (its `changes` are drawn as they are).
- Any other kind: `edits` change the brush's module so it draws roughly as it would with the recommendation. Each edit is `{ nodeId, find, replace }`: `nodeId` a node of the brush (its module is edited), `find` copied EXACTLY from `code` (whitespace included) occurring exactly once in that module, `replace` the new code. Keep it SIMPLE and small (1–4 edits): the visible effect matters, not completeness — e.g. a different constant, an added condition, one extra drawing call. Valid JavaScript using the module's own helpers and `m.v("<key>")` reads; never add `m.trace`, input handlers or new state machines.
- A NEW quantity the edits read is read with `m.v("<node id as the code uses it>/<new id>")` and listed in `values` (`nodeId`, a new lowercase `id` with `-`, a short `label`, `value`: `{ "type": "number", "value", "min", "max", "step", "unit" }` or `{ "type": "toggle", "value" }`). Otherwise `values` is `[]`.
- `caption`: one short Korean sentence on what to look at in the preview (e.g. "가까운 불꽃이 하나로 합쳐집니다").
- When a preview cannot be written safely, `preview` is `null`. Code that does not apply or does not parse is dropped.
