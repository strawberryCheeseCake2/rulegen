import type { SemanticPen } from "../lib/schema";
import { BRUSH_TOOLS, brushGroup, brushTool, groupBrushes, parseBrushTool, subBrushes, type Brush, type BrushToolKind } from "../lib/brushes";
import { AlgorithmPenSettings } from "./algorithm-pen-settings";
import { Icon, type IconName } from "./icons";

type Props = {
  /** The inspection annotation tool is in use: the Eraser erases its marks (true = erasing now; undefined = not in use). */
  inspectionEraser?: boolean;
  tool: string; toolsActive: boolean; pencilOpen: boolean; color: string; width: number; opacity: number;
  pens: SemanticPen[]; activePen: SemanticPen | undefined; penSettingsOpen: boolean;
  busy: boolean; canAddSketch: boolean; canUndo: boolean; canRedo: boolean; canClear: boolean; zoom: number;
  onTool: (tool: string) => void; onPencilClose: () => void; onColor: (color: string) => void; onWidth: (width: number) => void; onOpacity: (opacity: number) => void;
  onPen: (pen: SemanticPen) => void; onPenChange: (pen: SemanticPen) => void; onPenRemove: (pen: SemanticPen) => void; onPenSettingsClose: () => void;
  onUndo: () => void; onRedo: () => void; onClear: () => void; onZoom: (amount: number) => void; onFit: () => void;
  onHome: () => void; onAddSketch: () => void; onAttach: () => void; onHelp: () => void;
  /** Brush tool groups: one per reusable collection; `groupTools` is the tool each group shows. */
  brushes?: Brush[]; groupTools?: Record<string, string>; openGroup?: string | null;
  onBrushGroup?: (brushId: string) => void; onBrushTool?: (brushId: string, toolId: string) => void; onBrushGroupClose?: () => void;
  onTargetedRemove?: (brushId: string, targetedId: string) => void;
  onBrushChange?: (brush: Brush) => void; onBrushRemove?: (brush: Brush) => void;
  /** The frame holding a brush's master (null when gone), and showing it. */
  brushMaster?: (brush: Brush) => string | null; onBrushMaster?: (brush: Brush) => void;
};

export const BRUSH_TOOL_INFO: Record<BrushToolKind, { icon: IconName; label: string; hint: string }> = {
  brush: { icon: "brush", label: "Brush", hint: "Brush on a frame: adds this brush where you start if the frame doesn't have it yet; on a frame that has it, you play with it (the result takes your input, Esc to stop)." },
  inspect: { icon: "inspect", label: "Inspection", hint: "Step through states, transitions and constraint values of this brush." },
  "inspect-annotate": { icon: "inspect-pen", label: "Inspection annotation", hint: "Mark a concern on the frame; each one becomes a targeted inspection tool." },
  targeted: { icon: "target", label: "Targeted inspection", hint: "A visualization, fixes and recommendations tailored to one concern." },
};

/** Left toolbar: frames, drawing tools, semantic pens, history and zoom. */
export function ToolRail(props: Props) {
  const toolButton = (name: string, icon: IconName, label: string) => {
    const active = (props.tool === name || (name === "eraser" && props.inspectionEraser)) && props.toolsActive;
    const hint = name === "eraser" && props.inspectionEraser !== undefined ? `${label} · inspection annotation 지우기` : label;
    return <button className={`rail-button ${active ? "active" : ""}`} aria-label={label} title={hint} aria-pressed={active} aria-expanded={name === "pen" ? props.pencilOpen : undefined} onClick={() => props.onTool(name)}><Icon name={icon} /></button>;
  };
  return <nav className="rail" aria-label="Workspace toolbar">
    <button className="rail-button" aria-label="Exploration workspace" onClick={props.onHome}><Icon name="grid" size={20} /></button>
    <button className="rail-button" aria-label="Add sketch frame" title="Add sketch frame" disabled={!props.canAddSketch} onClick={props.onAddSketch}><Icon name="plus" size={20} /></button>
    <button className="rail-button" aria-label="Attach photo" title="Attach photo" onClick={props.onAttach}><Icon name="upload" size={20} /></button>
    <div className="rail-line" />
    <div className="left-sketch-tools" role="toolbar" aria-label="Sketch tools">
      {toolButton("select", "select", "Select and move brush stamps (V)")}
      <div className="left-tool-anchor">{toolButton("pen", "pen", "Pencil")}{props.pencilOpen && <div className="pencil-popover" role="group" aria-label="Pencil settings">
        <div className="pencil-popover-heading"><span>Pencil settings</span><button aria-label="Close pencil settings" onClick={props.onPencilClose}><Icon name="close" size={14} /></button></div>
        <span className="left-setting-title">INK COLOR</span>
        <div className="left-colors">{["#75664e", "#397461", "#333a3b", "#b56850"].map(c => <button key={c} className={`color ${props.color === c ? "active" : ""}`} style={{ background: c }} aria-label={`Select color ${c}`} aria-pressed={props.color === c} onClick={() => props.onColor(c)} />)}</div>
        <label><span>Size</span><input aria-label="Pencil size" type="range" min="1" max="20" value={props.width} onChange={e => props.onWidth(+e.target.value)} /><output>{props.width}px</output></label>
        <label><span>Opacity</span><input aria-label="Pencil opacity" type="range" min="5" max="100" value={props.opacity} onChange={e => props.onOpacity(+e.target.value)} /><output>{props.opacity}%</output></label>
      </div>}</div>
      {toolButton("eraser", "eraser", "Eraser")}{toolButton("lasso", "lasso", "Lasso selection")}{toolButton("hand", "hand", "Pan")}
      {props.pens.length > 0 && <div className="left-tool-anchor algorithm-pen-anchor"><div className="algorithm-pen-toolbar" role="group" aria-label="Drawing pens">{props.pens.map(pen => {
        const active = props.tool === "semantic" && props.activePen?.id === pen.id;
        return <button key={pen.id} style={{ color: pen.color }} className={`rail-button algorithm-pen-button ${active ? "active" : ""}`} title={`${pen.name} · ${pen.meaning}`} aria-label={pen.kind === "interaction" ? "Use Interaction pen" : `Use algorithm pen ${pen.name}`} aria-pressed={active} onClick={() => props.onPen(pen)}><Icon name={pen.kind === "interaction" ? "interaction" : "pen"} size={18} /><span className="semantic-pen-dot" style={{ background: pen.color }} /></button>;
      })}</div>
        {props.penSettingsOpen && props.activePen && props.tool === "semantic" && <AlgorithmPenSettings pen={props.activePen} onChange={props.onPenChange} onClose={props.onPenSettingsClose} onRemove={props.activePen.kind === "interaction" ? undefined : () => props.onPenRemove(props.activePen!)} />}
      </div>}
      {(props.brushes?.length ?? 0) > 0 && <div className="brush-groups" role="group" aria-label="Brush tool groups">{groupBrushes(props.brushes!).map(brush => {
        // A group is selected when one of its tools is, or a tool of one of its sub brushes (minimal examples).
        const all = props.brushes!, subs = subBrushes(all, brush.id), selected = parseBrushTool(props.tool), inGroup = Boolean(props.toolsActive && selected && brushGroup(all, selected.brushId) === brush.id);
        const own = inGroup && selected!.brushId === brush.id;
        const shown = inGroup ? selected : parseBrushTool(props.groupTools?.[brush.id] || ""), kind: BrushToolKind = shown?.kind || "brush";
        const owner = all.find(item => item.id === shown?.brushId) ?? brush, sub = owner.id !== brush.id ? owner : undefined;
        const targetedName = kind === "targeted" ? owner.targeted.find(item => item.id === shown?.targetedId)?.name : undefined;
        const info = BRUSH_TOOL_INFO[kind], open = props.openGroup === brush.id;
        return <div key={brush.id} className="left-tool-anchor brush-group-anchor">
          <button className={`rail-button brush-group-button ${inGroup ? "active" : ""}`} style={{ color: brush.color }} aria-label={`${brush.name} brush tools`} title={`${brush.name}${sub ? ` › ${sub.name}` : ""} · ${targetedName || info.label}${inGroup ? " (click again for tools)" : ""}`}
            aria-pressed={inGroup} aria-expanded={open} onClick={() => props.onBrushGroup?.(brush.id)}><Icon name={info.icon} size={18} /><span className="semantic-pen-dot" style={{ background: brush.color }} /><span className="brush-group-corner" /></button>
          {open && <div className="pencil-popover brush-group-popover" role="group" aria-label={`${brush.name} brush tools`}>
            <div className="pencil-popover-heading"><span><i className="brush-swatch" style={{ background: brush.color }} />{brush.name}</span><button aria-label="Close brush tools" onClick={props.onBrushGroupClose}><Icon name="close" size={14} /></button></div>
            {/* The panel keeps one height; its tools scroll (targeted tools and sub brushes can be many). */}
            <div className="brush-group-body">
            <div className="brush-group-tools">{BRUSH_TOOLS.map(tool => {
              const active = own && selected!.kind === tool;
              return <button key={tool} className={active ? "active" : ""} aria-pressed={active} title={BRUSH_TOOL_INFO[tool].hint} onClick={() => props.onBrushTool?.(brush.id, brushTool(tool, brush.id))}><Icon name={BRUSH_TOOL_INFO[tool].icon} size={15} /><span>{BRUSH_TOOL_INFO[tool].label}</span></button>;
            })}
            {brush.targeted.map(tool => {
              const active = own && selected!.kind === "targeted" && selected!.targetedId === tool.id;
              return <div key={tool.id} className="brush-targeted-row"><button className={active ? "active" : ""} aria-pressed={active} title={`${BRUSH_TOOL_INFO.targeted.hint}\n${tool.concern}`} onClick={() => props.onBrushTool?.(brush.id, brushTool("targeted", brush.id, tool.id))}>
                <Icon name="target" size={15} /><span>{tool.name}</span></button>
                {props.onTargetedRemove && <button className="brush-targeted-remove" aria-label={`Remove targeted inspection ${tool.name}`} title="Remove this targeted inspection" onClick={() => props.onTargetedRemove!(brush.id, tool.id)}><Icon name="close" size={11} /></button>}</div>;
            })}
            {!brush.targeted.length && <span className="brush-targeted-hint">Inspection annotation으로 concern을 표시하면 Targeted inspection 도구가 여기에 생깁니다.</span>}</div>
            {/* Minimal examples of this brush's transformations: each a brush of its own (brush with it, inspect it). */}
            {subs.length > 0 && <div className="brush-sub-list" role="group" aria-label={`${brush.name} sub brushes`}><span className="left-setting-title">SUB BRUSHES</span>
              {subs.map(item => { const picked = inGroup && selected!.brushId === item.id;
                return <div key={item.id} className={`brush-sub-row ${picked ? "picked" : ""}`}>
                  {(["brush", "inspect"] as const).map(tool => { const active = picked && selected!.kind === tool;
                    return <button key={tool} className={active ? "active" : ""} aria-pressed={active} aria-label={`${item.name} ${BRUSH_TOOL_INFO[tool].label}`} title={`${item.name} · ${BRUSH_TOOL_INFO[tool].label}`} onClick={() => props.onBrushTool?.(brush.id, brushTool(tool, item.id))}>
                      <Icon name={BRUSH_TOOL_INFO[tool].icon} size={14} />{tool === "brush" && <span>{item.name}</span>}</button>; })}
                  {props.onBrushRemove && <button className="brush-targeted-remove" aria-label={`Remove sub brush ${item.name}`} title="Remove this sub brush" onClick={() => props.onBrushRemove!(item)}><Icon name="close" size={11} /></button>}</div>; })}</div>}
            {props.brushMaster && (() => { const master = props.brushMaster(brush);
              return <div className="brush-master-row"><span className="left-setting-title">MASTER</span>
                {master ? <button title="Show the master of this brush" onClick={() => props.onBrushMaster?.(brush)}>◆ {master}<Icon name="arrow" size={12} /></button> : <span className="brush-targeted-hint">Master가 있던 프레임이 삭제되었습니다. Instance에서 Make master로 지정할 수 있습니다.</span>}</div>; })()}
            <label className="brush-name-field"><span>Name</span><input maxLength={100} value={brush.name} onChange={e => { if (e.target.value.trim()) props.onBrushChange?.({ ...brush, name: e.target.value }); }} /></label>
            {props.onBrushRemove && <button className="brush-remove" onClick={() => props.onBrushRemove!(brush)}><Icon name="trash" size={13} />Remove brush</button>}
            </div>
          </div>}
        </div>;
      })}</div>}
      <div className="rail-line" />
      <button className="rail-button" aria-label="Undo" disabled={!props.canUndo} onClick={props.onUndo}><Icon name="undo" size={16} /></button>
      <button className="rail-button" aria-label="Redo" disabled={!props.canRedo} onClick={props.onRedo}><Icon name="redo" size={16} /></button>
      <button className="rail-button" aria-label="Clear canvas" disabled={!props.canClear} onClick={props.onClear}><Icon name="close" size={16} /></button>
    </div>
    <div className="left-zoom"><button className="rail-button" aria-label="Zoom in" onClick={() => props.onZoom(.1)}><Icon name="plus" size={14} /></button><button aria-label="Fit canvas frames" onClick={props.onFit}>{Math.round(props.zoom * 100)}%</button><button className="rail-button" aria-label="Zoom out" onClick={() => props.onZoom(-.1)}><Icon name="minus" size={14} /></button></div>
    <button className="help-button" aria-label="Keyboard shortcuts" onClick={props.onHelp}>?</button>
  </nav>;
}
