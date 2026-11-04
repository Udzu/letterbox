// Turning NFAs into things people can look at.

import { formatChar, formatClass } from "./parser.js";

// Short pattern syntax for an edge label: a, [abc], [a-z], [^a], or "." for anything.
// Uses the negated form when it needs fewer ranges.
export function formatLabel(set) {
  if (set.isAll()) return ".";
  if (set.size() === 1) return formatChar(set.ranges[0][0]);
  const complement = set.complement();
  return complement.ranges.length < set.ranges.length
    ? formatClass({ negated: true, ranges: classRanges(complement) })
    : formatClass({ negated: false, ranges: classRanges(set) });
}

// write two-character ranges as two characters, since a-b is no shorter than ab
function classRanges(set) {
  return set.ranges.flatMap(([lo, hi]) => (hi === lo + 1 ? [[lo, lo], [hi, hi]] : [[lo, hi]]));
}

// Long labels (such as \p{L}, which has hundreds of ranges) are cut short so the diagram
// stays readable, with the full label as a tooltip. A cut never splits an escape like \u{a0}.
const MAX_LABEL = 24;
export function shortLabel(label) {
  if ([...label].length <= MAX_LABEL) return label;
  // escapes and single characters, so whole ones can be kept
  const tokens = label.match(/\\u\{[0-9a-f]+\}|\\.|./gsu);
  let head = "";
  for (const token of tokens) {
    if ([...head].length + [...token].length > MAX_LABEL - 2) break;
    head += token;
  }
  return `${head}…${label.endsWith("]") ? "]" : ""}`;
}

// Graphviz DOT source. ε-moves are dashed; accepting states are double circles.
export function toDot(nfa, { dark = false } = {}) {
  const fg = dark ? "#ddd" : "#222";
  const quote = (s) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  const lines = [
    "digraph {",
    `  rankdir=LR; bgcolor="transparent";`,
    `  node [shape=circle, label="", width=0.25, fixedsize=true, color=${quote(fg)}];`,
    `  edge [color=${quote(fg)}, fontcolor=${quote(fg)}, fontname="Helvetica", fontsize=12, arrowsize=0.7];`,
    "  start [shape=point, style=invis];",
    `  start -> ${nfa.start};`,
  ];
  for (let s = 0; s < nfa.size; s++) {
    lines.push(`  ${s}${nfa.accepting.has(s) ? " [shape=doublecircle, width=0.2]" : ""};`);
  }
  nfa.edges.forEach((es, s) => {
    for (const { label, to } of es) {
      let attrs = `label="ε", style=dashed`;
      if (label !== null) {
        const full = formatLabel(label);
        const short = shortLabel(full);
        attrs = `label=${quote(short)}${short === full ? "" : `, tooltip=${quote(full)}`}`;
      }
      lines.push(`  ${s} -> ${to} [${attrs}];`);
    }
  });
  lines.push("}");
  return lines.join("\n");
}
