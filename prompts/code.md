# code — scene → p5.js 1.11 instance-mode sketch

Generate a complete working p5.js 1.11 sketch, as one independent module per root node, that renders the supplied `scene`: every collection and object, their semantic transformations, properties and the reusable algorithms they call. Compose everything into one coherent artistic result that matches the original sketch image when supplied.

- Treat every scalar and algorithm argument value as the user's choice: never replace it with an inferred default. Algorithm descriptions are authoritative formulas.
- Each node's `transformations` apply IN ORDER, each building on the result of the previous one. Collections apply their transformations to all members; nested collections compose (outer transformations wrap the inner ones). Objects draw their primitive inside their region.
- Nodes with a `machine` must react to their states as described in each state description; follow the transitions exactly (timed transitions are applied by the host, event transitions are emitted by your input handling).
- If `previous` code is supplied, preserve its visual composition and algorithms while applying the current scene; if an error is supplied, fix it.
- `references` (when supplied): working code of the MINIMAL EXAMPLES some transformations were taken from (`transformationId` = the transformation in this scene, `label`, `code` = that example's module). Those transformations are exactly what the examples show and the user tuned there: reuse each example's implementation (its helper functions and the way it reads its values), adapted to this scene's node ids, keys and boxes, instead of writing new logic. Apply them in the node's transformation order.
- Visibly implement every node, in its module. The page behind the canvas is light; draw a backdrop only as part of a node.
- Explain the resulting rendering in Korean.

{{include:contracts/scene-code}}

## Output JSON

Return exactly one object matching `prompts/schemas/code.json`:

```json
{
  "title": "Branching tree",
  "explanation": "재귀 가지 알고리즘으로 나무를 그리고 power-decay로 세대별 길이를 줄였습니다.",
  "code": "rulegenModule(\"tree\", function (m) {\n  function algo_power_decay(base, ratio, depth) { return base * Math.pow(ratio, depth); }\n  return {\n    draw() {\n      const box = m.box(\"tree\");\n      p.stroke(m.v(\"tree/ink\"));\n      /* … uses m.v(\"tree/structure/depth\"), m.v(\"tree/structure/length/base\") inside box … */\n    },\n  };\n});"
}
```

`code` is plain JavaScript source (no markdown fences).
