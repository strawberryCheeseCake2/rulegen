import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { readSceneValues, sceneStructureKey } from "../lib/scene/machines";

export type CodePreviewHandle = {
  capture: () => string; emit: (nodeId: string, transitionId: string) => void;
  /** Whether the sketch has started and accepts messages. */
  isReady: () => boolean;
  /** Replay a recorded drag (canvas pixels, ms since its start) as real mouse input. */
  replay: (points: { x: number; y: number; t: number }[]) => void;
  /** One mouse event (canvas pixels) delivered to the running sketch. */
  pointer: (kind: "mousemove" | "mousedown" | "mouseup", x: number, y: number) => void;
  /** Whether the running sketch is this program (ignoring live values). */
  isReadyFor: (executable: string) => boolean;
};
/** A state change (or manual capture) recorded by the running sketch, with its runtime snapshot (module stores, machine states, random seed). */
export type TraceStep = { nodeId: string | null; from: string | null; to: string | null; transitionId: string | null; params: Record<string, unknown>; runtime: unknown };
/** A recorded step to hold the running sketch at (null: run live). */
export type RestorePoint = { id: string; runtime: unknown } | null;
export type StateJump = { nodeId: string; stateId: string; revision: number } | null;
type Props = { executable: string; onError: (error: string) => void; machineEnabled?: boolean; /** Record a step at every state change. */ tracing?: boolean; onTrace?: (step: TraceStep) => void; /** Interaction mode: the running sketch is shown and receives pointer/keyboard input. */ interactive?: boolean; jump?: StateJump; playing?: boolean; /** Hold the running sketch at this recorded step; value edits re-render from it. */ restore?: RestorePoint; onStatesChange?: (states: Record<string, string>) => void };

/**
 * Runs a prepared sketch in an isolated iframe. The sketch is reloaded only when
 * its program changes; slider edits and layer moves only change the host block's
 * values, which are pushed into the running sketch and re-rendered in place.
 */
export const CodePreview = forwardRef<CodePreviewHandle, Props>(function CodePreview(props, ref) {
  const { executable, machineEnabled = false } = props;
  const current = useRef(props); current.current = props;
  const frame = useRef<HTMLIFrameElement>(null);
  const tokenRef = useRef(""), loaded = useRef(""), ready = useRef(false), sentJump = useRef<number | null>(null), sentRestore = useRef<string | null>(null), lastStates = useRef(""), sentValues = useRef("");
  const [document, setDocument] = useState("");
  const [image, setImage] = useState("");
  const structure = sceneStructureKey(executable);
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
    const point = current.current.restore ?? null, id = point && point.runtime ? point.id : null;
    if (id === sentRestore.current) return;
    sentRestore.current = id; post({ type: "restore", snapshot: id === null ? null : point!.runtime });
  };
  useImperativeHandle(ref, () => ({ capture: () => image, emit: (nodeId, transitionId) => post({ type: "event", nodeId, transitionId }),
    isReady: () => ready.current, replay: points => post({ type: "replay", points: points.slice(0, 2000) }),
    pointer: (kind, x, y) => post({ type: "pointer", kind, x, y }), isReadyFor: executable => ready.current && loaded.current === sceneStructureKey(executable) }));
  useEffect(sendControls, [props.jump?.revision, props.playing, props.tracing]);
  useEffect(sendValues, [executable]);
  useEffect(sendRestore, [props.restore?.id ?? null, Boolean(props.restore?.runtime)]);
  useEffect(() => {
    const token = crypto.randomUUID();
    tokenRef.current = token; ready.current = false; loaded.current = structure; sentJump.current = null; sentRestore.current = null; lastStates.current = "";
    sentValues.current = JSON.stringify(readSceneValues(current.current.executable));
    const script = current.current.executable.replace(/<\/script/gi, "<\\/script");
    const origin = window.location.origin;
    const send = `parent.postMessage({channel:'rulegen',token:${JSON.stringify(token)},error:String(error)},'*')`;
    const timer = setTimeout(() => setDocument(`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' ${origin}; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none';"><style>html,body{margin:0;overflow:hidden;background:#fffefa}canvas{display:block}</style><script src="${origin}/vendor/p5.min.js"></script></head><body><script>
window.onerror=(error)=>{${send}};window.onunhandledrejection=(e)=>{const error=e.reason;${send}};
let budget=0;function __rulegenGuard(){if(++budget>100000)throw new Error('Rendering budget exceeded. Reduce loops or recursion.')}
try{new p5(p=>{${script}
const setup=p.setup,draw=p.draw;let lastCapture=0,forceRender=true,wasLooping=true;
const hasMachine=${machineEnabled} && typeof rulegenMachines !== 'undefined' && Object.keys(rulegenMachines).length>0;
let tracing=false,traceQueue=[],lastEmit=null;
const paramsNow=()=>typeof rulegenParams!=='undefined'?Object.assign({},rulegenParams):{};
if(hasMachine){
  const emitBase=rulegenEmit;rulegenEmit=function(nodeId,transitionId){lastEmit={nodeId,transitionId};try{return emitBase(nodeId,transitionId);}finally{lastEmit=null;}};
  const jumpBase=rulegenJumpState;rulegenJumpState=function(nodeId,id){
    const from=rulegenState[nodeId]?rulegenState[nodeId].id:null,ok=jumpBase(nodeId,id);
    if(ok&&tracing){const timed=rulegenMachines[nodeId].transitions.find(item=>item.from===from&&item.to===id&&item.trigger==='after');
      traceQueue.push({nodeId,from,to:id,transitionId:lastEmit&&lastEmit.nodeId===nodeId?lastEmit.transitionId:(timed?timed.id:null),params:paramsNow()});}
    return ok;};
}
// Steps keep the runtime state (not an image), so selecting one puts the running sketch back there.
let pinned=null,lastPlaying=true;
function flushTrace(){if(!traceQueue.length)return;let runtime=null;try{runtime=typeof rulegenSnapshot==='function'?rulegenSnapshot():null;}catch(error){runtime=null;}
  const steps=traceQueue;traceQueue=[];steps.forEach(step=>parent.postMessage({channel:'rulegen',token:${JSON.stringify(token)},trace:Object.assign(step,{runtime})},'*'));}
let pointerDown=false;
function fire(type,point){const canvas=document.querySelector('canvas');if(!canvas)return;if(type==='mousedown')pointerDown=true;if(type==='mouseup')pointerDown=false;
  const box=canvas.getBoundingClientRect();canvas.dispatchEvent(new MouseEvent(type,{bubbles:true,cancelable:true,view:window,button:0,buttons:pointerDown?1:0,clientX:box.left+point.x*box.width/(p.width||box.width),clientY:box.top+point.y*box.height/(p.height||box.height)}));}
function replay(points){if(!points.length)return;
  fire('mousemove',points[0]);fire('mousedown',points[0]);
  points.slice(1).forEach(point=>setTimeout(()=>fire('mousemove',point),Math.max(0,point.t)));
  const last=points[points.length-1];setTimeout(()=>{fire('mouseup',last);fire('click',last);},Math.max(0,last.t)+16);}
function capture(){const canvas=document.querySelector('canvas');if(canvas)parent.postMessage({channel:'rulegen',token:${JSON.stringify(token)},image:canvas.toDataURL('image/png'),states:hasMachine?Object.fromEntries(Object.keys(rulegenState).map(id=>[id,rulegenState[id].id])):null},'*');}
function rerender(){budget=0;if(typeof rulegenSetup==='function')rulegenSetup();else setup();forceRender=true;p.redraw();capture();}
window.addEventListener('message',event=>{
  if(event.source!==parent || event.data?.channel!=='rulegen-control' || event.data.token!==${JSON.stringify(token)})return;
  try{budget=0;
    if(event.data.type==='control'){
      if(hasMachine && typeof event.data.nodeId==='string' && typeof event.data.stateId==='string')rulegenJumpState(event.data.nodeId,event.data.stateId);
      const playing=event.data.playing===true;lastPlaying=playing;
      if(typeof rulegenPlaying!=='undefined')rulegenPlaying=playing&&!pinned;
      const trace=event.data.tracing===true;if(trace&&!tracing)traceQueue.push({nodeId:null,from:null,to:null,transitionId:null,params:paramsNow()});tracing=trace;
      if(playing&&!pinned){if(wasLooping)p.loop();}else p.noLoop();
    }else if(event.data.type==='replay' && Array.isArray(event.data.points)){replay(event.data.points.filter(point=>point&&Number.isFinite(point.x)&&Number.isFinite(point.y)&&Number.isFinite(point.t)));return;
    }else if(event.data.type==='pointer' && ['mousemove','mousedown','mouseup'].includes(event.data.kind) && Number.isFinite(event.data.x) && Number.isFinite(event.data.y)){fire(event.data.kind,{x:event.data.x,y:event.data.y});if(event.data.kind==='mouseup')fire('click',{x:event.data.x,y:event.data.y});return;
    }else if(event.data.type==='restore'){
      if(event.data.snapshot&&typeof rulegenRestore==='function'){pinned=event.data.snapshot;rulegenRestore(pinned);if(typeof rulegenPlaying!=='undefined')rulegenPlaying=false;p.noLoop();}
      else if(pinned){pinned=null;if(typeof rulegenPlaying!=='undefined')rulegenPlaying=lastPlaying;if(lastPlaying&&wasLooping)p.loop();}
    }else if(event.data.type==='event' && hasMachine && typeof event.data.nodeId==='string' && typeof event.data.transitionId==='string')rulegenEmit(event.data.nodeId,event.data.transitionId);
    else if(event.data.type==='scene' && typeof rulegenBase!=='undefined'){
      Object.assign(rulegenBase,event.data.params||{});
      const machines=event.data.machines||{};for(const id of Object.keys(machines)){if(rulegenMachines[id])Object.assign(rulegenMachines[id],machines[id]);else{rulegenMachines[id]=machines[id];rulegenState[id]={id:machines[id].initialState,elapsed:0};}}
      for(const id of Object.keys(rulegenMachines))if(!machines[id]){delete rulegenMachines[id];delete rulegenState[id];}
      if(Array.isArray(event.data.instances)&&typeof rulegenInstances!=='undefined'){rulegenInstances.splice(0,rulegenInstances.length,...event.data.instances);rulegenSync();}
      rulegenApply();if(pinned){rulegenRestore(pinned);forceRender=true;p.redraw();return;}rerender();return;
    }
    forceRender=true;p.redraw();
  }catch(error){${send}}
});
p.setup=()=>{budget=0;setup();wasLooping=typeof p.isLooping==='function'?p.isLooping():true;capture();parent.postMessage({channel:'rulegen',token:${JSON.stringify(token)},ready:true},'*');};
p.draw=()=>{budget=0;try{
  if(hasMachine && !rulegenPlaying && !forceRender)return;
  if(draw)draw();
  flushTrace();
  if(forceRender || performance.now()-lastCapture>150){capture();lastCapture=performance.now();}
  forceRender=false;
}catch(error){p.noLoop();${send}}};
});}catch(error){${send}}</script></body></html>`), 100);
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.data?.channel !== "rulegen" || event.data.token !== token) return;
      if (event.data.ready) { ready.current = true; sentJump.current = null; sendControls(); sendValues(); sendRestore(); }
      if (typeof event.data.error === "string") current.current.onError(event.data.error.slice(0, 500));
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
      if (typeof event.data.image === "string" && /^data:image\/png;base64,/.test(event.data.image) && event.data.image.length < 8_000_000) setImage(event.data.image);
    };
    window.addEventListener("message", receive); return () => { clearTimeout(timer); window.removeEventListener("message", receive); };
  }, [structure, machineEnabled]);
  // The last rendered image stays visible while a new program loads, so re-runs do not flash.
  return <div className="isolated-code-render">{image ? <img src={image} alt="Generated p5.js visual output" /> : <span className="engine-loading">Rendering p5.js…</span>}<iframe ref={frame} className={`p5-code-preview isolated-engine-frame ${machineEnabled ? "live-state-engine" : ""} ${props.interactive ? "interactive-engine" : ""}`} title="Generated p5.js render engine" sandbox="allow-scripts" srcDoc={document} /></div>;
});
