import { z } from "zod";
import { centerOf, MAX_CROP_POINTS, placed, type Box } from "./preview-objects";
import { evaluate, fixSchema, overlaySchema } from "./inspection";
import { isRuntimeKey, parseMove, targetNumber, targetPoint } from "./runtime-edits";

// Debugging intent alignment. On a targeted inspection's Execution frame the user steps
// to the moment the concern is about and DRAWS the program state they want there, by
// hand, with micro direct manipulation tools. AI reads the concern and makes the tools
// that let that state be drawn precisely (a shape to place, a pen for a form or a
// boundary, merging outlines into one, names for what was made), and presets: its
// guesses of the state wanted, made of the same objects, which the user loads and keeps
// changing with the tools. Execution state itself (a value the code keeps, a point of the
// input) is set by hand with state tools: grips on the picture, shown while the tool is
// chosen, as on a targeted inspection. The state drawn and set is what the brush is then fixed to.

type Point = { x: number; y: number };
const pointSchema = z.object({ x: z.number(), y: z.number() });
const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const alignId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/);

/**
 * A quantity of a drawn object the user wants, as a rule (an expression read on the frame at this moment as overlays
 * read it: `s(…)`, `p(…)`, numbers; `item("w")`, `item("h")`, `item("cx")`, `item("cy")` the object's own box where
 * it was made). `w`, `h` (its size), `x`, `y` (its center) and `rotate` (degrees) place the object, a `color` written
 * `#rrggbb` paints it; any other aspect (a count, a timing, a color in words) is said for AI only.
 */
export const SPEC_PLACING = ["w", "h", "x", "y", "rotate"] as const;
/** A reading of what the user may want for a quantity, to choose on the tag: its rule and what it means in a few words. */
export const specOptionSchema = z.object({ expr: z.string().max(300), note: z.string().max(60) });
export type SpecOption = z.infer<typeof specOptionSchema>;
export const MAX_SPEC_OPTIONS = 4;
/** A rule on a tag; `expr` "" is left open (the user chooses one of `options`, or writes their own). A `color` that is `#rrggbb` paints the object. */
export const objectSpecSchema = z.object({ aspect: z.string().max(30), expr: z.string().max(300), options: z.array(specOptionSchema).max(MAX_SPEC_OPTIONS).default([]) });
export type ObjectSpec = z.infer<typeof objectSpecSchema>;
export const MAX_SPECS = 4;

/**
 * What a tool AI makes does, in three groups, each with a mechanism that changes what the frame shows:
 * - inspecting the execution state: "state" shows the condition the concern is about as the code decides it and sets
 *   execution state at this moment with the grips of its `handles` (overlays whose handle changes an `@store:` or
 *   `@input:` key); the kit's `variables` are shown by their inspect tools;
 * - drawing a procedural behavior: "behavior" draws a form or a line (a reach, a region, a boundary, a path) whose
 *   geometry gives `values`, which the brush's code reads through the frame-local `patch` AI wrote for it: drawing it
 *   changes what the brush draws, in this frame only;
 * - drawing the state wanted: "shape" places a form (its `template`) by dragging its box; "pen" draws a form
 *   (`closed`) or a line; "merge" joins the selected forms into one outline.
 * "label" (names offered for tags) is no longer made: kits saved with one still load, and it is not shown.
 */
export const ALIGN_TOOL_KINDS = ["shape", "pen", "merge", "label", "state", "behavior"] as const;
export type AlignToolKind = (typeof ALIGN_TOOL_KINDS)[number];
/** Which group a tool is in (null: not shown). */
export const toolGroup = (tool: Pick<AlignTool, "kind">): "inspect" | "behavior" | "target" | null =>
  tool.kind === "state" ? "inspect" : tool.kind === "behavior" ? "behavior" : tool.kind === "label" ? null : "target";
/**
 * A value a behavior tool gives the code from what is drawn with it: a number (`expr`, read on the drawn object, as a
 * rule on a tag is: `item("w")`, `item("cx")`, `s(…)`, numbers), or its outline (`"outline"`: the points around its
 * center, canvas pixels, as JSON `[[dx, dy], …]`). `fallback` is what the code reads while nothing is drawn: the
 * brush as it is now.
 */
export const behaviorValueSchema = z.object({ id: z.string().regex(/^[a-z][a-z0-9_]{0,23}$/), label: z.string().min(1).max(40), kind: z.enum(["number", "outline"]),
  expr: z.string().max(300), fallback: z.union([z.number(), z.string().max(40)]) });
export type BehaviorValue = z.infer<typeof behaviorValueSchema>;
/** An exact change of a module's code (a snippet found once, and what it becomes). */
const codeEditSchema = z.object({ find: z.string().min(1).max(1500), replace: z.string().min(1).max(4000) });
/** The code a behavior tool runs with, in its frame only: edits of the module of `nodeId` that read the tool's values. */
export const behaviorPatchSchema = z.object({ nodeId: z.string().max(80), edits: z.array(codeEditSchema).max(4) });
export type BehaviorPatch = z.infer<typeof behaviorPatchSchema>;
/** The key the code reads a behavior tool's value by: `m.opt(<fallback>, "@tool/<tool>/<value>")`. */
export const behaviorKey = (toolId: string, valueId: string) => `@tool/${toolId}/${valueId}`;
export const isBehaviorKey = (key: string) => key.startsWith("@tool/");
export const alignToolSchema = z.object({
  id: alignId, kind: z.enum(ALIGN_TOOL_KINDS),
  /** What the user sees on the tool (about 3 words) and what using it does. */
  name: z.string().min(1).max(40), hint: z.string().max(160), color: colorSchema,
  /** What a thing made with it is called (shape, pen; merge: the merged form). */
  label: z.string().max(60),
  /** pen: a closed form (true) or an open line (false). */
  closed: z.boolean(),
  /** shape: its outline as points in a 100×100 box (y down); [] otherwise. */
  template: z.array(pointSchema).max(64),
  /** label: the names it offers; [] otherwise. */
  labels: z.array(z.string().min(1).max(60)).max(6),
  /** state: what it shows and the grips that change the state (each overlay's handle); [] otherwise. */
  handles: z.array(overlaySchema).max(4).default([]),
  /** behavior: the values what is drawn gives the code, and the frame-local code that reads them; [] and null otherwise. */
  values: z.array(behaviorValueSchema).max(4).default([]), patch: behaviorPatchSchema.nullable().default(null),
  /** behavior: where a typical drawing of it goes at this moment (canvas pixels), to check that drawing it changes the picture. */
  probe: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).default({ x: 0, y: 0, w: 0, h: 0 }),
  /**
   * shape, pen: the tag everything made with it starts with: the object of the brush it stands for ("" none), and the
   * quantities of it the concern leaves open, each with the readings to choose from; [] otherwise.
   */
  nodeId: z.string().max(80).default(""), specs: z.array(objectSpecSchema).max(MAX_SPECS).default([]),
});
export type AlignTool = z.infer<typeof alignToolSchema>;

/**
 * Tools every Execution frame has: looking and stepping (nothing is drawn), moving and sizing what is selected, a
 * lasso (selects what is drawn inside it, or lifts that part of the picture), a pencil (a line or a form of one's
 * own), tags (on what is drawn, or on an item of the picture, naming it or linking it to an object of the brush),
 * erasing a part of the picture, notes.
 */
export const BASE_TOOLS = ["run", "select", "lasso", "pencil", "tag", "erase", "note"] as const;
export type BaseTool = (typeof BASE_TOOLS)[number];
/** The tool in use: a base tool, or a tool of the kit (`tool:<id>`). */
export type IdealMode = BaseTool | `tool:${string}`;
/** Preset objects name their tool: a tool of the kit, or a base tool that makes objects (a lifted part is "crop"). */
export const OBJECT_BASE_TOOLS = ["crop", "erase", "pencil", "tag"] as const;

/**
 * One object of a preset as AI writes it: made with `tool` in the box `x`, `y`, `w`, `h` (canvas pixels; a shape's
 * template is fitted into it), or along `points` (a pen's form or line; the outline of a crop or an erased part,
 * else its box), then moved by `dx`, `dy`, scaled about its center and rotated (degrees, clockwise).
 */
export const alignObjectSchema = z.object({ id: z.string().min(1).max(40), tool: z.string().min(1).max(40), label: z.string().max(160),
  x: z.number(), y: z.number(), w: z.number(), h: z.number(), points: z.array(pointSchema).max(64),
  dx: z.number(), dy: z.number(), scale: z.number(), rotate: z.number(),
  /** Its tag: the object of the brush it is ("" none), and the rules for what the outcome decides of it. */
  nodeId: z.string().max(80).default(""), specs: z.array(objectSpecSchema).max(MAX_SPECS).default([]) });
export type AlignObject = z.infer<typeof alignObjectSchema>;
/** Forms drawn as one: their outlines joined, the borders between them gone. */
export const alignMergeSchema = z.object({ id: z.string().min(1).max(40), label: z.string().max(60), members: z.array(z.string().min(1).max(40)).min(2).max(16) });
export type AlignMerge = z.infer<typeof alignMergeSchema>;
/** Execution state a preset sets: a key a state tool's grip changes, to a number or a move (`"dx,dy"`). */
export const alignStateSchema = z.object({ key: z.string().min(1).max(1200), value: z.union([z.number(), z.string().max(40)]) });
export const alignPresetSchema = z.object({ id: alignId, title: z.string().min(1).max(80), detail: z.string().max(400),
  objects: z.array(alignObjectSchema).max(16), merges: z.array(alignMergeSchema).max(6), state: z.array(alignStateSchema).max(8).default([]) });
export type AlignPreset = z.infer<typeof alignPresetSchema>;
/**
 * A quantity of the execution at this moment that the user can say what they want in terms of (where the things involved
 * are, how big each is, how far apart, a count, a limit the code uses), as AI picks it for the concern. It is referred to
 * as `@<id>.<field>` (`@<id>`: its first field) in a rule or in words, read on the frame as that field's expression, and
 * shown on the picture by its inspect tool. Fields `x`, `y` are a point (a center), `w`, `h` a size, `r` a reach.
 */
export const runtimeVarSchema = z.object({ id: z.string().regex(/^[a-z][a-z0-9_]{0,23}$/), name: z.string().min(1).max(40), means: z.string().max(160), color: colorSchema,
  fields: z.array(z.object({ key: z.string().regex(/^[a-z][a-z0-9_]{0,11}$/), expr: z.string().min(1).max(300) })).min(1).max(6) });
export type RuntimeVar = z.infer<typeof runtimeVarSchema>;
export const MAX_VARS = 8;
/** What AI makes for the concern at one moment: how it reads what the user wants, the tools to draw it, and presets. */
/** The tools of a kit: AI's first ones, and those it made on request after. */
export const MAX_KIT_TOOLS = 12;
export const alignKitSchema = z.object({ reading: z.string().min(1).max(600), tools: z.array(alignToolSchema).min(1).max(MAX_KIT_TOOLS), presets: z.array(alignPresetSchema).max(4),
  variables: z.array(runtimeVarSchema).max(MAX_VARS).default([]) });
export type AlignKit = z.infer<typeof alignKitSchema>;

/**
 * A kit with tools AI made on request added: after the ones there are (an id already taken gets a number), the
 * newest kept when there are too many; its guesses come first.
 */
export function withTools(kit: AlignKit, added: AlignKit): AlignKit {
  const taken = new Set(kit.tools.map(tool => tool.id)), renamed = new Map<string, string>();
  const tools = added.tools.map(tool => { let id = tool.id; for (let n = 2; taken.has(id); n++) id = `${tool.id.slice(0, 36)}-${n}`; taken.add(id); renamed.set(tool.id, id); return { ...tool, id }; });
  const presets = added.presets.map(preset => ({ ...preset, objects: preset.objects.map(item => ({ ...item, tool: renamed.get(item.tool) ?? item.tool })) }));
  // Runtime state it refers to: a new one of an id already there replaces it.
  const variables = [...(kit.variables ?? []).filter(item => !(added.variables ?? []).some(other => other.id === item.id)), ...(added.variables ?? [])].slice(-MAX_VARS);
  return { reading: kit.reading, tools: [...kit.tools, ...tools].slice(-MAX_KIT_TOOLS), presets: [...presets, ...kit.presets].slice(0, 4), variables };
}

// ── Runtime state referred to ────────────────────────────────────────────────

/** A reference written in a rule or in words: `@id.field`, or `@id` for its first field. */
const REF = /@([a-z][a-z0-9_]*)(?:\.([a-z][a-z0-9_]*))?/g;
/** Every field one can refer to, as it is written (`@id.field`). */
export const refFields = (variables: RuntimeVar[]) => variables.flatMap(variable => variable.fields.map(field => ({ ref: `@${variable.id}.${field.key}`, variable, key: field.key, expr: field.expr })));
const fieldOf = (variables: RuntimeVar[], id: string, key: string | undefined) => { const variable = variables.find(item => item.id === id); return variable && (key ? variable.fields.find(field => field.key === key) : variable.fields[0]); };
/**
 * A rule with its references written out (each the expression of its field, in parentheses), so it reads on the frame as
 * any rule does; quoted parts (a store's name) stay as they are. A reference to nothing there is left (it does not read).
 */
export function expandRefs(expr: string, variables: RuntimeVar[] = []): string {
  if (!variables.length || !expr.includes("@")) return expr;
  return expr.split(/("[^"]*"|'[^']*')/).map((part, i) => i % 2 ? part : part.replace(REF, (whole, id: string, key?: string) => { const field = fieldOf(variables, id, key); return field ? `(${field.expr})` : whole; })).join("");
}
/** Whether an expression reads on its own (it parses; a value missing at a moment only reads as nothing then). */
const parses = (expr: string) => { try { evaluate(expr, {}); return true; } catch { return false; } };
/**
 * Variables as kept: each id once, its fields each once with an expression that reads by itself (not one of the object
 * a rule is on, `item(…)`, nor another reference), and those left with none gone.
 */
export const keptVariables = (variables: RuntimeVar[]): RuntimeVar[] => variables
  .map(variable => ({ ...variable, name: variable.name.trim(), means: variable.means.trim(), fields: variable.fields.map(field => ({ key: field.key, expr: field.expr.trim() }))
    .filter((field, i, all) => all.findIndex(other => other.key === field.key) === i && !/\bitem\s*\(/.test(field.expr) && parses(field.expr)) }))
  .filter((variable, i, all) => variable.name && variable.fields.length && all.findIndex(other => other.id === variable.id) === i).slice(0, MAX_VARS);
/** The variables a text refers to (a rule, words on a tag, a note), each once. */
export const refsIn = (texts: string[], variables: RuntimeVar[]) => variables.filter(variable => texts.some(text => [...text.matchAll(REF)].some(match => match[1] === variable.id && (!match[2] || variable.fields.some(field => field.key === match[2])))));
/** Each field of each variable as it reads at this moment (null: it does not read here). */
export type VarReading = { variable: RuntimeVar; fields: { key: string; ref: string; expr: string; value: number | null }[] };
export const readVariables = (variables: RuntimeVar[], read: (expr: string) => number | null): VarReading[] =>
  variables.map(variable => ({ variable, fields: variable.fields.map(field => ({ key: field.key, ref: `@${variable.id}.${field.key}`, expr: field.expr, value: read(field.expr) })) }));
/**
 * Where in the brush's code an expression reads, as the code names it: a value the module keeps as its path into
 * `m.store` (`items[3].w`), one kept per item with `m.runtime` (`@runtime.<name>.<id>.value`) as `runtime("<name>", "<id>")`,
 * a count as `.length`; the rest as written.
 */
export function codeState(expr: string): string {
  return expr.replace(/\b(s|len)\(\s*(["'])[^"']*\2\s*,\s*(["'])([^"']*)\3\s*\)/g, (_whole, fn: string, _q: string, _p: string, path: string) => {
    const parts = path.split(".").filter(Boolean);
    let text = "";
    if (parts[0] === "@runtime" && parts.length >= 3) { text = `runtime("${parts[1]}", "${parts[2]}")`; parts.splice(0, parts[3] === "value" ? 4 : 3); }
    for (const part of parts) text += /^\d+$/.test(part) ? `${text || "store"}[${part}]`.slice(text.length) : /^[A-Za-z_$][\w$]*$/.test(part) ? `${text ? "." : ""}${part}` : `[${JSON.stringify(part)}]`;
    return (text || "store") + (fn === "len" ? ".length" : "");
  });
}
/** Where a variable is in the brush's code: each field's place there, without the field's own key when it ends in it, each once. */
export const variableCode = (variable: RuntimeVar) =>
  [...new Set(variable.fields.map(field => { const code = codeState(field.expr); return code.endsWith(`.${field.key}`) ? code.slice(0, -field.key.length - 1) : code; }))].join(", ");
/** The runtime state a text refers to, for AI: what each is, what it means, its fields' expressions, where they are in the code (`code`) and values now. */
export type AlignRefs = { id: string; name: string; means: string; fields: { ref: string; expr: string; code: string; now: number | null }[] }[];
export const describeRefs = (readings: VarReading[], texts: string[]): AlignRefs => { const used = refsIn(texts, readings.map(item => item.variable));
  return readings.filter(item => used.includes(item.variable)).map(item => ({ id: item.variable.id, name: item.variable.name, means: item.variable.means,
    fields: item.fields.map(field => ({ ref: field.ref, expr: field.expr, code: codeState(field.expr), now: field.value === null ? null : round(field.value) })) })); };

// ── The state the user draws ─────────────────────────────────────────────────

/**
 * "shape": a closed form; "line": an open one; "crop": a part of the picture lifted; "erase": a part of the picture
 * taken away; "item": an item of the picture pointed at as it is (to tag it).
 */
export const IDEAL_KINDS = ["shape", "line", "crop", "erase", "item"] as const;
export type IdealKind = (typeof IDEAL_KINDS)[number];
export const MAX_IDEAL_OBJECTS = 24, MAX_IDEAL_MERGES = 8;
const boxSchema = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });
/**
 * An object of the drawn state: its outline where it was made (canvas pixels; `box` around it), then moved by
 * `dx`, `dy` (its center), scaled and rotated about its center (degrees, clockwise), as a crop of a picture is.
 */
export const idealObjectSchema = z.object({ id: z.string().min(1).max(40), kind: z.enum(IDEAL_KINDS), tool: z.string().max(40), label: z.string().max(160), color: colorSchema,
  outline: z.array(pointSchema).max(MAX_CROP_POINTS), box: boxSchema, dx: z.number(), dy: z.number(), scale: z.number().min(.05).max(20), rotate: z.number().min(-360).max(360),
  /**
   * Its ONE tag: the object of the brush (a node) it is ("" none) with the user's words in `label`, and the rules for
   * the quantities of it the user wants (`specs`, as many as wanted up to MAX_SPECS), shown with its tag and changed there.
   */
  nodeId: z.string().max(80).default(""), specs: z.array(objectSpecSchema).max(MAX_SPECS).default([]) });
export type IdealObject = z.infer<typeof idealObjectSchema>;
export const idealStateSchema = z.object({ objects: z.array(idealObjectSchema).max(MAX_IDEAL_OBJECTS), merges: z.array(alignMergeSchema).max(MAX_IDEAL_MERGES) });
export type IdealState = z.infer<typeof idealStateSchema>;
export const emptyIdeal = (): IdealState => ({ objects: [], merges: [] });
/** The paper the brush draws on (an erased part is painted with it). */
export const PAPER = "#fffefa";
const BASE_COLORS: Record<string, string> = { crop: "#0e7490", erase: "#8a8f80", pencil: "#3f3f46", tag: "#0f766e" };

const round = (value: number) => Math.round(value * 10) / 10;
export function boxOf(points: Point[]): Box {
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}
/** At most `max` points, evenly picked. */
export const thinPoints = (points: Point[], max = MAX_CROP_POINTS) => points.filter((_, i) => i % Math.max(1, Math.ceil(points.length / max)) === 0).slice(0, max).map(p => ({ x: round(p.x), y: round(p.y) }));
/** A template (points in a 100×100 box) fitted into a box. */
export function fitTemplate(template: Point[], box: Box) {
  if (template.length < 3) return [{ x: box.x, y: box.y }, { x: box.x + box.w, y: box.y }, { x: box.x + box.w, y: box.y + box.h }, { x: box.x, y: box.y + box.h }];
  const from = boxOf(template), sx = box.w / Math.max(1e-6, from.w), sy = box.h / Math.max(1e-6, from.h);
  return thinPoints(template.map(p => ({ x: box.x + (p.x - from.x) * sx, y: box.y + (p.y - from.y) * sy })));
}
const area = (outline: Point[]) => Math.abs(outline.reduce((sum, p, i) => { const q = outline[(i + 1) % outline.length]; return sum + p.x * q.y - q.x * p.y; }, 0)) / 2;
const length = (points: Point[]) => points.reduce((sum, p, i) => i ? sum + Math.hypot(p.x - points[i - 1].x, p.y - points[i - 1].y) : 0, 0);
const rectOutline = (box: Box) => [{ x: box.x, y: box.y }, { x: box.x + box.w, y: box.y }, { x: box.x + box.w, y: box.y + box.h }, { x: box.x, y: box.y + box.h }];

/** A fresh id for a new object or merge (`o1`, `o2`, … / `m1`, …). */
export function nextId(taken: Iterable<string>, prefix: string) {
  const used = new Set(taken);
  for (let n = 1; ; n++) if (!used.has(`${prefix}${n}`)) return `${prefix}${n}`;
}
const objectIds = (state: IdealState) => state.objects.map(item => item.id);

/** What an object made with a base tool or a kit tool is. */
export function toolKind(tool: string, tools: AlignTool[]): IdealKind | null {
  if (tool === "crop" || tool === "erase") return tool;
  if (tool === "pencil") return "line";
  if (tool === "tag") return "item";
  const found = tools.find(item => item.id === tool);
  // A behavior tool draws as a shape (with a template) or a pen does.
  const drawn = found?.kind === "behavior" ? (found.template.length >= 3 ? "shape" : "pen") : found?.kind;
  return !found ? null : drawn === "shape" || (drawn === "pen" && found.closed) ? "shape" : drawn === "pen" ? "line" : null;
}
const toolColor = (tool: string, tools: AlignTool[]) => tools.find(item => item.id === tool)?.color ?? BASE_COLORS[tool] ?? BASE_COLORS.erase;

/** A pencil stroke that comes back to where it started is a form of its own. */
const closesUp = (points: Point[]) => points.length > 3 && Math.hypot(points[0].x - points.at(-1)!.x, points[0].y - points.at(-1)!.y) <= Math.max(16, length(points) * .12) && area(points) >= 300;
/**
 * A new object drawn with `tool`: a shape tool fits its template into `box`; a pen, pencil, crop or erase takes
 * the points drawn (an open line keeps them as they are; a pencil stroke that closes up is a form); a tag points at
 * an item of the picture by its box. Null when what was drawn is too small to be one.
 */
export function drawnObject(state: IdealState, tool: string, tools: AlignTool[], drawn: { box?: Box; points?: Point[] }): IdealObject | null {
  const kit = tools.find(item => item.id === tool);
  if (state.objects.length >= MAX_IDEAL_OBJECTS) return null;
  const points = drawn.points && drawn.points.length > 1 ? thinPoints(drawn.points) : (kit?.kind === "shape" || kit?.kind === "behavior") && kit.template.length >= 3 && drawn.box ? fitTemplate(kit.template, drawn.box) : drawn.box ? rectOutline(drawn.box) : [];
  const kind = tool === "pencil" && closesUp(points) ? "shape" : toolKind(tool, tools);
  if (!kind || points.length < 2) return null;
  const box = boxOf(points);
  if (kind === "line" ? length(points) < 8 : kind === "item" ? box.w < 2 && box.h < 2 : points.length < 3 || box.w < 6 || box.h < 6 || area(points) < 60) return null;
  return { id: nextId(objectIds(state), "o"), kind, tool, label: "", color: toolColor(tool, tools), outline: points, box, dx: 0, dy: 0, scale: 1, rotate: 0, ...startingTag(kit) };
}
/**
 * The tag a thing made with a tool starts with: the tool's object of the brush and its open quantities. Where it is
 * placed is what was just drawn, so a placing rule starts open (its readings offered); the others start at the tool's guess.
 */
const startingTag = (tool: AlignTool | undefined) => ({ nodeId: tool?.nodeId ?? "",
  specs: keptSpecs(tool?.specs ?? []).map(spec => isPlacing(spec.aspect) ? { ...spec, expr: "" } : spec) });
/**
 * An item of the picture pointed at, lifted to be moved, sized or turned: the part of the picture in its box (a little
 * around it, so its outline comes along) as a lifted part, keeping its name and tag. Null where there is no room for one.
 */
export function liftedItem(state: IdealState, tools: AlignTool[], box: Box, pad = 3): IdealObject | null {
  const around = { x: box.x - pad, y: box.y - pad, w: Math.max(box.w, 18) + pad * 2, h: Math.max(box.h, 18) + pad * 2 };
  return drawnObject(state, "crop", tools, { box: { ...around, x: around.x - (around.w - box.w - pad * 2) / 2, y: around.y - (around.h - box.h - pad * 2) / 2 } });
}
/** What an object becomes when moved, sized or turned: an item of the picture pointed at is then lifted (the thing itself changes). */
export const liftedOnMove = (item: IdealObject): IdealObject => item.kind === "item" ? { ...item, kind: "crop", color: BASE_COLORS.crop } : item;
/** Tag what is selected: its words, and the object of the brush it is (`nodeId`, "" for words only). */
export function tagObjects(state: IdealState, ids: string[], label: string, nodeId = ""): IdealState {
  return linkObjects(labelObjects(state, ids, label), ids, nodeId);
}
/** The object of the brush what is selected is ("" none); its words stay. */
export const linkObjects = (state: IdealState, ids: string[], nodeId: string): IdealState =>
  ({ ...state, objects: state.objects.map(item => ids.includes(item.id) ? { ...item, nodeId } : item) });

// ── Rules on a tag ───────────────────────────────────────────────────────────

/** Reads a rule on the frame at this moment for an object (null: it cannot be read, or is not a number). */
export type SpecReader = (expr: string, item: IdealObject) => number | null;
/** The object's own box where it was made, as its rules read it (`item("w")`, …). */
export const specScope = (item: Pick<IdealObject, "box">) => ({ x: item.box.x, y: item.box.y, w: item.box.w, h: item.box.h, cx: item.box.x + item.box.w / 2, cy: item.box.y + item.box.h / 2 });
const isPlacing = (aspect: string): aspect is (typeof SPEC_PLACING)[number] => (SPEC_PLACING as readonly string[]).includes(aspect);
/** Where the object is now in the terms of its placing rules. */
export function placedValues(item: Pick<IdealObject, "box" | "dx" | "dy" | "scale" | "rotate">) {
  const at = placed(item);
  return { w: round(item.box.w * item.scale), h: round(item.box.h * item.scale), x: round(at.cx), y: round(at.cy), rotate: round(item.rotate) };
}
/**
 * The object placed by its rules: its size (`w`, else `h`; it keeps its proportions), its center (`x`, `y`) and its
 * turn (`rotate`); a rule that cannot be read leaves that as it is.
 */
export function placedBySpecs(item: IdealObject, read: SpecReader): IdealObject {
  const value = (aspect: string) => { const spec = item.specs.find(entry => entry.aspect === aspect && entry.expr.trim()); const read_ = spec ? read(spec.expr, item) : null; return read_ !== null && Number.isFinite(read_) ? read_ : null; };
  const c = centerOf(item.box), w = value("w"), h = value("h"), x = value("x"), y = value("y"), turn = value("rotate");
  const scale = w !== null && w > 0 && item.box.w > 0 ? w / item.box.w : h !== null && h > 0 && item.box.h > 0 ? h / item.box.h : null;
  return { ...item, ...(scale !== null ? { scale: Math.round(Math.max(.05, Math.min(20, scale)) * 1000) / 1000 } : {}), ...(x !== null ? { dx: round(x - c.x) } : {}),
    ...(y !== null ? { dy: round(y - c.y) } : {}), ...(turn !== null ? { rotate: round((((turn % 360) + 540) % 360) - 180) } : {}) };
}
/** Rules as kept: each aspect once, written out; an open one only with readings to choose from; readings each once. */
export const keptSpecs = (specs: ObjectSpec[]): ObjectSpec[] => specs.map(spec => ({ aspect: spec.aspect.trim(), expr: spec.expr.trim(),
  options: (spec.options ?? []).map(option => ({ expr: option.expr.trim(), note: option.note.trim() })).filter((option, i, all) => option.expr && all.findIndex(other => other.expr === option.expr) === i) }))
  .filter((spec, i, all) => spec.aspect && (spec.expr || spec.options.length) && all.findIndex(other => other.aspect === spec.aspect) === i).slice(0, MAX_SPECS);
/** The rules decided (an open one is not yet a rule). */
export const decidedSpecs = (specs: ObjectSpec[]) => specs.filter(spec => spec.aspect.trim() && spec.expr.trim());
/** The color a `color` rule paints the object with (`#rrggbb`, quotes allowed), or null. */
export function specColor(item: Pick<IdealObject, "specs">): string | null {
  const expr = item.specs.find(spec => spec.aspect.trim() === "color")?.expr.trim().replace(/^["']|["']$/g, "") ?? "";
  return /^#[0-9a-fA-F]{6}$/.test(expr) ? expr : null;
}
/**
 * Rules one can put on a tag, for choosing instead of writing: every reading the kit offers (on its tools' tags and its
 * guesses' objects), by aspect, each once; the runtime state it refers to; then the object's own box as it was made.
 */
export function specExamples(kit: (Pick<AlignKit, "tools" | "presets"> & { variables?: RuntimeVar[] }) | null): { aspect: string; expr: string; note: string }[] {
  const specs = [...(kit?.tools ?? []).flatMap(tool => tool.specs ?? []), ...(kit?.presets ?? []).flatMap(preset => preset.objects.flatMap(item => item.specs ?? []))];
  // The runtime state the kit refers to, where a field is a place or a size (a point's x as x, a size's w as w, h).
  const state = refFields(kit?.variables ?? []).filter(field => isPlacing(field.key)).map(field => ({ aspect: field.key, expr: field.ref, note: `${field.variable.name} (${codeState(field.expr)})` }));
  const all = [...specs.flatMap(spec => [...(spec.options ?? []).map(option => ({ aspect: spec.aspect.trim(), ...option })), ...(spec.expr.trim() && !(spec.options ?? []).some(option => option.expr === spec.expr) ? [{ aspect: spec.aspect.trim(), expr: spec.expr, note: "" }] : [])]), ...state,
    { aspect: "w", expr: 'item("w")', note: "as drawn" }, { aspect: "x", expr: 'item("cx")', note: "where it was made" }, { aspect: "y", expr: 'item("cy")', note: "where it was made" }, { aspect: "rotate", expr: "0", note: "upright" }];
  return all.map(item => ({ aspect: item.aspect, expr: item.expr.trim(), note: item.note.trim() })).filter((item, i, list) => item.aspect && item.expr && list.findIndex(other => other.aspect === item.aspect && other.expr === item.expr) === i);
}
/** Every object placed by its rules. */
export const withSpecs = (state: IdealState, read: SpecReader): IdealState => ({ ...state, objects: state.objects.map(item => item.specs.length ? placedBySpecs(item, read) : item) });
/** After the object was moved, sized or turned by hand, the placing rules it changed say what it is now (a number): drawing and rules agree. */
export function respecified(before: IdealObject, after: IdealObject): IdealObject {
  if (!after.specs.length) return after;
  const was = placedValues(before), now = placedValues(after);
  return { ...after, specs: after.specs.map(spec => isPlacing(spec.aspect) && spec.expr.trim() && Math.abs(now[spec.aspect] - was[spec.aspect]) >= .5 ? { ...spec, expr: String(now[spec.aspect]) } : spec) };
}
/** A rule written or changed on the tag (an empty one goes); the object is placed by its rules again. */
export function setSpec(state: IdealState, id: string, index: number, spec: ObjectSpec | null, read: SpecReader): IdealState {
  return { ...state, objects: state.objects.map(item => {
    if (item.id !== id) return item;
    const specs = index >= item.specs.length ? (spec ? [...item.specs, spec].slice(0, MAX_SPECS) : item.specs) : item.specs.flatMap((entry, i) => i !== index ? [entry] : spec ? [spec] : []);
    return placedBySpecs({ ...item, specs }, read);
  }) };
}

// ── A widget on a tag: made by AI for what the rules on it mean ──────────────

/**
 * A value a tag widget lets one change: its name, its kind, where it is and its range (a number), or its options (a
 * select: parts of a rule to choose among, written as they go into it).
 */
export const widgetParamSchema = z.object({ id: z.string().regex(/^[a-z][a-z0-9_]{0,23}$/), label: z.string().min(1).max(40), type: z.enum(["number", "color", "select", "toggle"]),
  value: z.union([z.number(), z.string().max(300), z.boolean()]), min: z.number(), max: z.number(), step: z.number(), options: z.array(z.string().max(300)).max(12) });
export type WidgetParam = z.infer<typeof widgetParamSchema>;
/**
 * What AI makes when a tag's widget is created: how it reads what the rules on the tag mean and what one would want to
 * try of it (`reading`), what to grab (`hint`), the values the widget changes (`params`), the rules it writes with them
 * (`rules`, each a template where `${id}` is a value), and its code (drawn on the picture, it is manipulated directly).
 */
export const tagWidgetSchema = z.object({ reading: z.string().min(1).max(400), hint: z.string().max(80), params: z.array(widgetParamSchema).min(1).max(6),
  rules: z.array(z.object({ aspect: z.string().min(1).max(30), expr: z.string().min(1).max(300) })).min(1).max(MAX_SPECS), code: z.string().min(1).max(16000) });
export type TagWidgetSpec = z.infer<typeof tagWidgetSchema>;
/** A widget made for a drawn object (`id`): what AI made, its code ready to run (`prepared`), and its values now. */
export type TagWidget = TagWidgetSpec & { id: string; prepared: string; values: Record<string, number | string | boolean> };
const WIDGET_VALUE = /\$\{([a-z][a-z0-9_]*)\}/g;
const numberText = (value: number) => String(Math.round(value * 1000) / 1000);
/** A value kept to its param's kind: a number in its range on its step, a `#rrggbb` color, one of the options (or the option at an index), a toggle; undefined when it is none. */
export function widgetValue(param: WidgetParam, value: unknown): number | string | boolean | undefined {
  if (param.type === "number") { const n = Number(value); if (!Number.isFinite(n) || typeof value === "boolean") return undefined;
    const stepped = param.step > 0 ? param.min + Math.round((n - param.min) / param.step) * param.step : n; return Number(Math.max(param.min, Math.min(param.max, stepped)).toFixed(6)); }
  if (param.type === "color") return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value : undefined;
  if (param.type === "select") return typeof value === "number" ? param.options[Math.max(0, Math.min(param.options.length - 1, Math.round(value)))] : typeof value === "string" && param.options.includes(value) ? value : undefined;
  return typeof value === "boolean" ? value : undefined;
}
/** A value as it goes into a rule: a number as written, a color quoted, an option as it is (a part of a rule), a toggle 1 or 0. */
const valueText = (param: WidgetParam, value: number | string | boolean) => param.type === "number" ? numberText(Number(value)) : param.type === "color" ? JSON.stringify(String(value)) : param.type === "toggle" ? (value ? "1" : "0") : String(value);
/** The rules a widget writes with its values: each template with its values filled in. */
export const widgetRules = (widget: Pick<TagWidgetSpec, "params" | "rules">, values: Record<string, number | string | boolean>) =>
  widget.rules.map(rule => ({ aspect: rule.aspect, expr: rule.expr.replace(WIDGET_VALUE, (whole, id: string) => { const param = widget.params.find(item => item.id === id), value = param && (values[id] ?? param.value);
    return param && value !== undefined ? valueText(param, value) : whole; }) }));
/**
 * What AI made, kept so it can run: each value once, of its kind and in its range (a number's range the right way round
 * with a step, a select with options); its rules each an aspect once, using only its values. Throws when nothing is left.
 */
export function keptWidget(spec: TagWidgetSpec): TagWidgetSpec {
  const params = spec.params.filter((param, i, all) => all.findIndex(other => other.id === param.id) === i).flatMap(param => {
    const [min, max] = param.min <= param.max ? [param.min, param.max] : [param.max, param.min], step = param.step > 0 ? param.step : (max - min) / 100 || .01;
    const kept = { ...param, label: param.label.trim(), min, max, step, options: param.type === "select" ? [...new Set(param.options.map(option => option.trim()).filter(Boolean))] : [] };
    if (kept.type === "select" && !kept.options.length) return [];
    const value = widgetValue(kept, param.value) ?? (kept.type === "number" ? min : kept.type === "color" ? "#000000" : kept.type === "select" ? kept.options[0] : false);
    return [{ ...kept, value }]; });
  const ids = new Set(params.map(param => param.id));
  const rules = spec.rules.map(rule => ({ aspect: rule.aspect.trim(), expr: rule.expr.trim() }))
    .filter((rule, i, all) => rule.aspect && rule.expr && all.findIndex(other => other.aspect === rule.aspect) === i && [...rule.expr.matchAll(WIDGET_VALUE)].every(match => ids.has(match[1])));
  if (!params.length || !rules.length) throw new Error("The widget AI made changes nothing on the tag. Please try again.");
  return { reading: spec.reading.trim(), hint: spec.hint.trim(), params, rules, code: spec.code };
}
/** The widget's first values: each value as AI gave it. */
export const widgetStart = (spec: Pick<TagWidgetSpec, "params">) => Object.fromEntries(spec.params.map(param => [param.id, param.value]));
/** The object's rules as the widget writes them with `values` (a rule of an aspect it does not write stays; one it writes keeps its readings), the object placed by them. */
export function applyWidget(state: IdealState, id: string, widget: Pick<TagWidgetSpec, "params" | "rules">, values: Record<string, number | string | boolean>, read: SpecReader): IdealState {
  return widgetRules(widget, values).reduce((next, rule) => { const item = next.objects.find(entry => entry.id === id); if (!item) return next;
    const index = item.specs.findIndex(spec => spec.aspect.trim() === rule.aspect), was = item.specs[index];
    if (index < 0 && item.specs.length >= MAX_SPECS) return next;
    return setSpec(next, id, index < 0 ? item.specs.length : index, { aspect: rule.aspect, expr: rule.expr, options: was?.options ?? [] }, read); }, state);
}

/** A preset's objects and merges as a drawn state (objects it cannot make are left out, merges keep the forms that are there). */
export function presetState(preset: AlignPreset, tools: AlignTool[]): IdealState {
  const objects: IdealObject[] = [];
  const ids = new Map<string, string>();
  for (const item of preset.objects) {
    const kind = toolKind(item.tool, tools); if (!kind) continue;
    const box = { x: item.x, y: item.y, w: Math.abs(item.w), h: Math.abs(item.h) };
    const made = drawnObject({ objects, merges: [] }, item.tool, tools, item.points.length > 1 && item.tool !== "tag" ? { points: item.points } : { box });
    if (!made) continue;
    ids.set(item.id, made.id);
    objects.push({ ...made, nodeId: item.nodeId, specs: keptSpecs(item.specs), dx: round(item.dx), dy: round(item.dy),
      scale: Math.max(.05, Math.min(20, Number.isFinite(item.scale) && item.scale > 0 ? item.scale : 1)), rotate: round((((item.rotate % 360) + 540) % 360) - 180) });
  }
  let state: IdealState = { objects, merges: [] };
  for (const merge of preset.merges) {
    const members = merge.members.map(id => ids.get(id)).filter((id): id is string => Boolean(id));
    state = mergeObjects(state, members, "");
  }
  return state;
}

/** The forms of a merge, or of `ids`, that can be joined: shapes only. */
const mergeable = (state: IdealState, ids: string[]) => ids.filter(id => state.objects.some(item => item.id === id && item.kind === "shape"));
/**
 * Join forms into one outline (named `label`): a form already in another merge leaves it (a merge left with one
 * form is gone). Fewer than two forms: nothing changes.
 */
export function mergeObjects(state: IdealState, ids: string[], label: string): IdealState {
  const members = [...new Set(mergeable(state, ids))];
  if (members.length < 2 || state.merges.length >= MAX_IDEAL_MERGES) return state;
  const kept = state.merges.map(merge => ({ ...merge, members: merge.members.filter(id => !members.includes(id)) })).filter(merge => merge.members.length > 1);
  return { ...state, merges: [...kept, { id: nextId(state.merges.map(item => item.id), "m"), label: label.trim(), members }] };
}
/** Take forms out of their merges. */
export function splitObjects(state: IdealState, ids: string[]): IdealState {
  return { ...state, merges: state.merges.map(merge => ({ ...merge, members: merge.members.filter(id => !ids.includes(id)) })).filter(merge => merge.members.length > 1) };
}
/** The merge an object is in. */
export const mergeOf = (state: IdealState, id: string) => state.merges.find(merge => merge.members.includes(id));
/** Name what is selected: a whole merge names the merged form, otherwise each object. */
export function labelObjects(state: IdealState, ids: string[], label: string): IdealState {
  const text = label.trim().slice(0, 60), whole = state.merges.find(merge => merge.members.length === ids.length && merge.members.every(id => ids.includes(id)));
  if (whole) return { ...state, merges: state.merges.map(merge => merge === whole ? { ...merge, label: text } : merge) };
  return { ...state, objects: state.objects.map(item => ids.includes(item.id) ? { ...item, label: text } : item) };
}
export function removeObjects(state: IdealState, ids: string[]): IdealState {
  return splitObjects({ ...state, objects: state.objects.filter(item => !ids.includes(item.id)) }, ids);
}
/** Selecting one form of a merge selects the whole merged form. */
export const withMerged = (state: IdealState, ids: string[]) => [...new Set(ids.flatMap(id => mergeOf(state, id)?.members ?? [id]))];

/** Where an object's outline is now (moved, scaled, rotated about its center). */
export function placedOutline(item: Pick<IdealObject, "outline" | "box" | "dx" | "dy" | "scale" | "rotate">) {
  const c = centerOf(item.box), angle = item.rotate * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
  return item.outline.map(p => { const x = (p.x - c.x) * item.scale, y = (p.y - c.y) * item.scale; return { x: c.x + item.dx + x * cos - y * sin, y: c.y + item.dy + x * sin + y * cos }; });
}

const moved = (item: Pick<IdealObject, "dx" | "dy" | "scale" | "rotate">) => Math.abs(item.dx) >= .5 || Math.abs(item.dy) >= .5 || Math.abs(item.scale - 1) >= .01 || Math.abs(item.rotate) >= .5;
/** Whether anything was drawn (or written). */
export const idealEdited = (state: IdealState, marks: unknown[], note: string) => state.objects.length > 0 || marks.length > 0 || note.trim().length > 0;

const boxText = (box: Box) => ({ x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.w), h: Math.round(box.h) });
/**
 * The drawn state in words and numbers for AI: each object as what it is (the tool it was made with, its name),
 * where it was made and where it is now (canvas pixels), and which forms are merged into one.
 */
export function describeIdeal(state: IdealState, tools: AlignTool[]) {
  return {
    objects: state.objects.map(item => {
      const now = boxOf(placedOutline(item)), tool = tools.find(entry => entry.id === item.tool);
      // A rule decided, with what the reading chosen means; an open one says nothing (the brush decides as it does).
      const specs = decidedSpecs(item.specs).map(spec => { const means = spec.options?.find(option => option.expr.trim() === spec.expr.trim())?.note;
        return { aspect: spec.aspect.trim(), expr: spec.expr.trim(), ...(means ? { means } : {}) }; });
      return { id: item.id, kind: item.kind, tool: tool?.name ?? item.tool, label: item.label, ...(item.nodeId ? { brushObject: item.nodeId } : {}), ...(specs.length ? { specs } : {}),
        ...(item.kind === "crop" || item.kind === "erase" ? { from: boxText(item.box) } : {}), box: boxText(now),
        ...(moved(item) ? { moved: { dx: Math.round(item.dx), dy: Math.round(item.dy), scale: Math.round(item.scale * 100) / 100, rotate: Math.round(item.rotate) } } : {}),
        ...(item.kind === "line" ? { points: thinPoints(placedOutline(item), 16).map(p => ({ x: Math.round(p.x), y: Math.round(p.y) })) } : {}),
        ...(mergeOf(state, item.id) ? { mergedInto: mergeOf(state, item.id)!.id } : {}) };
    }),
    merges: state.merges.map(merge => ({ id: merge.id, label: merge.label, members: merge.members })),
  };
}

// ── Procedural behavior drawn ────────────────────────────────────────────────

/** A drawn object's outline around its center (canvas pixels), as a behavior tool's "outline" value gives it. */
export const outlineValue = (item: IdealObject) => { const points = placedOutline(item), c = centerOf(boxOf(points));
  return JSON.stringify(thinPoints(points, 32).map(p => [Math.round(p.x - c.x), Math.round(p.y - c.y)])); };
/** The values one object drawn with a behavior tool gives the code (a number that does not read here is left out). */
export function behaviorValuesOf(tool: AlignTool, item: IdealObject, read: SpecReader): Record<string, number | string> {
  // Read where it is now (moved, sized, turned), not where it was made.
  const now = { ...item, box: boxOf(placedOutline(item)) };
  return Object.fromEntries(tool.values.flatMap((value): [string, number | string][] => { if (value.kind === "outline") return [[behaviorKey(tool.id, value.id), outlineValue(item)]];
    const number = value.expr.trim() ? read(value.expr, now) : null; return number === null ? [] : [[behaviorKey(tool.id, value.id), round(number)]]; }));
}
/** The values the behavior tools give the code: each from the last thing drawn with it (none drawn: the code reads its fallback). */
export function behaviorValues(state: IdealState, tools: AlignTool[], read: SpecReader): Record<string, number | string> {
  return Object.assign({}, ...tools.filter(tool => tool.kind === "behavior").map(tool => { const last = state.objects.filter(item => item.tool === tool.id).at(-1);
    return last ? behaviorValuesOf(tool, last, read) : {}; }));
}
/** What the code reads of a behavior tool while nothing is drawn with it: each value's fallback (the brush as it is). */
export const behaviorFallbacks = (tools: AlignTool[]) => Object.fromEntries(tools.filter(tool => tool.kind === "behavior")
  .flatMap(tool => tool.values.map(value => [behaviorKey(tool.id, value.id), value.kind === "outline" && typeof value.fallback !== "string" ? "[]" : value.fallback])));
/** The object a behavior tool's check draws: a typical drawing of it at this moment (its probe), null when it has none. */
export const behaviorProbe = (tool: AlignTool, tools: AlignTool[]) => tool.probe.w > 0 || tool.probe.h > 0
  ? drawnObject(emptyIdeal(), tool.id, tools, tool.template.length >= 3 || tool.closed ? { box: tool.probe } : { points: [{ x: tool.probe.x, y: tool.probe.y }, { x: tool.probe.x + tool.probe.w, y: tool.probe.y + tool.probe.h }] }) : null;
/** Whether the code reads every value of a behavior tool (by its key, through m.opt or m.v) in what its patch writes. */
export function readsBehavior(tool: Pick<AlignTool, "id" | "values" | "patch">) {
  const written = (tool.patch?.edits ?? []).map(edit => edit.replace).join("\n");
  return tool.values.length > 0 && tool.values.every(value => { const key = behaviorKey(tool.id, value.id).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`m\\.(?:opt\\([^,]*,|v\\()\\s*(["'])${key}\\1`).test(written); });
}

// ── Execution state set by hand ──────────────────────────────────────────────

/**
 * What a state tool's overlays read as the things the user pressed on the picture while it is chosen (items of the
 * picture, or objects drawn, in the order pressed), each as its box and center: `s("@picked", "0.cx")`, `len("@picked", "")`.
 */
export const PICKED_ROOT = "@picked";
export const MAX_PICKED = 4;
/** Whether a state tool shows something about things the user presses (its overlays read them). */
export const readsPicked = (tool: AlignTool) => JSON.stringify(tool.handles).includes(PICKED_ROOT);
export const pickedRecord = (box: Box) => ({ x: round(box.x), y: round(box.y), w: round(box.w), h: round(box.h), cx: round(box.x + box.w / 2), cy: round(box.y + box.h / 2) });

type Scalar = number | string | boolean;
/** The keys a state tool's grip changes: its `${…}` parts stand for any item (an id without dots). */
const patternOf = (key: string) => new RegExp(`^${key.split(/\$\{[^}]*\}/).map(part => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[^.]+")}$`);
/** The state tool, and its grip, that changes a key. */
export function stateToolOf(key: string, tools: AlignTool[]) {
  for (const tool of tools) if (tool.kind === "state") for (const overlay of tool.handles) if (overlay.handle && patternOf(overlay.handle.key).test(key)) return { tool, overlay };
  return null;
}
/** The execution state values a preset sets (keys its state tools change, a number or a move), as a frame's values. */
export function presetValues(preset: AlignPreset, tools: AlignTool[]): Record<string, number | string> {
  return Object.fromEntries(preset.state.filter(item => isRuntimeKey(item.key) && stateToolOf(item.key, tools)
    && (typeof item.value === "number" ? Number.isFinite(item.value) : /^-?[\d.]+,-?[\d.]+$/.test(item.value))).map(item => [item.key, item.value]));
}
/** A frame's values without the execution state set by hand (the rest stay). */
export const withoutState = (values: Record<string, Scalar>) => Object.fromEntries(Object.entries(values).filter(([key]) => !isRuntimeKey(key)));
/**
 * The execution state set by hand (runtime keys among a frame's values), each with the tool and grip that sets it,
 * what it was at the moment (`runtime`: its stores and input) and what it is now: a number, or a point moved.
 */
export type StateChange = { key: string; tool: string; name: string } & ({ kind: "number"; was: number | null; now: number }
  | { kind: "move"; was: Point | null; now: Point | null; moved: { dx: number; dy: number } });
export function stateChanges(values: Record<string, Scalar>, runtime: unknown, tools: AlignTool[]): StateChange[] {
  const own = runtime && typeof runtime === "object" ? runtime as { stores?: Record<string, unknown>; history?: unknown } : {}, stores = own.stores ?? {};
  return Object.entries(values).filter(([key]) => isRuntimeKey(key)).map(([key, value]): StateChange => {
    const found = stateToolOf(key, tools), named = { key, tool: found?.tool.name ?? "", name: found?.overlay.name || found?.tool.name || key };
    if (typeof value === "number") { const was = targetNumber(key, stores); return { ...named, kind: "number", was: Number.isFinite(was) ? round(was) : null, now: round(value) }; }
    const move = parseMove(value), at = targetPoint(key, stores, own.history);
    return { ...named, kind: "move", was: at && { x: round(at.x), y: round(at.y) }, now: at && { x: round(at.x + move.x), y: round(at.y + move.y) }, moved: { dx: round(move.x), dy: round(move.y) } };
  });
}

/** The change of the brush AI reads from the drawn state, and one sentence on what it made of it. */
export const alignFixSchema = fixSchema.extend({ reply: z.string().max(400) });
export type AlignFix = z.infer<typeof alignFixSchema>;
