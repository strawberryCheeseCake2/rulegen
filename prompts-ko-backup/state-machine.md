# state-machine — plan the state machine of ONE collection or object

Plan the state machine for the node identified by `targetNodeId` in the supplied `scene`, using the sketch image, ordered `compositionStrokes` (including interaction annotations), the node's semantic transformations and the user instruction. Infer meaningful stages of movement, growth, interaction or transformation from the dynamic intent. Never invent motion the sketch/instruction does not suggest; if the node is truly static, return a single state with no transitions.

- States change only THIS node's property values (`values[].propertyId` must be a property id of the target node). Keep each value's structure identical to the base property value: same scalar type and range shape, or the same algorithm with the same argument ids — change only the scalar numbers/colors/options/toggles.
- If the existing properties cannot express a needed phase difference, still keep the structure; describe the difference in the state description so the code step can branch on the state id.
- If `scene` already contains a machine for the node, refine it into finer meaningful phases while preserving its intent and stable ids where they still apply.
- `algorithms` must be `[]` unless you truly need a new definition (then list only new ones).

{{include:contracts/state-planning}}

## Output JSON

Return exactly one object matching `prompts/schemas/state-machine.json`:

```json
{
  "algorithms": [],
  "machine": {
    "initialState": "idle",
    "states": [
      { "id": "idle", "label": "대기", "description": "원이 작게 숨 쉬며 클릭을 기다립니다.", "values": [ { "propertyId": "radius", "value": { "type": "number", "value": 24, "min": 10, "max": 140, "step": 1, "unit": "px" } } ] },
      { "id": "growing", "label": "성장", "description": "클릭 후 1.2초 동안 커집니다.", "values": [ { "propertyId": "radius", "value": { "type": "number", "value": 90, "min": 10, "max": 140, "step": 1, "unit": "px" } } ] },
      { "id": "settled", "label": "정착", "description": "커진 상태로 머무르고 다시 클릭하면 대기로 돌아갑니다.", "values": [] }
    ],
    "transitions": [
      { "id": "press-circle", "from": "idle", "to": "growing", "label": "원 클릭", "trigger": "event", "afterMs": 1000 },
      { "id": "growth-done", "from": "growing", "to": "settled", "label": "성장 완료", "trigger": "after", "afterMs": 1200 },
      { "id": "press-reset", "from": "settled", "to": "idle", "label": "다시 클릭해 되돌리기", "trigger": "event", "afterMs": 1000 }
    ]
  }
}
```
