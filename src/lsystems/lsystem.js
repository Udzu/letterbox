// L-systems: rewriting rules applied to a string of symbols, then drawn by a turtle.
//
// Every character is a symbol. Symbols without a rule are constants (copied unchanged); a symbol with
// several rules picks one at random for each occurrence, in proportion to the rules' weights.
// Drawing: F draws forward one unit, G moves forward without drawing, + and - turn clockwise and
// anticlockwise by the angle, [ saves the position and heading, ] returns to the last one saved.
// Other symbols do nothing when drawing.

// the most symbols an expansion may reach; drawing more would take too long
export const MAX_SYMBOLS = 5_000_000;

// whitespace is ignored in the axiom and rule outputs, so they can be spaced out for readability
export const clean = (text) => text.replace(/\s+/g, "");

// Check rule rows ({ symbol, output, weight } strings, as typed) and group them by symbol:
// returns { rules: Map(symbol → { outputs, weights }), errors: [message] }. Rows left entirely blank
// are skipped; a rule with an empty output deletes its symbol. Weights default to 1.
export function parseRules(rows) {
  const rules = new Map();
  const errors = [];
  rows.forEach((row, i) => {
    const symbol = row.symbol.trim();
    const output = clean(row.output);
    const weightText = (row.weight ?? "").trim();
    if (!symbol && !output && !weightText) return;
    const where = `Rule ${i + 1}`;
    if ([...symbol].length !== 1) {
      errors.push(symbol ? `${where}: the symbol should be a single character.` : `${where} has no symbol.`);
      return;
    }
    const weight = weightText === "" ? 1 : Number(weightText);
    if (!(weight > 0 && Number.isFinite(weight))) {
      errors.push(`${where}: the weight should be a positive number.`);
      return;
    }
    if (!rules.has(symbol)) rules.set(symbol, { outputs: [], weights: [] });
    rules.get(symbol).outputs.push(output);
    rules.get(symbol).weights.push(weight);
  });
  return { rules, errors };
}

// The angle field: the number of turns making a full rotation (so 4 means 90°).
export function parseAngle(text) {
  const n = Number(text.trim());
  return text.trim() !== "" && Number.isFinite(n) && n > 0 ? n : null;
}

// Apply the rules to the axiom up to `iterations` times, stopping early if the next step would exceed
// `limit` symbols. Returns { result, iterations } with the number of steps actually done.
export function expand(axiom, rules, iterations, { limit = MAX_SYMBOLS, random = Math.random } = {}) {
  // per symbol: a fixed output, or outputs with cumulative weights to choose from
  const table = new Map();
  for (const [symbol, { outputs, weights }] of rules) {
    if (outputs.length === 1) {
      table.set(symbol, outputs[0]);
    } else {
      let total = 0;
      const cumulative = weights.map((w) => (total += w));
      table.set(symbol, { outputs, cumulative, total });
    }
  }
  const choose = ({ outputs, cumulative, total }) => {
    const r = random() * total;
    const i = cumulative.findIndex((c) => r < c);
    return outputs[i === -1 ? outputs.length - 1 : i];
  };

  let state = axiom;
  let done = 0;
  for (; done < iterations; done++) {
    const parts = [];
    let length = 0;
    for (const symbol of state) {
      const rule = table.get(symbol);
      const out = rule === undefined ? symbol : typeof rule === "string" ? rule : choose(rule);
      parts.push(out);
      length += out.length;
      if (length > limit) return { result: state, iterations: done };
    }
    state = parts.join("");
  }
  return { result: state, iterations: done };
}

// Walk the turtle along the string, calling line(x1, y1, x2, y2) for each F. Starts at (0, 0) with the
// given heading in radians; y points down, so turning clockwise on screen increases the heading.
// Returns the number of lines.
export function trace(string, divisions, heading, line) {
  const step = (2 * Math.PI) / divisions;
  const directions = new Map(); // turn count → [dx, dy]
  const direction = (turns) => {
    let d = directions.get(turns);
    if (!d) {
      const a = heading + turns * step;
      d = [Math.cos(a), Math.sin(a)];
      directions.set(turns, d);
    }
    return d;
  };
  let x = 0;
  let y = 0;
  let turns = 0;
  let lines = 0;
  const stack = [];
  for (const symbol of string) {
    switch (symbol) {
      case "F": {
        const [dx, dy] = direction(turns);
        line(x, y, x + dx, y + dy);
        x += dx;
        y += dy;
        lines++;
        break;
      }
      case "G": {
        const [dx, dy] = direction(turns);
        x += dx;
        y += dy;
        break;
      }
      case "+":
        turns++;
        break;
      case "-":
        turns--;
        break;
      case "[":
        stack.push([x, y, turns]);
        break;
      case "]":
        if (stack.length) [x, y, turns] = stack.pop();
        break;
    }
  }
  return lines;
}

// The extent of the drawn lines: { minX, minY, maxX, maxY, lines }, or null if there are none.
export function bounds(string, divisions, heading) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const lines = trace(string, divisions, heading, (x1, y1, x2, y2) => {
    minX = Math.min(minX, x1, x2);
    maxX = Math.max(maxX, x1, x2);
    minY = Math.min(minY, y1, y2);
    maxY = Math.max(maxY, y1, y2);
  });
  return lines ? { minX, minY, maxX, maxY, lines } : null;
}

// Start headings offered on the page, in radians (y points down).
export const HEADINGS = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 };

// Examples to start the attempts list with (mostly from pudzu's tinytim.py; the stochastic plant is from
// Prusinkiewicz and Lindenmayer's The Algorithmic Beauty of Plants, figure 1.27).
export const EXAMPLES = [
  { name: "Koch snowflake", angle: "6", heading: "right", axiom: "F--F--F", iterations: 4, rules: [{ symbol: "F", output: "F+F--F+F", weight: "" }] },
  {
    name: "Dragon curve",
    angle: "8",
    heading: "right",
    axiom: "FX",
    iterations: 12,
    rules: [
      { symbol: "F", output: "", weight: "" },
      { symbol: "Y", output: "+FX--FY+", weight: "" },
      { symbol: "X", output: "-FX++FY-", weight: "" },
    ],
  },
  {
    name: "Sierpiński arrowhead",
    angle: "6",
    heading: "left",
    axiom: "AF",
    iterations: 7,
    rules: [
      { symbol: "A", output: "BF+AF+BF", weight: "" },
      { symbol: "B", output: "AF-BF-AF", weight: "" },
      { symbol: "F", output: "", weight: "" },
    ],
  },
  {
    name: "Fern",
    angle: "14.4",
    heading: "up",
    axiom: "X",
    iterations: 6,
    rules: [
      { symbol: "X", output: "F+[[X]-X]-F[-FX]+X", weight: "" },
      { symbol: "F", output: "FF", weight: "" },
    ],
  },
  {
    name: "Stochastic plant",
    angle: "16",
    heading: "up",
    axiom: "F",
    iterations: 5,
    rules: [
      { symbol: "F", output: "F[+F]F[-F]F", weight: "" },
      { symbol: "F", output: "F[+F]F", weight: "" },
      { symbol: "F", output: "F[-F]F", weight: "" },
    ],
  },
];
