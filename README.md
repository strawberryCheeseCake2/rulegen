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

Every AI generation (analysis, rules, subfeatures, clarification, revision proposals, code, constraint code, brush, legacy composition prompt drafting and sketch composition, including retries/repairs) is automatically saved on the server under `ai-generations/<UTC date>/<timestamp-intent-unique ID>/`. Each folder contains `log.json` with model, status, timestamps, duration, request ID and token usage when returned; `request.json` with the app input; `prompt.json` with the AI request body; `response.json` (or `response.txt` for non-JSON responses); and `result.json` with the validated result. Code results also include `generated.js`. Input images are saved as `image-*.png/jpg/webp`, referenced by relative filenames in the JSON logs. Failed and cancelled requests include `error.json`; requests interrupted by a server shutdown retain `started` status. A file appears only once its corresponding stage has been reached.

Logs are local files excluded from Git, and do not include authorization headers or API keys. They are retained until you remove them. Set `RULEGEN_AI_LOG_DIR` in `.env.local` to change the destination (relative paths resolve from the project root). If the server cannot write logs, generation reports a storage error. Local actions such as moving/resizing objects and spatial groups, parameter edits and running existing code do not invoke AI and do not create generation logs.

## Workflow

1. Use **Add sketch frame (+)** in the left toolbar to add an independent sketch canvas. Click/draw on a frame to edit it; Undo, Redo and Clear apply to that frame. Use its Analyze button to discover features there. Additional frames, artwork and positions are included in local saves and JSON exports. Draw with the pencil, erase, undo/redo, pan with H or Alt+drag, and zoom using the left toolbar. Pencil settings open beside the pencil button.
2. Attach a PNG, JPG, or WebP photo (up to 20 MB), drop it on the canvas, or paste a copied image/screenshot with Cmd+V / Ctrl+V while outside text fields. Photos are resized locally before use and pasted/attached into the selected sketch frame. Click a sketch frame, its header, or its Focus button to select it; a green border and highlighted title show the active destination. Pasting can be undone/redone independently in that frame. You can sketch over a photo.
3. Analyze the whole image, or draw a closed lasso with L to analyze only that region. Analysis is sent to OpenAI when requested. Two to six visual features appear near their detected regions. Labels remain editable.
4. Select a visual feature, then click **Generate widgets**. AI classifies widgets as **Spatial constraint**, **Stylistic constraint**, or **Object** and extracts each implementation into an independent **Algorithm library**. The extraction has at most seven widgets across all selected features. Objects can be ellipse, rectangle, line, triangle or procedural path primitives. Temporal constraints are currently disabled. Spatial constraints are groups that can contain objects and nested spatial groups. Stylistic constraints have explicit object/group targets.
5. Open **Constraints** (or press **V**). Drag a primitive or constraint from **DRAG TO SKETCH** onto any sketch frame. Existing widget rows can be dragged to place them; dragging to another frame preserves the widget’s original image and feature information, its spatial children, governing shape/style constraints and required algorithm assets. A copied extraction automatically reconstructs its first result in the destination frame. Object drops inside a spatial group automatically become members; dropping into stylistic regions automatically connects the affected objects. Select a widget on the sketch or in the inspector; drag its shape, border or label to move it, and object corner handles resize primitives. Constraints only move; moving a spatial group translates its children without resizing them. Dropping an object/group into a spatial group updates membership; the inspector also exposes membership and targets. Arrow keys move a selected widget by 1 px (Shift: 10 px). Undo/Redo restore complete graph edits. Insert an algorithm from the library, drag it onto a constraint, detach it, or use **Move to constraint**. Detached algorithms remain reusable. Sharing one algorithm between constraints shares its canonical parameter values.
6. Click **Reconstruct sketch** to reconstruct the original source using its extracted constraint graph, appearance references and precise motif bounds. Constraint movement, object geometry and algorithm parameter edits update the result and code locally. Changes to attached algorithms, membership, targets or primitive types automatically regenerate connected code after a short pause, using AI. Failed/cancelled generations preserve the last result; **Reconstruct sketch** retries. Code stays editable and downloadable; runtime errors have an AI repair action.
7. Click **Annotate** above the generated result and sketch freely over it. Click **AI clarification 만들기** to let AI compare the clean result with your sketch and fill an editable **Text clarification** draft. Review or edit the draft, then request rule/visual-feature suggestions. Use **AI 설명 다시 만들기** to reinterpret an updated sketch. Review concrete Before/After changes, then **Confirm** to regenerate connected p5.js code and apply features, widgets and output together. Use **Erase** (or E), **Undo/Redo**, Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z or Ctrl+Y to edit the sketch; Clear preserves the underlying generated result and clarification. Editing the sketch or clarification invalidates older suggestions. Cancel or generation failure keeps the current result. Feedback sketches are temporary; confirmed changes persist with the project.
8. Open the Brush step, select one or several features, optionally describe the desired motif, color, density or drawing behavior, and generate. The description is sent to the AI along with the features and persists with the project. The AI produces a validated motif recipe drawn by the p5 engine. Adjust spacing, size, spread, variation, taper, and color; draw in the brush lab or use it on the original sketch. Save brushes locally or export recipes and p5.js brush code.

The current exploration, uploaded image, editable rules, generated code, and saved brushes persist in browser local storage. Export a `.rulegen.json` file before starting a new project to keep an independent copy. Imported JSON is validated. Storage quota failures are shown in the header; JSON export is still available.

Generated sketches run in an iframe with a separate sandbox, no app storage access, and no network permission. Code is parsed on the server and guarded against unbounded loops and recursion. The engine and p5 library are bundled locally; no CDN is required. Rendering errors are surfaced with an AI repair option.

## Verification

```sh
npm run typecheck
npm test
npm run build
npm start
```

Tests cover code execution guards, forbidden APIs, actual brush stamping/density, constraint membership/cycle validation, algorithm detachment/sharing, direct manipulation against real p5 drawing calls, graph serialization, legacy project migration, brush code exports, constraint generation AI context and complete live binding validation, image request validation, and project serialization. Live API requests incur usage on the configured OpenAI account; no mock outputs are returned.

Each sketch owns its Features, Constraints, Code and Brush panel. Selecting a sketch restores its tab, feature filter, widgets, generation direction, editable code draft and brush settings. Each sketch also has its own generated result frame, so multiple outputs remain visible together. Extra sketches get their result frame below the sketch when code is first generated. Clicking a result opens its sketch's panel; widgets, code edits, Run again and annotations affect that result independently. Result frame positions and panel data persist in local storage and project JSON; annotation drafts remain scoped to each sketch during the session. Existing projects migrate their shared analysis to the sketch that produced it.

Older rule projects migrate their selected implementations into the constraint scene automatically. Old semantic strokes and API formats are readable for compatibility, but Make pen, the algorithm pen toolbar and Compose sketch are no longer part of the interface. New generation uses the typed scene and independent algorithms; strokes are only source artwork.

Delete any sketch using its header trash button to remove its artwork, panel data, history and linked result. Deleting the final sketch leaves an empty workspace where you can add another. Deletions persist in local storage and project JSON. The complete requirements and V2 changes are recorded in `updated_V2.md`.

Constraint tags render as screen-sized HTML on a workspace without a scaled cached layer. Selecting one keeps it fully visible and fades the other widgets to 4%; Clear widget selection or Escape restores all tags.
