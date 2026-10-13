## SCENE MODEL: Collections, Objects, semantic transformations and algorithms

A scene is a layer tree of **nodes**, like groups and shapes in Figma or PowerPoint.

- **Object** (`kind: "object"`): a basic visual primitive — one stroke family, a shape, a mark, a blob, a line, a dot, a text-like glyph, a photographed thing. `primitive` names it briefly in English (e.g. `"stroke"`, `"ellipse"`, `"polygon"`, `"curve"`, `"dot"`, `"blob"`, `"texture"`).
- **Collection** (`kind: "collection"`, `primitive: "group"`): groups objects and/or other collections that are selected and moved together. A collection is more than a group: its **semantic transformations** say what happens to its members as a whole (e.g. "Radial growth", "Branching recursion", "Wave propagation", "Fading repetition").
- Use `parentId` to nest: a node's parent must be a collection in the same response, or `null` for a root node. Objects can also stand alone at the root. Never create cycles.
- `region` is the node's normalized bounding box `x,y,w,h` (0–1) inside the supplied image, with `x+w ≤ 1`, `y+h ≤ 1`, `w,h > 0`. A collection's region should enclose its children.

Every node (collection or object) has a STACK of semantic transformations, `transformations: [{ id, label, description, properties[] }]` (0–4 per node), applied IN ORDER: each one builds on the result of the previous ones (e.g. a flower collection: 1 "Radial bloom" places the petals → 2 "Wind sway" bends them over time → 3 "Fading palette" colors them). Give each distinct semantic idea its OWN transformation instead of mixing unrelated properties into one; use one transformation when the node has a single idea.

- Transformation `id`s are unique within the node (kebab-case, e.g. `"radial-bloom"`). Property `id`s are unique across ALL transformations of the node (state machines and code address a property by node id + property id only).
- Max 8 properties per transformation, 16 per node.

- Each **property** has an `effect`:
  - `spatial` — position, layout, size, rotation, spacing, branching, path, density, deformation.
  - `stylistic` — color, palette, stroke weight, opacity, texture, fill, line quality.
  - `temporal` — speed, timing, growth over time, oscillation, delay, easing, decay over time.
- A property `value` is either a **scalar** or an **algorithm call**:
  - number `{ "type": "number", "value", "min", "max", "step", "unit" }` → shown as a slider. `min < max`, `0 < step ≤ max-min`, `min ≤ value ≤ max`.
  - color `{ "type": "color", "value": "#rrggbb" }`
  - select `{ "type": "select", "value", "options": [...] }` (value must be one of 2–8 options)
  - toggle `{ "type": "toggle", "value": true|false }`
  - algorithm call `{ "type": "algorithm", "algorithmId", "args": [{ "id": "<param id>", "value": <scalar or { "type": "algorithm-ref", "algorithmId" }> }] }`

**Algorithms** are reusable implementations listed once in the top-level `algorithms` array and referenced by id anywhere (several properties, several nodes, nested inside other algorithms). Each algorithm has:

- `id` (stable, kebab-case, e.g. `"sine-wave"`, `"power-decay"`, `"recursive-branch"`), English `name`, and a Korean `description` that states the procedural formula and the meaning of every parameter id precisely enough to implement it in code.
- `params[]`: `{ id, label, description, value }` where `value` is the default — a scalar, or `{ "type": "algorithm-ref", "algorithmId" }` when the parameter is itself driven by another algorithm (e.g. a branch `length` driven by `power-decay`, a `size` driven by `perlin-noise`). Max 8 params. No algorithm may refer to itself directly or indirectly. Max nesting depth 4.
- In a call, give `args` for the parameters you want to set; omitted args use the defaults. Use `algorithm-ref` in args to plug another algorithm into a parameter.

Prefer algorithms whenever behavior is procedural (curves, repetition, recursion, noise, decay, distributions, palettes, easing). Use plain scalars for simple constants. Reuse the same algorithm id when the same logic appears in several places. Include a few meaningful **alternative** algorithms in the library when useful (e.g. both `sine-wave` and `bezier-wave`) so the user can swap implementations.

### PROCEDURAL ECONOMY (required)

Build the scene with as FEW nodes as possible and generate repetition procedurally. Never enumerate instances.

- Elements that share their features (same primitive, same kind of look or behavior: petals, leaves, dots, bricks, stars, branches, waves, hatching lines, scattered marks, rows of windows …) are ONE node, never one node per instance — even when the instances differ in size, color, rotation or position. That node's region covers all instances, and its semantic transformation GENERATES them:
  - a `count` (number) and a distribution/layout algorithm (`row`, `grid`, `radial-repeat`, `scatter`, `along-path`, `recursive-branch`, `spiral` …) whose parameters reproduce the observed arrangement;
  - variation between instances expressed by algorithms over the instance index, depth or noise (e.g. size by `power-decay`, hue by `palette-gradient`, rotation by `perlin-noise`), not by separate nodes.
- If an instance has parts (a flower = petals + center), make ONE collection for the repeated unit and generate its copies with the collection's transformation; do not duplicate the collection.
- Split nodes only when they differ in kind (different primitive or a different semantic role), when the user must select/move them independently, or when they need their own state machine.
- Shared logic is ONE library algorithm referenced by id everywhere it applies; do not define near-duplicate algorithms.
- Repetition itself is a semantic transformation: put `count` + the distribution algorithm in its own transformation (e.g. "Radial repetition") and the look of one instance in the others.
- Prefer a nested collection hierarchy (whole → repeated unit → part) over many flat siblings. Typical scenes have 1–8 nodes; more than 12 needs a clear reason.

Example: seven petals around a center → one object `petals` (`primitive: "petal"`) with transformations "Petal shape" (`size` = `perlin-noise(...)`, `tint`) and "Radial repetition" (`count` = 7, `layout` = `radial-repeat(radius, phase)`), plus one object `center`. NOT `petal-1` … `petal-7`.

Repeated sibling nodes are rejected and must be rewritten.

Ids are unique within their list (node ids within the scene, property ids within a node, param ids within an algorithm). Use concise English names/labels and Korean descriptions.
