import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "./icons";
import { behaviorKey, boxOf, codeState, decidedSpecs, drawnObject, toolGroup, labelObjects, liftedItem, liftedOnMove, linkObjects, MAX_SPECS, mergeObjects, mergeOf, PAPER, placedOutline, placedValues, presetState, presetValues, removeObjects, respecified, setSpec, tagObjects, specColor, specExamples, splitObjects, withMerged, withSpecs, type AlignKit, type AlignTool, type IdealMode, type IdealObject, type IdealState, type SpecReader, type StateChange, type VarReading, variableCode } from "../lib/alignment";
export type { IdealMode };
import { layoutBlocks, textWidth, type PlacedBlock } from "../lib/inspection";
import { boxPoint, centerOf, dragManipulation, nearPath, onCrop, outlinePath, placed, rotateGrip, type Box } from "../lib/preview-objects";

type Point = { x: number; y: number };
export const kitMode = (id: string): IdealMode => `tool:${id}`;
export const kitTool = (mode: IdealMode, tools: AlignTool[]) => mode.startsWith("tool:") ? tools.find(item => item.id === mode.slice(5)) : undefined;
/** The tool an object is drawn with in a mode (shape and pen tools of the kit, the pencil, erase), or null. */
const drawingTool = (mode: IdealMode, tools: AlignTool[]) => mode === "pencil" || mode === "erase" ? mode : (() => { const tool = kitTool(mode, tools); return tool && (tool.kind === "shape" || tool.kind === "pen" || tool.kind === "behavior") ? tool.id : null; })();
/** Whether a point is inside a loop drawn around it. */
const inLoop = (loop: Point[], at: Point) => { let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) { const a = loop[i], b = loop[j]; if ((a.y > at.y) !== (b.y > at.y) && at.x < (b.x - a.x) * (at.y - a.y) / (b.y - a.y) + a.x) inside = !inside; }
  return inside; };

type Drag = { pointerId: number; part: "move" | "scale" | "rotate" | "draw" | "box" | "note"; from: Point; start: IdealObject[] };
type SheetProps = {
  state: IdealState; onState: (state: IdealState) => void; tools: AlignTool[]; mode: IdealMode;
  /** Notes drawn on the picture (normalized), and the picture parts are lifted from. */
  marks: Point[][]; onMarks: (marks: Point[][]) => void; shot: string;
  selected: string[]; onSelect: (ids: string[]) => void; editable: boolean; className?: string;
  /** Changing the tool (a lasso hands what it took to Move · Size). */
  onMode?: (mode: IdealMode) => void;
  /** The item of the picture drawn at a point (its box), for tagging it; null where there is none. */
  itemAt?: (at: Point) => Box | null;
  /** The objects of the brush a tag links to (by id), and its rules read at this moment. */
  objectNames?: Record<string, string>; read?: SpecReader;
  /** A tag pressed on the picture (the object's id, or the merge's), to edit it there; the one edited (its words are a control over it). */
  onTagPress?: (id: string) => void; tagEditing?: string | null;
  /** Where the tags are written (laid out with the frame's other texts, so none covers another); else laid out here. */
  placedTags?: PlacedBlock[];
};
/** What a rule says on a tag: the rule, and what it reads now where it is not a number already. */
export function specText(spec: { aspect: string; expr: string; options?: { note: string }[] }, value: number | null) {
  const expr = spec.expr.trim(), short = expr.length > 42 ? `${expr.slice(0, 41)}…` : expr;
  // Left open: the readings to choose from.
  if (!expr) return `${spec.aspect} = ? ${(spec.options ?? []).map(option => option.note).filter(Boolean).join(" / ")}`.trim();
  return `${spec.aspect} = ${short}${value !== null && String(Math.round(value * 10) / 10) !== expr ? ` → ${Math.round(value * 10) / 10}` : ""}`;
}
const placedBox = (item: IdealObject) => boxOf(placedOutline(item));
/** A tag written on the picture: a line per tag (its object of the brush and its words), then a line per rule. */
export type TagBlock = { key: string; lines: { text: string; rule: boolean }[]; box: Box; color: string };
const TAG_SIZE = 17, RULE_SIZE = 13, TAG_LINE = 17;
/** Its size on the picture (canvas pixels). */
export const blockSize = (block: Pick<TagBlock, "lines">) => ({ width: Math.max(...block.lines.map(line => textWidth(line.text, line.rule ? RULE_SIZE : TAG_SIZE))) + 8, height: block.lines.length * TAG_LINE + 6 });
/** The tags written on the picture (all but `skip`, the one edited there): each object's, and each merged form's words. */
export function tagBlocks(state: IdealState, objectNames: Record<string, string>, read: SpecReader, skip: string | null = null): TagBlock[] {
  const merges = state.merges.filter(merge => merge.label && merge.id !== skip && state.objects.filter(item => merge.members.includes(item.id)).length > 1);
  return [...state.objects.filter(item => item.id !== skip && !merges.some(merge => merge.members.includes(item.id))).map(item => ({ key: item.id, box: placedBox(item), color: item.color,
      lines: [...[[objectNames[item.nodeId], item.label].filter(Boolean).join(" · ")].filter(Boolean).map(text => ({ text, rule: false })),
        ...item.specs.filter(spec => spec.aspect.trim()).map(spec => ({ text: specText(spec, spec.expr.trim() ? read(spec.expr, item) : null), rule: true }))] })),
    ...merges.map(merge => { const items = state.objects.filter(item => merge.members.includes(item.id)); return { key: merge.id, box: union(items.map(placedBox)), color: items[0].color, lines: [{ text: merge.label, rule: false }] }; })]
    .filter(block => block.lines.length);
}
const union = (boxes: Box[]) => { const x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(b => b.y)); return { x, y, w: Math.max(...boxes.map(b => b.x + b.w)) - x, h: Math.max(...boxes.map(b => b.y + b.h)) - y }; };

/**
 * One form, or forms merged into one: every outline stroked, then every inside painted over, so only the outer outline
 * stays; filled with the color a rule on its tag gives (of the first form that has one), else lightly with its tool's.
 */
function Forms({ items, selected }: { items: IdealObject[]; selected: boolean }) {
  const paths = items.map(item => outlinePath(placedOutline(item))), color = items[0].color, paint = items.map(specColor).find(Boolean);
  return <g className={`ideal-forms ${selected ? "on" : ""}`}>
    {paths.map((d, i) => <path key={`s${i}`} d={d} fill="none" stroke={color} strokeWidth={items.length > 1 ? 7 : 3.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />)}
    {items.length > 1 && paths.map((d, i) => <path key={`p${i}`} d={d} fill={PAPER} stroke="none" />)}
    {paths.map((d, i) => <path key={`f${i}`} d={d} fill={paint ?? color} fillOpacity={paint ? .8 : .14} stroke="none" />)}
  </g>;
}

/**
 * The sheet over an Execution frame's picture (900×600 canvas pixels) where the state the user wants is drawn:
 * forms placed or drawn with the kit's tools, parts of the picture lifted and moved (crop) or taken away (erase),
 * merged forms drawn as one outline, names on what was made, and notes. In "run" (looking, stepping), and with a
 * state tool, it only shows (pressing a part to jump there, or the state tool's grips, take the pointer).
 */
export function IdealSheet({ state, onState, tools, mode, marks, onMarks, shot, selected, onSelect, editable, className = "ideal-sheet", onMode, itemAt, objectNames = {}, read = () => null, onTagPress, tagEditing = null, placedTags }: SheetProps) {
  const [stroke, setStroke] = useState<Point[] | null>(null), [box, setBox] = useState<Box | null>(null);
  const sheet = useRef<SVGSVGElement>(null), drag = useRef<Drag | null>(null), clip = useId().replace(/:/g, "");
  const live = editable && mode !== "run" && kitTool(mode, tools)?.kind !== "state";
  const point = (e: React.PointerEvent) => { const at = sheet.current!.getBoundingClientRect(); return { x: Math.max(0, Math.min(900, (e.clientX - at.left) / Math.max(1, at.width) * 900)), y: Math.max(0, Math.min(600, (e.clientY - at.top) / Math.max(1, at.height) * 600)) }; };
  const single = selected.length === 1 ? state.objects.find(item => item.id === selected[0]) : undefined;
  /** What is under the pointer: the selected object's grips first, then the topmost object. */
  const hit = (at: Point): { id: string; part: "move" | "scale" | "rotate" } | null => {
    if (single) {
      const corner = boxPoint(single, 1, 1), turn = rotateGrip(single);
      if (Math.hypot(at.x - turn.x, at.y - turn.y) < 14) return { id: single.id, part: "rotate" };
      if (Math.hypot(at.x - corner.x, at.y - corner.y) < 14) return { id: single.id, part: "scale" };
    }
    const found = objectAt(state, at);
    return found ? { id: found.id, part: "move" } : null;
  };
  const down = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 || !live) return;
    e.preventDefault(); e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId);
    const at = point(e), start = (ids: string[]) => state.objects.filter(item => ids.includes(item.id));
    if (mode === "note") { drag.current = { pointerId: e.pointerId, part: "note", from: at, start: [] }; setStroke([{ x: at.x / 900, y: at.y / 600 }]); return; }
    // A tag goes on what is pressed: something drawn, else the item of the picture there (pointed at as it is).
    if (mode === "tag") {
      const found = hit(at);
      if (found) { onSelect(withMerged(state, [found.id])); return; }
      add(pointedAt(at));
      return;
    }
    if (mode === "lasso") { drag.current = { pointerId: e.pointerId, part: "draw", from: at, start: [] }; setStroke([at]); return; }
    if (mode === "select") {
      const found = hit(at);
      // An item of the picture pressed (nothing drawn there): it is lifted, so moving, sizing or turning changes the thing itself.
      if (!found) {
        const box = itemAt?.(at), lifted = box ? liftedItem(state, tools, box) : null;
        if (!lifted) { onSelect([]); return; }
        onState({ ...state, objects: [...state.objects, lifted] }); onSelect([lifted.id]);
        drag.current = { pointerId: e.pointerId, part: "move", from: at, start: [lifted] };
        return;
      }
      const group = withMerged(state, [found.id]), on = group.every(id => selected.includes(id));
      const ids = e.shiftKey ? (on ? selected.filter(id => !group.includes(id)) : [...selected, ...group]) : on ? selected : group;
      onSelect(ids);
      // An item of the picture tagged where it is is lifted once it is moved, sized or turned.
      if (ids.includes(found.id)) drag.current = { pointerId: e.pointerId, part: found.part, from: at, start: start(found.part === "move" ? ids : [found.id]) };
      return;
    }
    const tool = drawingTool(mode, tools); if (!tool) return;
    // A shape is placed by dragging its box; everything else is drawn freehand.
    if (placesBox(kitTool(mode, tools))) { drag.current = { pointerId: e.pointerId, part: "box", from: at, start: [] }; setBox({ x: at.x, y: at.y, w: 0, h: 0 }); return; }
    drag.current = { pointerId: e.pointerId, part: "draw", from: at, start: [] }; setStroke([at]);
  };
  const move = (e: React.PointerEvent<SVGSVGElement>) => {
    const current = drag.current; if (!current || current.pointerId !== e.pointerId) return;
    e.preventDefault(); e.stopPropagation();
    const at = point(e);
    if (current.part === "note") { setStroke(points => points && [...points, { x: at.x / 900, y: at.y / 600 }].slice(0, 400)); return; }
    if (current.part === "draw") { setStroke(points => points && [...points, at].slice(0, 1200)); return; }
    if (current.part === "box") { const f = current.from; setBox({ x: Math.min(f.x, at.x), y: Math.min(f.y, at.y), w: Math.abs(at.x - f.x), h: Math.abs(at.y - f.y) }); return; }
    const part = current.part, moved = new Map(current.start.map(item => [item.id, respecified(item, liftedOnMove(dragManipulation(item, part, current.from, at)))]));
    onState({ ...state, objects: state.objects.map(item => moved.get(item.id) ?? item) });
  };
  const up = (e: React.PointerEvent<SVGSVGElement>) => {
    const current = drag.current; if (!current || current.pointerId !== e.pointerId) return;
    drag.current = null;
    const tool = drawingTool(mode, tools);
    if (current.part === "note" && stroke && stroke.length > 1) onMarks([...marks, stroke.filter((_, i) => i % Math.max(1, Math.ceil(stroke.length / 64)) === 0).slice(0, 64)].slice(-24));
    if (current.part === "box" && box && tool) {
      // A click places the form at a size of its own.
      const placedAt = box.w < 8 && box.h < 8 ? { x: current.from.x - 45, y: current.from.y - 40, w: 90, h: 80 } : box;
      add(drawnObject(state, tool, tools, { box: placedAt }));
    }
    if (current.part === "draw" && stroke && tool) add(drawnObject(state, tool, tools, { points: stroke }));
    // The lasso takes what is drawn inside it, else lifts that part of the picture; then it can be moved and sized.
    if (current.part === "draw" && stroke && mode === "lasso" && stroke.length > 2) {
      const taken = state.objects.filter(item => inLoop(stroke, centerOf(placedBox(item)))).map(item => item.id);
      if (taken.length) onSelect(withMerged(state, taken)); else add(drawnObject(state, "crop", tools, { points: stroke }));
      onMode?.("select");
    }
    setStroke(null); setBox(null);
  };
  const add = (item: IdealObject | null) => { if (!item) return; onState({ ...state, objects: [...state.objects, item] }); onSelect([item.id]); };
  /** The item of the picture at a point, pointed at as it is (an object of the drawing), or null. */
  const pointedAt = (at: Point) => { const box = itemAt?.(at); return box ? drawnObject(state, "tag", tools, { box: box.w * box.h > 0 ? box : { x: box.x - 12, y: box.y - 12, w: 24, h: 24 } }) : null; };
  const picture = shot;
  const by = (kind: IdealObject["kind"]) => state.objects.filter(item => item.kind === kind);
  // Forms in merges are drawn together; the rest one by one.
  const merged = state.merges.map(merge => ({ merge, items: state.objects.filter(item => merge.members.includes(item.id)) })).filter(group => group.items.length > 1);
  const alone = by("shape").filter(item => !mergeOf(state, item.id));
  // Tags: the object of the brush and the words, then the rules (what each reads now).
  // Tags written where they are laid out (none covering another); the one edited is a control there instead.
  const labels = tagBlocks(state, objectNames, read, tagEditing), spots = placedTags ?? layoutBlocks(labels.map(label => ({ key: label.key, ...blockSize(label), shape: label.box })));
  const chosen = state.objects.filter(item => selected.includes(item.id));
  return <svg ref={sheet} className={`${className} ${live ? `mode-${mode.startsWith("tool:") ? "tool" : mode}` : ""}`} viewBox="0 0 900 600" preserveAspectRatio="none" style={{ pointerEvents: live ? "auto" : "none" }}
    onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
    {/* Taken away from the picture, and where lifted parts were. */}
    {[...by("erase"), ...by("crop")].map(item => <path key={`gone-${item.id}`} className={`ideal-gone ${item.kind}`} d={outlinePath(item.outline)} fill={PAPER} vectorEffect="non-scaling-stroke" />)}
    {by("crop").map(item => { const { cx, cy, angle } = placed(item), c = centerOf(item.box), d = outlinePath(item.outline);
      return <g key={item.id} transform={`translate(${cx} ${cy}) rotate(${angle * 180 / Math.PI}) scale(${item.scale}) translate(${-c.x} ${-c.y})`}>
        <clipPath id={`${clip}-${item.id}`}><path d={d} /></clipPath>
        {picture && <image href={picture} x={0} y={0} width={900} height={600} clipPath={`url(#${clip}-${item.id})`} preserveAspectRatio="none" />}
        {specColor(item) && <path d={d} fill={specColor(item)!} fillOpacity={.55} stroke="none" />}
        <path className="ideal-crop" d={d} vectorEffect="non-scaling-stroke" />
      </g>; })}
    {merged.map(group => <Forms key={group.merge.id} items={group.items} selected={group.items.every(item => selected.includes(item.id))} />)}
    {alone.map(item => <Forms key={item.id} items={[item]} selected={selected.includes(item.id)} />)}
    {by("line").map(item => <path key={item.id} className="ideal-line" d={outlinePath(placedOutline(item), false)} stroke={specColor(item) ?? item.color} vectorEffect="non-scaling-stroke" />)}
    {by("item").map(item => <path key={item.id} className="ideal-item" d={outlinePath(item.outline)} stroke={item.color} vectorEffect="non-scaling-stroke" style={specColor(item) ? { fill: specColor(item)!, fillOpacity: .55 } : undefined} />)}
    {labels.map(label => { const spot = spots.find(entry => entry.key === label.key); if (!spot) return null;
      const x = spot.x + spot.width / 2, top = spot.y + TAG_SIZE * .85;
      return <text key={`label-${label.key}`} className={onTagPress && editable ? "ideal-label pressable" : "ideal-label"} x={x} y={top} fill={label.color} textAnchor="middle"
        onPointerDown={onTagPress && editable ? e => { e.stopPropagation(); e.preventDefault(); onTagPress(label.key); } : undefined}>
        {onTagPress && editable && <title>Press to edit this tag</title>}
        {label.lines.map((line, i) => <tspan key={i} x={x} dy={i ? TAG_LINE : 0} className={line.rule ? "ideal-spec" : ""}>{line.text}</tspan>)}</text>; })}
    {[...marks, ...(drag.current?.part === "note" && stroke ? [stroke] : [])].map((mark, i) => <polyline key={`note-${i}`} className="ideal-note" points={mark.map(p => `${p.x * 900},${p.y * 600}`).join(" ")} vectorEffect="non-scaling-stroke" />)}
    {/* What is selected, and the grips of one object. */}
    {chosen.length > 0 && (() => { const around = union(chosen.map(placedBox)); return <rect className="ideal-selection" x={around.x - 6} y={around.y - 6} width={around.w + 12} height={around.h + 12} vectorEffect="non-scaling-stroke" />; })()}
    {single && live && mode === "select" && (() => { const corner = boxPoint(single, 1, 1), top = boxPoint(single, 0, -1), turn = rotateGrip(single);
      return <>
        <line className="ideal-grip-line" x1={top.x} y1={top.y} x2={turn.x} y2={turn.y} vectorEffect="non-scaling-stroke" />
        <circle className="ideal-grip" cx={turn.x} cy={turn.y} r={8} vectorEffect="non-scaling-stroke"><title>Turn to rotate</title></circle>
        <rect className="ideal-grip scale" x={corner.x - 7} y={corner.y - 7} width={14} height={14} vectorEffect="non-scaling-stroke"><title>Drag to scale</title></rect>
      </>; })()}
    {drag.current?.part === "draw" && stroke && <path className="ideal-drawing" d={outlinePath(stroke, mode === "lasso" || toolClosed(mode, tools))} vectorEffect="non-scaling-stroke" />}
    {box && <rect className="ideal-drawing" x={box.x} y={box.y} width={box.w} height={box.h} vectorEffect="non-scaling-stroke" />}
  </svg>;
}
/** Lines on top, then forms, lifted parts, items of the picture pointed at, erased parts. */
const LAYER: Record<IdealObject["kind"], number> = { erase: 0, item: 1, crop: 2, shape: 3, line: 4 };
/** The topmost object drawn at a point (lines on top), or undefined. */
export const objectAt = (state: IdealState, at: Point) => [...state.objects].sort((a, b) => LAYER[b.kind] - LAYER[a.kind]).find(item => item.kind === "line" ? nearPath(item, at, 9) : onCrop(item, at));
const toolClosed = (mode: IdealMode, tools: AlignTool[]) => { const tool = kitTool(mode, tools); return mode !== "pencil" && (!tool || placesBox(tool) || tool.closed); };
/** A tool whose form is placed by dragging its box (a shape, a behavior drawn as a form of its own outline); the others draw freehand. */
const placesBox = (tool: AlignTool | undefined) => Boolean(tool && (tool.kind === "shape" || (tool.kind === "behavior" && tool.template.length >= 3)));

/** A field of runtime state one can refer to while writing: as it is written, what it is, and what it reads now. */
export type RefChoice = { ref: string; name: string; value: number | null; code?: string };
/** Each field of the runtime state, named, with where it is in the brush's code (`code`). */
export const refChoices = (readings: VarReading[]): RefChoice[] => readings.flatMap(item => item.fields.map(field => ({ ref: field.ref, name: `${item.variable.name} · ${field.key}`, value: field.value, code: codeState(field.expr) })));
/** The reference being written at the caret (`@` and what follows), or null; in a rule (`code`), not inside a quoted part such as "@picked". */
export function refAt(text: string, caret: number, code = false) {
  const before = text.slice(0, caret), match = /(^|[^\w@.])@([a-z0-9_.]*)$/i.exec(before);
  if (!match || (code && ((before.match(/"/g)?.length ?? 0) % 2 || (before.match(/'/g)?.length ?? 0) % 2))) return null;
  return { from: caret - match[2].length - 1, typed: match[2].toLowerCase() };
}
/** The choices for what is typed after `@`: by reference or by name. */
export const refMatches = (refs: RefChoice[], typed: string) => refs.filter(item => item.ref.slice(1).toLowerCase().includes(typed) || item.name.toLowerCase().includes(typed)).slice(0, 8);
const valueText = (value: number | null) => value === null ? "" : String(Math.round(value * 10) / 10);
/** A choice a field offers in its dropdown (pressing it does `choose`); free text can always be typed instead. */
export type FieldOption = { key: string; text: string; note?: string; on?: boolean; choose: () => void };
/** The options listed: all of them when the field was just opened, those with what is typed once one types. */
export const optionMatches = (options: FieldOption[], typed: string, filtering: boolean) => {
  const words = typed.trim().toLowerCase();
  return filtering && words ? options.filter(item => item.text.toLowerCase().includes(words)) : options;
};
type RefInputProps = { value: string; onValue: (text: string) => void; refs: RefChoice[]; options?: FieldOption[]; code?: boolean; multiline?: boolean; rows?: number; wrapClassName?: string;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "onKeyDown">;
/**
 * A text field where `@` refers to runtime state: typing it lists the fields there are (filtered by what follows, ↑ ↓ to
 * choose, Enter or Tab to put it in, Esc to close), each with what it reads now. With `options` it also has a dropdown,
 * shown only when asked for (▾ or ↓, never on its own), filtered by what is typed; ↑ ↓ and Enter choose one, and any text can be typed instead.
 */
export function RefInput({ value, onValue, refs, options, code = false, multiline = false, rows, wrapClassName = "", onKeyDown, ...rest }: RefInputProps) {
  const field = useRef<HTMLInputElement & HTMLTextAreaElement>(null), [at, setAt] = useState<{ from: number; typed: string } | null>(null), [pick, setPick] = useState(0);
  const [listing, setListing] = useState<{ filtering: boolean } | null>(null), [optionPick, setOptionPick] = useState(-1);
  const choices = at ? refMatches(refs, at.typed) : [];
  const listed = !choices.length && listing && options ? optionMatches(options, value, listing.filtering) : [];
  const open = (filtering: boolean) => { if (options?.length) { setListing({ filtering }); setOptionPick(-1); } };
  const choose = (option: FieldOption) => { option.choose(); setListing(null); };
  const look = (el: HTMLInputElement | HTMLTextAreaElement) => setAt(refs.length ? refAt(el.value, el.selectionStart ?? el.value.length, code) : null);
  const insert = (choice: RefChoice) => { if (!at) return;
    const caret = field.current?.selectionStart ?? value.length, end = at.from + choice.ref.length;
    onValue(value.slice(0, at.from) + choice.ref + value.slice(caret).replace(/^[a-z0-9_.]*/i, "")); setAt(null);
    requestAnimationFrame(() => { field.current?.focus(); field.current?.setSelectionRange(end, end); }); };
  const keyDown = (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => { e.stopPropagation();
    if (choices.length && (e.key === "ArrowDown" || e.key === "ArrowUp")) { e.preventDefault(); setPick((pick + (e.key === "ArrowDown" ? 1 : choices.length - 1)) % choices.length); return; }
    if (choices.length && (e.key === "Enter" || e.key === "Tab")) { e.preventDefault(); insert(choices[Math.min(pick, choices.length - 1)]); return; }
    if (at && e.key === "Escape") { e.preventDefault(); setAt(null); return; }
    if (options?.length && !choices.length && (e.key === "ArrowDown" || e.key === "ArrowUp")) { e.preventDefault();
      if (!listing) { open(false); return; }
      // None highlighted (-1) is one of the stops, so Enter keeps the text typed.
      if (listed.length) setOptionPick((optionPick + 1 + (e.key === "ArrowDown" ? 1 : listed.length)) % (listed.length + 1) - 1); return; }
    if (listed.length && optionPick >= 0 && optionPick < listed.length && e.key === "Enter") { e.preventDefault(); choose(listed[optionPick]); return; }
    if (listing && e.key === "Escape") { e.preventDefault(); setListing(null); return; }
    onKeyDown?.(e); };
  const own = { ref: field, value, onChange: (e: React.ChangeEvent<HTMLInputElement & HTMLTextAreaElement>) => { onValue(e.target.value); look(e.target); setPick(0); if (listing) { setListing({ filtering: true }); setOptionPick(-1); } },
    onKeyDown: keyDown, onKeyUp: (e: React.KeyboardEvent<HTMLInputElement & HTMLTextAreaElement>) => { if (!["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(e.key)) look(e.currentTarget); },
    onClick: (e: React.MouseEvent<HTMLInputElement & HTMLTextAreaElement>) => look(e.currentTarget),
    onBlur: () => { setAt(null); setListing(null); },
    ...(options ? { role: "combobox", "aria-expanded": listed.length > 0, "aria-autocomplete": "list" as const } : {}) };
  return <span className={["ref-input", multiline && "multi", options && "dropdown", wrapClassName].filter(Boolean).join(" ")}>
    {multiline ? <textarea {...(rest as React.TextareaHTMLAttributes<HTMLTextAreaElement>)} rows={rows} {...own} /> : <input {...rest} {...own} />}
    {options && <button type="button" className="ref-drop" tabIndex={-1} aria-label="Show the options" disabled={rest.disabled || !options.length}
      onMouseDown={e => { e.preventDefault(); if (listing) setListing(null); else { field.current?.focus(); open(false); } }}>▾</button>}
    {listed.length > 0 && <ul className="ref-menu options" role="listbox" aria-label="Options">
      {listed.map((option, i) => <li key={option.key} role="option" aria-selected={i === optionPick} className={`${i === optionPick ? "on" : ""} ${option.on ? "chosen" : ""}`}
        onMouseDown={e => { e.preventDefault(); choose(option); }}><span>{option.on ? "✓ " : ""}{option.text}</span>{option.note && <small>{option.note}</small>}</li>)}
    </ul>}
    {choices.length > 0 && <ul className="ref-menu" role="listbox" aria-label="Runtime state to refer to">
      {choices.map((choice, i) => <li key={choice.ref} role="option" aria-selected={i === pick} className={i === pick ? "on" : ""} onMouseDown={e => { e.preventDefault(); insert(choice); }}>
        <b>{choice.ref}</b><span>{choice.name}{choice.code && <code> ({choice.code})</code>}</span>{choice.value !== null && <small>{valueText(choice.value)}</small>}</li>)}
    </ul>}
  </span>;
}

/** A tag (of the merged form when the ids are all of one): the object of the brush it is linked to and its words. */
type TagWordsProps = { state: IdealState; onState: (state: IdealState) => void; ids: string[]; objects: { id: string; name: string }[]; tools: AlignTool[]; refs: RefChoice[]; editable: boolean; autoFocus?: boolean };
/**
 * A tag: the object of the brush it is (a dropdown) and its words (a text box: typing changes them as one types, emptied
 * they are gone, the box keeps what is typed while it is them). The words are the user's own: none are offered.
 */
export function TagWords({ state, onState, ids, objects, tools, refs, editable, autoFocus }: TagWordsProps) {
  const chosen = state.objects.filter(item => ids.includes(item.id));
  const whole = state.merges.find(merge => merge.members.length === ids.length && merge.members.every(id => ids.includes(id)));
  const words = whole ? whole.label : chosen.length && chosen.every(item => item.label === chosen[0].label) ? chosen[0].label : "";
  const [custom, setCustom] = useState(words);
  useEffect(() => { if (custom.trim() !== words.trim()) setCustom(words); }, [ids.join(" "), words]);
  const label = (text: string) => { setCustom(text); if (ids.length) onState(labelObjects(state, ids, text)); };
  const linked = chosen.length && chosen.every(item => item.nodeId === chosen[0].nodeId) ? chosen[0].nodeId : "";
  return <span className="ideal-tag-field"><Icon name="tag" size={11} />
    {objects.length > 0 && <select className="ideal-tag-link" value={objects.some(item => item.id === linked) ? linked : ""} disabled={!editable} aria-label="The object of the brush it is"
      title="The object of the brush it is" onChange={e => onState(linkObjects(state, ids, e.target.value))} onKeyDown={e => e.stopPropagation()}>
      <option value="">No object</option>{objects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}
    <RefInput value={custom} onValue={label} refs={refs} maxLength={60} aria-label="Words on the tag of what is selected" disabled={!editable} autoFocus={autoFocus}
      placeholder={`Words on its tag…${refs.length ? " · @ runtime state" : ""}`} />
  </span>;
}

/** The rules on an object's tag: what the outcome decides of it, as expressions (AI's guess, or one's own); a size, center or turn places it. */
type TagRulesProps = { state: IdealState; onState: (state: IdealState) => void; item: IdealObject; examples: { aspect: string; expr: string; note: string }[]; refs: RefChoice[]; read: SpecReader; editable: boolean;
};
export function TagRules({ state, onState, item, examples, refs, read, editable }: TagRulesProps) {
  // The rule just added: its first field is focused to write it.
  const [added, setAdded] = useState(-1);
  return <div className="ideal-specs" role="group" aria-label="Rules on its tag">
      {item.specs.map((spec, i) => { const value = spec.expr.trim() ? read(spec.expr, item) : null, change = (patch: Partial<typeof spec>) => onState(setSpec(state, item.id, i, { ...spec, ...patch }, read));
        const options = spec.options ?? [], others = examples.filter(item => item.aspect === spec.aspect.trim() && !options.some(option => option.expr === item.expr));
        return <div key={i} className={`ideal-spec-row ${spec.expr.trim() && value === null && ["w", "h", "x", "y", "rotate"].includes(spec.aspect) ? "unread" : ""} ${spec.expr.trim() ? "" : "open"}`}>
          <div className="ideal-spec-line">
            <input className="aspect" value={spec.aspect} maxLength={30} aria-label="What it sets" placeholder="w h x y…" disabled={!editable} autoFocus={i === added} onChange={e => change({ aspect: e.target.value })} onKeyDown={e => e.stopPropagation()} />
            <span>=</span>
            <RefInput className="expr" wrapClassName="expr" value={spec.expr} onValue={expr => change({ expr })} refs={refs} code maxLength={300} aria-label="Its rule"
              options={[...options, ...others].map(reading => { const now = read(reading.expr, item);
                return { key: reading.expr, text: reading.expr, note: [reading.note, now !== null ? valueText(now) : ""].filter(Boolean).join(" · "), on: reading.expr === spec.expr.trim(), choose: () => change({ expr: reading.expr }) }; })}
              placeholder={refs.length ? "a rule · @ state" : "a rule"} disabled={!editable} />
            <output>{value !== null ? `→ ${Math.round(value * 10) / 10}` : spec.expr.trim() && ["w", "h", "x", "y", "rotate"].includes(spec.aspect) ? "?" : ""}</output>
            <button aria-label={`Remove the rule for ${spec.aspect}`} disabled={!editable} onClick={() => onState(setSpec(state, item.id, i, null, read))}>×</button>
          </div>
        </div>; })}
      {/* A rule added at once, empty: what it sets and its rule are written in its row. */}
      {item.specs.length < MAX_SPECS && <button type="button" className="ideal-spec-add" disabled={!editable}
        onClick={() => { setAdded(item.specs.length); onState(setSpec(state, item.id, item.specs.length, { aspect: "", expr: "", options: [] }, read)); }}>+ Rule</button>}
  </div>;
}

/**
 * The widget of an object's tag: there once a rule is written on it (`can`); AI is making it (`making`), why it could
 * not (`error`); it is open (`on`). Pressing makes it (or opens the one made), closes it; `remake` asks AI again.
 */
export type WidgetControl = { on: boolean; can: boolean; made: boolean; making: boolean; error: string; /** What to grab on the picture (the widget's hint). */ hint: string; toggle: () => void; remake: () => void };
/** Whether a widget can be made for an object: a rule is written on its tag. */
export const widgetCan = (item: IdealObject) => decidedSpecs(item.specs).length > 0;
/** Where a tag is on the picture: the box of the object (or of the merged form) it is on. */
export function tagBox(state: IdealState, id: string): Box | null {
  const merge = state.merges.find(entry => entry.id === id), items = state.objects.filter(item => merge ? merge.members.includes(item.id) : item.id === id);
  return items.length ? union(items.map(placedBox)) : null;
}
/** The tag being edited for what is selected: one object's, or a merged form's when it is all of one. */
export function tagTarget(state: IdealState, selected: string[]): string | null {
  const merge = state.merges.find(entry => entry.members.length === selected.length && entry.members.every(id => selected.includes(id)));
  return merge ? merge.id : selected.length === 1 && state.objects.some(item => item.id === selected[0]) ? selected[0] : null;
}
/** The tag of an object: the object of the brush it says it is (a dropdown) and the user's words (a text box). */
function TagBox({ item, onTag, objects, refs, editable, autoFocus }: { item: Pick<IdealObject, "nodeId" | "label">; onTag: (tag: { nodeId: string; label: string }) => void; objects: { id: string; name: string }[]; refs: RefChoice[]; editable: boolean; autoFocus?: boolean }) {
  // The box keeps what is typed (a space at the end) while it is the tag's words.
  const [text, setText] = useState(item.label);
  useEffect(() => { if (text.trim() !== item.label.trim()) setText(item.label); }, [item.label]);
  const type = (next: string) => { setText(next); onTag({ nodeId: item.nodeId, label: next }); };
  return <span className="ideal-tag-field"><Icon name="tag" size={11} />
    {objects.length > 0 && <select className="ideal-tag-link" value={objects.some(entry => entry.id === item.nodeId) ? item.nodeId : ""} disabled={!editable} aria-label="The object of the brush it is"
      title="The object of the brush it is" onChange={e => onTag({ nodeId: e.target.value, label: item.label })} onKeyDown={e => e.stopPropagation()}>
      <option value="">No object</option>{objects.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select>}
    <RefInput value={text} onValue={type} refs={refs} maxLength={60} aria-label="Words on the tag" disabled={!editable} autoFocus={autoFocus}
      placeholder={`Words…${refs.length ? " · @ state" : ""}`} />
  </span>;
}
/**
 * What is selected, edited on the picture where its tag is written: its ONE tag (the object of the brush and the
 * user's words), the rules on it, line by line (as many as wanted), and its widget button. A merged form has its words only.
 */
export function TagControl({ state, onState, id, objects, tools, refs, editable, examples, read, widget, at }: Omit<TagWordsProps, "ids" | "autoFocus"> & { id: string; examples: TagRulesProps["examples"]; read: SpecReader; widget?: WidgetControl; at?: { x: number; y: number } }) {
  const box = tagBox(state, id), merge = state.merges.find(entry => entry.id === id), item = merge ? undefined : state.objects.find(entry => entry.id === id);
  if (!box) return null;
  const spot = at ?? { x: box.x + box.w / 2, y: box.y - 10 };
  return <div className={`ideal-tag-control ${at ? "placed" : "above"}`} style={{ left: `${Math.round(spot.x / 9 * 100) / 100}%`, top: `${Math.round(spot.y / 6 * 100) / 100}%` }}
    onPointerDown={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
    {merge ? <TagWords state={state} onState={onState} ids={merge.members} objects={[]} tools={tools} refs={refs} editable={editable} autoFocus />
      : <>
        {item && <TagBox item={item} objects={objects} refs={refs} editable={editable} autoFocus onTag={tag => onState(tagObjects(state, [item.id], tag.label, tag.nodeId))} />}
        <div className="ideal-tag-actions">
          {/* Only once a rule is written on it: AI makes a direct manipulation interface on the picture for what the rules mean. */}
          {widget && (widget.can || widget.on) && <button className={`ideal-widget-open ${widget.on ? "on" : ""}`} aria-pressed={widget.on} disabled={!editable || widget.making} onClick={widget.toggle}
            title={widget.on ? "Close the widget (it is kept; Create widget opens it again)" : widget.made ? "Open the widget made for these rules" : "AI reads what your rules mean and makes handles on the picture to try what they could be instead"}>
            {widget.making ? <><span className="loading-spinner" />Making widget…</> : <><Icon name="spark" size={11} />{widget.on ? "Close widget" : "Create widget"}</>}</button>}
          {widget?.made && !widget.making && <button disabled={!editable} title="AI makes the widget again for the rules as they are now" onClick={widget.remake}><Icon name="spark" size={10} />Remake</button>}
        </div>
        {widget?.on && widget.hint && !widget.error && <p className="ideal-widget-hint" role="status">Widget on the picture · {widget.hint}</p>}
        {widget?.error && <p className="ideal-widget-error" role="alert">{widget.error}</p>}
        {item && <TagRules state={state} onState={onState} item={item} examples={examples} refs={refs} read={read} editable={editable} />}
      </>}
  </div>;
}
/** How much room the control takes on the picture (canvas pixels), for laying it out with the texts, `unit` px a pixel. */
export function controlSize(state: IdealState, id: string, unit: number) {
  const item = state.objects.find(entry => entry.id === id), rows = item ? 2 + item.specs.length + (item.specs.length < MAX_SPECS ? 1 : 0) : 1;
  return { width: Math.min(880, 380 / Math.max(.1, unit)), height: Math.min(560, (rows * 30 + 10) / Math.max(.1, unit)) };
}

/**
 * Runtime state shown on the picture (inspect tools): a point (`x`, `y`) as a cross, with a size (`w`, `h`) as the box
 * around it, with a reach (`r`) as its circle; named, with its other numbers. State without a place is only listed.
 */
/** A variable's name on the picture: its reference, its name with where it is in the code, and its other numbers. */
const markText = (item: VarReading) => { const rest = item.fields.filter(field => !["x", "y"].includes(field.key) && field.value !== null).map(field => `${field.key} ${valueText(field.value)}`).join(" · ");
  const code = variableCode(item.variable); return `@${item.variable.id} ${item.variable.name}${code ? ` (${code.length > 48 ? `${code.slice(0, 47)}…` : code})` : ""}${rest ? ` · ${rest}` : ""}`; };
export function VariableMarks({ readings, avoid = [] }: { readings: VarReading[]; avoid?: { x: number; y: number; width: number; height: number }[] }) {
  // Their names laid out clear of the frame's other texts (the tags first) and of each other.
  const named = readings.flatMap(item => { const value = (key: string) => item.fields.find(field => field.key === key)?.value ?? null, x = value("x"), y = value("y"), w = value("w"), h = value("h"), r = value("r");
    if (x === null || y === null) return [];
    const text = markText(item), half = w !== null && h !== null ? { w: w / 2, h: h / 2 } : r !== null ? { w: r, h: r } : { w: 9, h: 9 };
    return [{ key: item.variable.id, text, width: textWidth(text, 14) + 6, height: 18, shape: { x: x - half.w, y: y - half.h, w: half.w * 2, h: half.h * 2 } }]; });
  const spots = layoutBlocks(named, { width: 900, height: 600 }, avoid);
  return <svg className="ideal-vars-sheet" viewBox="0 0 900 600" preserveAspectRatio="none" aria-hidden="true">
    {readings.map(item => { const value = (key: string) => item.fields.find(field => field.key === key)?.value ?? null, x = value("x"), y = value("y"), w = value("w"), h = value("h"), r = value("r");
      if (x === null || y === null) return null;
      const color = item.variable.color;
      const top = w !== null && h !== null ? y - h / 2 : r !== null ? y - r : y - 9;
      return <g key={item.variable.id} className="ideal-var" style={{ color }}>
        {w !== null && h !== null && <rect x={x - w / 2} y={y - h / 2} width={Math.max(1, w)} height={Math.max(1, h)} vectorEffect="non-scaling-stroke" />}
        {r !== null && <circle cx={x} cy={y} r={Math.max(1, r)} vectorEffect="non-scaling-stroke" />}
        <path className="cross" d={`M${x - 9} ${y}H${x + 9}M${x} ${y - 9}V${y + 9}`} vectorEffect="non-scaling-stroke" />
        {(() => { const spot = spots.find(entry => entry.key === item.variable.id), text = markText(item);
          return spot ? <text x={spot.x + spot.width / 2} y={spot.y + 14} textAnchor="middle">{text}</text> : <text x={Math.min(880, Math.max(20, x))} y={Math.max(16, top - 7)} textAnchor="middle">{text}</text>; })()}
      </g>; })}
  </svg>;
}

type ToolsProps = {
  state: IdealState; onState: (state: IdealState) => void; kit: AlignKit | null; mode: IdealMode; onMode: (mode: IdealMode) => void;
  selected: string[]; onSelect: (ids: string[]) => void; marks: Point[][]; onMarks: (marks: Point[][]) => void;
  editable: boolean; busy: boolean;
  /** The preset loaded last (it is changed by hand from there). */
  preset: string; onPreset: (id: string) => void;
  /** The kit's tools are being made by AI, and making them again at this moment (`request`: a tool asked for, added to the kit). */
  making: boolean; onMake: (request?: string) => void;
  /** The objects of the brush a tag can link to. */
  objects: { id: string; name: string }[];
  /** The execution state the chosen state tool's grips hold now (shown while it is chosen). */
  current: { key: string; name: string; text: string }[];
  /** AI's guesses were drawn for another moment than the one shown. */
  presetsElsewhere?: boolean;
  /** The execution state set by hand (with state tools), and setting it: the frame's state values replaced (`{}`: as it ran). */
  changes: StateChange[]; onStateValues: (values: Record<string, number | string>) => void;
  /** Reads the rules on tags at this moment. */
  read?: SpecReader;
  /** The runtime state the kit refers to, as it reads at this moment (`@` in a rule or words), and the ones shown on the picture. */
  variables?: VarReading[]; inspecting?: string[]; onInspect?: (ids: string[]) => void;
  /** Tools and runtime state left out at this moment: drawing with them changes nothing in the picture, or they read nothing here. */
  dead?: { tools: string[]; variables: string[] };
  /** What the behavior tools give the brush's code now, by key (`@tool/<tool>/<value>`). */
  behaving?: Record<string, number | string>;
};
const pointText = (at: { x: number; y: number } | null) => at ? `(${Math.round(at.x)}, ${Math.round(at.y)})` : "?";
const changeText = (change: StateChange) => change.kind === "move" ? `${pointText(change.was)} → ${pointText(change.now)}` : `${change.was ?? "?"} → ${change.now}`;
const BASE: { mode: IdealMode; name: string; icon: "play" | "select" | "lasso" | "eraser" | "pen" | "tag"; hint: string }[] = [
  { mode: "run", name: "Look · Step", icon: "play", hint: "Only look and step the execution (buttons, ← →, ◎ Jump to pressed); what you drew stays" },
  { mode: "select", name: "Move · Size", icon: "select", hint: "Click something drawn or an item of the picture (Shift adds) · drag to move · □ corner to size · ○ above to rotate · Delete removes" },
  { mode: "lasso", name: "Lasso", icon: "lasso", hint: "Draw around things to take them (or around a part of the picture to lift it out), then move and size them" },
  { mode: "pencil", name: "Pencil", icon: "pen", hint: "Draw a line, or a form of your own by coming back to where you started" },
  { mode: "tag", name: "Tag", icon: "tag", hint: "Press something drawn, or an item of the picture; its tag links it to an object of the brush and carries your words and rules (size, place, …)" },
  { mode: "erase", name: "Erase part", icon: "eraser", hint: "Draw around a part of the picture that should not be there" },
  { mode: "note", name: "Note", icon: "pen", hint: "Write or mark freely on the picture" },
];

/**
 * The tools for drawing the state the user wants: the base tools, the tools AI made for this concern (forms to
 * place or draw, merging, naming), what has been drawn, and AI's presets to start from.
 */
export function IdealTools({ state, onState, kit, mode, onMode, selected, onSelect, marks, onMarks, editable, busy, preset, onPreset, making, onMake, presetsElsewhere, changes, onStateValues, objects, current, read = () => null, variables: allVariables = [], inspecting = [], onInspect, dead = { tools: [], variables: [] }, behaving = {} }: ToolsProps) {
  const [asked, setAsked] = useState(""), [notice, setNotice] = useState("");
  // Only what changes what the frame shows at this moment is offered.
  const tools = (kit?.tools ?? []).filter(tool => toolGroup(tool) && !dead.tools.includes(tool.id)), variables = allVariables.filter(item => !dead.variables.includes(item.variable.id));
  const left = [...(kit?.tools ?? []).filter(tool => dead.tools.includes(tool.id)).map(tool => tool.name), ...allVariables.filter(item => dead.variables.includes(item.variable.id)).map(item => item.variable.name)];
  const forms = selected.filter(id => state.objects.some(item => item.id === id && item.kind === "shape"));
  const setMode = (next: IdealMode) => { onMode(next); setNotice(""); if (next !== "select" && next !== "tag") onSelect([]); };
  /** A merge tool joins the forms selected; with fewer than two it says how to select them. */
  const join = (tool: AlignTool | null) => { if (forms.length >= 2) { onState(mergeObjects(state, forms, "")); setNotice(""); return; }
    onMode("select"); setNotice(`Select two or more forms (Shift-click, or draw around them with the Lasso), then press “${tool?.name ?? "Merge outlines"}”.`); };
  const active = BASE.find(item => item.mode === mode)?.hint ?? kitTool(mode, tools)?.hint ?? "";
  const named = (item: IdealObject) => item.label || tools.find(tool => tool.id === item.tool)?.name || ({ crop: "Lifted part", erase: "Erased part", item: "Item", line: "Line", shape: "Form" } as const)[item.kind];
  const setting = kitTool(mode, tools)?.kind === "state", behavior = kitTool(mode, tools)?.kind === "behavior" ? kitTool(mode, tools)! : undefined;
  const toolButton = (tool: AlignTool) => <button key={tool.id} className={`kit ${mode === kitMode(tool.id) ? "active" : ""}`} aria-pressed={mode === kitMode(tool.id)} disabled={!editable} title={tool.hint}
    onClick={() => setMode(kitMode(tool.id))}><i style={{ background: tool.color }} />{tool.name}</button>;
  const group = (name: string, hint: string, items: React.ReactNode[]) => items.length > 0 && <span className="ideal-group" role="group" aria-label={name} title={hint}><em>{name}</em>{items}</span>;
  // Rules one can choose for a tag instead of writing them.
  const examples = specExamples(kit), refs = refChoices(variables);
  const inspect = (id: string) => onInspect?.(inspecting.includes(id) ? inspecting.filter(other => other !== id) : [...inspecting, id]);
  const inspected = variables.filter(item => inspecting.includes(item.variable.id));
  return <div className="ideal-tools">
    {kit ? <p className="ideal-reading"><em>Your intent, as read</em>{kit.reading}</p>
      : <span className="ideal-muted">{making ? "" : "AI makes tools for drawing what you want at this moment."}</span>}
    <div className="ideal-toolbar" role="toolbar" aria-label="Tools for the state you want">
      {BASE.map(item => <button key={item.mode} className={mode === item.mode ? "active" : ""} aria-pressed={mode === item.mode} disabled={!editable} title={item.hint} onClick={() => setMode(item.mode)}><Icon name={item.icon} size={12} />{item.name}</button>)}
      {/* The kit in its three groups: inspecting the execution state, drawing a behavior the brush runs with, drawing the state wanted. */}
      {group("Inspect", "See and set the execution state at this moment", [
        ...variables.map(item => { const on = inspecting.includes(item.variable.id);
          return <button key={`var-${item.variable.id}`} className={`kit inspect ${on ? "active" : ""}`} aria-pressed={on} title={`${item.variable.means || item.variable.name} · in the code: ${variableCode(item.variable)} · @${item.variable.id} in a rule or words refers to it`}
            onClick={() => inspect(item.variable.id)}><Icon name="inspect" size={12} />{item.variable.name}</button>; }),
        ...tools.filter(tool => tool.kind === "state").map(toolButton)])}
      {group("Behavior", "Draw how the brush should behave: it runs with what you draw, in this frame", tools.filter(tool => tool.kind === "behavior").map(toolButton))}
      {/* Joining acts on what is selected: here with the other tools, so it is there before anything is. */}
      {group("Desired state", "Draw and change the picture you want at this moment", [...tools.filter(tool => tool.kind === "shape" || tool.kind === "pen").map(toolButton),
        ...tools.filter(tool => tool.kind === "merge").map(tool => <button key={tool.id} className="kit" disabled={!editable} title={tool.hint} onClick={() => join(tool)}><i style={{ background: tool.color }} />{tool.name}</button>)])}
      <button className="kit-make" disabled={busy || making} title="AI reads the concern at this moment again and makes new tools and presets" onClick={() => onMake()}>
        {making ? <><span className="loading-spinner" />Making tools…</> : <><Icon name="spark" size={12} />{kit ? "Remake tools here" : "Make tools for this moment"}</>}</button>
    </div>
    {/* Asking for a tool of one's own: AI makes it and adds it to these. */}
    <form className="ideal-ask" onSubmit={e => { e.preventDefault(); if (!asked.trim() || making || busy) return; onMake(asked.trim()); setAsked(""); }}>
      <input value={asked} maxLength={300} placeholder="Ask for a tool · what it should let you show, check or set" aria-label="Ask for a tool" disabled={busy}
        onChange={e => setAsked(e.target.value)} onKeyDown={e => e.stopPropagation()} />
      <button type="submit" disabled={!asked.trim() || making || busy}><Icon name="spark" size={11} />Make tool</button>
    </form>
    {(notice || active) && <span className="ideal-hint">{notice || active}</span>}
    {left.length > 0 && <span className="ideal-muted ideal-left" title="Drawing with them changes nothing in the picture at this moment, or they read nothing here">Left out at this moment: {left.join(", ")}</span>}
    {/* What the chosen behavior gives the brush's code now (none drawn: the brush as it is). */}
    {behavior && <ul className="ideal-objects ideal-state-now" aria-label="What the brush runs with">
      {behavior.values.map(value => { const now = behaving[behaviorKey(behavior.id, value.id)];
        return <li key={value.id}><span><b>{value.label}</b> {now === undefined ? "not drawn yet: the brush as it is" : value.kind === "outline" ? `drawn form (${(JSON.parse(String(now)) as unknown[]).length} points)` : valueText(Number(now))}</span></li>; })}</ul>}
    {/* The state the chosen state tool sets, as it is at this moment. */}
    {setting && <ul className="ideal-objects ideal-state-now" aria-label="Execution state at this moment">
      {current.length ? current.map(item => <li key={item.key}><span title={item.key}><b>{item.name}</b> {item.text}</span></li>)
        : <li><span>Nothing of it to grab at this moment.</span></li>}</ul>}
    {/* The runtime state inspected, as it reads at this moment. */}
    {inspected.length > 0 && <ul className="ideal-objects ideal-vars" aria-label="Runtime state at this moment">
      {inspected.map(item => <li key={item.variable.id}><span title={item.variable.means}><i style={{ background: item.variable.color }} /><b>{item.variable.name}</b>
        {item.fields.map(field => <code key={field.key} title={`${codeState(field.expr)} · ${field.expr}`}>{field.ref} ({codeState(field.expr)}) {field.value === null ? "?" : valueText(field.value)}</code>)}</span>
        <button aria-label={`Hide ${item.variable.name}`} onClick={() => inspect(item.variable.id)}>×</button></li>)}
    </ul>}
    {/* Acting on what is selected: merging forms into one, naming it, removing it. */}
    {selected.length > 0 && <div className="ideal-actions" role="group" aria-label="Selected">
      <b>{selected.length} selected</b>
      {tools.filter(tool => tool.kind === "merge").map(tool => <button key={tool.id} disabled={!editable || forms.length < 2} title={tool.hint} onClick={() => join(tool)}><i style={{ background: tool.color }} />{tool.name}</button>)}
      {!tools.some(tool => tool.kind === "merge") && <button disabled={!editable || forms.length < 2} title="Join the selected forms into one outline" onClick={() => join(null)}>Merge outlines</button>}
      {selected.some(id => mergeOf(state, id)) && <button disabled={!editable} onClick={() => onState(splitObjects(state, selected))}>Split</button>}
      {/* One thing (or one merged form) is tagged on the picture; several at once here. */}
      {!tagTarget(state, selected) && <TagWords state={state} onState={onState} ids={selected} objects={objects} tools={tools} refs={refs} editable={editable} />}
      {tagTarget(state, selected) && <span className="ideal-muted">Its tags and rules are on the picture.</span>}
      <button disabled={!editable} onClick={() => { onState(removeObjects(state, selected)); onSelect([]); }}><Icon name="trash" size={11} />Remove</button>
    </div>}
    {/* The rules on the tag of the one selected: what the outcome decides of it, as expressions (AI's guess, or one's own); a size, center or turn places it. */}
    {(state.objects.length > 0 || marks.length > 0) && <ul className="ideal-objects">
      {state.merges.map(merge => <li key={merge.id} className={merge.members.every(id => selected.includes(id)) ? "on" : ""}><button onClick={() => { onMode("select"); onSelect(merge.members); }}>{merge.label || "Merged form"}</button><span>{merge.members.length} forms as one outline</span></li>)}
      {state.objects.filter(item => !mergeOf(state, item.id)).map(item => <li key={item.id} className={selected.includes(item.id) ? "on" : ""}><button onClick={() => { onMode("select"); onSelect([item.id]); }}><i style={{ background: item.color }} />{named(item)}</button>
        <button aria-label={`Remove ${named(item)}`} disabled={!editable} onClick={() => { onState(removeObjects(state, [item.id])); onSelect(selected.filter(id => id !== item.id)); }}>×</button></li>)}
      {marks.length > 0 && <li><span>{marks.length} note stroke{marks.length === 1 ? "" : "s"}</span><button aria-label="Remove notes" disabled={!editable} onClick={() => onMarks([])}>×</button></li>}
    </ul>}
    {/* Execution state set by hand: what it was at this moment and what it is now. */}
    {changes.length > 0 && <ul className="ideal-objects ideal-state-changes" aria-label="Execution state set by hand">
      {changes.map(change => <li key={change.key}><span title={change.key}><b>{change.name}</b> {changeText(change)}</span>
        <button aria-label={`Put back ${change.name}`} title="Put it back as it ran" disabled={!editable}
          onClick={() => onStateValues(Object.fromEntries(changes.filter(item => item.key !== change.key).map(item => [item.key, valueOf(item)])))}>×</button></li>)}
    </ul>}
    {kit && kit.presets.length > 0 && <div className="ideal-presets"><span className="section-kicker">AI'S GUESSES · load one and change it with the tools</span>
      {presetsElsewhere && <span className="ideal-muted">These were drawn for the moment the tools were made at; “Remake tools here” draws them for this one.</span>}
      {kit.presets.map(item => <button key={item.id} className={preset === item.id ? "on" : ""} disabled={!editable} title={item.detail}
        onClick={() => { onState(withSpecs(presetState(item, tools), read)); onStateValues(presetValues(item, tools)); onSelect([]); onMode("select"); onPreset(item.id); }}><b>{item.title}</b><span>{item.detail}</span></button>)}
    </div>}
    {(state.objects.length > 0 || marks.length > 0 || changes.length > 0) && <button className="ideal-clear" disabled={!editable} onClick={() => { onState({ objects: [], merges: [] }); onMarks([]); onStateValues({}); onSelect([]); onPreset(""); }}>Clear drawing and state</button>}
  </div>;
}

/** A change as the frame keeps it: a number, or a move ("dx,dy"). */
const valueOf = (change: StateChange) => change.kind === "move" ? `${change.moved.dx},${change.moved.dy}` : change.now;
