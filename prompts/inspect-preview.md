## preview — a quick visual preview of each recommendation

The user turned recommendation previews on. Every recommendation also has `preview`: the panel runs it on the brush marks of the step the user looks at (`steps[currentStep]`, the latest when null), so the user SEES what the recommendation would do before applying it. Nothing is applied; it is a sketch of the outcome, not the real fix.

- `kind: "value"`: `preview` is `null` (its `changes` are drawn as they are).
- Any other kind: `preview` is REQUIRED (never `null` for these). It shows THE OUTCOME ITS TITLE NAMES, plainly, on these marks.

{{include:contracts/recommendation-preview}}
