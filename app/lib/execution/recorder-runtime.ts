import { MAX_CYCLE_STEPS } from "./trace";
import { RECORDER } from "../scene/instrument";

// The recorder inside the running sketch (with the instrumented modules, see scene/instrument.ts). While a frame's
// execution is recorded, every FSM step the runtime reports (rulegenFsmEvent) becomes a step with every variable the
// code has there:
//  - the variables visible at the returns of the constraint's compute function and the helpers it called (`ret`),
//  - those visible where evaluate/dispatch was called (`call`: the item loop around it),
//  - the module's top-level variables (`bind`, per module instance),
//  - the owner's $data, $state, $value (constraint) and $event (transition); $demo: the m.demo values a constraint read.
// Inner variables win over outer ones of the same name. Values are previews: plain data, at most 3 levels, 64 items
// (16 when too long) or 16 keys each, long text cut; functions, the p5 instance and owners' methods are left out.
// Steps taken by input handlers (between frames) are kept for the next recorded cycle, marked `pre`.

export const RECORDER_RUNTIME = `
const ${RECORDER} = (() => {
  let recording = false, drawing = false, armed = false, steps = [], pending = [], truncated = false, caller = null, scope = null, creating = null;
  const SKIP = {}, MAX_STEPS = ${MAX_CYCLE_STEPS};
  const collecting = () => recording || (armed && !drawing);
  function preview(value, depth, seen, items = 16) {
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : String(value);
    if (typeof value === 'string') return value.length > 200 ? value.slice(0, 199) + '…' : value;
    if (typeof value === 'bigint') return String(value);
    if (value === undefined || typeof value === 'function' || typeof value === 'symbol') return SKIP;
    if (typeof p !== 'undefined' && value === p) return SKIP;
    if (typeof HTMLElement !== 'undefined' && value instanceof HTMLElement) return SKIP;
    if (typeof value.evaluate === 'function' && typeof value.dispatch === 'function') { try { return { owner: String(value.id) + (value.key ? '#' + value.key : ''), state: value.state }; } catch (error) { return '[owner]'; } }
    if (seen.has(value)) return '[circular]';
    if (depth >= 3) return Array.isArray(value) ? '[' + value.length + ' items]' : '{…}';
    seen.add(value);
    try {
      if (Array.isArray(value) || ArrayBuffer.isView(value)) {
        const out = []; const n = value.length;
        for (let i = 0; i < Math.min(n, items); i++) { const v = preview(value[i], depth + 1, seen, items); out.push(v === SKIP ? null : v); }
        if (n > items) out.push('… (' + n + ' items)');
        return out;
      }
      if (value instanceof Map) return preview(Object.fromEntries([...value.entries()].slice(0, 16).map(([k, v]) => [String(k), v])), depth, seen, items);
      if (value instanceof Set) return preview([...value].slice(0, items + 1), depth, seen, items);
      const out = {}, keys = Object.keys(value);
      let shown = 0;
      for (const key of keys) {
        if (shown >= 16) { out['…'] = keys.length + ' keys'; break; }
        const d = Object.getOwnPropertyDescriptor(value, key); if (!d || !('value' in d)) continue;
        const v = preview(d.value, depth + 1, seen, items); if (v === SKIP) continue;
        out[key] = v; shown++;
      }
      return out;
    } finally { seen.delete(value); }
  }
  // A variable as recorded: lists keep up to 64 items (one value per item of a step that computes many, e.g. per
  // stripe), 16 when that is too long; still too long, a local is cut as text (the FSM values are kept as they are).
  function record(value, cut = true) {
    let v = preview(value, 0, new Set(), 64); if (v === SKIP) return SKIP;
    let text = JSON.stringify(v);
    if (text && text.length > 4000) { v = preview(value, 0, new Set()); text = JSON.stringify(v); }
    return cut && text && text.length > 4000 ? text.slice(0, 3999) + '…' : v;
  }
  function add(out, read) {
    if (typeof read !== 'function') return;
    let list; try { list = read(); } catch (error) { return; }
    for (const entry of list) {
      let value; try { value = entry[1](); } catch (error) { continue; } // declared but not initialized yet
      const v = record(value); if (v !== SKIP) out[entry[0]] = v;
    }
  }
  const instOf = root => typeof rulegenLive !== 'undefined' ? rulegenLive.find(inst => inst.entry.root === root) : null;
  return {
    get recording() { return recording; },
    /** The host: whether steps are recorded at all now (a frame being traced, nothing held). */
    arm(on) { armed = Boolean(on); if (!armed) pending = []; },
    /** The host: a frame is drawn (recorded or not); steps of a frame not recorded are not kept. */
    drawStart(record) { drawing = true; recording = Boolean(record) && armed; if (recording) { steps = pending.map(step => Object.assign(step, { pre: true })); pending = []; truncated = false; } },
    drawEnd() { const out = recording ? { steps, truncated } : null; drawing = false; recording = false; steps = []; return out; },
    /** The runtime, creating a module instance: its top-level variables are bound to it. */
    creating(inst) { creating = inst; },
    bind(read) { if (creating) creating.recordVars = read; },
    // The last values of each return site inside the compute function (a helper called many times counts once).
    ret(value, read, site) { if (scope && collecting()) { scope.delete(site); scope.set(site, read); } return value; },
    call(object, name, read) {
      const method = object[name];
      if (typeof method !== 'function') return method;
      return (...args) => { const outer = caller; caller = read; try { return method.apply(object, args); } finally { caller = outer; } };
    },
    /** The runtime, around one constraint's compute function: the returns inside it are its variables. */
    enter() { const outer = scope; scope = new Map(); return outer; },
    leave(outer) { const mine = scope; scope = outer === undefined ? null : outer; return mine ? [...mine.values()] : []; },
    /** The runtime: one FSM step (see rulegenFsmEvent). */
    step(kind, nodeId, root, key, info, label, index) {
      if (!collecting()) return;
      const list = recording ? steps : pending;
      if (list.length >= MAX_STEPS) { truncated = true; return; }
      const variables = {}, inst = instOf(root);
      if (inst) add(variables, inst.recordVars);
      add(variables, caller);
      for (const read of info.locals || []) add(variables, read);
      const fsm = (name, value) => { const v = record(value, false); if (v !== SKIP) variables[name] = v; };
      fsm('$state', info.state); fsm('$data', info.data);
      if (kind === 'constraint') fsm('$value', info.value);
      // Values a temporary fork was shown live (m.demo) that this constraint read.
      if (kind === 'constraint' && info.reads) { const demo = {}; for (const k of Object.keys(info.reads)) if (k.indexOf('demo:') === 0) demo[k.slice(5)] = info.reads[k]; if (Object.keys(demo).length) fsm('$demo', demo); }
      if (kind === 'transition') fsm('$event', info.event);
      list.push(Object.assign({ kind, nodeId, root: root || '', key: key || '', state: info.state, label, index: recording ? index : -1, variables },
        kind === 'constraint' ? { constraintId: info.constraintId, property: info.property } : {},
        kind === 'transition' ? { to: info.to, event: info.event, transitionId: info.transitionId } : {}));
    },
  };
})();
`;
