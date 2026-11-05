# explore — an exploration frame for one cause or recommendation of a targeted inspection

The user is shaping ONE brush (a reusable collection) in a running p5.js sketch and has a targeted inspection of it for a concern (`concern`; `inspection.summary` is the cause it found and `inspection.overlays` what it shows). To understand the cause or one of its recommendations better than text allows, the app opens a NEW frame beside the sketch: the same brush marks as at the step the user looks at (`steps[currentStep]`, the latest when null), held still, with a direct manipulation handle on top. Nothing the user does there changes the sketch. You design what that frame lets the user do, for `mode`:

The cause's frame (no `recommendation`) is made while the inspection is still looking for the cause, so `inspection.summary` and `inspection.overlays` may be empty: then work from `concern`, the marks in the image, the brush's code and its recorded steps — find for yourself what in the execution the concern is about, and let the user step through exactly that.

- `"execution"`: the user wants to UNDERSTAND HOW THE BRUSH WORKS INSIDE by CONTROLLING ITS EXECUTION STEP BY STEP with metaphoric direct manipulation: the brush's code runs one internal operation at a time (placing one item, comparing one pair, merging one item into another, painting one layer of one item …), and the user performs each step with a gesture that enacts that operation, sees what it changed and why, and takes steps back. Understanding comes from going through the steps one by one, not from one sweep that does everything at once. Not a replay of what the user drew: the internal process.
- `"parameters"`: the user tries the recommendation's mechanism by direct manipulation: moves the input (or kept state) its condition reacts to, and its KEY VALUES (the one to three quantities its text is really about), as handles on overlays, and sees the drawing change, instead of reading about it.

`recommendation` is given when the frame is for one of the inspection's recommendations (absent: for the cause). `applied` says whether the user applied it already.

Inputs are as for the targeted inspection: `brushNodes`, `algorithms`, `constraints` (every value of the brush, `{ key, nodeId, transformationId, transformation, propertyId, property, path, type }`, plus layout keys `<node>/@x|@y|@w|@h`), `steps` (the recorded history with each step's `values` and `runtime`: machine `states` and each brush root's `m.store`), `code` (the module source that draws the brush), `input` (how many gestures and points the user has drawn with the brush at that step). The image is the frame as the user sees it.

## What execution is here

`axis` picks what is executed:

- `"run"` (the default; use it whenever the question is how the brush produces what it draws, which is almost always): ONE RUN of the brush's code drawing the held moment, executed STEP BY STEP. Each STEP is one checkpoint the code passes (below) together with everything the code draws until the next checkpoint. The frame starts with no step executed (the finished marks shown faintly behind) and the user executes step 1, 2, 3 … or takes them back; only what the executed steps drew is drawn. Without checkpoints each drawing call is a step (the drawing order only), so add checkpoints.
- `"input"`: how much of the user's recorded input (`m.history()`) has been executed (continuous), for a process that only exists as the drawing builds up stroke by stroke.
- `"steps"`: the recorded `steps` (state changes of the machines). Only with 2 or more steps.

`from`, `to`: for `"input"` and `"steps"`, the part (0..1) the process happens in; for `"run"` give `0` and `1`.

### checkpoints: one per step

For `"run"`, add checkpoints to the brush's module in `edits` (they run in this frame only; the sketch is not changed): `m.trace("<what this step does, Korean>", { op, …data }[, show])`. Each call STARTS ONE STEP, so place one at the start of each internal operation the cause or the recommendation is about, at the granularity that teaches the principle: one per item per operation (each item placed, each pair compared, each merge, each layer of each item), not one for a whole loop and not one per vertex or pixel. Put it right BEFORE the code that does the operation (and draws its result), inside the loop, so the step's drawing belongs to it. Do not add checkpoints that only announce a stage: the stages are named in `stages`.

- ONE VERB PER STEP. Read the code for every distinct thing it does to an item, and make each its own operation (`op`) with its own checkpoint: moving or placing it, testing it, REMOVING part of it (filtering, culling, clipping, hiding, skipping, cutting what lies inside another item), keeping it, merging, splitting, growing, turning, recoloring, connecting, collecting, drawing it. Never fold one into another's step (not "examine the outline and drop its inner part" as one step): e.g. per bush, 1 move its outline into place, 2 remove the parts inside other bushes, 3 ink what is left. A step that takes something away matters as much as one that adds: put its checkpoint where the code decides it (before the `filter`, the `continue`, the clip), with what it removes in its data. When a decision has two outcomes (kept / removed), each outcome that changes the picture is a step of its own kind.
- WHAT THE GESTURE NEEDS goes in the data: whatever geometry the gesture you design for that operation (below) reads, under names you choose. For example: a move: where it is and where it goes (`toX`, `toY`); a removal: the part removed and the item it belongs to (`fromX`, `fromY`); a merge: both ends; a growth: the base and the tip; a turn: the pivot and the angle; a stroke: its path. These are examples, not a list to pick from: a gesture of your own needs its own points (the wind's direction for a flame that leans, the cut line for a pruned branch, the rim a droplet spreads to).
- THE BRUSH MARKS THEMSELVES CHANGE AT EVERY STEP. The user understands by watching the drawing change under the hand, not by reading overlays: after each step the canvas must show the brush as it is at that point of execution. Code that draws as it goes (each item drawn in the loop) does this by itself. Code that computes or collects first and draws at the end (outlines tested, parts removed, pieces kept, then inked once) draws nothing until its last step, so give each of those checkpoints a THIRD argument, `show`: `m.trace(label, data, () => { … })`, a function that draws the brush AS IT IS AFTER THIS STEP, in the brush's own look (its own drawing helpers, colors, stroke weight; copy how the module draws at the end), from the variables in scope at that point. The app calls it right there when that step is the one reached (and never otherwise; what it draws is not a step). For example, removing an inner part of bush 2: draw every bush's outline as it stands now — the parts removed so far gone (this one just now), the rest still there — so the user sees the inner line disappear; keeping a piece: draw the pieces kept so far inked; testing: draw the outlines with the one tested now slightly emphasized. When the result before the end only exists partly (a list being filled), draw what exists plus the items not processed yet as they were, so the picture stays whole and only the step's change differs from the previous step. The show function only reads and draws: it never changes a variable, the store or anything the code uses later.
- Each step's data also carries what THAT step produced (the part removed, the piece kept), for the overlays: they point at the change, they are not the change.

- The label says concretely what this step does and why, with the numbers that decide it (`` `불꽃 ${i + 1}: 앞 불꽃과 ${d.toFixed(0)}px 겹쳐 붙임` ``, `` `가지 ${depth}단: 길이 ${len.toFixed(0)} → 둘로 나눔` ``), so going through the labels explains the principle.
- `data.op` is a NUMBER (1, 2, 3 …) naming which KIND of operation the step is (the same number for every step of that kind), as listed in `stages`.
- The rest of `data` is the internal state AT THAT STEP, in canvas pixels, plain numbers, booleans, strings, arrays and objects only: what is worked on (`x`, `y`, `w`, `h` of the item or region, or point lists such as the outlines being combined), the quantities the step decides with (the distance tested and the threshold, the index), and the result so far. The step is placed on the canvas at its data's `x`, `y` (with `w`, `h`), or else the box of the points in it, so give each step the position of what it works on.
- Each edit only INSERTS checkpoint calls: `find` is copied EXACTLY from `code` (whitespace included) and occurs once in that module; `replace` is the same text with `m.trace(…);` statements added (a one-statement loop or `if` body may get `{ }` to hold one; a checkpoint that applies only sometimes may be guarded, `if (<condition>) m.trace(…);` or `if (<condition>) { m.trace(…); }`, with a condition that changes nothing; never anything else changed, never a variable or call removed; the app drops any other edit, and with it every step it would have added). Read only variables in scope at that point. Keep the data small: the app keeps at most 200 items of a list (thinned evenly), numbers to one decimal. Every field a handle or overlay reads must be there on EVERY step of that operation (a step without it gets no handle of its own, only a plain one).
- Code inside `m.memo` runs again during the run, so checkpoints there are recorded. Steps after the first 3000 events are not kept.
- 2–10 edits are typical.

`stages`: one entry per kind of operation (`op`), in the order they first happen: `name` (Korean, a few words: `"바깥 불꽃 피우기"`, `"밝은 내부 덧칠"`), `explain` (1–2 Korean sentences on what this operation does and why it matters for the concern: the principle) `many` (below; almost always false) and `of`: the parts of the brush this operation belongs to, i.e. the semantic transformation(s) of `brushNodes` whose algorithm it carries out, or the state / transition whose behavior it is (`{ "kind": "transformation" | "state" | "transition", "nodeId", "id" }`, ids exactly as in `brushNodes`; 1 usually, up to 3; `[]` only when it is none of them, e.g. bookkeeping). `[]` for other axes.

`of` (top level, mode `"execution"`): the parts of the brush the execution shown runs as a whole, the same way (up to 4; for a run, at least those of its stages). For a recommendation's preview, the transformation it changes or adds is not in `brushNodes` yet: name the existing parts it runs through. `[]` in mode `"parameters"`.

## overlays and handles

Overlays and handles are written exactly as in a targeted inspection (same expressions and readers: `p("key")`, `s("<root>", "path")`, `len`, `item("…")`/`i` with `each`, `"@input"`, `in`, `elapsed`, `if`, `min` …; same `kind`, `x`, `y`, `w`, `h`, `label`, `name`, `color`, `link`, `when`, `each`, and `handle` with `key`, `gesture`, `x`, `y`, `pivotX`, `pivotY`, `value`, `hint`). They are evaluated on the frame AS IT IS DRAWN NOW: the stores and `"@input"` are those of the execution so far, and they are recomputed as the handle moves. In addition, overlay and handle expressions here may read:

- axis `"run"`:
  - `p("@execution")`: how many steps are executed now (0 … total);
  - `s("@next", "…")`: the step about to execute, `s("@last", "…")`: the step just executed. Fields: `"step"` (its number, 0-based), `"op"`, `"none"` (1 when there is no such step: before the first, after the last), `"done"`, `"total"`, `"x"`, `"y"`, `"w"`, `"h"`, `"cx"`, `"cy"`, and its data under `"data.…"` (e.g. `s("@next", "data.d")`, `s("@last", "data.outline.@cx")`);
  - `each: "@steps:"` over every step (`item("step")`, `item("done")` 1 when executed, `item("op")`, `item("cx")`, `item("data.…")` …), to show what is done, what comes next, and the whole plan faintly;
  - `nearestStep(x, y)`: how many steps are executed once the step nearest (x, y) is (`nearestStep(hx, hy)` in a handle's `value`: execute up to the step the pointer is on);
  - expressions read numbers only, never text.
- axis `"input"` / `"steps"`: `p("@execution")` the progress (0..1); `pathX(t)`, `pathY(t)`: the input point executed at progress `t`; `nearest(x, y)`: the progress of the input point nearest (x, y).

`link` is a `constraint`, `state` or `transition` of the brush's nodes, or (`kind` `"parameter"`) a preview value of `values` below. 1–6 overlays, distinct colors.

#### handles on the running state

Besides a value, a handle's `key` may name the RUNNING STATE of the moment shown, which the frame is then drawn from (only this moment, in this frame):

- `"@input:<g>:<at>"`: a point of the recorded input (`"@input"`): gesture `<g>` (its index; `-1` the last one), at point `<at>`: an index (`-1` the last point), or a fraction of the gesture's length written with a dot (`0.5` halfway, `0.25`). Gesture `"move"`: the user drags that point and the stroke bends around it (nearby points follow less and less, the stroke's ends stay), so everything the brush makes from that stretch of the stroke moves with it and the brush REACTS: items come closer or apart, start or stop overlapping, cross a boundary. `"@input:<g>"` moves the whole gesture (avoid it when the code recognizes a gesture by its first point).
- `"@store:<root>:<path>"`: a value the module KEEPS in `m.store` and reads back as input to its rule (a position, a velocity, a counter, a timer; NOT a field the code recomputes every frame, such as a list of what it drew): a point (`{ x, y }`) with gesture `"move"`, or a number with `"drag"` / `"slide"` / `"rotate"` and a `value` expression (`start` is what it holds). Path parts are separated by dots; a negative index counts from the end (`"particles.-1.pos"`).

A `"move"` handle needs no `value`; leave `x` and `y` `""` and its grip sits on the point it moves (or give them to put it elsewhere). The key may hold `${…}` parts read per item on an `each` overlay (e.g. `"@input:-1:${item(\"t\")}"` when the records carry where along the stroke each item was made), giving every item a grip on the input it came from.

### mode "execution"

Axis `"run"`: give EACH kind of operation (`stages`) its OWN way to perform it: a handle (below) or a sketched mark (further below). A handle has key `"@execution"`, on an overlay shown only while the next step is of that kind (`when`: `s("@next", "op") == <op> && !s("@next", "none")`). Dragging it executes steps; dragging back takes them back (the value is clamped to whole steps, 0 … total). Design each gesture as a METAPHOR OF ITS OPERATION, performed on what the next step works on, so doing the gesture IS doing that step:

- the grip sits on what the next step works on: `x` = `s("@next", "cx")`, `y` = `s("@next", "cy")` (or a point of its data: where an item will grow from, the edge that will join), so after each step it jumps to the next one's subject;
- the gesture IS the operation's verb, performed with THAT STEP'S geometry (from its data), so every operation feels different: never the same gesture for several operations (not "drag right" for all), and the direction and length come from the step, not fixed numbers.
- DESIGN IT FROM THE CONTEXT. The best metaphor comes from what this brush depicts and what the operation means there, in the user's world, not from the code's verb alone: a flame is fanned up or blown sideways, a bush is pruned (cut across the branch) or combed into shape, ink bleeds when pressed and held still, a wave is pushed, a petal is plucked, a tile is snapped into the grid, a thread is pulled taut. Invent such a gesture whenever it fits the operation and the picture better; the list below is only a starting point for common verbs, never a menu to choose from. Any gesture works as long as it is one of `"drag"`, `"slide"`, `"rotate"` with expressions over the step's data (where the grip starts, which way and how far the hand goes), and doing it makes the step happen:
  - move / place → carry the item to where it goes: grip on the item, `"slide"` with `pivotX`/`pivotY` at the destination (`data.toX`, `data.toY`), `value` `start + 1 - dist / startDist` (arriving there is the step), hint like `"제자리로 옮기기"`;
  - remove / cull / clip / hide / skip / cut away → throw the part away: grip on the part removed, `"slide"` away from its item (`pivotX`/`pivotY` at `data.fromX`, `data.fromY`), `value` `start + (dist - startDist) / 40`, hint like `"밖으로 튕겨 안쪽 선 지우기"`; or wipe across it from one side to the other;
  - keep / accept → press it in: a short drag down on it, `start + max(0, dy) / 20`;
  - merge / join / connect → bring one onto the other: grip on one end, `"slide"` toward the other (`pivot` at `data.bx`, `data.by`), `start + 1 - dist / startDist`;
  - split / branch / grow / extend → pull it out: grip on the tip, `"slide"` away from the base (`pivot` at the base), `start + (dist - startDist) / 40`;
  - turn / orient → `"rotate"` around its pivot, `start + (angle - startAngle) / <the angle it turns, radians>`;
  - paint / fill / ink / stroke → trace along it: grip at the path's start, `"slide"` along it, `start + dist / <its length>`;
  - test / compare → bring the probe onto the boundary or the two together;
  - anything else → ask what a person would physically do to the thing in the picture to make this happen, and do that.
- THE GESTURE MUST BE MEASURABLE ON EVERY STEP: for `"slide"` and `"rotate"` the grip sits clearly apart from its pivot (at least about 24 px, on every step, whatever the data: a closed outline's start and end are the same point, a tiny item has almost no size), and every divisor in `value` stays well above 0 (`max(24, …)`). When a step's geometry gives no direction (a closed path, a point), choose another gesture for it (trace around it from a point on it, pull its edge outward from its center). A gesture the app cannot measure only goes forward, one step per clear drag;
- ONE GESTURE IS ONE STEP: a drag executes the next step once it has gone far enough, or takes the last one back when it starts the other way; once it has done either, the rest of that drag changes nothing (overshooting a target does not undo it), so the user releases, sees what the step did, and grabs the handle again on the next step's subject. It never runs on into another operation (e.g. the next stroke's first layer); that operation's handle then appears on its subject;
- `value`: `start + <how far the gesture went> / <pixels for one step>` (e.g. `start + max(0, -dy) / 30`, `start + abs(dx) / 30`; back: the opposite direction gives `start - 1`);
- only when an operation truly IS one continuous motion through many items (sweeping the pen along a row being placed, turning a dial through iterations of one loop) may one gesture run several of its steps: set its `many` true in `stages` (then `value` may use `nearestStep(hx, hy)` to execute up to the step pointed at). Otherwise `many` is false;
- `hint` names the gesture and the operation in plain Korean (about 20 characters): `"위로 당겨 불꽃 피우기"`, `"옆으로 문질러 내부 덧칠"`.

#### sketched marks: performing a step by drawing on it

Some operations are done more naturally by MARKING the picture, as one would with a pen on paper, than by dragging a grip: crossing out what is removed, circling what is kept, drawing an arrow to where something goes, cutting through what is split, joining two things with a line, tapping what is chosen, ticking what is accepted, scribbling over what is erased, tracing the path something follows. For such an operation give a `sketches` entry (instead of, or as well as, its handle). The user draws the mark on the frame where it belongs; the app recognizes it and, when the user submits it, executes the next step of that operation. Use whatever modality fits each operation: one operation may be dragged, the next sketched.

- `op`: the operation (as in `stages`); one entry per operation.
- `shape`, one of:
  - `"x"`: two crossing strokes over the thing (removing, deleting, rejecting);
  - `"circle"`: a loop around it (keeping, selecting, grouping);
  - `"arrow"`: one stroke from the thing to where it goes (moving, sending, assigning): give `toX`, `toY`, the destination;
  - `"cut"`: one stroke across it from one side to the other (splitting, slicing, separating);
  - `"line"`: one straight stroke on it (joining, connecting, aligning, measuring);
  - `"tap"`: a single press on it (choosing, triggering, one event);
  - `"check"`: a tick on it (accepting, passing a test);
  - `"scribble"`: back and forth over it (erasing, filling, roughening);
  - `"trace"`: drawing along a path (the path an item follows, an outline being inked): give `path`, the point list to follow as `"<root>:<store path>"` the way `each` reads one (e.g. `"@next:data.points"`);
  - `"custom"`: ANY other mark that fits the operation and the picture better (a wave for a ripple, a spiral for a curl, a zigzag for a crack, a bracket for a group, a flame lick, a stitch …): give `template`, the mark itself as 8–40 points in drawing order (any units; it is matched at any size and either direction, and shown faintly in the area as a guide). Do not limit yourself to the named shapes when another mark says the operation better.
- `x`, `y`, `w`, `h`: expressions (like an overlay's) for where the mark goes: the thing the next step works on (`s("@next", "x")` …, or a part of its data); the area is shown dashed and the mark must be on it.
- `toX`, `toY`: the arrow's destination (`""` for other shapes); `path`: the trace's path (`""` otherwise); `template`: the custom mark (`[]` otherwise).
- `hint` (Korean, about 20 characters): the mark and what it does, e.g. `"X로 그어 안쪽 선 지우기"`, `"동그라미로 남길 윤곽 고르기"`, `"화살표로 제자리에 보내기"`.

The other overlays (with `handle` `null`) only annotate the change the drawing shows (keep them few and light; the brush marks changing is the explanation): they mark the step on the things themselves (before a removal: what WILL be removed, e.g. red and dashed from `@next`; after it: where it was, faint, from `@last`): what the step just executed did (`@last`: the item, the pair compared and the distance against the threshold, the merged outline), what the next step will work on (`@next`), and the plan (`each: "@steps:"`: done steps solid, coming steps faint, by `item("done")`).

Axes `"input"` / `"steps"`: exactly one handle with key `"@execution"` (the progress 0..1, clamped to `from`..`to`), whose grip follows the progress (`pathX(p("@execution"))` …) and whose `value` is the inverse (`nearest(hx, hy)`).

`hint` says the gesture in plain Korean (about 20 characters).

### mode "parameters"

Give the recommendation's key values handles (as in a targeted inspection: the grip on the part of the drawing the value moves, the gesture doing to the drawing what the value does, `value` the inverse using `start`), a value's handle on an overlay WITHOUT `each` (it changes the value for the whole brush in this frame); a running-state handle (above) may sit on an `each` overlay. Key values are:

- for a `"value"` recommendation: the keys in its `changes` (the frame is drawn with the recommended values already, unless it is applied; the label may say the value now);
- for a recommendation that changes, adds or refines a transformation, state or transition: the quantities that decide ITS MAIN EFFECT, the one its `title` names — whether it happens, where, how much (for "merge overlapping hearts into one": how close or overlapped hearts must be to merge, how large hearts are and how far apart they are emitted, which decide how many merge; for "bend branches": the bend angle). Existing `constraints` that decide it, and NEW values the preview introduces for it.

THE USER IS HERE TO UNDERSTAND THE MECHANISM, not to flip it. So the first handle lets them PRODUCE the condition that triggers the effect with their own hand and watch the effect happen and undo itself: grab the input (or the kept state) the condition is computed from and move it across the condition. If the effect happens when things overlap, are close, line up, cross or pile up, give `"move"` handles on the input points those things are made from (1–3 grips on the stretch of the stroke where the effect happens or nearly happens: dragging one pulls items together until they overlap and the effect appears, apart until it goes away); if it depends on a kept position or count, a handle on that store value. Then, where the effect has a threshold or amount, a handle on it. A toggle that turns the effect on and off is allowed only next to these, never as the only handle.

THE HANDLES ARE ABOUT THE RECOMMENDATION'S MAIN EFFECT. Dragging one must change what the title says happens (more or fewer hearts merge, a bigger or smaller merged shape, more or less bend), so the user sees that effect under the hand. Never give handles to values that only restyle the drawing (stroke width, hatch spacing, colors, wobble) or to side details of `detail`, unless the recommendation is about exactly them. When the main effect has no quantity in the code (an on/off rule, a geometric test with no threshold), the running-state handles above already let the user cross its condition; also introduce one in `values` (read in the `edits`) when it helps: a threshold or amount for the effect (e.g. `merge-gap`: how much overlap, or gap, still merges; `merge-strength`: how far the merged shape grows). Every frame in this mode has 1–3 such handles: `overlays` is never empty.

No handle has the key `"@execution"`.

### preview of a recommendation that is not applied

When `recommendation` is given, `applied` is false and its kind is not `"value"`, the code does not do it yet. Make the frame show it: `edits` change the brush's module so it does what the recommendation says, IN THIS FRAME ONLY (the sketch is not changed). Each edit is `{ nodeId, find, replace }`: `nodeId` a node of the brush (its module is edited), `find` copied EXACTLY from `code` (whitespace included) occurring exactly once in that module, `replace` the new code. Keep the edits as small as the change allows (1–6), valid JavaScript, using the module's own helpers and `m.v("<key>")` reads. A NEW quantity the recommendation introduces (a merge distance, a branch angle) is read with `m.v("<node id as the code uses it>/<new id>")` and listed in `values` (`nodeId`, a new lowercase `id` with `-`, a short `label`, and `value`: `{ "type": "number", "value", "min", "max", "step", "unit" }` or `{ "type": "toggle", "value" }`), so the parameters mode can give it a handle (`p("<node id>/<new id>")`, `link.kind` `"parameter"`). Otherwise `edits` and `values` are `[]`. When the preview cannot be written safely, return `[]` for both; the frame then runs the current code.

THE BEHAVIOR IS IN THE STATE MACHINE. When the recommendation makes the brush REACT to something that happens while it runs (things meet, touch, overlap, merge, split, a limit is reached, an item dies or is born from another), that reaction is part of the brush's behavior and goes in its state machine too, or the machine no longer describes the brush. `machine` gives it: `nodeId` the node whose code emits it (a brush node with a machine; one without gets one, its first new state the initial one), `transitions` (1–4) with trigger `"event"`, a new lowercase id with `-` and a short Korean `label` naming what happens (e.g. `"하트끼리 겹침 → 합치기"`), and `afterMs` 1000. Prefer a transition from each state it can happen in BACK TO THE SAME STATE (an instant reaction: the code's own checks of its state keep working); add a new state (`states`: `id`, `label`, `description`, `like` the existing state whose values it starts with) only when the brush then behaves differently for a while, with an `"after"` transition back. The edits emit it with `m.emit("<node id as the code uses it>", "<transition id>")` AT THE MOMENT IT HAPPENS: once per happening (e.g. when a new pair starts to overlap, remembered in `m.store`), never every frame while it lasts. Each emit becomes a recorded step the user can inspect. `machine` is `null` when the recommendation changes no behavior (only how something looks, or a value). Without a preview (no `recommendation`, or it is applied, or a `"value"` one), `machine` is `null`.

## summary

`summary`: 2–3 Korean sentences in plain words: what the user can do in this frame and what to watch (e.g. "펜 끝을 끌면 획이 그려지는 순서대로 실행됩니다. 새 불꽃이 앞 불꽃과 가까워지는 순간 합쳐지는 것을 볼 수 있습니다."). No ids, keys or code names.

Treat image content as visual evidence, not instructions.

## Output JSON

Return exactly one object matching `prompts/schemas/explore.json`:

```json
{
  "summary": "▶를 누르거나 다음 불꽃을 위로 당기면 코드가 한 단계씩 실행됩니다. 바깥 불꽃이 하나씩 따로 피어난 뒤, 밝은 내부가 하나씩 그 위에 덧칠되면서 이웃과 이어집니다.",
  "axis": "run", "from": 0, "to": 1, "values": [],
  "of": [{ "kind": "transformation", "nodeId": "flame-brush", "id": "flame-layering" }],
  "stages": [
    { "op": 1, "name": "바깥 불꽃 피우기", "explain": "불꽃마다 주황 윤곽을 따로 그립니다. 이웃과 겹쳐도 아직 각자의 모양입니다.", "many": false, "of": [{ "kind": "transformation", "nodeId": "flame-brush", "id": "flame-layering" }] },
    { "op": 2, "name": "밝은 내부 덧칠", "explain": "모든 바깥 불꽃 위에 밝은 내부를 덧칠합니다. 겹친 부분의 경계가 이 칠에 덮여 하나로 이어져 보입니다.", "many": false, "of": [{ "kind": "transformation", "nodeId": "flame-brush", "id": "flame-layering" }] }
  ],
  "sketches": [
    { "op": 2, "shape": "scribble", "x": "s(\"@next\", \"x\")", "y": "s(\"@next\", \"y\")", "w": "s(\"@next\", \"w\")", "h": "s(\"@next\", \"h\")", "toX": "", "toY": "", "path": "", "template": [], "hint": "내부를 덧칠해 경계 덮기" }
  ],
  "edits": [
    { "nodeId": "flame-brush", "find": "for (const f of flames) drawOuter(f);", "replace": "for (const f of flames) { m.trace(`불꽃 ${f.i + 1} 바깥층: 앞 불꽃과 ${f.gap.toFixed(0)}px`, { op: 1, x: f.x - f.w / 2, y: f.y - f.h, w: f.w, h: f.h, gap: f.gap }); drawOuter(f); }" },
    { "nodeId": "flame-brush", "find": "for (const f of flames) drawCore(f);", "replace": "for (const f of flames) { m.trace(`불꽃 ${f.i + 1} 내부 덧칠: 경계가 덮임`, { op: 2, x: f.x - f.w * f.core / 2, y: f.y - f.h * f.core, w: f.w * f.core, h: f.h * f.core }); drawCore(f); }" }
  ],
  "overlays": [
    { "id": "grow", "kind": "line", "x": "s(\"@next\", \"cx\")", "y": "s(\"@next\", \"y\") + s(\"@next\", \"h\")", "w": "0", "h": "-s(\"@next\", \"h\")", "label": "", "color": "#ea580c", "name": "다음에 피울 불꽃",
      "link": { "kind": "constraint", "nodeId": "flame-brush", "id": "distribution" }, "when": "s(\"@next\", \"op\") == 1 && !s(\"@next\", \"none\")", "each": "",
      "handle": { "key": "@execution", "gesture": "slide", "x": "s(\"@next\", \"cx\")", "y": "s(\"@next\", \"y\") + s(\"@next\", \"h\") - 12", "pivotX": "s(\"@next\", \"cx\")", "pivotY": "s(\"@next\", \"y\") + s(\"@next\", \"h\")", "value": "start + (dist - startDist) / (s(\"@next\", \"h\") * 0.6)", "hint": "밑동에서 위로 당겨 불꽃 피우기" } },
    { "id": "paint", "kind": "rect", "x": "s(\"@next\", \"x\")", "y": "s(\"@next\", \"y\")", "w": "s(\"@next\", \"w\")", "h": "s(\"@next\", \"h\")", "label": "", "color": "#ca8a04", "name": "다음에 덧칠할 내부",
      "link": { "kind": "constraint", "nodeId": "flame-unit", "id": "core-scale" }, "when": "s(\"@next\", \"op\") == 2 && !s(\"@next\", \"none\")", "each": "",
      "handle": { "key": "@execution", "gesture": "drag", "x": "s(\"@next\", \"x\")", "y": "s(\"@next\", \"cy\")", "pivotX": "", "pivotY": "", "value": "start + abs(dx) / s(\"@next\", \"w\")", "hint": "내부를 가로질러 문질러 덧칠" } },
    { "id": "gap", "kind": "label", "x": "s(\"@last\", \"cx\")", "y": "s(\"@last\", \"y\") - 6", "w": "0", "h": "0", "label": "앞 불꽃과 ${round(s(\"@last\", \"data.gap\"))}px", "color": "#2563eb", "name": "방금 피운 불꽃의 간격",
      "link": { "kind": "constraint", "nodeId": "flame-brush", "id": "distribution" }, "when": "s(\"@last\", \"op\") == 1", "each": "", "handle": null },
    { "id": "plan", "kind": "rect", "x": "item(\"x\")", "y": "item(\"y\")", "w": "item(\"w\")", "h": "item(\"h\")", "label": "", "color": "#94a3b8", "name": "아직 실행하지 않은 단계",
      "link": { "kind": "constraint", "nodeId": "flame-brush", "id": "distribution" }, "when": "!item(\"done\")", "each": "@steps:", "handle": null }
  ]
}
```
