import type { Feature, RuleGroup, RevisionProposal, ResultAnnotation, Parameter } from "./schema";
import { validateGroups } from "./subfeatures";

export type RevisionChange = { path: string; before: string; after: string; kind: "add" | "change" | "remove" };
function parameterSummary(p: Parameter) {
  const value = p.type === "toggle" ? (p.value ? "On" : "Off") : p.value;
  const unit = p.type === "number" && p.unit ? ` ${p.unit}` : "";
  const details = p.type === "number" ? `\nRange: ${p.min}–${p.max}${unit} · Step: ${p.step}` : p.type === "select" ? `\nOptions: ${p.options.join(" / ")}` : "";
  return `${p.label} · ${p.type}\nValue: ${value}${unit}${details}`;
}
function entries(features: Feature[], groups: RuleGroup[]) {
  const values = new Map<string, { path: string; value: string }>();
  const add = (key: string, path: string, value: unknown) => values.set(key, { path, value: typeof value === "string" ? value : JSON.stringify(value, null, 2) });
  for (const f of features) {
    add(JSON.stringify(["feature", f.id, "label"]), `Visual feature · ${f.label} · Label`, f.label);
    add(JSON.stringify(["feature", f.id, "description"]), `Visual feature · ${f.label} · Description`, f.description);
    add(JSON.stringify(["feature", f.id, "region"]), `Visual feature · ${f.label} · Region`, f.region);
  }
  for (const g of groups) {
    const featureName = features.find(f => f.id === g.featureId)?.label || g.title;
    add(JSON.stringify(["group", g.featureId]), `Rules · ${featureName} · Title`, g.title);
    for (const s of g.subfeatures) {
      const root = JSON.stringify([g.featureId, s.id]);
      const path = `Widget · ${featureName} · ${s.label}`;
      add(`${root}/label`, `${path} · Label`, s.label);
      const selected = s.implementations.find(m => m.id === s.selectedImplementation);
      const selectedLabel = selected && s.implementations.filter(m => m.label === selected.label).length === 1 ? selected.label : `${selected?.label || "Implementation"} (${s.selectedImplementation})`;
      add(`${root}/selected`, `${path} · Implementation`, selectedLabel);
      for (const m of s.implementations) {
        const method = JSON.stringify([g.featureId, s.id, m.id]);
        add(`${method}/label`, `${path} · ${m.label} · Label`, m.label);
        add(`${method}/description`, `${path} · ${m.label} · Description`, m.description);
        for (const p of m.parameters) add(JSON.stringify(["parameter", g.featureId, s.id, m.id, p.id]), `${path} · ${m.label} · ${p.label}`, parameterSummary(p));
      }
    }
  }
  return values;
}
export function revisionChanges(features: Feature[], groups: RuleGroup[], proposal: RevisionProposal): RevisionChange[] {
  const before = entries(features, groups), after = entries(proposal.features, proposal.groups);
  return [...new Set([...before.keys(), ...after.keys()])].flatMap(key => {
    const a = before.get(key), b = after.get(key);
    return a?.value === b?.value ? [] : [{ kind: (!a ? "add" : !b ? "remove" : "change") as RevisionChange["kind"], path: b?.path || a!.path, before: a?.value ?? "없음", after: b?.value ?? "없음" }];
  });
}
export function validateRevisionProposal(proposal: RevisionProposal, features: Feature[], groups: RuleGroup[]) {
  const ids = proposal.features.map(f => f.id), groupIds = proposal.groups.map(g => g.featureId);
  if (new Set(ids).size !== ids.length || new Set(groupIds).size !== groupIds.length || groupIds.some(id => !ids.includes(id))) throw new Error("변경안의 특징과 규칙 연결이 올바르지 않습니다. 다시 요청해주세요.");
  for (const f of proposal.features) {
    if (f.region.x + f.region.w > 1.000001 || f.region.y + f.region.h > 1.000001) throw new Error("변경안의 특징 영역이 캔버스를 벗어났습니다.");
    const original = features.find(item => item.id === f.id);
    if (original && JSON.stringify(original.region) !== JSON.stringify(f.region)) throw new Error("원본 스케치의 특징 영역은 유지해야 합니다. 다시 요청해주세요.");
  }
  validateGroups(proposal.groups);
  if (!revisionChanges(features, groups, proposal).length) throw new Error("실제 변경 제안이 없습니다. 수정 요청을 구체적으로 입력해주세요.");
}
export const revisionSnapshot = (features: Feature[], groups: RuleGroup[], code: string, annotations: ResultAnnotation[], instruction: string, image: string) => JSON.stringify({ features, groups, code, annotations, instruction, image });

// Include the current rendering's controls and newly changed groups, preserving
// unrelated rule groups that were never part of this generated result.
export function revisionCodeGroups(proposal: RevisionProposal, features: Feature[], groups: RuleGroup[], boundFeatureIds: string[]) {
  const ids = new Set(boundFeatureIds);
  if (!ids.size) return proposal.groups;
  const scope = proposal.groups.filter(g => ids.has(g.featureId)
    || JSON.stringify(g) !== JSON.stringify(groups.find(old => old.featureId === g.featureId))
    || JSON.stringify(proposal.features.find(f => f.id === g.featureId)) !== JSON.stringify(features.find(f => f.id === g.featureId)));
  return scope.length ? scope : proposal.groups;
}
export function revisionCodeFeatures(proposal: RevisionProposal, features: Feature[], scope: RuleGroup[]) {
  return proposal.features.filter(f => scope.some(g => g.featureId === f.id)
    || JSON.stringify(f) !== JSON.stringify(features.find(old => old.id === f.id)));
}

export async function annotatedResultImage(image: string, annotations: ResultAnnotation[]) {
  const source = new Image(); source.src = image; await source.decode();
  const canvas = document.createElement("canvas"); canvas.width = 900; canvas.height = 600;
  const ctx = canvas.getContext("2d")!; ctx.drawImage(source, 0, 0, 900, 600);
  annotations.forEach(a => {
    ctx.strokeStyle = "#db624a"; ctx.lineWidth = 3; ctx.beginPath();
    a.points.forEach((p, j) => j ? ctx.lineTo(p.x * 900, p.y * 600) : ctx.moveTo(p.x * 900, p.y * 600)); ctx.stroke();
  });
  return canvas.toDataURL("image/png");
}
