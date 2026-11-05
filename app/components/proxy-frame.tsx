import { useEffect, useRef, useState } from "react";
import { proxyDocument, proxyTint, type ProxyCell, type ProxySection } from "../lib/proxy-runtime";
import { CELL_HEADER, handleLeaves, handleSpecs, handleTransformations, proxyGroups, proxySections } from "../lib/scene/handles";
import type { ScalarValue, SceneNode, SemanticTransformation } from "../lib/scene/schema";
import { Icon } from "./icons";

type PreviewProps = { cells: ProxyCell[]; /** Each transformation's section around its widgets. */ sections?: ProxySection[];
  /** The proxy frame's board id: pressing outside the widgets (cell titles, gaps) drags the frame. */
  frameId?: string;
  /** A widget set one of its property's scalars (path "a/b"; "" = the property's own value). */
  onSet: (propertyId: string, path: string[], value: ScalarValue["value"]) => void;
  /** A widget failed (null: the whole frame). */
  onError: (propertyId: string | null, message: string) => void };

/**
 * Runs a proxy frame's widgets in an isolated iframe. It reloads only when the
 * widgets themselves (code, names, layout) change; new values are sent in.
 */
export function ProxyPreview({ cells, sections = [], frameId, onSet, onError }: PreviewProps) {
  const frame = useRef<HTMLIFrameElement>(null), token = useRef(""), ready = useRef(false);
  const current = useRef({ cells, sections, onSet, onError }); current.current = { cells, sections, onSet, onError };
  const [document, setDocument] = useState("");
  const structure = JSON.stringify([cells.map(cell => [cell.id, cell.label, cell.hint, cell.effect, cell.box, cell.code, Object.keys(cell.specs)]), sections]);
  const values = JSON.stringify(Object.fromEntries(cells.map(cell => [cell.id, cell.specs])));
  const sendValues = () => { if (ready.current) frame.current?.contentWindow?.postMessage({ channel: "rulegen-proxy-control", token: token.current, type: "values", cells: JSON.parse(values) }, "*"); };
  useEffect(sendValues, [values]);
  useEffect(() => {
    const next = crypto.randomUUID(); token.current = next; ready.current = false;
    setDocument(proxyDocument(next, window.location.origin, current.current.cells, current.current.sections));
    const receive = (event: MessageEvent) => {
      const data = event.data;
      if (event.source !== frame.current?.contentWindow || data?.channel !== "rulegen-proxy" || data.token !== next) return;
      if (data.type === "ready") { ready.current = true; sendValues(); return; }
      const cell = current.current.cells.find(item => item.id === data.id);
      if (data.type === "set" && cell && typeof data.path === "string" && data.path in cell.specs && ["number", "string", "boolean"].includes(typeof data.value))
        current.current.onSet(cell.id, data.path ? data.path.split("/") : [], data.value);
      if (data.type === "error" && typeof data.error === "string") current.current.onError(cell ? cell.id : null, data.error.slice(0, 300));
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [structure]);
  // Input goes through layers over the iframe and is posted in: a sandboxed iframe is not always hit by the pointer (e.g. right after the board moves).
  // There is one layer per widget; the rest of the stage (cell titles, gaps) moves the frame on the board.
  const forward = (kind: "down" | "move" | "up" | "leave", e: React.PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.parentElement!.getBoundingClientRect();
    if (ready.current) frame.current?.contentWindow?.postMessage({ channel: "rulegen-proxy-control", token: token.current, type: "pointer", kind, x: (e.clientX - box.left) * 900 / box.width, y: (e.clientY - box.top) * 600 / box.height }, "*");
  };
  return <div className="proxy-stage">
    <iframe ref={frame} className="proxy-engine" title="Direct manipulation proxy" sandbox="allow-scripts" srcDoc={document} tabIndex={-1} />
    {frameId && <div className="proxy-move" data-frame-handle={frameId} title="Drag to move this proxy frame" />}
    {cells.map(cell => <div key={cell.id} className="proxy-input" aria-label={`${cell.label} handle`}
      style={{ left: `${cell.box.x / 9}%`, top: `${(cell.box.y + CELL_HEADER) / 6}%`, width: `${cell.box.w / 9}%`, height: `${(cell.box.h - CELL_HEADER) / 6}%` }}
      onPointerDown={e => { if (e.button !== 0) return; e.currentTarget.setPointerCapture(e.pointerId); forward("down", e); }}
      onPointerMove={e => forward("move", e)} onPointerUp={e => forward("up", e)} onPointerCancel={e => forward("up", e)} onPointerLeave={e => forward("leave", e)} />)}
  </div>;
}

/**
 * What a proxy frame runs: properties with a handle (state values applied), one section per transformation —
 * only `only`'s for a transformation's own frame, which then has the whole frame — each numbered among the
 * node's transformations that have widgets (the same number and color in every frame of the node).
 */
export function proxyLayoutFor(transformations: SemanticTransformation[], only?: string): { cells: ProxyCell[]; sections: ProxySection[] } {
  const all = proxyGroups(transformations), numbers = new Map(all.map((group, i) => [group.transformation.id, i + 1]));
  const groups = only ? all.filter(group => group.transformation.id === only) : all, layout = proxySections(groups.map(group => group.properties.length));
  return {
    sections: groups.map((group, i) => ({ id: group.transformation.id, label: group.transformation.label, box: layout[i].box, number: numbers.get(group.transformation.id)! })),
    cells: groups.flatMap((group, i) => group.properties.map((property, k) => {
      const handle = property.handle!, specs = handleSpecs(property);
      return { id: property.id, label: property.label, hint: handle.hint, effect: property.effect, box: layout[i].cells[k], code: handle.prepared,
        specs: Object.fromEntries(handle.paths.map(path => path.join("/")).filter(key => key in specs).map(key => [key, specs[key]])) };
    })),
  };
}
export const proxyCellsFor = (transformations: SemanticTransformation[], only?: string) => proxyLayoutFor(transformations, only).cells;
/** A transformation's number and colors in its node's proxy frames (null: it has no widgets). */
export function proxyNumber(transformations: SemanticTransformation[], transformationId: string | undefined) {
  const number = proxyGroups(transformations).findIndex(group => group.transformation.id === transformationId) + 1;
  return number ? { number, tint: proxyTint(number) } : null;
}
/** A transformation still has a property a widget could drive but has none yet. */
const lacksHandles = (item: SemanticTransformation) => item.properties.some(property => handleLeaves(property).length > 0 && !property.handle);

type Sibling = { id: string; transformationId?: string; hidden?: boolean };
/**
 * A proxy frame's header: one chip per frame of its node (each a transformation, in its color and number): it
 * shows or hides that frame on the board (this frame's is marked). A transformation without widgets is a dashed
 * chip that designs them. Then hide/show every frame of the node, and design every transformation still missing.
 */
export function ProxyFrameBar({ node, transformations, current, siblings, busy, onHide, onDesign, onDesignAll, onRedesignAll }: { node: SceneNode | undefined; transformations: SemanticTransformation[];
  current: string; siblings: Sibling[]; busy: boolean; onHide: (ids: string[], hide: boolean) => void; onDesign: (transformationId: string) => void; onDesignAll: () => void;
  /** Make every handle of the node again. */ onRedesignAll?: () => void }) {
  if (!node) return null;
  const framed = siblings.flatMap(frame => { const item = transformations.find(entry => entry.id === frame.transformationId), at = proxyNumber(transformations, frame.transformationId); return item && at ? [{ frame, item, ...at }] : []; });
  const missing = handleTransformations(node).filter(lacksHandles), shown = siblings.filter(frame => !frame.hidden);
  return <span className="proxy-bar" role="group" aria-label={`Proxy frames of ${node.name}`}>
    {framed.map(({ frame, item, number, tint: [fill, line, ink] }) => { const off = Boolean(frame.hidden), here = frame.id === current;
      return <button key={frame.id} className={`proxy-chip${off ? " off" : ""}${here ? " here" : ""}`} aria-pressed={!off} style={{ background: off ? undefined : fill, borderColor: line, color: ink }}
        title={`${off ? "Show" : "Hide"} the proxy frame of ${item.label}${here ? " (this frame)" : ""}`} onClick={e => { e.stopPropagation(); onHide([frame.id], !off); }}>
        <Icon name={off ? "eye-off" : "eye"} size={11} /><b>{number}</b>{item.label}</button>; })}
    {missing.filter(item => !framed.some(entry => entry.item.id === item.id)).map(item => <button key={item.id} className="proxy-chip todo" disabled={busy}
      title={`AI makes a direct manipulation interface for each property of ${item.label}`} onClick={e => { e.stopPropagation(); onDesign(item.id); }}>+ {item.label}</button>)}
    {siblings.length > 1 && <button className="proxy-chip all" title={`Hide every proxy frame of ${node.name} (the handles are kept; show them again from the target frame)`} onClick={e => { e.stopPropagation(); onHide(shown.map(frame => frame.id), true); }}><Icon name="eye-off" size={11} />Hide all</button>}
    {missing.length > 1 && <button className="proxy-chip all" disabled={busy} title={`AI makes handles for every transformation still without them (${missing.length}), one request each`} onClick={e => { e.stopPropagation(); onDesignAll(); }}><Icon name="spark" size={11} />Design all ({missing.length})</button>}
    {onRedesignAll && framed.length > 0 && <button className="proxy-chip all" disabled={busy} title={`AI makes every handle of ${node.name} again (${framed.length} transformation(s)), one request each, seeing the current widgets; undo takes each back`} onClick={e => { e.stopPropagation(); onRedesignAll(); }}><Icon name="spark" size={11} />Redesign all</button>}
  </span>;
}

type FrameProps = { /** The proxy frame's board id (to drag it by its body). */ frameId?: string; node: SceneNode | undefined; transformations: SemanticTransformation[]; targetName: string; busy: string; /** Using the frame works on its node (its frame active, the node selected). */ onActivate?: () => void;
  /** The target's code keeps what it made from input with the values of that moment: offer to update it so values adjust in place. */
  bakedInput?: { onUpdate: () => void };
  onSet: PreviewProps["onSet"]; onError: PreviewProps["onError"];
  /** Design the widgets of one transformation (a property's own is designed from its card). */
  onDesign: (transformationId: string) => void;
  /** The transformation this frame runs (none: the node's, by transformation). */
  only?: string;
  /** Design every transformation still without widgets. */
  onDesignAll?: () => void };
/** A proxy frame's content: the widgets of its transformation (or node), or what to do when there are none. */
export function ProxyFrame({ frameId, node, transformations, targetName, busy, onSet, onError, onDesign, onActivate, bakedInput, only, onDesignAll }: FrameProps) {
  if (!node) return <div className="proxy-frame-surface" data-frame-handle={frameId}><div className="frame-empty"><Icon name="target" size={30} /><strong>The target node is gone.</strong><span>This node was deleted from {targetName}. You can delete this proxy frame.</span></div></div>;
  const { cells, sections } = proxyLayoutFor(transformations, only), designable = handleTransformations(node).filter(item => !only || item.id === only);
  const own = only ? transformations.find(item => item.id === only) : undefined;
  // Without widgets the whole surface (but its button) moves the frame.
  return <div className="proxy-frame-surface" data-frame-handle={cells.length ? undefined : frameId} onPointerDownCapture={onActivate}>
    {cells.length ? <ProxyPreview cells={cells} sections={sections} frameId={frameId} onSet={onSet} onError={onError} />
      : <div className="frame-empty"><Icon name="target" size={30} /><strong>Proxy frame for {own ? `${node.name} · ${own.label}` : node.name}</strong>
        <span>{only ? `This transformation has no handles now. ` : ""}For each property, the AI builds a direct manipulation interface that fits its meaning. Each transformation gets its own proxy frame, kept together in a group. Manipulating it changes the result in {targetName} right away.</span>
        <div className="proxy-design-list">{designable.map(item => <button key={item.id} disabled={Boolean(busy)} title={`AI makes a direct manipulation interface for each property of ${item.label}`} onClick={() => onDesign(item.id)}>
          <Icon name="spark" size={14} />Design <b>{item.label}</b></button>)}
          {onDesignAll && designable.length > 1 && <button className="primary" disabled={Boolean(busy)} title={`AI makes handles for all ${designable.length} transformations, one request each`} onClick={onDesignAll}>
            <Icon name="spark" size={14} />Design all <b>{designable.length}</b></button>}</div></div>}
    {bakedInput && cells.length > 0 && !busy && <div className="proxy-notice" role="note"><span>The code of {targetName} stores the values at the time into results made from input, so changing a value replays the input from the start and redraws. To adjust already-drawn results in place, update the code.</span>
      <button onClick={bakedInput.onUpdate}><Icon name="code" size={12} />Update code to adjust in place</button></div>}
    {busy && <div className="proxy-busy" role="status"><span className="loading-spinner" />{busy}</div>}
  </div>;
}
