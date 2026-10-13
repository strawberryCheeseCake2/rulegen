import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { readSceneValues, sceneStructureKey } from "../lib/scene/machines";

export type CodePreviewHandle = { capture: () => string; emit: (nodeId: string, transitionId: string) => void };
export type StateJump = { nodeId: string; stateId: string; revision: number } | null;
type Props = { executable: string; onError: (error: string) => void; machineEnabled?: boolean; /** Interaction mode: the running sketch is shown and receives pointer/keyboard input. */ interactive?: boolean; jump?: StateJump; playing?: boolean; onStatesChange?: (states: Record<string, string>) => void };

/**
 * Runs a prepared sketch in an isolated iframe. The sketch is reloaded only when
 * its program changes; slider edits and layer moves only change the host block's
 * values, which are pushed into the running sketch and re-rendered in place.
 */
export const CodePreview = forwardRef<CodePreviewHandle, Props>(function CodePreview(props, ref) {
  const { executable, machineEnabled = false } = props;
  const current = useRef(props); current.current = props;
  const frame = useRef<HTMLIFrameElement>(null);
  const tokenRef = useRef(""), ready = useRef(false), sentJump = useRef<number | null>(null), lastStates = useRef(""), sentValues = useRef("");
  const [document, setDocument] = useState("");
  const [image, setImage] = useState("");
  const structure = sceneStructureKey(executable);
  const post = (message: object) => frame.current?.contentWindow?.postMessage({ channel: "rulegen-control", token: tokenRef.current, ...message }, "*");
  const sendControls = () => {
    if (!tokenRef.current || !ready.current) return;
    const state = current.current;
    const jump = state.jump && sentJump.current !== state.jump.revision ? state.jump : null;
    post({ type: "control", nodeId: jump?.nodeId ?? null, stateId: jump?.stateId ?? null, playing: state.playing ?? true });
    sentJump.current = state.jump?.revision ?? null;
  };
  const sendValues = () => {
    if (!ready.current) return;
    const values = readSceneValues(current.current.executable), key = JSON.stringify(values);
    if (!values || key === sentValues.current) return;
    sentValues.current = key; post({ type: "scene", params: values.params, machines: values.machines });
  };
  useImperativeHandle(ref, () => ({ capture: () => image, emit: (nodeId, transitionId) => post({ type: "event", nodeId, transitionId }) }));
  useEffect(sendControls, [props.jump?.revision, props.playing]);
  useEffect(sendValues, [executable]);
  useEffect(() => {
    const token = crypto.randomUUID();
    tokenRef.current = token; ready.current = false; sentJump.current = null; lastStates.current = "";
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
function capture(){const canvas=document.querySelector('canvas');if(canvas)parent.postMessage({channel:'rulegen',token:${JSON.stringify(token)},image:canvas.toDataURL('image/png'),states:hasMachine?Object.fromEntries(Object.keys(rulegenState).map(id=>[id,rulegenState[id].id])):null},'*');}
function rerender(){budget=0;if(typeof rulegenSetup==='function')rulegenSetup();else setup();forceRender=true;p.redraw();capture();}
window.addEventListener('message',event=>{
  if(event.source!==parent || event.data?.channel!=='rulegen-control' || event.data.token!==${JSON.stringify(token)})return;
  try{budget=0;
    if(event.data.type==='control'){
      if(hasMachine && typeof event.data.nodeId==='string' && typeof event.data.stateId==='string')rulegenJumpState(event.data.nodeId,event.data.stateId);
      const playing=event.data.playing===true;
      if(typeof rulegenPlaying!=='undefined')rulegenPlaying=playing;
      if(playing){if(wasLooping)p.loop();}else p.noLoop();
    }else if(event.data.type==='event' && hasMachine && typeof event.data.nodeId==='string' && typeof event.data.transitionId==='string')rulegenEmit(event.data.nodeId,event.data.transitionId);
    else if(event.data.type==='scene' && typeof rulegenBase!=='undefined'){
      Object.assign(rulegenBase,event.data.params||{});
      const machines=event.data.machines||{};for(const id of Object.keys(machines))if(rulegenMachines[id])Object.assign(rulegenMachines[id],machines[id]);
      rulegenApply();rerender();return;
    }
    forceRender=true;p.redraw();
  }catch(error){${send}}
});
p.setup=()=>{budget=0;setup();wasLooping=typeof p.isLooping==='function'?p.isLooping():true;capture();parent.postMessage({channel:'rulegen',token:${JSON.stringify(token)},ready:true},'*');};
p.draw=()=>{budget=0;try{
  if(hasMachine && !rulegenPlaying && !forceRender)return;
  if(draw)draw();
  if(forceRender || performance.now()-lastCapture>150){capture();lastCapture=performance.now();}
  forceRender=false;
}catch(error){p.noLoop();${send}}};
});}catch(error){${send}}</script></body></html>`), 100);
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.data?.channel !== "rulegen" || event.data.token !== token) return;
      if (event.data.ready) { ready.current = true; sentJump.current = null; sendControls(); sendValues(); }
      if (typeof event.data.error === "string") current.current.onError(event.data.error.slice(0, 500));
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
