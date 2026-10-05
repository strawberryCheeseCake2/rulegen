import { useMemo } from "react";
import { ART_WIDTH, ART_HEIGHT, type Feature } from "../lib/schema";
import { layoutFeatureTags } from "../lib/feature-tags";
type Props = { features: Feature[]; selected: string | null; hovered: string | null; zoom: number; onSelect: (id: string) => void; onHover: (id: string | null) => void };
export function FeatureOverlay({ features, selected, hovered, zoom, onSelect, onHover }: Props) {
  const tags = useMemo(() => layoutFeatureTags(features, zoom, selected), [features, zoom, selected]);
  return <g className={`feature-overlay ${selected ? "has-feature-selection" : ""}`}>{tags.map(tag => {
    const { feature, index, x, y, width, height, compact, cx, cy } = tag, r = feature.region;
    const focused = selected ? selected === feature.id : hovered === feature.id;
    const edgeX = Math.max(x, Math.min(x + width, cx)), edgeY = Math.max(y, Math.min(y + height, cy));
    return <g key={feature.id} className={`live-feature-anchor ${focused ? "active" : ""} ${selected === feature.id ? "selected-feature" : ""}`} data-feature-id={feature.id}>
      <rect className="live-feature-region" x={r.x * ART_WIDTH} y={r.y * ART_HEIGHT} width={r.w * ART_WIDTH} height={r.h * ART_HEIGHT} rx="12" vectorEffect="non-scaling-stroke" />
      <path className="live-feature-leader" d={`M${cx / zoom} ${cy / zoom}L${edgeX / zoom} ${edgeY / zoom}`} vectorEffect="non-scaling-stroke" />
      <circle className="live-feature-pin" cx={cx / zoom} cy={cy / zoom} r={(focused ? 4 : 2.5) / zoom} fill="currentColor" />
      <foreignObject x="0" y="0" transform={`translate(${x / zoom} ${y / zoom}) scale(${1 / zoom})`} width={width} height={height}>
        <button className={`live-feature-tag ${compact ? "compact-feature-tag" : ""}`} style={{ height }} aria-label={`Select ${feature.label} on sketch`} aria-pressed={selected === feature.id} title={`${feature.label} · ${feature.description}`} onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); onSelect(feature.id); }} onMouseEnter={() => onHover(feature.id)} onMouseLeave={() => onHover(null)}><span>{String(index + 1).padStart(2, "0")}</span>{!compact && <span className="feature-tag-label">{feature.label}</span>}</button>
      </foreignObject>
    </g>;
  })}</g>;
}
