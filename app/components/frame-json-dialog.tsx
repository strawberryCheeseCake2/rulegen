import { useMemo, useRef, useState } from "react";
import type { FrameExport } from "../lib/frame-export";
import { downloadFile } from "../lib/project";
import { Icon } from "./icons";

/** One frame as JSON (state machines, constraints, code): preview, copy and download. */
export function FrameJsonDialog({ name, data, onClose, onCopied }: { name: string; data: FrameExport; onClose: () => void; onCopied: (message: string) => void }) {
  const text = useMemo(() => JSON.stringify(data, null, 2), [data]);
  const area = useRef<HTMLTextAreaElement>(null), [note, setNote] = useState("");
  const machines = data.nodes.filter(node => node.machine), states = machines.reduce((n, node) => n + node.machine!.states.length, 0);
  const constraints = data.nodes.reduce((n, node) => n + Object.keys(node.constraints).length, 0);
  const tools = data.brushes.reduce((n, brush) => n + brush.targetedInspections.length, 0);
  async function copy() {
    try { await navigator.clipboard.writeText(text); onCopied(`${name}의 JSON을 복사했습니다.`); onClose(); }
    // The clipboard can be refused (permissions, an unfocused page): the text is selected to copy by hand.
    catch { area.current?.focus(); area.current?.select(); setNote("자동 복사가 막혔습니다. 선택된 내용을 ⌘C / Ctrl+C로 복사하세요."); }
  }
  return <div className="modal-backdrop" onClick={onClose}><div className="modal project-export-modal frame-json-modal" role="dialog" aria-modal="true" aria-labelledby="frame-json-title" onClick={e => e.stopPropagation()}>
    <button className="modal-close" aria-label="Close frame JSON" onClick={onClose}><Icon name="close" /></button>
    <div className="section-kicker">FRAME JSON</div><h2 id="frame-json-title">{name}</h2>
    <p>노드 {data.nodes.length}개 · state machine {machines.length}개(state {states}개) · constraint {constraints}개 · 알고리즘 {data.algorithms.length}개 · targeted inspection {tools}개 · 코드 {data.code ? `${data.code.source.split("\n").length}줄` : "없음"}.
      노드마다 semantic transformation(값 범위와 알고리즘 블록 포함), 기본 constraint 값, state별 전체 constraint 값과 바뀐 key, transition이 들어 있고, brush마다 targeted inspection 도구(concern, annotation, 요약, overlay, value fix, recommendation)가 이 프레임의 노드 id로 들어 있습니다. 코드는 코드 패널과 같습니다.</p>
    <textarea ref={area} aria-label="Frame JSON" className="project-json-preview" readOnly value={text} />
    {note && <p className="frame-json-note" role="status">{note}</p>}
    <div className="frame-json-actions">
      <button className="primary-button" onClick={() => { void copy(); }}>Copy JSON<Icon name="copy" /></button>
      <button className="copy-button" onClick={() => downloadFile(`${name}.frame.json`, text, "application/json")}>Download<Icon name="download" size={14} /></button>
    </div>
  </div></div>;
}
