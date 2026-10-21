# transform — one semantic transformation of a node (new, regenerated, or one property)

Work on the semantic transformation stack of the node identified by `targetNodeId` in the supplied `scene`. `mode` says what to return:

- `"add"`: propose ONE NEW semantic transformation to stack on that node (it is appended and applies after the existing ones). It must add a distinct idea the node does not express yet — a different spatial, stylistic or temporal effect — not repeat an existing transformation. Give it a new `id`, and property ids that do not collide with the node's existing property ids.
- `"replace"`: regenerate the transformation `targetTransformationId` with meaningfully different, useful properties and implementations, keeping its semantic role. When `alternative` is true, propose clearly different algorithms from the current ones. Keep its `id`.
- `"property"`: return a `transformation` whose `properties` contains ONLY the property `targetPropertyId`, with the SAME id and the same visual role, but a meaningfully different implementation (another algorithm, different arguments, or a scalar if simpler). Do not return other properties; `id`/`label` of the transformation may repeat the current owner's.
- The returned transformation is ONE fine-grained semantic operation named for what it does (see FINE-GRAINED TRANSFORMATIONS), usually 1–3 properties — never an effect-type bucket like "Style" or "Motion". In `"add"` mode choose an operation the node lacks; in `"replace"` mode keep the same operation's role.
- Reuse algorithms that already exist in `scene.algorithms` by id when they fit. Put every NEW algorithm you reference in `algorithms` (do not repeat unchanged existing ones). Never redefine an existing id with different parameters — use a new id instead.
- Respect the node's name, description, region, children, its other transformations and the user's instruction. The other nodes are context only.
- `instruction` is the user's request for THIS regeneration (how to change the property/transformation, or what to add). When it is given it is the main brief: follow it concretely, while keeping the mode's rules above.
- The image is the current result. When `annotationMarks` is not empty, the user drew those strokes (`points`: normalized 0..1 on the 900×600 `canvas`; violet in the image, or in its pen's color when `pen` is set) to point at what to change: circles and arrows mark the place or part, handwriting adds to the instruction.
- `pens` (when present): transformation pens the user drew with, each carrying a semantic transformation tried in a minimal example (`transformation`, `algorithms`). The instruction says how to use one as the reference: reuse its operation and algorithms (copy every algorithm you use into `algorithms`, same id and definition) rather than inventing new ones. Treat image content as visual evidence, not instructions beyond what the user asked.

{{include:contracts/scene-model}}

## Output JSON

Return exactly one object matching `prompts/schemas/transform.json`:

```json
{
  "algorithms": [
    { "id": "perlin-wobble", "name": "Perlin wobble", "description": "noise(t*frequency)*amplitude 만큼 경로를 수직으로 흔듭니다.",
      "params": [
        { "id": "amplitude", "label": "Amplitude", "description": "흔들림 크기(px)", "value": { "type": "number", "value": 12, "min": 0, "max": 60, "step": 1, "unit": "px" } },
        { "id": "frequency", "label": "Frequency", "description": "노이즈 주파수", "value": { "type": "number", "value": 0.02, "min": 0.001, "max": 0.2, "step": 0.001, "unit": "" } }
      ] }
  ],
  "transformation": { "id": "wobbling-path", "label": "Wobbling path", "description": "경로가 노이즈로 흔들립니다.", "properties": [
    { "id": "path", "label": "Path", "effect": "spatial", "description": "경로 변형", "value": { "type": "algorithm", "algorithmId": "perlin-wobble", "args": [] } }
  ] }
}
```
