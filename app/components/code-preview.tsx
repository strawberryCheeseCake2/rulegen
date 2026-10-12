import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
export type CodePreviewHandle = { capture: () => string; emit: (transitionId: string) => void };
type Props = { code: string; executable: string; onError: (error: string) => void; machineEnabled?: boolean; stateId?: string | null; playing?: boolean; jumpRevision?: number; onStateChange?: (id: string) => void };
export const CodePreview = forwardRef<CodePreviewHandle, Props>(function CodePreview(props, ref) {
  const { code, executable, machineEnabled = false } = props;
  const current = useRef(props); current.current = props;
  const frame = useRef<HTMLIFrameElement>(null);
  const tokenRef = useRef(""), sentJump = useRef<number | null>(null), lastState = useRef("");
  const [document, setDocument] = useState("");
  const [image, setImage] = useState("");
  const sendControls = () => {
    if (!tokenRef.current) return;
    const state = current.current;
    const jump = sentJump.current !== (state.jumpRevision ?? 0);
    frame.current?.contentWindow?.postMessage({ channel: "rulegen-control", token: tokenRef.current, type: "control", stateId: jump ? state.stateId : null, playing: state.playing ?? true }, "*");
    sentJump.current = state.jumpRevision ?? 0;
  };
  useImperativeHandle(ref, () => ({ capture: () => image, emit: transitionId => frame.current?.contentWindow?.postMessage({ channel: "rulegen-control", token: tokenRef.current, type: "event", transitionId }, "*") }));
  useEffect(sendControls, [props.stateId, props.playing, props.jumpRevision]);
  useEffect(() => {
    setImage("");
    const token = crypto.randomUUID();
    tokenRef.current = token; sentJump.current = null; lastState.current = "";
    const script = executable.replace(/<\/script/gi, "<\\/script");
    const origin = window.location.origin;
    const send = `parent.postMessage({channel:'rulegen',token:${JSON.stringify(token)},error:String(error)},'*')`;
    const timer = setTimeout(() => setDocument(`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' ${origin}; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none';"><style>html,body{margin:0;overflow:hidden;background:#fffefa}canvas{display:block}</style><script src="${origin}/vendor/p5.min.js"></script></head><body><script>
window.onerror=(error)=>{${send}};window.onunhandledrejection=(e)=>{const error=e.reason;${send}};
let budget=0;function __rulegenGuard(){if(++budget>100000)throw new Error('Rendering budget exceeded. Reduce loops or recursion.')}
try{new p5(p=>{${script}
const setup=p.setup,draw=p.draw;let lastCapture=0,forceRender=true;
const hasMachine=${machineEnabled} && typeof rulegenState !== 'undefined';
function capture(){const canvas=document.querySelector('canvas');if(canvas)parent.postMessage({channel:'rulegen',token:${JSON.stringify(token)},image:canvas.toDataURL('image/png'),stateId:hasMachine?rulegenState.id:null},'*');}
window.addEventListener('message',event=>{
  if(event.source!==parent || event.data?.channel!=='rulegen-control' || event.data.token!==${JSON.stringify(token)} || !hasMachine)return;
  try{budget=0;
    if(event.data.type==='control'){
      if(typeof event.data.stateId==='string')rulegenJumpState(event.data.stateId);
      rulegenState.playing=event.data.playing===true;
    }else if(event.data.type==='event' && typeof event.data.transitionId==='string')rulegenEmit(event.data.transitionId);
    forceRender=true;p.redraw();
  }catch(error){${send}}
});
p.setup=()=>{budget=0;setup();capture();parent.postMessage({channel:'rulegen',token:${JSON.stringify(token)},ready:true},'*');};
p.draw=()=>{budget=0;try{
  if(hasMachine && !rulegenState.playing && !forceRender)return;
  if(draw)draw();
  if(forceRender || performance.now()-lastCapture>150){capture();lastCapture=performance.now();}
  forceRender=false;
}catch(error){p.noLoop();${send}}};
});}catch(error){${send}}</script></body></html>`), 100);
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.data?.channel !== "rulegen" || event.data.token !== token) return;
      if (event.data.ready) { sentJump.current = null; sendControls(); }
      if (typeof event.data.error === "string") current.current.onError(event.data.error.slice(0, 500));
      if (typeof event.data.stateId === "string" && event.data.stateId !== lastState.current) { lastState.current = event.data.stateId; current.current.onStateChange?.(event.data.stateId); }
      if (typeof event.data.image === "string" && /^data:image\/png;base64,/.test(event.data.image) && event.data.image.length < 8_000_000) setImage(event.data.image);
    };
    window.addEventListener("message", receive); return () => { clearTimeout(timer); window.removeEventListener("message", receive); };
  }, [code, executable, machineEnabled]);
  return <div className="isolated-code-render">{image ? <img src={image} alt="Generated p5.js visual output" /> : <span className="engine-loading">Rendering p5.js…</span>}<iframe ref={frame} className={`p5-code-preview isolated-engine-frame ${machineEnabled ? "live-state-engine" : ""}`} title="Generated p5.js render engine" sandbox="allow-scripts" srcDoc={document} /></div>;
});
