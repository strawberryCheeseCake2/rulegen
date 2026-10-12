import { useMemo, useState, type ReactNode } from "react";
import Prism from "prismjs";
import { Icon } from "./icons";
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

export function RawCodePanel({ code, sketchName, fileName, onCopy, onError, machinePanel }: {
  code: string;
  sketchName: string;
  fileName: string;
  onCopy: () => void;
  onError: (message: string) => void;
  machinePanel?: ReactNode;
}) {
  const [expanded, setExpanded] = useState(true);
  const [mode, setMode] = useState<"code" | "machine">("code");
  const lines = useMemo(() => highlightLines(code), [code]);

  async function copyCode() {
    try { await navigator.clipboard.writeText(code); onCopy(); }
    catch { onError("클립보드에 접근하지 못했습니다. 다운로드를 이용해주세요."); }
  }

  return <section className={`raw-code-panel ${expanded ? "expanded" : "collapsed"} ${mode === "machine" ? "machine-mode" : ""}`} aria-label="Raw p5.js code panel">
    <header className="raw-code-header">
      <button className="raw-code-toggle" aria-label="Raw p5.js" title={expanded ? "Collapse bottom panel" : "Expand bottom panel"} aria-expanded={expanded} aria-controls="raw-p5-code" onClick={() => setExpanded(open => !open)}>
        <Icon name="code" size={16} /><strong>Raw p5.js</strong><Icon name="chevron" size={13} />
      </button>
      {machinePanel && <div className="bottom-panel-modes" role="tablist" aria-label="Bottom panel mode"><button role="tab" aria-selected={mode === "code"} onClick={() => setMode("code")}><Icon name="code" size={13} />Code</button><button role="tab" aria-selected={mode === "machine"} onClick={() => setMode("machine")}><Icon name="grid" size={13} />State Machine</button></div>}
      <span className="raw-code-sketch" title={sketchName}>{sketchName}</span>
      {code && mode === "code" && <span className="raw-code-count">{lines.length} lines</span>}
      <div className="raw-code-actions">
        <button aria-label="Copy raw p5.js code" title="Copy code" disabled={!code} onClick={() => { void copyCode(); }}><Icon name="copy" size={15} /></button>
        <button aria-label="Download raw p5.js code" title="Download code" disabled={!code} onClick={() => downloadFile(`${fileName}.js`, code)}><Icon name="download" size={15} /></button>
      </div>
    </header>
    {expanded && (mode === "machine" ? <div id="raw-p5-code" role="tabpanel" className="machine-panel-content">{machinePanel}</div> : <div id="raw-p5-code" role="tabpanel" className="raw-code-body">
      {code ? <pre tabIndex={0} aria-label="Raw p5.js source"><code>{lines.map((line, index) => <span className="raw-code-line" key={index}><span className="raw-code-number" aria-hidden="true">{index + 1}</span><span>{line.length ? line.map((segment, part) => <span key={part} className={segment.className || undefined}>{segment.text}</span>) : "\n"}</span></span>)}</code></pre>
        : <div className="raw-code-empty">No generated p5.js code</div>}
    </div>)}
  </section>;
}
