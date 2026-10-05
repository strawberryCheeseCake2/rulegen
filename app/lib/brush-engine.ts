import type P5 from "p5";
import type { BrushRecipe, Point } from "./schema";
type Painter = P5 | P5.Graphics;
export function stamp(p: Painter, brush: BrushRecipe, x: number, y: number, angle: number, seed: number, opacity = 1) {
  const s = brush.settings;
  const jitter = Math.sin(seed * 12.9898) * s.variation / 100;
  const ink = p.color(s.color); ink.setAlpha(opacity * 255);
  p.push(); p.translate(x, y); p.rotate(angle + jitter * .7); p.scale(s.size * (1 + jitter * .35));
  p.stroke(ink); p.noFill();
  const spread = s.spread * Math.PI / 180;
  function branch(x: number, y: number, len: number, angle: number, depth: number, weight: number) {
    if (depth < 1 || len < .015) return;
    const nx = x + Math.cos(angle) * len, ny = y + Math.sin(angle) * len;
    p.strokeWeight(weight); p.line(x, y, nx, ny);
    branch(nx, ny, len * .67, angle - spread, depth - 1, weight * (1 - s.taper / 160));
    branch(nx, ny, len * .69, angle + spread, depth - 1, weight * (1 - s.taper / 160));
  }
  for (const item of brush.primitives) {
    p.push();
    if (item.kind !== "branch") p.scale(1, 1 + s.spread / 90);
    p.strokeWeight(item.weight * (1 - s.taper / 180));
    if (item.filled) p.fill(ink); else p.noFill();
    const c = item.coords;
    if (item.kind === "line") p.line(c[0], c[1], c[2], c[3]);
    if (item.kind === "ellipse") p.ellipse(c[0], c[1], c[2], c[3]);
    if (item.kind === "bezier") p.bezier(c[0], c[1], c[2], c[3], c[4], c[5], c[6], c[7]);
    if (item.kind === "triangle") p.triangle(c[0], c[1], c[2], c[3], c[4], c[5]);
    if (item.kind === "branch") branch(c[0], c[1], c[2], c[3], Math.max(1, item.depth), item.weight);
    p.pop();
  }
  p.pop();
}
export function drawBrushPath(p: Painter, brush: BrushRecipe, points: Point[], opacity = 1) {
  if (!points.length) return;
  if (points.length === 1) { stamp(p, brush, points[0].x, points[0].y, 0, 0, opacity); return; }
  let accumulated = 0, nextStamp = 0, seed = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], distance = Math.hypot(b.x - a.x, b.y - a.y);
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    if (distance === 0) continue;
    while (nextStamp <= accumulated + distance) {
      const t = (nextStamp - accumulated) / distance;
      stamp(p, brush, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, angle, seed++, opacity);
      nextStamp += brush.settings.spacing;
      if (seed > 5000) return;
    }
    accumulated += distance;
  }
}
export function brushCode(brush: BrushRecipe) {
  return `// ${brush.name} — p5.js instance mode\n// Drag to draw; the recipe and every parameter are editable.\nconst brush = ${JSON.stringify(brush, null, 2)};\n${stamp.toString()}\nlet last = null;\np.setup = () => { p.createCanvas(900,600); p.background('#fffefa'); };\np.draw = () => {\n  if (!p.mouseIsPressed) { last = null; return; }\n  if (!last) last = {x:p.mouseX, y:p.mouseY};\n  const d = p.dist(last.x,last.y,p.mouseX,p.mouseY);\n  if (d >= brush.settings.spacing) {\n    stamp(p,brush,p.mouseX,p.mouseY,Math.atan2(p.mouseY-last.y,p.mouseX-last.x),p.frameCount);\n    last = {x:p.mouseX,y:p.mouseY};\n  }\n};`;
}
