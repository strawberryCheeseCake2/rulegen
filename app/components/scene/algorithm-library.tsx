import type { Algorithm, Scene } from "../../lib/scene/schema";
import type { AlgorithmClip } from "../../lib/scene/transfer";
import { sceneAlgorithmUsage } from "../../lib/scene/algorithms";
import { describeValue } from "../../lib/scene/values";
import { Icon } from "../icons";
import { useContextMenu } from "./context-menu";
import { blockStyle, dragBlock } from "./value-editor";

export type AlgorithmSource = { key: string; label: string; algorithm: Algorithm };
type Props = {
  scene: Scene; busy: boolean; targetName: string | null; imports: AlgorithmSource[];
  onEdit: (id: string, patch: { name?: string; description?: string }) => void;
  onUse: (id: string) => void; onImport: (key: string) => void; onCopy: (id: string) => void;
  clipFor: (id: string) => AlgorithmClip;
};

/**
 * The sketch's algorithm blocks. They are independent of properties: drag one
 * into any socket, right-click to copy it, or open it to edit the shared definition.
 */
export function AlgorithmLibrary({ scene, busy, targetName, imports, onEdit, onUse, onImport, onCopy, clipFor }: Props) {
  const [menu, openMenu] = useContextMenu();
  const usage = sceneAlgorithmUsage(scene);
  const nodeName = (id: string) => scene.nodes.find(node => node.id === id)?.name || id;
  const names = (id: string) => scene.algorithms.find(algorithm => algorithm.id === id)?.name || id;
  return <section className="block-palette" aria-label="Algorithm blocks">{menu}
    <header className="block-palette-header"><Icon name="function" size={14} /><strong>Algorithm blocks</strong><span>{scene.algorithms.length}</span></header>
    <p className="algorithm-library-help">블록을 끌어 아무 property 소켓에나 끼우세요. 우클릭으로 복사해 다른 property·스케치에 붙여넣을 수도 있습니다. 블록 정의를 고치면 끼워진 모든 곳에 반영됩니다.</p>
    {!scene.algorithms.length && <p className="empty-panel">No blocks yet. Decompose a sketch first.</p>}
    <div className="block-palette-list">{scene.algorithms.map(algorithm => {
      const uses = [...new Set((usage.get(algorithm.id) || []).map(use => nodeName(use.nodeId)))];
      return <details key={algorithm.id} className="palette-block" style={blockStyle(algorithm.id)} onContextMenu={event => openMenu(event, [
        { label: "Copy block", hint: "default arguments", onSelect: () => onCopy(algorithm.id) },
        { label: targetName ? `Plug into ${targetName} as new property` : "Plug into a node", disabled: busy || !targetName, onSelect: () => onUse(algorithm.id) },
      ], algorithm.name)}>
        <summary className="palette-block-header" draggable={!busy} title="Drag into a property socket" onDragStart={event => dragBlock(event, clipFor(algorithm.id))}>
          <span className="block-grip" aria-hidden="true">⠿</span><span className="algorithm-badge">ƒ</span><strong>{algorithm.name}</strong>
          <small>{algorithm.params.length} in · {uses.length ? `${uses.length} use${uses.length > 1 ? "s" : ""}` : "unused"}</small>
        </summary>
        <div className="palette-block-body">
          <input aria-label={`Algorithm ${algorithm.id} name`} maxLength={100} value={algorithm.name} disabled={busy} onChange={e => { if (e.target.value.trim()) onEdit(algorithm.id, { name: e.target.value }); }} />
          <textarea aria-label={`Algorithm ${algorithm.id} description`} maxLength={1500} rows={3} value={algorithm.description} disabled={busy} onChange={e => onEdit(algorithm.id, { description: e.target.value })} />
          <ul className="algorithm-params">{algorithm.params.map(param => <li key={param.id}><strong>{param.label}</strong><span>{describeValue(param.value, names)}</span></li>)}</ul>
          <div className="algorithm-usage">{uses.length ? `Plugged into ${uses.join(", ")}` : "Not plugged anywhere · alternative"}</div>
          <div className="algorithm-actions">
            <button disabled={busy || !targetName} onClick={() => onUse(algorithm.id)}><Icon name="plus" size={12} />{targetName ? `Plug into ${targetName}` : "Plug into node"}</button>
            <button onClick={() => onCopy(algorithm.id)}><Icon name="copy" size={12} />Copy</button>
          </div>
        </div>
      </details>;
    })}</div>
    {imports.length > 0 && <label className="add-property algorithm-import"><span>BLOCKS FROM OTHER SKETCHES & PENS</span>
      <select aria-label="Import algorithm" value="" disabled={busy} onChange={e => { if (e.target.value) onImport(e.target.value); }}>
        <option value="">Bring a block into this sketch…</option>{imports.map(item => <option key={item.key} value={item.key}>{item.label} · {item.algorithm.name}</option>)}
      </select></label>}
  </section>;
}
