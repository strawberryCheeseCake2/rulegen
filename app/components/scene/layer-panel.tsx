import { useState } from "react";
import type { Scene } from "../../lib/scene/schema";
import { descendantIds, layerTree } from "../../lib/scene/graph";
import { Icon } from "../icons";
import { NODE_DRAG_TYPE } from "../../lib/scene/transfer";

export type LayerPanelProps = {
  scene: Scene; sketchId: string; selected: string[]; hovered: string | null; busy: boolean; canUndo: boolean; canRedo: boolean; title: string;
  onSelect: (id: string | null, additive: boolean) => void; onHover: (id: string | null) => void;
  onRename: (id: string, name: string) => void; onToggleVisible: (id: string) => void;
  onGroup: () => void; onUngroup: (id: string) => void; onDelete: () => void;
  onMove: (id: string, parentId: string | null, beforeId: string | null) => void; onReorder: (id: string, direction: -1 | 1) => void;
  onAdd: (kind: "collection" | "object") => void; onUndo: () => void; onRedo: () => void;
  onExtract: () => void; canExtract: boolean;
};

export function LayerPanel(props: LayerPanelProps) {
  const { scene, selected, busy } = props;
  const [editing, setEditing] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const rows = layerTree(scene);
  const primary = scene.nodes.find(node => node.id === selected[0]);
  const drop = (event: React.DragEvent, parentId: string | null, beforeId: string | null) => {
    event.preventDefault(); event.stopPropagation();
    const id = event.dataTransfer.getData("text/rulegen-node") || dragging;
    if (!event.dataTransfer.types.includes("text/rulegen-node") && !dragging) return;
    setDragging(null);
    if (id && id !== parentId && !(parentId && descendantIds(scene, id).includes(parentId))) props.onMove(id, parentId, beforeId);
  };
  return <section className="layer-panel" aria-label="Brush stamps and objects">
    <header className="layer-panel-header"><Icon name="layers" size={15} /><strong>Layers</strong><span title={props.title}>{props.title}</span>
      <button aria-label="Undo layer change" title="Undo layer change" disabled={busy || !props.canUndo} onClick={props.onUndo}><Icon name="undo" size={13} /></button>
      <button aria-label="Redo layer change" title="Redo layer change" disabled={busy || !props.canRedo} onClick={props.onRedo}><Icon name="redo" size={13} /></button>
    </header>
    <div className="layer-toolbar" role="toolbar" aria-label="Layer actions">
      <button disabled={busy} title="New brush stamp" aria-label="New brush stamp" onClick={() => props.onAdd("collection")}><Icon name="collection" size={14} /><Icon name="plus" size={10} /></button>
      <button disabled={busy} title="New object" aria-label="New object" onClick={() => props.onAdd("object")}><Icon name="object" size={14} /><Icon name="plus" size={10} /></button>
      <button disabled={busy || !selected.length} title="Group selection into a brush stamp (⌘G)" aria-label="Group selection" onClick={props.onGroup}>Group</button>
      <button disabled={busy || primary?.kind !== "collection"} title="Ungroup brush stamp" aria-label="Ungroup brush stamp" onClick={() => primary && props.onUngroup(primary.id)}>Ungroup</button>
      <button disabled={busy || !primary} title="Move up" aria-label="Move layer up" onClick={() => primary && props.onReorder(primary.id, -1)}>↑</button>
      <button disabled={busy || !primary} title="Move down" aria-label="Move layer down" onClick={() => primary && props.onReorder(primary.id, 1)}>↓</button>
      <button disabled={busy || !selected.length} title="Delete selection" aria-label="Delete selected layers" onClick={props.onDelete}><Icon name="trash" size={13} /></button>
    </div>
    <div className="layer-list" role="tree" aria-label="Layer tree" aria-multiselectable="true" onDragOver={e => e.preventDefault()} onDrop={e => drop(e, null, null)} onClick={e => { if (e.target === e.currentTarget) props.onSelect(null, false); }}>
      {rows.map(({ node, depth }) => {
        const active = selected.includes(node.id);
        return <div key={node.id} role="treeitem" aria-selected={active} aria-level={depth + 1}
          className={`layer-row kind-${node.kind} ${active ? "selected" : ""} ${props.hovered === node.id ? "hovered" : ""} ${node.visible ? "" : "hidden-layer"}`}
          style={{ paddingLeft: 8 + depth * 16 }} draggable={!busy && editing !== node.id}
          onDragStart={e => { e.dataTransfer.setData("text/rulegen-node", node.id); e.dataTransfer.setData(NODE_DRAG_TYPE, JSON.stringify({ sketchId: props.sketchId, nodeId: node.id })); e.dataTransfer.effectAllowed = "copyMove"; setDragging(node.id); }}
          onDragEnd={() => setDragging(null)} onDragOver={e => e.preventDefault()}
          // Dropping on a collection nests inside it; on an object, places before it.
          onDrop={e => node.kind === "collection" ? drop(e, node.id, null) : drop(e, node.parentId, node.id)}
          onMouseEnter={() => props.onHover(node.id)} onMouseLeave={() => props.onHover(null)}
          onClick={e => props.onSelect(node.id, e.shiftKey || e.metaKey || e.ctrlKey)} onDoubleClick={() => setEditing(node.id)}>
          <Icon name={node.kind === "collection" ? "collection" : "object"} size={14} />
          {editing === node.id ? <input autoFocus aria-label={`Rename ${node.name}`} defaultValue={node.name} maxLength={100}
            onClick={e => e.stopPropagation()} onBlur={e => { if (e.target.value.trim()) props.onRename(node.id, e.target.value.trim()); setEditing(null); }}
            onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") setEditing(null); }} />
            : <span className="layer-name" title={`${node.description || node.name} · drag onto another sketch frame to copy it there`}>{node.name}</span>}
          {node.machine && <span className="layer-machine-badge" title={`${node.machine.states.length} states`}>{node.machine.states.length}S</span>}
          {node.transformations.length > 0 && <span className="layer-property-count" title={`${node.transformations.length} semantic transformation(s): ${node.transformations.map(item => item.label || item.id).join(" → ")}`}>{node.transformations.length}</span>}
          <button className="layer-visibility" aria-label={`${node.visible ? "Hide" : "Show"} ${node.name}`} onClick={e => { e.stopPropagation(); props.onToggleVisible(node.id); }}><Icon name={node.visible ? "eye" : "eye-off"} size={13} /></button>
        </div>;
      })}
      {!rows.length && <div className="layer-empty"><Icon name="layers" size={24} /><p>No brush stamps yet.</p><span>Sketch → Extract → Explore</span>
        <button className="primary-button" disabled={busy || !props.canExtract} onClick={props.onExtract}>Extract brush stamps<Icon name="spark" size={15} /></button></div>}
    </div>
  </section>;
}
