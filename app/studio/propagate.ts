import type { StudioDeps } from "./deps";
import { sceneAI } from "./scene-actions";
import * as ops from "../lib/scene/panel-ops";
import { adoptStructure, mergePart, partChanges, structureGaps, unmatchedParams, partModules, propagationBase, valueText, type PartChanges } from "../lib/scene/propagation";
import { MAX_KEPT_SETS } from "../lib/execution/kept-tools";
import type { SketchPanel } from "../lib/sketch-panels";

// Passing a part frame's change up its decomposition (to the frames it came from), or keeping it there only.

/** The frames a part came from, nearest first (the frame it was decomposed from, that one's, …). */
export function ancestorsOf(deps: Pick<StudioDeps, "panel" | "artwork">, id: string): string[] {
  const out: string[] = [];
  for (let at = deps.panel(id).exampleOf?.frameId; at && deps.artwork(at) && !out.includes(at) && at !== id; at = deps.panel(at).exampleOf?.frameId) out.push(at);
  return out;
}
const toolIds = (panel: SketchPanel) => panel.keptTools.map(set => set.id);
/** What changed in a part since it was last in step with the frames above (null: nothing, or not a part). */
export function changesOf(panel: SketchPanel | undefined): PartChanges | null {
  if (!panel?.exampleOf || !panel.propagationBase || !panel.generated) return null;
  return partChanges(panel.scene, panel.exampleOf, panel.generated.code, toolIds(panel), panel.propagationBase);
}
/** The part as it is now becomes its baseline (in step: nothing to ask about). */
export function settle(deps: Pick<StudioDeps, "panel" | "updatePanel">, id: string) {
  const panel = deps.panel(id);
  if (!panel.exampleOf) return;
  deps.updatePanel(id, { propagationBase: propagationBase(panel.scene, panel.exampleOf, panel.generated?.code, toolIds(panel)) });
}
/** The change in words, for the code rewrite above. */
export function describeChanges(changes: PartChanges, part: SketchPanel) {
  const lines: string[] = [];
  if (changes.params.length) lines.push(`Param values: ${changes.params.map(item => `${item.label} ${valueText(item.before)} → ${valueText(item.after)}`).join("; ")}.`);
  if (changes.structure) lines.push("Its constraints changed (added, removed or redescribed).");
  if (changes.code) lines.push("How it computes changed (its code).");
  const tools = part.keptTools.filter(set => changes.tools.includes(set.id));
  if (tools.length) lines.push(`Direct manipulation tools were kept with it (its code reads what they show with m.demo): ${tools.map(set => set.concern).join("; ")}.`);
  return lines;
}

/** Pass the part's change up to the chosen frames above (nearest first), then the part is in step again. */
export async function propagate(deps: StudioDeps, id: string, targets: string[]) {
  const part = deps.panel(id), of = part.exampleOf, base = part.propagationBase, changes = changesOf(part);
  if (!of || !base || !changes) return;
  const chain = ancestorsOf(deps, id).filter(frame => targets.includes(frame));
  const name = deps.artwork(id)?.name || "a part", lines = describeChanges(changes, part);
  // Values of params a frame above does not have (a split's inner computation) are in its code, so they go up as a rewrite too.
  const unmatched = chain.some(frame => unmatchedParams(deps.panel(frame).scene, changes).length);
  const tools = part.keptTools.filter(set => changes.tools.includes(set.id));
  // What of the part's structure each frame above lacks (params it has no slider for, constraints it does not have).
  const gaps = new Map(chain.map(frame => [frame, structureGaps(deps.panel(frame).scene, part.scene, of)]));
  const lacking = chain.filter(frame => gaps.get(frame)!.length);
  // The frames whose code AI rewrites to carry the change: the user says yes first (no: nothing changes, still to pass up).
  const needsRewrite = (frame: string) => Boolean(deps.panel(frame).generated && (changes.code || changes.structure || tools.length || unmatchedParams(deps.panel(frame).scene, changes).length));
  let adopt = false, rewrites = chain.filter(needsRewrite);
  const named = (frames: string[]) => frames.length === 1 ? `“${deps.artwork(frames[0])?.name || "the frame above"}”` : `${frames.length} frames above`;
  if (lacking.length) {
    // The part has params the frames above do not: take its structure up there (their sliders and handles too), or keep theirs and write the values into their code.
    const answer = await deps.confirm?.({ kicker: "↑ PROPAGATE", title: `Change ${named(lacking)} to the structure of “${name}”?`,
      body: `“${name}” has params ${named(lacking)} ${lacking.length === 1 ? "does" : "do"} not have. Add them there (with their sliders and handles), and AI rewrites the code to read them in place of what it computes now? Or keep ${lacking.length === 1 ? "its" : "their"} params as they are, and AI writes the new values into the code. Undo takes it back.`,
      items: [...lacking.flatMap(frame => gaps.get(frame)!.map(gap => ({ label: `+ ${deps.artwork(frame)?.name || frame}`, detail: `${gap.property}${gap.whole ? " (new constraint)" : ""}: ${gap.params.map(param => param.label).join(", ")}` }))),
        ...lines.map(line => ({ label: "Change", detail: line }))],
      accept: "Add params & fix with AI", alternative: "Keep its params, fix with AI", decline: "Not now" });
    if (!answer) return;
    adopt = answer === true;
    if (adopt) rewrites = chain.filter(frame => needsRewrite(frame) || Boolean(deps.panel(frame).generated && gaps.get(frame)!.length));
  } else if (rewrites.length) {
    const yes = await deps.confirm?.({ kicker: "↑ PROPAGATE", title: `Fix ${named(rewrites)} with AI?`,
      body: `The change of “${name}” cannot be set as values alone${rewrites.length < chain.length ? " in every frame" : ""}, so AI rewrites the code of ${rewrites.length === 1 ? "that frame" : "those frames"} to follow it (keeping everything else). Undo takes it back.`,
      items: [...lines.map(line => ({ label: "Change", detail: line })), ...rewrites.map(frame => ({ label: "Rewritten", detail: deps.artwork(frame)?.name || frame }))],
      accept: "Fix with AI", decline: "Not now" });
    if (!yes) return;
  }
  const modules = part.generated && (changes.code || changes.structure || unmatched || (adopt && lacking.length)) ? partModules(part.generated.code, part.scene, of) : "";
  for (const [k, frame] of chain.entries()) {
    const above = deps.panel(frame), added = adopt ? gaps.get(frame)! : [];
    const merged = adoptStructure(mergePart(above.scene, part.scene, of, base, changes), part.scene, added);
    deps.updatePanel(frame, latest => ({ ...ops.commitScene(latest, merged),
      keptTools: [...latest.keptTools.filter(set => !tools.some(item => item.id === set.id)), ...tools].slice(-MAX_KEPT_SETS) }));
    // How the part computes is carried up by rewriting this frame's code with the part's code as reference.
    const missing = unmatchedParams(merged, changes);
    if (rewrites.includes(frame) && above.generated) {
      const own = above.generationMode === "compose" ? above.composePrompt : above.instruction;
      await sceneAI(deps, frame).generateCode(false, [own,
        `A decomposed part of this frame ("${name}", node "${of.nodeId}"${of.constraintId ? `, constraint "${of.constraintId}"` : ""}) was changed on its own, and the change is passed up here:`,
        ...lines.map(line => `- ${line}`),
        added.length ? `- This frame now has the part's params too: ${added.map(gap => `${gap.whole ? `the new constraint "${gap.constraintId}" (${gap.property})` : `constraint "${gap.constraintId}"`} of node "${gap.nodeId}" with ${gap.params.map(param => `"${param.id}" (${param.label})`).join(", ")}`).join("; ")}. Make the code read them like its other params, where it computes what the part computes (in place of the values written in there now), so they tune this frame as they tune the part.` : "",
        missing.length ? `- This frame has no param for ${missing.map(item => item.label).join(", ")}: that computation is written into its code, so set it there to the new values.` : "",
        modules ? `The part's code now (follow how it computes that part; keep everything else of this frame as it is):\n${modules}` : "Keep everything else of this frame as it is.",
      ].filter(Boolean).join("\n").slice(0, 6000));
    }
    // A frame passed through is in step with the one above it too (when that one gets the change as well).
    if (k < chain.length - 1 && chain[k + 1] === deps.panel(frame).exampleOf?.frameId) settle(deps, frame);
  }
  settle(deps, id);
}
