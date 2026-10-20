// The guard that every loop and function of sandboxed code calls (inserted by
// guardCode). It stops a frame that runs away (an endless loop or recursion)
// by TIME, not by a count of steps: a heavy but finite frame (e.g. a long trail
// redrawn from the input history) keeps running, and only a frame that has not
// finished after FRAME_LIMIT_MS stops. Each frame, input event and message
// starts the clock again (budgetReset).

/** How long one frame, input event or message may run. */
export const FRAME_LIMIT_MS = 10000;
export const BUDGET_ERROR = `Rendering budget exceeded: one frame ran over ${FRAME_LIMIT_MS / 1000}s (an endless loop or recursion?). Make each frame lighter or bound its loops: compute what each gesture of m.history() makes once with m.memo (keyed by its id, rev and values), never redo all of the input every frame.`;
/** Sandbox source defining `budgetReset()` and `__rulegenGuard()`. */
export const GUARD_RUNTIME = `let budget=0,budgetAt=performance.now();function budgetReset(){budget=0;budgetAt=performance.now();}
function __rulegenGuard(){if((++budget&1023)===0&&performance.now()-budgetAt>${FRAME_LIMIT_MS})throw new Error(${JSON.stringify(BUDGET_ERROR)});}`;
/** Input reaches sketch code between frames: each event starts the clock again (capture phase, before p5 sees it). */
export const GUARD_INPUT_RESET = `['mousedown','mousemove','mouseup','click','dblclick','wheel','touchstart','touchmove','touchend','touchcancel','keydown','keyup','pointerdown','pointermove','pointerup'].forEach(type=>addEventListener(type,budgetReset,true));`;
