import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CANVAS, fieldColors, nearestEdge, occurrences, OVERLAY_HOST, overlayContext, packLabels, placeLabels, resolveMarks, stepRecord, type Guide, type Mark, type ResolvedMark, type SitePlan } from "../lib/execution/overlay";
import type { ExecStep } from "../lib/execution/trace";

// The chosen variables of the step looked at, drawn over the frame's picture (which spans this layer, 900×600):
// guides in canvas coordinates, labels placed next to their marks with leader lines.

const MAX_RUNS = 40;

function GuideShape({ guide, color, faint }: { guide: Guide; color: string; faint?: boolean }) {
  const [[x, y]] = guide.points;
  const stroke = guide.color ?? color;
  if (guide.type === "point") return <circle cx={x} cy={y} r={4} className="exec-guide" stroke={stroke} opacity={faint ? .35 : 1} />;
  let d = `M ${guide.points.map(point => point.join(" ")).join(" L ")}`;
  if (guide.type === "outline" || guide.type === "area") d += " Z";
  if (guide.type === "vector" || guide.type === "dimension") {
    const [, [ex, ey]] = guide.points, dx = ex - x, dy = ey - y, length = Math.hypot(dx, dy) || 1, size = Math.min(8, length / 3), nx = -dy / length * size, ny = dx / length * size;
    if (guide.type === "dimension") d += ` M ${x - nx} ${y - ny} L ${x + nx} ${y + ny} M ${ex - nx} ${ey - ny} L ${ex + nx} ${ey + ny}`;
    else { const bx = ex - dx / length * size, by = ey - dy / length * size; d += ` M ${bx - nx / 2} ${by - ny / 2} L ${ex} ${ey} L ${bx + nx / 2} ${by + ny / 2}`; }
  }
  return <g opacity={faint ? .35 : 1}>
    <path d={d} className="exec-guide-halo" />
    <path d={d} className="exec-guide" stroke={stroke} fill={guide.type === "area" ? stroke : "none"} fillOpacity={guide.type === "area" ? .18 : undefined} />
  </g>;
}

type Placed = { left: number; top: number; width?: number; height?: number; scroll: boolean };

export function ExecutionOverlay({ steps, step, plan, shown, onStatus }: { steps: ExecStep[]; step: ExecStep | null; plan: SitePlan | undefined; shown: Record<string, string[]>; onStatus?: (message: string) => void }) {
  const frame = useRef<HTMLIFrameElement>(null), layer = useRef<HTMLDivElement>(null);
  const [port, setPort] = useState<MessagePort | null>(null);
  const [marks, setMarks] = useState<ResolvedMark[]>([]);
  const [earlier, setEarlier] = useState<{ guide: Guide; color: string }[]>([]);
  const [placed, setPlaced] = useState<Placed[]>([]);
  const [leaders, setLeaders] = useState<{ x1: number; y1: number; x2: number; y2: number }[]>([]);
  const status = useRef(onStatus); status.current = onStatus;
  const request = useRef(0);

  useEffect(() => () => port?.close(), [port]);
  useEffect(() => {
    setMarks([]); setEarlier([]);
    if (!port || !step || !plan?.code) { status.current?.(plan && !plan.code ? plan.skipReason : ""); return; }
    const targets = occurrences(steps, step, plan.accumulate).slice(0, MAX_RUNS);
    const inputs = targets.map(target => ({ step: stepRecord(target), context: overlayContext(steps, target), width: CANVAS.width, height: CANVAS.height }));
    const id = ++request.current;
    const receive = (event: MessageEvent) => {
      const data = event.data as { id: number; error?: string; results?: { marks?: Mark[]; error?: string }[] };
      if (data.id !== id) return;
      if (data.error || !data.results) { status.current?.(data.error ?? "The overlay could not be computed."); return; }
      const [own, ...rest] = data.results;
      const current = resolveMarks(own?.marks ?? [], step, steps, shown);
      const colors = fieldColors(current);
      setMarks(current);
      setEarlier(rest.flatMap((result, k) => resolveMarks(result.marks ?? [], targets[k + 1], steps, shown)).flatMap(mark => mark.guides.map(guide => ({ guide, color: colors.get(mark.fields[guide.field]) ?? "#7b8a74" }))));
      status.current?.(current.length ? "" : own?.error ? `The overlay code failed here: ${own.error}` : "Nothing to show at this step.");
    };
    port.addEventListener("message", receive); port.start();
    port.postMessage({ id, code: plan.code, inputs });
    return () => port.removeEventListener("message", receive);
  }, [port, step, plan, steps, shown]);

  // Labels are laid out in the layer's own pixels, next to their marks (a mark with nothing to show has none).
  const labelled = marks.filter(mark => mark.labels.length > 0);
  useLayoutEffect(() => {
    const element = layer.current;
    if (!element) return;
    const layout = () => {
      const width = element.clientWidth, height = element.clientHeight;
      if (!width || !height) return;
      const nodes = [...element.querySelectorAll<HTMLElement>(".exec-label")];
      for (const node of nodes) { node.style.maxWidth = ""; node.style.maxHeight = ""; }
      const sx = width / CANVAS.width, sy = height / CANVAS.height;
      const labels = labelled.map((mark, i) => ({ anchor: { x: mark.x * sx, y: mark.y * sy }, width: Math.ceil(nodes[i]?.offsetWidth ?? 0), height: Math.ceil(nodes[i]?.offsetHeight ?? 0) }));
      const near = placeLabels(labels, width, height), boxes = near ?? packLabels(labels.map(label => label.anchor), width, height);
      setPlaced(boxes.map(box => ({ left: box.x, top: box.y, ...(near ? {} : { width: box.width, height: box.height }), scroll: !near })));
      setLeaders(boxes.map((box, i) => { const [x2, y2] = nearestEdge(labels[i].anchor, box); return { x1: labels[i].anchor.x, y1: labels[i].anchor.y, x2, y2 }; }));
    };
    layout();
    const observer = new ResizeObserver(layout); observer.observe(element);
    return () => observer.disconnect();
  }, [marks]);

  const connect = () => {
    const channel = new MessageChannel();
    frame.current?.contentWindow?.postMessage("overlay-port", "*", [channel.port2]);
    setPort(channel.port1);
  };
  const colors = fieldColors(marks);
  return <>
    <iframe ref={frame} hidden title="Overlay sandbox" sandbox="allow-scripts" srcDoc={OVERLAY_HOST} onLoad={connect} />
    {(marks.length > 0 || earlier.length > 0) && <div className="exec-overlay" ref={layer} aria-label="Recorded variables on the picture">
      <svg className="exec-guides" viewBox={`0 0 ${CANVAS.width} ${CANVAS.height}`} preserveAspectRatio="none" aria-hidden="true">
        {earlier.map((item, i) => <GuideShape key={`e${i}`} guide={item.guide} color={item.color} faint />)}
        {marks.flatMap((mark, m) => mark.guides.map((guide, g) => <GuideShape key={`${m}-${g}`} guide={guide} color={colors.get(mark.fields[guide.field]) ?? "#7b8a74"} />))}
        {marks.map((mark, m) => <circle key={`a${m}`} cx={mark.x} cy={mark.y} r={3} className="exec-anchor" />)}
      </svg>
      <svg className="exec-leaders" aria-hidden="true">{leaders.map((line, i) => <line key={i} {...line} />)}</svg>
      {labelled.map((mark, m) => <div key={m} className={`exec-label ${placed[m]?.scroll ? "scroll" : ""}`} style={placed[m] ? { left: placed[m].left, top: placed[m].top, maxWidth: placed[m].width, maxHeight: placed[m].height } : { visibility: "hidden" }}>
        {mark.labels.map(label => <div key={label.path} className="exec-label-row" title={label.path}>
          <i style={{ background: colors.get(label.path) }} /><b>{label.name}</b><span>{label.value}</span>
        </div>)}
      </div>)}
    </div>}
  </>;
}
