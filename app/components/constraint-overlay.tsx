import { useMemo, useRef } from "react";
import { ART_WIDTH as W, ART_HEIGHT as H, type ConstraintScene, type SceneBox, type SceneNode } from "../lib/schema";
import { layoutFeatureTags } from "../lib/feature-tags";
import { settleSceneNode, transformNode, kindLabels } from "../lib/constraint-scene";
const colors = { spatial: "#397461", temporal: "#8b67bd", stylistic: "#bf7b35", object: "#397fa5" };
type Props = { scene: ConstraintScene; selected: string | null; dropTargetId?: string | null; zoom: number; disabled: boolean; onSelect: (id: string) => void; onChange: (scene: ConstraintScene) => void; onCommit: (scene: ConstraintScene) => void; onAttach: (nodeId: string, algorithmId: string) => void };
export function ConstraintOverlay(props: Props) {
  const drag = useRef<{ id: string; pointerId: number; x: number; y: number; width: number; height: number; box: SceneBox; scene: ConstraintScene; resize: boolean; last: ConstraintScene } | null>(null);
  const screen = Math.max(.15, props.zoom);
  const tags = useMemo(() => new Map(layoutFeatureTags(props.scene.nodes.map(n => ({ id: n.id, label: n.label, description: "", region: n.box })), screen, props.selected).map(t => [t.feature.id, t])), [props.scene.nodes, screen, props.selected]);
  function begin(e: React.PointerEvent<SVGGElement>, node: SceneNode) {
    if (props.disabled || e.button !== 0 || e.altKey) return;
    e.preventDefault(); e.stopPropagation(); props.onSelect(node.id);
    const bounds = e.currentTarget.ownerSVGElement!.getBoundingClientRect();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: node.id, pointerId: e.pointerId, x: e.clientX, y: e.clientY, width: bounds.width, height: bounds.height, box: node.box, scene: props.scene, last: props.scene, resize: node.kind === "object" && (e.target as Element).getAttribute("data-resize") === "true" };
  }
  function finish(e: React.PointerEvent<SVGGElement>, cancel = false) {
    const d = drag.current; if (!d || d.pointerId !== e.pointerId) return;
    e.stopPropagation(); drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (cancel) { props.onChange(d.scene); return; }
    let scene = d.last;
    const node = scene.nodes.find(n => n.id === d.id)!;
    if (!d.resize && JSON.stringify(node.box) !== JSON.stringify(d.box)) scene = settleSceneNode(scene, node.id);
    props.onCommit(scene);
  }
  const classes = (node: SceneNode) => `constraint-manipulator kind-${node.kind} ${node.id === props.selected ? "selected" : ""} ${node.id === props.dropTargetId ? "drop-target" : ""}`;
  function interactions(node: SceneNode) {
    return {
      onPointerDown: (e: React.PointerEvent<SVGGElement>) => begin(e, node),
      onPointerMove: (e: React.PointerEvent<SVGGElement>) => {
        const d = drag.current; if (!d || d.id !== node.id || d.pointerId !== e.pointerId) return;
        e.stopPropagation(); const dx = (e.clientX - d.x) / d.width, dy = (e.clientY - d.y) / d.height;
        const box = d.resize ? { ...d.box, w: Math.min(1 - d.box.x, Math.max(.01, d.box.w + dx)), h: Math.min(1 - d.box.y, Math.max(.01, d.box.h + dy)) } : { ...d.box, x: d.box.x + dx, y: d.box.y + dy };
        d.last = transformNode(d.scene, node.id, box); props.onChange(d.last);
      },
      onPointerUp: (e: React.PointerEvent<SVGGElement>) => finish(e),
      onPointerCancel: (e: React.PointerEvent<SVGGElement>) => finish(e, true),
      onClick: (e: React.MouseEvent<SVGGElement>) => { e.stopPropagation(); props.onSelect(node.id); },
      onKeyDown: (e: React.KeyboardEvent<SVGGElement>) => {
        if (props.disabled) return;
        if (["Enter", " "].includes(e.key)) { e.preventDefault(); e.stopPropagation(); props.onSelect(node.id); return; }
        if (!e.key.startsWith("Arrow")) return;
        e.preventDefault(); e.stopPropagation(); const amount = e.shiftKey ? 10 : 1;
        props.onCommit(transformNode(props.scene, node.id, { ...node.box, x: node.box.x + (e.key === "ArrowLeft" ? -amount : e.key === "ArrowRight" ? amount : 0) / W, y: node.box.y + (e.key === "ArrowUp" ? -amount : e.key === "ArrowDown" ? amount : 0) / H }));
      },
      onDragOver: (e: React.DragEvent<SVGGElement>) => { if (!props.disabled && node.kind !== "object") e.preventDefault(); },
      onDrop: (e: React.DragEvent<SVGGElement>) => { const id = e.dataTransfer.getData("application/x-rulegen-algorithm"); if (id && !props.disabled && node.kind !== "object") { e.preventDefault(); e.stopPropagation(); props.onAttach(node.id, id); } },
    };
  }
  return <g className={`constraint-overlay ${props.selected ? "has-constraint-selection" : ""}`} aria-label="Direct manipulation widgets">
    {[...props.scene.nodes].sort((a, b) => (a.kind === "spatial" ? 0 : a.kind === "object" ? 2 : 1) - (b.kind === "spatial" ? 0 : b.kind === "object" ? 2 : 1)).map(node => {
      const b = node.box, x = b.x * W, y = b.y * H, w = b.w * W, h = b.h * H, selected = node.id === props.selected;
      const member = props.scene.nodes.find(n => n.id === node.parentId), handle = 9 / screen, tag = tags.get(node.id)!;
      return <g key={node.id} className={classes(node)} data-widget-id={node.id} role="button" tabIndex={props.disabled ? -1 : 0} aria-label={`${kindLabels[node.kind]} ${node.label}; drag to move${node.kind === "object" ? ", use corner to resize" : ""}`} aria-pressed={selected} style={{ color: colors[node.kind] }} {...interactions(node)}>
        {node.kind === "object" ? node.primitive === "ellipse" ? <ellipse className="object-shape" cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} /> : node.primitive === "line" ? <line className="object-shape" x1={x} y1={y + h} x2={x + w} y2={y} /> : node.primitive === "triangle" ? <polygon className="object-shape" points={`${x + w / 2},${y} ${x + w},${y + h} ${x},${y + h}`} /> : <rect className="object-shape" x={x} y={y} width={w} height={h} /> : null}
        <rect className="constraint-bounds" x={x} y={y} width={w} height={h} rx={6 / screen} vectorEffect="non-scaling-stroke" />
        <path className="constraint-tag-leader" d={`M${(b.x + b.w / 2) * W},${(b.y + b.h / 2) * H}L${(tag.x + tag.width / 2) / screen},${(tag.y + tag.height / 2) / screen}`} />
        {selected && <>{node.kind === "object" && <rect data-resize="true" className="constraint-resize" x={x + w - handle} y={y + h - handle} width={handle * 2} height={handle * 2} />}<text className="constraint-dimension" x={x} y={Math.min(H - 4, y + h + 16 / screen)} fontSize={10 / screen}>{Math.round(w)} × {Math.round(h)}{member ? ` · in ${member.label}` : ""}</text></>}
      </g>;
    })}
    {/* Labels stay above every shape, including full-frame background objects. */}
    <g className="constraint-label-layer">{props.scene.nodes.map(node => {
      const tag = tags.get(node.id)!;
      return <g key={node.id} className={classes(node)} style={{ color: colors[node.kind] }} {...interactions(node)}><foreignObject className="constraint-tag" x="0" y="0" width={tag.width} height={tag.height} transform={`translate(${Math.round(tag.x) / screen},${Math.round(tag.y) / screen}) scale(${1 / screen})`}><title>{kindLabels[node.kind]} · {node.label}</title><button className="constraint-tag-button" tabIndex={props.disabled ? -1 : 0} aria-label={`Select ${node.label} constraint tag`} aria-pressed={node.id === props.selected} title={`${kindLabels[node.kind]} · ${node.label}`}><span>{node.kind === "object" ? "◇" : node.kind === "spatial" ? "▣" : "◐"}</span>{!tag.compact && <span>{node.label}</span>}</button></foreignObject></g>;
    })}</g>
  </g>;
}
