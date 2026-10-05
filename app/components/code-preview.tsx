import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
export type CodePreviewHandle = { capture: () => string };
export const CodePreview = forwardRef<CodePreviewHandle, { code: string; executable: string; onError: (error: string) => void }>(function CodePreview({ code, executable, onError }, ref) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [document, setDocument] = useState("");
  const [image, setImage] = useState("");
  useImperativeHandle(ref, () => ({ capture: () => image }));
  useEffect(() => {
    setImage("");
    const token = crypto.randomUUID();
    const script = executable.replace(/<\/script/gi, "<\\/script");
    const origin = window.location.origin;
    const send = `parent.postMessage({channel:'rulegen',token:${JSON.stringify(token)},error:String(error)},'*')`;
    const timer = setTimeout(() => setDocument(`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' ${origin}; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none';"><style>html,body{margin:0;overflow:hidden;background:#fffefa}canvas{display:block}</style><script src="${origin}/vendor/p5.min.js"></script></head><body><script>window.onerror=(error)=>{${send}};window.onunhandledrejection=(e)=>{const error=e.reason;${send}};let budget=0;function __rulegenGuard(){if(++budget>100000)throw new Error('Rendering budget exceeded. Reduce loops or recursion.')}try{new p5(p=>{${script}\nconst setup=p.setup,draw=p.draw;let lastCapture=0;function capture(){const canvas=document.querySelector('canvas');if(canvas)parent.postMessage({channel:'rulegen',token:${JSON.stringify(token)},image:canvas.toDataURL('image/png')},'*');}p.setup=()=>{budget=0;setup();capture();};p.draw=()=>{budget=0;try{if(draw)draw();if(performance.now()-lastCapture>150){capture();lastCapture=performance.now();}}catch(error){p.noLoop();${send}}};});}catch(error){${send}}</script></body></html>`), 100);
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.data?.channel !== "rulegen" || event.data.token !== token) return;
      if (typeof event.data.error === "string") onError(event.data.error.slice(0, 500));
      if (typeof event.data.image === "string" && /^data:image\/png;base64,/.test(event.data.image) && event.data.image.length < 8_000_000) setImage(event.data.image);
    };
    window.addEventListener("message", receive); return () => { clearTimeout(timer); window.removeEventListener("message", receive); };
  }, [code, executable]);
  return <div className="isolated-code-render">{image ? <img src={image} alt="Generated p5.js visual output" /> : <span className="engine-loading">Rendering p5.js…</span>}<iframe ref={frame} className="p5-code-preview isolated-engine-frame" title="Generated p5.js render engine" sandbox="allow-scripts" srcDoc={document} /></div>;
});
