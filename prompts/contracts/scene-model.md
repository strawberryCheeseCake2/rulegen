## SCENE MODEL: Collections, Objects, semantic transformations and algorithms

A scene is a layer tree of **nodes**, like groups and shapes in Figma or PowerPoint.

- **Object** (`kind: "object"`): ONE basic visual primitive, the unit — a stroke, a shape, a mark, a blob, a line, a dot, a text-like glyph, a photographed thing. `primitive` names it briefly in English (e.g. `"stroke"`, `"ellipse"`, `"polygon"`, `"curve"`, `"dot"`, `"blob"`, `"texture"`). Its transformations say how ONE of it looks and behaves (its shape, color, texture, its own motion).
- **Collection** (`kind: "collection"`, `primitive: "group"`): groups objects and/or other collections that are selected and moved together. A collection is more than a group: its **semantic transformations** say what happens to its members as a whole (e.g. "Radial growth", "Branching recursion", "Wave propagation", "Fading repetition"). MAKING COPIES IS A COLLECTION'S JOB: how many copies of its members there are, where each one goes (layout, path, flow, scatter, recursion) and how they vary from copy to copy (size falloff by index, hue drift by copy, rotation by noise) are transformations of the collection, never of the object it repeats.
- Use `parentId` to nest: a node's parent must be a collection in the same response, or `null` for a root node. Objects can also stand alone at the root. Never create cycles. Nesting may go up to **5 levels** (root = level 1).
- `region` is the node's normalized bounding box `x,y,w,h` (0–1) inside the supplied image, with `x+w ≤ 1`, `y+h ≤ 1`, `w,h > 0`. A collection's region should enclose its children.

### HIERARCHY: keep coherent objects whole, nest only different parts

- REPEATED UNITS ARE A COLLECTION WITH ONE MEMBER: when the same primitive appears as many copies — the strokes of a swirl, the branches of a tree, the petals of a flower, the hatching lines of a shadow, scattered dots, stars — make ONE collection for the copies and ONE object inside it for the unit (one stroke, one branch, one petal), however many copies there are and even if they differ in size, angle, color or position. The collection's transformations make and arrange the copies and their differences (e.g. "Flow-following placement", "Recursive branching", "Radial repetition", "Size falloff by copy"); the member object's transformations give the look of one copy (e.g. "Bristle texture", "Petal curl", "Ink taper"). Never list the copies as separate objects, and never put the count or placement of copies on the object.
- KEEP ONE FORM WHOLE: a single continuous form (one outline, one blob, one ground fill, one crescent, the bands of one rainbow drawn as one shape) stays ONE object; express its internal variation with its own transformations, never by splitting it into sub-objects. A single simple mark or shape also stays ONE object.
- Nest only parts that are clearly DIFFERENT in kind: a tree = trunk + crown + fruit, a face = head shape + eyes + mouth, a building = facade + window grid + roof. Such a large mass becomes a **nested collection hierarchy** (whole → part groups → parts), up to 5 levels deep, instead of a long flat list of objects; each kind of part inside it stays a whole object.
- Each level gets its own semantic transformations: what the outer collection does to everything inside (e.g. "Upward growth", "Wind sway"), what an inner collection does to its members, and what an object does to its primitive.
- A collection or the root should not hold a long flat list of objects (6 or more): group the different parts into nested collections — by grouping, not by splitting objects further.

Every node (collection or object) has a STACK of semantic transformations, `transformations: [{ id, label, description, properties[] }]` (up to 10 per node), applied IN ORDER: each one builds on the result of the previous ones.

### FINE-GRAINED TRANSFORMATIONS (required)

Split the semantics as finely as possible. One transformation = ONE semantic operation, named for what it does, usually with 1–3 properties.

- Good labels are operations: "Radial repetition", "Outward size decay", "Petal curl", "Hue drift by ring", "Edge jitter", "Ink fade toward tips", "Wind sway", "Staggered bloom". Each would make sense as its own toggle in a list of effects.
- NEVER bucket by effect type: there is no "Spatial" / "Style" / "Temporal" / "Color" / "Layout" / "Motion" / "Appearance" transformation, and never one transformation per effect type. Effects (`spatial`, `stylistic`, `temporal`) are tags on properties, not a way to group them.
- If a transformation would need 4 or more properties, it is probably two or three operations: split it.
- A rich node typically has 3–8 transformations; a simple one may have 1–2. Order them as they apply (placement → shape → variation → style → motion).
- Example, a flower collection: 1 "Radial bloom" (`count`, `layout`) → 2 "Petal size falloff" (`size`) → 3 "Petal curl" (`curl`) → 4 "Hue drift by petal" (`hue-shift`, `base-color`) → 5 "Wind sway" (`sway`, `speed`).
- Transformation `id`s are unique within the node (kebab-case, e.g. `"radial-bloom"`). Property `id`s are unique across ALL transformations of the node (state machines and code address a property by node id + property id only).
- Max 8 properties per transformation, 32 per node.
- A property in the supplied scene may carry a `handle` (the user's direct manipulation widget). It is UI only: ignore it, and never output it.

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

- `id` (stable, kebab-case, e.g. `"sine-wave"`, `"power-decay"`, `"recursive-branch"`), English `name`, and an English `description` that states the procedure (the actual technique that produces the observed look, not a formula fitted to its shapes) and the meaning of every parameter id precisely enough to implement it in code.
- `params[]`: `{ id, label, description, value }` where `value` is the default — a scalar, or `{ "type": "algorithm-ref", "algorithmId" }` when the parameter is itself driven by another algorithm (e.g. a branch `length` driven by `power-decay`, a `size` driven by `perlin-noise`). Max 8 params. No algorithm may refer to itself directly or indirectly. Max nesting depth 4.
- In a call, give `args` for the parameters you want to set; omitted args use the defaults. Use `algorithm-ref` in args to plug another algorithm into a parameter.

Prefer algorithms whenever behavior is procedural (curves, repetition, recursion, noise, fields, simulation, growth, packing, decay, distributions, palettes, easing — these are examples, not a limit). Use plain scalars for simple constants. Reuse the same algorithm id when the same logic appears in several places. Include a few meaningful **alternative** algorithms in the library when useful (e.g. both `sine-wave` and `bezier-wave`) so the user can swap implementations.

### PROCEDURAL ECONOMY (required)

Build the scene with as FEW nodes as possible and generate repetition procedurally. Never enumerate instances.

- Elements that share their features (same primitive, same kind of look or behavior: petals, leaves, dots, bricks, stars, branches, waves, hatching lines, scattered marks, rows of windows …) are ONE repetition, never one node per instance — even when the instances differ in size, color, rotation or position: a collection whose region covers all instances, holding ONE member object (the unit). The collection's semantic transformation GENERATES the copies:
  - a `count` (number) and a distribution/layout algorithm whose parameters reproduce the observed arrangement as closely as possible. Use whatever technique actually produces it; the following are only examples and not a list to choose from: `row`, `grid`, `radial-repeat`, `scatter`, `along-path`, `recursive-branch`, `spiral`, streamlines traced through a vector field, packing, relaxation, growth or other simulations;
  - variation between instances expressed by algorithms over the instance index, depth or noise (e.g. size by `power-decay`, hue by `palette-gradient`, rotation by `perlin-noise`), not by separate nodes.
- If an instance has parts (a flower = petals + center), the repeated unit is itself a collection of those parts: make ONE collection for it and generate its copies with the transformation of the collection around it; do not duplicate the collection.
- Split nodes only when they differ in kind (different primitive or a different semantic role), when the user must select/move them independently, or when they need their own state machine. Adjacent or overlapping sibling objects with the same primitive are usually copies of one unit: make them one collection with one member, not several objects.
- Shared logic is ONE library algorithm referenced by id everywhere it applies; do not define near-duplicate algorithms.
- Repetition itself is a semantic transformation of the collection: put `count` + the distribution algorithm in its own transformation (e.g. "Radial repetition"), the variation across copies in the collection's other transformations, and the look of one instance in the member object's transformations.
- Prefer a nested collection hierarchy (whole → repeated unit → part) over many flat siblings. Keep the node count low by generating repetition, not by flattening structure: a rich image is usually 4–15 nodes over 2–5 levels.

Example: seven petals around a center → a collection `petals` with transformations "Radial repetition" (`count` = 7, `layout` = `radial-repeat(radius, phase)`) and "Petal size variation" (`size` = `perlin-noise(...)` over the copy index), holding ONE object `petal` (`primitive: "petal"`) with "Petal shape" (`curl`, `tint`); plus one object `center`. NOT `petal-1` … `petal-7`, and NOT one object `petals` that holds the count and layout itself.

Ids are unique within their list (node ids within the scene, property ids within a node, param ids within an algorithm). Use concise English names/labels and English descriptions.
