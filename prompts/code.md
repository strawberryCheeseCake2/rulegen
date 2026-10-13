# code — scene → p5.js 1.11 instance-mode sketch

Generate a complete working p5.js 1.11 instance-mode sketch that renders the supplied `scene`: every collection and object, their semantic transformations, properties and the reusable algorithms they call. Compose everything into one coherent artistic result that matches the original sketch image when supplied.

- Treat every scalar and algorithm argument value as the user's choice: never replace it with an inferred default. Algorithm descriptions are authoritative formulas.
- Each node's `transformations` apply IN ORDER, each building on the result of the previous one. Collections apply their transformations to all members; nested collections compose (outer transformations wrap the inner ones). Objects draw their primitive inside their region.
- Nodes with a `machine` must react to their states as described in each state description; follow the transitions exactly (timed transitions are applied by the host, event transitions are emitted by your input handling).
- If `previous` code is supplied, preserve its visual composition and algorithms while applying the current scene; if an error is supplied, fix it.
- If `confirmedRevisionSummary` and `annotations` are supplied, the coral freehand strokes over the supplied generated image are user feedback describing desired changes, not part of the result. Implement the confirmed changes and their region-specific requests following the text clarification in `instruction`; do not copy the coral feedback layer.
- Use a light background and visibly implement every node.
- Explain the resulting rendering in Korean.

{{include:contracts/scene-code}}

## Output JSON

Return exactly one object matching `prompts/schemas/code.json`:

```json
{
  "title": "Branching tree",
  "explanation": "재귀 가지 알고리즘으로 나무를 그리고 power-decay로 세대별 길이를 줄였습니다.",
  "code": "function algo_power_decay(base, ratio, depth) { return base * Math.pow(ratio, depth); }\np.setup = () => {\n  p.createCanvas(900, 600);\n  p.noLoop();\n};\np.draw = () => {\n  p.background(250);\n  p.stroke(rulegenParams[\"tree/ink\"]);\n  /* … uses rulegenParams[\"tree/structure/depth\"], rulegenParams[\"tree/structure/length/base\"] … */\n};"
}
```

`code` is plain JavaScript source (no markdown fences).
