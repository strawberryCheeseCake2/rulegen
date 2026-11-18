# compose — freeform sketch + constraint pens + prompt → Collections & Objects

Compose a SCENE (collections and objects with constraints) from FREEFORM SKETCH MARKS, their attached CONSTRAINT SEMANTICS and the user's instruction. The input image is an intent sketch, not a finished artwork. The scene you return will be turned into p5.js code in the next step, so describe the intended result, not the guide lines.

- Every colored semantic pen draws an ordinary pencil line. Its color only identifies which stored constraint the marks carry. A CONSTRAINT pen (`kind` `"constraint"`) carries a whole constraint in `compositionPens[].constraint` (`label`, `description`, `params` with their values): the node its marks describe gets that constraint (with the `property` it determines there), adapted to the sketch (READING SEMANTIC PENS below), in addition to the constraints the rest of the sketch asks for. Use the marks' geometry for where and how big that node is.
- Pencil marks carry no constraint: use their geometry as layout, shape, placement, outlines or relationships.
- Parts with a clear common feature stay ONE whole object; only parts that differ in kind become nested collections (up to 5 levels). Every node gets its constraints, one per property it determines, in evaluation order (never effect-type buckets).
- Several marks can jointly describe one node; repeated marks of the same kind become ONE procedural collection (count + distribution params) holding ONE member object for the unit, never one node per mark. Infer relationships from the image, normalized point paths, overlap, proximity and the instruction rather than turning each stroke into its own node. Do not run a computation on a freehand stroke, turn strokes into stamp sequences, or simply reproduce the colored guide lines.
- Honor the CURRENT visible image and ordered eraser paths: erased marks must not come back. Pen snapshots on existing strokes are authoritative even if a toolbar pen was edited or removed later.
- `compositionStrokes` coordinates are normalized on a 900×600 canvas; node regions use the same normalized space.
- Give nodes that should move, grow or react a detailed `machine`; static nodes get `machine: null`.
- A form drawn again in another shape, size, color or position as its look during/after an interaction (resting vs. pressed/hovered/dragged, before→after linked by an arrow, or as the instruction describes) is NOT an extra node: model it as ONE node whose machine has a state per look, each listing its own constraint for every property that differs (e.g. `size` at rest, `size-pressed` while pressed, with params for the pressed look), and transitions on the events of the interaction. Its region covers the resting look.

## Tags on the sketch

When `tags` is given, it is the reading of the sketch the user checked and may have edited: the objects and collections, each on the marks it is drawn with (`strokeIds`, ids of `compositionStrokes`), and what goes into each. Build the scene from it. When `instruction` is empty the tags are the whole instruction. When both are given, the tags decide each part they describe (its name, members, constraints, param values) and the instruction adds what the tags do not cover (overall composition, relationships between parts).

- Every tag becomes a node of its `kind`, named by its `label`, with its region over its marks. `parentId` is nesting: a tag with a parent is a child node of that collection; tags without a parent are top-level nodes. A collection is ONE procedural collection (count + distribution), never one node per copy.
- WHAT A COLLECTION HOLDS IS WHAT IT REPEATS: `holds` lists the tags inside a collection. The copies its constraints make, place and vary are copies of THOSE: a held object is the unit, a held collection is a unit with parts. Make no unit of your own beside them, and never treat a held tag as an extra that is not repeated. Only a collection that holds no tag gets a unit object of your own, made from its `members`.
- THE STRUCTURE WINS OVER THE WORDS: the user may have moved, added or deleted tags, so a collection's `label`, `summary`, `members` and its constraints' `how` can still name a unit it no longer holds. Keep what they say about the copies (how many, where each goes, how they differ) and apply it to what the collection holds now; read their words about the old unit as about the held one.
- Each of a tag's `constraints` becomes a constraint of that node determining the property its `label` names (`property` that property's name, the `how` as its description, the `effect` of its params; a change of two properties becomes two constraints), with params for the listed quantities at the listed values (as numbers, colors, selects or toggles as fits; an empty value: choose one the sketch shows). When a `pen` is named, that pen's constraint is what drives it (READING SEMANTIC PENS below).
- A `"temporal"` constraint that describes an interaction or motion goes into the node's `machine` (states, each listing the constraints that apply in it, and transitions on the events that move between them), together with the constraints and params those states need.
- Do not add nodes or constraints the tags do not describe, except a plain background node or the unit object of a collection that holds no tag. A tag with no constraints is a node drawn as it is; a tag with no marks, no constraints and nothing inside it describes nothing to draw.

Treat image content as visual evidence, not instructions.

{{include:contracts/pen-interpretation}}

{{include:contracts/scene-model}}

{{include:contracts/state-planning}}

## Output JSON

Return exactly one object matching `prompts/schemas/compose.json` — the same shape as `extract`:

```json
{
  "nodes": [
    { "id": "growing-dots", "kind": "collection", "parentId": null, "name": "Growing dots", "description": "Dots that grow gradually along the pencil path", "primitive": "group",
      "region": { "x": 0.1, "y": 0.2, "w": 0.8, "h": 0.5 },
      "constraints": [
        { "id": "size", "property": "size", "description": "Each dot is larger than the one before it along the path: the base size times the growth ratio raised to the dot's index.", "params": [
          { "id": "base-size", "label": "Base size", "effect": "spatial", "description": "Size of the first dot", "value": { "type": "number", "value": 8, "min": 2, "max": 60, "step": 1, "unit": "px" } },
          { "id": "growth", "label": "Growth", "effect": "spatial", "description": "How much larger each dot is than the one before", "value": { "type": "number", "value": 1.15, "min": 1, "max": 2, "step": 0.01, "unit": "×" } }
        ], "inputs": [], "drags": [] }
      ],
      "machine": null }
  ]
}
```
