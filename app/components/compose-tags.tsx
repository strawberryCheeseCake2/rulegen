import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { draggedTransformation, emptyTransformation, MAX_TAG_PROPERTIES, MAX_TAG_TRANSFORMATIONS, TAG_TRANSFORMATION_DRAG, tagsInside, type ComposeTag, type ComposeTagPen, type ComposeTagTransformation, type TagTransformationAt } from "../lib/compose-tags";

export const EFFECT_COLORS: Record<string, string> = { spatial: "#2f7d62", stylistic: "#9a5bb8", temporal: "#c27412" };
const CHIP = 24, CARD_WIDTH = 320, EDGE = 8;
type CardSpot = { left: number; top?: number; bottom?: number; maxHeight: number };
/** Where a card goes on screen beside its chip: under it (over it when there is more room there), inside the window, as tall as fits. */
export function cardSpot(chip: { left: number; top: number; bottom: number }, view: { width: number; height: number }): CardSpot {
  const below = view.height - chip.bottom - EDGE - 4, above = chip.top - EDGE - 4;
  const left = Math.max(EDGE, Math.min(chip.left, view.width - CARD_WIDTH - EDGE));
  return below >= 240 || below >= above ? { left, top: chip.bottom + 4, maxHeight: Math.max(120, below) } : { left, bottom: view.height - chip.top + 4, maxHeight: Math.max(120, above) };
}
/** A minimal example frame of a transformation: its name, its picture (none while it is not running) and whether it is hidden. */
export type ExampleThumb = { id: string; name: string; thumbnail: string | null; hidden: boolean };

/**
 * The Compose prompt's tags on the sketch: one chip per object/collection the AI read, on the marks it is drawn
 * with. Clicking a chip opens what goes into it: its members, the collection it is in, the tags inside it, and
 * its transformations with their properties (and the minimal examples of a transformation that has been decomposed).
 * Chips keep their size on screen at any board zoom. The card is not cut by the frame: it floats over the page
 * beside its chip (following it as the board moves) and scrolls when it is taller than the room there.
 */
export function ComposeTags({ tags, zoom, stale, examples, onCard, onExample, onEdit, onRevise, busy = false, open: openTag, onOpen, highlight = null, canMove, onMove, onKind, onDelete, onMoveTransformation }: { tags: ComposeTag[]; zoom: number; stale: boolean;
  /** The tag whose card is open, when it is kept outside (e.g. picked from the tag tree in the panel), and the one pointed at there. */
  open?: string | null; onOpen?: (id: string | null) => void; highlight?: string | null;
  /** The minimal examples of the transformation a pen carries. */
  examples?: (pen: ComposeTagPen | null) => ExampleThumb[];
  /** A tag's card opened (to take its examples' pictures). */
  onCard?: (tag: ComposeTag) => void; onExample?: (frameId: string) => void;
  /** The tags after the user edited a card's text (none: read only). */
  onEdit?: (tags: ComposeTag[]) => void;
  /** Ask AI to change one transformation of a tag ("make it …"); `busy`: AI is working on this frame. */
  onRevise?: (tagId: string, index: number, request: string) => void; busy?: boolean;
  /** Changing the structure: whether a tag can go into a collection ("" = the top), moving it there (drag a chip onto another), making it a collection or an object, deleting it. */
  canMove?: (id: string, parentId: string) => boolean; onMove?: (id: string, parentId: string) => void;
  onKind?: (id: string, kind: ComposeTag["kind"]) => void; onDelete?: (id: string) => void;
  /** Moving a transformation (dragged by its grip in a card, or from the tag tree) to a tag: before its transformation `before`, or at its end (dropped on its chip). */
  onMoveTransformation?: (from: TagTransformationAt, to: string, before?: number) => void }) {
  const [ownOpen, setOwnOpen] = useState<string | null>(null), [hover, setHover] = useState<string | null>(null);
  const open = openTag !== undefined ? openTag : ownOpen;
  const setOpen = (next: string | null | ((current: string | null) => string | null)) => {
    const id = typeof next === "function" ? next(open) : next;
    setOwnOpen(id); if (id !== open) onOpen?.(id);
  };
  // A card that opens (here or from outside) takes its examples' pictures.
  useEffect(() => { const tag = open ? tags.find(item => item.id === open) : undefined; if (tag) onCard?.(tag); }, [open]);
  const layer = useRef<HTMLDivElement>(null), [card, setCard] = useState<CardSpot | null>(null);
  // Change requests being written (by tag and transformation), the one AI is working on, and each one's look before it changed (to undo).
  const [requests, setRequests] = useState<Record<string, string>>({}), [pending, setPending] = useState<string | null>(null);
  const [before, setBefore] = useState<Record<string, ComposeTagTransformation>>({});
  useEffect(() => { if (!busy) setPending(null); }, [busy]);
  useEffect(() => {
    if (!open) { setCard(null); return; }
    let frame = 0, last = "";
    const follow = () => {
      const chip = layer.current?.querySelector(`[data-tag="${CSS.escape(open)}"]`)?.getBoundingClientRect();
      const next = chip ? cardSpot(chip, { width: window.innerWidth, height: window.innerHeight }) : null, key = JSON.stringify(next);
      if (key !== last) { last = key; setCard(next); }
      frame = requestAnimationFrame(follow);
    };
    follow();
    // Escape in a field leaves the field; elsewhere it closes the card.
    const escape = (e: KeyboardEvent) => { if (e.key !== "Escape") return; const typing = (e.target as Element | null)?.closest?.("input,textarea") as HTMLElement | null; if (typing) typing.blur(); else setOpen(null); };
    window.addEventListener("keydown", escape);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("keydown", escape); };
  }, [open]);
  const k = 1 / Math.max(.2, zoom), byId = useMemo(() => new Map(tags.map(tag => [tag.id, tag])), [tags]);
  // A chip goes on top of its marks; one that would cover an earlier chip moves down past it (canvas px).
  const spots = useMemo(() => {
    const placed: { id: string; x: number; y: number }[] = [], h = CHIP * k / 600;
    for (const tag of [...tags].sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x)) {
      let y = tag.box.y;
      for (let guard = 0; guard < tags.length && placed.some(spot => Math.abs(spot.y - y) < h && Math.abs(spot.x - tag.box.x) < 150 * k / 900); guard++) y += h;
      placed.push({ id: tag.id, x: tag.box.x, y });
    }
    return new Map(placed.map(spot => [spot.id, spot]));
  }, [tags, k]);
  const shown = open ? byId.get(open) : undefined;
  // Dragging a chip onto another puts it in that collection (onto an object: beside it, in the same collection).
  const [dragging, setDragging] = useState<string | null>(null), [over, setOver] = useState<string | null>(null);
  const dropParent = (target: ComposeTag) => target.kind === "collection" ? target.id : target.parentId;
  const droppable = (target: ComposeTag) => Boolean(dragging && dragging !== target.id && canMove?.(dragging, dropParent(target)));
  // A dragged transformation goes to the chip's tag (at its end) or before the card's transformation it is dropped on.
  const carrying = (e: React.DragEvent) => Boolean(onMoveTransformation && e.dataTransfer.types.includes(TAG_TRANSFORMATION_DRAG));
  const takes = (tagId: string, before: number | undefined, key: string) => ({
    onDragOver: (e: React.DragEvent) => { if (!carrying(e)) return; e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "move"; setOver(key); },
    onDragLeave: () => setOver(current => current === key ? null : current),
    onDrop: (e: React.DragEvent) => { const from = carrying(e) ? draggedTransformation(e.dataTransfer) : null; if (!from) return; e.preventDefault(); e.stopPropagation(); setOver(null); onMoveTransformation!(from, tagId, before); },
  });

  const chip = (tag: ComposeTag, inline = false) => <button key={tag.id} type="button" className={`compose-tag ${tag.kind} ${inline ? "inline" : ""} ${open === tag.id ? "open" : ""} ${over === tag.id ? "drop" : ""} ${dragging === tag.id ? "dragging" : ""}`}
    draggable={Boolean(onMove)} onDragStart={e => { e.stopPropagation(); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", tag.label); setDragging(tag.id); }}
    onDragEnd={() => { setDragging(null); setOver(null); }}
    onDragOver={e => { if (carrying(e)) { takes(tag.id, undefined, tag.id).onDragOver(e); return; } if (!droppable(tag)) return; e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "move"; setOver(tag.id); }}
    onDragLeave={() => setOver(current => current === tag.id ? null : current)}
    onDrop={e => { if (carrying(e)) { takes(tag.id, undefined, tag.id).onDrop(e); return; } if (!droppable(tag)) return; e.preventDefault(); e.stopPropagation(); onMove?.(dragging!, dropParent(tag)); setDragging(null); setOver(null); }}
    onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); setOpen(current => current === tag.id ? null : tag.id); }}
    onPointerEnter={() => setHover(tag.id)} onPointerLeave={() => setHover(current => current === tag.id ? null : current)}
    title={`${tag.kind === "collection" ? "Collection" : "Object"}: ${tag.label}`}>
    <i aria-hidden>{tag.kind === "collection" ? "▦" : "●"}</i>{tag.label}{tag.transformations.length > 0 && <em>{tag.transformations.length}</em>}</button>;
  const focus = (hover ? byId.get(hover) : undefined) ?? (highlight ? byId.get(highlight) : undefined) ?? shown;
  // What a focused collection contains is outlined with it, and its line to each is drawn strong.
  const inside = focus ? tagsInside(tags, focus.id) : [], related = new Set([focus?.id, ...inside.map(tag => tag.id)]);
  const box = (tag: ComposeTag, faint: boolean) => <div key={tag.id} className={`compose-tag-box ${tag.kind} ${faint ? "inside" : ""}`} style={{ left: `${tag.box.x * 100}%`, top: `${tag.box.y * 100}%`, width: `${tag.box.w * 100}%`, height: `${tag.box.h * 100}%`, borderWidth: (faint ? 1.5 : 2) * k }} />;
  return <div ref={layer} className="compose-tags" aria-label="Compose prompt tags">
    {focus && <>{inside.map(tag => box(tag, true))}{box(focus, false)}</>}
    {/* Containment: a line from each collection's chip down and across to the chip of each tag it contains. */}
    <svg className="compose-tag-links" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden>{tags.map(tag => {
      const parent = spots.get(tag.parentId), at = spots.get(tag.id); if (!parent || !at) return null;
      const strong = related.has(tag.id) && related.has(tag.parentId);
      return <path key={tag.id} className={strong ? "strong" : ""} vectorEffect="non-scaling-stroke" d={`M${parent.x + .008} ${parent.y}V${at.y - CHIP * k / 1200}H${at.x}`} />; })}</svg>
    {tags.map(tag => { const spot = spots.get(tag.id)!; return <div key={tag.id} data-tag={tag.id} className={`compose-tag-spot ${tag.parentId && byId.has(tag.parentId) ? "nested" : ""}`} style={{ left: `${spot.x * 100}%`, top: `${spot.y * 100}%`, transform: `translateY(-100%) scale(${k})` }}>{chip(tag)}</div>; })}
    {shown && card && createPortal((() => {
      const parent = byId.get(shown.parentId), children = tags.filter(tag => tag.parentId === shown.id);
      const patch = (edit: (tag: ComposeTag) => ComposeTag) => onEdit?.(tags.map(tag => tag.id === shown.id ? edit(tag) : tag));
      // Every text of the card is a field the user can change (read only without onEdit).
      const field = (value: string, max: number, placeholder: string, set: (value: string) => void, className = "", long = false) => !onEdit
        ? <span className={className}>{value}</span>
        : long ? <textarea className={`compose-tag-field ${className}`} value={value} maxLength={max} placeholder={placeholder} aria-label={placeholder} rows={Math.max(1, Math.ceil(value.length / 34))} onChange={e => set(e.currentTarget.value)} />
        : <input className={`compose-tag-field ${className}`} value={value} maxLength={max} placeholder={placeholder} aria-label={placeholder} onChange={e => set(e.currentTarget.value)} />;
      return <div className={`compose-tag-card ${shown.kind}`} onPointerDown={e => e.stopPropagation()} onWheel={e => e.stopPropagation()}
        style={{ left: card.left, top: card.top, bottom: card.bottom, maxHeight: card.maxHeight, width: CARD_WIDTH }}>
        <header>{onKind ? <button type="button" className="compose-tag-kind" title={`Make it ${shown.kind === "collection" ? "an object (what it holds goes up a level)" : "a collection"}`}
            onClick={() => onKind(shown.id, shown.kind === "collection" ? "object" : "collection")}>{shown.kind === "collection" ? "Collection" : "Object"} ⇄</button>
            : <span className="compose-tag-kind">{shown.kind === "collection" ? "Collection" : "Object"}</span>}
          {field(shown.label, 60, "Name", label => patch(tag => ({ ...tag, label })), "compose-tag-title")}
          {onDelete && <button type="button" className="compose-tag-delete" title={`Delete this tag${children.length ? " (what it holds goes up a level)" : ""}`} aria-label="Delete tag" onClick={() => { onDelete(shown.id); setOpen(null); }}>Delete</button>}
          <button type="button" aria-label="Close" onClick={() => setOpen(null)}>×</button></header>
        {field(shown.summary, 200, "What it is", summary => patch(tag => ({ ...tag, summary })), "", true)}
        {shown.kind === "collection" && <div className="compose-tag-members"><b>Members</b>{field(shown.members, 120, "What repeats, about how many", members => patch(tag => ({ ...tag, members })))}</div>}
        {parent && <div className="compose-tag-related"><b>In</b>{chip(parent, true)}{onMove && <button type="button" className="compose-tag-out" title="Take it out of this collection" onClick={() => onMove(shown.id, parent.parentId)}>Take out</button>}</div>}
        {onMove && <p className="compose-tag-hint">Drag a tag onto a collection to put it inside{onMoveTransformation ? "; drag a transformation by ⠿ onto a tag to move it there" : ""}.</p>}
        {children.length > 0 && <div className="compose-tag-related"><b>Contains</b>{children.map(child => chip(child, true))}</div>}
        <div className="compose-tag-section">Transformations</div>
        {shown.transformations.length ? <ul className="compose-tag-transformations">{shown.transformations.map((item, i) => {
          const change = (next: Partial<typeof item>) => patch(tag => ({ ...tag, transformations: tag.transformations.map((entry, at) => at === i ? { ...entry, ...next } : entry) }));
          return <li key={i} className={over === `${shown.id}:${i}` ? "drop" : ""} {...takes(shown.id, i, `${shown.id}:${i}`)}>
          <div className="compose-tag-transformation">{onMoveTransformation && <span className="compose-tag-grip" draggable title="Drag onto a tag on the sketch (or the tag tree), or before another transformation here, to move it there" aria-label={`Move ${item.label}`}
            onDragStart={e => { e.stopPropagation(); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData(TAG_TRANSFORMATION_DRAG, JSON.stringify({ tagId: shown.id, index: i })); e.dataTransfer.setData("text/plain", item.label); }}
            onDragEnd={() => setOver(null)}>⠿</span>}<i style={{ background: EFFECT_COLORS[item.effect] }} title={item.effect} />{field(item.label, 60, "Transformation", label => change({ label }), "compose-tag-name")}<span>{item.effect}</span>
            {item.pen && <span className="compose-tag-pen" title="Drawn with this pen"><i style={{ background: item.pen.color }} />{item.pen.name}</span>}
            {onEdit && <button type="button" className="compose-tag-remove" title="Delete this transformation" aria-label={`Delete ${item.label}`} onClick={() => {
              patch(tag => ({ ...tag, transformations: tag.transformations.filter((_, at) => at !== i) }));
              const mine = (key: string) => key.startsWith(`${shown.id}:`); setBefore(current => Object.fromEntries(Object.entries(current).filter(([key]) => !mine(key)))); setRequests(current => Object.fromEntries(Object.entries(current).filter(([key]) => !mine(key)))); }}>×</button>}</div>
          {field(item.how, 200, "How it changes", how => change({ how }), "", true)}
          {(found => found.length > 0 && <div className="compose-tag-examples">{found.map(example => <button key={example.id} type="button" className="compose-tag-example"
            title={`Minimal example “${example.name}”${example.hidden ? " (hidden): show it and go there" : ": go there"}`} onClick={() => onExample?.(example.id)}>
            {example.thumbnail ? <img src={example.thumbnail} alt="" /> : <span className="compose-tag-example-empty">{example.hidden ? "hidden" : "no picture yet"}</span>}
            <span>{example.name}</span></button>)}</div>)(examples?.(item.pen) ?? [])}
          {item.properties.length > 0 && <table><tbody>{item.properties.map((property, j) => {
            const set = (next: Partial<typeof property>) => change({ properties: item.properties.map((entry, at) => at === j ? { ...entry, ...next } : entry) });
            return <tr key={j}><th>{field(property.label, 60, "Property", label => set({ label }))}</th><td className="value">{field(property.value, 60, "Value", value => set({ value }))}</td>
              <td>{field(property.how, 160, "What it does", how => set({ how }), "", true)}</td>
              {onEdit && <td className="remove"><button type="button" className="compose-tag-remove" title="Delete this property" aria-label={`Delete ${property.label}`} onClick={() => change({ properties: item.properties.filter((_, at) => at !== j) })}>×</button></td>}</tr>; })}</tbody></table>}
          {onEdit && item.properties.length < MAX_TAG_PROPERTIES && <button type="button" className="compose-tag-add small" title="Add a property to this transformation"
            onClick={() => change({ properties: [...item.properties, { label: "", value: "", how: "" }] })}>+ Property</button>}
          {onRevise && (() => {
            const key = `${shown.id}:${i}`, request = requests[key] ?? "", working = pending === key, old = before[key];
            const send = () => { if (!request.trim() || busy) return; setBefore(current => ({ ...current, [key]: item })); setPending(key); onRevise(shown.id, i, request.trim()); };
            return <form className={`compose-tag-revise ${working ? "working" : ""}`} onSubmit={e => { e.preventDefault(); send(); }}>
              <textarea className="compose-tag-request" value={request} maxLength={500} rows={1} disabled={working} aria-label={`Change ${item.label}`}
                placeholder={working ? "Changing…" : "Change this: e.g. make it fade toward the end, twice as strong…"}
                onChange={e => { const value = e.currentTarget.value; setRequests(current => ({ ...current, [key]: value })); }}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} />
              <button type="submit" disabled={busy || !request.trim()}>{working ? "Changing…" : "Change"}</button>
              {old && !working && JSON.stringify(old) !== JSON.stringify(item) && onEdit && <button type="button" className="compose-tag-undo" title={`Back to “${old.label}”`}
                onClick={() => { patch(tag => ({ ...tag, transformations: tag.transformations.map((entry, at) => at === i ? old : entry) })); setBefore(current => { const next = { ...current }; delete next[key]; return next; }); }}>Undo</button>}
            </form>; })()}
        </li>; })}</ul> : <p className="compose-tag-none">{children.length ? "None of its own: what changes is in the tags it contains." : "None: it is drawn as it is."}</p>}
        {onEdit && shown.transformations.length < MAX_TAG_TRANSFORMATIONS && <button type="button" className="compose-tag-add" title="Add a transformation (fill it in, or write below it how it should change and press Change)"
          onClick={() => patch(tag => ({ ...tag, transformations: [...tag.transformations, emptyTransformation()] }))}>+ Transformation</button>}
        {stale && <p className="compose-tag-stale">The sketch changed after these tags were made. Compose uses them as they are; Regenerate to read the sketch again.</p>}
      </div>; })(), document.body)}
  </div>;
}
