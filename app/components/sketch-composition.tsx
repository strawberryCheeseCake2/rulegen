import type { Artwork } from "../lib/schema";
import { Icon } from "./icons";
export function SketchComposition({ artwork, prompt, onPrompt, onDraft, onCompose, busy, drafting }: { artwork: Artwork; prompt: string; onPrompt: (value: string) => void; onDraft: () => void; onCompose: () => void; busy: boolean; drafting: boolean }) {
  const pens = [...new Map(artwork.strokes.filter(s => s.semanticPen && s.tool !== "eraser").map(s => [s.semanticPen!.id, s.semanticPen!])).values()];
  const pencils = artwork.strokes.filter(s => s.tool === "pen" && !s.semanticPen).length;
  return <section className="semantic-composition-panel" aria-label="Compose sketch marks">
    <div className="composition-heading"><Icon name="spark" size={15} /><strong>Compose your sketch</strong></div>
    <p>AI가 스케치와 펜의 알고리즘 의미를 읽어 prompt를 작성합니다. 설명을 확인하거나 수정한 뒤 조합하세요.</p>
    <div className="composition-legend">{pens.map((pen, i) => <span key={i} title={pen.meaning}><i style={{ background: pen.color }} />{pen.name}</span>)}{pencils > 0 && <span>Pencil · {pencils} strokes</span>}</div>
    <button className="alternative-button" disabled={busy || !(artwork.strokes.length || artwork.photo)} onClick={onDraft}>{drafting ? "스케치를 읽고 있습니다…" : prompt.trim() ? "AI prompt 다시 만들기" : "AI prompt 만들기"}<Icon name="spark" size={15} /></button>
    <label><span>COMPOSE PROMPT</span><textarea aria-label="Compose prompt" value={prompt} maxLength={2000} rows={3} placeholder="AI가 스케치를 보고 채워드립니다. 작성된 설명은 자유롭게 수정할 수 있어요." onChange={e => onPrompt(e.target.value)} /></label>
    {!prompt.trim() && <p>Compose sketch를 누르면 먼저 AI prompt를 자동으로 채웁니다.</p>}
    <button className="primary-button" disabled={busy || !(artwork.strokes.length || artwork.photo)} onClick={onCompose}>Compose sketch<Icon name="spark" size={15} /></button>
  </section>;
}
