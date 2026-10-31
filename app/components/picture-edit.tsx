import { useId, useRef, useState } from "react";
import { Icon } from "./icons";
import type { PreviewManipulation } from "../lib/inspection";
import { boxPoint, cropFrom, dragManipulation, manipulationText, onCrop, outlinePath, placed, rotateGrip, type EditMode, type PictureEdit } from "../lib/preview-objects";
export { pictureEdited, type EditMode, type PictureEdit } from "../lib/preview-objects";

type Drag = { pointerId: number; part: "move" | "scale" | "rotate" | "draw" | "crop"; index: number; from: { x: number; y: number }; start?: PreviewManipulation };

type SheetProps = {
  edit: PictureEdit; onEdit: (patch: Partial<PictureEdit>) => void;
  /** The picture as it is now (a crop is cut from it), and whether the sheet takes the pointer. */
  shot: string; editable: boolean;
  selected: number | null; onSelect: (index: number | null) => void;
  className?: string;
};

/** The sheet over the picture (900×600 canvas pixels) where crops are drawn, moved, scaled and rotated, and annotation is drawn. */
export function EditSheet({ edit, onEdit, shot, editable, selected, onSelect, className = "fork-slot-sheet" }: SheetProps) {
  // The stroke being drawn: an annotation mark (normalized) or a crop's outline (canvas pixels).
  const [stroke, setStroke] = useState<{ x: number; y: number }[] | null>(null);
  const sheet = useRef<SVGSVGElement>(null), drag = useRef<Drag | null>(null), clip = useId().replace(/:/g, "");
  const live = editable && edit.mode !== "run";
  const point = (e: React.PointerEvent) => { const box = sheet.current!.getBoundingClientRect(); return { x: (e.clientX - box.left) / Math.max(1, box.width) * 900, y: (e.clientY - box.top) / Math.max(1, box.height) * 600 }; };
  /** A crop drawn: it can now be moved, scaled and rotated from where it is (the picture it is cut from is kept). */
  const addCrop = (outline: { x: number; y: number }[]) => {
    const crop = cropFrom(outline, edit.manipulations.length ? Math.max(...edit.manipulations.map(item => Number(item.object.split(":")[1]) || 0)) + 1 : 0);
    if (!crop) return;
    onEdit({ manipulations: [...edit.manipulations, { ...crop, dx: 0, dy: 0, scale: 1, rotate: 0 }].slice(-12), ...(edit.image ? {} : { image: shot }) });
    onSelect(Math.min(edit.manipulations.length, 11));
  };
  const replace = (index: number, item: PreviewManipulation) => onEdit({ manipulations: edit.manipulations.map((entry, i) => i === index ? item : entry) });
  /** Which crop (and part of it) is under the pointer: the selected one's grips first. */
  const hit = (at: { x: number; y: number }): { index: number; part: Drag["part"] } | null => {
    if (selected !== null && edit.manipulations[selected]) {
      const item = edit.manipulations[selected], corner = boxPoint(item, 1, 1), turn = rotateGrip(item);
      if (Math.hypot(at.x - turn.x, at.y - turn.y) < 14) return { index: selected, part: "rotate" };
      if (Math.hypot(at.x - corner.x, at.y - corner.y) < 14) return { index: selected, part: "scale" };
    }
    // On a crop where it is now (the last one on top).
    for (let i = edit.manipulations.length - 1; i >= 0; i--) if (onCrop(edit.manipulations[i], at)) return { index: i, part: "move" };
    return null;
  };
  const down = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 || !live) return;
    e.preventDefault(); e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId);
    const at = point(e);
    if (edit.mode === "annotate") { drag.current = { pointerId: e.pointerId, part: "draw", index: -1, from: at }; setStroke([{ x: at.x / 900, y: at.y / 600 }]); return; }
    const found = hit(at);
    if (found) { onSelect(found.index); drag.current = { pointerId: e.pointerId, ...found, from: at, start: edit.manipulations[found.index] }; return; }
    // Anywhere else: a new crop is drawn around what to manipulate.
    onSelect(null); setStroke([at]);
    drag.current = { pointerId: e.pointerId, part: "crop", index: -1, from: at };
  };
  const move = (e: React.PointerEvent<SVGSVGElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== e.pointerId || !sheet.current) return;
    e.preventDefault(); e.stopPropagation();
    const at = point(e);
    if (current.part === "draw") { setStroke(points => points && [...points, { x: Math.max(0, Math.min(1, at.x / 900)), y: Math.max(0, Math.min(1, at.y / 600)) }].slice(0, 400)); return; }
    if (current.part === "crop") { setStroke(points => points && [...points, { x: Math.max(0, Math.min(900, at.x)), y: Math.max(0, Math.min(600, at.y)) }].slice(0, 1200)); return; }
    if (current.start) replace(current.index, dragManipulation(current.start, current.part, current.from, at));
  };
  const up = (e: React.PointerEvent<SVGSVGElement>) => {
    const current = drag.current; if (!current || current.pointerId !== e.pointerId) return;
    drag.current = null;
    if (current.part === "crop") { if (stroke) addCrop(stroke); setStroke(null); return; }
    // Annotation strokes are kept with their first point, so a picture is there to send with them.
    if (current.part === "draw" && stroke && stroke.length > 1) onEdit({ marks: [...edit.marks, stroke.filter((_, i) => i % Math.max(1, Math.ceil(stroke.length / 64)) === 0).slice(0, 64)].slice(-24), ...(edit.image ? {} : { image: shot }) });
    setStroke(null);
  };
  const picture = edit.image || shot;
  return <svg ref={sheet} className={className} viewBox="0 0 900 600" preserveAspectRatio="none" style={{ pointerEvents: live ? "auto" : "none" }}
    onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
    {edit.manipulations.map((item, i) => {
      const { cx, cy, angle } = placed(item), { x, y, w, h } = item.box, c = { x: x + w / 2, y: y + h / 2 }, on = selected === i && edit.mode === "select";
      // Its outline where it was cropped (dashed), and the cropped picture where it is now (drawn in the crop's own frame, about its center).
      const path = item.outline.length > 2 ? outlinePath(item.outline) : `M${x},${y}h${w}v${h}h${-w}Z`;
      return <g key={`${item.object}-${i}`}>
        <path className="fork-slot-before" d={path} vectorEffect="non-scaling-stroke" />
        <g transform={`translate(${cx} ${cy}) rotate(${angle * 180 / Math.PI}) scale(${item.scale}) translate(${-c.x} ${-c.y})`}>
          <clipPath id={`${clip}-${i}`}><path d={path} /></clipPath>
          {picture && <image href={picture} x={0} y={0} width={900} height={600} clipPath={`url(#${clip}-${i})`} preserveAspectRatio="none" />}
          <path className={`fork-slot-after ${on ? "on" : ""}`} d={path} vectorEffect="non-scaling-stroke" />
        </g>
        {on && <rect className="fork-slot-frame" x={-w / 2} y={-h / 2} width={w} height={h} transform={`translate(${cx} ${cy}) rotate(${angle * 180 / Math.PI}) scale(${item.scale})`} vectorEffect="non-scaling-stroke" />}
        {on && (() => { const corner = boxPoint(item, 1, 1), top = boxPoint(item, 0, -1), turn = rotateGrip(item);
          return <>
            <line className="fork-slot-grip-line" x1={top.x} y1={top.y} x2={turn.x} y2={turn.y} vectorEffect="non-scaling-stroke" />
            <circle className="fork-slot-grip rotate" cx={turn.x} cy={turn.y} r={8} vectorEffect="non-scaling-stroke"><title>돌려서 회전</title></circle>
            <rect className="fork-slot-grip scale" x={corner.x - 7} y={corner.y - 7} width={14} height={14} vectorEffect="non-scaling-stroke"><title>끌어서 크기 조절</title></rect>
          </>; })()}
      </g>;
    })}
    {edit.mode === "select" && stroke && <path className="fork-slot-crop" d={outlinePath(stroke)} vectorEffect="non-scaling-stroke" />}
    {[...edit.marks, ...(edit.mode === "annotate" && stroke ? [stroke] : [])].map((mark, i) => <polyline key={i} className="fork-slot-mark" points={mark.map(p => `${p.x * 900},${p.y * 600}`).join(" ")} vectorEffect="non-scaling-stroke" />)}
  </svg>;
}

type ToolsProps = {
  edit: PictureEdit; onEdit: (patch: Partial<PictureEdit>) => void;
  editable: boolean; busy: boolean;
  selected: number | null; onSelect: (index: number | null) => void;
  /** The picture's own handles as a mode of their own (e.g. running execution), named so; without it "select" is always at hand. */
  run?: string;
};

/** The tools of a picture edit (its modes, clearing), what each does, and the crops made (select one, remove one). */
export function EditTools({ edit, onEdit, editable, busy, selected, onSelect, run }: ToolsProps) {
  const setMode = (mode: EditMode) => { onSelect(null); onEdit({ mode }); };
  const back: EditMode = run ? "run" : "select";
  return <>
    <div className="fork-slot-tools" role="group" aria-label="Edit the picture">
      {run && <button className={edit.mode === "run" ? "active" : ""} aria-pressed={edit.mode === "run"} disabled={!editable} onClick={() => setMode("run")}><Icon name="play" size={12} />{run}</button>}
      <button className={edit.mode === "select" ? "active" : ""} aria-pressed={edit.mode === "select"} disabled={!editable} onClick={() => setMode(run && edit.mode === "select" ? "run" : "select")}><Icon name="lasso" size={13} />크롭 · 이동 · 크기 · 회전</button>
      <button className={edit.mode === "annotate" ? "active" : ""} aria-pressed={edit.mode === "annotate"} disabled={!editable} onClick={() => setMode(edit.mode === "annotate" ? back : "annotate")}><Icon name="pen" size={13} />Annotation</button>
      <button disabled={busy || (!edit.marks.length && !edit.manipulations.length)} onClick={() => { onSelect(null); onEdit({ marks: [], manipulations: [], image: "" }); }}>지우기</button>
    </div>
    <span className="fork-slot-hint-line">{edit.mode === "select" ? "바꿀 부분을 자유롭게 둘러 그려 크롭 · 크롭을 끌어서 옮기기 · 모서리 □로 크기 · 위의 ○로 회전 · Esc로 선택 해제"
      : edit.mode === "annotate" ? `그림 위에 그려 표시합니다 · 다 그리면 ${run ? `「${run}」` : "선택"}으로 돌아가세요` : "그림 위의 손잡이로 실행합니다 · 보여줄 게 있으면 크롭이나 Annotation을 고르세요"}</span>
    {edit.manipulations.length > 0 && <ul className="fork-slot-manipulations">
      {edit.manipulations.map((item, i) => <li key={`${item.object}-${i}`} className={selected === i ? "on" : ""}><button onClick={() => { if (edit.mode !== "select") onEdit({ mode: "select" }); onSelect(i); }}>{item.label}</button><span>{manipulationText(item)}</span>
        <button aria-label="Remove" disabled={busy} onClick={() => { onSelect(null); onEdit({ manipulations: edit.manipulations.filter((_, j) => j !== i) }); }}>×</button></li>)}
    </ul>}
  </>;
}
