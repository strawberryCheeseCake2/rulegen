import { z } from "zod";
import { compiles, summarize, type Clarify } from "./manipulate";
import type { ManipStroke } from "./strokes";

// Making a demonstration the brush's own rule: what the user showed with direct manipulation tools (on a temporary
// fork, or with tools kept with a frame) is drawn only where and as they showed it — the code reads the shown values
// live (m.demo). A visual example still leaves open how it generalizes (groups of 3 and of 4 drawn by hand could mean
// runs of 3–4 at random, 3 and 4 in turn, a run as long as the drawn groups, or a chance to keep a color…), so AI
// lists the rules it could be, each with a preview of the whole brush following it; the one the user picks becomes the
// program itself: the brush's model (constraints, params, states) and its code, with nothing shown any more.

export const MAX_GENERAL_OPTIONS = 4;
export const generalizeSchema = z.object({
  /** What the demonstration shows, read as a whole (the concern's language). */
  summary: z.string().max(600),
  /** The question asked with the options (one sentence). */
  question: z.string().max(300),
  /** What is still open in what was shown. */
  reason: z.string().max(300),
  options: z.array(z.object({
    id: z.string().max(40),
    /** The rule in a few words. */
    rule: z.string().max(140),
    /** Its logic in one short line (a formula or the condition), written over the preview. */
    logic: z.string().max(160),
    detail: z.string().max(300),
    /** How the values shown become this rule's values (e.g. "groups of 3 and 4 → run length random in [3, 4]"). */
    fromShown: z.string().max(300),
    /** The body of `(ctx, input, note)` sketching the whole brush following the rule, with in-situ notes. */
    thumbnail: z.string().max(8000),
  })).max(MAX_GENERAL_OPTIONS),
});
export type Generalize = z.infer<typeof generalizeSchema>;
export type GeneralOption = Generalize["options"][number];

/** Keep what can be used: unique ids, previews whose code parses; at least one rule. */
export function settleGeneralize(output: Generalize): Generalize {
  const ids = new Set<string>();
  const unique = (raw: string) => { const id = raw.trim().replace(/[^\w-]+/g, "-").slice(0, 34) || "r"; let out = id, k = 2; while (ids.has(out)) out = `${id}-${k++}`; ids.add(out); return out; };
  const options = output.options.filter(option => option.rule.trim()).map(option => ({ ...option, id: unique(option.id),
    thumbnail: compiles(option.thumbnail, ["ctx", "input", "note"]) ? option.thumbnail : "" }));
  if (!options.length) throw new Error("No rule was found in what you showed. Show it a little more and ask again.");
  return { ...output, question: output.question.trim() || output.summary, options };
}

/** What the user showed with the tools: the concern, the rule picked for them, each value shown and what was drawn with it. */
export type Demonstration = {
  concern: string;
  rule: string;
  tools: Clarify["tools"];
  targets: { id: string; name: string; where: string; param: string; meaning: string; shown: string; drawn: string }[];
  /** The values shown, by target id (as the code reads them). */
  values: Record<string, unknown>;
  strokes: ManipStroke[];
};
/** A shown value as a short reading. */
export const shownText = (value: unknown) => value === undefined || value === null ? "—"
  : summarize(Array.isArray(value) && value.every(item => typeof item === "number") ? value : [value], 1200);

function demonstrationLines(demo: Demonstration) {
  const lines = [`Concern: ${demo.concern}`];
  if (demo.rule) lines.push(`Rule the tools were made for: ${demo.rule}`);
  lines.push("The user showed what they want on the picture with direct manipulation tools (their strokes are drawn in coral on the image, and given as `annotations`):",
    ...demo.tools.map(tool => `- ${tool.kind}: ${tool.purpose}`));
  if (demo.targets.length) lines.push("What they showed, measured into the values the brush draws with (the code reads each live with m.demo(\"<id>\"), a param is set as is):",
    ...demo.targets.map(target => `- ${target.name} [${target.param ? `param ${target.param}` : `m.demo("${target.id}")`}${target.where ? `, at ${target.where}` : ""}]: ${target.meaning}\n  shown: ${target.shown}${target.drawn ? `\n  drawn with it: ${target.drawn}` : ""}`));
  return lines;
}
/** The request to list the rules a demonstration could be (trace-generalize). */
export const generalizeQuestion = (demo: Demonstration) => [...demonstrationLines(demo),
  "It is drawn only where and as they showed it. List the rules it could be as the brush's own behavior, everywhere it draws, with nothing shown."].join("\n").slice(0, 6000);

/** The ids the code reads a demonstration's shown values with (they are not given once it is the brush's own rule). */
export const demoIds = (demo: Demonstration) => demo.targets.filter(target => !target.param).map(target => target.id);

/** The request to change the brush so that it follows the rule picked by itself (revision, then code). */
export function generalizeRequest(demo: Demonstration, question: string, option: GeneralOption) {
  const ids = demoIds(demo);
  return [...demonstrationLines(demo),
    `Rule chosen for "${question}": ${option.rule} (${option.logic})${option.detail ? ` — ${option.detail}` : ""}`,
    option.fromShown ? `How what was shown becomes this rule's values: ${option.fromShown}` : "",
    "Make this rule the brush's OWN behavior, everywhere it draws, with nothing shown any more:",
    "- The model: the constraints that decide this outcome describe the rule as it now works (their descriptions say the mechanism concretely); its quantities are params with values taken from what was shown; add a constraint, a state or a transition only when the rule needs one, and keep every state's constraint list and the transitions consistent.",
    `- The code: the compute functions of those constraints compute it themselves${ids.length ? `, and nothing reads ${ids.map(id => `m.demo("${id}")`).join(", ")} any more (those values are not given); other m.demo reads stay as they are` : ""}.`,
    "Keep everything else as it is."].filter(Boolean).join("\n").slice(0, 6000);
}

