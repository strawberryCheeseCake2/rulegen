import { useRef, useState } from "react";
import { draggedValue, dragTargets, FULL_SPEED, nodeBox, nodeToAdjust, smoothedSpeed, SOURCE_NAMES, type Box, type DragTarget } from "../../lib/scene/drag-adjust";
import type { Scene, SceneNode, Constraint } from "../../lib/scene/schema";
import { coerceScalar } from "../../lib/scene/values";

type Point = { x: number; y: number };
type Drag = { pointerId: number; node: SceneNode; box: Box; from: Point; now: Point & { t: number }; speed: number; targets: DragTarget[]; values: Record<string, number> };
const unitText = (value: number, unit: string) => `${Math.round(value * 100) / 100}${unit ? ` ${unit}` : ""}`;
const keyOf = (target: DragTarget) => `${target.constraintId}:${target.dragIndex}`;

/**
 * The Adjust tool on a frame: dragging on a drawn object moves the values its constraints map to the mouse, all at
 * once: one by the mouse's x (left → right), one by its y (down → up), one by its speed (slow → fast). Pointing at an
 * object shows which value each attribute moves; while dragging, how far x and y went and how fast the mouse goes are
 * drawn with the value each gives. The running result follows live; one drag is one undo step.
 */
export function DragAdjustLayer({ scene, stack, zoom, onStart, onValue, onEnd }: { scene: Scene; zoom: number;
  /** A node's constraints as they are shown (a state's values applied). */
  stack: (node: SceneNode) => Constraint[];
  onStart: () => void; onValue: (nodeId: string, paramId: string, path: string[], value: number) => void; onEnd: () => void }) {
  const sheet = useRef<SVGSVGElement>(null), [hover, setHover] = useState<Point | null>(null), [drag, setDrag] = useState<Drag | null>(null), live = useRef<Drag | null>(null);
  const k = 1 / Math.max(.2, zoom);
  const point = (e: React.PointerEvent) => { const box = sheet.current!.getBoundingClientRect(); return { x: (e.clientX - box.left) / Math.max(1, box.width) * 900, y: (e.clientY - box.top) / Math.max(1, box.height) * 600, t: e.timeStamp }; };
  const targetsOf = (node: SceneNode) => dragTargets(node, stack(node));
  const update = (next: Drag | null) => { live.current = next; setDrag(next); };
  const down = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const at = point(e), node = nodeToAdjust(scene, at, item => targetsOf(item).length > 0); if (!node) return;
    e.preventDefault(); e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId);
    const targets = targetsOf(node);
    update({ pointerId: e.pointerId, node, box: nodeBox(node), from: at, now: at, speed: 0, targets, values: Object.fromEntries(targets.map(target => [keyOf(target), target.value.value])) }); onStart();
  };
  const move = (e: React.PointerEvent<SVGSVGElement>) => {
    const at = point(e), current = live.current;
    if (!current || current.pointerId !== e.pointerId) { setHover(at); return; }
    e.preventDefault(); e.stopPropagation();
    const speed = smoothedSpeed(current.speed, current.now, at), values = { ...current.values };
    // Every mapping of the object moves at once, each by its own attribute of the mouse.
    for (const target of current.targets) {
      const kept = coerceScalar(target.value, draggedValue(target, target.value, current.box, current.from, at, speed));
      if (kept.type !== "number" || kept.value === values[keyOf(target)]) continue;
      values[keyOf(target)] = kept.value; onValue(current.node.id, target.paramId, target.path ? target.path.split("/") : [], kept.value);
    }
    update({ ...current, now: at, speed, values });
  };
  const up = (e: React.PointerEvent<SVGSVGElement>) => { const current = live.current; if (!current || current.pointerId !== e.pointerId) return; update(null); onEnd(); };
  // What a press here would adjust (shown while pointing, not while dragging).
  const pointed = !drag && hover ? nodeToAdjust(scene, hover, item => targetsOf(item).length > 0) : null;
  return <svg ref={sheet} className={`drag-adjust ${drag ? "dragging" : pointed ? "over" : ""}`} viewBox="0 0 900 600" preserveAspectRatio="none" aria-label="Drag on a drawn object: the mouse's x, y and speed adjust its values"
    onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={() => setHover(null)}>
    {pointed && (() => { const box = nodeBox(pointed), targets = targetsOf(pointed);
      return <g className="drag-adjust-hint">
        <rect x={box.x} y={box.y} width={box.w} height={box.h} vectorEffect="non-scaling-stroke" />
        {targets.map((target, i) => <text key={keyOf(target)} x={box.x + 4 * k} y={Math.max(16 * k, box.y - 6 * k - (targets.length - 1 - i) * 17 * k)} style={{ fontSize: 13 * k }}>
          {SOURCE_NAMES[target.source].sign} {SOURCE_NAMES[target.source].name}{target.invert ? " (reversed)" : ""} → {target.param}{target.how ? ` · ${target.how}` : ""}</text>)}
      </g>; })()}
    {drag && (() => { const has = (source: DragTarget["source"]) => drag.targets.some(target => target.source === source);
      const meter = Math.max(0, Math.min(1, drag.speed / FULL_SPEED)), right = drag.now.x > 640, textX = right ? drag.now.x - 14 * k : drag.now.x + 14 * k;
      return <g className="drag-adjust-guide">
        <rect className="box" x={drag.box.x} y={drag.box.y} width={drag.box.w} height={drag.box.h} vectorEffect="non-scaling-stroke" />
        <circle className="was-point" cx={drag.from.x} cy={drag.from.y} r={4 * k} />
        {/* How far x went (across) and y went (up or down) from the press: the two legs to where the mouse is. */}
        {has("x") && <line x1={drag.from.x} y1={drag.from.y} x2={drag.now.x} y2={drag.from.y} vectorEffect="non-scaling-stroke" />}
        {has("y") && <line x1={drag.now.x} y1={drag.from.y} x2={drag.now.x} y2={drag.now.y} vectorEffect="non-scaling-stroke" />}
        {/* How fast the mouse goes: a meter beside it, full at a fast stroke. */}
        {has("speed") && <g className="speed-meter" transform={`translate(${drag.now.x + (right ? -22 : 10) * k} ${drag.now.y + 10 * k})`}>
          <rect className="track" width={8 * k} height={46 * k} /><rect className="fill" y={46 * k * (1 - meter)} width={8 * k} height={46 * k * meter} /></g>}
        <circle className="hand" cx={drag.now.x} cy={drag.now.y} r={5 * k} />
        {drag.targets.map((target, i) => <text key={keyOf(target)} x={textX} y={Math.max(18 * k, drag.now.y - 14 * k - (drag.targets.length - 1 - i) * 18 * k)} style={{ fontSize: 14 * k }} textAnchor={right ? "end" : "start"}>
          {SOURCE_NAMES[target.source].sign} {target.param}  {unitText(target.value.value, target.value.unit)} → {unitText(drag.values[keyOf(target)] ?? target.value.value, target.value.unit)}</text>)}
      </g>; })()}
  </svg>;
}
