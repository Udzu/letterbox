// Web Worker that runs the solver: given { id, numbers, rules, ops }, posts
// { id, type: "progress", fraction, step } while solving, { id, type: "result",
// solutions: [[target, text], ...], exact, step } after each completed step,
// and finally { id, type: "done" }.

import { solveSteps } from "./solver.js";

self.onmessage = ({ data: { id, numbers, rules, ops } }) => {
  let last = 0;
  const progress = (fraction, step) => {
    const now = Date.now();
    if (now - last < 100) return;
    last = now;
    self.postMessage({ id, type: "progress", fraction, step });
  };
  for (const { solutions, exact, step } of solveSteps(numbers, rules, ops, { progress })) {
    self.postMessage({ id, type: "result", solutions: [...solutions], exact, step });
  }
  self.postMessage({ id, type: "done" });
};
