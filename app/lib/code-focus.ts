import { moduleKeyOf } from "./hidden-parameters";
import type { InspectionFocus } from "./inspection";
import { findNode } from "./scene/graph";
import { programModules } from "./scene/machines";
import type { Scene } from "./scene/schema";

/** What of the code an inspection's focus (of `kind`) is about: its lines (0-based), the lines using what they read (`related`), and what it is in code words. */
export type CodeFocus = { kind: InspectionFocus["kind"]; lines: number[]; related: number[]; label: string };

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
/** A string literal of exactly `text`, or (`prefix`) starting with `text/`. */
const literal = (text: string, prefix = false) => new RegExp(`(["'\`])${escape(text)}${prefix ? "(?:/[^\"'\`]*)?" : ""}\\1`);
/**
 * The name a line gives what it reads at `at`: the variable of the declaration (or assignment) it is part of, e.g.
 * `r` in `const h = height(d), r = m.v("…")`; null when it is not assigned (used in place).
 */
export function assignedAt(line: string, at: number): string | null {
  const start = Math.max(line.lastIndexOf(";", at), line.lastIndexOf("{", at), line.lastIndexOf("}", at)) + 1, segment = line.slice(start, at);
  const declared = /^\s*(?:const|let|var)\s+/.exec(segment);
  let from = declared ? declared[0].length : 0, depth = 0;
  // Declarators are split at top-level commas (not those inside a call or a literal).
  if (declared) for (let i = from; i < segment.length; i++) { const c = segment[i];
    if ("([{".includes(c)) depth++; else if (")]}".includes(c)) depth--; else if (c === "," && depth === 0) from = i + 1; }
  return /^\s*([A-Za-z_$][\w$]*)\s*=(?![=>])/.exec(segment.slice(from))?.[1] ?? null;
}
/**
 * The code an inspection's focus is about, found by how the code refers to it (the scene code contract): a param or a
 * suggested parameter by its value key `m.v("<node>/<param>…")` / `m.opt(…, "<node>/<param>…")`; a constraint by its
 * compute function (named in the module's `constraints["<node>"]["<constraint>"]`, the whole function), or, when that
 * is not found, by the keys of its params; a state by its id where an owner's state is compared; a transition where its
 * event is dispatched, `owner.dispatch("<event>")`. Only in the module of the node's brush; `related` are the lines
 * using a variable those lines assign (and, for a constraint, its params' reads). Null when the code does not refer to it.
 */
export function focusLines(code: string, scene: Scene, focus: InspectionFocus): CodeFocus | null {
  const key = moduleKeyOf(scene, focus.nodeId), module = key ? programModules(code).get(key) : undefined, at = module ? code.indexOf(module) : -1;
  const first = at >= 0 ? code.slice(0, at).split("\n").length - 1 : 0, lines = (at >= 0 ? module! : code).split("\n");
  const node = findNode(scene, focus.nodeId), codeId = node?.codeId ?? focus.nodeId;
  const indent = (line: string) => /^\s*/.exec(line)![0].length;
  if (focus.kind === "constraint") {
    const constraint = node?.constraints.find(item => item.id === focus.id), paramKeys = (constraint?.params ?? []).map(param => literal(`${codeId}/${param.id}`, true));
    // The map entry `"<constraint id>": computeX` (or `<id>: computeX`) names the function; the function is the constraint's code.
    const entry = new RegExp(`(?:^|[\\s{,])(["'\`]?)${escape(focus.id)}\\1\\s*:\\s*([A-Za-z_$][\\w$]*)`);
    const named = lines.map((line, i) => ({ i, match: entry.exec(line) })).find(item => item.match);
    const name = named?.match?.[2], start = name ? lines.findIndex(line => new RegExp(`\\bfunction\\s+${escape(name)}\\s*\\(|\\b(?:const|let)\\s+${escape(name)}\\s*=`).test(line)) : -1;
    let found: number[] = [];
    if (start >= 0) { let end = start; const depthOf = (text: string) => (text.match(/[{(]/g)?.length ?? 0) - (text.match(/[})]/g)?.length ?? 0);
      for (let depth = depthOf(lines[start]); depth > 0 && end < lines.length - 1;) depth += depthOf(lines[++end]);
      found = Array.from({ length: end - start + 1 }, (_, k) => start + k); }
    if (!found.length) found = lines.flatMap((line, i) => paramKeys.some(pattern => pattern.test(line)) ? [i] : []);
    if (!found.length) return null;
    const related = lines.flatMap((line, i) => !found.includes(i) && (i === named?.i || paramKeys.some(pattern => pattern.test(line))) ? [i] : []);
    return { kind: focus.kind, lines: found.map(i => i + first), related: related.map(i => i + first), label: name ? `${name}() computes ${constraint?.property ?? focus.id}` : `${(constraint?.params.length ?? 0)} values of ${constraint?.property ?? focus.id}` };
  }
  const event = focus.kind === "transition" ? node?.machine?.transitions.find(item => item.id === focus.id)?.event ?? focus.id : null;
  const keys = focus.kind === "param" || focus.kind === "parameter" ? [`${codeId}/${focus.id}`] : [];
  const patterns = keys.length ? keys.map(item => literal(item, true)) : [literal(event ?? focus.id)];
  // A transition is taken where its event is dispatched; a state where an owner's state is compared with it.
  const owns = (line: string) => focus.kind === "transition" ? /\.dispatch\s*\(/.test(line) : true;
  const found = lines.flatMap((line, i) => patterns.some(pattern => pattern.test(line)) && owns(line) ? [i] : []);
  if (!found.length) return null;
  // Every read on a line counts (`const base = m.v("…/base"), ratio = m.v("…/ratio")` names both); a name is used after
  // where it is given, within its block (until the code is indented less than there).
  const scopes = found.flatMap(i => patterns.flatMap(pattern => [...lines[i].matchAll(new RegExp(pattern.source, "g"))].map(match => assignedAt(lines[i], match.index)))
    .filter((name): name is string => Boolean(name)).map(name => ({ name, from: i })));
  const uses = (line: string, j: number) => scopes.some(({ name, from }) => j > from && lines.slice(from + 1, j + 1).every(other => !other.trim() || indent(other) >= indent(lines[from]))
    && new RegExp(`(?<![\\w$.])${escape(name)}(?![\\w$])`).test(line));
  const reading = focus.kind === "state" ? literal(codeId) : null;
  const related = lines.flatMap((line, i) => !found.includes(i) && (uses(line, i) || (reading && /\bm\.fsm\s*\(/.test(line) && reading.test(line))) ? [i] : []);
  const label = focus.kind === "transition" ? `owner.dispatch("${event}")` : focus.kind === "state" ? `${node?.name ?? focus.nodeId}'s state is "${focus.id}"`
    : `m.v("${keys[0]}…")`;
  return { kind: focus.kind, lines: found.map(i => i + first), related: related.map(i => i + first), label };
}
