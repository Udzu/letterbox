// A Reset button that acts at once and then turns into Undo, which brings back what was there
// before. It turns back into Reset as soon as the page changes in any other way: pages call
// check() whenever their state may have changed (typing, loading an attempt, …), and it compares
// the state with the one the reset left.
//
// snapshot() returns the state as something JSON can compare, clear() resets the page and
// restore(state) brings a snapshot back.
export function resetButton(button, { snapshot, clear, restore }) {
  const resetTitle = button.title;
  let before = null; // the state before the reset, while the button shows Undo
  let after = null; // the state the reset left, as JSON

  function showReset() {
    before = after = null;
    button.textContent = "Reset";
    button.title = resetTitle;
  }

  function check() {
    if (before !== null && JSON.stringify(snapshot()) !== after) showReset();
  }

  button.addEventListener("click", () => {
    if (before === null) {
      const state = snapshot();
      clear();
      before = state;
      after = JSON.stringify(snapshot());
      button.textContent = "Undo";
      button.title = "Bring back what was there before the reset";
    } else {
      const state = before;
      showReset();
      restore(state);
    }
  });

  return { check };
}

// Set a box's value via an editing command where possible, so Ctrl+Z can undo it too.
export function setBox(box, value) {
  box.focus();
  box.select();
  const ok = value === "" ? document.execCommand("delete") : document.execCommand("insertText", false, value);
  if (!ok || box.value !== value) box.value = value;
}
