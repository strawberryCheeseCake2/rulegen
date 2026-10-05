import type { ReactNode } from "react";

export type BrushSettings = { spacing: number; length: number; spread: number; variation: number; taper: number; color: string };
export const defaultBrush: BrushSettings = { spacing: 24, length: 38, spread: 35, variation: 22, taper: 65, color: "#547d64" };
export const brushPresets = [
  { name: "Wild sprig", description: "Loose & branching", settings: defaultBrush },
  { name: "Quiet fern", description: "Dense & delicate", settings: { spacing: 13, length: 28, spread: 52, variation: 8, taper: 85, color: "#728368" } },
  { name: "Dry twig", description: "Sparse & angular", settings: { spacing: 35, length: 45, spread: 22, variation: 38, taper: 40, color: "#9c7d5e" } },
];
export function BrushStroke({ settings, sample = "curve", compact = false }: { settings: BrushSettings; sample?: string; compact?: boolean }) {
  const count = Math.round(480 / settings.spacing);
  const point = (t: number) => ({ x: 58 + t * 484, y: sample === "line" ? 135 : sample === "wave" ? 138 + Math.sin(t * Math.PI * 2) * 30 : 178 - Math.sin(t * Math.PI) * 84 });
  const path = Array.from({ length: 81 }, (_, i) => { const p = point(i / 80); return `${i ? "L" : "M"}${p.x} ${p.y}`; }).join(" ");
  return <svg className="brush-stroke" viewBox="0 0 600 280" role="img" aria-label={compact ? "Brush variant sample" : `Procedural brush sample on a ${sample} stroke`}>
    {!compact && <path d={path} fill="none" stroke="#cbd5c1" strokeWidth="1" strokeDasharray="3 5" transform="translate(0 3)" />}
    <g fill="none" stroke={settings.color} strokeLinecap="round" strokeLinejoin="round">
      <path d={path} strokeWidth="1.5" opacity=".65" />
      {Array.from({ length: count }, (_, i) => {
        const t = (i + .5) / count, p = point(t), next = point(t + .002);
        const tangent = Math.atan2(next.y - p.y, next.x - p.x);
        return [-1, 1].map(side => {
          const noise = Math.sin(i * 5.17 + side * 3.8) * settings.variation / 100;
          const angle = tangent + side * (settings.spread / 90 + .25) + noise * .6;
          const length = settings.length * (1 + noise) * (.55 + Math.sin(t * Math.PI) * .45);
          const x = p.x + Math.cos(angle) * length, y = p.y + Math.sin(angle) * length;
          const tipX = x + Math.cos(angle + side * .18) * length * .44, tipY = y + Math.sin(angle + side * .18) * length * .44;
          return <g key={`${i}-${side}`} opacity={.62 + (i % 4) * .08}>
            <path d={`M${p.x} ${p.y}Q${x} ${p.y} ${tipX} ${tipY}`} strokeWidth={2 - settings.taper / 100} />
            <path d={`M${x} ${y}l${Math.cos(angle + side * .75) * length * .42} ${Math.sin(angle + side * .75) * length * .42}`} strokeWidth={1.3 - settings.taper / 150} />
            <path d={`M${(x + p.x) / 2} ${(y + p.y) / 2}l${Math.cos(angle - side * .6) * length * .3} ${Math.sin(angle - side * .6) * length * .3}`} strokeWidth=".65" />
          </g>;
        });
      })}
    </g>
    {!compact && <g fill="#bdc8b0"><circle cx="58" cy={point(0).y} r="3" /><circle cx="542" cy={point(1).y} r="3" /></g>}
  </svg>;
}
export function BrushPlayground({ settings, sample, onSample, preset, onPreset, source }: { settings: BrushSettings; sample: string; onSample: (value: string) => void; preset: number; onPreset: (index: number) => void; source: ReactNode }) {
  return <div className="brush-playground">
    <div className="brush-source"><span className="brush-source-label">FROM YOUR SKETCH</span>{source}<span className="brush-source-arrow">↗</span><span className="brush-source-label">A BRUSH THAT GROWS</span></div>
    <div className="brush-paper"><div className="brush-paper-header"><div><span className="eyebrow">STROKE STUDY 01</span><h3>{brushPresets[preset].name}</h3></div><span className="sample-badge">Sample preview</span></div><BrushStroke settings={settings} sample={sample} /><div className="brush-paper-caption"><span>One gesture. A growing pattern.</span><span>Sample path · {sample}</span></div></div>
    <div className="sample-paths" role="group" aria-label="Brush sample path"><span>TRY A GESTURE</span>{["curve", "wave", "line"].map(path => <button key={path} aria-pressed={sample === path} onClick={() => onSample(path)} className={sample === path ? "active" : ""}><svg width="24" height="14" viewBox="0 0 24 14" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true"><path d={path === "curve" ? "M2 12Q12 -7 22 12" : path === "wave" ? "M2 7Q7 -3 12 7T22 7" : "M2 7h20"} /></svg>{path}</button>)}</div>
    <div className="brush-variants-heading"><span className="eyebrow">THREE POSSIBLE DIRECTIONS</span><span>Start somewhere. Then wander.</span></div>
    <div className="brush-variants">{brushPresets.map((item, i) => <button key={item.name} className={`brush-variant ${preset === i ? "active" : ""}`} aria-pressed={preset === i} onClick={() => onPreset(i)}><BrushStroke settings={item.settings} compact /><span className="brush-variant-name">{item.name}<span>{preset === i ? "Selected" : `0${i + 1}`}</span></span><span className="brush-variant-description">{item.description}</span></button>)}</div>
  </div>;
}
export function BrushControls({ settings, onChange }: { settings: BrushSettings; onChange: (value: BrushSettings) => void }) {
  const controls = [
    { key: "spacing", label: "Spacing", hint: "Distance between motifs", min: 10, max: 45, unit: "px" },
    { key: "length", label: "Branch length", hint: "How far each mark grows", min: 15, max: 65, unit: "px" },
    { key: "spread", label: "Spread", hint: "Angle away from the stroke", min: 10, max: 70, unit: "°" },
    { key: "variation", label: "Variation", hint: "A little unpredictability", min: 0, max: 60, unit: "%" },
    { key: "taper", label: "Taper", hint: "From stem to a fine tip", min: 0, max: 100, unit: "%" },
  ] as const;
  return <div className="brush-controls">{controls.map(control => <label className="brush-control" key={control.key}><span><strong>{control.label}</strong><output>{settings[control.key]}{control.unit}</output></span><input aria-label={`Brush ${control.label.toLowerCase()}`} type="range" min={control.min} max={control.max} value={settings[control.key]} onChange={e => onChange({ ...settings, [control.key]: Number(e.target.value) })} /><small>{control.hint}</small></label>)}<div className="brush-palette"><span>Ink palette</span><div>{["#547d64", "#728368", "#9c7d5e", "#505858", "#ad7868"].map(color => <button key={color} className={`brush-ink ${settings.color === color ? "active" : ""}`} style={{ background: color }} aria-label={`Brush ink ${color}`} aria-pressed={settings.color === color} onClick={() => onChange({ ...settings, color })} />)}</div></div></div>;
}
