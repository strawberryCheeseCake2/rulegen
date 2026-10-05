import { z } from "zod";
import { groupSchema, type RuleGroup, type Parameter } from "./schema";
const legacyGroup = z.object({ featureId: z.string().max(80), title: z.string().max(120), rules: z.array(z.object({ label: z.string().max(80), text: z.string().min(1).max(1500) })).min(1).max(6) });
// Preserve existing recipes; the user can ask AI to turn them into parameterized implementations.
export const savedGroupSchema = z.union([groupSchema, legacyGroup]).transform(group => "subfeatures" in group ? group : ({ featureId: group.featureId, title: group.title, subfeatures: group.rules.map((r, i) => ({ id: `subfeature-${i + 1}`, label: r.label || `Subfeature ${i + 1}`, selectedImplementation: "saved-recipe", implementations: [{ id: "saved-recipe", label: "Saved recipe", description: r.text, parameters: [] }] })) })).superRefine((group, ctx) => { try { validateGroups([group]); } catch (error) { ctx.addIssue({ code: "custom", message: (error as Error).message }); } });
export function validateGroups(groups: RuleGroup[]) {
  function unique(ids: string[]) { if (new Set(ids).size !== ids.length) throw new Error("중복된 파라미터 또는 구현 ID가 있습니다. 다시 생성해주세요."); }
  for (const group of groups) {
    unique(group.subfeatures.map(s => s.id));
    for (const sub of group.subfeatures) {
      unique(sub.implementations.map(m => m.id));
      if (!sub.implementations.some(m => m.id === sub.selectedImplementation)) throw new Error("선택된 구현 방식을 찾지 못했습니다. 다시 생성해주세요.");
      for (const method of sub.implementations) {
        unique(method.parameters.map(p => p.id));
        for (const p of method.parameters) {
          if (p.type === "number" && (p.min >= p.max || p.value < p.min || p.value > p.max || p.step > p.max - p.min)) throw new Error("파라미터 범위가 올바르지 않습니다. 다시 생성해주세요.");
          if (p.type === "select" && !p.options.includes(p.value)) throw new Error("파라미터 선택값이 올바르지 않습니다. 다시 생성해주세요.");
        }
      }
    }
  }
}
export function updateParameter(groups: RuleGroup[], featureId: string, subId: string, methodId: string, parameterId: string, value: Parameter["value"]): RuleGroup[] {
  return groups.map(g => g.featureId !== featureId ? g : { ...g, subfeatures: g.subfeatures.map(s => s.id !== subId ? s : { ...s, implementations: s.implementations.map(m => m.id !== methodId ? m : { ...m, parameters: m.parameters.map(p => {
    if (p.id !== parameterId) return p;
    if (p.type === "number" && typeof value === "number" && Number.isFinite(value)) {
      const rounded = p.min + Math.round((value - p.min) / p.step) * p.step;
      return { ...p, value: Number(Math.max(p.min, Math.min(p.max, rounded)).toFixed(8)) };
    }
    if (p.type === "color" && typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value)) return { ...p, value };
    if (p.type === "select" && typeof value === "string" && p.options.includes(value)) return { ...p, value };
    if (p.type === "toggle" && typeof value === "boolean") return { ...p, value };
    return p;
  }) }) }) });
}
// Only selected methods reach code/brush generation, so alternatives cannot contradict edited values.
export const activeGroups = (groups: RuleGroup[]) => groups.map(g => ({ ...g, subfeatures: g.subfeatures.map(s => ({ ...s, implementations: s.implementations.filter(m => m.id === s.selectedImplementation) })) }));

export function replaceSubfeature(groups: RuleGroup[], featureId: string, subId: string, replacement: RuleGroup["subfeatures"][number]) {
  if (replacement.id !== subId) throw new Error("생성된 subfeature ID가 요청과 다릅니다.");
  const next = groups.map(g => g.featureId !== featureId ? g : { ...g, subfeatures: g.subfeatures.map(s => s.id === subId ? replacement : s) });
  validateGroups(next); return next;
}

export function removeControl(groups: RuleGroup[], featureId: string, subId: string, methodId?: string, parameterId?: string): RuleGroup[] {
  return groups.map(g => g.featureId !== featureId ? g : { ...g, subfeatures: methodId && parameterId
    ? g.subfeatures.map(s => s.id !== subId ? s : { ...s, implementations: s.implementations.map(m => m.id !== methodId ? m : { ...m, parameters: m.parameters.filter(p => p.id !== parameterId) }) })
    : g.subfeatures.filter(s => s.id !== subId) }).filter(g => g.subfeatures.length > 0);
}
