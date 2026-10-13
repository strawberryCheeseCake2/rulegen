import { useRef, useState } from "react";
import { ART_WIDTH as W, ART_HEIGHT as H } from "../../lib/schema";
import type { Scene } from "../../lib/scene/schema";
import { ancestorIds, clickTarget, descendantIds, layerTree, moveNodes, selectionRoots } from "../../lib/scene/graph";

type Props = {
  scene: Scene; selected: string[]; hovered: string | null; zoom: number; interactive: boolean;
  onSelect: (id: string | null, additive: boolean) => void; onHover: (id: string | null) => void;
  /** While dragging (throttled): the running result follows the move live. */
  onLiveMove?: (scene: Scene) => void;
  /** Once per drag, on release, with the scene the drag started from (one undo step). */
  onMove: (scene: Scene, before: Scene) => void;
};

/**
 * Boxes for collections (dashed) and objects (solid) on the sketch. With the
 * Select tool a click picks the outermost unselected level (Figma-like) and a
 * drag moves the selection together with every member.
 */
export function SceneOverlay({ scene: live, selected, hovered, zoom, interactive, onSelect, onHover, onMove, onLiveMove }: Props) {
  const drag = useRef<{ pointer: number; x: number; y: number; ids: string[]; moved: boolean; svg: SVGSVGElement; start: Scene; sent: number } | null>(null);
  const [preview, setPreview] = useState<{ dx: number; dy: number } | null>(null);
  // Boxes are drawn from the drag's starting scene plus the pointer offset, independent of live updates.
  const scene = drag.current && preview ? drag.current.start : live;
  const moving = drag.current && preview ? new Set(selectionRoots(scene, drag.current.ids).flatMap(id => [id, ...descendantIds(scene, id)])) : new Set<string>();
  const focus = new Set(selected.flatMap(id => [id, ...descendantIds(scene, id)]));
  const rows = layerTree(scene).filter(({ node }) => node.visible && !ancestorIds(scene, node.id).some(id => scene.nodes.find(item => item.id === id)?.visible === false));
  const delta = (e: React.PointerEvent) => { const d = drag.current!, box = d.svg.getBoundingClientRect(); return { dx: (e.clientX - d.x) / box.width, dy: (e.clientY - d.y) / box.height }; };
  const down = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    const target = clickTarget(scene, id, selected);
    const ids = additive ? selected : selected.includes(target) ? selected : [target];
    onSelect(target, additive);
    if (!interactive || additive) return;
    const svg = (e.currentTarget as SVGElement).ownerSVGElement!;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag.current = { pointer: e.pointerId, x: e.clientX, y: e.clientY, ids, moved: false, svg, start: live, sent: 0 };
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current; if (!d || d.pointer !== e.pointerId) return;
    const next = delta(e);
    if (Math.abs(next.dx * W) + Math.abs(next.dy * H) > 2) d.moved = true;
    if (!d.moved) return;
    setPreview(next);
    const now = performance.now();
    if (onLiveMove && now - d.sent > 50) { d.sent = now; onLiveMove(moveNodes(d.start, d.ids, next.dx, next.dy)); }
  };
  const up = (e: React.PointerEvent) => {
    const d = drag.current; if (!d || d.pointer !== e.pointerId) return;
    drag.current = null; setPreview(null);
    if (d.moved) { const { dx, dy } = delta(e); onMove(moveNodes(d.start, d.ids, dx, dy), d.start); }
  };
  return <g className={`scene-overlay ${interactive ? "scene-overlay-interactive" : ""} ${selected.length ? "has-node-selection" : ""}`} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
    {rows.map(({ node, depth }) => {
      const r = node.region, shift = moving.has(node.id) && preview ? preview : { dx: 0, dy: 0 };
      const x = (r.x + shift.dx) * W, y = (r.y + shift.dy) * H, active = focus.has(node.id) || hovered === node.id;
      const tagWidth = Math.min(220, 26 + Array.from(node.name).length * 7) / zoom, tagHeight = 18 / zoom;
      return <g key={node.id} className={`scene-node kind-${node.kind} ${active ? "active" : ""} ${selected.includes(node.id) ? "selected-node" : ""}`} data-node-id={node.id}
        onMouseEnter={() => onHover(node.id)} onMouseLeave={() => onHover(null)}>
        <rect className="scene-node-region" x={x} y={y} width={r.w * W} height={r.h * H} rx={node.kind === "collection" ? 10 : 4} vectorEffect="non-scaling-stroke"
          style={{ pointerEvents: interactive ? "all" : "none" }} onPointerDown={e => down(e, node.id)} />
        <g className="scene-node-tag" transform={`translate(${x} ${Math.max(0, y - tagHeight - 2 / zoom)})`} onPointerDown={e => down(e, node.id)} role="button" aria-label={`Select ${node.name}`}>
          <rect width={tagWidth} height={tagHeight} rx={4 / zoom} />
          <text x={6 / zoom} y={tagHeight / 2} dominantBaseline="central" fontSize={11 / zoom}>{node.kind === "collection" ? "▣ " : "● "}{node.name}{node.machine ? " ⟳" : ""}</text>
        </g>
      </g>;
    })}
  </g>;
}
