import { useRef, useState } from "react";
import type { SemanticPen } from "../lib/schema";
import { BRUSH_TOOLS, brushGroup, brushTool, groupBrushes, parseBrushTool, subBrushes, type Brush, type BrushToolKind } from "../lib/brushes";
import { PenSettings } from "./pen-settings";
import { Icon, type IconName } from "./icons";

type Props = {
  tool: string; toolsActive: boolean; pencilOpen: boolean; color: string; width: number; opacity: number;
  pens: SemanticPen[]; activePen: SemanticPen | undefined; penSettingsOpen: boolean;
  busy: boolean; canAddSketch: boolean; canUndo: boolean; canRedo: boolean; canClear: boolean; zoom: number;
  onTool: (tool: string) => void; onPencilClose: () => void; onColor: (color: string) => void; onWidth: (width: number) => void; onOpacity: (opacity: number) => void;
  onPen: (pen: SemanticPen) => void; onPenChange: (pen: SemanticPen) => void; onPenRemove: (pen: SemanticPen) => void; onPenSettingsClose: () => void;
  onUndo: () => void; onRedo: () => void; onClear: () => void; onZoom: (amount: number) => void; onFit: () => void;
  onHome: () => void; onAddSketch: () => void; onAttach: () => void; onHelp: () => void;
  /** Execution inspection of the active frame: whether it is open, whether the frame has a result to inspect, toggle. */
  inspecting?: boolean; canInspect?: boolean; onInspect?: () => void;
  /** Inspection annotation: drawing marks on the inspected frame's picture (available while a frame is inspected). */
  marking?: boolean; canMark?: boolean; onMark?: () => void;
  /** Brushes (one per reusable collection, with their sub brushes) under one Brush tool; `groupTools` is the tool each brush remembers, `openGroup` the brush shown in the open panel (null: closed). */
  brushes?: Brush[]; groupTools?: Record<string, string>; openGroup?: string | null;
  /** The Brush tool's button (select the brush tool / open or close its panel), and picking a brush in its panel. */
  onBrushPanel?: () => void; onBrushGroup?: (brushId: string) => void; /** A brush in the panel is pointed at (null: none), to show its master frame. */ onBrushHover?: (brushId: string | null) => void; onBrushTool?: (brushId: string, toolId: string) => void; onBrushGroupClose?: () => void;
  onBrushChange?: (brush: Brush) => void; onBrushRemove?: (brush: Brush) => void;
  /** The frame holding a brush's master (null when gone), and showing it. */
  brushMaster?: (brush: Brush) => string | null; onBrushMaster?: (brush: Brush) => void;
};

export const BRUSH_TOOL_INFO: Record<BrushToolKind, { icon: IconName; label: string; hint: string }> = {
  brush: { icon: "brush", label: "Brush", hint: "Brush on a frame: adds this brush where you start if the frame doesn't have it yet; on a frame that has it, you play with it (the result takes your input, Esc to stop)." },
};

/** Left toolbar: frames, drawing tools, semantic pens, history and zoom. */
export function ToolRail(props: Props) {
  // The Brush panel can be dragged by its heading (it stays where it was put, within the window; a double click puts it back).
  const [panelAt, setPanelAt] = useState({ x: 0, y: 0 });
  const panelDrag = useRef<{ pointer: number; x: number; y: number; from: { x: number; y: number }; box: DOMRect } | null>(null);
  const panelMove = (e: React.PointerEvent) => {
    const drag = panelDrag.current; if (!drag || drag.pointer !== e.pointerId) return;
    const dx = Math.min(innerWidth - 8 - drag.box.right, Math.max(8 - drag.box.left, e.clientX - drag.x)), dy = Math.min(innerHeight - 8 - drag.box.bottom, Math.max(8 - drag.box.top, e.clientY - drag.y));
    setPanelAt({ x: drag.from.x + dx, y: drag.from.y + dy });
  };
  const toolButton = (name: string, icon: IconName, label: string) => {
    const active = props.tool === name && props.toolsActive;
    return <button className={`rail-button ${active ? "active" : ""}`} aria-label={label} title={label} aria-pressed={active} aria-expanded={name === "pen" ? props.pencilOpen : undefined} onClick={() => props.onTool(name)}><Icon name={icon} /></button>;
  };
  return <nav className="rail" aria-label="Workspace toolbar">
    <button className="rail-button" aria-label="Exploration workspace" onClick={props.onHome}><Icon name="grid" size={20} /></button>
    <button className="rail-button" aria-label="Add sketch frame" title="Add sketch frame" disabled={!props.canAddSketch} onClick={props.onAddSketch}><Icon name="plus" size={20} /></button>
    <button className="rail-button" aria-label="Attach photo" title="Attach photo" onClick={props.onAttach}><Icon name="upload" size={20} /></button>
    <div className="rail-line" />
    <div className="left-sketch-tools" role="toolbar" aria-label="Sketch tools">
      {toolButton("select", "select", "Select and move brush stamps (V)")}
      {toolButton("adjust", "adjust", "Adjust by dragging (A): drag on a drawn object; the mouse's x, y and speed change the values mapped to them")}
      <div className="left-tool-anchor">{toolButton("pen", "pen", "Pencil")}{props.pencilOpen && <div className="pencil-popover" role="group" aria-label="Pencil settings">
        <div className="pencil-popover-heading"><span>Pencil settings</span><button aria-label="Close pencil settings" onClick={props.onPencilClose}><Icon name="close" size={14} /></button></div>
        <span className="left-setting-title">INK COLOR</span>
        <div className="left-colors">{["#75664e", "#397461", "#333a3b", "#b56850"].map(c => <button key={c} className={`color ${props.color === c ? "active" : ""}`} style={{ background: c }} aria-label={`Select color ${c}`} aria-pressed={props.color === c} onClick={() => props.onColor(c)} />)}</div>
        <label><span>Size</span><input aria-label="Pencil size" type="range" min="1" max="20" value={props.width} onChange={e => props.onWidth(+e.target.value)} /><output>{props.width}px</output></label>
        <label><span>Opacity</span><input aria-label="Pencil opacity" type="range" min="5" max="100" value={props.opacity} onChange={e => props.onOpacity(+e.target.value)} /><output>{props.opacity}%</output></label>
      </div>}</div>
      {toolButton("eraser", "eraser", "Eraser")}{toolButton("lasso", "lasso", "Lasso selection")}{toolButton("hand", "hand", "Pan")}
      {props.pens.length > 0 && <div className="left-tool-anchor semantic-pen-anchor"><div className="semantic-pen-toolbar" role="group" aria-label="Drawing pens">{props.pens.map(pen => {
        const active = props.tool === "semantic" && props.activePen?.id === pen.id;
        return <button key={pen.id} style={{ color: pen.color }} className={`rail-button semantic-pen-button ${active ? "active" : ""}`} title={`${pen.name} · ${pen.meaning}`} aria-label={pen.kind === "interaction" ? "Use Interaction pen" : `Use constraint pen ${pen.name}`} aria-pressed={active} onClick={() => props.onPen(pen)}><Icon name={pen.kind === "interaction" ? "interaction" : "pen"} size={18} /><span className="semantic-pen-dot" style={{ background: pen.color }} /></button>;
      })}</div>
        {props.penSettingsOpen && props.activePen && props.tool === "semantic" && <PenSettings pen={props.activePen} onChange={props.onPenChange} onClose={props.onPenSettingsClose} onRemove={props.activePen.kind === "interaction" ? undefined : () => props.onPenRemove(props.activePen!)} />}
      </div>}
      {(props.brushes?.length ?? 0) > 0 && (() => {
        // One Brush tool: its panel lists the brushes on top and, below, the tools and options of the one picked.
        const all = props.brushes!, groups = groupBrushes(all), selected = parseBrushTool(props.tool);
        const activeGroup = props.toolsActive && selected ? brushGroup(all, selected.brushId) : null;
        const current = groups.find(item => item.id === (props.openGroup ?? activeGroup)) ?? groups.find(item => item.id === activeGroup) ?? groups[0];
        const shown = activeGroup === current.id ? selected : parseBrushTool(props.groupTools?.[current.id] || ""), kind: BrushToolKind = shown?.kind || "brush";
        const owner = all.find(item => item.id === shown?.brushId) ?? current, sub = owner.id !== current.id ? owner : undefined;
        const info = BRUSH_TOOL_INFO[kind], open = props.openGroup != null, inUse = Boolean(activeGroup);
        const brush = current, inGroup = activeGroup === brush.id, own = inGroup && selected!.brushId === brush.id, subs = subBrushes(all, brush.id);
        return <div className="brush-groups" role="group" aria-label="Brush tool"><div className="left-tool-anchor brush-group-anchor">
          <button className={`rail-button brush-group-button ${inUse ? "active" : ""}`} style={{ color: inUse ? current.color : undefined }} aria-label="Brushes"
            title={`Brush · ${current.name}${sub ? ` › ${sub.name}` : ""} · ${info.label}`} aria-pressed={inUse} aria-expanded={open} onClick={() => props.onBrushPanel?.()}>
            <Icon name={inUse ? info.icon : "brush"} size={18} />{inUse && <span className="semantic-pen-dot" style={{ background: current.color }} />}<span className="brush-group-corner" /></button>
          {open && <div className={`pencil-popover brush-group-popover ${panelAt.x || panelAt.y ? "moved" : ""}`} role="group" aria-label="Brushes" style={{ transform: panelAt.x || panelAt.y ? `translate(${panelAt.x}px, ${panelAt.y}px)` : undefined }}>
            <div className="pencil-popover-heading brush-group-handle" title="Drag to move · double click to put back"
              onPointerDown={e => { if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return; e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId);
                panelDrag.current = { pointer: e.pointerId, x: e.clientX, y: e.clientY, from: panelAt, box: e.currentTarget.parentElement!.getBoundingClientRect() }; }}
              onPointerMove={panelMove} onPointerUp={() => { panelDrag.current = null; }} onPointerCancel={() => { panelDrag.current = null; }}
              onDoubleClick={e => { if (!(e.target as HTMLElement).closest("button")) setPanelAt({ x: 0, y: 0 }); }}><span>Brushes</span><button aria-label="Close brush tools" onClick={props.onBrushGroupClose}><Icon name="close" size={14} /></button></div>
            {/* Top: pick a brush. */}
            <div className="brush-picker" role="listbox" aria-label="Brush list">{groups.map(item => {
              const picked = item.id === brush.id, used = activeGroup === item.id, count = subBrushes(all, item.id).length;
              // Hovering a brush (or picking it) shows where its master is on the board.
              return <button key={item.id} role="option" aria-selected={picked} className={`brush-pick-row ${picked ? "picked" : ""} ${used ? "in-use" : ""}`} title={`${item.name} brush`} onClick={() => props.onBrushGroup?.(item.id)}
                onMouseEnter={() => props.onBrushHover?.(item.id)} onMouseLeave={() => props.onBrushHover?.(null)} onFocus={() => props.onBrushHover?.(item.id)} onBlur={() => props.onBrushHover?.(null)}>
                <span className="brush-thumb" style={{ borderColor: item.color }}>{item.thumbnail ? <img src={item.thumbnail} alt="" /> : <i className="brush-thumb-empty" style={{ background: item.color }} />}</span>
                <span className="brush-pick-meta"><i className="brush-swatch" style={{ background: item.color }} /><span>{item.name}</span>
                {count > 0 && <small>{count} sub</small>}</span></button>;
            })}</div>
            {/* Below: the picked brush's tools and options. */}
            <div className="brush-options-heading" aria-label={`${brush.name} brush tools`}><i className="brush-swatch" style={{ background: brush.color }} />{brush.name}<span>tools · options</span></div>
            {/* The options keep one height; they scroll (sub brushes can be many). */}
            <div className="brush-group-body">
            <div className="brush-group-tools">{BRUSH_TOOLS.map(tool => {
              const active = own && selected!.kind === tool;
              return <button key={tool} className={active ? "active" : ""} aria-pressed={active} title={BRUSH_TOOL_INFO[tool].hint} onClick={() => props.onBrushTool?.(brush.id, brushTool(tool, brush.id))}><Icon name={BRUSH_TOOL_INFO[tool].icon} size={15} /><span>{BRUSH_TOOL_INFO[tool].label}</span></button>;
            })}
            </div>
            {/* Minimal examples of this brush's constraints: each a brush of its own. */}
            {subs.length > 0 && <div className="brush-sub-list" role="group" aria-label={`${brush.name} sub brushes`}><span className="left-setting-title">SUB BRUSHES</span>
              {subs.map(item => { const picked = inGroup && selected!.brushId === item.id;
                return <div key={item.id} className={`brush-sub-row ${picked ? "picked" : ""}`}>
                  {BRUSH_TOOLS.map(tool => { const active = picked && selected!.kind === tool;
                    return <button key={tool} className={active ? "active" : ""} aria-pressed={active} aria-label={`${item.name} ${BRUSH_TOOL_INFO[tool].label}`} title={`${item.name} · ${BRUSH_TOOL_INFO[tool].label}`} onClick={() => props.onBrushTool?.(brush.id, brushTool(tool, item.id))}>
                      <Icon name={BRUSH_TOOL_INFO[tool].icon} size={14} />{tool === "brush" && <span>{item.name}</span>}</button>; })}
                  {props.onBrushRemove && <button className="brush-targeted-remove" aria-label={`Remove sub brush ${item.name}`} title="Remove this sub brush" onClick={() => props.onBrushRemove!(item)}><Icon name="close" size={11} /></button>}</div>; })}</div>}
            {props.brushMaster && (() => { const master = props.brushMaster(brush);
              return <div className="brush-master-row"><span className="left-setting-title">MASTER</span>
                {master ? <button title="Show the master of this brush" onClick={() => props.onBrushMaster?.(brush)}>◆ {master}<Icon name="arrow" size={12} /></button> : <span className="brush-targeted-hint">The frame that held the master was deleted. You can set one with Make master on an instance.</span>}</div>; })()}
            <label className="brush-name-field"><span>Name</span><input maxLength={100} value={brush.name} onChange={e => { if (e.target.value.trim()) props.onBrushChange?.({ ...brush, name: e.target.value }); }} /></label>
            {props.onBrushRemove && <button className="brush-remove" onClick={() => props.onBrushRemove!(brush)}><Icon name="trash" size={13} />Remove brush</button>}
            </div>
          </div>}
        </div></div>;
      })()}
      {props.onInspect && <button className={`rail-button ${props.inspecting ? "active" : ""}`} aria-label="Inspect execution" aria-pressed={Boolean(props.inspecting)} disabled={!props.canInspect && !props.inspecting}
        title={props.canInspect || props.inspecting ? "Inspect: record the active frame's execution (every variable at every step) and ask about it" : "Generate the active frame's result to inspect it"} onClick={props.onInspect}><Icon name="inspect" size={18} /></button>}
      {props.onMark && <button className={`rail-button ${props.marking ? "active" : ""}`} aria-label="Inspection annotation" aria-pressed={Boolean(props.marking)} disabled={!props.canMark && !props.marking}
        title={props.canMark || props.marking ? "Inspection annotation: mark on the inspected frame what your concern is about (sent with it)" : "Inspect a frame first to annotate it"} onClick={props.onMark}><Icon name="inspect-pen" size={18} /></button>}
      <div className="rail-line" />
      <button className="rail-button" aria-label="Undo" disabled={!props.canUndo} onClick={props.onUndo}><Icon name="undo" size={16} /></button>
      <button className="rail-button" aria-label="Redo" disabled={!props.canRedo} onClick={props.onRedo}><Icon name="redo" size={16} /></button>
      <button className="rail-button" aria-label="Clear canvas" disabled={!props.canClear} onClick={props.onClear}><Icon name="close" size={16} /></button>
    </div>
    <div className="left-zoom"><button className="rail-button" aria-label="Zoom in" onClick={() => props.onZoom(.1)}><Icon name="plus" size={14} /></button><button aria-label="Fit canvas frames" onClick={props.onFit}>{Math.round(props.zoom * 100)}%</button><button className="rail-button" aria-label="Zoom out" onClick={() => props.onZoom(-.1)}><Icon name="minus" size={14} /></button></div>
    <button className="help-button" aria-label="Keyboard shortcuts" onClick={props.onHelp}>?</button>
  </nav>;
}
