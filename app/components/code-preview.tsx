import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { readSceneValues, sceneStructureKey } from "../lib/scene/machines";
import { GUARD_INPUT_RESET, GUARD_RUNTIME } from "../lib/render-guard";

export type CodePreviewHandle = {
  capture: () => string; emit: (nodeId: string, transitionId: string) => void;
  /** Whether the sketch has started and accepts messages. */
  isReady: () => boolean;
  /** Report the running sketch as it is now as a step (onTrace), e.g. to inspect a frame that has no step recorded. */
  snapshot: () => void;
  /** Replay a recorded drag (canvas pixels, ms since its start) as real mouse input. */
  replay: (points: { x: number; y: number; t: number }[]) => void;
  /** One mouse event (canvas pixels) delivered to the running sketch. */
  pointer: (kind: "mousemove" | "mousedown" | "mouseup", x: number, y: number) => void;
  /** Whether the running sketch is this program (ignoring live values). */
  isReadyFor: (executable: string) => boolean;
  /**
   * Add a (prepared) module to the running sketch in place: it is registered at
   * once, and `executable` (the program with it) is then taken without a reload,
   * so new instances of it start right away and nothing that runs is reset.
   */
  /** Take a module into the running program in place. `replace`: the module key it replaces, whose running instances switch to it (keeping their store). */
  inject: (module: string, executable: string, replace?: string) => void;
};
/** A state change (or manual capture) recorded by the running sketch, with its runtime snapshot (module stores, machine states, random seed). */
export type TraceStep = { nodeId: string | null; from: string | null; to: string | null; transitionId: string | null; params: Record<string, unknown>; runtime: unknown };
/** A recorded step to hold the running sketch at (null: run live). */
/** A recorded step to hold the sketch at: its runtime, and what-if values it is drawn with (that step only). */
export type RestorePoint = { id: string; runtime: unknown; params?: Record<string, unknown>;
  /** What-if values of single drawn items (by item id), read by m.v(key, id). */
  items?: Record<string, Record<string, unknown>>;
  /** Record the held moment's drawing as one run of the code (an exploration frame), drawing only `budget` events of it (null: all). */
  run?: { budget: number | null; roots?: string[];
    /** The checkpoint (its number in the run) whose picture of the brush so far is drawn (m.trace's show). */
    show?: number | null } } | null;
/** One run of the code as executed: checkpoints (m.trace) and drawing calls in order, with where each is on the canvas. */
export type ExecutionRun = { total: number; events: { index: number; kind: string; label: string; x?: number; y?: number; w?: number; h?: number; root?: string; data?: unknown;
  /** A checkpoint that can draw the brush as it is after it. */ shows?: boolean }[] };
export type StateJump = { nodeId: string; stateId: string; revision: number } | null;
type Props = { executable: string; onError: (error: string) => void; machineEnabled?: boolean;
  /** Show the running sketch (a hidden one is not drawn by the browser) without giving it input. */
  visible?: boolean;
  /** Esc pressed inside the running sketch (it has the keyboard while it takes input). */
  onEscape?: () => void; /** Record a step at every state change. */ tracing?: boolean; onTrace?: (step: TraceStep) => void; /** Interaction mode: the running sketch is shown and receives pointer/keyboard input. */ interactive?: boolean; jump?: StateJump; playing?: boolean; /** Hold the running sketch at this recorded step; value edits re-render from it. */ restore?: RestorePoint; /** The stores as the held step is drawn now (by the current code and values), with its restore id (and the run, when one was asked for). */ onDrawn?: (restoreId: string, stores: Record<string, unknown>, run?: ExecutionRun) => void; /** Start the running sketch from this runtime (a fork keeps the brush marks it was made with), once per id and load. */ seed?: { id: string; runtime: unknown } | null; /** Every picture the sketch shows (a capture). */ onCapture?: (image: string) => void; onStatesChange?: (states: Record<string, string>) => void };

/**
 * Runs a prepared sketch in an isolated iframe. The sketch is reloaded only when
 * its program changes; slider edits and layer moves only change the host block's
 * values, which are pushed into the running sketch and re-rendered in place.
 */
export const CodePreview = forwardRef<CodePreviewHandle, Props>(function CodePreview(props, ref) {
  const { executable, machineEnabled = false } = props;
  const current = useRef(props); current.current = props;
  const frame = useRef<HTMLIFrameElement>(null);
  const tokenRef = useRef(""), loaded = useRef(""), ready = useRef(false), sentJump = useRef<number | null>(null), sentRestore = useRef<string | null>(null), sentSeed = useRef<string | null>(null), lastStates = useRef(""), sentValues = useRef("");
  const [document, setDocument] = useState("");
  const [image, setImage] = useState("");
  // Programs taken in place (a module injected) map to the program actually loaded; anything else reloads.
  const aliases = useRef(new Map<string, string>());
  // The first program starts at once; later ones wait a moment, so rapid changes reload once.
  const firstLoad = useRef(true);
  const resolve = (key: string) => aliases.current.get(key) ?? key;
  const structure = resolve(sceneStructureKey(executable));
  const post = (message: object) => frame.current?.contentWindow?.postMessage({ channel: "rulegen-control", token: tokenRef.current, ...message }, "*");
  const sendControls = () => {
    if (!tokenRef.current || !ready.current) return;
    const state = current.current;
    const jump = state.jump && sentJump.current !== state.jump.revision ? state.jump : null;
    post({ type: "control", nodeId: jump?.nodeId ?? null, stateId: jump?.stateId ?? null, playing: state.playing ?? true, tracing: Boolean(state.tracing) });
    sentJump.current = state.jump?.revision ?? null;
  };
  const sendValues = () => {
    if (!ready.current) return;
    const values = readSceneValues(current.current.executable), key = JSON.stringify(values);
    if (!values || key === sentValues.current) return;
    sentValues.current = key; post({ type: "scene", params: values.params, machines: values.machines, instances: values.instances });
  };
  const sendRestore = () => {
    if (!ready.current) return;
    const point = current.current.restore ?? null, id = point && point.runtime ? point.id : null, params = id === null ? null : point!.params ?? null, items = id === null ? null : point!.items ?? null, run = id === null ? null : point!.run ?? null;
    const key = id === null ? null : `${id}|${JSON.stringify(params)}|${JSON.stringify(items)}|${JSON.stringify(run)}`;
    if (key === sentRestore.current) return;
    sentRestore.current = key; post({ type: "restore", id, snapshot: id === null ? null : point!.runtime, params, items, run });
  };
  const sendSeed = () => {
    const seed = current.current.seed;
    if (!ready.current || !seed?.runtime || sentSeed.current === seed.id) return;
    sentSeed.current = seed.id; post({ type: "seed", snapshot: seed.runtime });
  };
  useImperativeHandle(ref, () => ({ capture: () => image, emit: (nodeId, transitionId) => post({ type: "event", nodeId, transitionId }),
    isReady: () => ready.current, snapshot: () => post({ type: "snapshot" }), replay: points => post({ type: "replay", points: points.slice(0, 2000) }),
    // A forwarded press focuses the sketch, as a real one would: sketches may ignore input while unfocused (p5 focused), and keys then reach it.
    pointer: (kind, x, y) => { if (kind === "mousedown" && window.document.activeElement !== frame.current) frame.current?.focus(); post({ type: "pointer", kind, x, y }); }, isReadyFor: executable => ready.current && loaded.current === resolve(sceneStructureKey(executable)),
    inject: (module, executable, replace) => {
      if (!ready.current) return;
      // A replaced module may read values the running program does not have yet: they go in first.
      if (replace) { const values = readSceneValues(executable); if (values) { sentValues.current = JSON.stringify(values); post({ type: "scene", params: values.params, machines: values.machines, instances: values.instances }); } }
      post({ type: "module", code: module, ...(replace ? { replace } : {}) }); aliases.current.set(sceneStructureKey(executable), loaded.current);
    } }));
  useEffect(sendControls, [props.jump?.revision, props.playing, props.tracing]);
  useEffect(sendValues, [executable]);
  useEffect(sendSeed, [props.seed?.id ?? null]);
  useEffect(sendRestore, [props.restore?.id ?? null, Boolean(props.restore?.runtime), JSON.stringify(props.restore?.params ?? null), JSON.stringify(props.restore?.items ?? null), JSON.stringify(props.restore?.run ?? null)]);
  useEffect(() => {
    const token = crypto.randomUUID();
    tokenRef.current = token; ready.current = false; loaded.current = structure; aliases.current.clear(); sentJump.current = null; sentRestore.current = null; sentSeed.current = null; lastStates.current = "";
    sentValues.current = JSON.stringify(readSceneValues(current.current.executable));
    const script = current.current.executable.replace(/<\/script/gi, "<\\/script");
    const origin = window.location.origin;
    const send = `parent.postMessage({channel:'rulegen',token:${JSON.stringify(token)},error:String(error)},'*')`;
    const timer = setTimeout(() => setDocument(`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' ${origin}; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none';"><style>html,body{margin:0;overflow:hidden;background:#fffefa}canvas{display:block}</style><script src="${origin}/vendor/p5.min.js"></script></head><body><script>
window.onerror=(error)=>{${send}};addEventListener('keydown',e=>{if(e.key==='Escape')parent.postMessage({channel:'rulegen',token:${JSON.stringify(token)},escape:true},'*');});window.onunhandledrejection=(e)=>{const error=e.reason;${send}};
${GUARD_RUNTIME}
${GUARD_INPUT_RESET}
try{new p5(p=>{${script}
const setup=p.setup,draw=p.draw;let lastCapture=0,forceRender=true,wasLooping=true;
// Machines can arrive later (an injected module, new values), so this is asked each time.
const hasMachine=()=>typeof rulegenMachines!=='undefined'&&Object.keys(rulegenMachines).length>0;
let tracing=false,traceQueue=[],lastEmit=null;
const paramsNow=()=>typeof rulegenParams!=='undefined'?Object.assign({},rulegenParams):{};
// Each transition keeps the runtime state of its own moment: several can happen within one frame (a state left at once), and each step must restore to its own state.
// A selected step (pinned) is held exactly: no transition happens and none is recorded while it is shown.
let pinned=null,pinnedId=null,pinnedParams=null,pinnedItems=null,pinnedRun=null,lastPlaying=true;
// The running state when a step was first held, so Live goes back to it (holding a step puts that step's state into the sketch).
let beforePinned=null;
const snapshotNow=()=>{try{return typeof rulegenSnapshot==='function'?rulegenSnapshot():null;}catch(error){return null;}};
if(typeof rulegenEmit==='function'&&typeof rulegenJumpState==='function'){
  const emitBase=rulegenEmit;rulegenEmit=function(nodeId,transitionId){if(pinned)return false;lastEmit={nodeId,transitionId};try{return emitBase(nodeId,transitionId);}finally{lastEmit=null;}};
  const jumpBase=rulegenJumpState;rulegenJumpState=function(nodeId,id){if(pinned)return false;
    const from=rulegenState[nodeId]?rulegenState[nodeId].id:null,ok=jumpBase(nodeId,id);
    if(ok&&tracing&&!replaying){const timed=rulegenMachines[nodeId].transitions.find(item=>item.from===from&&item.to===id&&item.trigger==='after');
      traceQueue.push({nodeId,from,to:id,transitionId:lastEmit&&lastEmit.nodeId===nodeId?lastEmit.transitionId:(timed?timed.id:null),params:paramsNow(),runtime:snapshotNow()});}
    return ok;};
}
// Steps keep the runtime state (not an image), so selecting one puts the running sketch back there.
function flushTrace(){if(!traceQueue.length)return;let shared;
  const steps=traceQueue;traceQueue=[];steps.forEach(step=>{if(step.runtime===undefined){if(shared===undefined)shared=snapshotNow();step.runtime=shared;}parent.postMessage({channel:'rulegen',token:${JSON.stringify(token)},trace:step},'*');});}
let pointerDown=false;
// Input history: every press-drag-release given to the sketch (by hand or forwarded), in canvas pixels.
// A value change replays it from the start, so values that only act on input (spacing of a trail, emission rate…) show at once.
let gestures=[],gesture=null,replaying=false;const MAX_GESTURES=12,MAX_POINTS=1500;
function canvasPoint(e){const canvas=document.querySelector('canvas');if(!canvas)return null;const box=canvas.getBoundingClientRect();return {x:(e.clientX-box.left)*(p.width||box.width)/box.width,y:(e.clientY-box.top)*(p.height||box.height)/box.height};}
addEventListener('mousedown',e=>{if(replaying||e.button!==0)return;const point=canvasPoint(e);if(!point)return;gesture=[point];gestures.push(gesture);if(gestures.length>MAX_GESTURES)gestures.shift();},true);
addEventListener('mousemove',e=>{if(replaying||!gesture||gesture.length>=MAX_POINTS)return;const point=canvasPoint(e);if(point)gesture.push(point);},true);
addEventListener('mouseup',e=>{if(replaying)return;gesture=null;},true);
// Start over (machines, every setup) and give the recorded input again, quickly: at most ~200 frames are drawn.
function replayHistory(){
  if(!gestures.length||pinned||typeof rulegenSetup!=='function')return false;
  // The input was given while the sketch had focus (sketches may stop on blur): it is focused again for the replay.
  replaying=true;const wasFocused=p.focused;p.focused=true;
  try{budgetReset();if(hasMachine())rulegenResetStates();if(typeof rulegenInputReset==='function')rulegenInputReset();rulegenSetup();
    const total=gestures.reduce((n,g)=>n+g.length,0),every=Math.max(1,Math.ceil(total/200));let count=0;
    const frame=()=>{budgetReset();p.redraw();};
    for(const g of gestures){if(!g.length)continue;fire('mousemove',g[0]);fire('mousedown',g[0]);frame();
      for(let i=1;i<g.length;i++){fire('mousemove',g[i]);if(++count%every===0)frame();}
      const last=g[g.length-1];if(gesture!==g){fire('mouseup',last);fire('click',last);}frame();}
  }finally{replaying=false;p.focused=wasFocused;}
  forceRender=true;p.redraw();capture();return true;
}
function fire(type,point){const canvas=document.querySelector('canvas');if(!canvas)return;if(type==='mousedown')pointerDown=true;if(type==='mouseup')pointerDown=false;
  const box=canvas.getBoundingClientRect();canvas.dispatchEvent(new MouseEvent(type,{bubbles:true,cancelable:true,view:window,button:0,buttons:pointerDown?1:0,clientX:box.left+point.x*box.width/(p.width||box.width),clientY:box.top+point.y*box.height/(p.height||box.height)}));}
function replay(points){if(!points.length)return;
  fire('mousemove',points[0]);fire('mousedown',points[0]);
  points.slice(1).forEach(point=>setTimeout(()=>fire('mousemove',point),Math.max(0,point.t)));
  const last=points[points.length-1];setTimeout(()=>{fire('mouseup',last);fire('click',last);},Math.max(0,last.t)+16);}
// Draw the pinned step: its state is put back, drawn once, and put back again, so the sketch's own draw cannot move it on.
// What-if values of the pinned step go over the values for that drawing only; restoring again puts the real ones back.
// Single items' what-if values are read by m.v(key, id) during that drawing only.
// An exploration frame records that drawing as one run of the code (checkpoints and drawing calls), drawing only its budget of it.
function showPinned(){rulegenRestore(pinned);if(pinnedParams)for(const key of Object.keys(pinnedParams))if(key in rulegenParams)rulegenParams[key]=pinnedParams[key];const items=typeof rulegenItemValues!=='undefined';if(items)rulegenItemValues=pinnedItems||{};const running=Boolean(pinnedRun)&&typeof rulegenRunStart==='function';if(running)rulegenRunStart(pinnedRun.budget,pinnedRun.roots,pinnedRun.show);try{forceRender=true;p.redraw();reportDrawn(running?rulegenRunEnd():null);}finally{if(items)rulegenItemValues={};if(running&&rulegenRun)rulegenRunEnd();}rulegenRestore(pinned);}
// The stores as the running code draws the restored step (read by inspection overlays at that step).
function reportDrawn(run){if(typeof rulegenLive==='undefined'||typeof rulegenPlain!=='function')return;const stores={};for(const inst of rulegenLive)stores[inst.entry.root]=rulegenPlain(inst.store,0);parent.postMessage({channel:'rulegen',token:${JSON.stringify(token)},drawn:stores,drawnFor:pinnedId,run:run||null},'*');}
function capture(){const canvas=document.querySelector('canvas');if(canvas)parent.postMessage({channel:'rulegen',token:${JSON.stringify(token)},image:canvas.toDataURL('image/png'),states:hasMachine()?Object.fromEntries(Object.keys(rulegenState).map(id=>[id,rulegenState[id].id])):null},'*');}
// changed: the value keys that just changed; only setups that read one of them run again (older programs run every setup).
function rerender(changed){budgetReset();if(typeof rulegenSetup==='function'){if(!changed||changed.size)rulegenSetup(changed);}else setup();forceRender=true;p.redraw();capture();}
window.addEventListener('message',event=>{
  if(event.source!==parent || event.data?.channel!=='rulegen-control' || event.data.token!==${JSON.stringify(token)})return;
  try{budgetReset();
    if(event.data.type==='snapshot'){traceQueue.push({nodeId:null,from:null,to:null,transitionId:null,params:paramsNow()});flushTrace();return;}
    if(event.data.type==='control'){
      if(hasMachine() && typeof event.data.nodeId==='string' && typeof event.data.stateId==='string')rulegenJumpState(event.data.nodeId,event.data.stateId);
      const playing=event.data.playing===true;lastPlaying=playing;
      if(typeof rulegenPlaying!=='undefined')rulegenPlaying=playing&&!pinned;
      const trace=event.data.tracing===true;if(trace&&!tracing)traceQueue.push({nodeId:null,from:null,to:null,transitionId:null,params:paramsNow()});tracing=trace;
      if(playing&&!pinned){if(wasLooping)p.loop();}else p.noLoop();
    }else if(event.data.type==='module' && typeof event.data.code==='string' && typeof rulegenModule==='function'){eval(event.data.code);if(typeof event.data.replace==='string'&&typeof rulegenRefreshModule==='function'){rulegenRefreshModule(event.data.replace);if(pinned)showPinned();else{forceRender=true;p.redraw();if(tracing){traceQueue.push({nodeId:null,from:null,to:null,transitionId:null,params:paramsNow()});flushTrace();}}capture();}return;
    }else if(event.data.type==='replay' && Array.isArray(event.data.points)){replay(event.data.points.filter(point=>point&&Number.isFinite(point.x)&&Number.isFinite(point.y)&&Number.isFinite(point.t)));return;
    }else if(event.data.type==='pointer' && ['mousemove','mousedown','mouseup'].includes(event.data.kind) && Number.isFinite(event.data.x) && Number.isFinite(event.data.y)){fire(event.data.kind,{x:event.data.x,y:event.data.y});if(event.data.kind==='mouseup')fire('click',{x:event.data.x,y:event.data.y});return;
    }else if(event.data.type==='restore'){
      if(event.data.snapshot&&typeof rulegenRestore==='function'){if(!pinned)beforePinned=snapshotNow();pinned=event.data.snapshot;pinnedId=typeof event.data.id==='string'?event.data.id:null;pinnedParams=event.data.params&&typeof event.data.params==='object'?event.data.params:null;pinnedItems=event.data.items&&typeof event.data.items==='object'?event.data.items:null;pinnedRun=event.data.run&&typeof event.data.run==='object'?event.data.run:null;if(typeof rulegenPlaying!=='undefined')rulegenPlaying=false;p.noLoop();showPinned();return;}
      else if(pinned){pinned=null;pinnedId=null;pinnedParams=null;pinnedItems=null;pinnedRun=null;if(beforePinned&&typeof rulegenRestore==='function')rulegenRestore(beforePinned);beforePinned=null;if(typeof rulegenPlaying!=='undefined')rulegenPlaying=lastPlaying;forceRender=true;if(lastPlaying&&wasLooping)p.loop();else p.redraw();}
    }else if(event.data.type==='seed'){
      // The running sketch goes on from this runtime (a held step, if any, comes back to it when let go).
      if(event.data.snapshot&&typeof rulegenRestore==='function'){if(pinned)beforePinned=event.data.snapshot;else{rulegenRestore(event.data.snapshot);forceRender=true;p.redraw();capture();}}return;
    }else if(event.data.type==='event' && hasMachine() && typeof event.data.nodeId==='string' && typeof event.data.transitionId==='string')rulegenEmit(event.data.nodeId,event.data.transitionId);
    else if(event.data.type==='scene' && typeof rulegenBase!=='undefined'){
      const before=Object.assign({},rulegenParams);
      Object.assign(rulegenBase,event.data.params||{});
      const machines=event.data.machines||{};for(const id of Object.keys(machines)){if(rulegenMachines[id])Object.assign(rulegenMachines[id],machines[id]);else{rulegenMachines[id]=machines[id];rulegenState[id]={id:machines[id].initialState,elapsed:0};}}
      for(const id of Object.keys(rulegenMachines))if(!machines[id]){delete rulegenMachines[id];delete rulegenState[id];}
      if(Array.isArray(event.data.instances)&&typeof rulegenInstances!=='undefined'){rulegenInstances.splice(0,rulegenInstances.length,...event.data.instances);rulegenSync();}
      rulegenApply();if(pinned){showPinned();return;}
      const changed=new Set(Object.keys(rulegenParams).filter(key=>rulegenParams[key]!==before[key]));
      // Modules that derive from m.history() adjust in place; only programs that keep what they made from input need it given again.
      if(changed.size&&!pointerDown&&(typeof rulegenNeedsReplay!=='function'||rulegenNeedsReplay())&&replayHistory())return;
      rerender(changed);return;
    }
    forceRender=true;p.redraw();
  }catch(error){${send}}
});
p.setup=()=>{budgetReset();setup();wasLooping=typeof p.isLooping==='function'?p.isLooping():true;capture();parent.postMessage({channel:'rulegen',token:${JSON.stringify(token)},ready:true},'*');};
p.draw=()=>{budgetReset();try{
  if(hasMachine() && !rulegenPlaying && !forceRender && !replaying)return;
  if(draw)draw();
  if(replaying)return;
  flushTrace();
  if(forceRender || performance.now()-lastCapture>150){capture();lastCapture=performance.now();}
  forceRender=false;
}catch(error){p.noLoop();${send}}};
});}catch(error){${send}}</script></body></html>`), firstLoad.current ? 0 : 100);
    firstLoad.current = false;
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.data?.channel !== "rulegen" || event.data.token !== token) return;
      if (event.data.escape) { current.current.onEscape?.(); return; }
      if (event.data.ready) { ready.current = true; sentJump.current = null; sendControls(); sendValues(); sendSeed(); sendRestore(); }
      if (typeof event.data.error === "string") current.current.onError(event.data.error.slice(0, 500));
      if (event.data.drawn && typeof event.data.drawn === "object" && typeof event.data.drawnFor === "string" && sentRestore.current?.startsWith(`${event.data.drawnFor}|`) && JSON.stringify(event.data.drawn).length < 1_500_000) {
        const run = event.data.run && typeof event.data.run === "object" && Number.isFinite(event.data.run.total) && Array.isArray(event.data.run.events) && JSON.stringify(event.data.run).length < 3_000_000 ? event.data.run as ExecutionRun : undefined;
        current.current.onDrawn?.(event.data.drawnFor, event.data.drawn, run);
      }
      const trace = event.data.trace;
      if (trace && typeof trace === "object" && trace.params && typeof trace.params === "object") {
        const text = (value: unknown) => typeof value === "string" ? value.slice(0, 80) : null;
        current.current.onTrace?.({ nodeId: text(trace.nodeId), from: text(trace.from), to: text(trace.to), transitionId: text(trace.transitionId), params: trace.params,
          runtime: trace.runtime && typeof trace.runtime === "object" && JSON.stringify(trace.runtime).length < 1_500_000 ? trace.runtime : null });
      }
      if (event.data.states && typeof event.data.states === "object") {
        const states = Object.fromEntries(Object.entries(event.data.states as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
        const key = JSON.stringify(states);
        if (key !== lastStates.current) { lastStates.current = key; current.current.onStatesChange?.(states); }
      }
      if (typeof event.data.image === "string" && /^data:image\/png;base64,/.test(event.data.image) && event.data.image.length < 8_000_000) { setImage(event.data.image); current.current.onCapture?.(event.data.image); }
    };
    window.addEventListener("message", receive); return () => { clearTimeout(timer); window.removeEventListener("message", receive); };
  }, [structure]);
  // The last rendered image stays visible while a new program loads, so re-runs do not flash.
  return <div className="isolated-code-render">{image ? <img src={image} alt="Generated p5.js visual output" /> : <span className="engine-loading">Rendering p5.js…</span>}<iframe ref={frame} className={`p5-code-preview isolated-engine-frame ${machineEnabled || props.visible ? "live-state-engine" : ""} ${props.interactive ? "interactive-engine" : ""}`} title="Generated p5.js render engine" sandbox="allow-scripts" srcDoc={document} /></div>;
});
