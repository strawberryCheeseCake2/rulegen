# clarification — interpret an annotation sketch on a generated result

Interpret the user's unnumbered freehand annotation sketch on a GENERATED RESULT and draft a concise, editable Korean text clarification of the desired visual changes. Compare the clean generated result image with the annotated image: only the coral overlaid strokes are user feedback. Use their geometry, position and relationship to the rendered result to infer the intended change, including changing existing collections/objects or adding new ones.

- The `scene` (collections, objects, properties, algorithms) and `previous` code are context for understanding the current rendering. Name affected collections/objects when that is clear.
- Write a concrete natural-language modification request in the user's voice describing the affected area, desired shape, placement or repetition, and preserving unrelated composition.
- Do not ask the user to write the clarification. Do not describe the act of drawing, reproduce the coral strokes as literal artwork, or invent unsupported precise values. If the intent is ambiguous, phrase the most plausible interpretation as an editable draft.
- The optional `instruction` is the user's current draft; retain its explicit intent while updating it to the sketch.

No scene proposal or code yet; the user can edit this draft before requesting suggestions.

## Output JSON

Return exactly one object matching `prompts/schemas/clarification.json`:

```json
{ "clarification": "오른쪽 위 가지 collection을 더 길게 뻗게 하고, 끝부분에 작은 잎 object들을 추가해줘. 나머지 구도는 유지해줘." }
```
