// Links that share a pattern, its test strings and the diagram view, as query parameters:
// p (the pattern), t (the test strings, omitted when empty), v (the view, omitted when it's
// the default) and h=1 (when the diagram is hidden).

// the query string (with its "?") for a link to the given state
export function shareQuery({ pattern, tests, view, hidden = false }, defaultView) {
  const params = new URLSearchParams({ p: pattern });
  if (tests.trim() !== "") params.set("t", tests);
  if (view !== defaultView) params.set("v", view);
  if (hidden) params.set("h", "1");
  return `?${params}`;
}

// The state given by a query string, or null if it has no pattern. Missing test strings are
// empty, and a missing or unknown view is the default.
export function readShared(search, views, defaultView) {
  const params = new URLSearchParams(search);
  const pattern = params.get("p");
  if (pattern === null) return null;
  const view = params.get("v");
  return {
    pattern: pattern.replace(/[\r\n]/g, ""),
    tests: (params.get("t") ?? "").replace(/\r\n?/g, "\n"),
    view: view !== null && Object.hasOwn(views, view) ? view : defaultView,
    hidden: params.get("h") === "1",
  };
}
