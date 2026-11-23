// The Dice page's distribution chart: the chance of each total, as bars for the roll asked for
// and, when it's replaced with fewer dice, an outline for the replacement. A total from one bar
// per total up to one bar per range of totals, so bars are never narrower than MIN_BAR pixels.
// The outline has its own ranges, a whole number of the replacement's steps (4d6×2 only makes
// even totals), and both show the chance per total in their ranges, so they compare fairly. Rolling highlights
// the total's bar. Exposed to the page as DiceChart.draw(container, series) and
// DiceChart.highlight(total), and DiceChart.clear(container) when there's no roll.

import { distribution, highest, lowest, moments, probabilityBetween } from "./distribution.js";

const MIN_BAR = 5; // px, including the gap
const HEIGHT = 120; // px, of the bars' area
const AXIS = 22; // px, below it for the totals
const COLOURS = { bars: "#2a78d6", highlight: "#184f95", line: "#eb6834", lineHighlight: "#b8431a" };
const SVG = "http://www.w3.org/2000/svg";

function svg(tag, attributes = {}) {
  const el = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attributes)) el.setAttribute(key, value);
  return el;
}

const percent = (p) => (p === 0 ? "0%" : p < 0.0005 ? "<0.1%" : `${(p * 100).toFixed(1)}%`);

// a round step for about `count` ticks across `span`
function tickStep(span, count) {
  const raw = span / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((m) => m * power).find((s) => s >= raw);
}

let state = null; // { container, series, total }

// series: [{ label, roll: { groups, c, rule } }], the roll asked for first, then any replacement
function draw(container, series) {
  state = { container, series: series.map((s) => ({ ...s, dist: distribution(s.roll) })), total: null };
  render();
}

function highlight(total) {
  if (!state) return;
  state.total = total;
  render();
}

function render() {
  const { container, series, total } = state;
  const width = container.clientWidth;
  if (width === 0) return;
  const dists = series.map((s) => s.dist);

  // the totals shown: everything within 3.5 standard deviations of the roll asked for's mean
  const { mean, sd } = moments(dists[0]);
  const lo = Math.max(lowest(dists[0]), Math.floor(mean - 3.5 * sd));
  const hi = Math.min(highest(dists[0]), Math.ceil(mean + 3.5 * sd));
  // the bars: one per total, or per range of totals when they'd be narrower than MIN_BAR
  const maxBins = Math.max(1, Math.floor(width / MIN_BAR));
  const binSize = Math.ceil((hi - lo + 1) / maxBins);
  const start = binSize === 1 ? lo : Math.floor(lo / binSize) * binSize;
  const bins = Math.floor((hi - start) / binSize) + 1;
  const binWidth = width / bins;
  const edge = (t) => ((t - start) / (bins * binSize)) * width; // the left edge of total t
  const xOf = (t) => edge(t + 0.5);
  const binOf = (t) => Math.floor((t - start) / binSize);
  // the chance per total of each bar
  const density = Array.from({ length: bins }, (_, b) => probabilityBetween(dists[0], start + b * binSize, start + (b + 1) * binSize - 1) / binSize);
  // The replacement's outline has its own ranges, at least as wide as the bars' and a whole
  // number of its steps, starting at its totals, so they always hold the same number of them.
  // Each range is drawn centred on the totals it holds: 1d6×2 + 7 makes only odd totals, so its
  // range 9–10 is drawn from 8½ to 10½, over the bar for 9.
  let outline = [];
  if (dists.length > 1) {
    const { lo: first, step } = dists[1];
    const size = step * Math.ceil(binSize / step);
    const shift = 0.5 - step / 2;
    for (let from = first + Math.floor((start - first) / size) * size; from <= hi; from += size) {
      const density = probabilityBetween(dists[1], from, from + size - 1) / size;
      outline.push({ from: from + shift, to: from + size + shift, density });
    }
  }
  const top = Math.max(...density, ...outline.map((o) => o.density));
  const height = (d) => (d / top) * HEIGHT;

  const chart = svg("svg", { width, height: HEIGHT + AXIS, viewBox: `0 0 ${width} ${HEIGHT + AXIS}`, role: "img" });
  chart.setAttribute("aria-label", `Chances of each total from ${lo} to ${hi}`);
  const hover = svg("rect", { y: 0, height: HEIGHT, width: binWidth, fill: "#000", "fill-opacity": 0.06, visibility: "hidden" });
  chart.append(hover);

  // the bars, with a gap between them when there's room, and rounded tops
  const gap = binWidth >= 6 ? 2 : binWidth >= 3 ? 1 : 0;
  // a rolled total darkens its bar, or, when it was the replacement that was rolled, fills its
  // range of the outline (drawn thicker and darker) instead
  const rolled = total === null || dists.length > 1 ? -1 : binOf(total);
  for (let b = 0; b < bins; b++) {
    const h = height(density[b]);
    if (h < 0.5) continue;
    const x = b * binWidth + gap / 2, w = binWidth - gap, r = Math.min(3, w / 2, h);
    const y = HEIGHT - h;
    chart.append(svg("path", {
      d: `M${x},${HEIGHT}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${HEIGHT}Z`,
      fill: b === rolled ? COLOURS.highlight : COLOURS.bars,
    }));
  }
  // the replacement's outline, stepping along the tops of its ranges (clipped to the chart)
  if (outline.length > 0) {
    const clip = (x) => Math.min(width, Math.max(0, x));
    let d = `M${clip(edge(outline[0].from))},${HEIGHT}`;
    let highlighted = null;
    for (const o of outline) {
      d += `V${HEIGHT - height(o.density)}H${clip(edge(o.to))}`;
      if (total !== null && total + 0.5 > o.from && total + 0.5 <= o.to) {
        const x = clip(edge(o.from)), h = height(o.density);
        highlighted = svg("path", { d: `M${x},${HEIGHT}V${HEIGHT - h}H${clip(edge(o.to))}V${HEIGHT}`, fill: "none", stroke: COLOURS.lineHighlight, "stroke-width": 4, "stroke-linejoin": "round" });
      }
    }
    chart.append(svg("path", { d: d + `V${HEIGHT}`, fill: "none", stroke: COLOURS.line, "stroke-width": 2, "stroke-linejoin": "round" }));
    if (highlighted) chart.append(highlighted);
  }
  // the rolled total, marked by a line as well, in case its bar is too short to see
  if (total !== null && total >= start && binOf(total) < bins) {
    const x = xOf(total);
    chart.append(svg("line", { x1: x, x2: x, y1: 0, y2: HEIGHT, stroke: "#52514e", "stroke-width": 1, "stroke-dasharray": "3 3" }));
  }
  // the baseline, and round totals beneath it
  chart.append(svg("line", { x1: 0, x2: width, y1: HEIGHT + 0.5, y2: HEIGHT + 0.5, stroke: "#bbb" }));
  const every = Math.max(tickStep(hi - lo, Math.max(2, Math.floor(width / 70))), 1);
  for (let t = Math.ceil(lo / every) * every; t <= hi; t += every) {
    const x = xOf(t);
    const label = svg("text", { x, y: HEIGHT + 16, "text-anchor": x < 12 ? "start" : x > width - 12 ? "end" : "middle", "font-size": 12, fill: "#52514e" });
    label.textContent = t.toLocaleString("en-GB");
    chart.append(svg("line", { x1: x, x2: x, y1: HEIGHT, y2: HEIGHT + 4, stroke: "#bbb" }), label);
  }

  // hovering over (or tapping) a bar shows its chances
  const tip = document.createElement("div");
  tip.className = "chart-tip";
  tip.hidden = true;
  const showTip = (event) => {
    const box = chart.getBoundingClientRect();
    const b = Math.min(bins - 1, Math.max(0, Math.floor((event.clientX - box.left) / binWidth)));
    const from = start + b * binSize, to = from + binSize - 1;
    const range = binSize === 1 ? from.toLocaleString("en-GB") : `${from.toLocaleString("en-GB")}–${to.toLocaleString("en-GB")}`;
    tip.replaceChildren(Object.assign(document.createElement("b"), { textContent: range }));
    series.forEach((s, i) => {
      const line = document.createElement("div");
      line.append(swatch(i), `${series.length > 1 ? `${s.label}: ` : ""}${percent(probabilityBetween(s.dist, from, to))}`);
      tip.append(line);
    });
    tip.hidden = false;
    hover.setAttribute("x", b * binWidth);
    hover.setAttribute("visibility", "visible");
    const x = (b + 0.5) * binWidth;
    tip.style.left = `${Math.min(Math.max(x - tip.offsetWidth / 2, 0), width - tip.offsetWidth)}px`;
  };
  chart.addEventListener("pointermove", showTip);
  chart.addEventListener("pointerdown", showTip);
  chart.addEventListener("pointerleave", () => {
    tip.hidden = true;
    hover.setAttribute("visibility", "hidden");
  });

  const parts = [];
  // a legend when there are two rolls
  if (series.length > 1) {
    const legend = document.createElement("div");
    legend.className = "chart-legend";
    series.forEach((s, i) => {
      const item = document.createElement("span");
      item.append(swatch(i), s.label);
      legend.append(item);
    });
    parts.push(legend);
  }
  const plot = document.createElement("div");
  plot.className = "chart-plot";
  plot.append(chart, tip);
  parts.push(plot);
  // where the rolled total falls among the replacement's (or else the roll's) totals
  if (total !== null) {
    const dist = dists.at(-1);
    const below = probabilityBetween(dist, -Infinity, total - 1), above = probabilityBetween(dist, total + 1, Infinity);
    const note = document.createElement("div");
    note.className = "chart-note";
    note.textContent = `${total.toLocaleString("en-GB")} is higher than ${percent(below)} of rolls and lower than ${percent(above)}.`;
    // the × clears the roll, which the page does when the container gets a "clearroll" event
    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.className = "dismiss";
    dismiss.textContent = "×";
    dismiss.title = "Clear this roll";
    dismiss.setAttribute("aria-label", "Clear this roll");
    dismiss.addEventListener("click", () => container.dispatchEvent(new Event("clearroll")));
    note.append(dismiss);
    parts.push(note);
  }
  container.replaceChildren(...parts);
}

// the key for a series: a square for the bars, a line for the outline
function swatch(i) {
  const span = document.createElement("span");
  span.className = i === 0 ? "swatch bars" : "swatch line";
  return span;
}

window.addEventListener("resize", () => state && render());

function clear(container) {
  state = null;
  container.replaceChildren();
}

globalThis.DiceChart = { draw, highlight, clear };
