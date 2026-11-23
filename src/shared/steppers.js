// − and + buttons after every number input (like the iOS stepper), shown only on touch screens (where browsers such as
// iOS Safari don't show the spinner arrows), so a number can be changed without the keyboard.
//
// They behave like the desktop spinner arrows: each step sends an "input" event, holding a button
// repeats the step, and letting go sends one "change" event, so pages that redraw on "change"
// redraw once at the end. Steps follow the input's step, min and max (step="any" steps by 1).

const STYLE = `
  .stepper { display: inline-flex; align-items: stretch; gap: 4px; vertical-align: middle; }
  .stepper > button { display: none; }
  @media (pointer: coarse) {
    .stepper > button {
      display: block; min-width: 1.8em; padding: 0 4px; font: inherit; font-size: 1.1em; line-height: 1;
      border: 1px solid #bbb; border-radius: 4px; background: #f4f4f4; color: #222;
      touch-action: manipulation; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none;
    }
    .stepper > button:active { background: #ddd; }
    /* the buttons make typing rarer, so the inputs only need room for about four digits */
    input[type="number"] { width: 3.2em !important; }
    .stepper:has(input:disabled) > button { color: #bbb; background: #f8f8f8; }
  }
`;

const DELAY = 400; // ms before a held button starts repeating
const REPEAT = 100; // ms between repeated steps

// the input's value one step up (+1) or down (-1), or null if it's at its limit
function stepped(input, direction) {
  const before = input.value;
  try {
    if (direction > 0) input.stepUp();
    else input.stepDown();
  } catch {
    // step="any": step by 1, within min and max
    const value = (Number(input.value) || 0) + direction;
    const min = input.min === "" ? -Infinity : Number(input.min);
    const max = input.max === "" ? Infinity : Number(input.max);
    input.value = String(Math.min(max, Math.max(min, value)));
  }
  const after = input.value;
  input.value = before;
  return after === before ? null : after;
}

function addStepper(input) {
  const wrapper = document.createElement("span");
  wrapper.className = "stepper";
  input.replaceWith(wrapper);
  const minus = button("−", "Decrease", -1);
  const plus = button("+", "Increase", 1);
  wrapper.append(input, minus, plus);

  // integers get the number pad, unless they can be negative (it has no minus sign)
  if (!input.hasAttribute("inputmode") && input.min !== "" && Number(input.min) >= 0) {
    input.inputMode = input.step === "any" ? "decimal" : "numeric";
  }

  function button(text, label, direction) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = text;
    b.setAttribute("aria-label", label);
    b.tabIndex = -1; // keyboards have the arrow keys
    let timer = null;
    let changed = false;
    const step = () => {
      const value = stepped(input, direction);
      if (value === null) return stop();
      input.value = value;
      changed = true;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const stop = () => {
      clearTimeout(timer);
      clearInterval(timer);
      timer = null;
    };
    const release = () => {
      stop();
      if (changed) input.dispatchEvent(new Event("change", { bubbles: true }));
      changed = false;
    };
    b.addEventListener("pointerdown", (e) => {
      e.preventDefault(); // keeps the focus (and the keyboard) away
      if (input.disabled) return;
      b.setPointerCapture(e.pointerId);
      step();
      timer = setTimeout(() => (timer = setInterval(step, REPEAT)), DELAY);
    });
    b.addEventListener("pointerup", release);
    b.addEventListener("pointercancel", release);
    b.addEventListener("contextmenu", (e) => e.preventDefault());
    return b;
  }
}

const style = document.createElement("style");
style.textContent = STYLE;
document.head.append(style);
// inputs marked data-no-stepper go without (such as the Numbers timer, rarely stepped through)
for (const input of document.querySelectorAll('input[type="number"]:not([data-no-stepper])')) addStepper(input);
