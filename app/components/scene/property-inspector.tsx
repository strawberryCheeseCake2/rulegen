import type { Algorithm, Effect, NodeState, NodeTransition, Property, ScalarValue, SceneNode, SemanticTransformation } from "../../lib/scene/schema";
import { MAX_NODE_PROPERTIES, MAX_PROPERTIES, MAX_TRANSFORMATIONS } from "../../lib/scene/schema";
import type { SlotChoice } from "../../lib/scene/panel-ops";
import { useEffect, useState } from "react";
import { ALGORITHM_DRAG_TYPE, readAlgorithmDrag, type AlgorithmClip } from "../../lib/scene/transfer";
import { Icon } from "../icons";
import { ValueSocket } from "./value-editor";
import { useContextMenu } from "./context-menu";

export type PropertyInspectorProps = {
  /** The node's semantic transformation stack, in application order (state values applied). */
  node: SceneNode; transformations: SemanticTransformation[]; library: Algorithm[]; state: NodeState | undefined; busy: boolean; clip: AlgorithmClip | null;
  onNode: (patch: Partial<Pick<SceneNode, "name" | "description">>) => void;
  onTransformation: (transformationId: string, patch: Partial<Pick<SemanticTransformation, "label" | "description">>) => void;
  onAddTransformation: () => void;
  onRemoveTransformation: (transformationId: string) => void;
  onMoveTransformation: (transformationId: string, offset: number) => void;
  onChooseState: (stateId: string | null) => void;
  onState: (patch: Partial<Pick<NodeState, "label" | "description">>) => void;
  onTransition: (id: string, patch: Partial<Pick<NodeTransition, "label" | "trigger" | "afterMs">>) => void;
  onScalar: (propertyId: string, path: string[], value: ScalarValue["value"]) => void;
  onSwap: (propertyId: string, path: string[], choice: SlotChoice) => void;
  onProperty: (propertyId: string, patch: Partial<Pick<Property, "label" | "effect">>) => void;
  onRemoveProperty: (propertyId: string) => void;
  onAddProperty: (algorithmId: string, transformationId: string) => void;
  onAddBlock: (clip: AlgorithmClip, transformationId: string) => void;
  /** AI: one property, one transformation, or (empty target) a new stacked transformation. */
  onRegenerate: (target: { transformationId?: string; propertyId?: string }) => void;
  /** Open a new frame that renders only this transformation. */
  onMinimalExample?: (transformationId: string) => void;
  /** A constraint picked in inspection: its card is highlighted and scrolled into view. */
  highlightPropertyId?: string | null;
  onMakePen: (propertyId: string, path: string[]) => void;
  onCopy: (propertyId: string, path: string[]) => void;
  onPaste: (propertyId: string, path: string[], dropped?: AlgorithmClip) => void;
  clipFor: (propertyId: string, path: string[]) => AlgorithmClip | null;
  onGenerateMachine: () => void;
  onRemoveMachine: () => void;
};

const effects: Effect[] = ["spatial", "stylistic", "temporal"];

function StateBar({ node, state, onChooseState }: Pick<PropertyInspectorProps, "node" | "state" | "onChooseState">) {
  if (!node.machine) return null;
  return <div className="state-chip-bar" role="group" aria-label={`${node.name} states`}>
    <button className={!state ? "active" : ""} aria-pressed={!state} onClick={() => onChooseState(null)}>Base</button>
    {node.machine.states.map(item => <button key={item.id} className={state?.id === item.id ? "active" : ""} aria-pressed={state?.id === item.id} onClick={() => onChooseState(item.id)}>{item.label}{node.machine!.initialState === item.id && <small>initial</small>}</button>)}
  </div>;
}

function StateDetails({ node, state, onState, onTransition }: Pick<PropertyInspectorProps, "node" | "state" | "onState" | "onTransition">) {
  if (!state || !node.machine) return null;
  const outgoing = node.machine.transitions.filter(transition => transition.from === state.id);
  return <section className="inspector-state" aria-label="Selected state">
    <input aria-label="State name" maxLength={100} value={state.label} onChange={e => { if (e.target.value.trim()) onState({ label: e.target.value }); }} />
    <textarea aria-label="State description" maxLength={1000} rows={2} value={state.description} onChange={e => onState({ description: e.target.value })} />
    <span className="inspector-subtitle">Transitions</span>
    {outgoing.map(transition => <div className="state-transition" key={transition.id}>
      <input className="transition-semantic-input" aria-label={`Transition ${transition.id} semantic label`} maxLength={100} value={transition.label} onChange={e => { if (e.target.value.trim()) onTransition(transition.id, { label: e.target.value }); }} />
      <strong><Icon name="arrow" size={12} />{node.machine!.states.find(item => item.id === transition.to)?.label}</strong>
      <select aria-label={`Transition ${transition.label} trigger`} value={transition.trigger} onChange={e => onTransition(transition.id, { trigger: e.target.value as "after" | "event" })}><option value="after">After delay</option><option value="event">Event</option></select>
      {transition.trigger === "after" && <label><input type="number" min={100} max={60000} step={100} aria-label={`Transition ${transition.label} delay`} value={transition.afterMs} onChange={e => { const value = e.currentTarget.valueAsNumber; if (Number.isFinite(value)) onTransition(transition.id, { afterMs: Math.max(100, Math.min(60000, Math.round(value))) }); }} /><span>ms</span></label>}
    </div>)}
    {!outgoing.length && <p className="state-method-description">No outgoing transitions</p>}
  </section>;
}

/** An empty socket at the end of the list: drop (or pick) a block to add a property. */
function NewSocket({ library, busy, onAdd, onDrop }: { library: Algorithm[]; busy: boolean; onAdd: (id: string) => void; onDrop: (clip: AlgorithmClip) => void }) {
  const [over, setOver] = useState(false);
  return <div className={`value-socket new-socket accepts-blocks ${over ? "socket-over" : ""}`}
    onDragOver={event => { if (busy || !event.dataTransfer.types.includes(ALGORITHM_DRAG_TYPE)) return; event.preventDefault(); event.dataTransfer.dropEffect = "copy"; setOver(true); }}
    onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setOver(false); }}
    onDrop={event => { setOver(false); const clip = readAlgorithmDrag(event.dataTransfer); if (clip) { event.preventDefault(); onDrop(clip); } }}>
    <span className="socket-hint">+ Drop a ƒ block here to add a property to this transformation</span>
    {library.length > 0 && <select aria-label="Add property from algorithm" value="" disabled={busy} onChange={e => { if (e.target.value) onAdd(e.target.value); }}><option value="">or pick a block…</option>{library.map(algorithm => <option key={algorithm.id} value={algorithm.id}>ƒ {algorithm.name}</option>)}</select>}
  </div>;
}

function PropertyCard({ property, props, openMenu }: { property: Property; props: PropertyInspectorProps; openMenu: ReturnType<typeof useContextMenu>[1] }) {
  const { state, library } = props;
  return <article className={`property-card effect-${property.effect} ${props.highlightPropertyId === property.id ? "inspection-highlight" : ""}`} data-property-id={property.id}>
    <div className="property-card-title">
      <input aria-label={`${property.label} property name`} maxLength={80} value={property.label} disabled={Boolean(state)} onChange={e => { if (e.target.value.trim()) props.onProperty(property.id, { label: e.target.value }); }} />
      <select className="effect-select" aria-label={`${property.label} effect`} value={property.effect} disabled={Boolean(state)} onChange={e => props.onProperty(property.id, { effect: e.target.value as Effect })}>{effects.map(effect => <option key={effect} value={effect}>{effect}</option>)}</select>
      {!state && <button className="subfeature-regenerate" aria-label={`Regenerate ${property.label}`} title="Regenerate this property with AI" onClick={() => props.onRegenerate({ propertyId: property.id })}><Icon name="spark" size={12} /></button>}
      {!state && <button className="remove-control" aria-label={`Delete ${property.label} property`} title="Delete property" onClick={() => props.onRemoveProperty(property.id)}><Icon name="close" size={13} /></button>}
    </div>
    {property.description && <p className="property-description">{property.description}</p>}
    <ValueSocket value={property.value} label={property.label} path={[]} library={library} clip={props.clip} allowSwap={!state} root openMenu={openMenu} clipFor={path => props.clipFor(property.id, path)}
      onScalar={(path, value) => props.onScalar(property.id, path, value)} onSwap={(path, choice) => props.onSwap(property.id, path, choice)}
      onCopy={path => props.onCopy(property.id, path)} onPaste={(path, dropped) => props.onPaste(property.id, path, dropped)} onMakePen={path => props.onMakePen(property.id, path)} />
  </article>;
}

/** One semantic transformation of the stack: its meaning, its properties and a socket for more. */
function TransformationCard({ transformation, index, count, roomInNode, props, openMenu }: { transformation: SemanticTransformation; index: number; count: number; roomInNode: boolean; props: PropertyInspectorProps; openMenu: ReturnType<typeof useContextMenu>[1] }) {
  const { state, busy } = props, name = transformation.label || `Transformation ${index + 1}`;
  return <section className="transformation-card" aria-label={`Semantic transformation ${name}`}>
    <div className="transformation-heading">
      <span className="transformation-order" title="Transformations apply top to bottom">{index + 1}</span>
      <input aria-label={`${name} transformation name`} maxLength={100} placeholder="e.g. Radial growth" value={transformation.label} disabled={Boolean(state)} onChange={e => props.onTransformation(transformation.id, { label: e.target.value })} />
      {!state && <span className="transformation-tools">
        <button aria-label={`Move ${name} up`} title="Apply earlier" disabled={busy || index === 0} onClick={() => props.onMoveTransformation(transformation.id, -1)}>↑</button>
        <button aria-label={`Move ${name} down`} title="Apply later" disabled={busy || index === count - 1} onClick={() => props.onMoveTransformation(transformation.id, 1)}>↓</button>
        <button aria-label={`Regenerate ${name}`} title="Regenerate this transformation with AI" disabled={busy} onClick={() => props.onRegenerate({ transformationId: transformation.id })}><Icon name="spark" size={12} /></button>
        <button aria-label={`Delete ${name} transformation`} title="Delete transformation and its properties" disabled={busy} onClick={() => props.onRemoveTransformation(transformation.id)}><Icon name="close" size={13} /></button>
      </span>}
    </div>
    {!state && props.onMinimalExample && <button className="minimal-example-button" disabled={busy || !transformation.properties.length} title="Open a new sketch frame that renders only this transformation, to try it in isolation"
      onClick={() => props.onMinimalExample!(transformation.id)}><Icon name="play" size={11} />Create Minimal Example</button>}
    <textarea aria-label={`${name} transformation description`} maxLength={1000} rows={2} value={transformation.description} disabled={Boolean(state)} onChange={e => props.onTransformation(transformation.id, { description: e.target.value })} />
    <fieldset disabled={busy} className="property-list">
      {transformation.properties.map(property => <PropertyCard key={property.id} property={property} props={props} openMenu={openMenu} />)}
      {!transformation.properties.length && <p className="empty-panel">No properties yet. Drop a block below or regenerate this transformation.</p>}
    </fieldset>
    {!state && roomInNode && transformation.properties.length < MAX_PROPERTIES && <NewSocket library={props.library} busy={busy} onAdd={id => props.onAddProperty(id, transformation.id)} onDrop={clip => props.onAddBlock(clip, transformation.id)} />}
  </section>;
}

export function PropertyInspector(props: PropertyInspectorProps) {
  const { node, transformations, state, busy } = props;
  const [menu, openMenu] = useContextMenu();
  useEffect(() => { if (props.highlightPropertyId) document.querySelector(`[data-property-id="${CSS.escape(props.highlightPropertyId)}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [props.highlightPropertyId]);
  const roomInNode = transformations.flatMap(item => item.properties).length < MAX_NODE_PROPERTIES;
  const canStack = !state && transformations.length < MAX_TRANSFORMATIONS;
  return <div className="property-inspector">{menu}
    <div className="node-heading"><span className={`node-kind kind-${node.kind}`}><Icon name={node.kind === "collection" ? "collection" : "object"} size={13} />{node.kind === "collection" ? "Brush Stamp" : "Object"}{node.primitive && ` · ${node.primitive}`}</span>
      <input className="node-name-input" aria-label="Node name" maxLength={100} value={node.name} onChange={e => { if (e.target.value.trim()) props.onNode({ name: e.target.value }); }} />
      <textarea aria-label="Node description" maxLength={600} rows={2} value={node.description} onChange={e => props.onNode({ description: e.target.value })} /></div>
    <StateBar {...props} />
    {state && <div className="state-editing-note">Editing <strong>{state.label}</strong> · values below apply to this state only</div>}
    <StateDetails {...props} />
    <div className="transformation-stack" aria-label="Semantic transformations">
      <span className="inspector-subtitle">SEMANTIC TRANSFORMATIONS · {transformations.length}/{MAX_TRANSFORMATIONS}</span>
      {transformations.map((transformation, index) => <TransformationCard key={transformation.id} transformation={transformation} index={index} count={transformations.length} roomInNode={roomInNode} props={props} openMenu={openMenu} />)}
      {!transformations.length && <p className="empty-panel">No semantic transformations yet. Add one, or let AI propose one.</p>}
    </div>
    <div className="inspector-actions">
      {canStack && <button className="copy-button" disabled={busy} onClick={props.onAddTransformation}>+ Add transformation</button>}
      {canStack && <button className="alternative-button" disabled={busy} onClick={() => props.onRegenerate({})}><Icon name="spark" size={14} />Add transformation with AI</button>}
      <button className="alternative-button" disabled={busy} onClick={props.onGenerateMachine}><Icon name="grid" size={14} />{node.machine ? "Refine state machine" : "Generate state machine"}</button>
      {node.machine && <button className="copy-button" disabled={busy} onClick={props.onRemoveMachine}>Remove state machine</button>}
    </div>
  </div>;
}
