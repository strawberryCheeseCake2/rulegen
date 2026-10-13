import type { Property, SceneNode, SemanticTransformation } from "./schema";
import { MAX_NODE_PROPERTIES, MAX_PROPERTIES, MAX_TRANSFORMATIONS } from "./schema";

// A node stacks semantic transformations, applied in order. Property ids are
// unique across the whole node, so live keys stay `nodeId/propertyId/…` and
// state values keep addressing a property by id alone.

/** Every property of a node, in transformation order. */
export const nodeProperties = (node: SceneNode): Property[] => node.transformations.flatMap(transformation => transformation.properties);
export const findProperty = (node: SceneNode, propertyId: string) => nodeProperties(node).find(property => property.id === propertyId);
export const propertyOwner = (node: SceneNode, propertyId: string) => node.transformations.find(transformation => transformation.properties.some(property => property.id === propertyId));
export const findTransformation = (node: SceneNode, transformationId: string | null | undefined) => node.transformations.find(transformation => transformation.id === transformationId);

/** Edit or drop (return null) properties wherever they live. */
export function mapProperties(node: SceneNode, edit: (property: Property, transformation: SemanticTransformation) => Property | null): SceneNode {
  return { ...node, transformations: node.transformations.map(transformation => ({ ...transformation,
    properties: transformation.properties.flatMap(property => { const next = edit(property, transformation); return next ? [next] : []; }) })) };
}
export const updateProperty = (node: SceneNode, propertyId: string, edit: (property: Property) => Property) => mapProperties(node, property => property.id === propertyId ? edit(property) : property);
export function updateTransformation(node: SceneNode, transformationId: string, edit: (transformation: SemanticTransformation) => SemanticTransformation): SceneNode {
  return { ...node, transformations: node.transformations.map(transformation => transformation.id === transformationId ? edit(transformation) : transformation) };
}

const slug = (base: string, fallback: string) => base.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "").slice(0, 70) || fallback;
export function uniquePropertyId(node: SceneNode, base: string) {
  const root = slug(base, "property"); let id = root, suffix = 2;
  while (findProperty(node, id)) id = `${root}-${suffix++}`;
  return id;
}
export function uniqueTransformationId(node: SceneNode, base: string) {
  const root = slug(base, "transformation"); let id = root, suffix = 2;
  while (findTransformation(node, id)) id = `${root}-${suffix++}`;
  return id;
}

export const canAddTransformation = (node: SceneNode) => node.transformations.length < MAX_TRANSFORMATIONS;
/** Room for one more property in this transformation (or, without one, anywhere new). */
export function canAddProperty(node: SceneNode, transformationId?: string | null) {
  if (nodeProperties(node).length >= MAX_NODE_PROPERTIES) return false;
  const target = findTransformation(node, transformationId);
  return target ? target.properties.length < MAX_PROPERTIES : canAddTransformation(node) || node.transformations.some(item => item.properties.length < MAX_PROPERTIES);
}

export function addTransformation(node: SceneNode, transformation: Partial<SemanticTransformation> = {}): { node: SceneNode; id: string } {
  if (!canAddTransformation(node)) throw new Error(`한 노드에는 semantic transformation을 ${MAX_TRANSFORMATIONS}개까지 둘 수 있습니다.`);
  const id = uniqueTransformationId(node, transformation.id || transformation.label || "transformation");
  return { node: { ...node, transformations: [...node.transformations, { label: "", description: "", properties: [], ...transformation, id }] }, id };
}
export function removeTransformation(node: SceneNode, transformationId: string): SceneNode {
  const removed = new Set(findTransformation(node, transformationId)?.properties.map(property => property.id));
  return { ...node, transformations: node.transformations.filter(item => item.id !== transformationId),
    machine: node.machine && { ...node.machine, states: node.machine.states.map(state => ({ ...state, values: state.values.filter(item => !removed.has(item.propertyId)) })) } };
}
/** Reorder: transformations apply top to bottom. */
export function moveTransformation(node: SceneNode, transformationId: string, offset: number): SceneNode {
  const from = node.transformations.findIndex(item => item.id === transformationId), to = from + offset;
  if (from < 0 || to < 0 || to >= node.transformations.length) return node;
  const transformations = [...node.transformations];
  const [moved] = transformations.splice(from, 1); transformations.splice(to, 0, moved);
  return { ...node, transformations };
}

/**
 * Add a property (its id made unique for the node) to a transformation; without
 * a target it goes to the last transformation with room, or a new one.
 */
export function appendProperty(node: SceneNode, property: Property, transformationId?: string | null, newLabel = "Transformation"): { node: SceneNode; propertyId: string } {
  if (nodeProperties(node).length >= MAX_NODE_PROPERTIES) throw new Error(`한 노드에는 property를 ${MAX_NODE_PROPERTIES}개까지 둘 수 있습니다.`);
  let next = node, target = findTransformation(node, transformationId) || [...node.transformations].reverse().find(item => !transformationId && item.properties.length < MAX_PROPERTIES);
  if (!target) {
    if (transformationId) throw new Error("property를 넣을 transformation을 찾지 못했습니다.");
    const added = addTransformation(node, { label: newLabel }); next = added.node; target = findTransformation(next, added.id)!;
  }
  if (target.properties.length >= MAX_PROPERTIES) throw new Error(`한 transformation에는 property를 ${MAX_PROPERTIES}개까지 둘 수 있습니다.`);
  const propertyId = uniquePropertyId(next, property.id);
  return { node: updateTransformation(next, target.id, item => ({ ...item, properties: [...item.properties, { ...property, id: propertyId }] })), propertyId };
}

/**
 * Place an AI-generated transformation: replace one property (`propertyId`), replace
 * one transformation keeping its id (`transformationId`), or stack it as a new one.
 */
export function placeTransformation(node: SceneNode, generated: SemanticTransformation, target: { transformationId?: string; propertyId?: string }): SceneNode {
  if (target.propertyId) {
    const replacement = generated.properties.find(property => property.id === target.propertyId);
    if (!replacement || generated.properties.length !== 1 || !findProperty(node, target.propertyId)) throw new Error("생성된 property가 선택과 다릅니다. 다시 시도해주세요.");
    return updateProperty(node, target.propertyId, () => replacement);
  }
  if (target.transformationId && !findTransformation(node, target.transformationId)) throw new Error("다시 만들 semantic transformation을 찾지 못했습니다.");
  const others = node.transformations.filter(item => item.id !== target.transformationId);
  const taken = new Set(others.flatMap(item => item.properties.map(property => property.id)));
  const properties = generated.properties.map(property => {
    let id = property.id, suffix = 2;
    while (taken.has(id)) id = `${property.id.slice(0, 70)}-${suffix++}`;
    taken.add(id); return { ...property, id };
  });
  if (others.flatMap(item => item.properties).length + properties.length > MAX_NODE_PROPERTIES) throw new Error(`한 노드에는 property를 ${MAX_NODE_PROPERTIES}개까지 둘 수 있습니다.`);
  if (target.transformationId) return { ...node, transformations: node.transformations.map(item => item.id === target.transformationId ? { ...generated, id: item.id, properties } : item) };
  return addTransformation(node, { ...generated, properties }).node;
}
