import type { ConstraintScene, SceneNode, WidgetKind, Parameter, Point } from "../lib/schema";
import { kindLabels, connectAlgorithm, descendants, removeNode, reparentNode, updateAlgorithmParameter, addSceneNode } from "../lib/constraint-scene";
import { NumberWidget } from "./parameter-widget";
import { Icon } from "./icons";

type Props = { owner: string; scene: ConstraintScene; selected: string | null; busy: boolean; status: string; onChange: (scene: ConstraintScene) => void; onSelect: (id: string | null) => void; onGenerate: () => void; onError: (error: string) => void };
const kinds: WidgetKind[] = ["spatial", "stylistic", "object"];
export function ConstraintEditor({ owner, scene, selected, busy, status, onChange, onSelect, onGenerate, onError }: Props) {
  const node = scene.nodes.find(n => n.id === selected);
  const constraints = scene.nodes.filter(n => n.kind === "spatial" || n.kind === "stylistic");
  const apply = (work: () => ConstraintScene) => { try { onChange(work()); } catch (e) { onError((e as Error).message); } };
  const patch = (values: Partial<SceneNode>) => node && onChange({ ...scene, nodes: scene.nodes.map(n => n.id === node.id ? { ...n, ...values } : n) });
  const attach = (id: string) => node && apply(() => connectAlgorithm(scene, node.id, id, true));
  function add(kind: WidgetKind, primitive: SceneNode["primitive"] = "ellipse") {
    const id = `widget-${crypto.randomUUID()}`;
    const point: Point = kind === "object" && node?.kind === "spatial" ? { x: node.box.x + node.box.w / 2, y: node.box.y + node.box.h / 2 } : { x: .5, y: .5 };
    apply(() => addSceneNode(scene, kind, point, id, primitive)); onSelect(id);
  }
  function startDrag(e: React.DragEvent, payload: object, kind: WidgetKind) {
    if (busy) { e.preventDefault(); return; }
    e.dataTransfer.setData("application/x-rulegen-widget", JSON.stringify({ ...payload, sourceOwner: owner }));
    e.dataTransfer.setData(`application/x-rulegen-kind-${kind}`, "1");
    e.dataTransfer.effectAllowed = "copyMove";
  }
  return <section className="constraint-editor" aria-label="Constraint composition">
    <div className="section-kicker">CONSTRAINTS → RESULT CODE</div><h2>Shape the system.</h2>
    <p className="section-description">이미지에서 spatial / stylistic constraint와 object를 합쳐 최대 7개 추출합니다. 원본 특징으로 reconstruction하고 다른 프레임에서도 재사용하세요. constraint에 알고리즘을 넣고 프레임에서 이동하세요. 패널의 object / constraint를 스케치로 드래그하세요. Object를 constraint 영역에 놓으면 그 알고리즘이 적용됩니다.</p>
    {selected && <button className="copy-button" onClick={() => onSelect(null)}>Clear widget selection<Icon name="close" size={13} /></button>}
    <div className="constraint-result-status" role="status">{status}</div>
    <button className="primary-button" disabled={busy || !scene.nodes.length} onClick={onGenerate}> {scene.nodes.length ? "Reconstruct sketch" : "Add a constraint or object"}<Icon name="code" size={16} /></button>
    <fieldset disabled={busy} className="constraint-fieldset">
      <div className="widget-palette" aria-label="Drag widgets onto sketch"><span>DRAG TO SKETCH</span><div>{(["ellipse", "rectangle", "line", "triangle"] as const).map(primitive => <button key={primitive} draggable={!busy} aria-label={`Drag ${primitive} object onto sketch`} title="Drag onto a sketch frame" onDragStart={e => startDrag(e, { type: "new", kind: "object", primitive }, "object")} onClick={() => add("object", primitive)}><span>◇</span>{primitive}</button>)}</div><div>{kinds.filter(kind => kind !== "object").map(kind => <button key={kind} draggable={!busy} aria-label={`Drag ${kindLabels[kind]} onto sketch`} title="Drag onto a sketch frame" onDragStart={e => startDrag(e, { type: "new", kind }, kind)} onClick={() => add(kind)}><span className={`kind-dot kind-${kind}`} />{kind}</button>)}</div></div>
      <div className="constraint-kind-list">{kinds.map(kind => <section key={kind} aria-label={kindLabels[kind]}><div className="constraint-kind-heading"><span className={`kind-dot kind-${kind}`} /><strong>{kindLabels[kind]}</strong><button disabled={scene.nodes.length >= 64} aria-label={`Add ${kindLabels[kind]}`} onClick={() => add(kind)}><Icon name="plus" size={13} /></button></div>
        {scene.nodes.filter(n => n.kind === kind).map(n => <button key={n.id} className={`constraint-node-item ${n.id === selected ? "active" : ""}`} aria-pressed={n.id === selected} draggable={!busy} title="Drag onto a sketch to place; another frame copies the widget" onDragStart={e => startDrag(e, { type: "node", nodeId: n.id }, n.kind)} onClick={() => onSelect(n.id)}><span>{n.label}</span><small>{n.kind === "object" ? n.primitive : `${n.algorithmIds.length} algorithms`}</small></button>)}
      </section>)}</div>
      {node && <article className={`constraint-details kind-${node.kind}`} onDragOver={e => { if (node.kind !== "object") e.preventDefault(); }} onDrop={e => { const id = e.dataTransfer.getData("application/x-rulegen-algorithm"); if (!id || node.kind === "object") return; e.preventDefault(); e.stopPropagation(); attach(id); }}>
        <div className="constraint-details-title"><span>{kindLabels[node.kind]}</span><button aria-label={`Delete ${node.label}`} onClick={() => { onChange(removeNode(scene, node.id)); onSelect(null); }}><Icon name="close" size={14} /></button></div>
        <label className="constraint-form-label">Name<input aria-label="Widget name" maxLength={100} value={node.label} onChange={e => { if (e.target.value.trim()) patch({ label: e.target.value }); }} /></label>
        {node.kind === "object" && <label className="constraint-form-label">Primitive<select aria-label="Object primitive" value={node.primitive!} onChange={e => patch({ primitive: e.target.value as SceneNode["primitive"] })}>{["ellipse", "rectangle", "line", "triangle", "path"].map(p => <option key={p}>{p}</option>)}</select></label>}
        {["spatial", "object"].includes(node.kind) && <label className="constraint-form-label">Inside spatial group<select aria-label="Parent spatial constraint" value={node.parentId || ""} onChange={e => apply(() => reparentNode(scene, node.id, e.target.value || null))}><option value="">No group</option>{scene.nodes.filter(n => n.kind === "spatial" && n.id !== node.id && !descendants(scene, node.id).includes(n.id)).map(n => <option key={n.id} value={n.id}>{n.label}</option>)}</select></label>}
        {node.kind === "spatial" && <div className="constraint-members"><strong>Contains objects / groups</strong>{scene.nodes.filter(n => ["object", "spatial"].includes(n.kind) && n.id !== node.id && !descendants(scene, n.id).includes(node.id)).map(n => <label key={n.id}><input type="checkbox" checked={n.parentId === node.id} onChange={e => apply(() => reparentNode(scene, n.id, e.target.checked ? node.id : null))} />{n.label}</label>)}</div>}
        {["temporal", "stylistic"].includes(node.kind) && <div className="constraint-members"><strong>Applies to</strong>{scene.nodes.filter(n => ["object", "spatial"].includes(n.kind)).map(n => <label key={n.id}><input type="checkbox" checked={node.targetIds.includes(n.id)} onChange={e => patch({ targetIds: e.target.checked ? [...node.targetIds, n.id] : node.targetIds.filter(id => id !== n.id) })} />{n.label}</label>)}{!node.targetIds.length && <small>적용할 object 또는 spatial group을 선택하세요.</small>}</div>}
        {node.kind === "object" ? <>
          <p className="constraint-hint">Object의 형태 정의를 유지한 채 포함된 spatial group과 연결된 stylistic constraint가 이를 조절합니다.</p>
          <label className="constraint-form-label">Primitive definition<select aria-label="Object definition algorithm" value={node.definitionId || ""} onChange={e => patch({ definitionId: e.target.value || null })}><option value="">Base primitive</option>{scene.algorithms.map(a => <option key={a.id} value={a.id}>{a.implementation.label}</option>)}</select></label>
          {node.definitionId && (() => { const definition = scene.algorithms.find(a => a.id === node.definitionId)!; return <div className="attached-algorithm"><div className="attached-algorithm-heading"><strong>{definition.implementation.label}</strong><button aria-label={`Detach ${definition.implementation.label} from object`} onClick={() => patch({ definitionId: null })}><Icon name="minus" size={13} /></button></div><ParameterFields parameters={definition.implementation.parameters} name={definition.implementation.label} onChange={(id, value) => onChange(updateAlgorithmParameter(scene, definition.id, id, value))} /><details className="implementation-details"><summary>Algorithm</summary><p>{definition.implementation.description}</p></details></div>; })()}
        </> : <>
          <div className="constraint-attached-heading">Attached algorithms <small>drop from library</small></div>
          {!node.algorithmIds.length && <p className="constraint-hint">라이브러리에서 알고리즘을 넣으세요. 분리해도 알고리즘은 남아 다른 constraint에 다시 넣을 수 있습니다.</p>}
          {node.algorithmIds.map(id => {
            const a = scene.algorithms.find(a => a.id === id)!;
            return <div className="attached-algorithm" key={id}><div className="attached-algorithm-heading"><strong>{a.implementation.label}</strong><button aria-label={`Detach ${a.implementation.label}`} onClick={() => apply(() => connectAlgorithm(scene, node.id, id, false))}><Icon name="minus" size={13} /></button></div>
              <label className="constraint-form-label">Move to constraint<select aria-label={`Move ${a.implementation.label} to constraint`} value="" onChange={e => { const target = e.target.value; if (target) apply(() => connectAlgorithm(connectAlgorithm(scene, node.id, id, false), target, id, true)); }}><option value="">Choose constraint…</option>{constraints.filter(n => n.id !== node.id).map(n => <option key={n.id} value={n.id}>{n.label}</option>)}</select></label>
              <ParameterFields parameters={a.implementation.parameters} name={a.implementation.label} onChange={(parameterId, value) => onChange(updateAlgorithmParameter(scene, id, parameterId, value))} />
              <details className="implementation-details"><summary>Algorithm</summary><p>{a.implementation.description}</p></details>
            </div>;
          })}
        </>}
      </article>}
      <div className="algorithm-library"><div className="constraint-attached-heading">Algorithm library <small>{scene.algorithms.length} independent assets</small></div><p className="constraint-hint">하나의 알고리즘을 여러 constraint에 넣을 수 있습니다. 파라미터 변경은 연결된 곳에 함께 반영됩니다.</p>
        {scene.algorithms.map(a => <details key={a.id} className="library-algorithm" draggable onDragStart={e => { e.dataTransfer.setData("application/x-rulegen-algorithm", a.id); e.dataTransfer.effectAllowed = "copy"; }}><summary><span>{a.implementation.label}</span><small>{scene.nodes.filter(n => n.algorithmIds.includes(a.id) || n.definitionId === a.id).length} links</small></summary><p>{a.implementation.description}</p>
          <ParameterFields parameters={a.implementation.parameters} name={`Library · ${a.implementation.label}`} onChange={(id, value) => onChange(updateAlgorithmParameter(scene, a.id, id, value))} />
          <button disabled={!node || node.kind === "object" || node.algorithmIds.includes(a.id) || node.algorithmIds.length >= 8} className="alternative-button" aria-label={`Attach ${a.implementation.label} to selected constraint`} onClick={() => attach(a.id)}>Insert into {node && node.kind !== "object" ? node.label : "selected constraint"}<Icon name="plus" size={13} /></button>
        </details>)}
        {!scene.algorithms.length && <p className="constraint-hint">이미지를 분석하고 Generate widgets를 눌러 알고리즘을 추출하세요.</p>}
      </div>
    </fieldset>
  </section>;
}
function ParameterFields({ parameters, name, onChange }: { parameters: Parameter[]; name: string; onChange: (id: string, value: Parameter["value"]) => void }) {
  return <div className="parameter-widgets">{parameters.map(p => <div key={p.id} className={`parameter-widget widget-${p.type}`}><span className="parameter-label">{p.label}</span>
    {p.type === "number" && <NumberWidget parameter={p} label={`${name} · ${p.label}`} onChange={v => onChange(p.id, v)} />}
    {p.type === "color" && <input type="color" aria-label={`${name} · ${p.label}`} value={p.value} onChange={e => onChange(p.id, e.target.value)} />}
    {p.type === "select" && <select aria-label={`${name} · ${p.label}`} value={p.value} onChange={e => onChange(p.id, e.target.value)}>{p.options.map(o => <option key={o}>{o}</option>)}</select>}
    {p.type === "toggle" && <input type="checkbox" aria-label={`${name} · ${p.label}`} checked={p.value} onChange={e => onChange(p.id, e.target.checked)} />}
  </div>)}</div>;
}
