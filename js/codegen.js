/**
 * Code generators — map canvas objects → library draw calls
 */
import { format565, formatUtftColor, isOn, hexToRgb } from "./color.js?v=20260724i";
import { bitsToCArray, rgb565ToCArray, safeArrayName } from "./bitmap.js?v=20260724i";
import { libCallPrefix } from "./catalog.js?v=20260724i";

export function polar(cx, cy, r, deg) {
  const a = ((deg - 90) * Math.PI) / 180;
  return { x: Math.round(cx + r * Math.cos(a)), y: Math.round(cy + r * Math.sin(a)) };
}

export function tickPoints(scale) {
  const { cx, cy, rOuter, rInner, startAngle, endAngle, majorCount, minorPerMajor } = scale;
  const ticks = [];
  const majors = Math.max(2, majorCount | 0);
  const minors = Math.max(0, minorPerMajor | 0);
  const span = endAngle - startAngle;
  const steps = (majors - 1) * (minors + 1);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const ang = startAngle + span * t;
    const isMajor = i % (minors + 1) === 0;
    const ri = isMajor ? rInner : rInner + (rOuter - rInner) * 0.45;
    const a = polar(cx, cy, rOuter, ang);
    const b = polar(cx, cy, ri, ang);
    ticks.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, isMajor, ang, t });
  }
  return ticks;
}

export function scaleLabels(scale) {
  const { cx, cy, labelRadius, startAngle, endAngle, majorCount, minVal, maxVal, invertValues } =
    scale;
  const majors = Math.max(2, majorCount | 0);
  const out = [];
  for (let i = 0; i < majors; i++) {
    const t = i / (majors - 1);
    const ang = startAngle + (endAngle - startAngle) * t;
    const p = polar(cx, cy, labelRadius, ang);
    const vt = invertValues ? 1 - t : t;
    const val = minVal + (maxVal - minVal) * vt;
    const text =
      Number.isInteger(minVal) && Number.isInteger(maxVal) && Number.isInteger(val)
        ? String(Math.round(val))
        : (Math.round(val * 10) / 10).toString();
    out.push({ x: p.x, y: p.y, text, ang });
  }
  return out;
}

function esc(s) {
  return String(s ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Map UI orientation → Adafruit / TFT_eSPI rotation 0..3 */
export function orientationToRotation(orientationId) {
  switch (orientationId) {
    case "landscape":
      return 1; // 90°
    case "portrait_inv":
      return 2; // 180°
    case "landscape_inv":
      return 3; // 270°
    case "portrait":
    default:
      return 0; // 0°
  }
}

function orientationLabel(orientationId) {
  switch (orientationId) {
    case "landscape":
      return "альбом 90°";
    case "portrait_inv":
      return "портрет 180°";
    case "landscape_inv":
      return "альбом 270°";
    default:
      return "портрет 0°";
  }
}

function normArc(a) {
  return ((a % 360) + 360) % 360;
}

function colorExpr(lib, hex) {
  if (lib.color === "mono") {
    if (lib.family === "u8g2" || lib.family === "u8x8") return isOn(hex) ? "1" : "0";
    if (lib.family === "ssd1306_wire" || lib.family === "tiny4koled") {
      return isOn(hex) ? "WHITE" : "BLACK";
    }
    return isOn(hex) ? "SSD1306_WHITE" : "SSD1306_BLACK";
  }
  if (lib.color === "rgb565_utft") return formatUtftColor(hex);
  return format565(hex);
}

function push(lines, item) {
  if (Array.isArray(item)) lines.push(...item.filter(Boolean));
  else if (item) lines.push(item);
}

/** Добавить расшифровку параметров в конец строки кода */
function annotate(code, note) {
  if (!code) return code;
  if (Array.isArray(code)) {
    return code.map((ln, i) => (i === code.length - 1 ? annotate(ln, note) : ln));
  }
  const s = String(code);
  if (!s.trim() || s.trimStart().startsWith("//")) return s;
  if (/\s\/\/\s/.test(s)) return s;
  return `${s.replace(/\s+$/, "")} // ${note}`;
}

function arcParamNote(r0, r1, a0, a1, extra = "") {
  const th = Math.max(0, Math.round(r0) - Math.round(r1));
  const base = `центр x,y | r внешн,r внутр (толщ.≈${th}) | угол нач,кон | цвет`;
  return extra ? `${base} | ${extra}` : base;
}

/** Краткая легенда параметров дуги для шапки сгенерированного файла */
function arcLegendLines(lib) {
  const f = lib.family;
  if (f === "arduino_gfx" || f === "lovyangfx") {
    return [
      `// дуга: fillArc(x,y, rOuter,rInner, start°,end°, color) — заливка кольца; drawArc — только контур`,
      `// углы библиотеки: 0°=3ч (вправо), рост по часовой; толщина на экране ≈ rOuter−rInner (на железе/Proteus может чуть отличаться)`,
    ];
  }
  if (f === "tft_espi") {
    return [
      `// дуга: drawArc(x,y, rOuter,rInner, start°,end°, fg,bg, smooth) — заливка кольца встроена`,
      `// углы TFT_eSPI: 0°=6ч (вниз), рост по часовой; толщина ≈ rOuter−rInner+1`,
    ];
  }
  if (f === "u8g2") {
    return [
      `// дуга: drawArc(x,y, r, start,end) — углы 0…255; толщина = несколько вызовов с разным r`,
    ];
  }
  return [
    `// координаты: origin (0,0) — левый верх; у каждой строки — расшифровка аргументов`,
  ];
}

/** Толстая линия: drawWideLine или несколько параллельных drawLine */
function emitThickLine(api, x1, y1, x2, y2, thickness, col, lines) {
  const th = Math.max(1, Math.round(thickness || 1));
  if (th > 1 && api.wideLine) {
    push(lines, api.wideLine(x1, y1, x2, y2, th, col));
    return;
  }
  if (th <= 1) {
    push(lines, api.line(x1, y1, x2, y2, col));
    return;
  }
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const half = (th - 1) / 2;
  for (let i = 0; i < th; i++) {
    const o = i - half;
    const ox = Math.round(nx * o);
    const oy = Math.round(ny * o);
    push(lines, api.line(x1 + ox, y1 + oy, x2 + ox, y2 + oy, col));
  }
}

/** Дуга кусочками; thickness > 1 — концентрические радиусы (fallback) */
function emitArcApprox(api, cx, cy, r, a0, a1, col, lines, segments = 24, thickness = 1) {
  const th = Math.max(1, Math.round(thickness || 1));
  const span = a1 - a0;
  const n = Math.max(4, Math.round((Math.abs(span) / 360) * segments));
  for (let ring = 0; ring < th; ring++) {
    const rr = Math.max(1, r - ring);
    let prev = polar(cx, cy, rr, a0);
    for (let i = 1; i <= n; i++) {
      const ang = a0 + (span * i) / n;
      const p = polar(cx, cy, rr, ang);
      push(lines, api.line(prev.x, prev.y, p.x, p.y, col));
      prev = p;
    }
  }
}

/**
 * Система углов редактора (холст / polar / шкалы):
 *   0° = вверх (12ч), 90° = вправо, 180° = вниз, 270° = влево
 *   Рост угла = по часовой стрелке.
 *
 * Библиотеки (по исходникам / докам):
 *   TFT_eSPI:     0° = вниз (6ч), рост по часовой, градусы 0…360
 *   LovyanGFX / Arduino_GFX / LVGL:
 *                 0° = вправо (3ч), рост по часовой (cos/sin, Y вниз)
 *   U8g2:         0° = вправо (3ч), рост против часовой, единицы 0…255
 *
 * U8g2 — отражение ориентации (90−E), поэтому start/end меняем местами.
 * Полный оборот (|Δ|≥360°) не сдвигаем по нулю — иначе 0° и 360° схлопываются в одну точку.
 *
 * TFT_eSPI / Lovyan / Arduino_GFX рисуют дугу всегда по часовой от start к end
 * (если end < start — длинный обход через 0). В редакторе span = end−start может
 * быть отрицательным (короткая дуга против часовой) — тогда концы меняем местами,
 * иначе 90→55 на устройстве станет ~325° вместо ~35°.
 */
function isFullSweep(a0, a1) {
  return Math.abs(Number(a1) - Number(a0)) >= 359.5;
}

function toLibAngles(api, a0, a1) {
  const mode = api.arcAngle || "raw";
  const span = Number(a1) - Number(a0);

  // Полное кольцо → всегда 0…360 (U8g2: 0…255)
  if (isFullSweep(a0, a1)) {
    if (mode === "u8g2") return { a0: 0, a1: 255 };
    return { a0: 0, a1: 360 };
  }

  if (mode === "raw") {
    return { a0, a1 };
  }

  let s;
  let e;

  // TFT_eSPI: 0=6ч CW  ←  editor 0=12ч CW  ⇒  +180°
  if (mode === "tft_espi") {
    s = Math.round(normArc(a0 + 180));
    e = Math.round(normArc(a1 + 180));
  } else if (mode === "lovyan" || mode === "arduino_gfx") {
    // Lovyan / Arduino_GFX / LVGL: 0=3ч CW  ←  editor 0=12ч CW  ⇒  +270° (−90°)
    s = Math.round(normArc(a0 + 270));
    e = Math.round(normArc(a1 + 270));
  } else if (mode === "u8g2") {
    // U8g2: 0=3ч CCW, 0…255; отражение 90−E + swap концов
    const toU8 = (a) => Math.round((normArc(90 - a) * 256) / 360) % 256;
    return { a0: toU8(a1), a1: toU8(a0) };
  } else {
    return { a0, a1 };
  }

  // CW-only API: отрицательный span редактора → короткий сектор = swap концов
  if (span < 0) return { a0: e, a1: s };
  return { a0: s, a1: e };
}

/**
 * Толстая дуга редактора = заливка кольца между rOuter и rInner.
 *
 * Arduino_GFX / LovyanGFX:
 *   drawArc  — только контур (две тонкие дуги rOuter и rInner + торцы)
 *   fillArc  — заливка сектора кольца (нужно для «жирной» дуги)
 * TFT_eSPI:
 *   drawArc(r, ir, …) уже заливает кольцо толщиной r−ir+1 (отдельного fillArc нет)
 * U8g2: только drawArc(r) — толщину набираем несколькими радиусами
 */
function emitArc(api, cx, cy, r, a0, a1, col, lines, thickness = 1, segments = 24) {
  const th = Math.max(1, Math.round(thickness || 1));
  const rOuter = Math.max(1, Math.round(r));
  const rInner = Math.max(0, rOuter - th);

  if ((api.arc || api.fillArc) && !api.arcApprox) {
    const { a0: s, a1: e } = toLibAngles(api, a0, a1);
    if (api.arcRing) {
      // заливка кольца: fillArc если есть, иначе drawArc (TFT_eSPI)
      const emit = api.fillArc || api.arc;
      push(lines, emit(cx, cy, rOuter, rInner, s, e, col));
    } else if (api.arcSingle && api.arc) {
      for (let ring = 0; ring < th; ring++) {
        push(lines, api.arc(cx, cy, Math.max(1, rOuter - ring), 0, s, e, col));
      }
    } else if (api.fillArc) {
      push(lines, api.fillArc(cx, cy, rOuter, rInner, s, e, col));
    } else if (api.arc) {
      push(lines, api.arc(cx, cy, rOuter, rInner, s, e, col));
    }
    return;
  }

  if (th > 1) {
    lines.push(`// дуга: у «${api.libLabel || "этой библиотеки"}» нет fillArc/drawArc — эмуляция линиями`);
  }
  emitArcApprox(api, cx, cy, rOuter, a0, a1, col, lines, segments, th);
}

/** Залитый сектор (pie) */
function emitSector(api, cx, cy, r, a0, a1, col, lines) {
  if (api.fillArc && !api.arcApprox) {
    const { a0: s, a1: e } = toLibAngles(api, a0, a1);
    push(lines, api.fillArc(cx, cy, Math.max(1, r), 0, s, e, col));
    return;
  }
  const a = polar(cx, cy, r, a0);
  const b = polar(cx, cy, r, a1);
  push(lines, api.line(cx, cy, a.x, a.y, col));
  push(lines, api.line(cx, cy, b.x, b.y, col));
  emitArcApprox(api, cx, cy, r, a0, a1, col, lines, 32, 1);
}

function gfxBase(t, c, libLabel) {
  return {
    libLabel,
    setRotation: (r) => annotate(`${t}setRotation(${r});`, `поворот 0=0° 1=90° 2=180° 3=270°`),
    fillScreen: (bg) => annotate(`${t}fillScreen(${c(bg)});`, `цвет фона`),
    line: (x1, y1, x2, y2, col) =>
      annotate(`${t}drawLine(${x1}, ${y1}, ${x2}, ${y2}, ${c(col)});`, `x1,y1 → x2,y2 | цвет`),
    rect: (x, y, w, h, col, fill) =>
      annotate(
        fill
          ? `${t}fillRect(${x}, ${y}, ${w}, ${h}, ${c(col)});`
          : `${t}drawRect(${x}, ${y}, ${w}, ${h}, ${c(col)});`,
        `x,y | ширина,высота | цвет${fill ? " (заливка)" : " (контур)"}`
      ),
    circle: (cx, cy, r, col, fill) =>
      annotate(
        fill
          ? `${t}fillCircle(${cx}, ${cy}, ${r}, ${c(col)});`
          : `${t}drawCircle(${cx}, ${cy}, ${r}, ${c(col)});`,
        `центр x,y | радиус | цвет${fill ? " (диск)" : " (контур)"}`
      ),
    text: (x, y, text, col, size) => [
      annotate(`${t}setTextColor(${c(col)});`, `цвет текста`),
      annotate(`${t}setTextSize(${size});`, `масштаб шрифта`),
      annotate(`${t}setCursor(${x}, ${y});`, `позиция x,y (левый верх текста)`),
      annotate(`${t}print("${esc(text)}");`, `строка`),
    ],
    bitmap: (x, y, name, w, h, col) =>
      annotate(`${t}drawBitmap(${x}, ${y}, ${name}, ${w}, ${h}, ${c(col)});`, `x,y | массив | w,h | цвет`),
    bitmapRgb: (x, y, name, w, h) =>
      annotate(`${t}drawRGBBitmap(${x}, ${y}, ${name}, ${w}, ${h});`, `x,y | массив RGB565 | w,h`),
  };
}

function apiFor(lib, project = null) {
  const t = libCallPrefix(lib, project);
  const c = (h) => colorExpr(lib, h);
  const family = lib.family;
  const label = lib.label || family;

  if (family === "tft_espi") {
    return {
      ...gfxBase(t, c, label),
      wideLine: (x1, y1, x2, y2, w, col) =>
        annotate(
          `${t}drawWideLine(${x1}, ${y1}, ${x2}, ${y2}, ${w}, ${c(col)});`,
          `x1,y1 → x2,y2 | толщина | цвет`
        ),
      // TFT_eSPI: drawArc уже заливает кольцо r…ir (отдельного fillArc нет)
      arc: (cx, cy, r0, r1, a0, a1, col) =>
        annotate(
          `${t}drawArc(${cx}, ${cy}, ${r0}, ${r1}, ${a0}, ${a1}, ${c(col)}, ${c(col)}, false);`,
          `${arcParamNote(r0, r1, a0, a1, "fg,bg,smooth")}`
        ),
      fillArc: (cx, cy, r0, r1, a0, a1, col) =>
        annotate(
          `${t}drawArc(${cx}, ${cy}, ${r0}, ${r1}, ${a0}, ${a1}, ${c(col)}, ${c(col)}, false);`,
          `${arcParamNote(r0, r1, a0, a1, "fg,bg,smooth")}`
        ),
      bitmapRgb: (x, y, name, w, h) =>
        annotate(`${t}pushImage(${x}, ${y}, ${w}, ${h}, ${name});`, `x,y | w,h | массив RGB565`),
      arcRing: true,
      arcAngle: "tft_espi",
      arcApprox: false,
    };
  }

  if (family === "lovyangfx") {
    return {
      ...gfxBase(t, c, label),
      wideLine: (x1, y1, x2, y2, w, col) =>
        annotate(
          `${t}drawWideLine(${x1}, ${y1}, ${x2}, ${y2}, ${Math.max(0.5, w / 2)}, ${c(col)});`,
          `x1,y1 → x2,y2 | полутолщина Lovyan | цвет`
        ),
      arc: (cx, cy, r0, r1, a0, a1, col) =>
        annotate(
          `${t}drawArc(${cx}, ${cy}, ${r0}, ${r1}, ${a0}, ${a1}, ${c(col)});`,
          `${arcParamNote(r0, r1, a0, a1, "контур")}`
        ),
      fillArc: (cx, cy, r0, r1, a0, a1, col) =>
        annotate(
          `${t}fillArc(${cx}, ${cy}, ${r0}, ${r1}, ${a0}, ${a1}, ${c(col)});`,
          `${arcParamNote(r0, r1, a0, a1, "заливка")}`
        ),
      bitmapRgb: (x, y, name, w, h) =>
        annotate(`${t}pushImage(${x}, ${y}, ${w}, ${h}, ${name});`, `x,y | w,h | массив RGB565`),
      arcRing: true,
      arcAngle: "lovyan",
      arcApprox: false,
    };
  }

  if (family === "arduino_gfx") {
    return {
      ...gfxBase(t, c, label),
      arc: (cx, cy, r0, r1, a0, a1, col) =>
        annotate(
          `${t}drawArc(${cx}, ${cy}, ${r0}, ${r1}, ${a0}, ${a1}, ${c(col)});`,
          `${arcParamNote(r0, r1, a0, a1, "контур")}`
        ),
      fillArc: (cx, cy, r0, r1, a0, a1, col) =>
        annotate(
          `${t}fillArc(${cx}, ${cy}, ${r0}, ${r1}, ${a0}, ${a1}, ${c(col)});`,
          `${arcParamNote(r0, r1, a0, a1, "заливка")}`
        ),
      bitmapRgb: (x, y, name, w, h) =>
        annotate(`${t}draw16bitRGBBitmap(${x}, ${y}, ${name}, ${w}, ${h});`, `x,y | массив | w,h`),
      arcRing: true,
      arcAngle: "arduino_gfx",
      arcApprox: false,
    };
  }

  if (family === "u8g2") {
    const u8r = ["U8G2_R0", "U8G2_R1", "U8G2_R2", "U8G2_R3"];
    return {
      libLabel: label,
      setRotation: (r) => `${t}setDisplayRotation(${u8r[r] || "U8G2_R0"});`,
      fillScreen: () => `${t}clearBuffer();`,
      line: (x1, y1, x2, y2) => annotate(`${t}drawLine(${x1}, ${y1}, ${x2}, ${y2});`, `x1,y1 → x2,y2`),
      rect: (x, y, w, h, _c, fill) =>
        annotate(
          fill ? `${t}drawBox(${x}, ${y}, ${w}, ${h});` : `${t}drawFrame(${x}, ${y}, ${w}, ${h});`,
          `x,y | w,h${fill ? " (заливка)" : " (контур)"}`
        ),
      circle: (cx, cy, r, _c, fill) =>
        annotate(
          fill ? `${t}drawDisc(${cx}, ${cy}, ${r});` : `${t}drawCircle(${cx}, ${cy}, ${r});`,
          `центр x,y | радиус${fill ? " (диск)" : ""}`
        ),
      text: (x, y, text) => [
        `${t}setFont(u8g2_font_6x12_tr);`,
        annotate(`${t}drawStr(${x}, ${y + 10}, "${esc(text)}");`, `x,y(baseline) | строка`),
      ],
      // U8g2: cnt = ширина в байтах
      bitmap: (x, y, name, w, h) =>
        annotate(`${t}drawBitmap(${x}, ${y}, ${Math.ceil(w / 8)}, ${h}, ${name});`, `x,y | ширина_в_байтах,h | массив`),
      // U8g2: углы 0…255 на полный круг; толщина — несколько радиусов
      arc: (cx, cy, r0, _r1, a0, a1) =>
        annotate(`${t}drawArc(${cx}, ${cy}, ${r0}, ${a0}, ${a1});`, `центр x,y | радиус | угол нач,кон (0…255)`),
      arcSingle: true,
      arcAngle: "u8g2",
      arcApprox: false,
      footer: () => `${t}sendBuffer();`,
    };
  }

  if (family === "u8x8") {
    return {
      libLabel: label,
      setRotation: (r) => `// U8x8: поворот задайте в конструкторе (rotation=${r})`,
      fillScreen: () => `${t}clearDisplay();`,
      line: () => `// u8x8: нет линий — используйте U8g2`,
      rect: () => `// u8x8: нет прямоугольников — U8g2`,
      circle: () => `// u8x8: нет окружностей — U8g2`,
      text: (x, y, text) => `${t}drawString(${Math.floor(x / 8)}, ${Math.floor(y / 8)}, "${esc(text)}");`,
      arcApprox: true,
    };
  }

  if (family === "ssd1306_wire") {
    return {
      libLabel: label,
      setRotation: (r) =>
        r === 0
          ? `// SSD1306Wire: rotation 0`
          : `// SSD1306Wire: rotation ${r} — flipScreenVertically() / геометрия в конструкторе`,
      fillScreen: () => `${t}clear();`,
      line: (x1, y1, x2, y2) => `${t}drawLine(${x1}, ${y1}, ${x2}, ${y2});`,
      rect: (x, y, w, h, _c, fill) =>
        fill ? `${t}fillRect(${x}, ${y}, ${w}, ${h});` : `${t}drawRect(${x}, ${y}, ${w}, ${h});`,
      circle: (cx, cy, r, _c, fill) =>
        fill ? `${t}fillCircle(${cx}, ${cy}, ${r});` : `${t}drawCircle(${cx}, ${cy}, ${r});`,
      text: (x, y, text) => `${t}drawString(${x}, ${y}, "${esc(text)}");`,
      bitmap: (x, y, name, w, h) => `${t}drawFastImage(${x}, ${y}, ${w}, ${h}, ${name}); // 1-bit XBM-style — проверьте API`,
      arcApprox: true,
      footer: () => `${t}display();`,
    };
  }

  if (family === "tiny4koled") {
    return {
      libLabel: label,
      setRotation: (r) => `// Tiny4kOLED: rotation ${r}`,
      fillScreen: () => `${t}clear();`,
      line: (x1, y1, x2, y2) => `${t}drawLine(${x1}, ${y1}, ${x2}, ${y2});`,
      rect: (x, y, w, h, _c, fill) =>
        fill ? `${t}fillRect(${x}, ${y}, ${w}, ${h});` : `${t}drawRect(${x}, ${y}, ${w}, ${h});`,
      circle: (cx, cy, r) => `${t}drawCircle(${cx}, ${cy}, ${r});`,
      text: (x, y, text) => [`${t}setCursor(${x}, ${y});`, `${t}print("${esc(text)}");`],
      arcApprox: true,
      footer: () => `${t}display();`,
    };
  }

  if (family === "utft") {
    return {
      libLabel: label,
      setRotation: (r) => `// UTFT: ориентацию задайте в InitLCD (rotation=${r})`,
      fillScreen: (bg) => {
        const { r, g, b } = hexToRgb(bg);
        return [`${t}setColor(${r}, ${g}, ${b});`, `${t}fillScr(${r}, ${g}, ${b});`];
      },
      line: (x1, y1, x2, y2, col) => [
        `${t}setColor(${formatUtftColor(col)});`,
        `${t}drawLine(${x1}, ${y1}, ${x2}, ${y2});`,
      ],
      rect: (x, y, w, h, col, fill) => [
        `${t}setColor(${formatUtftColor(col)});`,
        fill
          ? `${t}fillRect(${x}, ${y}, ${x + w - 1}, ${y + h - 1});`
          : `${t}drawRect(${x}, ${y}, ${x + w - 1}, ${y + h - 1});`,
      ],
      circle: (cx, cy, r, col, fill) => [
        `${t}setColor(${formatUtftColor(col)});`,
        fill ? `${t}fillCircle(${cx}, ${cy}, ${r});` : `${t}drawCircle(${cx}, ${cy}, ${r});`,
      ],
      text: (x, y, text, col) => [
        `${t}setColor(${formatUtftColor(col)});`,
        `${t}print("${esc(text)}", ${x}, ${y});`,
      ],
      arcApprox: true,
    };
  }

  if (family === "ucglib") {
    const rgb = (h) => {
      const { r, g, b } = hexToRgb(h);
      return `${r}, ${g}, ${b}`;
    };
    return {
      libLabel: label,
      setRotation: (r) => `// Ucglib: поворот ${r} — зависит от драйвера/конструктора`,
      fillScreen: (bg) => [`${t}setColor(${rgb(bg)});`, `${t}clearScreen();`],
      line: (x1, y1, x2, y2, col) => [`${t}setColor(${rgb(col)});`, `${t}drawLine(${x1}, ${y1}, ${x2}, ${y2});`],
      rect: (x, y, w, h, col, fill) => [
        `${t}setColor(${rgb(col)});`,
        fill ? `${t}drawBox(${x}, ${y}, ${w}, ${h});` : `${t}drawFrame(${x}, ${y}, ${w}, ${h});`,
      ],
      circle: (cx, cy, r, col, fill) => [
        `${t}setColor(${rgb(col)});`,
        fill
          ? `${t}drawDisc(${cx}, ${cy}, ${r}, UCG_DRAW_ALL);`
          : `${t}drawCircle(${cx}, ${cy}, ${r}, UCG_DRAW_ALL);`,
      ],
      text: (x, y, text, col) => [
        `${t}setColor(${rgb(col)});`,
        `${t}setPrintPos(${x}, ${y});`,
        `${t}print("${esc(text)}");`,
      ],
      // Ucglib: drawArc нет — только круг/диск/линии
      arcApprox: true,
    };
  }

  if (family === "lvgl") {
    return {
      libLabel: label,
      setRotation: (r) => `// LVGL: lv_display_set_rotation(disp, ${r * 90});`,
      fillScreen: (bg) => `// screen bg ${format565(bg)}`,
      line: (x1, y1, x2, y2, col) => `// lv_draw_line (${x1},${y1})-(${x2},${y2}) ${format565(col)}`,
      rect: (x, y, w, h, col, fill) =>
        `// lv ${fill ? "fill" : "draw"} rect (${x},${y},${w},${h}) ${format565(col)}`,
      circle: (cx, cy, r, col, fill) =>
        `// lv ${fill ? "fill" : "draw"} circle (${cx},${cy}) r=${r} ${format565(col)}`,
      text: (x, y, text, col) => `// lv_label "${esc(text)}" at (${x},${y}) ${format565(col)}`,
      // LVGL: 0° = 3 часа, по часовой (как Lovyan) — в комментарии уже сконвертированные углы
      arc: (cx, cy, r0, r1, a0, a1, col) =>
        `// lv_draw_arc outline center=(${cx},${cy}) r=${r0}..${r1} ${a0}°…${a1}° ${format565(col)}`,
      fillArc: (cx, cy, r0, r1, a0, a1, col) =>
        `// lv_draw_arc filled center=(${cx},${cy}) r=${r0}..${r1} ${a0}°…${a1}° ${format565(col)}`,
      arcRing: true,
      arcAngle: "lovyan",
      arcApprox: false,
    };
  }

  // Adafruit GFX / MCUFRIEND — в базовом API нет drawArc
  return {
    ...gfxBase(t, c, label),
    arcApprox: true,
  };
}

function emitObject(obj, lib, lines, api, decls = null) {
  switch (obj.type) {
    case "line": {
      const th = Math.max(1, obj.thickness || 1);
      if (th > 1 && !api.wideLine) {
        lines.push(`// толщина ${th} px — эмуляция параллельными линиями`);
      }
      emitThickLine(api, obj.x1, obj.y1, obj.x2, obj.y2, th, obj.stroke, lines);
      break;
    }
    case "rect":
      push(lines, api.rect(obj.x, obj.y, obj.w, obj.h, obj.fill || obj.stroke, !!obj.filled));
      break;
    case "circle":
      push(lines, api.circle(obj.cx, obj.cy, obj.r, obj.fill || obj.stroke, !!obj.filled));
      break;
    case "arc": {
      const th = Math.max(1, obj.thickness || 1);
      emitArc(api, obj.cx, obj.cy, obj.r, obj.startAngle, obj.endAngle, obj.stroke, lines, th, 24);
      break;
    }
    case "text":
      push(
        lines,
        api.text(
          obj.x,
          obj.y,
          obj.text,
          obj.fill,
          Math.max(1, Math.min(3, obj.textSize || Math.round((obj.fontSize || 12) / 8) || 1))
        )
      );
      break;
    case "sector":
      emitSector(api, obj.cx, obj.cy, obj.r, obj.startAngle, obj.endAngle, obj.fill, lines);
      break;
    case "bitmap": {
      const mode = obj.colorMode === "rgb565" ? "rgb565" : "mono";
      const w = obj.w | 0;
      const h = obj.h | 0;
      const arr = safeArrayName(obj.id, obj.name);

      if (mode === "rgb565") {
        if (!obj.rgb || !obj.rgb.length) {
          lines.push(`// ${obj.name || "bitmap"}: нет RGB565 — импортируйте PNG/BMP`);
          break;
        }
        const header = `// ${obj.name || "bitmap"} — ${w}x${h} px, ${obj.bytes || obj.rgb.length * 2} bytes (RGB565)`;
        const arrLines = rgb565ToCArray(obj.rgb, arr);
        if (decls) {
          decls.push(header);
          decls.push(...arrLines);
          decls.push(``);
        } else {
          lines.push(header);
          push(lines, arrLines);
        }
        if (api.bitmapRgb) {
          push(lines, api.bitmapRgb(obj.x, obj.y, arr, w, h));
        } else {
          lines.push(
            `// RGB565: pushImage/drawRGBBitmap(${obj.x},${obj.y}, ${arr}, ${w}, ${h}) — на mono OLED лучше режим Ч/Б`
          );
        }
      } else {
        if (!obj.bits || !obj.bits.length) {
          lines.push(`// ${obj.name || "bitmap"}: нет данных — импортируйте PNG/BMP`);
          break;
        }
        const header = `// ${obj.name || "bitmap"} — ${w}x${h} px, ${obj.bytes || obj.bits.length} bytes (1-bit)`;
        const arrLines = bitsToCArray(obj.bits, arr);
        if (decls) {
          decls.push(header);
          decls.push(...arrLines);
          decls.push(``);
        } else {
          lines.push(header);
          push(lines, arrLines);
        }
        if (api.bitmap) {
          push(lines, api.bitmap(obj.x, obj.y, arr, w, h, obj.color || "#ffffff"));
        } else {
          lines.push(`// drawBitmap(${obj.x}, ${obj.y}, ${arr}, ${w}, ${h})`);
        }
      }
      break;
    }
    case "scale": {
      if (obj.showArc !== false) {
        const th = Math.max(1, obj.arcThickness || 2);
        emitArc(api, obj.cx, obj.cy, obj.rOuter, obj.startAngle, obj.endAngle, obj.arcColor, lines, th, 36);
      }
      for (const tk of tickPoints(obj)) {
        if (tk.isMajor && obj.showMajorTicks === false) continue;
        if (!tk.isMajor && obj.showMinorTicks === false) continue;
        push(lines, api.line(tk.x1, tk.y1, tk.x2, tk.y2, tk.isMajor ? obj.majorColor : obj.minorColor));
      }
      if (obj.showLabels) {
        const ts = Math.max(1, Math.min(3, obj.labelTextSize || Math.round((obj.labelFontSize || 10) / 8) || 1));
        const ox = 3 * ts;
        const oy = 4 * ts;
        for (const lb of scaleLabels(obj)) {
          push(
            lines,
            api.text(lb.x - String(lb.text).length * ox, lb.y - oy, lb.text, obj.labelColor, ts)
          );
        }
      }
      break;
    }
    default:
      lines.push(`// unknown: ${obj.type}`);
  }
}

function indent(item) {
  if (Array.isArray(item)) return item.map((s) => "  " + s);
  return "  " + item;
}

export function codegenObject(obj, lib, project = null) {
  const lines = [];
  const prefix = libCallPrefix(lib, project);
  lines.push(`// ${obj.name || obj.type}  ·  ${prefix}`);
  emitObject(obj, lib, lines, apiFor(lib, project), null);
  return lines.join("\n");
}

export function codegenScreen(project, lib) {
  const lines = [];
  const decls = [];
  const api = apiFor(lib, project);
  const prefix = libCallPrefix(lib, project);
  const rot = orientationToRotation(project.orientationId);
  lines.push(`// GUI Draw Master — ${lib.label}`);
  lines.push(`// ${project.width}x${project.height} px, origin (0,0), ${orientationLabel(project.orientationId)}`);
  lines.push(`// вызовы: ${prefix}…  (имя/«.»|«->» — в настройках «Объект в коде»)`);
  for (const tip of arcLegendLines(lib)) lines.push(tip);
  lines.push(`// у каждой строки кода — комментарий с расшифровкой аргументов (удобно править под Proteus/железо)`);

  const emitOne = (obj) => {
    lines.push(``);
    lines.push(`  // ${obj.name || obj.type}`);
    const chunk = [];
    emitObject(obj, lib, chunk, api, decls);
    for (const ln of chunk) push(lines, indent(ln));
  };

  lines.push(`void drawGui() {`);
  lines.push(`  // ориентация экрана (0=0°, 1=90°, 2=180°, 3=270°)`);
  if (api.setRotation) {
    push(lines, indent(api.setRotation(rot)));
  } else {
    lines.push(`  // setRotation(${rot});`);
  }
  lines.push(`  // цвет фона`);
  push(lines, indent(api.fillScreen(project.background || "#000000")));
  const emittedGroups = new Set();
  for (const obj of project.widgets) {
    if (obj.visible === false) continue;
    if (obj.groupId) {
      if (emittedGroups.has(obj.groupId)) continue;
      emittedGroups.add(obj.groupId);
      const g = (project.groups || []).find((x) => x.id === obj.groupId);
      const gname = g?.name || obj.groupId;
      lines.push(``);
      lines.push(`  // ===== группа: ${gname} =====`);
      for (const m of project.widgets) {
        if (m.groupId !== obj.groupId || m.visible === false) continue;
        emitOne(m);
      }
      lines.push(`  // ===== /${gname} =====`);
      continue;
    }
    emitOne(obj);
  }
  if (api.footer) {
    lines.push(``);
    lines.push(`  // вывод буфера`);
    push(lines, indent(api.footer()));
  }
  lines.push(`}`);

  if (decls.length) {
    return [
      `// --- bitmap данные (PROGMEM) ---`,
      ...decls,
      ``,
      ...lines,
    ].join("\n");
  }
  return lines.join("\n");
}
