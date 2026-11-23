import { z } from "zod";
import { clarifySchema, demoKey } from "./manipulate";
import { overlayPlanSchema } from "./overlay";
import { analysisSchema } from "./trace";

// Tools kept with a frame: when a temporary fork the user showed something on with direct manipulation tools is kept,
// its code (which reads what the tools show, m.demo) becomes the frame's, and the tools stay with the frame — saved
// with it, offered as sub tools of its brush — so the user can go on showing with them (the frame redraws at once) and
// inspect the values they set on the picture, as on the fork.

export const MAX_KEPT_SETS = 6, MAX_KEPT_STROKES = 40;
const pointSchema = z.object({ x: z.number().min(-5000).max(20000), y: z.number().min(-5000).max(20000) });
const strokeSchema = z.object({ id: z.string().max(80), tool: z.enum(["brush", "pencil"]), points: z.array(pointSchema).transform(points => points.slice(0, 4000)), width: z.number(), dx: z.number(), dy: z.number(), scale: z.number(), rotate: z.number() });

export const keptToolSetSchema = z.object({
  id: z.string().max(80),
  /** The concern the tools were made for, and the rule picked (if any). */
  concern: z.string().max(2000),
  rule: z.string().max(400).default(""),
  tools: clarifySchema.shape.tools,
  targets: clarifySchema.shape.targets,
  /** What is shown with them now, and what it measures to (by demoKey: what the frame's code reads with m.demo). */
  strokes: z.array(strokeSchema).transform(strokes => strokes.slice(-MAX_KEPT_STROKES)).default([]),
  values: z.record(z.string().max(120), z.unknown()).default({}),
  /** Which of the frame's recorded values the tools set and how they go on its picture (from the fork's inspection). */
  analysis: analysisSchema.nullable().default(null),
  plans: z.record(z.string().max(200), overlayPlanSchema.shape.plans.element).default({}),
});
export type KeptToolSet = z.infer<typeof keptToolSetSchema>;

/** Every value the frame's code reads with m.demo, from all its kept tool sets (a later set wins). */
export const keptValues = (sets: KeptToolSet[]): Record<string, unknown> => Object.assign({}, ...sets.map(set => set.values));
/** The m.demo values a set's targets measured to (null for what nothing shows yet). */
export const demoValues = (targets: KeptToolSet["targets"], measured: Record<string, unknown>) =>
  Object.fromEntries(targets.filter(target => !target.param).map(target => [demoKey(target.id), measured[target.id] ?? null]));
