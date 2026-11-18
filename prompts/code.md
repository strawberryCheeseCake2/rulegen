# code — scene → p5.js 1.11 instance-mode sketch

Generate a complete working p5.js 1.11 sketch, as one independent module per root node, that renders the supplied `scene`: every collection and object, their constraints and params. Compose everything into one coherent artistic result that looks as close as possible to the original sketch image when supplied: the same density and how it varies, spacing, line weights, contrast, irregularity and texture, not only the same motif.

- Treat every param value as the user's choice: never replace it with an inferred default. Constraint descriptions are authoritative: implement the technique they describe faithfully and robustly (enough resolution, steps and samples that the result reads like the image, within the frame budget), not a cheap stand-in.
- Each node's constraints are evaluated IN ITS CURRENT STATE'S ORDER (declared order for a node without a machine), each computing its `property` and building on the properties computed before it. Collections' constraints determine their members' group properties (how many, where each goes, how they vary); nested collections compose (outer properties place the inner ones). Objects draw their primitive inside their region from the properties their constraints computed.
- Nodes with a `machine` must behave in each state as its description says, through the constraints that state lists; dispatch each transition's `event` exactly when its condition happens (an input, a contact, a completion), so the declared transitions are taken.
- If `previous` code is supplied, preserve its visual composition and techniques while applying the current scene; if an error is supplied, fix it.
- If `confirmedRevisionSummary` and `annotations` are supplied, the coral freehand strokes over the supplied generated image are user feedback describing desired changes, not part of the result. Implement the confirmed changes and their region-specific requests following the text clarification in `instruction`; do not copy the coral feedback layer.
- Visibly implement every node, in its module. The page behind the canvas is light; draw a backdrop only as part of a node.
- Explain the resulting rendering in English.

{{include:contracts/scene-code}}

## Output JSON

Return exactly one object matching `prompts/schemas/code.json`:

```json
{
  "title": "Branching tree",
  "explanation": "Draws the tree by recursive branching and shortens each generation's length by the decay ratio.",
  "code": "rulegenModule(\"tree\", function (m) {\n  function decayed(base, ratio, depth) { return base * Math.pow(ratio, depth); }\n  function computeBranches(owner, box) { /* … uses m.v(\"tree/depth\"), m.v(\"tree/base-length\"), m.v(\"tree/decay\") inside box, returns the branch segments … */ }\n  function computeColor(owner) { return m.v(\"tree/ink\"); }\n  return {\n    draw() {\n      const p = m.p, box = m.box(\"tree\");\n      if (!box.visible) return;\n      const data = m.fsm(\"tree\").evaluate(box);\n      p.stroke(data.color);\n      /* … draws data.branches … */\n    },\n    constraints: { tree: { branches: computeBranches, color: computeColor } },\n  };\n});"
}
```

`code` is plain JavaScript source (no markdown fences).
