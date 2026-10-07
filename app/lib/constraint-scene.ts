import { ART_WIDTH as W, ART_HEIGHT as H, constraintSceneSchema, type ConstraintScene, type SceneNode, type SceneBox, type SceneReference, type WidgetKind, type Feature, type RuleGroup, type Parameter } from "./schema";
import { updateParameter } from "./subfeatures";

export const MAX_EXTRACTED_WIDGETS = 7;
export const kindLabels: Record<WidgetKind, string> = { spatial: "Spatial constraint", temporal: "Temporal constraint", stylistic: "Stylistic constraint", object: "Object" };
export const emptyScene = (): ConstraintScene => ({ nodes: [], algorithms: [] });
const stableId = (prefix: string, ...parts: string[]) => {
  let hash = 2166136261;
  for (const char of JSON.stringify(parts)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `${prefix}-${(hash >>> 0).toString(36)}`;
};
export function inferKind(label: string): WidgetKind {
  if (/color|palette|texture|stroke|opacity|fill|style|색|질감/i.test(label)) return "stylistic";
  if (/time|motion|speed|animation|oscillat|시간|속도|움직/i.test(label)) return "temporal";
  if (/primitive|object|shape|leaf|petal|circle|ellipse|triangle|도형|오브젝트/i.test(label)) return "object";
  return "spatial";
}
export function withoutTemporalConstraints(scene: ConstraintScene): ConstraintScene {
  const nodes = scene.nodes.filter(n => n.kind !== "temporal");
  const removed = new Set(scene.nodes.filter(n => n.kind === "temporal").flatMap(n => n.algorithmIds));
  return { ...scene, nodes, algorithms: scene.algorithms.filter(a => !removed.has(a.id) || nodes.some(n => n.algorithmIds.includes(a.id))) };
}
export function sourceReference(image: string, features: Feature[]): SceneReference {
  return { id: stableId("reference", image), image, features: structuredClone(features) };
}
export function withSceneReference(scene: ConstraintScene, features: Feature[], image: string): ConstraintScene {
  const reference = sourceReference(image, features);
  return { ...scene, references: [...(scene.references || []).filter(r => r.id !== reference.id), reference], nodes: scene.nodes.map(n => {
    const feature = features.find(f => f.id === n.featureId) || n.source?.feature;
    return feature ? { ...n, source: { feature: structuredClone(feature), box: n.source?.box || { ...n.box }, referenceId: n.source?.referenceId || reference.id } } : n;
  }) };
}
const inferPrimitive = (label: string): NonNullable<SceneNode["primitive"]> => /curve|trail|contour|wave|곡선|윤곽/i.test(label) ? "path" : /line|branch|선|가지/i.test(label) ? "line" : /triangle|삼각/i.test(label) ? "triangle" : /rect|사각/i.test(label) ? "rectangle" : "ellipse";
export function sceneFromRules(features: Feature[], groups: RuleGroup[], previous: ConstraintScene = emptyScene(), replaceFeatureIds: string[] = []): ConstraintScene {
  groups = groups.map(group => ({ ...group, subfeatures: group.subfeatures.filter(sub => (sub.kind || inferKind(sub.label)) !== "temporal") })).filter(group => group.subfeatures.length);
  const scene = structuredClone(withoutTemporalConstraints(previous));
  const spatialSource = groups.flatMap(group => group.subfeatures.map(sub => ({ group, sub }))).find(({ sub }) => (sub.kind || inferKind(sub.label)) === "spatial");
  const sharedSpatial = spatialSource ? stableId("widget", spatialSource.group.featureId, spatialSource.sub.id) : null;
  const hasSourceObject = groups.some(group => group.subfeatures.some(sub => (sub.kind || inferKind(sub.label)) === "object"));
  const globalIds = new Map<string, string>();
  for (const group of groups) for (const sub of group.subfeatures) globalIds.set(sub.id, stableId("widget", group.featureId, sub.id));
  for (const group of groups) {
    const feature = features.find(f => f.id === group.featureId);
    const region = feature?.region || { x: .2, y: .2, w: .6, h: .6 };
    const extracted = group.subfeatures.map(sub => {
      const id = stableId("widget", group.featureId, sub.id);
      const old = scene.nodes.find(n => n.id === id);
      const kind = sub.kind || inferKind(sub.label);
      for (const method of sub.implementations) {
        const algorithmId = stableId("algorithm", group.featureId, sub.id, method.id);
        const index = scene.algorithms.findIndex(a => a.id === algorithmId);
        const algorithm = { id: algorithmId, featureId: group.featureId, subfeatureId: sub.id, implementation: structuredClone(method) };
        if (index < 0) scene.algorithms.push(algorithm);
        else if (replaceFeatureIds.includes(group.featureId)) scene.algorithms[index] = algorithm;
      }
      const selected = stableId("algorithm", group.featureId, sub.id, sub.selectedImplementation);
      const node: SceneNode = old ? { ...old, kind, primitive: kind === "object" ? sub.primitive || old.primitive || inferPrimitive(sub.label) : null, ...(kind === "object" ? { algorithmIds: [], targetIds: [], definitionId: old.definitionId === undefined ? selected : old.definitionId } : old.definitionId === undefined ? {} : { definitionId: null }) } : {
        id, label: sub.label, kind, box: clampBox(sub.region || { ...region }), ...(feature ? { source: { feature: structuredClone(feature), box: clampBox(sub.region || { ...region }), referenceId: null } } : {}), featureId: group.featureId, sourceSubfeatureId: sub.id,
        parentId: null, targetIds: [], algorithmIds: kind === "object" ? [] : [selected], ...(kind === "object" ? { definitionId: selected } : {}), primitive: kind === "object" ? sub.primitive || inferPrimitive(sub.label) : null,
      };
      return { node, old, selected };
    });
    let spatial = extracted.find(item => item.node.kind === "spatial")?.node || scene.nodes.find(n => n.featureId === group.featureId && n.kind === "spatial" && !n.sourceSubfeatureId);
    if (!spatial && sharedSpatial) spatial = { id: sharedSpatial } as SceneNode;
    if (!spatial && (!hasSourceObject || extracted.some(item => item.node.kind === "object" && group.subfeatures.find(sub => sub.id === item.node.sourceSubfeatureId)?.parentSubfeatureId === undefined))) {
      spatial = { id: stableId("layout", group.featureId), label: `${group.title.slice(0, 80)} layout`, kind: "spatial", featureId: group.featureId, sourceSubfeatureId: null, box: clampBox(region), ...(feature ? { source: { feature: structuredClone(feature), box: clampBox(region), referenceId: null } } : {}), parentId: null, targetIds: [], algorithmIds: [], primitive: null };
      scene.nodes.push(spatial);
    }
    const extractedIds = new Map(extracted.map(item => [item.node.sourceSubfeatureId, item.node.id]));
    for (const item of extracted) {
      const sub = group.subfeatures.find(sub => sub.id === item.node.sourceSubfeatureId)!;
      if (!item.old && sub.parentSubfeatureId !== undefined) item.node.parentId = sub.parentSubfeatureId ? extractedIds.get(sub.parentSubfeatureId) || globalIds.get(sub.parentSubfeatureId) || null : null;
      if (!item.old && item.node.kind === "object" && sub.parentSubfeatureId === undefined) item.node.parentId = spatial?.id || null;
      if (!item.old && ["temporal", "stylistic"].includes(item.node.kind)) item.node.targetIds = sub.targetSubfeatureIds?.length ? sub.targetSubfeatureIds.flatMap(id => extractedIds.has(id) || globalIds.has(id) ? [extractedIds.get(id) || globalIds.get(id)!] : []) : spatial ? [spatial.id] : groups.flatMap(g => g.subfeatures.filter(sub => (sub.kind || inferKind(sub.label)) === "object").map(sub => stableId("widget", g.featureId, sub.id)));
      const index = scene.nodes.findIndex(n => n.id === item.node.id);
      if (index < 0) scene.nodes.push(item.node); else scene.nodes[index] = item.node;
    }
    if (!hasSourceObject && !scene.nodes.some(n => n.featureId === group.featureId && n.kind === "object")) scene.nodes.push({
      id: stableId("object", group.featureId), label: `${group.title.slice(0, 80)} primitive`, kind: "object", featureId: group.featureId, sourceSubfeatureId: null,
      box: clampBox(region), ...(feature ? { source: { feature: structuredClone(feature), box: clampBox(region), referenceId: null } } : {}), parentId: spatial?.id || null, targetIds: [], algorithmIds: [], primitive: inferPrimitive(group.title),
    });
  }
  // Remove regenerated source widgets that no longer exist, while keeping detached algorithms reusable.
  const wanted = new Set(groups.flatMap(g => g.subfeatures.map(s => stableId("widget", g.featureId, s.id))));
  scene.nodes = scene.nodes.filter(n => !n.sourceSubfeatureId || !n.featureId || !replaceFeatureIds.includes(n.featureId) || wanted.has(n.id));
  const nodes = new Map(scene.nodes.map(n => [n.id, n]));
  for (const n of scene.nodes) {
    if (n.parentId && (nodes.get(n.parentId)?.kind !== "spatial" || !["object", "spatial"].includes(n.kind))) n.parentId = null;
    n.targetIds = n.kind === "spatial" || n.kind === "object" ? [] : n.targetIds.filter(id => id !== n.id && ["spatial", "object"].includes(nodes.get(id)?.kind || ""));
  }
  return constraintSceneSchema.parse(scene);
}
export function descendants(scene: ConstraintScene, id: string): string[] {
  return scene.nodes.filter(n => n.parentId === id).flatMap(n => [n.id, ...descendants(scene, n.id)]);
}
export function reparentNode(scene: ConstraintScene, id: string, parentId: string | null): ConstraintScene {
  const node = scene.nodes.find(n => n.id === id);
  if (!node || !["object", "spatial"].includes(node.kind)) throw new Error("포함할 object 또는 spatial group을 선택해주세요.");
  if (parentId && (parentId === id || descendants(scene, id).includes(parentId) || scene.nodes.find(n => n.id === parentId)?.kind !== "spatial")) throw new Error("순환 포함 없이 spatial constraint에 넣어주세요.");
  return constraintSceneSchema.parse({ ...scene, nodes: scene.nodes.map(n => n.id === id ? { ...n, parentId } : n) });
}
export function clampBox(box: SceneBox): SceneBox {
  const w = Math.max(.01, Math.min(1, box.w)), h = Math.max(.01, Math.min(1, box.h));
  return { x: Math.max(0, Math.min(1 - w, box.x)), y: Math.max(0, Math.min(1 - h, box.y)), w, h };
}
export function transformNode(scene: ConstraintScene, id: string, box: SceneBox): ConstraintScene {
  const node = scene.nodes.find(n => n.id === id); if (!node) return scene;
  const next = clampBox(box), children = node.kind === "spatial" ? new Set(descendants(scene, id)) : new Set<string>();
  return { ...scene, nodes: scene.nodes.map(n => n.id === id ? { ...n, box: next } : children.has(n.id) ? { ...n, box: clampBox({ x: next.x + (n.box.x - node.box.x) * next.w / node.box.w, y: next.y + (n.box.y - node.box.y) * next.h / node.box.h, w: n.box.w * next.w / node.box.w, h: n.box.h * next.h / node.box.h }) } : n) };
}
export function connectAlgorithm(scene: ConstraintScene, nodeId: string, algorithmId: string, attach: boolean): ConstraintScene {
  const node = scene.nodes.find(n => n.id === nodeId);
  if (!node || node.kind === "object" || !scene.algorithms.some(a => a.id === algorithmId)) throw new Error("알고리즘을 넣을 constraint를 선택해주세요.");
  const ids = attach ? [...new Set([...node.algorithmIds, algorithmId])] : node.algorithmIds.filter(id => id !== algorithmId);
  return constraintSceneSchema.parse({ ...scene, nodes: scene.nodes.map(n => n.id === nodeId ? { ...n, algorithmIds: ids } : n) });
}
export function removeNode(scene: ConstraintScene, id: string): ConstraintScene {
  const parent = scene.nodes.find(n => n.id === id)?.parentId || null;
  return { ...scene, nodes: scene.nodes.filter(n => n.id !== id).map(n => ({ ...n, parentId: n.parentId === id ? parent : n.parentId, targetIds: n.targetIds.filter(target => target !== id) })) };
}
export function updateAlgorithmParameter(scene: ConstraintScene, id: string, parameterId: string, value: Parameter["value"]): ConstraintScene {
  return { ...scene, algorithms: scene.algorithms.map(a => {
    if (a.id !== id) return a;
    const updated = updateParameter([{ featureId: "algorithm", title: "", subfeatures: [{ id: "algorithm", label: "", selectedImplementation: a.implementation.id, implementations: [a.implementation] }] }], "algorithm", "algorithm", a.implementation.id, parameterId, value);
    return { ...a, implementation: updated[0].subfeatures[0].implementations[0] };
  }) };
}
// Stable live bindings per widget. Shared algorithms read the same canonical values at every attachment.
export function sceneGroups(scene: ConstraintScene): RuleGroup[] {
  return scene.nodes.map(n => ({ featureId: `widget:${n.id}`, title: n.label, subfeatures: [
    { id: "geometry", label: "Frame geometry", selectedImplementation: "bounds", implementations: [{ id: "bounds", label: "Bounds", description: "Absolute canvas bounds in pixels; x/y are top-left, w/h are width/height. These are authoritative for direct manipulation.", parameters: (Object.keys(n.box) as (keyof SceneBox)[]).map(key => ({ id: key, label: key, type: "number" as const, value: Number((n.box[key] * (["x", "w"].includes(key) ? W : H)).toFixed(6)), min: 0, max: ["x", "w"].includes(key) ? W : H, step: .001, unit: "px" })) }] },
    ...[...n.algorithmIds, ...(n.definitionId ? [n.definitionId] : [])].flatMap(id => {
      const algorithm = scene.algorithms.find(a => a.id === id); return algorithm ? [{ id, label: algorithm.implementation.label, selectedImplementation: algorithm.implementation.id, implementations: [algorithm.implementation] }] : [];
    }),
  ] }));
}
export function sceneTopology(scene: ConstraintScene): string {
  return JSON.stringify({ nodes: scene.nodes.map(({ box: _box, label: _label, source: _source, ...node }) => node), algorithms: scene.algorithms.filter(a => scene.nodes.some(n => n.algorithmIds.includes(a.id) || n.definitionId === a.id)).map(a => ({ ...a, implementation: { ...a.implementation, parameters: a.implementation.parameters.map(({ value: _value, ...p }) => p) } })) });
}

// Rule discovery/revision sees current canonical values, even after assets are shared or moved.
export function rulesFromScene(groups: RuleGroup[], scene: ConstraintScene): RuleGroup[] {
  return groups.map(g => ({ ...g, subfeatures: g.subfeatures.map(sub => ({ ...sub, implementations: sub.implementations.map(method => scene.algorithms.find(a => a.featureId === g.featureId && a.subfeatureId === sub.id && a.implementation.id === method.id)?.implementation || method) })) }));
}
export function applyRuleRevision(features: Feature[], before: RuleGroup[], after: RuleGroup[], scene: ConstraintScene): ConstraintScene {
  const deliberatelyRemoved = sceneFromRules(features, before).nodes.map(n => n.id).filter(id => !scene.nodes.some(n => n.id === id));
  const removedFeatures = before.map(g => g.featureId).filter(id => !features.some(f => f.id === id));
  let next = sceneFromRules(features, after, scene, before.map(g => g.featureId));
  const removed = next.nodes.filter(n => deliberatelyRemoved.includes(n.id) || (!!n.featureId && removedFeatures.includes(n.featureId))).map(n => n.id);
  for (const id of removed) next = removeNode(next, id);
  return constraintSceneSchema.parse(next);
}

export function spatialAt(scene: ConstraintScene, point: { x: number; y: number }, excludeId?: string): SceneNode | undefined {
  const excluded = new Set(excludeId ? [excludeId, ...descendants(scene, excludeId)] : []);
  return scene.nodes.filter(n => n.kind === "spatial" && !excluded.has(n.id) && point.x >= n.box.x && point.x <= n.box.x + n.box.w && point.y >= n.box.y && point.y <= n.box.y + n.box.h).sort((a, b) => a.box.w * a.box.h - b.box.w * b.box.h)[0];
}
const containsPoint = (box: SceneBox, point: { x: number; y: number }) => point.x >= box.x && point.x <= box.x + box.w && point.y >= box.y && point.y <= box.y + box.h;
// Dropping into a spatial constraint changes ownership; dropping into style/time regions connects their scope.
export function settleSceneNode(scene: ConstraintScene, id: string): ConstraintScene {
  let next = scene;
  let node = next.nodes.find(n => n.id === id); if (!node) return next;
  const center = { x: node.box.x + node.box.w / 2, y: node.box.y + node.box.h / 2 };
  if (["object", "spatial"].includes(node.kind)) {
    const parent = spatialAt(next, center, id);
    next = reparentNode(next, id, parent?.id || null);
  }
  node = next.nodes.find(n => n.id === id)!;
  const movedIds = new Set([id, ...descendants(next, id)]);
  next = { ...next, nodes: next.nodes.map(constraint => {
    if (!["temporal", "stylistic"].includes(constraint.kind)) return constraint;
    const covered = new Set(constraint.targetIds.flatMap(targetId => [targetId, ...descendants(next, targetId)]));
    const candidates = next.nodes.filter(n => n.kind === "object" && !covered.has(n.id) && (constraint.id === id || movedIds.has(n.id)) && containsPoint(constraint.box, { x: n.box.x + n.box.w / 2, y: n.box.y + n.box.h / 2 }));
    return { ...constraint, targetIds: [...new Set([...constraint.targetIds, ...candidates.map(n => n.id)])] };
  }) };
  return constraintSceneSchema.parse(next);
}
export function dropSceneNode(scene: ConstraintScene, id: string, point: { x: number; y: number }): ConstraintScene {
  const node = scene.nodes.find(n => n.id === id); if (!node) throw new Error("배치할 위젯을 찾지 못했습니다.");
  return settleSceneNode(transformNode(scene, id, { ...node.box, x: point.x - node.box.w / 2, y: point.y - node.box.h / 2 }), id);
}
export function addSceneNode(scene: ConstraintScene, kind: WidgetKind, point: { x: number; y: number }, id: string, primitive: SceneNode["primitive"] = "ellipse"): ConstraintScene {
  const w = kind === "object" ? .12 : .32, h = kind === "object" ? .14 : .32;
  const node: SceneNode = { id, label: kind === "object" ? `Primitive ${scene.nodes.filter(n => n.kind === "object").length + 1}` : `${kindLabels[kind]} ${scene.nodes.filter(n => n.kind === kind).length + 1}`, kind, box: clampBox({ x: point.x - w / 2, y: point.y - h / 2, w, h }), featureId: null, sourceSubfeatureId: null, parentId: null, targetIds: [], algorithmIds: [], primitive: kind === "object" ? primitive || "ellipse" : null };
  return settleSceneNode({ ...scene, nodes: [...scene.nodes, node] }, id);
}
export function copySceneNode(source: ConstraintScene, target: ConstraintScene, id: string, point: { x: number; y: number }, makeId: () => string): { scene: ConstraintScene; nodeId: string } {
  const root = source.nodes.find(n => n.id === id); if (!root) throw new Error("원본 위젯을 찾지 못했습니다.");
  const ids = new Set([id, ...descendants(source, id)]);
  // Carry the constraints that give an extracted object its actual shape and appearance.
  if (root.kind === "object") {
    let parent = root.parentId;
    while (parent) { ids.add(parent); parent = source.nodes.find(n => n.id === parent)?.parentId || null; }
  }
  if (["temporal", "stylistic"].includes(root.kind) && !target.nodes.some(n => n.kind === "object")) {
    for (const targetId of root.targetIds) for (const target of [targetId, ...descendants(source, targetId)]) ids.add(target);
  }
  const objects = new Set(source.nodes.filter(n => n.kind === "object" && ids.has(n.id)).map(n => n.id));
  for (const application of constraintApplications(source)) {
    if (["temporal", "stylistic"].includes(application.kind) && application.objectIds.some(id => objects.has(id))) ids.add(application.constraintId);
  }
  const mapping = new Map([...ids].map(id => [id, makeId()]));
  const attached = new Set(source.nodes.filter(n => ids.has(n.id)).flatMap(n => [...n.algorithmIds, ...(n.definitionId ? [n.definitionId] : [])]));
  const algorithms = [...target.algorithms];
  const algorithmMapping = new Map<string, string>();
  for (const algorithm of source.algorithms.filter(a => attached.has(a.id))) {
    const existing = algorithms.find(a => a.id === algorithm.id);
    const nextId = existing && JSON.stringify(existing) !== JSON.stringify(algorithm) ? makeId() : algorithm.id;
    algorithmMapping.set(algorithm.id, nextId);
    if (!algorithms.some(a => a.id === nextId)) algorithms.push({ ...structuredClone(algorithm), id: nextId });
  }
  const copied = source.nodes.filter(n => ids.has(n.id)).map(n => ({ ...structuredClone(n), id: mapping.get(n.id)!, featureId: null, sourceSubfeatureId: null, parentId: mapping.get(n.parentId || "") || null,
    ...(n.definitionId ? { definitionId: algorithmMapping.get(n.definitionId)! } : {}), algorithmIds: n.algorithmIds.map(id => algorithmMapping.get(id)!),
    targetIds: n.targetIds.flatMap(targetId => mapping.has(targetId) ? [mapping.get(targetId)!] : descendants(source, targetId).filter(id => objects.has(id)).map(id => mapping.get(id)!)),
  }));
  // Translate the complete dependency bundle once; keep source-relative geometry and sizes.
  const left = Math.min(...copied.map(n => n.box.x)), top = Math.min(...copied.map(n => n.box.y));
  const right = Math.max(...copied.map(n => n.box.x + n.box.w)), bottom = Math.max(...copied.map(n => n.box.y + n.box.h));
  const dx = Math.max(-left, Math.min(1 - right, point.x - root.box.x - root.box.w / 2));
  const dy = Math.max(-top, Math.min(1 - bottom, point.y - root.box.y - root.box.h / 2));
  const moved = copied.map(n => ({ ...n, box: { ...n.box, x: n.box.x + dx, y: n.box.y + dy } }));
  const referenceIds = new Set(moved.flatMap(n => n.source?.referenceId ? [n.source.referenceId] : []));
  const references = [...(target.references || []), ...(source.references || []).filter(r => referenceIds.has(r.id) && !target.references?.some(existing => existing.id === r.id))];
  const nodeId = mapping.get(id)!;
  return { scene: settleSceneNode({ nodes: [...target.nodes, ...moved], algorithms, ...(references.length ? { references } : {}) }, nodeId), nodeId };
}

export function constraintApplications(scene: ConstraintScene) {
  return scene.nodes.filter(n => n.kind !== "object").map(constraint => {
    const targets = new Set(constraint.kind === "spatial" ? descendants(scene, constraint.id) : constraint.targetIds.flatMap(id => [id, ...descendants(scene, id)]));
    return { constraintId: constraint.id, kind: constraint.kind, algorithmIds: constraint.algorithmIds, objectIds: scene.nodes.filter(n => n.kind === "object" && targets.has(n.id)).map(n => n.id) };
  });
}
