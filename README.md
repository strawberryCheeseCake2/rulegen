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

## Workflow

1. Use **Add sketch frame (+)** in the left toolbar to add an independent sketch canvas. Click/draw on a frame to edit it; Undo, Redo and Clear apply to that frame. Use its Analyze button to discover features there. Additional frames, artwork and positions are included in local saves and JSON exports. Draw with the pencil, erase, undo/redo, pan with H or Alt+drag, and zoom using the left toolbar. Pencil settings open beside the pencil button.
2. Attach a PNG, JPG, or WebP photo (up to 20 MB), drop it on the canvas, or paste a copied image/screenshot with Cmd+V / Ctrl+V while outside text fields. Photos are resized locally before use and pasted/attached into the selected sketch frame. Click a sketch frame, its header, or its Focus button to select it; a green border and highlighted title show the active destination. Pasting can be undone/redone independently in that frame. You can sketch over a photo.
3. Analyze the whole image, or draw a closed lasso with L to analyze only that region. Analysis is sent to OpenAI when requested. Five to six visual features appear near their detected regions. Labels remain editable.
4. Select a feature to focus on its rules. Clear the selection to see all generated rule groups. Generate rules or alternatives; edit them and add a generation direction.
5. Generate p5.js code and inspect its visual output. Edit and run the code, download it, or ask AI to fix a runtime error.
6. Click **Annotate** above the generated result and sketch freely over it. Click **AI clarification 만들기** to let AI compare the clean result with your sketch and fill an editable **Text clarification** draft. Review or edit the draft, then request rule/visual-feature suggestions. Use **AI 설명 다시 만들기** to reinterpret an updated sketch. Review concrete Before/After changes, then **Confirm** to regenerate connected p5.js code and apply features, widgets and output together. Use **Erase** (or E), **Undo/Redo**, Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z or Ctrl+Y to edit the sketch; Clear preserves the underlying generated result and clarification. Editing the sketch or clarification invalidates older suggestions. Cancel or generation failure keeps the current result. Feedback sketches are temporary; confirmed changes persist with the project.
7. Open the Brush step, select one or several features, optionally describe the desired motif, color, density or drawing behavior, and generate. The description is sent to the AI along with the features and persists with the project. The AI produces a validated motif recipe drawn by the p5 engine. Adjust spacing, size, spread, variation, taper, and color; draw in the brush lab or use it on the original sketch. Save brushes locally or export recipes and p5.js brush code.

The current exploration, uploaded image, editable rules, generated code, and saved brushes persist in browser local storage. Export a `.rulegen.json` file before starting a new project to keep an independent copy. Imported JSON is validated. Storage quota failures are shown in the header; JSON export is still available.

Generated sketches run in an iframe with a separate sandbox, no app storage access, and no network permission. Code is parsed on the server and guarded against unbounded loops and recursion. The engine and p5 library are bundled locally; no CDN is required. Rendering errors are surfaced with an AI repair option.

## Verification

```sh
npm run typecheck
npm test
npm run build
npm start
```

Tests cover code execution guards, forbidden APIs, actual brush stamping/density, brush code exports, image request validation, and project serialization. Live API requests incur usage on the configured OpenAI account; no mock outputs are returned.

Each sketch owns its Features, Rules, Code and Brush panel. Selecting a sketch restores its tab, feature filter, widgets, generation direction, editable code draft and brush settings. Each sketch also has its own generated result frame, so multiple outputs remain visible together. Extra sketches get their result frame below the sketch when code is first generated. Clicking a result opens its sketch's panel; widgets, code edits, Run again and annotations affect that result independently. Result frame positions and panel data persist in local storage and project JSON; annotation drafts remain scoped to each sketch during the session. Existing projects migrate their shared analysis to the sketch that produced it.
