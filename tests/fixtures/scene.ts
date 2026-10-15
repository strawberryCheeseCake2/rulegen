import vm from "node:vm";
import type { AIScene } from "../../app/lib/scene/ai-schema";
import { convertScene } from "../../app/lib/scene/convert";
import { prepareCode } from "../../app/server/code.server";

export const num = (value: number, min: number, max: number, step = 1, unit = "") => ({ type: "number" as const, value, min, max, step, unit });

/** A model-style extraction: a tree collection using a nested algorithm, and an interactive orb object. */
export const aiScene: AIScene = {
  algorithms: [
    { id: "power-decay", name: "Power decay", description: "값 = base * ratio^depth", params: [
      { id: "base", label: "Base", description: "첫 세대 길이", value: num(140, 20, 300, 1, "px") },
      { id: "ratio", label: "Ratio", description: "감소 비율", value: num(.7, .3, .95, .01) },
    ] },
    { id: "recursive-branch", name: "Recursive branch", description: "depth 세대까지 둘로 갈라지고 length로 길이를 정합니다.", params: [
      { id: "depth", label: "Depth", description: "세대 수", value: num(6, 1, 9) },
      { id: "length", label: "Length", description: "세대별 길이", value: { type: "algorithm-ref", algorithmId: "power-decay" } },
    ] },
    { id: "sine-wave", name: "Sine wave", description: "amplitude*sin(t*cycles)", params: [{ id: "amplitude", label: "Amplitude", description: "", value: num(20, 0, 80, 1, "px") }] },
  ],
  nodes: [
    { id: "tree", kind: "collection", parentId: null, name: "Tree", description: "가지가 갈라지는 나무", primitive: "group", region: { x: .3, y: .05, w: .4, h: .9 },
      transformations: [
        { id: "branching-growth", label: "Branching growth", description: "재귀 분기", properties: [
          { id: "structure", label: "Branching", effect: "spatial", description: "가지 구조", value: { type: "algorithm", algorithmId: "recursive-branch", args: [{ id: "depth", value: num(5, 1, 9) }] } },
        ] },
        { id: "ink-wash", label: "Ink wash", description: "먹색", properties: [
          { id: "ink", label: "Ink", effect: "stylistic", description: "가지 색", value: { type: "color", value: "#75664e" } },
        ] },
      ], machine: null },
    { id: "orb", kind: "object", parentId: "tree", name: "Orb", description: "누르면 움직이는 원", primitive: "ellipse", region: { x: .45, y: .2, w: .1, h: .1 },
      transformations: [{ id: "pulse", label: "Pulse", description: "크기와 이동", properties: [
        { id: "radius", label: "Radius", effect: "spatial", description: "", value: num(24, 10, 140, 1, "px") },
        { id: "speed", label: "Speed", effect: "temporal", description: "", value: num(0, 0, 120, 1, "px/s") },
      ] }],
      machine: { initialState: "idle", states: [
        { id: "idle", label: "대기", description: "클릭을 기다립니다", values: [] },
        { id: "moving", label: "이동", description: "오른쪽으로 이동", values: [{ propertyId: "radius", value: num(80, 10, 140, 1, "px") }, { propertyId: "speed", value: num(40, 0, 120, 1, "px/s") }] },
      ], transitions: [
        { id: "press", from: "idle", to: "moving", label: "원 클릭", trigger: "event", afterMs: 1000 },
        { id: "settle", from: "moving", to: "idle", label: "정착 후 대기", trigger: "after", afterMs: 1200 },
      ] } },
  ],
};
export const sampleScene = () => convertScene(structuredClone(aiScene));

/** A model-written program honoring the scene code contract. */
export const sceneProgram = `rulegenModule("tree", function (m) {
  function algo_power_decay(base, ratio, depth) { return base * Math.pow(ratio, depth); }
  return {
    draw() {
      const box = m.box("tree"), x = box.x + box.w / 2, bottom = box.y + box.h;
      const depth = m.v("tree/structure/depth");
      const base = m.v("tree/structure/length/base"), ratio = m.v("tree/structure/length/ratio");
      p.stroke(m.v("tree/ink"));
      for (let i = 0; i < depth; i++) p.line(x, bottom - i * 10, x, bottom - i * 10 - algo_power_decay(base, ratio, i));
      const speed = m.v("orb/speed");
      p.circle(m.box("orb").x + speed * m.state("orb").elapsed / 1000, 300, m.v("orb/radius") * 2);
    },
    mousePressed() { if (m.state("orb").id === "idle") m.emit("orb", "press"); },
  };
});`;

/** Execute prepared code against a fake p5 and record drawing calls. */
export function run(source: string) {
  const circles: number[][] = [], lines: number[][] = [], strokes: unknown[] = [];
  const p: Record<string, unknown> = { setup() {}, draw() {}, deltaTime: 100, createCanvas() {}, background() {}, clear() {}, push() {}, pop() {}, noLoop() {}, stroke: (c: unknown) => strokes.push(c), line: (...a: number[]) => lines.push(a), circle: (...a: number[]) => circles.push(a) };
  const context = vm.createContext({ p, __rulegenGuard() {} });
  vm.runInContext(prepareCode(source), context);
  (p.setup as () => void)();
  return { p, circles, lines, strokes, draw: () => (p.draw as () => void)(), read: (expression: string) => vm.runInContext(expression, context) };
}

export async function withMockedAI<T>(respond: (body: any) => unknown, work: (calls: any[]) => Promise<T>) {
  const savedFetch = globalThis.fetch, savedKey = process.env.OPENAI_API_KEY, calls: any[] = [];
  process.env.OPENAI_API_KEY = "test-only";
  globalThis.fetch = async (_url, options) => { const body = JSON.parse(String(options!.body)); calls.push(body); return Response.json({ output: [{ content: [{ type: "output_text", text: JSON.stringify(respond(body)) }] }] }); };
  try { return await work(calls); }
  finally { globalThis.fetch = savedFetch; if (savedKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = savedKey; }
}
