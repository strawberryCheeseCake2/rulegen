# execution-recommendation — a new recommendation from what the user showed on an Execution frame

A targeted inspection of ONE brush (a reusable collection in a running p5.js sketch) looked at the user's `concern` (`inspectionSummary` is what it found). The user opened an Execution frame on it: the brush marks of `step` drawn by a copy of the program whose execution the user runs forward and back (step by step through its internal operations, or along the recorded input or steps). `execution` says where it is: what the frame shows (`summary`), how execution goes (`axis`: `"run"` the code's internal operations, `"input"` the recorded input, `"steps"` the recorded steps), how far (`done` of `count` steps, or `progress` 0..1), the step just executed (`last`), the next one (`next`) and the kind of operation it is (`stage`, with what it does). When the frame previews a recommendation, it is `framedRecommendation` (with its `preview`; `applied` says whether it is in `code` already). The image is the frame's picture at that moment, with what the user did on it:

- `annotationMarks` (normalized 0..1 points on the 900×600 canvas; `annotationMarkStyles` gives each mark's `color`, `width`, `opacity` by index), drawn on the image: circles, arrows, crossings-out, handwriting. They point at what goes wrong at this moment of execution, say how it should go instead (an arrow: move or extend that way; crossed out: not this; a drawn shape: like this), or both.
- `manipulations`: parts of the picture the user CROPPED by hand (drew a freeform `outline` around them, canvas pixels; `box` is its bounding box) and then moved, scaled or rotated. Each has `dx`, `dy` (how far its center moved), `scale` (its size ×) and `rotate` (degrees, clockwise, about its center); `label` names the crop. On the image the outline where it was is dashed, and the cropped picture is drawn where the user put it. The crop is whatever the user circled (an item, part of one, several): read from the image what it holds. It shows what the user wants that part (and, unless the request says otherwise, the parts LIKE it, the same role in the brush) to come out as: a direct demonstration of the outcome, not a one-off edit of that one place. Read it as the rule it implies (bigger where they overlap, turned to follow the stroke, placed further apart, …).
- `request`: what the user wrote (may be empty; then the marks and manipulations say it).

Read what the user showed AT THIS MOMENT of execution: the operation it is in (`stage`, `last`, `next`) is where the brush's behavior has to change, so the fix is usually in what that operation does (how it places, sizes, orients, skips or merges what it draws), not a value that only hides the symptom.

## What to return

ONE new recommendation that makes the brush do what the user showed, as the inspection's recommendations are written:

- `kind`: `"transformation"` (change semantic transformation `targetId` of node `nodeId`; other transformations of the same node that must change too in `targetIds`, otherwise `[]`), `"add-transformation"` (a new one on node `nodeId` when none of its transformations covers what has to change; `targetId` `""`), `"state"` / `"transition"` (`targetId` an existing state or transition of node `nodeId`), or `"value"` (only when values of `constraints` alone do it; `changes` with `key` from `constraints`, `stateId` `""` or the state whose value changes, a `value` of the key's type within its range). `changes` is `[]` except for `"value"`; `targetIds` is `[]` except for `"transformation"`.
- `title`, `detail` (Korean): the fix, concretely enough to apply (for `"add-transformation"`, what the new transformation does and the algorithm idea), saying the outcome the user showed. Not one of `listedRecommendations` again: when the user's marks agree with one of them, write the version that matches what they showed.
- When `framedRecommendation` is given and not `applied`, the user is showing how THAT recommendation should come out: write it again, changed so its outcome is what they showed (its preview edits are not in `code`; start from them).
- `preview`: REQUIRED unless `kind` is `"value"` (then `null`): code edits that draw the held step's brush marks the way the new recommendation makes them (the whole outcome, not the moment of execution); `find` copied EXACTLY from `code`. Its `marks` show what it changes compared with the brush as it is now; its `handles` sit on the quantities it hinges on.
- `reply`: one Korean sentence on what you made from what the user showed, e.g. "겹치는 단계에서 키운 크롭대로, 겹친 하트만 크게 그리는 recommendation을 만들었습니다."

When what the user showed cannot be done in this brush, do the closest it can and say so in `reply`.

{{include:contracts/recommendation-preview}}

## Output JSON

Return exactly one object matching `prompts/schemas/execution-recommendation.json`.
