import { stateMachineSchema, type RuleGroup } from "../../app/lib/schema";

export const sceneGroups: RuleGroup[] = [{ featureId: "orb", title: "Orb motion", subfeatures: [{ id: "motion", label: "Motion", selectedImplementation: "linear", implementations: [{ id: "linear", label: "Linear", description: "Radius controls size; speed controls horizontal or vertical movement in px per second.", parameters: [
  { id: "radius", label: "Radius", type: "number", value: 24, min: 10, max: 140, step: 1, unit: "px" },
  { id: "speed", label: "Speed", type: "number", value: 0, min: 0, max: 120, step: 1, unit: "px/s" },
  { id: "color", label: "Color", type: "color", value: "#397461" },
  { id: "filled", label: "Filled", type: "toggle", value: true },
  { id: "direction", label: "Direction", type: "select", value: "Horizontal", options: ["Horizontal", "Vertical"] },
] }] }] }];

export function sceneMachine() {
  const features = [{ id: "orb", label: "Orb", description: "A moving circular form", region: { x: .1, y: .1, w: .8, h: .8 } }];
  const states = ["idle", "moving", "settled"].map((id, index) => {
    const groups = structuredClone(sceneGroups);
    groups[0].subfeatures[0].implementations[0].parameters[0].value = [24, 80, 45][index];
    groups[0].subfeatures[0].implementations[0].parameters[1].value = [0, 40, 0][index];
    groups[0].subfeatures[0].implementations[0].parameters[2].value = ["#397461", "#b34c72", "#397db0"][index];
    return { id, label: ["Idle", "Moving", "Settled"][index], description: `${id} scene`, features: structuredClone(features), groups };
  });
  return stateMachineSchema.parse({ initialState: "idle", states, transitions: [
    { id: "start", from: "idle", to: "moving", label: "Start motion", trigger: "event", afterMs: 1000 },
    { id: "finish", from: "moving", to: "settled", label: "Finish", trigger: "after", afterMs: 1200 },
    { id: "reset", from: "settled", to: "idle", label: "Reset", trigger: "event", afterMs: 1000 },
  ] });
}

export const sceneAlgorithm = `p.setup = () => { p.createCanvas(900,600); };
p.draw = () => {
  const radius = rulegenState.params["orb/motion/linear/radius"];
  const speed = rulegenState.params["orb/motion/linear/speed"];
  const color = rulegenState.params["orb/motion/linear/color"];
  const filled = rulegenState.params["orb/motion/linear/filled"];
  const direction = rulegenState.params["orb/motion/linear/direction"];
  const distance = rulegenState.elapsed / 1000 * speed;
  p.background(245);
  p.stroke(color);
  if (filled) p.fill(color); else p.noFill();
  p.circle(250 + (direction === 'Horizontal' ? distance : 0), 300 + (direction === 'Vertical' ? distance : 0), radius * 2);
};`;
