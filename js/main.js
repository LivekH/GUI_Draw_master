import { DISPLAYS, ORIENTATIONS, LIBRARIES, filterLibraries, resolveSize, getDisplay } from "./catalog.js";
import { TOOLS, createProject, createElement, elementBounds, resetIdCounter, nextId } from "./models.js";
import { renderProject } from "./renderer.js";
import { codegenObject, codegenScreen } from "./codegen.js";
import { format565 } from "./color.js";

const state = {
  project: createProject(),
  selectedId: null,
  zoom: 2,
  showGrid: true,
  drag: null,
};

const $ = (id) => document.getElementById(id);

const COLOR_PRESETS = [
  "#000000", "#ffffff", "#ff0000", "#00ff00", "#0000ff",
  "#ffff00", "#00ffff", "#ff00ff", "#ffa500", "#808080",
  "#404040", "#800000", "#008000", "#000080", "#c0c0c0",
  "#e8eef6", "#3ecf8e", "#4dabf7", "#e85d5d", "#e8a838",
];

const els = {
  display: $("sel-display"),
  orient: $("sel-orient"),
  library: $("sel-library"),
  sizeBadge: $("size-badge"),
  canvas: $("screen"),
  stage: $("stage"),
  selbox: $("selbox"),
  toolbox: $("toolbox"),
  layers: $("layers"),
  props: $("props"),
  codeEl: $("code-el"),
  codeScreen: $("code-screen"),
  libTag: $("lib-tag"),
  zoomLabel: $("zoom-label"),
  fileOpen: $("file-open"),
  btnGrid: $("btn-grid"),
  rulerH: $("ruler-h"),
  rulerV: $("ruler-v"),
  stageWrap: $("stage-wrap") || document.querySelector(".stage-wrap"),
  scrollH: $("scroll-h"),
  scrollV: $("scroll-v"),
  bgSwatches: $("bg-swatches"),
};

const ctx = els.canvas.getContext("2d");

function currentLib() {
  return LIBRARIES.find((l) => l.id === state.project.libraryId) || LIBRARIES[0];
}

function selected() {
  return state.project.widgets.find((w) => w.id === state.selectedId) || null;
}

function applyZoom() {
  const { width, height } = state.project;
  els.canvas.style.width = `${width * state.zoom}px`;
  els.canvas.style.height = `${height * state.zoom}px`;
  els.zoomLabel.textContent = `${Math.round(state.zoom * 100)}%`;
  updateSelbox();
  drawRulers();
  requestAnimationFrame(syncScrollSliders);
}

/** Tick step in screen pixels → denser when zoomed */
function rulerMetrics(zoom) {
  let step;
  if (zoom >= 6) step = 1;
  else if (zoom >= 4) step = 2;
  else if (zoom >= 3) step = 5;
  else if (zoom >= 2) step = 5;
  else if (zoom >= 1) step = 10;
  else if (zoom >= 0.75) step = 20;
  else step = 50;

  // label spacing: at least ~32 CSS px between labels
  const minGap = 32;
  let labelEvery = Math.max(step, Math.ceil(minGap / zoom));
  // snap to nice values
  const nice = [1, 2, 5, 10, 20, 25, 50, 100, 200];
  labelEvery = nice.find((n) => n >= labelEvery) || labelEvery;
  // ensure labelEvery is multiple of step
  if (labelEvery % step !== 0) {
    labelEvery = Math.ceil(labelEvery / step) * step;
  }
  return { step, labelEvery };
}

function drawRulers() {
  const z = state.zoom;
  const W = state.project.width;
  const H = state.project.height;
  const { step, labelEvery } = rulerMetrics(z);

  const rh = els.rulerH;
  const rv = els.rulerV;
  const cssW = Math.round(W * z);
  const cssH = Math.round(H * z);
  const rhH = 24;
  const rvW = 32;

  rh.width = cssW;
  rh.height = rhH;
  rh.style.width = `${cssW}px`;
  rv.width = rvW;
  rv.height = cssH;
  rv.style.height = `${cssH}px`;

  const ctxH = rh.getContext("2d");
  const ctxV = rv.getContext("2d");
  ctxH.fillStyle = "#1a1916";
  ctxH.fillRect(0, 0, cssW, rhH);
  ctxV.fillStyle = "#1a1916";
  ctxV.fillRect(0, 0, rvW, cssH);

  ctxH.strokeStyle = "#5a544c";
  ctxH.fillStyle = "#c8c0b4";
  ctxH.font = "9px JetBrains Mono, monospace";
  ctxH.textAlign = "center";
  ctxH.textBaseline = "top";

  for (let px = 0; px <= W; px += step) {
    const x = Math.round(px * z) + 0.5;
    const major = px % labelEvery === 0;
    const mid = !major && labelEvery >= step * 2 && px % (labelEvery / 2) === 0;
    ctxH.beginPath();
    ctxH.moveTo(x, major ? 9 : mid ? 13 : 17);
    ctxH.lineTo(x, rhH);
    ctxH.stroke();
    if (major) ctxH.fillText(String(px), px === 0 ? 8 : x, 2);
  }

  ctxV.strokeStyle = "#5a544c";
  ctxV.fillStyle = "#c8c0b4";
  ctxV.font = "9px JetBrains Mono, monospace";
  ctxV.textAlign = "right";
  ctxV.textBaseline = "middle";

  for (let px = 0; px <= H; px += step) {
    const y = Math.round(px * z) + 0.5;
    const major = px % labelEvery === 0;
    const mid = !major && labelEvery >= step * 2 && px % (labelEvery / 2) === 0;
    ctxV.beginPath();
    ctxV.moveTo(major ? 12 : mid ? 18 : 22, y);
    ctxV.lineTo(rvW, y);
    ctxV.stroke();
    if (major) ctxV.fillText(String(px), rvW - 4, px === 0 ? 8 : y);
  }
}

let _scrollSyncing = false;
function syncScrollSliders() {
  if (!els.scrollH || !els.scrollV || !els.stageWrap) return;
  const wrap = els.stageWrap;
  const maxH = Math.max(0, wrap.scrollWidth - wrap.clientWidth);
  const maxV = Math.max(0, wrap.scrollHeight - wrap.clientHeight);

  _scrollSyncing = true;
  els.scrollH.max = String(maxH);
  els.scrollH.value = String(wrap.scrollLeft);
  els.scrollH.disabled = maxH <= 0;

  els.scrollV.max = String(maxV);
  els.scrollV.value = String(wrap.scrollTop);
  els.scrollV.disabled = maxV <= 0;
  _scrollSyncing = false;
}

function renderBgSwatches() {
  if (!els.bgSwatches) return;
  els.bgSwatches.innerHTML = "";
  const current = (state.project.background || "#000000").toLowerCase();
  const presets = ["#000000", "#ffffff", "#101010", "#1a2332", "#000080", "#800000", "#008000"];
  for (const hex of presets) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "swatch" + (hex === current ? " selected" : "");
    btn.style.background = hex;
    btn.title = `Фон ${hex} → ${format565(hex)}`;
    btn.addEventListener("click", () => {
      state.project.background = hex;
      redraw();
    });
    els.bgSwatches.appendChild(btn);
  }
  const more = document.createElement("button");
  more.type = "button";
  more.className = "swatch-more";
  more.textContent = "⋯";
  more.title = "Свой цвет фона";
  more.addEventListener("click", () => {
    const hidden = document.createElement("input");
    hidden.type = "color";
    hidden.value = /^#[0-9a-fA-F]{6}$/.test(current) ? current : "#000000";
    hidden.style.cssText = "position:fixed;left:-9999px;opacity:0;";
    document.body.appendChild(hidden);
    hidden.addEventListener("change", () => {
      state.project.background = hidden.value;
      hidden.remove();
      redraw();
    });
    hidden.click();
  });
  els.bgSwatches.appendChild(more);
}

function updateSelbox() {
  const el = selected();
  if (!el) {
    els.selbox.classList.add("hidden");
    return;
  }
  const b = elementBounds(el);
  const z = state.zoom;
  els.selbox.classList.remove("hidden");
  els.selbox.style.left = `${b.x * z}px`;
  els.selbox.style.top = `${b.y * z}px`;
  els.selbox.style.width = `${b.w * z}px`;
  els.selbox.style.height = `${b.h * z}px`;
}

function refreshCode() {
  const lib = currentLib();
  els.libTag.textContent = lib.label;
  const el = selected();
  els.codeEl.textContent = el ? codegenObject(el, lib) : "// выберите элемент на холсте";
  els.codeScreen.textContent = codegenScreen(state.project, lib);
}

function redraw() {
  if (!state.project.background) state.project.background = "#000000";
  els.canvas.width = state.project.width;
  els.canvas.height = state.project.height;
  renderProject(ctx, state.project, { showGrid: state.showGrid });
  applyZoom();
  renderLayers();
  renderProps();
  renderBgSwatches();
  refreshCode();
  els.sizeBadge.textContent = `${state.project.width}×${state.project.height}`;
}

function fillDisplays() {
  els.display.innerHTML = "";
  let group = null;
  let lastKind = null;
  const kindLabel = { oled: "OLED монохром", oled_color: "OLED цвет", tft: "TFT" };
  for (const d of DISPLAYS) {
    if (d.kind !== lastKind) {
      group = document.createElement("optgroup");
      group.label = kindLabel[d.kind] || d.kind;
      els.display.appendChild(group);
      lastKind = d.kind;
    }
    const opt = document.createElement("option");
    opt.value = d.id;
    opt.textContent = d.id === "custom" ? d.label : `${d.label}${d.controller ? " — " + d.controller : ""}`;
    group.appendChild(opt);
  }
}

function fillOrients() {
  els.orient.innerHTML = "";
  for (const o of ORIENTATIONS) {
    const opt = document.createElement("option");
    opt.value = o.id;
    opt.textContent = o.label;
    els.orient.appendChild(opt);
  }
}

function fillLibraries() {
  const list = filterLibraries(state.project.displayId);
  els.library.innerHTML = "";
  for (const lib of list) {
    const opt = document.createElement("option");
    opt.value = lib.id;
    opt.textContent = lib.label;
    els.library.appendChild(opt);
  }
  if (!list.find((l) => l.id === state.project.libraryId)) {
    state.project.libraryId = list[0]?.id || "adafruit_gfx";
  }
  els.library.value = state.project.libraryId;
}

function applyDisplayCascade() {
  const { w, h } = resolveSize(state.project.displayId, state.project.orientationId);
  if (state.project.displayId === "custom") {
    // keep current size unless first load
  } else {
    state.project.width = w;
    state.project.height = h;
  }
  fillLibraries();
  redraw();
}

function renderToolbox() {
  els.toolbox.innerHTML = "";
  for (const t of TOOLS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tool";
    btn.title = t.hint;
    btn.innerHTML = `<span class="g">${t.glyph}</span>${t.label}`;
    btn.addEventListener("click", () => {
      const el = createElement(t.type, state.project.width, state.project.height);
      state.project.widgets.push(el);
      state.selectedId = el.id;
      redraw();
    });
    els.toolbox.appendChild(btn);
  }
}

function renderLayers() {
  els.layers.innerHTML = "";
  for (const w of [...state.project.widgets].reverse()) {
    const li = document.createElement("li");
    li.className = w.id === state.selectedId ? "selected" : "";
    li.innerHTML = `<span>${w.name}</span><span class="t">${w.type}</span>`;
    li.addEventListener("click", () => {
      state.selectedId = w.id;
      redraw();
    });
    els.layers.appendChild(li);
  }
}

function propNum(label, val, onChange, opts = {}) {
  const row = document.createElement("div");
  row.className = "prop-row";
  row.innerHTML = `<label>${label}</label>`;
  const input = document.createElement("input");
  input.type = "number";
  input.value = val;
  if (opts.step != null) input.step = opts.step;
  if (opts.min != null) input.min = opts.min;
  if (opts.max != null) input.max = opts.max;
  input.addEventListener("change", () => onChange(Number(input.value)));
  row.appendChild(input);
  return row;
}

function propText(label, val, onChange) {
  const row = document.createElement("div");
  row.className = "prop-row";
  row.innerHTML = `<label>${label}</label>`;
  const input = document.createElement("input");
  input.type = "text";
  input.value = val ?? "";
  input.addEventListener("change", () => onChange(input.value));
  row.appendChild(input);
  return row;
}

function propColor(label, val, onChange) {
  const row = document.createElement("div");
  row.className = "prop-row color-row";
  const lab = document.createElement("label");
  lab.textContent = label;

  const wrap = document.createElement("div");
  wrap.className = "swatches";

  const current = (val || "#ffffff").toLowerCase();

  for (const hex of COLOR_PRESETS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "swatch" + (hex.toLowerCase() === current ? " selected" : "");
    btn.style.background = hex;
    btn.title = `${hex} → ${format565(hex)}`;
    btn.addEventListener("click", () => onChange(hex));
    wrap.appendChild(btn);
  }

  const more = document.createElement("button");
  more.type = "button";
  more.className = "swatch-more";
  more.textContent = "⋯";
  more.title = "Свой цвет";
  more.addEventListener("click", () => {
    const hidden = document.createElement("input");
    hidden.type = "color";
    hidden.value = /^#[0-9a-fA-F]{6}$/.test(current) ? current : "#ffffff";
    hidden.style.cssText = "position:fixed;left:-9999px;opacity:0;";
    document.body.appendChild(hidden);
    hidden.addEventListener("change", () => {
      onChange(hidden.value);
      hidden.remove();
    });
    // cancel / dismiss without change
    setTimeout(() => {
      const remove = () => {
        if (document.body.contains(hidden)) hidden.remove();
        window.removeEventListener("focus", onFocus);
      };
      const onFocus = () => setTimeout(remove, 300);
      window.addEventListener("focus", onFocus, { once: true });
    }, 0);
    hidden.click();
  });
  wrap.appendChild(more);

  const code = document.createElement("span");
  code.className = "swatch-hex";
  code.textContent = format565(current);
  wrap.appendChild(code);

  row.append(lab, wrap);
  return row;
}

function propCheck(label, val, onChange) {
  const row = document.createElement("div");
  row.className = "prop-row";
  row.innerHTML = `<label>${label}</label>`;
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = !!val;
  input.addEventListener("change", () => onChange(input.checked));
  row.appendChild(input);
  return row;
}

function renderProps() {
  const el = selected();
  els.props.innerHTML = "";
  if (!el) {
    els.props.innerHTML = `<p class="muted">Выберите элемент — справа и внизу появится код для библиотеки <strong style="color:var(--accent-2)">${currentLib().label}</strong></p>`;
    return;
  }

  const patch = (k, v) => {
    el[k] = v;
    redraw();
  };

  els.props.appendChild(propText("Имя", el.name, (v) => patch("name", v)));

  const commonXY = () => {
    if ("cx" in el) {
      els.props.appendChild(propNum("Центр X", el.cx, (v) => patch("cx", Math.round(v))));
      els.props.appendChild(propNum("Центр Y", el.cy, (v) => patch("cy", Math.round(v))));
    }
  };

  switch (el.type) {
    case "scale":
      commonXY();
      els.props.appendChild(propNum("Радиус внеш.", el.rOuter, (v) => patch("rOuter", v), { min: 4 }));
      els.props.appendChild(propNum("Радиус внут.", el.rInner, (v) => patch("rInner", v), { min: 0 }));
      els.props.appendChild(propNum("Радиус подп.", el.labelRadius, (v) => patch("labelRadius", v)));
      els.props.appendChild(propNum("Начало °", el.startAngle, (v) => patch("startAngle", v)));
      els.props.appendChild(propNum("Конец °", el.endAngle, (v) => patch("endAngle", v)));
      els.props.appendChild(propNum("Делений", el.majorCount, (v) => patch("majorCount", v), { min: 2 }));
      els.props.appendChild(propNum("Промежут.", el.minorPerMajor, (v) => patch("minorPerMajor", v), { min: 0 }));
      els.props.appendChild(propNum("Значение мин.", el.minVal, (v) => patch("minVal", v)));
      els.props.appendChild(propNum("Значение макс.", el.maxVal, (v) => patch("maxVal", v)));
      els.props.appendChild(propCheck("Подписи", el.showLabels, (v) => patch("showLabels", v)));
      els.props.appendChild(propCheck("Показать дугу", el.showArc !== false, (v) => patch("showArc", v)));
      els.props.appendChild(
        propNum("Толщина дуги", el.arcThickness ?? 2, (v) => patch("arcThickness", Math.max(1, Math.round(v))), {
          min: 1,
          max: 40,
        })
      );
      els.props.appendChild(propColor("Цвет дуги", el.arcColor, (v) => patch("arcColor", v)));
      els.props.appendChild(propColor("Цвет делений", el.majorColor, (v) => patch("majorColor", v)));
      els.props.appendChild(propColor("Цвет промежут.", el.minorColor, (v) => patch("minorColor", v)));
      els.props.appendChild(propColor("Цвет текста", el.labelColor, (v) => patch("labelColor", v)));
      break;
    case "arc":
      commonXY();
      els.props.appendChild(propNum("Радиус", el.r, (v) => patch("r", v), { min: 1 }));
      els.props.appendChild(propNum("Начало °", el.startAngle, (v) => patch("startAngle", v)));
      els.props.appendChild(propNum("Конец °", el.endAngle, (v) => patch("endAngle", v)));
      els.props.appendChild(propNum("Толщина", el.thickness, (v) => patch("thickness", v), { min: 1 }));
      els.props.appendChild(propColor("Цвет", el.stroke, (v) => patch("stroke", v)));
      break;
    case "circle":
      commonXY();
      els.props.appendChild(propNum("Радиус", el.r, (v) => patch("r", v), { min: 1 }));
      els.props.appendChild(propCheck("Заливка", el.filled, (v) => patch("filled", v)));
      els.props.appendChild(propColor("Цвет обводки", el.stroke, (v) => patch("stroke", v)));
      els.props.appendChild(propColor("Цвет заливки", el.fill, (v) => patch("fill", v)));
      break;
    case "sector":
      commonXY();
      els.props.appendChild(propNum("Радиус", el.r, (v) => patch("r", v), { min: 1 }));
      els.props.appendChild(propNum("Начало °", el.startAngle, (v) => patch("startAngle", v)));
      els.props.appendChild(propNum("Конец °", el.endAngle, (v) => patch("endAngle", v)));
      els.props.appendChild(propColor("Цвет", el.fill, (v) => patch("fill", v)));
      break;
    case "line":
      els.props.appendChild(propNum("X начало", el.x1, (v) => patch("x1", Math.round(v))));
      els.props.appendChild(propNum("Y начало", el.y1, (v) => patch("y1", Math.round(v))));
      els.props.appendChild(propNum("X конец", el.x2, (v) => patch("x2", Math.round(v))));
      els.props.appendChild(propNum("Y конец", el.y2, (v) => patch("y2", Math.round(v))));
      els.props.appendChild(propNum("Толщина", el.thickness ?? 1, (v) => patch("thickness", Math.max(1, Math.round(v))), { min: 1, max: 40 }));
      els.props.appendChild(propColor("Цвет", el.stroke, (v) => patch("stroke", v)));
      break;
    case "rect":
      els.props.appendChild(propNum("X", el.x, (v) => patch("x", Math.round(v))));
      els.props.appendChild(propNum("Y", el.y, (v) => patch("y", Math.round(v))));
      els.props.appendChild(propNum("Ширина", el.w, (v) => patch("w", Math.round(v)), { min: 1 }));
      els.props.appendChild(propNum("Высота", el.h, (v) => patch("h", Math.round(v)), { min: 1 }));
      els.props.appendChild(propCheck("Заливка", el.filled, (v) => patch("filled", v)));
      els.props.appendChild(propColor("Цвет обводки", el.stroke, (v) => patch("stroke", v)));
      els.props.appendChild(propColor("Цвет заливки", el.fill, (v) => patch("fill", v)));
      break;
    case "text":
      els.props.appendChild(propNum("X", el.x, (v) => patch("x", Math.round(v))));
      els.props.appendChild(propNum("Y", el.y, (v) => patch("y", Math.round(v))));
      els.props.appendChild(propText("Текст", el.text, (v) => patch("text", v)));
      els.props.appendChild(propNum("Размер шрифта", el.fontSize, (v) => patch("fontSize", v), { min: 6 }));
      els.props.appendChild(propColor("Цвет", el.fill, (v) => patch("fill", v)));
      break;
    default:
      break;
  }

  const actions = document.createElement("div");
  actions.className = "prop-actions";
  const dup = document.createElement("button");
  dup.type = "button";
  dup.className = "ghost";
  dup.textContent = "Копия";
  dup.addEventListener("click", duplicateSelected);
  const del = document.createElement("button");
  del.type = "button";
  del.className = "ghost danger";
  del.textContent = "Удалить";
  del.addEventListener("click", deleteSelected);
  actions.append(dup, del);
  els.props.appendChild(actions);
}

function canvasPoint(e) {
  const rect = els.canvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) / state.zoom,
    y: (e.clientY - rect.top) / state.zoom,
  };
}

function hitTest(x, y) {
  for (let i = state.project.widgets.length - 1; i >= 0; i--) {
    const el = state.project.widgets[i];
    const b = elementBounds(el);
    const pad = 3;
    if (x >= b.x - pad && x <= b.x + b.w + pad && y >= b.y - pad && y <= b.y + b.h + pad) return el;
  }
  return null;
}

function deleteSelected() {
  if (!state.selectedId) return;
  state.project.widgets = state.project.widgets.filter((w) => w.id !== state.selectedId);
  state.selectedId = null;
  redraw();
}

function duplicateSelected() {
  const el = selected();
  if (!el) return;
  const copy = structuredClone(el);
  copy.id = nextId();
  copy.name = `${el.name} copy`;
  if ("cx" in copy) {
    copy.cx += 8;
    copy.cy += 8;
  } else if ("x" in copy) {
    copy.x += 8;
    copy.y += 8;
  } else if ("x1" in copy) {
    copy.x1 += 8;
    copy.y1 += 8;
    copy.x2 += 8;
    copy.y2 += 8;
  }
  state.project.widgets.push(copy);
  state.selectedId = copy.id;
  redraw();
}

function moveElement(el, dx, dy) {
  if ("cx" in el) {
    el.cx = Math.round(el.cx + dx);
    el.cy = Math.round(el.cy + dy);
  } else if ("x1" in el) {
    el.x1 = Math.round(el.x1 + dx);
    el.y1 = Math.round(el.y1 + dy);
    el.x2 = Math.round(el.x2 + dx);
    el.y2 = Math.round(el.y2 + dy);
  } else if ("x" in el) {
    el.x = Math.round(el.x + dx);
    el.y = Math.round(el.y + dy);
  }
}

els.canvas.addEventListener("mousedown", (e) => {
  if (e.button !== 0 || e.altKey) return;
  const p = canvasPoint(e);
  const hit = hitTest(p.x, p.y);
  if (hit) {
    state.selectedId = hit.id;
    state.drag = { id: hit.id, lx: p.x, ly: p.y };
  } else {
    state.selectedId = null;
    state.drag = null;
  }
  redraw();
});

window.addEventListener("mousemove", (e) => {
  if (!state.drag) return;
  const el = state.project.widgets.find((w) => w.id === state.drag.id);
  if (!el) return;
  const p = canvasPoint(e);
  moveElement(el, p.x - state.drag.lx, p.y - state.drag.ly);
  state.drag.lx = p.x;
  state.drag.ly = p.y;
  redraw();
});

window.addEventListener("mouseup", () => {
  state.drag = null;
});

window.addEventListener("keydown", (e) => {
  if (e.target.matches("input, textarea, select")) return;
  if (e.key === "Delete" || e.key === "Backspace") {
    e.preventDefault();
    deleteSelected();
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
    e.preventDefault();
    duplicateSelected();
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
    e.preventDefault();
    saveProject();
  }
});

function copyText(text) {
  navigator.clipboard.writeText(text).then(
    () => {},
    () => {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
  );
}

els.display.addEventListener("change", () => {
  state.project.displayId = els.display.value;
  if (state.project.displayId === "custom") {
    const w = prompt("Ширина (px)", state.project.width);
    const h = prompt("Высота (px)", state.project.height);
    if (w && h) {
      state.project.width = Math.max(16, Math.min(1024, Number(w)));
      state.project.height = Math.max(16, Math.min(1024, Number(h)));
    }
  }
  applyDisplayCascade();
});

els.orient.addEventListener("change", () => {
  state.project.orientationId = els.orient.value;
  applyDisplayCascade();
});

els.library.addEventListener("change", () => {
  state.project.libraryId = els.library.value;
  refreshCode();
  renderProps();
});

$("btn-zoom-in").addEventListener("click", () => {
  state.zoom = Math.min(8, Math.round((state.zoom + 0.25) * 100) / 100);
  applyZoom();
});
$("btn-zoom-out").addEventListener("click", () => {
  state.zoom = Math.max(0.5, Math.round((state.zoom - 0.25) * 100) / 100);
  applyZoom();
});

// Ctrl + колесо — зум; обычное колесо — нативный скролл рабочей области
els.stageWrap.addEventListener(
  "wheel",
  (e) => {
    if (!e.ctrlKey && !e.metaKey) return; // scroll as usual
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.25 : 0.25;
    const prev = state.zoom;
    state.zoom = Math.min(8, Math.max(0.5, Math.round((state.zoom + delta) * 100) / 100));
    if (state.zoom === prev) return;
    // zoom toward cursor
    const rect = els.stageWrap.getBoundingClientRect();
    const mx = e.clientX - rect.left + els.stageWrap.scrollLeft;
    const my = e.clientY - rect.top + els.stageWrap.scrollTop;
    const ratio = state.zoom / prev;
    applyZoom();
    els.stageWrap.scrollLeft = mx * ratio - (e.clientX - rect.left);
    els.stageWrap.scrollTop = my * ratio - (e.clientY - rect.top);
  },
  { passive: false }
);

// Средняя кнопка / Alt+ЛКМ — панорамирование
let pan = null;
els.stageWrap.addEventListener("mousedown", (e) => {
  if (e.button === 1 || (e.button === 0 && e.altKey)) {
    e.preventDefault();
    pan = { x: e.clientX, y: e.clientY, sl: els.stageWrap.scrollLeft, st: els.stageWrap.scrollTop };
    els.stageWrap.classList.add("panning");
  }
});
window.addEventListener("mousemove", (e) => {
  if (!pan) return;
  els.stageWrap.scrollLeft = pan.sl - (e.clientX - pan.x);
  els.stageWrap.scrollTop = pan.st - (e.clientY - pan.y);
});
window.addEventListener("mouseup", () => {
  if (!pan) return;
  pan = null;
  els.stageWrap.classList.remove("panning");
});
els.stageWrap.addEventListener("auxclick", (e) => {
  if (e.button === 1) e.preventDefault(); // no autoscroll quirk
});

els.stageWrap.addEventListener("scroll", () => {
  if (!_scrollSyncing) syncScrollSliders();
});
els.scrollH?.addEventListener("input", () => {
  if (_scrollSyncing) return;
  els.stageWrap.scrollLeft = Number(els.scrollH.value);
});
els.scrollV?.addEventListener("input", () => {
  if (_scrollSyncing) return;
  els.stageWrap.scrollTop = Number(els.scrollV.value);
});
window.addEventListener("resize", () => syncScrollSliders());

els.btnGrid.addEventListener("click", () => {
  state.showGrid = !state.showGrid;
  els.btnGrid.classList.toggle("active", state.showGrid);
  redraw();
});

$("btn-copy-el").addEventListener("click", () => copyText(els.codeEl.textContent));
$("btn-copy-screen").addEventListener("click", () => copyText(els.codeScreen.textContent));
$("btn-copy-all").addEventListener("click", () => {
  // открыть панель если закрыта, затем копировать
  setCodeDock(true);
  copyText(els.codeScreen.textContent);
});

function setCodeDock(open) {
  const dock = $("code-dock");
  const app = $("app");
  const btn = $("btn-code");
  if (open) {
    dock.hidden = false;
    app.classList.add("code-open");
    btn.classList.add("active");
  } else {
    dock.hidden = true;
    app.classList.remove("code-open");
    btn.classList.remove("active");
  }
  requestAnimationFrame(syncScrollSliders);
}

$("btn-code").addEventListener("click", () => {
  setCodeDock($("code-dock").hidden);
});
$("btn-code-close").addEventListener("click", () => setCodeDock(false));

/** Resize side panels */
function bindPanelSplit(handleId, cssVar, { min, max, fromRight }) {
  const handle = $(handleId);
  const body = $("body");
  let drag = null;
  handle.addEventListener("mousedown", (e) => {
    e.preventDefault();
    drag = {
      startX: e.clientX,
      startW: parseFloat(getComputedStyle(body).getPropertyValue(cssVar)) || (fromRight ? 300 : 96),
    };
    handle.classList.add("dragging");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  });
  window.addEventListener("mousemove", (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    let w = fromRight ? drag.startW - dx : drag.startW + dx;
    w = Math.max(min, Math.min(max, w));
    body.style.setProperty(cssVar, `${Math.round(w)}px`);
    syncScrollSliders();
  });
  window.addEventListener("mouseup", () => {
    if (!drag) return;
    drag = null;
    handle.classList.remove("dragging");
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  });
}

bindPanelSplit("split-rail", "--rail-w", { min: 64, max: 280, fromRight: false });
bindPanelSplit("split-insp", "--insp-w", { min: 200, max: 520, fromRight: true });

function saveProject() {
  const name = prompt("Имя проекта", state.project.name || "Untitled");
  if (name) state.project.name = name;
  const blob = new Blob([JSON.stringify(state.project, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${state.project.name || "gui-draw-master"}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

$("btn-save").addEventListener("click", saveProject);
$("btn-new").addEventListener("click", () => {
  if (!confirm("Новый проект?")) return;
  const d = state.project.displayId;
  const o = state.project.orientationId;
  const lib = state.project.libraryId;
  state.project = createProject();
  state.project.displayId = d;
  state.project.orientationId = o;
  state.project.libraryId = lib;
  applyDisplayCascade();
  state.selectedId = null;
  els.display.value = d;
  els.orient.value = o;
  redraw();
});

$("btn-open").addEventListener("click", () => els.fileOpen.click());
els.fileOpen.addEventListener("change", async () => {
  const file = els.fileOpen.files?.[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data.width || !Array.isArray(data.widgets)) throw new Error("Неверный JSON");
    state.project = data;
    state.selectedId = null;
    let max = 0;
    for (const w of data.widgets) {
      const m = /^el(\d+)$/.exec(w.id || "");
      if (m) max = Math.max(max, Number(m[1]));
    }
    resetIdCounter(max + 1);
    els.display.value = data.displayId || "tft_240x320";
    els.orient.value = data.orientationId || "portrait";
    fillLibraries();
    els.library.value = data.libraryId || state.project.libraryId;
    redraw();
  } catch (err) {
    alert("Ошибка: " + err.message);
  }
  els.fileOpen.value = "";
});

// boot
fillDisplays();
fillOrients();
els.display.value = state.project.displayId;
els.orient.value = state.project.orientationId;
fillLibraries();
renderToolbox();
redraw();
