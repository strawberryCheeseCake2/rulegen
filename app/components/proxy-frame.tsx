import { useEffect, useRef, useState } from "react";
import { proxyDocument, type ProxyCell } from "../lib/proxy-runtime";
import { CELL_HEADER, handleSpecs, handleTransformations, proxyCells, proxyProperties } from "../lib/scene/handles";
import type { ScalarValue, SceneNode, SemanticTransformation } from "../lib/scene/schema";
import { Icon } from "./icons";

type PreviewProps = { cells: ProxyCell[];
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
export function ProxyPreview({ cells, frameId, onSet, onError }: PreviewProps) {
  const frame = useRef<HTMLIFrameElement>(null), token = useRef(""), ready = useRef(false);
  const current = useRef({ cells, onSet, onError }); current.current = { cells, onSet, onError };
  const [document, setDocument] = useState("");
  const structure = JSON.stringify(cells.map(cell => [cell.id, cell.label, cell.hint, cell.effect, cell.box, cell.code, Object.keys(cell.specs)]));
  const values = JSON.stringify(Object.fromEntries(cells.map(cell => [cell.id, cell.specs])));
  const sendValues = () => { if (ready.current) frame.current?.contentWindow?.postMessage({ channel: "rulegen-proxy-control", token: token.current, type: "values", cells: JSON.parse(values) }, "*"); };
  useEffect(sendValues, [values]);
  useEffect(() => {
    const next = crypto.randomUUID(); token.current = next; ready.current = false;
    setDocument(proxyDocument(next, window.location.origin, current.current.cells));
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

/** The cells a node's proxy frame runs: its properties with a handle (state values applied), laid out in a grid. */
export function proxyCellsFor(transformations: SemanticTransformation[]): ProxyCell[] {
  const properties = proxyProperties(transformations), boxes = proxyCells(properties.length);
  return properties.map((property, i) => {
    const handle = property.handle!, specs = handleSpecs(property);
    return { id: property.id, label: property.label, hint: handle.hint, effect: property.effect, box: boxes[i], code: handle.prepared,
      specs: Object.fromEntries(handle.paths.map(path => path.join("/")).filter(key => key in specs).map(key => [key, specs[key]])) };
  });
}

type FrameProps = { /** The proxy frame's board id (to drag it by its body). */ frameId?: string; node: SceneNode | undefined; transformations: SemanticTransformation[]; targetName: string; busy: string; /** Using the frame works on its node (its frame active, the node selected). */ onActivate?: () => void;
  /** The target's code keeps what it made from input with the values of that moment: offer to update it so values adjust in place. */
  bakedInput?: { onUpdate: () => void };
  onSet: PreviewProps["onSet"]; onError: PreviewProps["onError"];
  /** Design the widgets of one transformation (a property's own is designed from its card). */
  onDesign: (transformationId: string) => void };
/** A proxy frame's content: the node's widgets, or what to do when there are none. */
export function ProxyFrame({ frameId, node, transformations, targetName, busy, onSet, onError, onDesign, onActivate, bakedInput }: FrameProps) {
  if (!node) return <div className="proxy-frame-surface" data-frame-handle={frameId}><div className="frame-empty"><Icon name="target" size={30} /><strong>대상 노드가 없습니다.</strong><span>{targetName}에서 이 노드가 삭제되었습니다. 이 proxy frame을 지워도 됩니다.</span></div></div>;
  const cells = proxyCellsFor(transformations);
  // Without widgets the whole surface (but its button) moves the frame.
  return <div className="proxy-frame-surface" data-frame-handle={cells.length ? undefined : frameId} onPointerDownCapture={onActivate}>
    {cells.length ? <ProxyPreview cells={cells} frameId={frameId} onSet={onSet} onError={onError} />
      : <div className="frame-empty"><Icon name="target" size={30} /><strong>{node.name}의 proxy frame</strong>
        <span>property마다 그 의미에 맞는 direct manipulation 인터페이스를 AI가 만들어 여기에 놓습니다. 여기서 조작하면 {targetName}의 결과가 바로 바뀝니다. transformation 하나씩, 또는 property 카드의 ◎로 property 하나씩 만듭니다.</span>
        <div className="proxy-design-list">{handleTransformations(node).map(item => <button key={item.id} disabled={Boolean(busy)} title={`AI makes a direct manipulation interface for each property of ${item.label}`} onClick={() => onDesign(item.id)}>
          <Icon name="spark" size={14} />Design <b>{item.label}</b></button>)}</div></div>}
    {bakedInput && cells.length > 0 && !busy && <div className="proxy-notice" role="note"><span>{targetName}의 코드는 입력으로 만든 결과에 그때의 값을 저장해 둡니다. 그래서 값을 바꾸면 입력을 처음부터 다시 실행해 새로 그립니다. 이미 그린 결과가 그 자리에서 조절되게 하려면 코드를 업데이트하세요.</span>
      <button onClick={bakedInput.onUpdate}><Icon name="code" size={12} />Update code to adjust in place</button></div>}
    {busy && <div className="proxy-busy" role="status"><span className="loading-spinner" />{busy}</div>}
  </div>;
}
