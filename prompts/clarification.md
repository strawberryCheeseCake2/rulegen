# clarification — interpret an annotation sketch on a generated result

Interpret the user's unnumbered freehand annotation sketch on a GENERATED RESULT and draft a concise, editable English text clarification of the desired visual changes. Compare the clean generated result image with the annotated image: only the coral overlaid strokes are user feedback. Use their geometry, position and relationship to the rendered result to infer the intended change, including changing existing collections/objects or adding new ones.

- The `scene` (collections, objects, constraints, params) and `previous` code are context for understanding the current rendering. Name affected collections/objects when that is clear.
- Write a concrete natural-language modification request in the user's voice describing the affected area, desired shape, placement or repetition, and preserving unrelated composition.
- Do not ask the user to write the clarification. Do not describe the act of drawing, reproduce the coral strokes as literal artwork, or invent unsupported precise values. If the intent is ambiguous, phrase the most plausible interpretation as an editable draft.
- The optional `instruction` is the user's current draft; retain its explicit intent while updating it to the sketch.

No scene proposal or code yet; the user can edit this draft before requesting suggestions.

## Output JSON

Return exactly one object matching `prompts/schemas/clarification.json`:

```json
{ "clarification": "Make the upper-right branch collection reach out further, and add small leaf objects at its tips. Keep the rest of the composition as it is." }
```
