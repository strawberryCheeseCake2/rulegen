import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Prism from "prismjs";
import { Icon } from "./icons";
import { PanelResizer } from "./panel-resizer";
import { downloadFile } from "../lib/project";

type CodeSegment = { text: string; className: string };

function highlightLines(code: string) {
  const lines: CodeSegment[][] = [[]];
  // Tokenize the whole source so multiline comments and strings retain their context.
  function append(token: string | Prism.Token, classes: string[] = []) {
    if (typeof token !== "string") {
      const children = Array.isArray(token.content) ? token.content : [token.content];
      for (const child of children) append(child, [...classes, token.type]);
      return;
    }
    const parts = token.split("\n");
    for (let index = 0; index < parts.length; index++) {
      if (index) lines.push([]);
      if (parts[index]) lines[lines.length - 1].push({ text: parts[index], className: classes.length ? `token ${classes.join(" ")}` : "" });
    }
  }
  for (const token of Prism.tokenize(code, Prism.languages.javascript)) append(token);
  return lines;
}

const HEIGHT_KEY = "rulegen.bottomPanelHeight", MIN_HEIGHT = 100, SIDE_KEY = "rulegen.bottomSideWidth", MIN_SIDE = 260;

export function RawCodePanel({ code, sketchName, fileName, onCopy, onError, machinePanel, inspectionPanel, editor }: {
  code: string;
  /** Editing the generated code (replaces the old inspector Code tab). */
  editor?: { draft: string; busy: boolean; runtimeError: string; onDraft: (code: string) => void; onRun: () => void; onFix: () => void };
  sketchName: string;
  fileName: string;
  onCopy: () => void;
  onError: (message: string) => void;
  machinePanel?: ReactNode;
  /** Shown while one of a brush's inspection tools is selected: its own pane beside Code / State Machine, so the graph stays in view. */
  inspectionPanel?: ReactNode;
}) {
  const [expanded, setExpanded] = useState(true);
  const [mode, setMode] = useState<"code" | "machine">("code");
  const inspecting = Boolean(inspectionPanel);
  // Inspecting opens the panel with the state machine beside it (the inspected states are highlighted there).
  useEffect(() => { if (inspecting) { setMode("machine"); setExpanded(true); } }, [inspecting]);
  // The width of the Code / State Machine pane beside the inspection, dragged on its left edge; remembered in this browser.
  const [side, setSide] = useState<number | null>(null);
  const sidePane = useRef<HTMLDivElement>(null);
  useEffect(() => { try { const saved = Number(localStorage.getItem(SIDE_KEY)); if (saved >= MIN_SIDE) setSide(saved); } catch { /* storage unavailable */ } }, []);
  const resizeSide = (next: number | null) => { setSide(next); try { if (next === null) localStorage.removeItem(SIDE_KEY); else localStorage.setItem(SIDE_KEY, String(next)); } catch { /* storage unavailable */ } };
  const [editing, setEditing] = useState(false);
  // The panel's height (Code, State Machine and Inspection alike), dragged on its top edge; remembered in this browser.
  const [height, setHeight] = useState<number | null>(null);
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => { try { const saved = Number(localStorage.getItem(HEIGHT_KEY)); if (saved >= MIN_HEIGHT) setHeight(saved); } catch { /* storage unavailable */ } }, []);
  const resize = (next: number | null) => { setHeight(next); try { if (next === null) localStorage.removeItem(HEIGHT_KEY); else localStorage.setItem(HEIGHT_KEY, String(next)); } catch { /* storage unavailable */ } };
  const sized = height ? { height, minHeight: 0 } : undefined;
  const lines = useMemo(() => highlightLines(code), [code]);

  async function copyCode() {
    try { await navigator.clipboard.writeText(code); onCopy(); }
    catch { onError("클립보드에 접근하지 못했습니다. 다운로드를 이용해주세요."); }
  }

  return <section className={`raw-code-panel ${expanded ? "expanded" : "collapsed"} ${mode !== "code" ? "machine-mode" : ""}`} aria-label="Raw p5.js code panel">
    {expanded && <PanelResizer axis="y" label="Resize bottom panel" min={MIN_HEIGHT} max={typeof window === "undefined" ? 900 : Math.max(MIN_HEIGHT, Math.round(window.innerHeight * .8))}
      measure={() => body.current?.getBoundingClientRect().height ?? 220} onResize={resize} onReset={() => resize(null)} />}
    <header className="raw-code-header">
      <button className="raw-code-toggle" aria-label="Raw p5.js" title={expanded ? "Collapse bottom panel" : "Expand bottom panel"} aria-expanded={expanded} aria-controls="raw-p5-code" onClick={() => setExpanded(open => !open)}>
        <Icon name="code" size={16} /><strong>Raw p5.js</strong><Icon name="chevron" size={13} />
      </button>
      {machinePanel && <div className="bottom-panel-modes" role="tablist" aria-label="Bottom panel mode"><button role="tab" aria-selected={mode === "code"} onClick={() => setMode("code")}><Icon name="code" size={13} />Code</button><button role="tab" aria-selected={mode === "machine"} onClick={() => setMode("machine")}><Icon name="grid" size={13} />State Machine</button></div>}
      <span className="raw-code-sketch" title={sketchName}>{sketchName}</span>
      {code && mode === "code" && <span className="raw-code-count">{lines.length} lines</span>}
      <div className="raw-code-actions">
        {editor && code && mode === "code" && <button className="raw-code-edit" aria-pressed={editing} title={editing ? "Show highlighted code" : "Edit code"} onClick={() => setEditing(value => !value)}><Icon name="edit" size={15} /></button>}
        {editor && editing && mode === "code" && <button className="raw-code-run" title="Run edited code" aria-label="Run edited code" disabled={editor.busy} onClick={editor.onRun}><Icon name="play" size={14} /></button>}
        <button aria-label="Copy raw p5.js code" title="Copy code" disabled={!code} onClick={() => { void copyCode(); }}><Icon name="copy" size={15} /></button>
        <button aria-label="Download raw p5.js code" title="Download code" disabled={!code} onClick={() => downloadFile(`${fileName}.js`, code)}><Icon name="download" size={15} /></button>
      </div>
    </header>
    {expanded && mode === "code" && editor?.runtimeError && <div className="runtime-error raw-runtime-error" role="alert">{editor.runtimeError}<button disabled={editor.busy} onClick={editor.onFix}>Fix with AI</button></div>}
    {expanded && (() => {
      const split = Boolean(inspectionPanel);
      const pane = mode === "machine" ? <div ref={split ? undefined : body} style={split ? undefined : sized} id="raw-p5-code" role="tabpanel" className="machine-panel-content">{machinePanel}</div>
        : <div ref={split ? undefined : body} style={split ? undefined : sized} id="raw-p5-code" role="tabpanel" className="raw-code-body">
      {editor && editing && code ? <textarea className="raw-code-editor" spellCheck={false} aria-label="Generated p5.js code" value={editor.draft} onChange={e => editor.onDraft(e.target.value)} />
        : code ? <pre tabIndex={0} aria-label="Raw p5.js source"><code>{lines.map((line, index) => <span className="raw-code-line" key={index}><span className="raw-code-number" aria-hidden="true">{index + 1}</span><span>{line.length ? line.map((segment, part) => <span key={part} className={segment.className || undefined}>{segment.text}</span>) : "\n"}</span></span>)}</code></pre>
        : <div className="raw-code-empty">No generated p5.js code</div>}
    </div>;
      if (!split) return pane;
      return <div ref={body} style={sized} className="bottom-panel-split">
        <section className="inspection-dock inspection-panel-content" aria-label="Inspection">{inspectionPanel}</section>
        <div ref={sidePane} className="bottom-panel-side" style={side ? { width: side } : undefined}>
          <PanelResizer label="Resize inspection and state machine panes" min={MIN_SIDE} max={typeof window === "undefined" ? 900 : Math.max(MIN_SIDE, Math.round(window.innerWidth * .7))}
            measure={() => sidePane.current?.getBoundingClientRect().width ?? 420} onResize={resizeSide} onReset={() => resizeSide(null)} />
          {pane}</div>
      </div>;
    })()}
  </section>;
}
