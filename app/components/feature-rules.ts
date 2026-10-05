// Mock recipes are grouped by their source feature. Each alternative keeps its own edits.
export const featureRuleSets = [
  [
    ["Split each branch into two smaller branches. Repeat for 6 generations.", "Reduce branch length to 70% of its parent and vary the split angle from 22° to 32°.", "Draw the child branches from each parent’s endpoint to form a connected tree."],
    ["Grow a main stem and add alternating side branches at regular intervals.", "Let each side branch split once more, using a shorter length at each level.", "Limit the recursion to 4 generations for a sparse, readable structure."],
  ],
  [
    ["Give the left and right branches independent angles instead of mirroring them.", "Vary each segment’s length by up to 18% using a repeatable random seed.", "Bend each branch slightly so the silhouette feels naturally uneven."],
    ["Bias one side of the tree toward longer branches for an off-center silhouette.", "Skip an occasional offshoot and vary its attachment point along the stem.", "Keep the main trunk steady while the smaller branches wander."],
  ],
  [
    ["Start each branch with a stroke width proportional to its parent’s thickness.", "Reduce the width toward each branch tip until it reaches a fine endpoint.", "Use rounded caps and a subtle pencil texture to soften the thin strokes."],
    ["Divide each branch into short segments and decrease width at every segment.", "Use a pressure curve that stays thick at the root and narrows sharply at the tip.", "Fade the final 15% of each stroke to give it a soft finish."],
  ],
  [
    ["Build a palette from muted brown, warm ochre, and pale beige.", "Assign neighboring branches slightly different shades within the same palette.", "Keep saturation low and use an ivory background to preserve the warm tone."],
    ["Use one earthy brown as the base ink and mix in a little warm gray.", "Shift smaller branches toward a lighter shade of the same base color.", "Layer translucent marks to create natural tonal depth."],
  ],
  [
    ["Orient the main stem upward and bias child branches toward the top of the canvas.", "Limit branch angles so each new segment retains a positive upward direction.", "Let the height increase faster than the width to keep a growing silhouette."],
    ["Use an upward attraction vector to gently steer every new segment.", "Blend the parent direction with the attraction vector at each generation.", "Allow side branches to curve back upward as they approach their tips."],
  ],
  [
    ["Leave a minimum gap between neighboring branches rather than filling every region.", "Reduce the number of offshoots in crowded areas to preserve open spaces.", "Keep the background unfilled and let the silhouette define the empty regions."],
    ["Reserve a few clear regions around the main stem before placing branches.", "Skip branches that would cross a reserved region or another branch.", "Use fewer, longer strokes to leave larger pockets of negative space."],
  ],
];
export function createRuleDrafts() { return featureRuleSets.map(variants => variants.map(rules => [...rules])); }
