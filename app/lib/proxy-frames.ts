import { z } from "zod";
import { idSchema } from "./scene/schema";

// A proxy frame sits on the board beside a sketch frame and runs the direct
// manipulation handles of one of its nodes: using them changes that node live.

export const MAX_PROXY_FRAMES = 24;
export const proxyFrameSchema = z.object({ id: z.string().regex(/^proxy-[a-zA-Z0-9-]+$/).max(80), targetFrameId: z.string().max(80), nodeId: idSchema });
export type ProxyFrame = z.infer<typeof proxyFrameSchema>;
export const isProxyFrame = (id: string): id is `proxy-${string}` => id.startsWith("proxy-");
export const proxyFor = (frames: ProxyFrame[], targetFrameId: string, nodeId: string) => frames.find(frame => frame.targetFrameId === targetFrameId && frame.nodeId === nodeId);

const INPUT_HANDLERS = /\b(mousePressed|mouseDragged|mouseReleased|mouseClicked|touchStarted|touchMoved|touchEnded)\s*\(/;
/**
 * Whether a module takes pressed input but does not derive from `m.history()`:
 * what it made from input then keeps the values of that moment, so a value
 * change can only show by giving the input again (the whole result is redrawn).
 */
export const bakesInput = (module: string | undefined) => Boolean(module && INPUT_HANDLERS.test(module) && !/\bm\.history\s*\(/.test(module));
/** The code instruction that turns such modules into ones that adjust in place. */
export const ADJUST_IN_PLACE_INSTRUCTION = "Rewrite the modules so that everything made from pressed input (trails, stamps, strokes, emitted items) is derived in draw every frame from m.history() and the current values, as the DERIVE FROM THE INPUT rule says, instead of being stored when the input arrived. Keep the current look, behavior and state machines. Compute what each gesture makes once with m.memo, keyed by the gesture's id and rev and the values it uses, so a frame does not redo all of the input.";
