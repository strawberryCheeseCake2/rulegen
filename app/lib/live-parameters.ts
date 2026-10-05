import type { GeneratedCode, Parameter, ParameterBinding, RuleGroup } from "./schema";
export const PARAM_START = "// @rulegen-parameters:start";
export const PARAM_END = "// @rulegen-parameters:end";
export const parameterKey = (...ids: string[]) => ids.map(encodeURIComponent).join("/");
export function getBindings(groups: RuleGroup[]): ParameterBinding[] {
  return groups.flatMap(g => g.subfeatures.flatMap(s => {
    const m = s.implementations.find(m => m.id === s.selectedImplementation);
    return (m?.parameters || []).map(p => ({ featureId: g.featureId, subfeatureId: s.id, implementationId: m!.id, parameterId: p.id, type: p.type, key: parameterKey(g.featureId, s.id, m!.id, p.id) }));
  }));
}
export function boundParameter(groups: RuleGroup[], binding: ParameterBinding): Parameter | undefined {
  const sub = groups.find(g => g.featureId === binding.featureId)?.subfeatures.find(s => s.id === binding.subfeatureId);
  if (sub?.selectedImplementation !== binding.implementationId) return;
  const parameter = sub.implementations.find(m => m.id === binding.implementationId)?.parameters.find(p => p.id === binding.parameterId);
  return parameter?.type === binding.type ? parameter : undefined;
}
export function parameterValues(groups: RuleGroup[], bindings: ParameterBinding[]) {
  const entries = bindings.flatMap(b => { const p = boundParameter(groups, b); return p ? [[b.key, p.value] as const] : []; });
  return Object.fromEntries(entries) as Record<string, Parameter["value"]>;
}
export function parameterBlock(values: Record<string, Parameter["value"]>) {
  return `${PARAM_START}\nconst rulegenParams = ${JSON.stringify(values, null, 2)};\n${PARAM_END}`;
}
// Patch only the validated parameter block. Drawing algorithms and hand edits stay intact.
export function syncParameters(source: string, groups: RuleGroup[], bindings: ParameterBinding[]): string {
  if (!bindings.length || !source.startsWith(PARAM_START)) return source;
  const end = source.indexOf(PARAM_END); if (end < 0) return source;
  const block = source.slice(PARAM_START.length, end).trim();
  const match = /^const rulegenParams\s*=\s*(\{[\s\S]*\});$/.exec(block);
  if (!match) return source;
  let values: Record<string, Parameter["value"]>;
  try { values = JSON.parse(match[1]); } catch { return source; }
  Object.assign(values, parameterValues(groups, bindings));
  return parameterBlock(values) + source.slice(end + PARAM_END.length);
}
export function liveStatus(source: string, groups: RuleGroup[], bindings: ParameterBinding[]) {
  const relevant = groups.filter(g => bindings.some(b => b.featureId === g.featureId));
  const expected = getBindings(relevant);
  if (!source.startsWith(PARAM_START) || !bindings.length) return "unlinked";
  const changed = !expected.length || expected.length !== bindings.length || expected.some(e => !bindings.some(b => b.key === e.key && b.type === e.type));
  return changed ? "changed" : "live";
}

// Removing a control freezes its current value, so existing drawing code remains executable.
export function detachControls(generated: GeneratedCode, before: RuleGroup[], after: RuleGroup[]): GeneratedCode {
  return { ...generated, code: syncParameters(generated.code, before, generated.bindings), bindings: generated.bindings.filter(b => boundParameter(after, b)) };
}
