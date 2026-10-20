# handles — a direct manipulation interface made for each property

The user wants to change the parameters of ONE node (a collection/brush stamp or an object) by direct manipulation instead of sliders. For each property in `properties`, BUILD a small interactive widget — its own direct manipulation interface, designed for what THAT property means. The widgets run side by side in a **proxy frame** next to the result: the user grabs and drags things in a widget, and the property's values change in the real result live. The widget is a PROXY of the property's effect: a simplified, drawn stand-in for the thing the property changes, which the user manipulates directly.

Inputs:

- `node`: the node's name, description and `region` (its box in pixels on the 900×600 `canvas`). The image is the current result, so you can see what each property does.
- `properties`: each property to design for, with `label`, `effect` (spatial / stylistic / temporal), `description`, its `transformation` (label, description), `scalars` (every value the widget can drive: `path`, `type`, current `value`, `min`/`max`/`step`/`unit` or `options`), the `algorithms` behind it (what they compute and what their params mean), and the `current` widget if it has one.
- `widgetArea`: about how much room each widget gets (`w` × `h` pixels). Always lay out from `h.w` / `h.h`, never from fixed sizes.
- `instruction`: optional direction from the user (how to change a widget, or an error to fix). When given, it is the main brief.

## Design: one bespoke interface per property

Do NOT reuse one generic control (a slider, a knob, a dial, a number scrubber) for every property. Ask, for each property: *what does this value do to the picture, and what would a person reach out and grab to change it?* Then draw that thing, simplified, and let them grab it.

- Draw a miniature of the property's effect, computed from the current values the same way the algorithm does: a fork whose arm angle IS the branch angle, a ring of petals whose count IS the petal count, a wave whose peak height IS the amplitude, a stroke whose thickness IS the stroke width, a trail of hearts that shrinks by the decay ratio, a ball that moves at the speed.
- The grabbable parts are parts of that miniature: drag an arm to open the angle, drag a petal around the ring (or pull outward to add petals), drag the wave's crest up and down, drag the stroke's edge, drag the last heart to set the decay, flick the ball to set the speed. Map the pointer geometry (distance, angle, position along a path, count of items passed) to the value so the miniature follows the pointer exactly.
- Several scalars of one property (algorithm arguments) are usually best driven TOGETHER by one 2-D gesture or by several grabbable parts of the same miniature (e.g. a point whose x is spacing and y is jitter; a curve with a handle for its depth and another for its falloff). List every path the widget sets in `paths`.
- Temporal properties: animate the miniature with `h.time` so the timing is visible, and grab something that expresses time (drag the moving thing faster/slower, stretch a period on a timeline, set a delay by dragging a marker).
- Colors: show the color on the thing it paints; let the user drag across a hue/lightness field drawn in the widget, or pick among a few nearby swatches (draw them; there is no native picker). Selects: draw each option as a small picture of what it does and let the user tap one. Toggles: show the effect on vs off and toggle by tapping the picture.
- Make the grabbable parts obvious (filled handle dots, a slightly thicker outline on hover via `h.hover`, a highlight while `h.pressed`), show the current value with its unit somewhere small, and keep the drawing light and clean (thin strokes, the property's `h.color` for handles, soft greys for context, no big titles — the frame already shows the property's name and your `hint`).
- The miniature does not need to match the canvas scale; fit it to the widget area. It should stay readable and grabbable at every value in the range.

## Widget code contract

Each widget is plain JavaScript that registers ONE widget:

```js
rulegenHandle(function (h) {
  // setup: compute nothing heavy here; keep state in local variables
  let grab = null;
  return {
    draw() { /* draw with p (the p5 instance) in local coordinates: 0..h.w × 0..h.h */ },
    pressed() { /* the pointer went down inside this widget: h.mouseX, h.mouseY */ },
    dragged() { /* the pointer moves while held; call h.set(...) here for live changes */ },
    released() { },
  };
});
```

- Draw only with `p` (p5.js 1.x instance mode: `p.line`, `p.ellipse`, `p.beginShape`, `p.vertex`, `p.bezier`, `p.arc`, `p.text`, `p.fill`, `p.stroke`, `p.noFill`, `p.strokeWeight`, `p.push`/`p.pop`, `p.translate`, `p.rotate`, `p.map`, `p.constrain`, `p.lerp`, `p.lerpColor`, `p.color`, `p.dist`, `p.atan2`, `p.TWO_PI` …). The origin is the widget's top-left corner and drawing is clipped to it. Angles are radians. Never create a canvas, never assign `p.setup`/`p.draw`/`p.mousePressed`, never use `window`, `document`, timers, `fetch`, `eval`, or randomness that changes every frame (use a fixed seed or a deterministic function so the miniature does not flicker).
- `h.w`, `h.h`: the widget size. `h.mouseX`, `h.mouseY`, `h.pmouseX`, `h.pmouseY`: the pointer in widget coordinates. `h.pressed`: this widget is being dragged. `h.hover`: the pointer is over it. `h.time`: milliseconds, for animation. `h.color`: the accent color for its effect.
- `h.v(path)`: the current value of a scalar; `path` is the scalar's `path` joined by `/` (`""` = the property's own value, `"length/base"` = argument `base` of argument `length`). `h.spec(path)`: `{ type, value, min, max, step, unit, options }`. `h.ratio(path)`: where the value sits in its range, 0..1.
- `h.set(path, value)`: set a scalar (clamped to its range, rounded to its step; a select takes an option or an index; a toggle a boolean; a color `"#rrggbb"`). It returns the value actually set. `h.setRatio(path, t)`: set by 0..1. Call them continuously while dragging: the result updates live. Only paths listed in `paths` can be set.
- Values can also change from outside (sliders, state changes): always draw from `h.v(…)`, never from a cached copy, except for the part being dragged.
- Keep each widget under about 120 lines; no external libraries; loops must be small and bounded.

## Output JSON

Return exactly one object matching `prompts/schemas/handles.json`: `handles`, one entry per property you design (each `propertyId` at most once, ids and paths exactly as given):

- `propertyId`.
- `paths`: the scalar paths this widget sets (arrays of argument ids; `[]` = the property's own value). Include every path you call `h.set` with.
- `hint`: a short Korean phrase (at most about 18 characters) saying what to grab and what it does, in everyday words of the picture, e.g. `"가지 끝을 끌어 벌리기"`, `"꽃잎을 돌려 개수 바꾸기"`, `"물결 꼭대기를 끌어 높이기"`. No ids or code names.
- `code`: the widget source, starting with `rulegenHandle(`.

Example (a property `spread` = angle between two branches, `[]` = number 10..80 °, plus `length` 20..200 px):

```json
{ "handles": [ { "propertyId": "spread", "paths": [[], ["length"]], "hint": "가지 끝을 끌어 벌리기",
  "code": "rulegenHandle(function (h) {\n  const base = () => ({ x: h.w / 2, y: h.h - 16 });\n  const reach = () => Math.min(h.w * 0.42, h.h - 36) * (0.35 + 0.65 * h.ratio('length'));\n  let side = 0;\n  function tip(sign) { const b = base(), a = -Math.PI / 2 + sign * h.v('') * Math.PI / 360; return { x: b.x + Math.cos(a) * reach(), y: b.y + Math.sin(a) * reach() }; }\n  return {\n    draw() {\n      const b = base();\n      p.stroke(120); p.strokeWeight(3); p.line(b.x, b.y + 12, b.x, b.y);\n      for (const sign of [-1, 1]) { const t = tip(sign); p.stroke(h.color); p.strokeWeight(2); p.line(b.x, b.y, t.x, t.y); p.noStroke(); p.fill(h.pressed && side === sign ? h.color : 255); p.stroke(h.color); p.ellipse(t.x, t.y, 14, 14); }\n      p.noStroke(); p.fill(90); p.textSize(11); p.textAlign(p.CENTER); p.text(Math.round(h.v('')) + '° · ' + Math.round(h.v('length')) + 'px', b.x, 14);\n    },\n    pressed() { const l = tip(-1), r = tip(1); side = p.dist(h.mouseX, h.mouseY, l.x, l.y) < p.dist(h.mouseX, h.mouseY, r.x, r.y) ? -1 : 1; },\n    dragged() {\n      const b = base(), dx = h.mouseX - b.x, dy = h.mouseY - b.y;\n      const half = Math.abs(Math.atan2(dx, -dy)) * 180 / Math.PI;\n      h.set('', half * 2);\n      const max = Math.min(h.w * 0.42, h.h - 36), d = Math.hypot(dx, dy) / max;\n      h.setRatio('length', (d - 0.35) / 0.65);\n    },\n  };\n});" } ] }
```
