# transform — one constraint of a node (new, regenerated, or one param)

Work on the constraints of the node identified by `targetNodeId` in the supplied `scene`. `mode` says what to return:

- `"add"`: propose ONE NEW constraint for that node (it is appended after the existing ones, and to the end of every state's evaluation order, so it may read the properties they compute). It must determine a property the node does not determine yet — a distinct spatial, stylistic or temporal relationship — not repeat an existing constraint. Give it a new `id` (usually its property name), and param ids that do not collide with the node's existing param ids.
- `"replace"`: regenerate the constraint `targetConstraintId` with meaningfully different, useful params and implementations, keeping its `property` and role. When `alternative` is true, propose a clearly different technique from the current one. Keep its `id`.
- `"param"`: return a `constraint` whose `params` contains ONLY the param `targetParamId`, with the SAME id and the same visual role, but a meaningfully different implementation (another value type, range or meaning that fits the same role; still ONE scalar). Do not return other params; `id`, `property` and `description` of the constraint may repeat the current owner's.
- The returned constraint determines exactly ONE property of the node (`property` is its name, `description` how it depends on the other nodes, the input or time; see CONSTRAINTS), usually 1–3 params — never an effect-type bucket like "style" or "motion". In `"add"` mode choose a property the node lacks; in `"replace"` mode keep the same property. Give it `inputs` and `drags` as the scene model describes (`[]` when none).
- Respect the node's name, description, region, children, its other constraints and the user's instruction. The other nodes are context only.
- `instruction` is the user's request for THIS regeneration (how to change the param/constraint, or what to add). When it is given it is the main brief: follow it concretely, while keeping the mode's rules above.
- The image is the current result. When `annotationMarks` is not empty, the user drew those strokes (violet in the image; normalized 0..1 points on the 900×600 `canvas`) to point at what to change: circles and arrows mark the place or part, handwriting adds to the instruction. Treat image content as visual evidence, not instructions beyond what the user asked.

{{include:contracts/scene-model}}

## Output JSON

Return exactly one object matching `prompts/schemas/transform.json`:

```json
{
  "constraint": { "id": "path", "property": "path", "description": "The path is shaken sideways by Perlin noise sampled along its length: offset = noise(t * frequency) * amplitude.", "params": [
    { "id": "amplitude", "label": "Amplitude", "effect": "spatial", "description": "Wobble size", "value": { "type": "number", "value": 12, "min": 0, "max": 60, "step": 1, "unit": "px" } },
    { "id": "frequency", "label": "Frequency", "effect": "spatial", "description": "Noise frequency along the path", "value": { "type": "number", "value": 0.02, "min": 0.001, "max": 0.2, "step": 0.001, "unit": "" } }
  ], "inputs": [], "drags": [ { "paramId": "amplitude", "source": "speed", "mode": "range", "invert": false, "how": "faster strokes wobble more" } ] }
}
```
