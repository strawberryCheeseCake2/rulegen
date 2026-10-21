import { useState } from "react";
import type { Algorithm, AlgorithmCall, ScalarValue, Value } from "../../lib/scene/schema";
import type { SlotChoice } from "../../lib/scene/panel-ops";
import { ALGORITHM_DRAG_TYPE, readAlgorithmDrag, type AlgorithmClip } from "../../lib/scene/transfer";
import { findAlgorithm } from "../../lib/scene/algorithms";
import { isAlgorithm } from "../../lib/scene/values";
import { Icon } from "../icons";
import { ScalarWidget } from "./scalar-widget";
import type { MenuItem } from "./context-menu";

// Properties are sockets; algorithms are blocks that can be dropped into any
// socket (from the block palette or another socket), copied, pasted or swapped.

export type SocketActions = {
  library: Algorithm[]; clip: AlgorithmClip | null;
  /** Structural changes (plugging, unplugging) are disabled while editing a state. */
  allowSwap: boolean;
  onScalar: (path: string[], value: ScalarValue["value"]) => void;
  onSwap: (path: string[], choice: SlotChoice) => void;
  onCopy: (path: string[]) => void;
  onPaste: (path: string[], dropped?: AlgorithmClip) => void;
  /** The block plugged at `path`, as something that can be dragged elsewhere. */
  clipFor: (path: string[]) => AlgorithmClip | null;
  openMenu: (event: React.MouseEvent, items: MenuItem[], title?: string) => void;
};
type SocketProps = SocketActions & { value: Value; label: string; path: string[]; depth?: number; root?: boolean };

/** Hue per algorithm id, so the same block looks the same wherever it is plugged in. */
export function blockHue(id: string) { let hash = 0; for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) % 360; return hash; }
export const blockStyle = (id: string) => ({ "--block-hue": blockHue(id) }) as React.CSSProperties;
export function dragBlock(event: React.DragEvent, clip: AlgorithmClip | null) {
  event.stopPropagation();
  if (!clip) { event.preventDefault(); return; }
  event.dataTransfer.setData(ALGORITHM_DRAG_TYPE, JSON.stringify(clip));
  event.dataTransfer.setData("text/plain", clip.label);
  event.dataTransfer.effectAllowed = "copy";
}

function pasteItem(props: SocketProps): MenuItem[] {
  if (!props.clip) return [{ label: "Paste block", disabled: true, hint: "Copy a block first", onSelect: () => {} }];
  return [{ label: `Paste “${props.clip.label}” block here`, disabled: !props.allowSwap, hint: props.allowSwap ? undefined : "Base only", onSelect: () => props.onPaste(props.path) }];
}

function SwapMenu(props: SocketProps) {
  const { value, library, path, depth = 0 } = props;
  if (!props.allowSwap || !(value.type === "number" || isAlgorithm(value))) return null;
  const current = isAlgorithm(value) ? value.algorithmId : "number";
  return <select className="slot-kind" aria-label={`${props.label} slot`} title="Swap the block in this socket" value={`plug:${current}`}
    onChange={e => { const id = e.target.value.slice(5); props.onSwap(path, id === "number" ? { type: "number" } : { type: "algorithm", algorithmId: id }); }}>
    <option value="plug:number">123 Number</option>
    {library.map(algorithm => <option key={algorithm.id} value={`plug:${algorithm.id}`} disabled={depth >= 3 && current !== algorithm.id}>ƒ {algorithm.name}</option>)}
  </select>;
}

/** A plugged-in algorithm block; its arguments are sockets again. */
function AlgorithmBlock(props: SocketProps & { value: AlgorithmCall }) {
  const { value, path, library, depth = 0 } = props;
  const algorithm = findAlgorithm(library, value.algorithmId), name = algorithm?.name || value.algorithmId;
  const menu = (event: React.MouseEvent) => props.openMenu(event, [
    { label: "Copy block", hint: "with its arguments", onSelect: () => props.onCopy(path) },
    ...pasteItem(props),
    "separator",
    { label: "Unplug (use a number)", disabled: !props.allowSwap, onSelect: () => props.onSwap(path, { type: "number" }) },
  ], name);
  return <div className={`algorithm-block depth-${Math.min(depth, 3)}`} style={blockStyle(value.algorithmId)} onContextMenu={menu} data-algorithm-id={value.algorithmId}>
    <div className="algorithm-block-header" draggable title="Drag this block into another socket" onDragStart={event => dragBlock(event, props.clipFor(path))}>
      <span className="block-grip" aria-hidden="true">⠿</span>
      <span className="algorithm-badge">ƒ</span>
      <strong title={algorithm?.description}>{name}</strong>
      <button aria-label={`Copy ${name} block`} title="Copy block" onClick={() => props.onCopy(path)}><Icon name="copy" size={12} /></button>
      <button aria-label={`More actions for ${name}`} title="More" onClick={menu}>⋯</button>
    </div>
    <div className="algorithm-block-body">
      {algorithm?.description && <details className="implementation-details"><summary>How it works</summary><p>{algorithm.description}</p></details>}
      {value.args.map(arg => {
        const param = algorithm?.params.find(item => item.id === arg.id);
        return <ValueSocket key={arg.id} {...props} value={arg.value} label={param?.label || arg.id} path={[...path, arg.id]} depth={depth + 1} root={false} />;
      })}
      {!value.args.length && <p className="algorithm-call-empty">No parameters</p>}
    </div>
  </div>;
}

/** A property or argument slot. Number and algorithm sockets accept dropped blocks. */
export function ValueSocket(props: SocketProps) {
  const { value, label, path, root } = props;
  const [over, setOver] = useState(false);
  const accepts = props.allowSwap && (value.type === "number" || isAlgorithm(value));
  const dragOver = (event: React.DragEvent) => {
    if (!accepts || !event.dataTransfer.types.includes(ALGORITHM_DRAG_TYPE)) return;
    event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = "copy"; setOver(true);
  };
  const drop = (event: React.DragEvent) => {
    setOver(false);
    const clip = accepts ? readAlgorithmDrag(event.dataTransfer) : null;
    if (!clip) return;
    event.preventDefault(); event.stopPropagation(); props.onPaste(path, clip);
  };
  return <div className={`value-socket ${root ? "socket-root" : "socket-arg"} ${accepts ? "accepts-blocks" : ""} ${over ? "socket-over" : ""}`}
    onDragOver={dragOver} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setOver(false); }} onDrop={drop}>
    <div className="value-socket-heading"><span>{root ? "SOCKET" : label}</span><SwapMenu {...props} /></div>
    {isAlgorithm(value) ? <AlgorithmBlock {...props} value={value} />
      : <div className="socket-scalar" onContextMenu={event => props.openMenu(event, pasteItem(props), label)}>
        <ScalarWidget value={value} label={label} onChange={raw => props.onScalar(path, raw)} />
        {accepts && <span className="socket-hint">drop a ƒ block to replace</span>}
      </div>}
  </div>;
}
