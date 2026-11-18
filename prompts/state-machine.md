# state-machine — plan the FSM of ONE collection or object

Plan the FSM for the node identified by `targetNodeId` in the supplied `scene`, using the sketch image, ordered `compositionStrokes` (including interaction annotations), the node's constraints and the user instruction. Infer the meaningful phases of movement, growth, interaction or relationship from the dynamic intent, and in each phase which of the node's constraints determine its properties, in what order. Never invent motion the sketch/instruction does not suggest; if the node truly has one mode of behavior, return a single state that evaluates all its constraints and no transitions.

- A state lists `constraintIds`: constraints OF THE TARGET NODE (its existing ones, by id, and new ones you add in `constraints`), in evaluation order, dependencies first. Every existing constraint that still applies in a phase is listed there; a constraint left out of a state does not run in it.
- When a phase needs a property to depend on something else (a different relationship, a different params' range), add a NEW constraint for that property in `constraints` (`property` the same name, its own `id`, `description`, `params`, `inputs: []`, `drags: []`) and list it in that phase instead of the other one. Param ids of new constraints must not collide with the node's existing param ids. Never redefine an existing constraint; `constraints: []` when the node's constraints are enough.
- If `scene` already contains a machine for the node, refine it into finer meaningful phases while preserving its intent and stable ids where they still apply.

{{include:contracts/state-planning}}

## Output JSON

Return exactly one object matching `prompts/schemas/state-machine.json`. For a circle object with constraints `size` (param `radius`) and `color` (param `fill`):

```json
{
  "constraints": [
    { "id": "size-growing", "property": "size", "description": "Eases from the resting radius toward the grown radius over the growth time since the click.", "params": [
      { "id": "grown-radius", "label": "Grown radius", "effect": "spatial", "description": "Radius it grows to", "value": { "type": "number", "value": 90, "min": 10, "max": 140, "step": 1, "unit": "px" } },
      { "id": "growth-time", "label": "Growth time", "effect": "temporal", "description": "How long growing takes", "value": { "type": "number", "value": 1200, "min": 200, "max": 4000, "step": 50, "unit": "ms" } }
    ], "inputs": [], "drags": [] }
  ],
  "machine": {
    "initialState": "idle",
    "states": [
      { "id": "idle", "label": "Idle", "description": "The circle rests at its radius, waiting for a click.", "constraintIds": ["size", "color"] },
      { "id": "growing", "label": "Growing", "description": "After the click its size eases toward the grown radius; when it gets there the code dispatches grown.", "constraintIds": ["size-growing", "color"] },
      { "id": "settled", "label": "Settled", "description": "Stays enlarged at the grown radius; clicking again returns it to idle.", "constraintIds": ["size-growing", "color"] }
    ],
    "transitions": [
      { "id": "press-circle", "from": "idle", "to": "growing", "event": "press", "label": "Click the circle" },
      { "id": "growth-done", "from": "growing", "to": "settled", "event": "grown", "label": "Growth finished" },
      { "id": "press-reset", "from": "settled", "to": "idle", "event": "press", "label": "Click again to reset" }
    ]
  }
}
```
