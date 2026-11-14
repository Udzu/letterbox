import { ExprError, evaluate, formatValue, parse, textToHTML, toHTML } from "./expr.js";
import { OPS, solveSteps } from "./solver.js";

const SETTINGS_KEY = "numbers-settings";
const HISTORY_KEY = "numbers-history";
const MIN_BOXES = 3, MAX_BOXES = 6;
const BIG = [25, 50, 75, 100];
const DEFAULTS = {
  numbers: [4, 4, 4, 4],
  pool: "digits",
  big: 1,
  rules: { all: false, order: false, integers: false },
  ops: { ...Object.fromEntries(OPS.map((op) => [op, true])), cat: false },
  noOps: false,
  solvable: true,
  timed: false,
  seconds: 30,
};

const $ = (id) => document.getElementById(id);
const boxes = $("boxes");
const bigBox = $("big");
const answerBox = $("answer");
const targetBox = $("target");
const clock = $("clock");
const preview = $("preview");
const bestLine = $("best");
const outcome = $("outcome");
const opBoxes = [...document.querySelectorAll("input[data-op]")];
const settingSets = ["numbers-set", "rules-set", "ops-set"].map($);

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

const pad = (t) => String(t).padStart(3, "0");
const randInt = (n) => Math.floor(Math.random() * n);
const shuffle = (xs) => {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [xs[i], xs[j]] = [xs[j], xs[i]];
  }
  return xs;
};

// ---- settings

for (let i = 0; i <= 4; i++) bigBox.add(new Option(String(i), String(i)));

function addBox(value = "") {
  const box = document.createElement("input");
  Object.assign(box, { type: "number", min: 0, max: 100, step: 1, required: true, value });
  box.setAttribute("aria-label", `Number ${boxes.children.length + 1}`);
  box.addEventListener("input", settingsChanged);
  boxes.appendChild(box);
}

function setBoxes(numbers) {
  boxes.replaceChildren();
  numbers.forEach((n) => addBox(n));
}

// The numbers in the boxes, or null if any is invalid.
function readNumbers() {
  const values = [...boxes.children].map((b) => b.value.trim());
  if (values.some((v) => !/^\d+$/.test(v) || Number(v) > 100)) return null;
  return values.map(Number);
}

function readSettings() {
  const seconds = Number($("seconds").value);
  return {
    numbers: readNumbers(),
    pool: document.querySelector('input[name="pool"]:checked')?.value ?? "digits",
    big: Number(bigBox.value),
    rules: { all: $("rule-all").checked, order: $("rule-order").checked, integers: $("rule-integers").checked },
    // decimals make fractions, so they're off when fractions are
    ops: Object.fromEntries(opBoxes.map((b) => [b.dataset.op, b.checked && !b.disabled])),
    noOps: $("ops-none").checked,
    solvable: $("solvable").checked,
    timed: $("timed").checked,
    seconds: Number.isInteger(seconds) && seconds >= 5 ? seconds : DEFAULTS.seconds,
  };
}

function applySettings(s) {
  setBoxes(s.numbers);
  for (const r of document.querySelectorAll('input[name="pool"]')) r.checked = r.value === s.pool;
  bigBox.value = String(s.big);
  $("rule-all").checked = s.rules.all;
  $("rule-order").checked = s.rules.order;
  $("rule-integers").checked = s.rules.integers;
  for (const b of opBoxes) b.checked = s.ops[b.dataset.op] ?? true;
  $("ops-none").checked = s.noOps;
  $("solvable").checked = s.solvable;
  $("timed").checked = s.timed;
  $("seconds").value = s.seconds;
}

function loadSettings() {
  const saved = storage.get(SETTINGS_KEY) ?? {};
  const s = {
    ...DEFAULTS, ...saved,
    rules: { ...DEFAULTS.rules, ...saved.rules },
    ops: { ...DEFAULTS.ops, ...saved.ops },
  };
  if (!Array.isArray(s.numbers) || s.numbers.length < MIN_BOXES || s.numbers.length > MAX_BOXES) s.numbers = DEFAULTS.numbers;
  return s;
}

// Enable or disable the controls that depend on others.
function updateControls() {
  const count = boxes.children.length;
  $("remove-box").disabled = count <= MIN_BOXES;
  $("add-box").disabled = count >= MAX_BOXES;
  const small = document.querySelector('input[name="pool"]:checked')?.value === "small";
  bigBox.disabled = !small;
  for (let i = 0; i < bigBox.options.length; i++) bigBox.options[i].disabled = i > count;
  if (Number(bigBox.value) > count) bigBox.value = String(Math.min(4, count));
  // None turns every operation off, and No fractions the decimals, keeping their
  // ticks for when they're back on
  const none = $("ops-none").checked;
  const integers = $("rule-integers").checked;
  for (const b of opBoxes) {
    const fractions = integers && (b.dataset.op === "dot" || b.dataset.op === "rec");
    b.disabled = none || fractions;
    b.parentElement.classList.toggle("off", b.disabled);
    b.parentElement.title = fractions && !none ? "Not with No fractions" : b.parentElement.dataset.title ?? b.parentElement.title;
  }
  $("seconds").disabled = !$("timed").checked;
  // grey out the help for operations that aren't allowed
  const ops = readSettings().ops;
  for (const li of document.querySelectorAll(".syntax [data-op]")) li.classList.toggle("off", !ops[li.dataset.op]);
  const valid = readNumbers() !== null;
  $("new-target").disabled = !valid;
  $("solve-all").disabled = !valid;
}

function saveSettings() {
  const s = readSettings();
  if (!s.numbers) s.numbers = storage.get(SETTINGS_KEY)?.numbers ?? DEFAULTS.numbers;
  // remember the ticked operations, including any greyed out
  s.ops = Object.fromEntries(opBoxes.map((b) => [b.dataset.op, b.checked]));
  storage.set(SETTINGS_KEY, s);
}

function settingsChanged() {
  updateControls();
  saveSettings();
  solutionsView.refresh();
  showPreview();
}

function randomNumbers() {
  const count = boxes.children.length;
  const s = readSettings();
  let numbers;
  if (s.pool === "digits") {
    numbers = Array.from({ length: count }, () => randInt(10));
  } else {
    // as in Countdown: big numbers once each, small numbers twice each, without replacement
    const big = shuffle([...BIG]).slice(0, Math.min(s.big, count));
    const small = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]).slice(0, count - big.length);
    numbers = [...big, ...small];
  }
  setBoxes(numbers);
  settingsChanged();
}

// ---- solving (in a Web Worker if possible)

// A solve of one puzzle: its latest solutions, and listeners for updates.
class Job {
  constructor(puzzle) {
    this.key = JSON.stringify(puzzle);
    this.puzzle = puzzle;
    this.solutions = null; // Map target -> text, once the first step is done
    this.exact = false;
    this.done = false;
    this.fraction = 0;
    this.listeners = new Set();
  }

  notify() {
    for (const f of [...this.listeners]) f(this);
  }

  // Call f now and on every update until it returns true.
  watch(f) {
    if (f(this)) return;
    const g = (job) => { if (f(job)) this.listeners.delete(g); };
    this.listeners.add(g);
  }
}

const solver = {
  job: null,
  worker: null,
  noWorker: false,
  nextId: 0,

  // The job for the given puzzle, starting it if needed.
  get(puzzle) {
    const key = JSON.stringify(puzzle);
    if (this.job?.key === key) return this.job;
    this.stop();
    const job = (this.job = new Job(puzzle));
    const id = ++this.nextId;
    const update = (msg) => {
      if (msg.id !== id || this.job !== job) return;
      if (msg.type === "progress") job.fraction = msg.fraction;
      else if (msg.type === "result") {
        job.solutions = new Map(msg.solutions);
        job.exact = msg.exact;
      } else job.done = true;
      job.notify();
    };
    // without workers (e.g. some browsers over file://), solve here, a step at a time
    const solveHere = () => {
      this.worker = null;
      this.noWorker = true;
      const steps = solveSteps(puzzle.numbers, puzzle.rules, puzzle.ops);
      const next = () => {
        if (this.job !== job) return;
        const r = steps.next();
        if (r.done) { update({ id, type: "done" }); return; }
        update({ id, type: "result", solutions: [...r.value.solutions], exact: r.value.exact });
        setTimeout(next, 0);
      };
      setTimeout(next, 50);
    };
    if (this.noWorker) {
      solveHere();
      return job;
    }
    try {
      if (!this.worker) {
        const source = $("solver-worker").textContent;
        this.worker = new Worker(URL.createObjectURL(new Blob([source], { type: "text/javascript" })));
      }
      this.worker.onmessage = ({ data }) => update(data);
      this.worker.onerror = (e) => {
        e.preventDefault();
        this.worker?.terminate();
        if (this.job === job) solveHere();
      };
      this.worker.postMessage({ id, ...puzzle });
    } catch (e) {
      solveHere();
    }
    return job;
  },

  stop() {
    if (this.job && !this.job.done && this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.job = null;
  },
};

function currentPuzzle() {
  const s = readSettings();
  return s.numbers && { numbers: s.numbers, rules: s.rules, ops: s.ops };
}

// ---- the game

let game = null; // { target, puzzle, start, best, timer, deadline, attempts }

function lockSettings(locked) {
  for (const set of settingSets) set.disabled = locked;
  $("ops-none").disabled = locked; // controls in a fieldset's legend aren't disabled with it
  $("new-target").disabled = readNumbers() === null;
  // answers can be tried out any time, but only submitted during a game
  $("try").disabled = $("give-up").disabled = !locked;
}

// Start a game, or replace the current one's target (without recording it).
function newTarget() {
  if (game) {
    clearInterval(game.timer);
    game = null;
  }
  const puzzle = currentPuzzle();
  if (!puzzle) return;
  const s = readSettings();
  const job = solver.get(puzzle); // also used to show a solution at the end
  const begin = (target) => {
    game = { target, puzzle, job, start: Date.now(), best: null, timer: null };
    targetBox.textContent = pad(target);
    targetBox.classList.remove("idle");
    outcome.textContent = "";
    outcome.className = "";
    bestLine.textContent = "";
    answerBox.value = "";
    preview.textContent = "";
    lockSettings(true);
    // on narrow screens the game is below the settings
    if (matchMedia("(max-width: 899px)").matches) $("game-section").scrollIntoView({ behavior: "smooth" });
    answerBox.focus({ preventScroll: true });
    if (s.timed) {
      game.deadline = Date.now() + s.seconds * 1000;
      tick();
      game.timer = setInterval(tick, 200);
    } else clock.textContent = "";
  };
  if (!s.solvable) {
    begin(randInt(1000));
    return;
  }
  $("new-target").disabled = true;
  outcome.className = "";
  job.watch((j) => {
    if (!j.solutions) {
      outcome.textContent = `Finding solvable targets… ${Math.round(j.fraction * 100)}%`;
      return false;
    }
    const targets = [...j.solutions.keys()];
    if (!targets.length) {
      outcome.textContent = "No target can be made with these numbers and rules.";
      updateControls();
    } else begin(targets[randInt(targets.length)]);
    return true;
  });
}

function tick() {
  const left = Math.max(0, game.deadline - Date.now());
  const secs = Math.ceil(left / 1000);
  clock.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
  clock.classList.toggle("low", secs <= 10);
  if (left <= 0) endGame("time");
}

// Parse and evaluate the answer box: { tree, value } or { error }.
function readAnswer() {
  const text = answerBox.value;
  if (!text.trim()) return {};
  let tree;
  try {
    tree = parse(text);
  } catch (e) {
    if (e instanceof ExprError) return { error: e.message };
    throw e;
  }
  try {
    const puzzle = game?.puzzle ?? currentPuzzle();
    if (!puzzle) return { tree, error: "Each number must be a whole number from 0 to 100" };
    return { tree, value: evaluate(tree, puzzle) };
  } catch (e) {
    if (e instanceof ExprError) return { tree, error: e.message };
    throw e;
  }
}

function showPreview() {
  const { tree, value, error } = readAnswer();
  preview.innerHTML = tree ? toHTML(tree) + (value ? ` = ${formatValue(value)}` : "") : "";
  if (error) preview.insertAdjacentHTML("beforeend", `${tree ? " " : ""}<span class="error"></span>`);
  if (error) preview.querySelector(".error").textContent = error;
}

function tryAnswer() {
  if (!game) return;
  const { tree, value, error } = readAnswer();
  if (!tree || error) {
    showPreview();
    return;
  }
  // huge values come back as BigInts
  const n = Number(value[0]), d = Number(value[1]);
  if (d === 1 && n === game.target) {
    game.best = { text: answerBox.value.trim(), value: n };
    endGame("win");
    return;
  }
  if (d !== 1) {
    bestLine.textContent = "Not a whole number.";
    return;
  }
  const off = Math.abs(n - game.target);
  if (!game.best || off < Math.abs(game.best.value - game.target)) {
    game.best = { text: answerBox.value.trim(), value: n };
  }
  bestLine.innerHTML = `Off by ${off}. Best so far: <span class="math">${textToHTML(game.best.text)}</span> = ${game.best.value}`;
}

function endGame(how) {
  const g = game;
  clearInterval(g.timer);
  game = null;
  lockSettings(false);
  updateControls();
  const seconds = Math.round((Date.now() - g.start) / 1000);
  const entry = addHistory({
    id: `${Date.now()}-${randInt(1e9)}`,
    target: g.target,
    won: how === "win",
    answer: g.best?.text ?? null,
    value: g.best?.value ?? null,
    seconds,
    numbers: g.puzzle.numbers,
    rules: g.puzzle.rules,
    ops: g.puzzle.ops,
  });
  outcome.className = how === "win" ? "win" : "";
  const lead = how === "win" ? "Solved!" : how === "time" ? "Time’s up." : "Given up.";
  g.job.watch((job) => {
    let rest;
    if (!job.solutions) rest = "Solving…";
    else if (job.solutions.has(g.target)) {
      rest = `${how === "win" ? "Simplest" : "Solution"}: <span class="math">${textToHTML(job.solutions.get(g.target))}</span>`;
    } else if (job.exact) rest = "It’s impossible.";
    else if (!job.done) rest = "Solving…";
    else rest = "No solution found (the search was limited).";
    outcome.innerHTML = `${lead} ${rest}`;
    const final = job.done || job.solutions?.has(g.target);
    // show the solution in the history too
    if (final && how !== "win") updateHistory(entry.id, { solution: job.solutions.get(g.target) ?? null });
    return final;
  });
  $("new-target").focus();
}

// ---- history

function rulesSummary({ rules, ops }) {
  const parts = [];
  if (rules.all) parts.push("all");
  if (rules.order) parts.push("in order");
  if (rules.integers) parts.push("no fractions");
  const symbols = { concat: "ab", cat: "‖", pow: "^", fact: "!", sqrt: "√", root: "b√", dot: ".", rec: ".~" };
  const on = OPS.filter((op) => ops[op]).map((op) => symbols[op]);
  parts.push(on.length ? on.join(" ") : "+ − × ÷ only");
  return parts.join(" · ");
}

function addHistory(entry) {
  const history = storage.get(HISTORY_KEY) ?? [];
  history.unshift(entry);
  storage.set(HISTORY_KEY, history.slice(0, 500));
  renderHistory(history);
  return entry;
}

function updateHistory(id, changes) {
  const history = storage.get(HISTORY_KEY) ?? [];
  const entry = history.find((h) => h.id === id);
  if (!entry) return;
  Object.assign(entry, changes);
  storage.set(HISTORY_KEY, history);
  renderHistory(history);
}

function renderHistory(history = storage.get(HISTORY_KEY) ?? []) {
  const body = $("history");
  body.replaceChildren();
  for (const h of history) {
    const tr = document.createElement("tr");
    const result = h.won ? "✓" : h.value === null ? "—" : `off by ${Math.abs(h.value - h.target)}`;
    const time = h.seconds >= 60 ? `${Math.floor(h.seconds / 60)}m ${h.seconds % 60}s` : `${h.seconds}s`;
    tr.innerHTML = `<td class="target"></td><td class="${h.won ? "win" : "lose"}"></td>
      <td class="answer"></td><td class="num"></td><td><span class="numbers"></span><span class="rules"></span></td>`;
    const cells = tr.children;
    cells[0].textContent = pad(h.target);
    cells[1].textContent = result;
    if (h.answer) cells[2].innerHTML = `<span class="math">${textToHTML(h.answer)}${h.won ? "" : ` = ${h.value}`}</span>`;
    if (!h.won && h.solution !== undefined) {
      cells[2].insertAdjacentHTML("beforeend", h.solution
        ? `<span class="solution">Solution: <span class="math">${textToHTML(h.solution)}</span></span>`
        : `<span class="solution">No solution found</span>`);
    }
    cells[3].textContent = time;
    cells[4].querySelector(".numbers").textContent = h.numbers.join(" ");
    cells[4].querySelector(".rules").textContent = rulesSummary(h);
    body.appendChild(tr);
  }
  $("history-empty").hidden = history.length > 0;
  $("clear-history").disabled = !history.length;
}

// ---- all solutions

const solutionsView = {
  shown: false,
  job: null,

  show() {
    const puzzle = currentPuzzle();
    if (!puzzle) return;
    this.shown = true;
    const job = (this.job = solver.get(puzzle));
    job.watch((j) => {
      if (this.job !== j) return true;
      this.render(j);
      return j.done;
    });
  },

  // Settings changed: hide stale solutions.
  refresh() {
    if (!this.shown) return;
    const puzzle = currentPuzzle();
    if (puzzle && this.job?.key === JSON.stringify(puzzle)) return;
    this.shown = false;
    this.job = null;
    $("solutions").replaceChildren();
    $("solve-status").textContent = "";
  },

  render(job) {
    const status = $("solve-status");
    if (!job.solutions) {
      status.innerHTML = `Solving… <progress max="1" value="${job.fraction}"></progress>`;
      return;
    }
    const found = job.solutions.size;
    const missing = "not found";
    status.textContent = job.done
      ? `${found} of 1000 solved${found < 1000 ? `; ${missing}: ${1000 - found}` : ""}${!job.exact && found < 1000 ? " (search limited)" : ""}`
      : `${found} solved so far; refining…`;
    const html = [];
    for (let t = 0; t < 1000; t++) {
      const text = job.solutions.get(t);
      html.push(`<div><span class="t">${pad(t)}</span>${text
        ? `<span class="math">${textToHTML(text)}</span>`
        : `<span class="none">${job.done ? missing : "…"}</span>`}</div>`);
    }
    $("solutions").innerHTML = html.join("");
  },
};

// ---- wiring

applySettings(loadSettings());
for (const label of document.querySelectorAll(".checks label[title]")) label.dataset.title = label.title;
updateControls();
renderHistory();

$("add-box").addEventListener("click", () => {
  if (boxes.children.length >= MAX_BOXES) return;
  const last = boxes.lastElementChild?.value ?? "";
  addBox(last);
  settingsChanged();
});
$("remove-box").addEventListener("click", () => {
  if (boxes.children.length <= MIN_BOXES) return;
  boxes.lastElementChild.remove();
  settingsChanged();
});
$("random").addEventListener("click", randomNumbers);
for (const el of document.querySelectorAll("#setup input:not(#boxes input), #setup select")) {
  el.addEventListener("change", settingsChanged);
}
$("new-target").addEventListener("click", newTarget);
$("try").addEventListener("click", tryAnswer);
$("give-up").addEventListener("click", () => game && endGame("give-up"));
answerBox.addEventListener("input", showPreview);
answerBox.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    tryAnswer();
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !game && !e.defaultPrevented && e.target.tagName !== "BUTTON" && !e.target.closest("#boxes, #seconds")) {
    e.preventDefault();
    newTarget();
  }
});
$("clear-history").addEventListener("click", () => {
  if (!confirm("Clear the history?")) return;
  storage.set(HISTORY_KEY, []);
  renderHistory([]);
});
$("solve-all").addEventListener("click", () => solutionsView.show());
