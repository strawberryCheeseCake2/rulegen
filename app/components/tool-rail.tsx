import type { SemanticPen } from "../lib/schema";
import { AlgorithmPenSettings } from "./algorithm-pen-settings";
import { Icon, type IconName } from "./icons";

type Props = {
  tool: string; toolsActive: boolean; pencilOpen: boolean; color: string; width: number; opacity: number;
  pens: SemanticPen[]; activePen: SemanticPen | undefined; penSettingsOpen: boolean;
  busy: boolean; canAddSketch: boolean; canUndo: boolean; canRedo: boolean; canClear: boolean; zoom: number;
  onTool: (tool: string) => void; onPencilClose: () => void; onColor: (color: string) => void; onWidth: (width: number) => void; onOpacity: (opacity: number) => void;
  onPen: (pen: SemanticPen) => void; onPenChange: (pen: SemanticPen) => void; onPenRemove: (pen: SemanticPen) => void; onPenSettingsClose: () => void;
  onUndo: () => void; onRedo: () => void; onClear: () => void; onZoom: (amount: number) => void; onFit: () => void;
  onHome: () => void; onAddSketch: () => void; onAttach: () => void; onHelp: () => void;
};

/** Left toolbar: frames, drawing tools, semantic pens, history and zoom. */
export function ToolRail(props: Props) {
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
      {toolButton("select", "select", "Select and move collections (V)")}
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
      <div className="rail-line" />
      <button className="rail-button" aria-label="Undo" disabled={!props.canUndo} onClick={props.onUndo}><Icon name="undo" size={16} /></button>
      <button className="rail-button" aria-label="Redo" disabled={!props.canRedo} onClick={props.onRedo}><Icon name="redo" size={16} /></button>
      <button className="rail-button" aria-label="Clear canvas" disabled={!props.canClear} onClick={props.onClear}><Icon name="close" size={16} /></button>
    </div>
    <div className="left-zoom"><button className="rail-button" aria-label="Zoom in" onClick={() => props.onZoom(.1)}><Icon name="plus" size={14} /></button><button aria-label="Fit canvas frames" onClick={props.onFit}>{Math.round(props.zoom * 100)}%</button><button className="rail-button" aria-label="Zoom out" onClick={() => props.onZoom(-.1)}><Icon name="minus" size={14} /></button></div>
    <button className="help-button" aria-label="Keyboard shortcuts" onClick={props.onHelp}>?</button>
  </nav>;
}
