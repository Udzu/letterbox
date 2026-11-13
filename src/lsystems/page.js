import { EXAMPLES, HEADINGS, MAX_SYMBOLS, bounds, clean, expand, parseAngle, parseRules, pathData, trace } from "./lsystem.js";

const STORAGE_KEY = "lsystem-attempts";
const CURRENT_KEY = "lsystem-current"; // what was last drawn, to show again next time
const MARGIN = 12; // CSS pixels around the drawing

const $ = (id) => document.getElementById(id);
const nameBox = $("name");
const angleBox = $("angle");
const headingBox = $("heading");
const axiomBox = $("axiom");
const iterationsBox = $("iterations");
const rulesBox = $("rules");
const message = $("message");
const canvas = $("canvas");
const attemptsList = $("attempts");

const storage = {
  get(key) {
    try {
      return JSON.parse(localStorage.getItem(key));
    } catch (e) {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {}
  },
};

function say(text, error = false) {
  message.textContent = text;
  message.classList.toggle("error", error);
}

// ---- rule rows

function addRuleRow({ symbol = "", output = "", weight = "" } = {}, focus = false) {
  const row = document.createElement("div");
  row.className = "rule";
  row.innerHTML = `<input class="symbol mono" type="text" aria-label="Symbol" autocomplete="off" autocapitalize="off" spellcheck="false">
    <span class="arrow">→</span>
    <input class="output mono" type="text" aria-label="Output" autocomplete="off" autocapitalize="off" spellcheck="false">
    <input class="weight" type="text" inputmode="decimal" aria-label="Weight" placeholder="1" autocomplete="off">
    <button type="button" class="remove" title="Remove rule" aria-label="Remove rule">×</button>`;
  row.querySelector(".symbol").value = symbol;
  row.querySelector(".output").value = output;
  row.querySelector(".weight").value = weight;
  row.querySelector(".remove").addEventListener("click", () => {
    row.remove();
    if (!rulesBox.children.length) addRuleRow();
  });
  rulesBox.appendChild(row);
  if (focus) row.querySelector(".symbol").focus();
}

const ruleRows = () =>
  [...rulesBox.children].map((row) => ({
    symbol: row.querySelector(".symbol").value,
    output: row.querySelector(".output").value,
    weight: row.querySelector(".weight").value,
  }));

// ---- the form as a whole

function readForm() {
  return {
    name: nameBox.value.trim(),
    angle: angleBox.value.trim(),
    heading: headingBox.value,
    axiom: axiomBox.value,
    iterations: iterationsBox.value === "" ? "" : Number(iterationsBox.value),
    rules: ruleRows().filter((r) => r.symbol.trim() || r.output.trim() || r.weight.trim()),
  };
}

function fillForm(system) {
  nameBox.value = system.name ?? "";
  angleBox.value = system.angle ?? "4";
  headingBox.value = system.heading in HEADINGS ? system.heading : "right";
  axiomBox.value = system.axiom ?? "";
  iterationsBox.value = system.iterations ?? 4;
  rulesBox.innerHTML = "";
  for (const rule of system.rules ?? []) addRuleRow(rule);
  if (!rulesBox.children.length) addRuleRow();
  showDegrees();
}

function showDegrees() {
  const n = parseAngle(angleBox.value);
  $("degrees").textContent = n ? `= ${+(360 / n).toFixed(3)}°` : "";
}

// ---- drawing

let drawn = null; // { string, divisions, heading } of the current drawing, kept for redrawing on resize
let layout = null; // { width, height, scale, offsetX, offsetY, lineWidth } as last drawn, for the SVG

function draw() {
  const form = readForm();
  const divisions = parseAngle(form.angle);
  const { rules, errors } = parseRules(form.rules);
  if (!divisions) errors.unshift("The angle should be a positive number (4 means 90°).");
  if (!Number.isInteger(form.iterations) || form.iterations < 0) errors.push("The iterations should be a whole number.");
  if (errors.length) {
    say(errors.join(" "), true);
    return;
  }
  storage.set(CURRENT_KEY, form);
  const { result, iterations } = expand(clean(form.axiom), rules, form.iterations);
  drawn = { string: result, divisions, heading: HEADINGS[form.heading] };
  const lines = render();
  const count = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;
  const parts = [count([...result].length, "symbol"), count(lines, "line")];
  if (iterations < form.iterations) {
    say(`Stopped after ${count(iterations, "iteration")}, as the next would have over ${(MAX_SYMBOLS / 1e6).toLocaleString()} million symbols: ${parts.join(", ")}.`, true);
  } else if (!lines) {
    say(`Nothing to draw (${count([...result].length, "symbol")}, but no F).`);
  } else {
    say(`${parts.join(", ")}.`);
  }
  highlightCurrent();
}

// Size the canvas to its box, then draw the current string scaled to fit. Returns the number of lines.
function render() {
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.parentElement.clientWidth;
  const height = Math.max(200, Math.min(width, window.innerHeight - 32));
  canvas.style.height = `${height}px`;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  layout = null;
  if (!drawn) return 0;
  const { string, divisions, heading } = drawn;
  const box = bounds(string, divisions, heading);
  if (!box) return 0;

  // scale to fit inside the margins (a straight line has no width or no height), and centre
  const w = box.maxX - box.minX;
  const h = box.maxY - box.minY;
  const room = (size) => Math.max(1, size - 2 * MARGIN);
  const scale = Math.min(w ? room(width) / w : Infinity, h ? room(height) / h : Infinity);
  const offsetX = width / 2 - ((box.minX + box.maxX) / 2) * scale;
  const offsetY = height / 2 - ((box.minY + box.maxY) / 2) * scale;
  const lineWidth = Math.min(2, Math.max(0.75, scale / 8));
  layout = { width, height, scale, offsetX, offsetY, lineWidth };

  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.strokeStyle = "#000";
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  // stroke in batches, as very long paths are slow; lines that follow on from the last one join up
  let pending = 0;
  let lastX = Infinity; // so the first line starts with a moveTo
  let lastY = Infinity;
  ctx.beginPath();
  trace(string, divisions, heading, (x1, y1, x2, y2) => {
    const sx = offsetX + x1 * scale;
    const sy = offsetY + y1 * scale;
    if (Math.abs(sx - lastX) > 0.01 || Math.abs(sy - lastY) > 0.01) ctx.moveTo(sx, sy);
    lastX = offsetX + x2 * scale;
    lastY = offsetY + y2 * scale;
    ctx.lineTo(lastX, lastY);
    if (++pending === 20000) {
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(lastX, lastY);
      pending = 0;
    }
  });
  ctx.stroke();
  return box.lines;
}

let resizeTimer = null;
let lastWidth = 0;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    // phones resize when the toolbar shows or hides; only redraw when the width changes
    if (canvas.parentElement.clientWidth === lastWidth) return;
    lastWidth = canvas.parentElement.clientWidth;
    render();
  }, 150);
});

function save(blob, extension) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${nameBox.value.trim() || "l-system"}.${extension}`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

$("download").addEventListener("click", () => {
  if (drawn) canvas.toBlob((blob) => save(blob, "png"));
});

// the same picture as the canvas, at its size in CSS pixels
$("download-svg").addEventListener("click", () => {
  if (!drawn || !layout) return;
  const { width, height, lineWidth } = layout;
  const d = pathData(drawn.string, drawn.divisions, drawn.heading, layout);
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect width="100%" height="100%" fill="#fff"/>`,
    `<path fill="none" stroke="#000" stroke-width="${+lineWidth.toFixed(4)}" stroke-linecap="round" stroke-linejoin="round" d="${d}"/>`,
    `</svg>\n`,
  ];
  save(new Blob([svg.join("\n")], { type: "image/svg+xml" }), "svg");
});

// ---- attempts, saved in the browser's local storage where available; starts with the examples

let attempts = storage.get(STORAGE_KEY);
if (!Array.isArray(attempts)) attempts = structuredClone(EXAMPLES);

const summary = (a) =>
  [`÷${a.angle}`, clean(a.axiom) || "(empty)", ...a.rules.map((r) => `${r.symbol.trim()}→${clean(r.output) || "(empty)"}${r.weight.trim() ? ` (${r.weight.trim()})` : ""}`)].join("  ");

function highlightCurrent() {
  const name = nameBox.value.trim();
  [...attemptsList.children].forEach((li, i) => li.classList.toggle("current", attempts[i]?.name === name));
}

function renderAttempts() {
  attemptsList.innerHTML = "";
  attempts.forEach((attempt, i) => {
    const li = document.createElement("li");
    const text = document.createElement("span");
    text.className = "text";
    text.textContent = attempt.name;
    const detail = document.createElement("span");
    detail.className = "summary";
    detail.textContent = summary(attempt);
    text.appendChild(detail);
    text.addEventListener("click", () => {
      fillForm(attempt);
      draw();
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove";
    remove.title = "Remove";
    remove.ariaLabel = `Remove ${attempt.name}`;
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      attempts.splice(i, 1);
      storage.set(STORAGE_KEY, attempts);
      renderAttempts();
    });
    li.append(text, remove);
    attemptsList.appendChild(li);
  });
  highlightCurrent();
}

// saving under an existing name replaces that attempt
$("save").addEventListener("click", () => {
  const form = readForm();
  if (!form.name) {
    say("Give it a name to save it.", true);
    nameBox.focus();
    return;
  }
  const i = attempts.findIndex((a) => a.name === form.name);
  if (i === -1) attempts.push(form);
  else attempts[i] = form;
  storage.set(STORAGE_KEY, attempts);
  renderAttempts();
  say(i === -1 ? `Saved ${form.name}.` : `Updated ${form.name}.`);
});

$("examples").addEventListener("click", () => {
  const names = new Set(attempts.map((a) => a.name));
  const missing = EXAMPLES.filter((e) => !names.has(e.name));
  if (!missing.length) return say("The examples are all in the list already.");
  attempts.push(...structuredClone(missing));
  storage.set(STORAGE_KEY, attempts);
  renderAttempts();
});

$("clear").addEventListener("click", () => {
  if (attempts.length === 0 || !confirm("Clear all attempts?")) return;
  attempts = [];
  storage.set(STORAGE_KEY, attempts);
  renderAttempts();
});

// ---- wiring

$("draw").addEventListener("click", draw);
$("add-rule").addEventListener("click", () => addRuleRow({}, true));
angleBox.addEventListener("input", showDegrees);
angleBox.addEventListener("change", draw); // e.g. the spinner arrows
iterationsBox.addEventListener("change", draw); // e.g. the spinner arrows
headingBox.addEventListener("change", draw);
nameBox.addEventListener("input", highlightCurrent);
$("controls").addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || e.target.tagName !== "INPUT") return;
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) $("save").click();
  else draw();
});

renderAttempts();
fillForm(storage.get(CURRENT_KEY) || attempts[0] || EXAMPLES[0]);
lastWidth = canvas.parentElement.clientWidth;
draw();
