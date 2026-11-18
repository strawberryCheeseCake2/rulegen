import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Prism from "prismjs";
import { Icon } from "./icons";
import { PanelResizer } from "./panel-resizer";
import { downloadFile } from "../lib/project";
import type { CodeFocus } from "../lib/code-focus";

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

/** Typing in the code: Tab indents (two spaces), ⌘/Ctrl+Enter runs it; the board's shortcuts do not fire. */
function editKey(e: React.KeyboardEvent<HTMLTextAreaElement>, onValue: (text: string) => void, onRun: () => void) {
  e.stopPropagation();
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); onRun(); return; }
  if (e.key !== "Tab" || e.shiftKey || e.altKey || e.metaKey || e.ctrlKey) return;
  e.preventDefault();
  const field = e.currentTarget, { selectionStart: from, selectionEnd: to, value } = field;
  onValue(value.slice(0, from) + "  " + value.slice(to));
  requestAnimationFrame(() => field.setSelectionRange(from + 2, from + 2));
}
/**
 * The code, highlighted with numbered lines (those `focus` is about marked, and those using what they read), and when
 * `onValue` is given editable right there: a transparent text area lies over the code column, so typing edits what is
 * shown, highlighted as it is typed.
 */
function CodeView({ code, focus, onValue, onRun, disabled }: { code: string; focus?: CodeFocus | null; onValue?: (text: string) => void; onRun?: () => void; disabled?: boolean }) {
  const rows = useMemo(() => highlightLines(code), [code]);
  const surface = useRef<HTMLDivElement>(null), [column, setColumn] = useState<{ left: number; top: number } | null>(null);
  // Where the code column starts (after the line numbers), so the text area's text lies on the code.
  useLayoutEffect(() => { const first = surface.current?.querySelector<HTMLElement>(".raw-code-line > .raw-code-text"); if (!first) return;
    const box = surface.current!.getBoundingClientRect(), at = first.getBoundingClientRect(), next = { left: Math.round(at.left - box.left), top: Math.round(at.top - box.top) };
    if (next.left !== column?.left || next.top !== column?.top) setColumn(next); });
  const marked = new Set(focus?.lines ?? []), near = new Set(focus?.related ?? []);
  // The first line focused comes into view.
  const first = focus?.lines[0];
  useEffect(() => { if (first === undefined) return; const line = surface.current?.querySelectorAll<HTMLElement>(".raw-code-line")[first], scroller = surface.current?.parentElement;
    if (line && scroller) scroller.scrollTo({ top: Math.max(0, line.offsetTop - scroller.clientHeight / 3), behavior: "smooth" }); }, [first, focus?.label]);
  return <div ref={surface} className={`raw-code-surface ${onValue ? "editable" : ""}`}>
    <pre tabIndex={onValue ? -1 : 0} aria-label="Raw p5.js source" aria-hidden={onValue ? true : undefined}><code>{rows.map((line, index) =>
      <span className={`raw-code-line${marked.has(index) ? " focused" : near.has(index) ? " related" : ""}`} key={index}><span className="raw-code-number" aria-hidden="true">{index + 1}</span>
        <span className="raw-code-text">{line.length ? line.map((segment, part) => <span key={part} className={segment.className || undefined}>{segment.text}</span>) : "\n"}</span></span>)}</code></pre>
    {onValue && <textarea className={`raw-code-input${column ? "" : " measuring"}`} style={column ? { left: column.left, top: column.top } : undefined} spellCheck={false} autoCapitalize="off" autoComplete="off" autoCorrect="off" wrap="off" disabled={disabled}
      aria-label="p5.js code (edit it here; ⌘/Ctrl+Enter runs it)" value={code} onChange={e => onValue(e.target.value)} onKeyDown={e => editKey(e, onValue, onRun ?? (() => {}))} />}
  </div>;
}

const HEIGHT_KEY = "rulegen.bottomPanelHeight", MIN_HEIGHT = 100, SIDE_KEY = "rulegen.bottomSideWidth", MIN_SIDE = 260;

export function RawCodePanel({ code, sketchName, fileName, onCopy, onError, machinePanel, inspectionPanel, editor, focus }: {
  code: string;
  /** Editing the code in place (`draft`: as edited; it runs with `onRun`). */
  editor?: { draft: string; busy: boolean; runtimeError: string; onDraft: (code: string) => void; onRun: () => void; onFix: () => void };
  /** The code an inspection's focus (a chip, a param, a state…) is about, in the code shown. */
  focus?: CodeFocus | null;
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
  // The panel's height (Code, State Machine and Inspection alike), dragged on its top edge; remembered in this browser.
  const [height, setHeight] = useState<number | null>(null);
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => { try { const saved = Number(localStorage.getItem(HEIGHT_KEY)); if (saved >= MIN_HEIGHT) setHeight(saved); } catch { /* storage unavailable */ } }, []);
  const resize = (next: number | null) => { setHeight(next); try { if (next === null) localStorage.removeItem(HEIGHT_KEY); else localStorage.setItem(HEIGHT_KEY, String(next)); } catch { /* storage unavailable */ } };
  const sized = height ? { height, minHeight: 0 } : undefined;
  // What is shown is what is edited; edited and not run yet, it can be run or put back.
  const shown = editor ? editor.draft || code : code, edited = Boolean(editor && editor.draft && editor.draft !== code);
  const count = useMemo(() => shown ? shown.split("\n").length : 0, [shown]);
  // A focus on a value (or a suggestion, a constraint) shows its code; a state or transition stays in the state machine (the Code tab says how many lines).
  const focusKey = focus ? `${focus.label}:${focus.lines.join(",")}` : "";
  useEffect(() => { if (focus && focus.lines.length && focus.kind !== "state" && focus.kind !== "transition") { setMode("code"); setExpanded(true); } }, [focusKey]);

  async function copyCode() {
    try { await navigator.clipboard.writeText(code); onCopy(); }
    catch { onError("Couldn't access the clipboard. Please use download instead."); }
  }

  return <section className={`raw-code-panel ${expanded ? "expanded" : "collapsed"} ${mode !== "code" ? "machine-mode" : ""}`} aria-label="Raw p5.js code panel">
    {expanded && <PanelResizer axis="y" label="Resize bottom panel" min={MIN_HEIGHT} max={typeof window === "undefined" ? 900 : Math.max(MIN_HEIGHT, Math.round(window.innerHeight * .8))}
      measure={() => body.current?.getBoundingClientRect().height ?? 220} onResize={resize} onReset={() => resize(null)} />}
    <header className="raw-code-header">
      <button className="raw-code-toggle" aria-label="Raw p5.js" title={expanded ? "Collapse bottom panel" : "Expand bottom panel"} aria-expanded={expanded} aria-controls="raw-p5-code" onClick={() => setExpanded(open => !open)}>
        <Icon name="code" size={16} /><strong>Raw p5.js</strong><Icon name="chevron" size={13} />
      </button>
      {machinePanel && <div className="bottom-panel-modes" role="tablist" aria-label="Bottom panel mode"><button role="tab" aria-selected={mode === "code"} onClick={() => setMode("code")}
        title={focus ? `${focus.lines.length} line(s) of ${focus.label}` : undefined}><Icon name="code" size={13} />Code{focus && mode !== "code" ? <b className="raw-code-badge">{focus.lines.length}</b> : null}</button><button role="tab" aria-selected={mode === "machine"} onClick={() => setMode("machine")}><Icon name="grid" size={13} />State Machine</button></div>}
      <span className="raw-code-sketch" title={sketchName}>{sketchName}</span>
      {focus && mode === "code" && <span className="raw-code-focus" title={`${focus.lines.length} line(s) refer to it; ${focus.related.length} more use what they read`}>{focus.label} · {focus.lines.length}</span>}
      {edited && mode === "code" && <span className="raw-code-edited">Edited · ⌘↵ runs</span>}
      {code && mode === "code" && <span className="raw-code-count">{count} lines</span>}
      <div className="raw-code-actions">
        {editor && edited && mode === "code" && <button className="raw-code-revert" title="Put the code back as it runs now" aria-label="Revert edits" disabled={editor.busy} onClick={() => editor.onDraft(code)}><Icon name="undo" size={14} /></button>}
        {editor && code && mode === "code" && <button className="raw-code-run" title="Run the code as edited (⌘/Ctrl+Enter)" aria-label="Run edited code" disabled={editor.busy || !edited} onClick={editor.onRun}><Icon name="play" size={14} /></button>}
        <button aria-label="Copy raw p5.js code" title="Copy code" disabled={!code} onClick={() => { void copyCode(); }}><Icon name="copy" size={15} /></button>
        <button aria-label="Download raw p5.js code" title="Download code" disabled={!code} onClick={() => downloadFile(`${fileName}.js`, code)}><Icon name="download" size={15} /></button>
      </div>
    </header>
    {expanded && mode === "code" && editor?.runtimeError && <div className="runtime-error raw-runtime-error" role="alert">{editor.runtimeError}<button disabled={editor.busy} onClick={editor.onFix}>Fix with AI</button></div>}
    {expanded && (() => {
      const split = Boolean(inspectionPanel);
      const pane = mode === "machine" ? <div ref={split ? undefined : body} style={split ? undefined : sized} id="raw-p5-code" role="tabpanel" className="machine-panel-content">{machinePanel}</div>
        : <div ref={split ? undefined : body} style={split ? undefined : sized} id="raw-p5-code" role="tabpanel" className="raw-code-body">
      {code ? <CodeView code={shown} focus={focus} onValue={editor?.onDraft} onRun={editor?.onRun} disabled={editor?.busy} />
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
