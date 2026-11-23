import { useState } from "react";
import type { GeneralizeView } from "../studio/use-generalize";

// Below the frame the demonstration was shown on: the rules what was shown could be as the brush's own behavior, each
// previewed over the original (the whole brush following it, its logic noted in place); picking one changes the
// original's model and code.

export function GeneralizePanel({ view, onChoose, onRetry, onClose }: { view: GeneralizeView; onChoose: (optionId: string) => void; onRetry: () => void; onClose: () => void }) {
  const result = view.result;
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const fold = (id: string) => setFolded(current => { const next = new Set(current); if (!next.delete(id)) next.add(id); return next; });
  return <div className="manip-panel generalize-panel" onPointerDown={event => event.stopPropagation()}>
    <header>
      <span className="section-kicker">MAKE IT THE BRUSH'S RULE</span>
      <p>{result?.summary ?? "What you showed is drawn only where you showed it. Pick the rule it means, and the original brush follows it everywhere by itself."}</p>
      {view.busy && <span className="manip-busy"><span className="loading-spinner" />{view.status}</span>}
      {!view.busy && view.status && <span className="manip-status">{view.status} <button type="button" onClick={onRetry}>Retry</button></span>}
    </header>
    {result && <section className="manip-question">
      <strong>{result.question}</strong>
      {result.reason && <small>{result.reason}</small>}
      <div className="manip-options">{result.options.map(option => {
        const preview = view.previews[option.id];
        return <button type="button" key={option.id} disabled={view.busy} onClick={() => onChoose(option.id)} title="Change the original brush to follow this rule">
          <div className="manip-thumb">
            {view.picture && <img src={view.picture} alt="" className="manip-thumb-picture" />}
            {preview?.src && <img src={preview.src} alt="" />}
            {!preview && option.thumbnail && <em className="manip-thumb-note">Drawing the preview…</em>}
            {preview?.note && <em className="manip-thumb-note">{preview.note}</em>}
            <span className={`manip-thumb-rule ${folded.has(option.id) ? "folded" : ""}`}>
              <span className="manip-thumb-head"><b>{option.rule}</b>
                <span role="button" tabIndex={0} className="manip-fold" title={folded.has(option.id) ? "Show the rule" : "Minimize to see the picture"} aria-label={folded.has(option.id) ? "Show the rule" : "Minimize"}
                  onClick={event => { event.stopPropagation(); fold(option.id); }} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); fold(option.id); } }}>{folded.has(option.id) ? "+" : "–"}</span></span>
              {option.logic && !folded.has(option.id) && <code>{option.logic}</code>}
            </span>
          </div>
          <small>{option.detail}</small>
          {option.fromShown && <small className="generalize-from">From what you showed: {option.fromShown}</small>}
        </button>;
      })}</div>
    </section>}
    <footer>
      <span className="manip-fork-note">{view.kind === "fork" ? "The original's constraints, states and code change; the temporary fork goes." : "The frame's constraints, states and code change; these tools go."}</span>
      <button type="button" className="exec-button" disabled={view.busy} onClick={onClose}>Cancel</button>
    </footer>
  </div>;
}
