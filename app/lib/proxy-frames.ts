import { z } from "zod";
import { idSchema } from "./scene/schema";
import { besideFramePosition, FRAME_GAP_X, FRAME_HEIGHT, FRAME_WIDTH, groupRow, type WorkspaceLayout } from "./workspace";

// A proxy frame sits on the board beside a sketch frame and runs the direct
// manipulation handles of one constraint of one of its nodes (each with the
// whole frame to itself): using them changes that node live. A node's proxy
// frames are kept together in one frame group. A node with no handles yet has
// one frame for the node (to design them from).

export const MAX_PROXY_FRAMES = 60;
export const proxyFrameSchema = z.object({ id: z.string().regex(/^proxy-[a-zA-Z0-9-]+$/).max(80), targetFrameId: z.string().max(80), nodeId: idSchema,
  /** The constraint whose widgets it runs (none: the node's, by constraint). */
  constraintId: idSchema.optional(),
  /** Taken off the board (kept, with its spot); shown again from its siblings or the target frame. */
  hidden: z.preprocess(value => typeof value === "boolean" ? value : undefined, z.boolean().optional()) });
export type ProxyFrame = z.infer<typeof proxyFrameSchema>;
export const isProxyFrame = (id: string): id is `proxy-${string}` => id.startsWith("proxy-");
/** A node's proxy frames: the node's own first, then by constraint (in `order`). */
export function proxiesOf(frames: ProxyFrame[], targetFrameId: string, nodeId: string, order: string[] = []) {
  const rank = (frame: ProxyFrame) => frame.constraintId ? (order.indexOf(frame.constraintId) + 1 || order.length + 1) : 0;
  return frames.filter(frame => frame.targetFrameId === targetFrameId && frame.nodeId === nodeId).sort((a, b) => rank(a) - rank(b));
}
export const proxyFor = (frames: ProxyFrame[], targetFrameId: string, nodeId: string) => proxiesOf(frames, targetFrameId, nodeId)[0];

/**
 * The proxy frames a node gets when its handles are opened: one per constraint with widgets (`withWidgets`,
 * in order), all shown; while it has none, one for the node. A node frame goes once there are constraint frames.
 * At most `max` frames in all (`left`: how many did not fit).
 */
export function planProxyFrames(frames: ProxyFrame[], targetFrameId: string, nodeId: string, withWidgets: string[], makeId: () => string, max = MAX_PROXY_FRAMES) {
  const mine = proxiesOf(frames, targetFrameId, nodeId), others = frames.filter(frame => !mine.includes(frame));
  const wanted = withWidgets.filter(id => !mine.some(frame => frame.constraintId === id));
  const removed = withWidgets.length ? mine.filter(frame => !frame.constraintId) : [];
  const kept = mine.filter(frame => !removed.includes(frame)).map(frame => frame.hidden ? { ...frame, hidden: false } : frame);
  const room = Math.max(0, max - others.length - kept.length);
  const added: ProxyFrame[] = (withWidgets.length ? wanted : kept.length ? [] : [undefined]).slice(0, room)
    .map(constraintId => ({ id: makeId(), targetFrameId, nodeId, ...(constraintId ? { constraintId } : {}) }));
  const left = (withWidgets.length ? wanted.length : kept.length ? 0 : 1) - added.length;
  return { frames: [...others, ...kept, ...added], mine: proxiesOf([...kept, ...added], targetFrameId, nodeId, withWidgets), added, removed, left };
}

/**
 * The board after opening a node's proxy frames (`plan`): the node's frames in one frame group titled `title`
 * (its group kept, its frames taken out of any other). New frames of a new group go in a row beside the target
 * frame, clear of everything; joining a group, they take a removed node frame's spot, else go after its rightmost
 * frame (or under it when that is taken).
 */
export function placeProxyGroup(layout: WorkspaceLayout, plan: Pick<ReturnType<typeof planProxyFrames>, "mine" | "added" | "removed">, targetFrameId: string, title: string, groupId: () => string): WorkspaceLayout {
  const members = plan.mine.map(frame => frame.id), gone = new Set(plan.removed.map(frame => frame.id));
  const frames = { ...layout.frames }, reuse = plan.removed.map(frame => frames[frame.id]).filter(Boolean);
  for (const id of gone) delete frames[id];
  const fresh = plan.added.map(frame => frame.id).filter(id => !frames[id]);
  const row = members.some(id => frames[id]) || reuse.length ? [] : groupRow({ frames, groups: layout.groups }, targetFrameId, fresh.length);
  for (const [i, id] of fresh.entries()) {
    const spot = reuse.shift() ?? row[i];
    if (spot) { frames[id] = spot; continue; }
    const placed = members.filter(member => member !== id && frames[member]), right = placed.sort((a, b) => frames[b].x - frames[a].x)[0];
    const next = right ? { x: frames[right].x + FRAME_WIDTH + FRAME_GAP_X, y: frames[right].y } : null;
    const free = next && !Object.values(frames).some(at => Math.abs(at.x - next.x) < FRAME_WIDTH && Math.abs(at.y - next.y) < FRAME_HEIGHT);
    frames[id] = free ? next! : besideFramePosition(frames, right ?? targetFrameId);
  }
  const group = layout.groups.find(item => item.frames.some(id => members.includes(id) || gone.has(id)));
  const others = layout.groups.filter(item => item !== group).map(item => ({ ...item, frames: item.frames.filter(id => !members.includes(id)) })).filter(item => item.frames.length);
  return { ...layout, frames, groups: [...others, { id: group?.id ?? groupId(), title: title.slice(0, 200), frames: members.slice(0, 12) }].slice(-48) };
}

const INPUT_HANDLERS = /\b(mousePressed|mouseDragged|mouseReleased|mouseClicked|touchStarted|touchMoved|touchEnded)\s*\(/;
/**
 * Whether a module takes pressed input but does not derive from `m.history()`:
 * what it made from input then keeps the values of that moment, so a value
 * change can only show by giving the input again (the whole result is redrawn).
 */
export const bakesInput = (module: string | undefined) => Boolean(module && INPUT_HANDLERS.test(module) && !/\bm\.history\s*\(/.test(module));
/** The code instruction that turns such modules into ones that adjust in place. */
export const ADJUST_IN_PLACE_INSTRUCTION = "Rewrite the modules so that everything made from pressed input (trails, stamps, strokes, emitted items) is derived in draw every frame from m.history() and the current values, as the DERIVE FROM THE INPUT rule says, instead of being stored when the input arrived. Keep the current look, behavior and state machines. Compute what each gesture makes once with m.memo, keyed by the gesture's id and rev and the values it uses, so a frame does not redo all of the input.";
