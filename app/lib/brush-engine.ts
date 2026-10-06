import type P5 from "p5";
import type { BrushRecipe, Point } from "./schema";
type Painter = P5 | P5.Graphics;
export function stamp(p: Painter, brush: BrushRecipe, x: number, y: number, angle: number, seed: number, opacity = 1, scale = 1) {
  const s = brush.settings;
  const jitter = Math.sin(seed * 12.9898) * s.variation / 100;
  const ink = p.color(s.color); ink.setAlpha(opacity * 255);
  p.push(); p.translate(x, y); p.rotate(angle + jitter * .7); p.scale(s.size * scale * (1 + jitter * .35));
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
export function drawBrushPath(p: Painter, brush: BrushRecipe, points: Point[], opacity = 1, engine = { stamp }) {
  if (!points.length) return;
  if (points.length === 1) { engine.stamp(p, brush, points[0].x, points[0].y, 0, 0, opacity); return; }
  let accumulated = 0, nextStamp = 0, seed = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], distance = Math.hypot(b.x - a.x, b.y - a.y);
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    if (distance === 0) continue;
    while (nextStamp <= accumulated + distance) {
      const t = (nextStamp - accumulated) / distance;
      engine.stamp(p, brush, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, angle, seed++, opacity);
      nextStamp += brush.settings.spacing;
      if (seed > 5000) return;
    }
    accumulated += distance;
  }
}
export function brushCode(brush: BrushRecipe) {
  return `// ${brush.name} — p5.js instance mode\n// Drag to draw. Each completed stroke keeps its own path.\nconst brush = ${JSON.stringify(brush, null, 2)};\nconst __name = (fn) => fn;\nconst stamp = ${stamp.toString()};\nconst drawBrushPath = ${drawBrushPath.toString()};\nconst strokes = []; let path = null;\np.setup = () => { p.createCanvas(900,600); };\np.draw = () => {\n  p.background('#fffefa');\n  if (p.mouseIsPressed && p.mouseX >= 0 && p.mouseX <= 900 && p.mouseY >= 0 && p.mouseY <= 600) {\n    if (!path && strokes.length < 500) { path = []; strokes.push(path); }\n    if (path && path.length < 6000) path.push({x:p.mouseX,y:p.mouseY});\n  } else path = null;\n  for (const points of strokes) drawBrushPath(p,brush,points,1,{stamp});\n};`;
}
