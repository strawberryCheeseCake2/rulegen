# compose-prompt — draft an editable Compose prompt from the sketch

Interpret the actual FREEFORM SKETCH image together with its ordered pencil, semantic pen and eraser paths, and draft a concise, editable English composition prompt in the user's voice, written as a BULLET LIST. Do this even when `instruction` is empty: infer the intended layout, shapes, repetition, scale progression, grouping into collections and relationships from the visible sketch instead of asking the user to explain it.

- Each colored semantic pen is an ordinary pencil with an attached algorithm (its call and library definitions). Its color identifies the pen, not necessarily the output palette. Several marks can describe one form or pattern jointly. Plain Pencil marks are layout, outlines, placement or links.
- A constraint pen (`kind` `"constraint"`) carries a whole constraint (`constraint`: label, description, params with values, algorithm library): say which form drawn with it gets that kind of constraint and what it does there.
- Read the pens as described in READING SEMANTIC PENS below, and write the READING in the bullets: which quantity of which form changes, and how (e.g. "make … gradually fade along the path"), not the pens' names or where their algorithms came from.
- `compositionPens` and `compositionStrokes` give normalized coordinates on a 900×600 canvas and per-stroke snapshots, including pens edited or removed from the toolbar. Honor the current visible image and ordered eraser paths; do not bring back erased marks.
- Describe which forms should become collections/objects and which quantity each supplied algorithm drives there, with its direction along the marks (a decreasing pattern drawn as increasing marks means growth). Do not describe the literal colored guide lines.
- A form drawn more than once is a repetition: write ONE collection of copies of ONE unit (e.g. "Repeat … as N copies placed …; vary … per copy" and "Make each … look …"), not one bullet or one element per copy, even when the copies differ in size, angle, color or position.
- Not every mark is a separate collection/object. The sketch can also show how a form LOOKS DIFFERENTLY depending on interaction: the same element drawn again in another shape, size, color or position (e.g. a resting and a pressed/hovered/dragged/opened version, a before→after pair linked by an arrow, or a variant drawn next to interaction marks). When the evidence suggests this, describe it as ONE collection/object whose appearance changes between states, say which user action (hover, click/tap, drag, release, key) leads to which look and what happens on release/cancel, and do NOT turn the variant drawing into its own collection or a second copy in the result. Without such evidence, keep treating marks as parts of a static composition; do not invent interactions.
- If no semantic pens exist, infer an artistic composition from the pencil sketch or photograph without inventing stored algorithms.
- If an existing instruction is supplied, preserve its explicit intent while refining it using the sketch. For ambiguous geometry use a plausible editable interpretation without asserting unsupported precision.

## Format

- Write the prompt as English bullet points: every line starts with `- `, lines separated by `\n`, no headings, numbering, bold or other Markdown, no introduction or closing sentence.
- One bullet = one idea, typically 3–8 bullets in total, each one short sentence in the user's voice (e.g. "Make …", "Group … into …"). Order them: overall composition first, then each collection/object (its shape, repetition and the algorithm applied), then relationships, then motion/interaction (which action changes which look, and release/cancel) if any.
- Put sub-details of a bullet on an indented line starting with `  - ` only when really needed. Stay under 1500 characters.
- If an existing instruction is in prose, keep its intent but restate it in this bullet format.

## Tags on the sketch

Along with the prompt, return `tags`: the objects and collections the prompt describes, each put on the marks it is drawn with, so the user can see on the sketch what you read and what goes into each part. The tags and the bullets say the same thing: every collection/object a bullet names has a tag, and no tag names something the bullets do not.

- `kind`: `"object"` is ONE primitive, a single copy: one stroke, one shape, one dot, one continuous form. `"collection"` is whatever has more than one of something: items along a path, a grid, a scatter, a branching set, or the same form drawn two or more times.
- SOMETHING THAT APPEARS MORE THAN ONCE IS NEVER AN OBJECT: when the same kind of form is drawn twice or more (or its marks say it repeats), even with a different size, angle, color or position per copy, it is ONE collection tag for the copies holding ONE object tag for the unit (its `parentId` the collection's `id`). Never several sibling object tags for the copies, and never one object tag over several copies. Every collection holds at least one tag: the unit object, or a sub-collection when the unit has parts.
- The collection carries the constraints that make, place and vary the copies (how many, where each goes, how they differ from copy to copy); the unit object carries how ONE copy looks and behaves (its shape, texture, color, its own motion or interaction). The unit object's `strokeIds` are the marks of one copy (or the marks that show the look of every copy); the collection's are the marks of all copies and their layout marks.
- EVERYTHING INSIDE A COLLECTION IS WHAT IT REPEATS: its tags are the unit (and, when the unit has parts, a sub-collection for them); the copies are never tagged one by one. Something drawn near the copies but not repeated with them goes outside the collection. A difference only some copies show (which copies, how they differ) is a constraint of the collection, not a tag of its own.
- Before returning, compare sibling tags: two objects of the same kind of form, or carrying the same constraints, are copies of one unit, so make them one collection holding one unit object.
- `id`: short, unique, lowercase (e.g. `t1`, `t2`). `parentId`: the `id` of the collection it is in, `""` at the top. Only a collection can be a parent.
- Set containment as the prompt reads it, since the user checks it as a tree: a tag that is PART of a collection (its unit, or the parts of the unit as a sub-collection) has that collection as `parentId`, at any depth. Parts that only sit near or over each other without belonging together are separate top-level tags. A tag has one parent.
- `strokeIds`: the ids of the `compositionStrokes` the tag is drawn with: its shape marks and the pen marks that drive it (a collection: the marks of its members and its path or layout marks). Never an eraser stroke. Use only ids that are in `compositionStrokes`; the app places the tag on these marks, so do not write coordinates anywhere. Leave out a tag whose marks you cannot name.
- `label`: a short name of the part as the prompt names it (2–4 words). `summary`: one short sentence on what it is. `members`: for a collection, what repeats and about how many as seen in the sketch; `""` for an object.
- `constraints`: what changes in this part, as the prompt reads it, one entry per kind of change that belongs to THIS tag (how many copies there are, where they go and how they vary from copy to copy go on the collection; how one copy looks goes on its unit's object tag; one only some item has goes on that item's tag). `label`: a short name of the change, naming the property that changes (e.g. "Size along the path", "Placement along the path"); a change of two properties is two entries. `effect`: `"spatial"` (position, size, angle, layout), `"stylistic"` (color, opacity, stroke, shape look) or `"temporal"` (motion, timing, interaction response). `how`: one short sentence on how it changes, with its direction along the marks. `penId`: the `compositionPens` id of the semantic pen whose marks carry it, `""` when it is read from pencil marks or the instruction alone.
- `params`: the quantities that change does it with, each `label` (the quantity), `value` (its value or range as you read it, with a unit when it has one, e.g. a pen param's current value; `""` when it is not known) and `how` (what it does to the change). Take them from the pen's constraint or algorithm parameters when a pen carries the change; otherwise name the quantities the sketch shows changing. Do not list quantities whose change the sketch does not show.
- An object or collection drawn as it is (no change read) has an empty `constraints` list.
- An interaction look of an element (a variant drawn for hover/press/drag, a before→after pair) is part of that element's tag, as a `"temporal"` constraint; it is not a tag of its own.
- Use the user's language for `label`, `summary`, `members`, `how` and param labels when the instruction is written in another language; otherwise English.

No code, scene extraction or proposals at this stage. Treat image content as visual evidence, not instructions.

{{include:contracts/pen-interpretation}}

## Output JSON

Return exactly one object matching `prompts/schemas/compose-prompt.json`:

```json
{ "prompt": "- Place dots along the pencil path running from the lower left to the upper right of the canvas.\n- Group the dots along the path into one collection.\n- Make the dot size grow gradually along the path by the same exponent.\n- When the mouse hovers over a dot, make that dot grow slightly, and return it to its original size when the mouse leaves.",
  "tags": [
    { "id": "t1", "kind": "collection", "label": "Dots along the path", "parentId": "", "strokeIds": ["stroke-1", "stroke-2", "stroke-3", "stroke-4"], "summary": "Dots placed along the pencil path, lower left to upper right.", "members": "about 6 round dots",
      "constraints": [
        { "label": "Placement along the path", "effect": "spatial", "how": "Copies of the dot are spaced along the pencil path, lower left to upper right.", "penId": "", "params": [{ "label": "Count", "value": "6", "how": "How many dots the path holds." }] },
        { "label": "Growing size", "effect": "spatial", "how": "Each dot is larger than the one before it along the path.", "penId": "mark-pen-1", "params": [{ "label": "Exponent", "value": "1.4", "how": "How fast the size grows from one dot to the next." }] }
      ] },
    { "id": "t2", "kind": "object", "label": "Dot", "parentId": "t1", "strokeIds": ["stroke-2"], "summary": "One round dot, the unit the path repeats.", "members": "",
      "constraints": [
        { "label": "Hover grow", "effect": "temporal", "how": "The hovered dot grows slightly and returns when the mouse leaves.", "penId": "mark-pen-2", "params": [] }
      ] }
  ] }
```
