# Rulegen

A working sketch-to-creative-code studio powered by p5.js and the OpenAI Responses API.

## Run

Use Node.js 22.16+ (Node 24 LTS recommended).

```sh
npm install
npm run dev
```

Create `.env.local` at the project root:

```dotenv
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=your_image_capable_model
```

The app honors `OPENAI_MODEL`. The model must support image input and structured JSON output via the Responses API. Environment files are loaded only by the server. Restart after changing configuration. No API keys enter browser bundles or project exports.

## AI generation logs

Every AI generation (decompose, transformation regeneration, code, composition prompt drafting and composition, including retries/repairs) is automatically saved on the server under `ai-generations/<UTC date>/<timestamp-intent-unique ID>/`. Each folder contains `log.json` with model, status, timestamps, duration, request ID and token usage when returned; `request.json` with the app input; `prompt.json` with the AI request body; `response.json` (or `response.txt` for non-JSON responses); and `result.json` with the validated result. Code results also include `generated.js`. Input images are saved as `image-*.png/jpg/webp`, referenced by relative filenames in the JSON logs. Failed and cancelled requests include `error.json`; requests interrupted by a server shutdown retain `started` status. A file appears only once its corresponding stage has been reached.

Open **AI history** in the header to browse every generation, inspect successful results or errors, download the result log, and restore a completed generation without another AI call. New generations also save `context.json` (the project before generation and the target frame) and `recovery.json` (the restorable project) alongside image assets. A decompose log restores its minimal example frames (without code or pens); a compose log restores its composition frame. Restore replaces the current local draft with that generation's project; export any draft you want to keep first. The board comes back as it was: frame positions and the view (camera and zoom); only a log without a saved view moves the view to the restored frame. Logs from previous project formats are not restored.

Transient OpenAI failures (503 overload, 500/502/504, rate-limit 429) are retried up to 3 times with backoff (2s, 4s, 8s, or the server's Retry-After); exhausted quota and key/model errors are not. Retried responses are kept as `response-<round>-retry<n>.txt` and listed under `retries` in `log.json`.

**Error logs.** Every error the studio shows is also written to `error-logs/<UTC date>/<timestamp-source-id>.json`: `ai` (failed generations with intent, model, HTTP status, provider error code and the `ai-generations/` key), `prepare` (code that failed the safety check, with the code), `runtime` (errors thrown by a generated sketch in the browser, with its program), `ui` (other errors shown on a frame) and `server` (malformed requests). API keys are redacted and image data URLs omitted. Set `RULEGEN_ERROR_LOG_DIR` to change the folder; it is excluded from Git.

Logs are local files excluded from Git, and do not include authorization headers or API keys. They are retained until you remove them. Set `RULEGEN_AI_LOG_DIR` in `.env.local` to change the destination (relative paths resolve from the project root). If the server cannot write logs, generation reports a storage error. Local actions such as making pens, slider edits and running existing code do not invoke AI and do not create generation logs.

## Workflow

**Sketch → Decompose → minimal examples & transformation pens → Compose.**

1. **Sketch.** Draw on the original sketch frame (or add one with **+**), or attach / drop / paste a photo. Pencil, eraser, lasso, pan and zoom are in the left toolbar; each frame has its own Undo/Redo.
2. **Decompose.** On a sketch frame (header, right panel step 1, or Layers), **Decompose** sends the sketch to AI (`decompose` intent), which splits it into its **objects** (each kind of element as one plain instance: what it is, e.g. a petal; at most 6) and semantic transformations that are **as independent as possible**: each is one operation that makes sense and shows on its own on a plain subject, and no two control the same aspect (arrangement, count, per-copy variation, the shape of one element, style, motion). Transformations are **operations only**: what the sketch's elements are (a petal's shape, a leaf, a branch stroke) is an object, never a transformation, so nothing like "Petal shape" is returned as one. Each comes with the smallest **collection/object structure** that shows it (`nodes`: objects drawn as the sketch's objects, so a first-level example looks like the source, or plain stand-in circles/squares where none fits, and collections grouping them — several objects, several or nested collections when needed) and the `carrier` node it applies to (a collection: its members as a whole; an object: that shape); a collection of copies of one member always gets a count control (the count of the transformation that makes the copies, or else a plain structural `Copies` count, not part of any pen, so an operation that only acts on copies, like bending a row, never owns their count), plus the region of its evidence; labels and descriptions follow low-coupling rules (named for the operation, described on "copies" / "the shape", no other transformation's effects): even where the example draws the sketch's element, the transformation carries none of it and works unchanged on any shape.
3. **Minimal examples.** Every object and every transformation immediately becomes a **minimal example frame** beside the sketch (a grid, three per column, objects first). An **object example** draws that element alone, once, with no transformation and no pen. A transformation example has only that transformation on its carrier, the other nodes plain (ids and names are the app's: the sketch object's name, or Group, Circle 2 …; the structure is made sound first), no machines, only the algorithms it calls. Their code is generated right away, up to three at a time, against the example itself (examples drawing the sketch's elements also see the source sketch image, to draw them like it and take nothing else) with an instruction to show only that transformation with visibly working sliders and reusable functions. Tune values there, or regenerate the transformation with AI (the code follows). An example can itself be **decomposed further** (frame header, or **Decompose further** in its panel): its one transformation, with its current values and algorithms, is sent as `split`, and AI splits it into 2–6 smaller, independent transformations, each again a minimal example, now fully independent of the sketch (no objects; plain stand-in shapes only) (beside the parent example, which stays). Splitting looks for separable aspects inside properties and algorithms (count, spacing along a path, the path's curvature, orientation, per-index variation, …); only a transformation controlling one aspect is already primitive, and then nothing is made and the model's reason is shown. This repeats to any depth; example lists show the tree.
4. **Transformation pens.** A transformation example becomes a **pen** in the toolbar only when you press **Make pen** (its frame header, or the example panel head; no AI). Decompose and AI-history restore make no pens. A pen carries its transformation, subject and algorithms, and always **follows its example**: values tuned or regenerated there are what the pen draws with (toolbar, strokes already drawn with it, and Compose all read it live). Deleting the example frame freezes the pen as it was. A mark drawn with a pen means "this transformation goes here"; draw shapes and layout with the pencil.
5. **Compose.** On a sketch drawn with pens, **Compose sketch** (right panel step 3) first lets AI draft an editable Korean prompt from the sketch and the pens' transformations (`compose-prompt`), then builds the scene (`compose`). The model only says which node takes which pen (`pens`); the app copies each pen's transformation into that node **exactly as its example has it** (values and algorithms, an `origin` pointing back to the example, the pen's ids kept so machine states can set its properties), followed by the node's own transformations. The result goes into a new **composition frame**, and its code generation receives the code modules of those examples as `references` to reuse their implementation.

On the board, the select tool drags a selection rectangle over empty space to pick several frames (⇧ adds, ⇧-click a header toggles one); picked frames move together by their headers and are deleted together with Delete/Backspace or the selection bar (with a confirmation for more than one; frames running AI work are kept). Space+drag, the hand tool or the middle button pan. The board layout (frame positions and camera) is saved with the project and restored as it was on reload.

Frames have a role — **sketch**, **minimal example** or **composition** — shown in the frame subtitle and in the right panel's head (the workflow steps; the example's transformation and pen; the composition's source sketch, the examples it took transformations from, and its prompt). Examples and compositions are linked to their sketch on the board and warn when it changed since. Frame headers offer **Run/Pause**, **Interact** (the running result alone takes mouse, touch and keyboard input; Esc stops), **Re-render**, **Generate/Update**, **Decompose** (sketches and examples) and **Make pen** / **Pen** (transformation examples).

Every frame renders its own result under its strokes and layer boxes. The **Layers** panel and the **Select** tool (V) select, rename, hide, group (⌘G), ungroup (⇧⌘G), nest, reorder, move and delete collections and objects; moving a node moves the running result live. The right panel shows the selected node's stack of semantic transformations (add, rename, reorder, add or modify with AI — with text and drawing on the frame, clarified first — or delete); a transformation taken from a pen shows **From pen · … example** and goes to that example. Each property is a socket for a value or an **algorithm block** (drag blocks from the palette, copy/paste across frames, nest them). Every scalar and each node's box is live-bound to the code (`m.v`, `m.box`), so sliders and moves update the result without AI. Code is in the bottom **Raw p5.js** panel (edit, run, copy, download, Fix with AI); the **State Machine** tab shows a node's machine (machines come from Compose when interaction marks or the prompt describe motion or input), with play/pause/restart, event buttons, per-state values and draggable layout.

**Annotate (add or modify, clarified first).** On any frame with a scene, **Annotate** (frame header) opens a request at the top of the right panel and starts drawing: mark the frame (violet) and/or write what to add or change. The ✦ buttons on a property or transformation, and Add transformation with AI, open the same request fixed to that target. **Clarify** sends it to AI (`clarify` intent), which changes nothing and answers in text: what it understood, the target (add to a node, or modify one of its transformations or properties; it picks this from the marks on a frame-wide request), the concrete plan, and up to three questions. Answer and **Clarify again**, or **Apply**: the `transform` step then adds or modifies exactly that, with the confirmed plan as its brief, and the code follows. While a request is open, picking a **transformation pen** in the toolbar keeps you on the frame: strokes drawn with it (in its color) mean "this pen's transformation goes here". The AI gets each stroke's pen and the pens' transformations; adding one copies the pen's transformation into the node exactly as its example has it (no AI generation; the code reuses the example's code), and a modification uses the pen as its reference.

The default **Interaction pen** marks click/tap targets, hover areas, drags and drops; Compose turns them into node machines and real input handlers.

The project (frames, photos, scenes, pens, prompts, code, board layout) persists in browser local storage (format `version: 2`; older formats are not migrated; old algorithm pens are dropped and their strokes stay pencil lines). Export a `.rulegen.json` to keep a copy.

Generated sketches run in an iframe with a separate sandbox, no app storage access, and no network permission. Code is parsed on the server and guarded against unbounded loops and recursion: a frame (or input event, message) still running after 10 s stops with an error (`app/lib/render-guard.ts`). The engine and p5 library are bundled locally.

## Verification

```sh
npm run typecheck
npm test
npm run build
npm start
```

Tests never reach the network (`tests/setup.ts`); AI calls are mocked. `tests/workflow.test.ts` covers the whole workflow: decompose conversion, minimal example scenes and instructions, pens following their examples, compose splicing pen transformations, code references, the Decompose (including splitting an example further) and Compose actions, and AI-history recovery.

## Prompts

All AI prompts live in [`prompts/`](prompts/) as Markdown, one file per intent (`decompose`, `compose`, `compose-prompt`, `clarify`, `transform`, `code`), with shared contracts in `prompts/contracts/` pulled in through `{{include:…}}`. Each file ends with its output JSON format, and `prompts/schemas/<intent>.json` holds the exact strict JSON Schema the server sends. Prompts are re-read on every request. After changing a schema run `npm run prompts:schemas` (tests fail when the files are stale). `RULEGEN_PROMPT_DIR` changes the location.

**Structure and granularity.** Parts that share a clear common feature stay ONE whole object, their differences expressed as fine-grained transformations; only parts that differ in kind become nested collections (up to 5 levels). Each transformation is ONE semantic operation named for what it does, usually 1–3 properties, never an effect-type bucket. Repeated elements are ONE node whose transformation generates the instances (count + layout block + per-instance variation).

**Code modules.** Generated code is one independent module per root node: `rulegenModule("<root id>", function (m) { … return { setup, draw, mousePressed, … } })`, reading only its own nodes through `m.v`, `m.box`, `m.state` and `m.emit` and keeping its changing state in `m.store`, while the host owns the canvas, the loop and input. Anything made from input is derived every frame from `m.history()` (gestures with a stable `id` and `rev`) and the current values, with `m.memo` caching per gesture, so value changes adjust it in place.
