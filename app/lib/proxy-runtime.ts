import { GUARD_RUNTIME } from "./render-guard";
import { CELL_HEADER, type Box, type HandleSpec } from "./scene/handles";

/** One widget of a proxy frame as the runtime gets it. */
export type ProxyCell = { id: string; label: string; hint: string; effect: string; box: Box; specs: Record<string, HandleSpec>; code: string };

/**
 * The proxy frame's runtime (inside a sandboxed iframe, with p5 loaded). Each
 * cell's widget code registers with `rulegenHandle(function (h) { … })` and
 * draws in its own clipped area; the press that starts in a cell drives that
 * widget until release. Pointer input is forwarded by the parent. `h.set` coerces the value to the scalar's range and
 * reports it to the parent (`set` messages); the parent sends the values back
 * (`values`) whenever the target changes. A failing widget only blanks its own cell.
 */
export function proxyRuntime(token: string, cells: ProxyCell[]) {
  return `const TOKEN=${JSON.stringify(token)},CELLS=${JSON.stringify(cells).replace(/<\/script/gi, "<\\/script")},HEADER=${CELL_HEADER};
${GUARD_RUNTIME}
const __send=message=>parent.postMessage(Object.assign({channel:'rulegen-proxy',token:TOKEN},message),'*');
new p5(p=>{
  const colors={spatial:'#2f7d62',stylistic:'#9a5bb8',temporal:'#c27412'};
  const keyOf=path=>Array.isArray(path)?path.join('/'):String(path==null?'':path);
  const cells=CELLS.map(cell=>Object.assign({},cell,{values:Object.fromEntries(Object.entries(cell.specs).map(([k,s])=>[k,s.value])),widget:null,error:null,pending:{}}));
  // The pointer comes from the parent (pointer messages, canvas pixels): input never depends on the iframe being hit.
  let active=null,hover=null,lastFlush=0,mx=-1,my=-1,pmx=-1,pmy=-1,down=false;
  const area=cell=>({x:cell.box.x,y:cell.box.y+HEADER,w:cell.box.w,h:cell.box.h-HEADER});
  const inside=(cell,x,y)=>{const a=area(cell);return x>=a.x&&x<=a.x+a.w&&y>=a.y&&y<=a.y+a.h;};
  const fail=(cell,error)=>{const message=String(error&&error.message||error).slice(0,300);if(cell.error===message)return;cell.error=message;__send({type:'error',id:cell.id,error:message});};
  function coerce(spec,value){
    if(!spec)return undefined;
    if(spec.type==='number'){const v=Number(value);if(!Number.isFinite(v))return undefined;const r=spec.min+Math.round((v-spec.min)/spec.step)*spec.step;return Number(Math.max(spec.min,Math.min(spec.max,r)).toFixed(8));}
    if(spec.type==='color')return typeof value==='string'&&/^#[0-9a-fA-F]{6}$/.test(value)?value:undefined;
    if(spec.type==='select'){if(typeof value==='number')return spec.options[Math.max(0,Math.min(spec.options.length-1,Math.round(value)))];return spec.options.includes(value)?value:undefined;}
    if(spec.type==='toggle')return Boolean(value);
  }
  function api(cell){
    const a=()=>area(cell);
    const h={
      get w(){return a().w;},get h(){return a().h;},label:cell.label,hint:cell.hint,color:colors[cell.effect]||'#2f7d62',
      paths:Object.keys(cell.specs),
      v:(path)=>cell.values[keyOf(path)],
      spec:(path)=>cell.specs[keyOf(path)],
      ratio:(path)=>{const s=cell.specs[keyOf(path)],v=cell.values[keyOf(path)];if(!s)return 0;if(s.type==='number')return s.max>s.min?(v-s.min)/(s.max-s.min):0;if(s.type==='select')return s.options.length>1?Math.max(0,s.options.indexOf(v))/(s.options.length-1):0;if(s.type==='toggle')return v?1:0;return 0;},
      set:function(path,value){if(arguments.length===1){value=path;path='';}const k=keyOf(path),v=coerce(cell.specs[k],value);if(v===undefined)return cell.values[k];if(v!==cell.values[k]){cell.values[k]=v;cell.pending[k]=v;}return v;},
      setRatio:(path,t)=>{const s=cell.specs[keyOf(path)];if(!s)return;const c=Math.max(0,Math.min(1,Number(t)||0));if(s.type==='number')return h.set(path,s.min+c*(s.max-s.min));if(s.type==='select')return h.set(path,s.options[Math.round(c*(s.options.length-1))]);if(s.type==='toggle')return h.set(path,c>=.5);},
      get mouseX(){return mx-a().x;},get mouseY(){return my-a().y;},get pmouseX(){return pmx-a().x;},get pmouseY(){return pmy-a().y;},
      get pressed(){return active===cell;},get hover(){return hover===cell;},get time(){return p.millis();},
    };
    return h;
  }
  function flush(force){
    const now=performance.now();if(!force&&now-lastFlush<30)return;lastFlush=now;
    for(const cell of cells){const keys=Object.keys(cell.pending);if(!keys.length)continue;for(const k of keys)__send({type:'set',id:cell.id,path:k,value:cell.pending[k]});cell.pending={};}
  }
  function call(cell,name,arg){if(!cell||cell.error||!cell.widget||typeof cell.widget[name]!=='function')return;budgetReset();try{return cell.widget[name](cell.h,arg);}catch(error){fail(cell,error);}}
  for(const cell of cells){
    let factory=null;const rulegenHandle=f=>{factory=f;};
    try{budgetReset();eval(cell.code);if(typeof factory!=='function')throw new Error('rulegenHandle(function (h) { … })로 widget을 등록해주세요.');cell.h=api(cell);cell.widget=factory(cell.h)||{};}catch(error){fail(cell,error);}
  }
  function wrap(text,width){const words=String(text).split(' '),lines=[''];for(const word of words){const line=lines[lines.length-1];if(line&&p.textWidth(line+' '+word)>width)lines.push(word);else lines[lines.length-1]=line?line+' '+word:word;}return lines;}
  function drawCell(cell){
    const b=cell.box,a=area(cell),color=colors[cell.effect]||'#2f7d62',on=active===cell||hover===cell;
    p.push();p.rectMode(p.CORNER);p.strokeWeight(on?2:1);p.stroke(on?color:'#d7e2d9');p.fill('#ffffff');p.rect(b.x,b.y,b.w,b.h,10);
    p.noStroke();p.fill(color);p.textAlign(p.LEFT,p.BASELINE);p.textStyle(p.BOLD);p.textSize(13);p.text(cell.label,b.x+12,b.y+18);
    p.textStyle(p.NORMAL);p.textSize(11);p.fill('#5d6d64');if(cell.hint)p.text(cell.hint,b.x+12,b.y+31);
    p.pop();
    if(cell.error){p.push();p.noStroke();p.fill('#a0563a');p.textSize(11);p.textAlign(p.LEFT,p.TOP);wrap('⚠ '+cell.error,a.w-24).slice(0,6).forEach((line,i)=>p.text(line,a.x+12,a.y+10+i*15));p.pop();return;}
    p.push();p.translate(a.x,a.y);const g=p.drawingContext;g.save();g.beginPath();g.rect(0,0,a.w,a.h);g.clip();
    p.angleMode(p.RADIANS);p.rectMode(p.CORNER);p.ellipseMode(p.CENTER);p.colorMode(p.RGB,255);p.textAlign(p.LEFT,p.BASELINE);p.textSize(12);p.strokeWeight(1);p.stroke(0);p.fill(255);
    call(cell,'draw');
    g.restore();p.pop();
  }
  p.setup=()=>{p.createCanvas(900,600);p.frameRate(30);p.textFont('sans-serif');__send({type:'ready'});};
  p.draw=()=>{budgetReset();try{p.background('#f4f7f1');cells.forEach(drawCell);flush(false);}catch(error){__send({type:'error',id:null,error:String(error&&error.message||error)});}};
  const at=()=>cells.find(cell=>inside(cell,mx,my))||null;
  function pointer(kind,x,y){
    pmx=mx;pmy=my;mx=x;my=y;
    // Widgets that read p.mouseX/Y directly see the same pointer.
    p.pmouseX=pmx;p.pmouseY=pmy;p.mouseX=mx;p.mouseY=my;p.mouseIsPressed=kind==='down'||(down&&kind==='move');
    if(kind==='down'){down=true;const cell=at();hover=cell;if(!cell||cell.error)return;active=cell;call(cell,'pressed');flush(true);}
    else if(kind==='move'){if(down){if(active)call(active,'dragged');}else hover=at();}
    else if(kind==='up'){down=false;if(active){const cell=active;call(cell,'released');flush(true);active=null;}hover=at();}
    else if(kind==='leave'){if(!down)hover=null;}
  }
  window.addEventListener('message',event=>{
    if(event.source!==parent||!event.data||event.data.channel!=='rulegen-proxy-control'||event.data.token!==TOKEN)return;
    if(event.data.type==='pointer'&&['down','move','up','leave'].includes(event.data.kind)&&Number.isFinite(event.data.x)&&Number.isFinite(event.data.y)){pointer(event.data.kind,event.data.x,event.data.y);return;}
    if(event.data.type==='values'){const all=event.data.cells||{};for(const cell of cells){const next=all[cell.id];if(!next||cell===active)continue;cell.specs=next;for(const k of Object.keys(next))cell.values[k]=next[k].value;}}
  });
});`;
}

/** The iframe document of a proxy frame. */
export function proxyDocument(token: string, origin: string, cells: ProxyCell[]) {
  const send = `parent.postMessage({channel:'rulegen-proxy',token:${JSON.stringify(token)},type:'error',id:null,error:String(error)},'*')`;
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' ${origin}; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none';"><style>html,body{margin:0;overflow:hidden;background:#f4f7f1}canvas{display:block}</style><script src="${origin}/vendor/p5.min.js"></script></head><body><script>
window.onerror=(error)=>{${send}};
try{${proxyRuntime(token, cells)}}catch(error){${send}}</script></body></html>`;
}
