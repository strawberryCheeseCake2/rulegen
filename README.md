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

Every AI generation (analysis, rules, subfeatures, clarification, revision proposals, code, brush, composition prompt drafting and sketch composition, including retries/repairs) is automatically saved on the server under `ai-generations/<UTC date>/<timestamp-intent-unique ID>/`. Each folder contains `log.json` with model, status, timestamps, duration, request ID and token usage when returned; `request.json` with the app input; `prompt.json` with the AI request body; `response.json` (or `response.txt` for non-JSON responses); and `result.json` with the validated result. Code results also include `generated.js`. Input images are saved as `image-*.png/jpg/webp`, referenced by relative filenames in the JSON logs. Failed and cancelled requests include `error.json`; requests interrupted by a server shutdown retain `started` status. A file appears only once its corresponding stage has been reached.

Logs are local files excluded from Git, and do not include authorization headers or API keys. They are retained until you remove them. Set `RULEGEN_AI_LOG_DIR` in `.env.local` to change the destination (relative paths resolve from the project root). If the server cannot write logs, generation reports a storage error. Local actions such as Make pen, widget edits and running existing code do not invoke AI and do not create generation logs.

## Workflow

1. Use **Add sketch frame (+)** in the left toolbar to add an independent sketch canvas. Click/draw on a frame to edit it; Undo, Redo and Clear apply to that frame. Use its Analyze button to discover features there. Additional frames, artwork and positions are included in local saves and JSON exports. Draw with the pencil, erase, undo/redo, pan with H or Alt+drag, and zoom using the left toolbar. Pencil settings open beside the pencil button.
2. Attach a PNG, JPG, or WebP photo (up to 20 MB), drop it on the canvas, or paste a copied image/screenshot with Cmd+V / Ctrl+V while outside text fields. Photos are resized locally before use and pasted/attached into the selected sketch frame. Click a sketch frame, its header, or its Focus button to select it; a green border and highlighted title show the active destination. Pasting can be undone/redone independently in that frame. You can sketch over a photo.
3. Analyze the whole image, or draw a closed lasso with L to analyze only that region. Analysis is sent to OpenAI when requested. Five to six visual features appear near their detected regions. Labels remain editable.
4. Select a feature to focus on its rules. Clear the selection to see all generated rule groups. Generate rules or alternatives; edit them and add a generation direction.
5. Generate p5.js code and inspect its visual output. Edit and run the code, download it, or ask AI to fix a runtime error.
6. Click **Annotate** above the generated result and sketch freely over it. Click **AI clarification 만들기** to let AI compare the clean result with your sketch and fill an editable **Text clarification** draft. Review or edit the draft, then request rule/visual-feature suggestions. Use **AI 설명 다시 만들기** to reinterpret an updated sketch. Review concrete Before/After changes, then **Confirm** to regenerate connected p5.js code and apply features, widgets and output together. Use **Erase** (or E), **Undo/Redo**, Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z or Ctrl+Y to edit the sketch; Clear preserves the underlying generated result and clarification. Editing the sketch or clarification invalidates older suggestions. Cancel or generation failure keeps the current result. Feedback sketches are temporary; confirmed changes persist with the project.
7. Open the Brush step, select one or several features, optionally describe the desired motif, color, density or drawing behavior, and generate. The description is sent to the AI along with the features and persists with the project. The AI produces a validated motif recipe drawn by the p5 engine. Adjust spacing, size, spread, variation, taper, and color; draw in the brush lab or use it on the original sketch. Save brushes locally or export recipes and p5.js brush code.
8. In **Rules**, click **Make pen** to add a colored pencil carrying the selected algorithm's meaning and exact parameter snapshot to the toolbar. This is immediate and does not call AI. Draw freely with it just as with Pencil: the canvas keeps ordinary lines, each tagged with the pen's semantic meaning. Switch between pens and Pencil to sketch a composition. Click **Compose sketch** with an empty **Compose prompt** to have AI recognize the full sketch and fill an editable Korean prompt first. Review or edit it, then click **Compose sketch** again to generate the result. **AI prompt 만들기 / AI prompt 다시 만들기** can also draft or refresh the prompt, taking existing text into account. Prompt drafting needs no prior feature analysis and uses the image plus stored stroke semantics; edits made during a request are preserved. Drafting is logged alongside other AI requests. AI receives the full sketch image, ordered paths (including erasers), per-stroke algorithm snapshots and the prompt to create the selected sketch's generated result. Pen colors identify semantics; the prompt and drawn forms determine the output. For example, sketch an increasing pattern with a Power pen and ask for growth using its exponent along a Pencil layout. Click a toolbar pen to inspect or edit its meaning and color; changes affect future strokes. Removing a pen keeps the semantics on existing marks. Pens, stroke metadata and each sketch's Compose prompt persist in project JSON and local storage.

The current exploration, uploaded image, editable rules, generated code, and saved brushes persist in browser local storage. Export a `.rulegen.json` file before starting a new project to keep an independent copy. Imported JSON is validated. Storage quota failures are shown in the header; JSON export is still available.

Generated sketches run in an iframe with a separate sandbox, no app storage access, and no network permission. Code is parsed on the server and guarded against unbounded loops and recursion. The engine and p5 library are bundled locally; no CDN is required. Rendering errors are surfaced with an AI repair option.

## Verification

```sh
npm run typecheck
npm test
npm run build
npm start
```

Tests cover code execution guards, forbidden APIs, actual brush stamping/density, semantic pencil snapshots, prompt composition context, legacy pen migration, brush code exports, semantic composition AI context, image request validation, and project serialization. Live API requests incur usage on the configured OpenAI account; no mock outputs are returned.

Each sketch owns its Features, Rules, Code and Brush panel. Selecting a sketch restores its tab, feature filter, widgets, generation direction, editable code draft and brush settings. Each sketch also has its own generated result frame, so multiple outputs remain visible together. Extra sketches get their result frame below the sketch when code is first generated. Clicking a result opens its sketch's panel; widgets, code edits, Run again and annotations affect that result independently. Result frame positions and panel data persist in local storage and project JSON; annotation drafts remain scoped to each sketch during the session. Existing projects migrate their shared analysis to the sketch that produced it.
