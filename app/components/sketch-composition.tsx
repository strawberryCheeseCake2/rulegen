import type { Artwork } from "../lib/schema";
import { Icon } from "./icons";
import { Fragment, useState } from "react";
import { draggedConstraint, MAX_COMPOSE_TAGS, TAG_CONSTRAINT_DRAG, tagTree, type ComposeTag, type TagConstraintAt } from "../lib/compose-tags";
import { EFFECT_COLORS } from "./compose-tags";
export function SketchComposition({ artwork, prompt, onPrompt, onDraft, onCompose, busy, drafting, tags = 0, showTags = true, onShowTags, withText = true, onWithText, tagsStale = false, tagList = [], openTag = null, onPickTag, onHoverTag, canMoveTag, onMoveTag, onDeleteTag, onAddTag, onMoveConstraint, clarifyFirst, onClarifyFirst }: { artwork: Artwork;
  /** Whether Compose asks the user to clarify the sketch first. */
  clarifyFirst?: boolean; onClarifyFirst?: (on: boolean) => void; prompt: string; onPrompt: (value: string) => void; onDraft: () => void; onCompose: () => void; busy: boolean; drafting: boolean;
  /** How many tags the AI put on the sketch with the prompt, and whether they show. */
  tags?: number; showTags?: boolean; onShowTags?: (on: boolean) => void;
  /** Whether Compose uses the text prompt (off: the tags on the sketch alone), and whether the tags are older than the sketch. */
  withText?: boolean; onWithText?: (on: boolean) => void; tagsStale?: boolean;
  /** The tags, shown as their containment tree: picking one opens its card on the sketch, pointing at one outlines it there. */
  tagList?: ComposeTag[]; openTag?: string | null; onPickTag?: (id: string) => void; onHoverTag?: (id: string | null) => void;
  /** Changing the tags' structure: drag a row onto a collection (or the top), delete a row, add one. */
  canMoveTag?: (id: string, parentId: string) => boolean; onMoveTag?: (id: string, parentId: string) => void; onDeleteTag?: (id: string) => void; onAddTag?: (kind: ComposeTag["kind"]) => void;
  /** Moving a constraint (dragged from the tree or a tag card) to a tag: before its constraint `before`, or at its end. */
  onMoveConstraint?: (from: TagConstraintAt, to: string, before?: number) => void }) {
  const [dragging, setDragging] = useState<string | null>(null), [over, setOver] = useState<string | null>(null);
  const dropParent = (target: ComposeTag | null) => !target ? "" : target.kind === "collection" ? target.id : target.parentId;
  const droppable = (target: ComposeTag | null) => Boolean(dragging && dragging !== target?.id && canMoveTag?.(dragging, dropParent(target)));
  // A dragged constraint goes into the tag dropped on (at its end), or before the constraint dropped on.
  const carrying = (e: React.DragEvent) => Boolean(onMoveConstraint && e.dataTransfer.types.includes(TAG_CONSTRAINT_DRAG));
  const drop = (target: ComposeTag | null, key: string, before?: number) => ({
    onDragOver: (e: React.DragEvent) => {
      if (target && carrying(e)) { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "move"; setOver(before === undefined ? key : `${key}:${before}`); return; }
      if (before !== undefined || !droppable(target)) return; e.preventDefault(); e.dataTransfer.dropEffect = "move"; setOver(key);
    },
    onDragLeave: () => setOver(current => current === key || current === `${key}:${before}` ? null : current),
    onDrop: (e: React.DragEvent) => {
      const from = target && carrying(e) ? draggedConstraint(e.dataTransfer) : null;
      if (from) { e.preventDefault(); e.stopPropagation(); onMoveConstraint!(from, target!.id, before); setOver(null); return; }
      if (before !== undefined || !droppable(target)) return; e.preventDefault(); onMoveTag?.(dragging!, dropParent(target)); setDragging(null); setOver(null);
    },
  });
  const pens = [...new Map(artwork.strokes.filter(s => s.semanticPen && s.tool !== "eraser").map(s => [s.semanticPen!.id, s.semanticPen!])).values()];
  const pencils = artwork.strokes.filter(s => s.tool === "pen" && !s.semanticPen).length;
  return <section className="semantic-composition-panel" aria-label="Compose sketch marks">
    <div className="composition-heading"><Icon name="spark" size={15} /><strong>Compose your sketch</strong></div>
    <p>The AI reads the sketch and the constraint each pen carries to write a prompt. Review or edit the description, then compose.</p>
    <div className="composition-legend">{pens.map((pen, i) => <span key={i} title={pen.meaning}><i style={{ background: pen.color }} />{pen.name}</span>)}{pencils > 0 && <span>Pencil · {pencils} strokes</span>}</div>
    {onWithText && <label className="composition-tags-toggle" title="Off: Compose reads the tags on the sketch (objects, collections, their constraints and params) and no text">
      <input type="checkbox" checked={withText} onChange={e => onWithText(e.currentTarget.checked)} />Use the text prompt</label>}
    <button className="alternative-button" disabled={busy || !(artwork.strokes.length || artwork.photo)} onClick={onDraft}>{drafting ? "Reading the sketch…" : withText ? (prompt.trim() ? "Regenerate AI prompt" : "Generate AI prompt") : tags ? "Regenerate tags" : "Generate tags"}<Icon name="spark" size={15} /></button>
    {tags > 0 && onShowTags && <label className="composition-tags-toggle" title="Tags on the sketch: the objects and collections the AI read. Click a tag on the sketch to see its constraints and params.">
      <input type="checkbox" checked={showTags} onChange={e => onShowTags(e.currentTarget.checked)} />Show tags on the sketch ({tags})</label>}
    {(tagList.length > 0 || (!withText && onAddTag)) && <div className="composition-tag-tree" aria-label="Tags and what they contain" onPointerLeave={() => onHoverTag?.(null)}>
      <span>TAGS · WHAT CONTAINS WHAT</span>
      {tagTree(tagList).map(({ tag, depth }) => <Fragment key={tag.id}><div className={`composition-tag-row ${tag.kind} ${openTag === tag.id ? "open" : ""} ${over === tag.id ? "drop" : ""} ${dragging === tag.id ? "dragging" : ""}`}
        draggable={Boolean(onMoveTag)} onDragStart={e => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", tag.label); setDragging(tag.id); }} onDragEnd={() => { setDragging(null); setOver(null); }} {...drop(tag, tag.id)}>
        <button type="button" style={{ paddingLeft: 6 + depth * 14 }}
          title={`${tag.kind === "collection" ? "Collection" : "Object"} “${tag.label}”${tag.constraints.length ? ` · ${tag.constraints.map(item => item.label).join(", ")}` : ""}: open its card on the sketch. Drag it onto a collection to put it inside.`}
          onClick={() => onPickTag?.(tag.id)} onPointerEnter={() => onHoverTag?.(tag.id)}>
          {depth > 0 && <b aria-hidden>└</b>}<i aria-hidden>{tag.kind === "collection" ? "▦" : "●"}</i><strong>{tag.label}</strong>
          <small>{tag.kind === "collection" ? `collection${tagList.some(child => child.parentId === tag.id) ? ` · ${tagList.filter(child => child.parentId === tag.id).length} inside` : ""}` : "object"}</small>
        </button>
        {onDeleteTag && <button type="button" className="composition-tag-delete" title={`Delete “${tag.label}”${tagList.some(child => child.parentId === tag.id) ? " (what it holds goes up a level)" : ""}`} aria-label={`Delete ${tag.label}`} onClick={() => onDeleteTag(tag.id)}>×</button>}
      </div>
      {/* Its params: each constraint with the quantities it is done with. */}
      {tag.constraints.length > 0 && <ul className="composition-tag-params" style={{ paddingLeft: 26 + depth * 14 }} aria-label={`Params of ${tag.label}`}>
        {tag.constraints.map((item, i) => <li key={i} className={over === `${tag.id}:${i}` ? "drop" : ""} draggable={Boolean(onMoveConstraint)}
          onDragStart={e => { e.stopPropagation(); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData(TAG_CONSTRAINT_DRAG, JSON.stringify({ tagId: tag.id, index: i })); e.dataTransfer.setData("text/plain", item.label); }}
          onDragEnd={() => setOver(null)} {...drop(tag, tag.id, i)}>
          <button type="button" title={`${item.how || item.label}${item.pen ? ` · ${item.pen.name}` : ""}: open the card on the sketch. Drag it onto a tag (or before another constraint) to move it there.`} onClick={() => onPickTag?.(tag.id)} onPointerEnter={() => onHoverTag?.(tag.id)}>
            <i className="composition-tag-effect" style={{ background: EFFECT_COLORS[item.effect] }} title={item.effect} /><span>{item.label || "Untitled constraint"}</span>
            {item.pen && <em style={{ borderColor: item.pen.color, color: item.pen.color }}>{item.pen.name}</em>}
          </button>
          {item.params.length > 0 && <div>{item.params.map((param, j) => <small key={j} title={param.how}>{param.label}{param.value ? <b>{param.value}</b> : null}</small>)}</div>}
        </li>)}
      </ul>}
      </Fragment>)}
      {dragging && <div className={`composition-tag-top ${over === "" ? "drop" : ""}`} {...drop(null, "")}>Drop here to put it at the top level</div>}
      {onAddTag && <div className="composition-tag-add">
        <button type="button" disabled={tagList.length >= MAX_COMPOSE_TAGS} title="Add a collection (inside the open collection, else at the top)" onClick={() => onAddTag("collection")}>+ Collection</button>
        <button type="button" disabled={tagList.length >= MAX_COMPOSE_TAGS} title="Add an object (inside the open collection, else at the top)" onClick={() => onAddTag("object")}>+ Object</button>
      </div>}
    </div>}
    {withText ? <>
      <label><span>COMPOSE PROMPT</span><textarea aria-label="Compose prompt" value={prompt} maxLength={2000} rows={7} placeholder="The AI fills this in from your sketch. Feel free to edit the description." onChange={e => onPrompt(e.target.value)} /></label>
      {!prompt.trim() && <p>Pressing Compose sketch fills in the AI prompt automatically first.</p>}
    </> : <p className="composition-tags-only">{!tags ? "Compose reads the tags on the sketch, not text. Pressing Compose sketch tags the sketch first."
      : tagsStale ? `The sketch changed after it was tagged. Compose uses the ${tags} tag${tags === 1 ? "" : "s"} as they are; Regenerate tags to read the sketch again.` : `Compose reads the ${tags} tag${tags === 1 ? "" : "s"} on the sketch, not text.`}</p>}
    {onClarifyFirst && <label className="composition-tags-toggle" title="Before composing, the AI asks about what is still ambiguous in the sketch (only what would change the result)">
      <input type="checkbox" checked={Boolean(clarifyFirst)} onChange={e => onClarifyFirst(e.currentTarget.checked)} />Clarify first</label>}
    <button className="primary-button" disabled={busy || !(artwork.strokes.length || artwork.photo)} onClick={onCompose}>Compose sketch<Icon name="spark" size={15} /></button>
  </section>;
}
