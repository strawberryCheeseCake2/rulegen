## SCENE MODEL: Collections, Objects, FSMs and constraints

Model the artwork as expressively as possible with declarative **collection and object FSMs**. The declarations reveal each meaningful phase of behavior, the events that move between phases, and the relationships (**constraints**) that determine each property in each phase. The formulas themselves are written later as named compute functions in code; the scene declares what each one controls, what it depends on and the parameters it is tuned by.

A scene is a layer tree of **nodes**, like groups and shapes in Figma or PowerPoint.

- **Object** (`kind: "object"`): ONE simple, indivisible primitive with one role — a stroke, a shape, a mark, a blob, a line, a dot, a text-like glyph, a photographed thing. `primitive` names it briefly in English (e.g. `"stroke"`, `"ellipse"`, `"polygon"`, `"curve"`, `"dot"`, `"blob"`, `"texture"`). Objects are leaves. Its constraints determine the properties of ONE of it (its shape, color, texture, its own motion), and only the properties needed for its role.
- **Collection** (`kind: "collection"`, `primitive: "group"`): holds objects and/or child collections that are selected and moved together, at any depth. A collection owns what its members share and the relationships among them: its constraints determine group properties (where each member goes, how many there are, how they relate). MAKING COPIES IS A COLLECTION'S JOB: how many copies of its members there are, where each one goes (layout, path, flow, scatter, recursion) and how they vary from copy to copy (size falloff by index, hue drift by copy, rotation by noise) are constraints of the collection, never of the object it repeats.
- Use `parentId` to nest: a node's parent must be a collection in the same response, or `null` for a root node. Objects can also stand alone at the root. Never create cycles. Nesting may go up to **5 levels** (root = level 1).
- `region` is the node's normalized bounding box `x,y,w,h` (0–1) inside the supplied image, with `x+w ≤ 1`, `y+h ≤ 1`, `w,h > 0`. A collection's region should enclose its children.
- Each collection and each object has its OWN FSM and current state (see STATE MACHINES), even when the code draws many instances of one node: each instance has its own state.

### HIERARCHY: keep coherent objects whole, nest only different parts

- REPEATED UNITS ARE A COLLECTION WITH ONE MEMBER: when the same primitive appears as many copies — the strokes of a swirl, the branches of a tree, the petals of a flower, the hatching lines of a shadow, scattered dots, stars — make ONE collection for the copies and ONE object inside it for the unit (one stroke, one branch, one petal), however many copies there are and even if they differ in size, angle, color or position. The collection's constraints make and arrange the copies and their differences (its `positions`, `count`, `size` falloff across copies…); the member object's constraints give the look of one copy (its `shape`, `texture`, `color`…). Never list the copies as separate objects, and never put the count or placement of copies on the object.
- KEEP ONE FORM WHOLE: a single continuous form (one outline, one blob, one ground fill, one crescent, the bands of one rainbow drawn as one shape) stays ONE object; express its internal variation with its own constraints, never by splitting it into sub-objects. A single simple mark or shape also stays ONE object.
- Nest only parts that are clearly DIFFERENT in kind: a tree = trunk + crown + fruit, a face = head shape + eyes + mouth, a building = facade + window grid + roof. Such a large mass becomes a **nested collection hierarchy** (whole → part groups → parts), up to 5 levels deep, instead of a long flat list of objects; each kind of part inside it stays a whole object.
- Each level gets its own constraints: what the outer collection determines for everything inside (e.g. its `growth`, its `sway`), what an inner collection determines for its members, and what an object determines for its primitive.
- A collection or the root should not hold a long flat list of objects (6 or more): group the different parts into nested collections — by grouping, not by splitting objects further.

### CONSTRAINTS (required)

Every node (collection or object) has `constraints: [{ id, property, description, params[], inputs[], drags[] }]` (up to 10 per node). A constraint expresses a relationship between objects, collections, or their members, and determines ONE property of the node that owns it:

- `property` — EXACTLY the name of the property it controls, as a short lowercase identifier: `"position"`, `"positions"`, `"size"`, `"rotation"`, `"color"`, `"count"`, `"branches"`, `"length"`, `"opacity"`, `"stroke-weight"`, `"path"`… The code stores the computed value in the owner's data under this name.
- `description` — how the property depends on the other objects, collections, members, the input or time, in the user's language (e.g. "Stays a fixed distance behind the leader", "Each petal shrinks with its index around the ring", "Darkens where the strokes overlap").
- `params` — the parameters the computation is tuned by (scalar sliders, see PARAMS), usually 1–4. Every quantity the computation uses (a decay ratio, a radius, a noise scale, a phase) is its own param; the `description` says in words how they combine (e.g. "branch length is multiplied by the decay ratio at each depth").
- Give each meaningful constrained property its OWN constraint on the node whose property changes. Review both the object and collection levels for relationships such as proximity, membership, ordering, alignment, attachment and collision, and make them constraints of the node that owns the changing property. Keep neighbor lookups, contact tests and intermediate calculations inside the constraint that uses them (they are part of its compute function), and unrelated drawing in ordinary code.
- NEVER bucket by effect type: there is no "spatial" / "style" / "motion" / "appearance" / "layout" constraint. A constraint is named by the one property it determines. If one would control two properties, it is two constraints.
- DECLARE CONSTRAINTS IN EVALUATION ORDER, dependencies first: a constraint may read properties computed by constraints before it (e.g. `rotation` faces the leader from the `position` just computed). A node without its own machine evaluates all its constraints in this declared order.
- A rich node typically has 3–8 constraints; a simple one may have 1–2.
- Example, a flower collection: `count` (`count`) → `positions` "petals spread on a ring around the center" (`radius`, `phase`) → `size` "each petal shrinks by the decay ratio with its index" (`base-size`, `decay`) → `rotation` "each petal points away from the center, swaying in the wind" (`sway`, `speed`) → `color` "hue drifts petal by petal" (`hue-shift`, `base-color`).
- Constraint `id`s are unique within the node (kebab-case, usually the property name, e.g. `"positions"`; a second constraint on the same property in another state gets its own id, e.g. `"size-hovered"`). Param `id`s are unique across ALL constraints of the node (code addresses a param by node id + param id only).
- Max 8 params per constraint, 32 per node.
- A param in the supplied scene may carry a `handle` (the user's direct manipulation widget). It is UI only: ignore it, and never output it.

### PARAMS

Each **param** `{ id, label, effect, description, value }` is a value the user tunes:

- `effect`:
  - `spatial` — position, layout, size, rotation, spacing, branching, path, density, deformation.
  - `stylistic` — color, palette, stroke weight, opacity, texture, fill, line quality.
  - `temporal` — speed, timing, growth over time, oscillation, delay, easing, decay over time.
- A param `value` is always ONE **scalar**:
  - number `{ "type": "number", "value", "min", "max", "step", "unit" }` → shown as a slider. `min < max`, `0 < step ≤ max-min`, `min ≤ value ≤ max`.
  - color `{ "type": "color", "value": "#rrggbb" }`
  - select `{ "type": "select", "value", "options": [...] }` (value must be one of 2–8 options)
  - toggle `{ "type": "toggle", "value": true|false }`
- A procedural computation (curves, repetition, recursion, noise, fields, simulation, growth, packing, decay, distributions, palettes, easing) is described in the constraint's `description` and tuned by several scalar params (e.g. a branching `length` constraint with `base-length`, `decay`, `depth`; a `select` param such as `wave-shape` with options `sine`/`bezier` lets the user swap techniques).

### POINTER INPUT: which constraint's value the mouse drives

Every constraint has `inputs: [{ source, paramId, how }]`: what it reads from the user's pointer (mouse or touch). Most constraints do not follow the pointer: give them `[]`.

- `source` — the pointer attribute: `x`, `y` (position), `dx`, `dy` (movement between frames), `speed`, `direction` (angle of the motion), `distance` (dragged from the press), `duration` (time held), `pressed` (held or not).
- `paramId` — the param OF THIS SAME CONSTRAINT whose value the attribute is mapped to: the value it drives, scales or ranges (e.g. `speed` → a width or spacing param, `x` → a hue offset param, `duration` → a growth amount param). Give such a param whenever the mapping has a strength or range to tune, so the user sees and adjusts it; use `""` only when the pointer drives the property itself without any value of it (e.g. a `position` that follows the drag).
- `how` — a few words on how it maps ("scales the width", "sets the hue left to right", "follows the drag").
- One entry per attribute → value: a constraint reading both `x` and `y` lists both. Keep each mapping on the constraint whose property uses the pointer, never in an extra catch-all "mouse" constraint. A press that only fires a state machine transition belongs to the machine (an event the code dispatches), not to `inputs`.

### VALUE DRAG: the mouse's x, y and speed adjust values, as a metaphor

EVERY constraint, of any object or collection (interactive or not), also has `drags: [{ paramId, source, mode, invert, how }]` (0–2): which of its values the MOUSE moves while the user drags on the drawn object in the app (the app changes the value; the code only reads it as usual). While dragging, every mapped value of the object moves at once: one by the mouse's x, one by its y, one by its speed. Map them so the hand's motion IS what the value does to the picture. Give one for the constraint's most visible number value whenever an attribute fits it; `[]` only when none does.

- `paramId` — a NUMBER param OF THIS SAME CONSTRAINT.
- `source` — the mouse attribute whose meaning matches the value's effect:
  - `"x"` (left → right): what spreads, spaces, widens, leans or shifts sideways, or runs along a left-to-right scale (a width, a horizontal spacing, a spread, a lean, a hue across);
  - `"y"` (down → up): what grows, rises, stacks or heightens (a height, a length upward, a lift, a count piled up, a growth amount);
  - `"speed"` (slow → fast): what a faster, more energetic hand makes more of (a stroke width, a jitter, a splash, a spread of a burst, a motion speed, a blur).
  Each attribute moves ONE value of the object: across the node's constraints use each of `x`, `y`, `speed` at most once (the first constraint using one gets it).
- `mode` (for `x`, `y`; speed always spans the value's range from still to fast) — `"direct"` by the pixels dragged when the value is in pixels; `"ratio"` in proportion (dragged the object's size: twice the value) for sizes, counts and scales; `"range"` across the value's min–max over the object's size for values in other units.
- `invert` — `true` when the natural direction makes it SMALLER (dragging right narrows it, dragging up lowers it, a faster hand thins it); else `false`.
- `how` — a few words on the metaphor, as the user would say it ("drag up to grow the branches", "drag right to space the copies", "faster strokes splash wider").

### STATE MACHINES: one FSM per collection and per object

Every node has `machine`: its FSM, or `null`. `null` means ONE implicit state that evaluates all the node's constraints in their declared order, all the time — right for a node with one mode of behavior throughout the sketch.

A machine is `{ initialState, states: [{ id, label, description, constraintIds }], transitions: [{ id, from, to, event, label }] }`:

- A **state** is one phase of the node's behavior. `constraintIds` lists, IN EVALUATION ORDER (dependencies first), the node's constraints that apply in that phase: whenever the code evaluates the node's FSM, the current state's constraints are computed one after another, each storing its property before the next one runs. A state may evaluate any of the node's constraints, and different states may determine the same property with different constraints (e.g. `size` in `idle`, `size-hovered` in `hovered`: two constraints, both with `property: "size"`).
- A **transition** is taken when the code dispatches its `event` while the node is in `from`. `event` is a short kebab-case name the code dispatches (e.g. `"pointer-enter"`, `"drag-start"`, `"released"`, `"absorbed"`, `"grown"`); several transitions may share an event from different states, but one state has at most one transition per event. `label` says WHY in words (see the interaction contract).
- Give a phase its own state when different relationships apply (a different set or order of constraints), different actions become possible, or the node changes how it participates in the artwork. For example, an object that is active until it is absorbed has distinct `active` and `absorbed` states, with a transition driven by the `absorbed` event. Declare these behavior changes explicitly in the FSM; use flags and branches inside compute functions only for calculations within a phase.
- Put behavior for an individual member in its OBJECT's FSM and behavior shared by the group in its COLLECTION's FSM.
- State and transition `id`s are unique within the machine (kebab-case). Max 32 states and 128 transitions per node.

### PROCEDURAL ECONOMY (required)

Build the scene with as FEW nodes as possible and generate repetition procedurally. Never enumerate instances.

- Elements that share their features (same primitive, same kind of look or behavior: petals, leaves, dots, bricks, stars, branches, waves, hatching lines, scattered marks, rows of windows …) are ONE repetition, never one node per instance — even when the instances differ in size, color, rotation or position: a collection whose region covers all instances, holding ONE member object (the unit). The collection's constraints GENERATE the copies:
  - a `count` constraint (a number param) and a `positions` constraint whose distribution/layout rule (described in words, tuned by its params) reproduces the observed arrangement as closely as possible. Use whatever technique actually produces it; the following are only examples and not a list to choose from: `row`, `grid`, `radial-repeat`, `scatter`, `along-path`, `recursive-branch`, `spiral`, streamlines traced through a vector field, packing, relaxation, growth or other simulations;
  - variation between instances expressed by constraints computed over the instance index, depth or noise (e.g. `size` decaying by a power of the index, `color` along a palette gradient, `rotation` by Perlin noise), not by separate nodes.
- If an instance has parts (a flower = petals + center), the repeated unit is itself a collection of those parts: make ONE collection for it and generate its copies with the constraints of the collection around it; do not duplicate the collection.
- Split nodes only when they differ in kind (different primitive or a different semantic role), when the user must select/move them independently, or when they need their own FSM. Adjacent or overlapping sibling objects with the same primitive are usually copies of one unit: make them one collection with one member, not several objects.
- Prefer a nested collection hierarchy (whole → repeated unit → part) over many flat siblings. Keep the node count low by generating repetition, not by flattening structure: a rich image is usually 4–15 nodes over 2–5 levels.

Example: seven petals around a center → a collection `petals` with constraints `count` (`count` = 7), `positions` "on a ring around the center" (`radius`, `phase`) and `size` "varies petal by petal with noise over the copy index" (`base-size`, `noise-amount`), holding ONE object `petal` (`primitive: "petal"`) with constraints `shape` "curls at the tip" (`curl`) and `color` (`tint`); plus one object `center`. NOT `petal-1` … `petal-7`, and NOT one object `petals` that holds the count and layout itself.

Ids are unique within their list (node ids within the scene, constraint ids and param ids within a node). Use concise English names/labels and English descriptions.
