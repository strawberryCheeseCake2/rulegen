import { GUARD_RUNTIME } from "./render-guard";
import type { WidgetParam } from "./alignment";

/** A drawn object as a tag widget sees it (canvas pixels). */
export type WidgetBox = { x: number; y: number; w: number; h: number; cx: number; cy: number; rotate?: number; id?: string; label?: string };
/**
 * What a tag widget reads, sent in whenever it changes: its values, the object where it is, the other objects, what
 * the object's rules read, the runtime state's fields (`@id.field`) and how many canvas pixels a screen pixel is (`px`).
 */
export type WidgetWorld = { values: Record<string, number | string | boolean>; item: WidgetBox; others: WidgetBox[]; rules: Record<string, number | null>; refs: Record<string, number | null>; px: number };

/**
 * A tag widget's runtime (inside a sandboxed iframe, with p5 loaded): its code registers with
 * `rulegenHandle(function (h) { … })` and draws over the whole frame on a transparent canvas. Pointer and wheel input
 * are forwarded by the parent (canvas pixels). `h.set` keeps a value to its param and reports it (`set` messages); the
 * parent sends what the widget reads back (`world`). An error is reported and blanks it.
 */
export function tagWidgetRuntime(token: string, code: string, params: WidgetParam[], world: WidgetWorld) {
  const data = (value: unknown) => JSON.stringify(value).replace(/<\/script/gi, "<\\/script");
  return `const TOKEN=${data(token)},PARAMS=${data(params)};let WORLD=${data(world)};
${GUARD_RUNTIME}
const __send=message=>parent.postMessage(Object.assign({channel:'rulegen-widget',token:TOKEN},message),'*');
new p5(p=>{
  let widget=null,error=null,pending={},lastFlush=0,mx=-1,my=-1,pmx=-1,pmy=-1,down=false,over=false;
  const spec=id=>PARAMS.find(item=>item.id===id);
  const fail=e=>{const message=String(e&&e.message||e).slice(0,300);if(error===message)return;error=message;__send({type:'error',error:message});};
  function coerce(s,value){
    if(!s)return undefined;
    if(s.type==='number'){const v=Number(value);if(!Number.isFinite(v)||typeof value==='boolean')return undefined;const r=s.step>0?s.min+Math.round((v-s.min)/s.step)*s.step:v;return Number(Math.max(s.min,Math.min(s.max,r)).toFixed(6));}
    if(s.type==='color')return typeof value==='string'&&/^#[0-9a-fA-F]{6}$/.test(value)?value:undefined;
    if(s.type==='select'){if(typeof value==='number')return s.options[Math.max(0,Math.min(s.options.length-1,Math.round(value)))];return s.options.includes(value)?value:undefined;}
    if(s.type==='toggle')return Boolean(value);
  }
  const h={
    w:900,h:600,color:'#d97706',
    get item(){return WORLD.item;},get px(){return WORLD.px>0?WORLD.px:1;},get others(){return WORLD.others;},
    v:id=>WORLD.values[id],
    spec:id=>{const s=spec(id);return s&&{type:s.type,min:s.min,max:s.max,step:s.step,options:s.options.slice()};},
    ratio:id=>{const s=spec(id),v=WORLD.values[id];if(!s)return 0;if(s.type==='number')return s.max>s.min?(v-s.min)/(s.max-s.min):0;if(s.type==='select')return s.options.length>1?Math.max(0,s.options.indexOf(v))/(s.options.length-1):0;if(s.type==='toggle')return v?1:0;return 0;},
    set:(id,value)=>{const v=coerce(spec(id),value);if(v===undefined)return WORLD.values[id];if(v!==WORLD.values[id]){WORLD.values[id]=v;pending[id]=v;}return v;},
    setRatio:(id,t)=>{const s=spec(id);if(!s)return;const c=Math.max(0,Math.min(1,Number(t)||0));if(s.type==='number')return h.set(id,s.min+c*(s.max-s.min));if(s.type==='select')return h.set(id,s.options[Math.round(c*(s.options.length-1))]);if(s.type==='toggle')return h.set(id,c>=.5);},
    read:ref=>{const v=WORLD.refs[ref];return typeof v==='number'?v:null;},
    rule:aspect=>{const v=WORLD.rules[aspect];return typeof v==='number'?v:null;},
    get mouseX(){return mx;},get mouseY(){return my;},get pmouseX(){return pmx;},get pmouseY(){return pmy;},
    get pressed(){return down;},get hover(){return over;},get time(){return p.millis();},
  };
  function flush(force){const now=performance.now();if(!force&&now-lastFlush<30)return;lastFlush=now;const keys=Object.keys(pending);if(!keys.length)return;__send({type:'set',values:pending});pending={};}
  function call(name,arg){if(error||!widget||typeof widget[name]!=='function')return;budgetReset();try{return widget[name](arg);}catch(e){fail(e);}}
  {let factory=null;const rulegenHandle=f=>{factory=f;};
    try{budgetReset();eval(${data(code)});if(typeof factory!=='function')throw new Error('Register the widget with rulegenHandle(function (h) { … }).');widget=factory(h)||{};}catch(e){fail(e);}}
  p.setup=()=>{p.createCanvas(900,600);p.frameRate(30);p.textFont('sans-serif');__send({type:'ready'});};
  p.draw=()=>{budgetReset();p.clear();if(error)return;
    p.push();p.angleMode(p.RADIANS);p.rectMode(p.CORNER);p.ellipseMode(p.CENTER);p.colorMode(p.RGB,255);p.textAlign(p.LEFT,p.BASELINE);p.textSize(12*h.px);p.strokeWeight(h.px);p.stroke(0);p.noFill();
    call('draw');p.pop();flush(false);};
  function pointer(kind,x,y){
    pmx=mx;pmy=my;mx=x;my=y;p.pmouseX=pmx;p.pmouseY=pmy;p.mouseX=mx;p.mouseY=my;p.mouseIsPressed=kind==='down'||(down&&kind==='move');
    if(kind==='down'){down=true;over=true;call('pressed');flush(true);}
    else if(kind==='move'){over=true;if(down)call('dragged');else call('moved');}
    else if(kind==='up'){if(down){down=false;call('released');flush(true);}}
    else if(kind==='leave'){if(!down)over=false;}
  }
  window.addEventListener('message',event=>{
    if(event.source!==parent||!event.data||event.data.channel!=='rulegen-widget-control'||event.data.token!==TOKEN)return;
    const d=event.data;
    if(d.type==='pointer'&&['down','move','up','leave'].includes(d.kind)&&Number.isFinite(d.x)&&Number.isFinite(d.y)){pointer(d.kind,d.x,d.y);return;}
    if(d.type==='wheel'&&Number.isFinite(d.delta)){call('wheel',d.delta);flush(true);return;}
    // What it reads, from outside; the values being dragged stay as the widget set them.
    if(d.type==='world'&&d.world){const kept=down?Object.assign({},d.world.values,WORLD.values,pending):d.world.values;WORLD=Object.assign({},d.world,{values:kept});}
  });
});`;
}

/** The iframe document of a tag widget: transparent, over the frame's picture. */
export function tagWidgetDocument(token: string, origin: string, code: string, params: WidgetParam[], world: WidgetWorld) {
  const send = `parent.postMessage({channel:'rulegen-widget',token:${JSON.stringify(token)},type:'error',error:String(error)},'*')`;
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' ${origin}; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none';"><style>html,body{margin:0;overflow:hidden;background:transparent}canvas{display:block;width:100%!important;height:100%!important}</style><script src="${origin}/vendor/p5.min.js"></script></head><body><script>
window.onerror=(error)=>{${send}};
try{${tagWidgetRuntime(token, code, params, world)}}catch(error){${send}}</script></body></html>`;
}
