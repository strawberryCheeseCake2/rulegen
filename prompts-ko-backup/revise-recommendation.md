# revise-recommendation — change one recommendation from what the user did on its preview

A targeted inspection of ONE brush (a reusable collection in a running p5.js sketch) gave recommendations for the user's `concern` (`inspectionSummary` is what it found). The user is looking at the preview of ONE of them, `recommendation` (with its `preview`: code edits the panel runs on the brush marks of `step`, the values those edits read, the state machine change it brings, its `caption` and `marks`), and wants it changed BEFORE it is applied. The image is that preview as drawn now, with what the user did on it:

- `annotationMarks` (normalized 0..1 points on the 900×600 canvas; `annotationMarkStyles` gives each mark's `color`, `width`, `opacity` by index), drawn on the image: circles, arrows, crossings-out, handwriting. They point at parts of the preview to change, say how (an arrow: move or extend that way; crossed out: not this; a drawn shape: like this), or both.
- `manipulations`: parts of the preview the user CROPPED by hand (drew a freeform `outline` around them, canvas pixels; `box` is its bounding box) and then moved, scaled or rotated. Each has `dx`, `dy` (how far its center moved), `scale` (its size ×) and `rotate` (degrees, clockwise, about its center); `label` names the crop. On the image the outline where it was is dashed, and the cropped picture is drawn where the user put it. The crop is whatever the user circled (an item, part of one, several): read from the image what it holds. It shows what the user wants that part (and, unless the request says otherwise, the parts LIKE it, the same role in the brush) to look like: a direct demonstration of the outcome, not a one-off edit of that one place. Read it as the rule it implies (bigger where they overlap, turned to follow the stroke, placed further apart, …).
- `adjusted`: values the user changed with the preview's handles (`key`, `label`, `from`, `to`): the amount the recommendation should use is `to`, not what it assumed. Put it in the revised recommendation (its `detail`, `changes`, or the preview's `values` and edits), not only in the preview.
- `request`: what the user wrote (may be empty; then the marks and manipulations say it).

## What to return

The SAME recommendation, revised: what it proposes changes so the outcome looks like what the user showed. Keep everything the user did not ask to change.

- `kind`, `nodeId`, `targetId`, `targetIds`, `changes`: as in the recommendation, unless the revision needs another kind (a value change that becomes a transformation change, …); the same rules as the inspection's recommendations: `targetId` an existing transformation, state or transition of node `nodeId` (`""` for `"add-transformation"`), `targetIds` `[]` except for `"transformation"`, `changes` `[]` except for `"value"` (keys from `constraints`).
- `title`, `detail` (Korean): the revised fix, concretely enough to apply, saying the new outcome (not the history of the revision).
- `preview`: REQUIRED unless `kind` is `"value"` (then `null`). Start from the current `preview.edits` and change them so the preview now shows the revised outcome; `find` copied EXACTLY from `code` as it is (the current edits are NOT in `code`). Its `marks` show what the revised recommendation changes compared with the brush as it is now (not compared with the old preview); its `handles` stay on the quantities it hinges on (with the adjusted values as their starting values).
- `reply`: one Korean sentence on what you changed, e.g. "겹친 부분만 크게 키우고 회전은 획 방향을 따르게 바꿨습니다."

When the user's marks ask for something the recommendation cannot do in this brush, do the closest it can and say so in `reply`.

{{include:contracts/recommendation-preview}}

## Output JSON

Return exactly one object matching `prompts/schemas/revise-recommendation.json`.
