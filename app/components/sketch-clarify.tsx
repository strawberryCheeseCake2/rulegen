import { answerText, drawingKey, filledPreview, MAX_CLARIFY_STAGES, svgSource, type ClarifyAnswer, type ClarifyDrawing, type ClarifyQuestion, type SketchClarifyState } from "../lib/sketch-clarify";
import { Icon } from "./icons";

// Progressive clarification before Extract / Compose, in the right panel: the stages answered so far, the current
// stage's questions (multiple choice with thumbnails, text, yes/no, values), and Continue / run now / cancel.
// A choice whose readings differ in logic shows each option's logic drawn over the sketch (in its thumbnail, and on the
// frame itself while the option is pointed at or picked).

/** What the options of the current stage show: their in-situ drawings, the sketch under them, and which one is pointed at. */
type Insitu = { drawings: Record<string, ClarifyDrawing>; picture: string; onPoint: (questionId: string, optionId: string | null) => void };

function Thumb({ option, drawing, picture }: { option: ClarifyQuestion["options"][number]; drawing: ClarifyDrawing | undefined; picture: string }) {
  if (!option.sketch) return option.svg ? <img src={svgSource(option.svg)} alt="" /> : <span className="clarify-no-thumb" />;
  return <span className="clarify-insitu-thumb">
    {picture && <img src={picture} alt="" className="clarify-insitu-picture" />}
    {drawing?.src ? <img src={drawing.src} alt="" /> : !drawing ? <em>Drawing…</em> : option.svg ? <img src={svgSource(option.svg)} alt="" className="clarify-insitu-fallback" /> : <em>{drawing.note}</em>}
  </span>;
}

function Question({ question, answer, onAnswer, busy, insitu }: { question: ClarifyQuestion; answer: ClarifyAnswer | undefined; onAnswer: (answer: ClarifyAnswer) => void; busy: boolean; insitu: Insitu }) {
  const kind = { choice: "Pick one", text: "Describe", confirm: "Confirm", value: "Set values" }[question.kind];
  return <fieldset className={`clarify-question clarify-${question.kind}`} disabled={busy}>
    <legend><small>{kind}</small>{question.question}</legend>
    {question.why && <p className="clarify-why">{question.why}</p>}
    {question.kind === "choice" && <div className="clarify-options" role="radiogroup" aria-label={question.question}>
      {question.options.map(option => <button key={option.id} type="button" role="radio" aria-checked={answer?.choice === option.id}
        className={answer?.choice === option.id ? "picked" : ""} onClick={() => onAnswer({ choice: answer?.choice === option.id ? undefined : option.id })}
        onPointerEnter={() => insitu.onPoint(question.id, option.id)} onPointerLeave={() => insitu.onPoint(question.id, null)}
        onFocus={() => insitu.onPoint(question.id, option.id)} onBlur={() => insitu.onPoint(question.id, null)}>
        <Thumb option={option} drawing={insitu.drawings[drawingKey(question.id, option.id)]} picture={insitu.picture} /><span>{option.label}</span>
        {option.logic && <code className="clarify-logic">{option.logic}</code>}
      </button>)}
    </div>}
    {question.kind === "text" && <textarea rows={2} value={answer?.text ?? ""} placeholder={question.placeholder || "Your answer"} maxLength={600} onChange={event => onAnswer({ text: event.target.value })} />}
    {question.kind === "confirm" && <div className="clarify-confirm">
      <button type="button" className={answer?.confirm === true ? "picked" : ""} onClick={() => onAnswer({ confirm: answer?.confirm === true ? undefined : true })}>Yes</button>
      <button type="button" className={answer?.confirm === false ? "picked" : ""} onClick={() => onAnswer({ confirm: answer?.confirm === false ? undefined : false })}>No</button>
    </div>}
    {question.kind === "value" && <div className="clarify-values">
      {question.preview && <img className="clarify-preview" src={svgSource(filledPreview(question, answer))} alt="" />}
      {question.params.map(param => {
        const value = answer?.values?.[param.id] ?? (param.kind === "color" ? param.color : param.value);
        const set = (next: number | string) => onAnswer({ values: { ...answer?.values, [param.id]: next } });
        return <label key={param.id}><span>{param.label}</span>
          {param.kind === "color" ? <input type="color" value={String(value)} onChange={event => set(event.target.value)} />
            : <><input type="range" min={param.min} max={param.max} step={param.step} value={Number(value)} onChange={event => set(Number(event.target.value))} />
              <output>{Number(Number(value).toFixed(4))}{param.unit ? ` ${param.unit}` : ""}</output></>}
        </label>;
      })}
    </div>}
  </fieldset>;
}

export function SketchClarifyPanel({ open, busy, drawings, onPoint, onAnswer, onContinue, onFinish, onAskAnyway, onCancel }: { open: SketchClarifyState; busy: boolean;
  drawings: Record<string, ClarifyDrawing>; onPoint: Insitu["onPoint"];
  onAnswer: (questionId: string, answer: ClarifyAnswer) => void; onContinue: () => void; onFinish: () => void; onAskAnyway: () => void; onCancel: () => void }) {
  const run = open.mode === "extract" ? "Extract" : "Compose";
  const stage = open.stages.at(-1), earlier = open.stages.slice(0, -1), last = open.stages.length >= MAX_CLARIFY_STAGES;
  return <section className="sketch-clarify" aria-label="Clarify the sketch">
    <div className="composition-heading"><Icon name="spark" size={15} /><strong>Clarify before {run.toLowerCase()}</strong>
      <ol className="clarify-stages" aria-label={`Stage ${Math.max(1, open.stages.length)} of at most ${MAX_CLARIFY_STAGES}`}>
        {Array.from({ length: MAX_CLARIFY_STAGES }, (_, k) => <li key={k} className={k < open.stages.length - 1 ? "done" : k === open.stages.length - 1 ? "current" : ""} />)}
      </ol></div>
    {earlier.length > 0 && <details className="clarify-answered"><summary>Answered ({earlier.reduce((n, item) => n + item.questions.length, 0)})</summary>
      <ul>{earlier.flatMap((item, k) => item.questions.map(question => <li key={`${k}-${question.id}`}><span>{question.question}</span><b>{answerText(question, item.answers[question.id]) || "no preference"}</b></li>))}</ul>
    </details>}
    {!stage ? busy ? <p className="clarify-reason">Looking for what is still ambiguous in the sketch…</p>
      : open.clear ? <div className="clarify-clear"><b>✓ Nothing critical is ambiguous</b><p>{open.clear}</p></div>
      : <p className="clarify-reason">No questions yet.</p> : <>
      {open.reason && <p className="clarify-reason">{open.reason}</p>}
      {stage.questions.map(question => <Question key={question.id} question={question} answer={stage.answers[question.id]} busy={busy} insitu={{ drawings, picture: open.picture ?? "", onPoint }} onAnswer={answer => onAnswer(question.id, answer)} />)}
      <p className="clarify-hint">Unanswered questions are left to the AI.</p>
    </>}
    <div className="clarify-actions">
      {stage && !last && <button type="button" className="primary-button" disabled={busy} onClick={onContinue}>Continue<Icon name="spark" size={15} /></button>}
      {!stage && !busy && !open.clear && <button type="button" className="primary-button" onClick={onContinue}>Ask again</button>}
      <button type="button" className={(stage && last) || (!stage && open.clear) ? "primary-button" : "alternative-button"} disabled={busy} onClick={onFinish}>{stage || open.clear ? `${run} now` : `Skip and ${run.toLowerCase()}`}</button>
      {!stage && open.clear && <button type="button" className="alternative-button" disabled={busy} onClick={onAskAnyway}>Ask anyway</button>}
      <button type="button" className="text-button" onClick={onCancel}>Cancel</button>
    </div>
  </section>;
}

/** The option pointed at (or else the one last picked) drawn over the frame: its logic in situ, named at the top. */
export function ClarifyInsitu({ label, logic, drawing }: { label: string; logic: string; drawing: ClarifyDrawing }) {
  return <div className="clarify-insitu" aria-label={`How "${label}" would work`}>
    <img src={drawing.src} alt="" />
    <span className="clarify-insitu-rule"><b>{label}</b>{logic && <code>{logic}</code>}</span>
  </div>;
}
