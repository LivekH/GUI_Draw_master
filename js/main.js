import { DISPLAYS, ORIENTATIONS, LIBRARIES, filterLibraries, resolveSize, getDisplay } from "./catalog.js";
import { TOOLS, createProject, createElement, elementBounds, resetIdCounter, nextId, nextGroupId, resetGroupCounter, getGroup, groupMembers } from "./models.js";
import { renderProject } from "./renderer.js";
import { codegenObject, codegenScreen } from "./codegen.js";
import { format565 } from "./color.js";
import {
  readFileAsDataURL,
  loadImage,
  fitSize,
  rasterizeBitmap,
  bitsToImageData,
  rgb565ToImageData,
} from "./bitmap.js";

const state = {
  project: createProject(),
  selectedIds: [],
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
  fileImg: $("file-img"),
  btnGrid: $("btn-grid"),
  rulerH: $("ruler-h"),
  rulerV: $("ruler-v"),
  stageWrap: $("stage-wrap") || document.querySelector(".stage-wrap"),
  scrollH: $("scroll-h"),
  scrollV: $("scroll-v"),
  bgSwatches: $("bg-swatches"),
  cursorPos: $("cursor-pos"),
};

const ctx = els.canvas.getContext("2d");

function currentLib() {
  return LIBRARIES.find((l) => l.id === state.project.libraryId) || LIBRARIES[0];
}

function selected() {
  const id = state.selectedIds[state.selectedIds.length - 1];
  if (!id) return null;
  return state.project.widgets.find((w) => w.id === id) || null;
}

function isSelected(id) {
  return state.selectedIds.includes(id);
}

function setSelection(ids) {
  state.selectedIds = [...new Set(ids.filter(Boolean))];
}

function toggleSelection(id) {
  if (isSelected(id)) setSelection(state.selectedIds.filter((x) => x !== id));
  else setSelection([...state.selectedIds, id]);
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
  const ids = state.selectedIds;
  if (!ids.length) {
    els.selbox.classList.add("hidden");
    return;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let any = false;
  for (const id of ids) {
    const el = state.project.widgets.find((w) => w.id === id);
    if (!el || el.visible === false) continue;
    const b = elementBounds(el);
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
    any = true;
  }
  if (!any) {
    els.selbox.classList.add("hidden");
    return;
  }
  const z = state.zoom;
  els.selbox.classList.remove("hidden");
  els.selbox.style.left = `${minX * z}px`;
  els.selbox.style.top = `${minY * z}px`;
  els.selbox.style.width = `${(maxX - minX) * z}px`;
  els.selbox.style.height = `${(maxY - minY) * z}px`;
}

function refreshCode() {
  const lib = currentLib();
  els.libTag.textContent = lib.label;
  const el = selected();
  if (state.selectedIds.length > 1) {
    els.codeEl.textContent = `// выделено элементов: ${state.selectedIds.length}\n// в коде экрана группа будет одним блоком с комментариями`;
  } else {
    els.codeEl.textContent = el ? codegenObject(el, lib) : "// выберите элемент на холсте";
  }
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
    btn.innerHTML = `<span class="g">${t.glyph}</span>${t.label}`;
    btn.addEventListener("click", () => {
      if (t.type === "bitmap") {
        els.fileImg?.click();
        return;
      }
      const el = createElement(t.type, state.project.width, state.project.height);
      state.project.widgets.push(el);
      setSelection([el.id]);
      redraw();
    });
    attachHelp(btn, t.label, t.hint);
    els.toolbox.appendChild(btn);
  }
}

async function refreshBitmapElement(el) {
  if (!el || el.type !== "bitmap" || !el.srcDataUrl) return;
  const mode = el.colorMode === "rgb565" ? "rgb565" : "mono";
  const result = await rasterizeBitmap(el.srcDataUrl, el.w, el.h, {
    mode,
    threshold: el.threshold ?? 128,
    invert: !!el.invert,
  });
  el.bits = result.bits;
  el.rgb = result.rgb;
  el.bytes = result.bytes;
  el.w = result.w;
  el.h = result.h;
  const idata =
    mode === "rgb565" && result.rgb
      ? rgb565ToImageData(result.rgb, result.w, result.h)
      : bitsToImageData(result.bits, result.w, result.h);
  const c = document.createElement("canvas");
  c.width = result.w;
  c.height = result.h;
  c.getContext("2d").putImageData(idata, 0, 0);
  el._preview = c;
}

async function importImageFile(file) {
  if (!file) return;
  const dataUrl = await readFileAsDataURL(file);
  const img = await loadImage(dataUrl);
  const maxW = Math.min(state.project.width, 320);
  const maxH = Math.min(state.project.height, 240);
  const { w, h } = fitSize(img.width, img.height, maxW, maxH);
  const el = createElement("bitmap", state.project.width, state.project.height);
  el.name = (file.name || "Иконка").replace(/\.[^.]+$/, "").slice(0, 40) || "Иконка";
  el.srcDataUrl = dataUrl;
  el.w = w;
  el.h = h;
  el.x = Math.round((state.project.width - w) / 2);
  el.y = Math.round((state.project.height - h) / 2);
  await refreshBitmapElement(el);
  state.project.widgets.push(el);
  setSelection([el.id]);
  redraw();
}

function makeVisBtn(visible, onToggle) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "vis" + (visible === false ? " off" : "");
  btn.title = visible === false ? "Показать" : "Скрыть";
  btn.textContent = visible === false ? "⊘" : "◉";
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    onToggle();
  });
  return btn;
}

function renderLayers() {
  els.layers.innerHTML = "";
  if (!state.project.groups) state.project.groups = [];
  const emitted = new Set();

  const addElRow = (w, nested) => {
    const li = document.createElement("li");
    li.className =
      (isSelected(w.id) ? "selected " : "") +
      (nested ? "nested " : "") +
      (w.visible === false ? "hidden-el" : "");
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = w.name;
    const typ = document.createElement("span");
    typ.className = "t";
    typ.textContent = w.type;
    li.append(makeVisBtn(w.visible !== false, () => {
      w.visible = w.visible === false;
      redraw();
    }), name, typ);
    li.addEventListener("click", (e) => {
      if (e.ctrlKey || e.metaKey) toggleSelection(w.id);
      else setSelection([w.id]);
      redraw();
    });
    els.layers.appendChild(li);
  };

  for (const w of [...state.project.widgets].reverse()) {
    if (emitted.has(w.id)) continue;
    if (w.groupId) {
      const members = groupMembers(state.project, w.groupId);
      for (const m of members) emitted.add(m.id);
      const g = getGroup(state.project, w.groupId);
      const li = document.createElement("li");
      const allSelected = members.length && members.every((m) => isSelected(m.id));
      li.className = "group-row" + (allSelected ? " selected" : "");
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = `▸ ${g?.name || "Группа"}`;
      const typ = document.createElement("span");
      typ.className = "t";
      typ.textContent = `${members.length}`;
      const anyVisible = members.some((m) => m.visible !== false);
      li.append(
        makeVisBtn(anyVisible, () => {
          const show = !anyVisible;
          for (const m of members) m.visible = show;
          redraw();
        }),
        name,
        typ
      );
      li.addEventListener("click", (e) => {
        const ids = members.map((m) => m.id);
        if (e.ctrlKey || e.metaKey) {
          for (const id of ids) {
            if (!isSelected(id)) state.selectedIds.push(id);
          }
          setSelection(state.selectedIds);
        } else setSelection(ids);
        redraw();
      });
      els.layers.appendChild(li);
      for (const m of [...members].reverse()) addElRow(m, true);
    } else {
      emitted.add(w.id);
      addElRow(w, false);
    }
  }
}

const HELP_DELAY_MS = 10000;

const PROP_HELP = {
  Имя: "Имя элемента. Попадает в комментарий перед блоком кода — удобно искать в скетче.",
  "Центр X":
    "Горизонталь центра в пикселях (0 — левый край). Кнопка «центр» ставит середину ширины текущего экрана — полезно после смены ориентации.",
  "Центр Y":
    "Вертикаль центра в пикселях (0 — верх). Кнопка «центр» ставит середину высоты экрана.",
  "Радиус внеш.": "Внешний радиус дуги шкалы и концов делений.",
  "Радиус внут.": "Внутренний край major-делений. Чем меньше разница с внешним — тем короче штрихи.",
  "Радиус подп.": "Радиус размещения числовых подписей (обычно чуть меньше внутренней зоны).",
  "Начало °":
    "Угол начала дуги. 0° — вверх, 90° — вправо, −90° / 270° — влево. Для шкалы слева→направо часто −120…120.",
  "Конец °": "Угол конца дуги. Вместе с «Начало °» задаёт сектор прибора.",
  Делений: "Число крупных (major) рисок, включая крайние. Подписей столько же.",
  "Промежут.": "Сколько мелких делений между соседними крупными.",
  "Значение мин.": "Число на первом конце дуги (если не включена инверсия).",
  "Значение макс.": "Число на втором конце дуги (если не включена инверсия).",
  "Инвертировать шкалу":
    "Меняет местами мин и макс по дуге: 0 оказывается у «Конец °», максимум у «Начало °». Удобно для классических приборов слева→направо.",
  "Основные деления": "Крупные риски шкалы (major). Можно выключить, оставив только цифры или мелкие штрихи.",
  "Доп. деления": "Мелкие риски между основными. Число задаётся полем «Промежут.»",
  "Цифровые значения": "Числа у основных делений (мин…макс). Не зависят от рисок — можно показать только цифры.",
  "Режим шрифта": "setTextSize(1/2/3) в коде библиотеки (GFX/TFT_eSPI). Влияет на размер цифр на реальном дисплее.",
  "Высота шрифта": "Высота цифр шкалы в пикселях на холсте редактора (превью). В код уходит «Режим шрифта» (setTextSize).",
  "Показать дугу": "Рисовать основную дугу шкалы (без неё остаются только деления/цифры).",
  "Толщина дуги": "Толщина дуги шкалы в пикселях. В коде: drawArc или несколько концентрических линий.",
  "Цвет дуги": "Цвет дуги шкалы (в коде — RGB565 или mono).",
  "Цвет делений": "Цвет крупных рисок.",
  "Цвет промежут.": "Цвет мелких рисок.",
  "Цвет текста": "Цвет числовых подписей шкалы.",
  Радиус: "Радиус окружности / сектора / дуги в пикселях.",
  Толщина: "Толщина линии или дуги. >1: drawWideLine или эмуляция несколькими линиями.",
  Цвет: "Цвет элемента в палитре редактора → в коде RGB565 / mono.",
  "Цвет обводки": "Цвет контура, если заливка выключена.",
  "Цвет заливки": "Цвет заливки при включённой галочке «Заливка».",
  Заливка: "Вкл — сплошная заливка (fillRect/fillCircle). Выкл — только контур (drawRect/drawCircle).",
  "X начало": "X первой точки линии.",
  "Y начало": "Y первой точки линии.",
  "X конец": "X второй точки линии.",
  "Y конец": "Y второй точки линии.",
  X: "Левый край (для рамки) или позиция текста по X.",
  Y: "Верхний край (для рамки) или позиция текста по Y.",
  Ширина: "Ширина прямоугольника в пикселях.",
  Высота: "Высота прямоугольника в пикселях.",
  Текст: "Строка, которая уйдёт в print / drawStr.",
  "Размер шрифта": "Высота текста в пикселях на холсте (превью).",
  "Режим текста": "setTextSize(1/2/3) для кода на дисплее. При смене режима высота превью подстраивается (~8 px × размер).",
  "Режим иконки": "Ч/Б (1-bit, мало flash) или Цвет RGB565 (2 байта на пиксель, для TFT). На mono OLED лучше Ч/Б.",
  "Ширина иконки": "Ширина bitmap после масштаба (px). Пересчитывает массив.",
  "Высота иконки": "Высота bitmap после масштаба (px).",
  Порог: "Только для Ч/Б: яркость 0…255, темнее = пиксель «вкл». Обычно 128.",
  Инверсия: "Только для Ч/Б: поменять чёрное/белое.",
  "Цвет (draw)": "Только для Ч/Б на цветном TFT: цвет «включённых» пикселей в drawBitmap.",
  "Размер flash": "Сколько байт займёт массив во flash МК.",
};

/** Подсказка после удержания курсора ~10 с */
const helpTip = (() => {
  const tip = document.createElement("div");
  tip.className = "help-tip";
  tip.setAttribute("role", "tooltip");
  document.body.appendChild(tip);
  let timer = null;
  let activeEl = null;

  const hide = () => {
    tip.classList.remove("visible");
    tip.innerHTML = "";
  };

  const show = (el, title, text, ev) => {
    tip.innerHTML = `<strong>${title}</strong>${text}`;
    tip.classList.add("visible");
    const pad = 12;
    let x = (ev?.clientX ?? 0) + 14;
    let y = (ev?.clientY ?? 0) + 16;
    tip.style.left = "0px";
    tip.style.top = "0px";
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    if (x + tw > window.innerWidth - pad) x = window.innerWidth - tw - pad;
    if (y + th > window.innerHeight - pad) y = window.innerHeight - th - pad;
    if (x < pad) x = pad;
    if (y < pad) y = pad;
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  };

  return {
    attach(el, title, text) {
      if (!el || !text) return;
      let lastEv = null;
      el.addEventListener("mouseenter", (e) => {
        activeEl = el;
        lastEv = e;
        clearTimeout(timer);
        timer = setTimeout(() => {
          if (activeEl === el) show(el, title, text, lastEv);
        }, HELP_DELAY_MS);
      });
      el.addEventListener("mousemove", (e) => {
        lastEv = e;
        if (tip.classList.contains("visible") && activeEl === el) {
          show(el, title, text, e);
        }
      });
      el.addEventListener("mouseleave", () => {
        if (activeEl === el) activeEl = null;
        clearTimeout(timer);
        hide();
      });
    },
  };
})();

function attachHelp(el, title, text) {
  helpTip.attach(el, title, text);
}

function propNum(label, val, onChange, opts = {}) {
  const row = document.createElement("div");
  row.className = "prop-row" + (opts.action ? " has-action" : "");
  row.innerHTML = `<label>${label}</label>`;
  const input = document.createElement("input");
  input.type = "number";
  input.value = val;
  if (opts.step != null) input.step = opts.step;
  if (opts.min != null) input.min = opts.min;
  if (opts.max != null) input.max = opts.max;
  input.addEventListener("change", () => onChange(Number(input.value)));
  row.appendChild(input);
  if (opts.action) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "prop-action-btn";
    btn.textContent = opts.action.label;
    btn.title = opts.action.title || opts.action.label;
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      opts.action.onClick();
    });
    row.appendChild(btn);
  }
  const help = opts.help || PROP_HELP[label];
  if (help) attachHelp(row, label, help);
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
  const help = PROP_HELP[label];
  if (help) attachHelp(row, label, help);
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
  const help = PROP_HELP[label];
  if (help) attachHelp(row, label, help);
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
  const help = PROP_HELP[label];
  if (help) attachHelp(row, label, help);
  return row;
}

function propSelect(label, val, options, onChange) {
  const row = document.createElement("div");
  row.className = "prop-row";
  row.innerHTML = `<label>${label}</label>`;
  const sel = document.createElement("select");
  for (const o of options) {
    const opt = document.createElement("option");
    opt.value = String(o.value);
    opt.textContent = o.label;
    sel.appendChild(opt);
  }
  sel.value = String(val);
  sel.addEventListener("change", () => onChange(sel.value));
  row.appendChild(sel);
  const help = PROP_HELP[label];
  if (help) attachHelp(row, label, help);
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
      els.props.appendChild(
        propNum("Центр X", el.cx, (v) => patch("cx", Math.round(v)), {
          action: {
            label: "центр",
            title: "Середина ширины экрана",
            onClick: () => {
              el.cx = Math.round(state.project.width / 2);
              redraw();
              renderProps();
            },
          },
        })
      );
      els.props.appendChild(
        propNum("Центр Y", el.cy, (v) => patch("cy", Math.round(v)), {
          action: {
            label: "центр",
            title: "Середина высоты экрана",
            onClick: () => {
              el.cy = Math.round(state.project.height / 2);
              redraw();
              renderProps();
            },
          },
        })
      );
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
      els.props.appendChild(
        propCheck("Инвертировать шкалу", !!el.invertValues, (v) => patch("invertValues", v))
      );
      els.props.appendChild(propCheck("Показать дугу", el.showArc !== false, (v) => patch("showArc", v)));
      els.props.appendChild(
        propCheck("Основные деления", el.showMajorTicks !== false, (v) => patch("showMajorTicks", v))
      );
      els.props.appendChild(
        propCheck("Доп. деления", el.showMinorTicks !== false, (v) => patch("showMinorTicks", v))
      );
      els.props.appendChild(
        propCheck("Цифровые значения", el.showLabels !== false, (v) => patch("showLabels", v))
      );
      els.props.appendChild(
        propSelect(
          "Режим шрифта",
          el.labelTextSize ?? 1,
          [
            { value: 1, label: "setTextSize(1)" },
            { value: 2, label: "setTextSize(2)" },
            { value: 3, label: "setTextSize(3)" },
          ],
          (v) => {
            const ts = Math.max(1, Math.min(3, Number(v) || 1));
            el.labelTextSize = ts;
            el.labelFontSize = ts * 8;
            redraw();
            renderProps();
          }
        )
      );
      els.props.appendChild(
        propNum(
          "Высота шрифта",
          el.labelFontSize ?? (el.labelTextSize || 1) * 8,
          (v) => {
            const fs = Math.max(6, Math.round(v));
            el.labelFontSize = fs;
            el.labelTextSize = Math.max(1, Math.min(3, Math.round(fs / 8) || 1));
            redraw();
            renderProps();
          },
          { min: 6, max: 48 }
        )
      );
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
    case "sector": {
      const note = document.createElement("p");
      note.className = "muted";
      note.style.margin = "0 0 0.35rem";
      note.textContent =
        "Сектор — залитая зона от центра (как «красная зона» спидометра), не деления и не стрелка.";
      els.props.appendChild(note);
      commonXY();
      els.props.appendChild(propNum("Радиус", el.r, (v) => patch("r", v), { min: 1 }));
      els.props.appendChild(propNum("Начало °", el.startAngle, (v) => patch("startAngle", v)));
      els.props.appendChild(propNum("Конец °", el.endAngle, (v) => patch("endAngle", v)));
      els.props.appendChild(propColor("Цвет", el.fill, (v) => patch("fill", v)));
      break;
    }
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
      els.props.appendChild(
        propSelect(
          "Режим текста",
          el.textSize ?? Math.max(1, Math.min(3, Math.round((el.fontSize || 16) / 8) || 2)),
          [
            { value: 1, label: "setTextSize(1)" },
            { value: 2, label: "setTextSize(2)" },
            { value: 3, label: "setTextSize(3)" },
          ],
          (v) => {
            const ts = Math.max(1, Math.min(3, Number(v) || 1));
            el.textSize = ts;
            el.fontSize = ts * 8;
            redraw();
            renderProps();
          }
        )
      );
      els.props.appendChild(
        propNum(
          "Размер шрифта",
          el.fontSize,
          (v) => {
            const fs = Math.max(6, Math.round(v));
            el.fontSize = fs;
            el.textSize = Math.max(1, Math.min(3, Math.round(fs / 8) || 1));
            redraw();
            renderProps();
          },
          { min: 6, max: 64 }
        )
      );
      els.props.appendChild(propColor("Цвет", el.fill, (v) => patch("fill", v)));
      break;
    case "bitmap": {
      const isRgb = el.colorMode === "rgb565";
      const disp = getDisplay(state.project.displayId);
      const note = document.createElement("p");
      note.className = "muted";
      note.style.margin = "0 0 0.35rem";
      const modeLabel = isRgb ? "RGB565" : "1-bit";
      note.textContent = el.srcDataUrl
        ? `Flash ≈ ${el.bytes || 0} байт (${modeLabel}). Масштаб пересчитывает массив.`
        : "Импортируйте PNG/BMP кнопкой «Иконка» или инструментом слева.";
      if (isRgb && disp?.kind === "oled") {
        note.textContent += " На mono OLED лучше режим Ч/Б.";
      }
      els.props.appendChild(note);
      els.props.appendChild(propNum("X", el.x, (v) => patch("x", Math.round(v))));
      els.props.appendChild(propNum("Y", el.y, (v) => patch("y", Math.round(v))));
      els.props.appendChild(
        propSelect(
          "Режим иконки",
          el.colorMode || "mono",
          [
            { value: "mono", label: "Ч/Б (1-bit)" },
            { value: "rgb565", label: "Цвет RGB565" },
          ],
          async (v) => {
            el.colorMode = v === "rgb565" ? "rgb565" : "mono";
            await refreshBitmapElement(el);
            redraw();
            renderProps();
          }
        )
      );
      const rescale = async (nw, nh) => {
        el.w = Math.max(1, Math.min(800, Math.round(nw)));
        el.h = Math.max(1, Math.min(800, Math.round(nh)));
        await refreshBitmapElement(el);
        redraw();
      };
      els.props.appendChild(
        propNum("Ширина иконки", el.w, (v) => rescale(v, el.h), { min: 1, max: 800 })
      );
      els.props.appendChild(
        propNum("Высота иконки", el.h, (v) => rescale(el.w, v), { min: 1, max: 800 })
      );
      if (!isRgb) {
        els.props.appendChild(
          propNum(
            "Порог",
            el.threshold ?? 128,
            async (v) => {
              el.threshold = Math.max(0, Math.min(255, Math.round(v)));
              await refreshBitmapElement(el);
              redraw();
            },
            { min: 0, max: 255 }
          )
        );
        els.props.appendChild(
          propCheck("Инверсия", !!el.invert, async (v) => {
            el.invert = v;
            await refreshBitmapElement(el);
            redraw();
          })
        );
        els.props.appendChild(propColor("Цвет (draw)", el.color || "#ffffff", (v) => patch("color", v)));
      }
      const reimport = document.createElement("button");
      reimport.type = "button";
      reimport.className = "ghost";
      reimport.textContent = "Заменить файл…";
      reimport.addEventListener("click", () => {
        state._bitmapReplaceId = el.id;
        els.fileImg?.click();
      });
      els.props.appendChild(reimport);
      break;
    }
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

function updateCursorPos(e) {
  if (!els.cursorPos) return;
  const p = canvasPoint(e);
  const W = state.project.width;
  const H = state.project.height;
  if (p.x < 0 || p.y < 0 || p.x >= W || p.y >= H) {
    els.cursorPos.textContent = "x: —  y: —";
    return;
  }
  const x = Math.floor(p.x);
  const y = Math.floor(p.y);
  els.cursorPos.textContent = `x: ${x}  y: ${y}`;
}

function clearCursorPos() {
  if (els.cursorPos) els.cursorPos.textContent = "x: —  y: —";
}

function hitsAt(x, y) {
  const hits = [];
  for (let i = state.project.widgets.length - 1; i >= 0; i--) {
    const el = state.project.widgets[i];
    if (el.visible === false) continue;
    const b = elementBounds(el);
    const pad = 3;
    if (x >= b.x - pad && x <= b.x + b.w + pad && y >= b.y - pad && y <= b.y + b.h + pad) {
      hits.push(el);
    }
  }
  return hits;
}

function deleteSelected() {
  if (!state.selectedIds.length) return;
  const kill = new Set(state.selectedIds);
  state.project.widgets = state.project.widgets.filter((w) => !kill.has(w.id));
  // убрать пустые группы
  if (state.project.groups) {
    state.project.groups = state.project.groups.filter((g) =>
      state.project.widgets.some((w) => w.groupId === g.id)
    );
  }
  setSelection([]);
  redraw();
}

function duplicateSelected() {
  if (!state.selectedIds.length) return;
  const src = state.project.widgets.filter((w) => isSelected(w.id));
  if (!src.length) return;

  const groupMap = new Map();
  const newIds = [];
  for (const el of src) {
    const copy = structuredClone(el);
    copy.id = nextId();
    copy.name = `${el.name} copy`;
    if (el.groupId) {
      if (!groupMap.has(el.groupId)) {
        const oldG = getGroup(state.project, el.groupId);
        const gid = nextGroupId();
        if (!state.project.groups) state.project.groups = [];
        state.project.groups.push({ id: gid, name: `${oldG?.name || "Группа"} copy` });
        groupMap.set(el.groupId, gid);
      }
      copy.groupId = groupMap.get(el.groupId);
    }
    if ("cx" in copy) {
      copy.cx += 12;
      copy.cy += 12;
    } else if ("x" in copy) {
      copy.x += 12;
      copy.y += 12;
    } else if ("x1" in copy) {
      copy.x1 += 12;
      copy.y1 += 12;
      copy.x2 += 12;
      copy.y2 += 12;
    }
    state.project.widgets.push(copy);
    newIds.push(copy.id);
  }
  setSelection(newIds);
  Promise.all(
    state.project.widgets.filter((w) => newIds.includes(w.id) && w.type === "bitmap").map(refreshBitmapElement)
  ).then(() => redraw());
}

function createGroupFromSelection() {
  if (state.selectedIds.length < 2) {
    alert("Выделите минимум 2 элемента:\nCtrl+клик по слоям или на холсте.");
    return;
  }
  const name = prompt("Имя группы (например «Вольтметр»)", "Прибор");
  if (name == null || !String(name).trim()) return;
  const gid = nextGroupId();
  if (!state.project.groups) state.project.groups = [];
  state.project.groups.push({ id: gid, name: String(name).trim() });
  for (const id of state.selectedIds) {
    const w = state.project.widgets.find((x) => x.id === id);
    if (w) w.groupId = gid;
  }
  redraw();
}

function ungroupSelection() {
  const ids = state.selectedIds.length
    ? state.selectedIds
    : [];
  if (!ids.length) {
    alert("Выберите группу или её элементы.");
    return;
  }
  const gids = new Set();
  for (const id of ids) {
    const w = state.project.widgets.find((x) => x.id === id);
    if (w?.groupId) {
      gids.add(w.groupId);
      w.groupId = null;
    }
  }
  if (state.project.groups) {
    state.project.groups = state.project.groups.filter((g) => !gids.has(g.id));
  }
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
  const hits = hitsAt(p.x, p.y);
  if (!hits.length) {
    setSelection([]);
    state.drag = null;
    redraw();
    return;
  }

  let pick = hits[0];
  // повторный клик по тому же месту — следующий элемент под курсором (удобно при наложении)
  if (!e.ctrlKey && !e.metaKey && state.selectedIds.length === 1 && hits.length > 1) {
    const cur = state.selectedIds[0];
    const idx = hits.findIndex((h) => h.id === cur);
    if (idx >= 0) pick = hits[(idx + 1) % hits.length];
  }

  if (e.ctrlKey || e.metaKey) toggleSelection(pick.id);
  else setSelection([pick.id]);

  state.drag = { ids: [...state.selectedIds], lx: p.x, ly: p.y };
  redraw();
});

els.canvas.addEventListener("mousemove", updateCursorPos);
els.canvas.addEventListener("mouseleave", clearCursorPos);
els.stage?.addEventListener("mousemove", updateCursorPos);
els.stage?.addEventListener("mouseleave", clearCursorPos);

window.addEventListener("mousemove", (e) => {
  if (state.drag) updateCursorPos(e);
  if (!state.drag) return;
  const p = canvasPoint(e);
  const dx = p.x - state.drag.lx;
  const dy = p.y - state.drag.ly;
  for (const id of state.drag.ids) {
    const el = state.project.widgets.find((w) => w.id === id);
    if (el) moveElement(el, dx, dy);
  }
  state.drag.lx = p.x;
  state.drag.ly = p.y;
  redraw();
});

window.addEventListener("mouseup", () => {
  state.drag = null;
});

/** Горячие клавиши по физ. клавише (e.code), чтобы работало и на русской раскладке */
window.addEventListener(
  "keydown",
  (e) => {
    if (e.target.matches("input, textarea, select")) return;

    const mod = e.ctrlKey || e.metaKey;
    const code = e.code;

    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      e.stopPropagation();
      deleteSelected();
      return;
    }

    if (mod && code === "KeyD") {
      // иначе браузер: «Добавить в закладки»
      e.preventDefault();
      e.stopPropagation();
      duplicateSelected();
      return;
    }

    if (mod && code === "KeyG") {
      e.preventDefault();
      e.stopPropagation();
      createGroupFromSelection();
      return;
    }

    if (mod && code === "KeyS") {
      // иначе браузер: «Сохранить страницу»
      e.preventDefault();
      e.stopPropagation();
      saveProject();
      return;
    }
  },
  true // capture — перехватить до действий браузера
);

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
  const json = JSON.stringify(
    state.project,
    (k, v) => (k === "_preview" ? undefined : v),
    2
  );
  const blob = new Blob([json], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${state.project.name || "gui-draw-master"}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

$("btn-save").addEventListener("click", saveProject);
$("btn-import-img")?.addEventListener("click", () => {
  state._bitmapReplaceId = null;
  els.fileImg?.click();
});
els.fileImg?.addEventListener("change", async () => {
  const file = els.fileImg.files?.[0];
  els.fileImg.value = "";
  if (!file) return;
  try {
    if (state._bitmapReplaceId) {
      const el = state.project.widgets.find((w) => w.id === state._bitmapReplaceId);
      state._bitmapReplaceId = null;
      if (el && el.type === "bitmap") {
        el.srcDataUrl = await readFileAsDataURL(file);
        await refreshBitmapElement(el);
        setSelection([el.id]);
        redraw();
        return;
      }
    }
    await importImageFile(file);
  } catch (err) {
    alert("Импорт изображения: " + err.message);
  }
});
attachHelp(
  $("btn-import-img"),
  "Иконка PNG/BMP",
  "Импорт PNG/BMP на холст. В свойствах: Ч/Б или RGB565, масштаб. В коде: PROGMEM + drawBitmap / pushImage."
);

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
  setSelection([]);
  els.display.value = d;
  els.orient.value = o;
  redraw();
});

$("btn-group")?.addEventListener("click", createGroupFromSelection);
$("btn-ungroup")?.addEventListener("click", ungroupSelection);
attachHelp($("btn-group"), "Группа", "Объединить выделенные элементы (Ctrl+клик) в одну группу — удобно копировать прибор целиком.");
attachHelp($("btn-ungroup"), "Разгруппировать", "Убрать выбранные элементы из группы.");

$("btn-open").addEventListener("click", () => els.fileOpen.click());
els.fileOpen.addEventListener("change", async () => {
  const file = els.fileOpen.files?.[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data.width || !Array.isArray(data.widgets)) throw new Error("Неверный JSON");
    if (!data.groups) data.groups = [];
    for (const w of data.widgets) {
      if (w.visible === undefined) w.visible = true;
      if (w.groupId === undefined) w.groupId = null;
      if (w.type === "bitmap" && !w.colorMode) w.colorMode = "mono";
    }
    state.project = data;
    setSelection([]);
    let max = 0;
    let maxG = 0;
    for (const w of data.widgets) {
      const m = /^el(\d+)$/.exec(w.id || "");
      if (m) max = Math.max(max, Number(m[1]));
    }
    for (const g of data.groups) {
      const m = /^grp(\d+)$/.exec(g.id || "");
      if (m) maxG = Math.max(maxG, Number(m[1]));
    }
    resetIdCounter(max + 1);
    resetGroupCounter(maxG + 1);
    els.display.value = data.displayId || "tft_240x320";
    els.orient.value = data.orientationId || "portrait";
    fillLibraries();
    els.library.value = data.libraryId || state.project.libraryId;
    await Promise.all(
      state.project.widgets.filter((w) => w.type === "bitmap" && w.srcDataUrl).map(refreshBitmapElement)
    );
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

attachHelp(
  els.display.closest(".field") || els.display,
  "Дисплей",
  "Разрешение и тип экрана (OLED/TFT). Меняет размер холста. Сначала выберите дисплей, потом ориентацию и библиотеку."
);
attachHelp(
  els.orient.closest(".field") || els.orient,
  "Ориентация",
  "Поворот экрана (setRotation 0…3). Меняет ширину↔высоту холста. Рисунок сам не сдвигается — выберите элемент и нажмите «центр» у Центр X / Центр Y."
);
attachHelp(
  els.library.closest(".field") || els.library,
  "Библиотека",
  "Под какую draw-библиотеку генерировать код (TFT_eSPI, Adafruit GFX, U8g2…). Список зависит от типа дисплея."
);
attachHelp($("btn-new"), "Новый", "Очистить проект и начать с пустого экрана.");
attachHelp($("btn-open"), "Открыть", "Загрузить ранее сохранённый JSON проекта.");
attachHelp($("btn-save"), "Сохранить", "Скачать проект в JSON (удобно не потерять работу после обновления страницы).");
attachHelp($("btn-code"), "Код экрана", "Показать / скрыть панель с полным drawGui() для выбранной библиотеки.");
attachHelp($("btn-copy-all"), "Копировать код", "Скопировать код всего экрана в буфер обмена.");
attachHelp($("btn-grid"), "Сетка", "Включить / выключить пиксельную сетку на холсте.");

redraw();
