// The Lingtape world map: countries shaded by their number of songs, clickable, with markers for
// countries too small to click, and zooming (buttons, Ctrl+wheel, double-click, pinch) and panning (drag).

const SVG = "http://www.w3.org/2000/svg";
const MAX_ZOOM = 24;
const SMALL = 6; // countries whose largest part is under this many units across get a marker
const MARKER_RADIUS = 4; // in screen pixels
// the shading levels: the smallest count for each
export const LEVELS = [1, 2, 3, 6, 10];
const level = (n) => LEVELS.findLastIndex((min) => n >= min);

// Draw the map in svg; onSelect(name) is called when a country with songs is clicked.
// Returns update(counts, selected), which reshades the map for a Map of country name to count.
export function createMap(svg, data, { onSelect, zoomIn, zoomOut, zoomReset }) {
  const { width, height } = data;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  const countries = svg.appendChild(document.createElementNS(SVG, "g"));
  const markers = svg.appendChild(document.createElementNS(SVG, "g"));
  const elements = new Map(); // country name → { path, marker }
  for (const country of data.countries) {
    const path = countries.appendChild(document.createElementNS(SVG, "path"));
    path.setAttribute("d", country.path);
    path.dataset.country = country.name;
    path.appendChild(document.createElementNS(SVG, "title"));
    let marker = null;
    if (country.size < SMALL) {
      marker = markers.appendChild(document.createElementNS(SVG, "circle"));
      marker.setAttribute("cx", country.cx);
      marker.setAttribute("cy", country.cy);
      marker.dataset.country = country.name;
      marker.appendChild(document.createElementNS(SVG, "title"));
    }
    elements.set(country.name, { path, marker });
  }

  // --- zooming and panning, by changing the viewBox ---
  let view = { x: 0, y: 0, w: width, h: height };
  function setView(next) {
    const w = Math.min(width, Math.max(width / MAX_ZOOM, next.w));
    const h = w * height / width;
    const x = Math.min(width - w, Math.max(0, next.x));
    const y = Math.min(height - h, Math.max(0, next.y));
    view = { x, y, w, h };
    svg.setAttribute("viewBox", `${x} ${y} ${w} ${h}`);
    const zoom = width / w;
    const r = MARKER_RADIUS * w / (svg.clientWidth || width); // map units per screen pixel
    for (const { marker } of elements.values()) marker?.setAttribute("r", r);
    // once zoomed in, one finger pans the map; before that it scrolls the page
    svg.style.touchAction = zoom > 1.01 ? "none" : "pan-y";
  }
  // the map point under a client position
  function toMap(clientX, clientY) {
    const rect = svg.getBoundingClientRect();
    return [view.x + (clientX - rect.left) / rect.width * view.w, view.y + (clientY - rect.top) / rect.height * view.h];
  }
  // zoom by factor (> 1 zooms in), keeping the map point at the client position where it is
  function zoomAt(factor, clientX, clientY) {
    const [mx, my] = toMap(clientX, clientY);
    const w = Math.min(width, Math.max(width / MAX_ZOOM, view.w / factor));
    const k = w / view.w;
    setView({ x: mx - (mx - view.x) * k, y: my - (my - view.y) * k, w });
  }
  function zoomCentre(factor) {
    const rect = svg.getBoundingClientRect();
    zoomAt(factor, rect.left + rect.width / 2, rect.top + rect.height / 2);
  }
  zoomIn.addEventListener("click", () => zoomCentre(2));
  zoomOut.addEventListener("click", () => zoomCentre(1 / 2));
  zoomReset.addEventListener("click", () => setView({ x: 0, y: 0, w: width }));
  svg.addEventListener("wheel", (e) => {
    if (!e.ctrlKey && !e.metaKey) return; // plain scrolling scrolls the page
    e.preventDefault();
    zoomAt(Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.002)), e.clientX, e.clientY);
  }, { passive: false });
  svg.addEventListener("dblclick", (e) => { e.preventDefault(); zoomAt(e.shiftKey ? 1 / 2 : 2, e.clientX, e.clientY); });

  // dragging pans, two pointers pinch; a press that doesn't move is a click on its country
  const pointers = new Map(); // pointerId → { x, y }
  let pressed = null; // { country, x, y, moved }
  let pinch = null; // the previous distance and midpoint of two pointers
  const pair = () => {
    const [a, b] = [...pointers.values()];
    return { d: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };
  svg.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) pressed = { country: e.target.dataset?.country, x: e.clientX, y: e.clientY, moved: false };
    else { pressed = null; pinch = pair(); }
  });
  svg.addEventListener("pointermove", (e) => {
    const previous = pointers.get(e.pointerId);
    if (!previous) return;
    const current = { x: e.clientX, y: e.clientY };
    pointers.set(e.pointerId, current);
    if (pointers.size === 2 && pinch) {
      const next = pair();
      const rect = svg.getBoundingClientRect();
      const k = view.w / rect.width;
      setView({ ...view, x: view.x - (next.x - pinch.x) * k, y: view.y - (next.y - pinch.y) * k });
      if (pinch.d > 0) zoomAt(next.d / pinch.d, next.x, next.y);
      pinch = next;
      return;
    }
    if (pressed && !pressed.moved && Math.hypot(e.clientX - pressed.x, e.clientY - pressed.y) < 5) return;
    if (pressed && !pressed.moved) { pressed.moved = true; svg.setPointerCapture(e.pointerId); svg.classList.add("dragging"); }
    const rect = svg.getBoundingClientRect();
    const k = view.w / rect.width;
    setView({ ...view, x: view.x - (current.x - previous.x) * k, y: view.y - (current.y - previous.y) * k });
  });
  const release = (e) => {
    if (!pointers.delete(e.pointerId)) return;
    if (e.type === "pointerup" && pressed && !pressed.moved && pressed.country) {
      const { country } = pressed;
      if (elements.get(country)?.path.classList.contains("active")) onSelect(country);
    }
    pressed = null;
    if (pointers.size < 2) pinch = null;
    svg.classList.remove("dragging");
  };
  svg.addEventListener("pointerup", release);
  svg.addEventListener("pointercancel", release);
  new ResizeObserver(() => setView(view)).observe(svg);
  setView(view);

  return function update(counts, selected) {
    for (const [name, { path, marker }] of elements) {
      const n = counts.get(name) ?? 0;
      const cls = name === selected ? "selected active" : n ? `level${level(n)} active` : "";
      path.setAttribute("class", cls);
      const text = n ? `${name}: ${n} song${n === 1 ? "" : "s"}` : name;
      path.querySelector("title").textContent = text;
      if (marker) {
        marker.setAttribute("class", cls);
        marker.style.display = cls ? "" : "none";
        marker.querySelector("title").textContent = text;
      }
    }
  };
}
