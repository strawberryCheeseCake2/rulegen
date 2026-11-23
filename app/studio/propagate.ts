import type { StudioDeps } from "./deps";
import { sceneAI } from "./scene-actions";
import * as ops from "../lib/scene/panel-ops";
import { mergePart, partChanges, partModules, propagationBase, valueText, type PartChanges } from "../lib/scene/propagation";
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
  const modules = part.generated && (changes.code || changes.structure) ? partModules(part.generated.code, part.scene, of) : "";
  const tools = part.keptTools.filter(set => changes.tools.includes(set.id));
  for (const [k, frame] of chain.entries()) {
    const above = deps.panel(frame), merged = mergePart(above.scene, part.scene, of, base, changes);
    deps.updatePanel(frame, latest => ({ ...ops.commitScene(latest, merged),
      keptTools: [...latest.keptTools.filter(set => !tools.some(item => item.id === set.id)), ...tools].slice(-MAX_KEPT_SETS) }));
    // How the part computes is carried up by rewriting this frame's code with the part's code as reference.
    if ((changes.code || changes.structure || tools.length) && above.generated) {
      const own = above.generationMode === "compose" ? above.composePrompt : above.instruction;
      await sceneAI(deps, frame).generateCode(false, [own,
        `A decomposed part of this frame ("${name}", node "${of.nodeId}"${of.constraintId ? `, constraint "${of.constraintId}"` : ""}) was changed on its own, and the change is passed up here:`,
        ...lines.map(line => `- ${line}`),
        modules ? `The part's code now (follow how it computes that part; keep everything else of this frame as it is):\n${modules}` : "Keep everything else of this frame as it is.",
      ].filter(Boolean).join("\n").slice(0, 6000));
    }
    // A frame passed through is in step with the one above it too (when that one gets the change as well).
    if (k < chain.length - 1 && chain[k + 1] === deps.panel(frame).exampleOf?.frameId) settle(deps, frame);
  }
  settle(deps, id);
}
