## SCENE CODE CONTRACT

Your code is a set of independent MODULES, one per ROOT node (a node whose `parentId` is null; `modules` lists each root id with the node ids it draws). A module is drawn on its own: the user can lift one into another sketch as a reusable brush stamp, copy it several times, and every copy runs the same module code with its own node ids. So the WHOLE program is only this, once per root, in any order:

```js
rulegenModule("<root id>", function (m) {
  // only functions and constants here: algorithm functions, helpers, fixed numbers
  function algo_power_decay(base, ratio, depth) { return base * Math.pow(ratio, depth); }
  const GRAVITY = 0.4;
  return {
    setup() { /* optional: (re)build m.store from the values, e.g. m.store.particles = []; runs again when values change */ },
    draw() { /* required: draw this root and all of its nodes, every frame */ },
    mousePressed(event) { /* optional input: mouseMoved, mouseDragged, mouseReleased, mouseClicked, doubleClicked, mouseWheel, keyPressed, keyReleased, keyTyped, touchStarted, touchMoved, touchEnded */ },
    stateEntered(nodeId, stateId) { /* optional: a node of this module entered a state */ },
  };
});
```

Nothing may be written outside the `rulegenModule(...)` calls, and modules must not share anything: no top-level variables or functions, no undeclared globals. The factory parameter must be named `m` and is used ONLY as below (call these directly with string-literal arguments, never pass `m` or its functions around):

- `m.v("<key>")` — a live value. For EVERY entry of `parameterBindings` whose node belongs to this module, read it with the EXACT literal key and use it in real geometry, color, timing or behavior so that moving the slider changes the visual. Keys are `nodeId/propertyId` for a scalar property, and `nodeId/propertyId/argId/…` for the scalar arguments of an algorithm call (nested arguments add further segments). Never copy current values as literals and never build keys dynamically.
- `m.box("<node id>")` — `{ x, y, w, h, visible }`: the node's current box in canvas pixels. Place EVERY node of the module inside its box (translate/scale your drawing into it) and skip nodes that are not `visible`, so that moving, copying or hiding a node follows live. Never hardcode positions.
- `m.state("<node id>")` — only for nodes with a machine: `.id` is the current state id and `.elapsed` the milliseconds since it entered it. When the state changes the host swaps the values behind that node's `m.v` keys, so reading `m.v` inside `draw` is enough for most state-dependent appearance. Branch on `.id` when the algorithm or layout itself differs between states; use `.elapsed` for within-state motion.
- `m.emit("<node id>", "<transition id>")` — fire a named event transition of that node (see the interaction contract). Both ids are string literals at every call site; when several transitions share logic, branch to separate literal calls (e.g. `if (inside) m.emit("stars", "enter-star"); else m.emit("stars", "leave-star");`). Timed transitions are applied by the host.
- `m.p` (or `p`) — the shared p5 instance to draw with.
- `m.store` — this instance's state object. EVERYTHING that changes between frames or after input (positions, velocities, particle arrays, counters, drag flags, accumulated history) lives in `m.store` as plain data: numbers, strings, booleans, arrays and plain objects (use `{ x, y }`, not `p5.Vector` or class instances). Mutate inside it (`m.store.x += m.store.vx`, `m.store.particles.push({ x, y })`), never replace it. The host saves `m.store` at every state change so the user can step back to that moment, edit values and see the module redraw from there.

Only node ids of the module's own nodes are valid. The host owns the canvas and the loop: it creates the 900×600 canvas, clears it every frame (transparent; the light page shows through), calls each module's `draw` inside `push()/pop()` and passes input to every module. Modules must NOT assign anything on `p` (`p.setup`, `p.draw`, `p.mousePressed`, …) and must NOT call `background`, `clear`, `createCanvas`, `resizeCanvas`, `noCanvas`, `noLoop`, `loop`, `redraw`, `frameRate`, `pixelDensity` or `remove`. A full-frame backdrop is a node of its own: fill that node's box. For trails, keep a bounded history (e.g. the last 60 points) in `m.store` and redraw it each frame.

Implementation rules:

- Implement every library algorithm a module uses INSIDE that module as a local function named after its id (e.g. `function algo_sine_wave(args, t) {…}`) following its Korean description exactly, and call it wherever the module's nodes use it. Two modules using the same algorithm each define their own copy. An argument that is itself an algorithm call means "evaluate that algorithm to obtain this parameter" (e.g. a length driven by power-decay over depth).
- Render each node from its stack of `transformations`, applied in order (each builds on the previous result): collections apply them to all of their members (children), objects draw their primitive. Property keys stay `nodeId/propertyId…` whichever transformation holds the property.
- A node usually stands for MANY instances: when its properties include a count, a distribution/layout algorithm (e.g. `repeat-layout`, `radial-repeat`, `scatter`) or recursion, generate every instance with that algorithm inside the node's layout box and apply the per-instance variation its algorithms describe. A collection with such a property repeats its whole subtree (its children are the parts of one instance). Never draw only one copy.
- The module function's own scope holds ONLY function declarations and `const`s that are functions or plain numbers/strings (no `let`/`var`, no arrays, objects or `new` there); a `const` array or object would be hidden state. Locals inside handlers are fine.
- `draw` runs every frame: read the values inside `draw` every frame (do not copy them into `m.store`, so editing a value redraws even a restored moment), and animate with `m.state(…).elapsed` or values advanced in `m.store`. Do not use `p.millis()` or `p.frameCount` for motion: they cannot be restored.
- Return only the `rulegenModule(...)` calls. Do not include or imitate host blocks or drivers. Do not create a new p5 instance.
- Only p5 drawing, math and local JS. No imports, DOM, storage, network, external assets, eval, Function, timers, exports or markdown fences. Finite loops and bounded recursion; prefer a deterministic seed.
- No technical labels, legends or parameter readouts in the artwork unless the user asks for them.
