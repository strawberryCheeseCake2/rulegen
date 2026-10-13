import type { Region, Scene, SceneNode, SemanticTransformation } from "./schema";
import { childrenOf, findNode } from "./graph";

// Fine-grained semantics, coarse objects: a transformation is ONE semantic
// operation (a few properties), never an effect-type bucket; an object whose
// parts share a clear common feature stays whole (its differences become
// transformations); only parts that differ in kind are nested collections.

/** Labels that name an effect category or a catch-all instead of an operation. */
export const GENERIC_TRANSFORMATION = /^\s*(spatial|stylistic|style|styling|temporal|time|timing|space|layout|appearance|look|motion|animation|movement|colou?r|visual|geometry|shape|form|transform(ation)?|properties|settings|parameters|effects?|base|main|default|general|misc(ellaneous)?)(\s+(effects?|properties|settings|transformations?|attributes|parameters|behaviou?r|controls?))?\s*$/i;
export const MAX_FINE_PROPERTIES = 4;
export const MAX_FLAT_OBJECTS = 6;

export type GranularityIssue = { kind: "bucket" | "coarse" | "flat" | "split"; nodeIds: string[]; message: string };

const near = (a: Region, b: Region, margin = .03) => a.x - margin < b.x + b.w && b.x - margin < a.x + a.w && a.y - margin < b.y + b.h && b.y - margin < a.y + a.h;
/**
 * Sibling objects with the same primitive that touch or overlap: one coherent
 * object split into pieces. Nodes with their own machine stay separate.
 */
export function splitObjects(scene: Scene): SceneNode[][] {
  const groups = new Map<string, SceneNode[]>();
  for (const node of scene.nodes) {
    const primitive = node.primitive.trim().toLowerCase();
    if (node.kind !== "object" || node.machine || !primitive) continue;
    const key = JSON.stringify([node.parentId, primitive]);
    groups.set(key, [...(groups.get(key) || []), node]);
  }
  // Within a primitive, connected clusters of touching regions.
  return [...groups.values()].flatMap(nodes => {
    const clusters: SceneNode[][] = [];
    for (const node of nodes) {
      const joined = clusters.filter(cluster => cluster.some(other => near(other.region, node.region)));
      const merged = [...joined.flat(), node];
      for (const cluster of joined) clusters.splice(clusters.indexOf(cluster), 1);
      clusters.push(merged);
    }
    return clusters.filter(cluster => cluster.length >= 2);
  });
}

/** A single transformation that is an effect bucket or bundles too much; null when fine. */
export function transformationIssue(node: SceneNode, transformation: SemanticTransformation): GranularityIssue | null {
  if (!transformation.label.trim() || GENERIC_TRANSFORMATION.test(transformation.label)) return { kind: "bucket", nodeIds: [node.id], message: `${node.name} (${node.id}) · "${transformation.label || transformation.id}" names an effect category, not a semantic operation` };
  if (transformation.properties.length > MAX_FINE_PROPERTIES) return { kind: "coarse", nodeIds: [node.id], message: `${node.name} (${node.id}) · "${transformation.label}" bundles ${transformation.properties.length} properties (${transformation.properties.map(property => property.label).join(", ")})` };
  return null;
}

/** `among` limits issues to those touching these node ids (e.g. nodes a revision added). */
export function granularityIssues(scene: Scene, among?: Set<string>): GranularityIssue[] {
  const issues: GranularityIssue[] = [];
  for (const node of scene.nodes) for (const transformation of node.transformations) { const issue = transformationIssue(node, transformation); if (issue) issues.push(issue); }
  for (const parentId of [null, ...scene.nodes.filter(node => node.kind === "collection").map(node => node.id)]) {
    const children = childrenOf(scene, parentId);
    if (children.length >= MAX_FLAT_OBJECTS && children.every(child => child.kind === "object"))
      issues.push({ kind: "flat", nodeIds: children.map(child => child.id), message: `${parentId ? `${findNode(scene, parentId)!.name} (${parentId})` : "The scene root"} holds ${children.length} flat objects (${children.map(child => child.name).join(", ")})` });
  }
  for (const cluster of splitObjects(scene))
    issues.push({ kind: "split", nodeIds: cluster.map(node => node.id), message: `${cluster.map(node => `${node.name} (${node.id})`).join(", ")} are touching "${cluster[0].primitive}" objects: one coherent object split into pieces` });
  return among ? issues.filter(issue => issue.nodeIds.some(id => among.has(id))) : issues;
}

export function granularityFeedback(issues: GranularityIssue[]) {
  const has = (kind: GranularityIssue["kind"]) => issues.some(issue => issue.kind === kind);
  return [
    "GRANULARITY VIOLATION. Rewrite the COMPLETE response with finer semantics:",
    ...issues.map(issue => `- ${issue.message}`),
    has("bucket") || has("coarse") ? `Split every transformation into separate, finely grained semantic operations, each named for WHAT it does (e.g. "Radial repetition", "Outward size decay", "Hue drift by ring", "Wind sway", "Edge jitter") with 1–${MAX_FINE_PROPERTIES - 1} properties. Never group properties by effect type (spatial / stylistic / temporal) or name a transformation after a category.` : "",
    has("split") ? "Keep objects whole: merge each listed group into ONE object whose region covers all of it, and express how its parts differ (size, angle, color, position, mirroring) with fine-grained transformations of that object." : "",
    has("flat") ? "Do not leave a long flat list of objects: group the parts that differ in kind into nested collections (whole → part groups → parts, up to 5 levels) — by grouping, never by splitting objects further." : "",
    "Keep ids of unchanged nodes, all values and the procedural economy rules.",
  ].filter(Boolean).join("\n");
}
