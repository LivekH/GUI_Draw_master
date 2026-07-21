/**
 * Code generators — map canvas objects → library draw calls
 */
import { format565, formatUtftColor, isOn, hexToRgb } from "./color.js";

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

/** Дуга кусочками; thickness > 1 — концентрические радиусы (как у drawArc) */
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

function apiFor(lib) {
  const t = lib.obj;
  const c = (h) => colorExpr(lib, h);
  const family = lib.family;

  if (family === "tft_espi") {
    return {
      setRotation: (r) => `${t}.setRotation(${r});`,
      fillScreen: (bg) => `${t}.fillScreen(${c(bg)});`,
      line: (x1, y1, x2, y2, col) => `${t}.drawLine(${x1}, ${y1}, ${x2}, ${y2}, ${c(col)});`,
      wideLine: (x1, y1, x2, y2, w, col) =>
        `${t}.drawWideLine(${x1}, ${y1}, ${x2}, ${y2}, ${w}, ${c(col)});`,
      rect: (x, y, w, h, col, fill) =>
        fill
          ? `${t}.fillRect(${x}, ${y}, ${w}, ${h}, ${c(col)});`
          : `${t}.drawRect(${x}, ${y}, ${w}, ${h}, ${c(col)});`,
      circle: (cx, cy, r, col, fill) =>
        fill
          ? `${t}.fillCircle(${cx}, ${cy}, ${r}, ${c(col)});`
          : `${t}.drawCircle(${cx}, ${cy}, ${r}, ${c(col)});`,
      text: (x, y, text, col, size) => [
        `${t}.setTextColor(${c(col)});`,
        `${t}.setTextSize(${size});`,
        `${t}.setCursor(${x}, ${y});`,
        `${t}.print("${esc(text)}");`,
      ],
      arc: (cx, cy, r0, r1, a0, a1, col) =>
        `${t}.drawArc(${cx}, ${cy}, ${r0}, ${r1}, ${normArc(a0)}, ${normArc(a1)}, ${c(col)}, ${c(col)}, false);`,
      arcApprox: false,
    };
  }

  if (family === "lovyangfx") {
    return {
      setRotation: (r) => `${t}.setRotation(${r});`,
      fillScreen: (bg) => `${t}.fillScreen(${c(bg)});`,
      line: (x1, y1, x2, y2, col) => `${t}.drawLine(${x1}, ${y1}, ${x2}, ${y2}, ${c(col)});`,
      wideLine: (x1, y1, x2, y2, w, col) =>
        `${t}.drawWideLine(${x1}, ${y1}, ${x2}, ${y2}, ${w}, ${c(col)});`,
      rect: (x, y, w, h, col, fill) =>
        fill
          ? `${t}.fillRect(${x}, ${y}, ${w}, ${h}, ${c(col)});`
          : `${t}.drawRect(${x}, ${y}, ${w}, ${h}, ${c(col)});`,
      circle: (cx, cy, r, col, fill) =>
        fill
          ? `${t}.fillCircle(${cx}, ${cy}, ${r}, ${c(col)});`
          : `${t}.drawCircle(${cx}, ${cy}, ${r}, ${c(col)});`,
      text: (x, y, text, col, size) => [
        `${t}.setTextColor(${c(col)});`,
        `${t}.setTextSize(${size});`,
        `${t}.setCursor(${x}, ${y});`,
        `${t}.print("${esc(text)}");`,
      ],
      arc: (cx, cy, r0, r1, a0, a1, col) => `${t}.drawArc(${cx}, ${cy}, ${r0}, ${r1}, ${a0}, ${a1}, ${c(col)});`,
      arcApprox: false,
    };
  }

  if (family === "u8g2") {
    const u8r = ["U8G2_R0", "U8G2_R1", "U8G2_R2", "U8G2_R3"];
    return {
      setRotation: (r) => `${t}.setDisplayRotation(${u8r[r] || "U8G2_R0"});`,
      fillScreen: () => `${t}.clearBuffer();`,
      line: (x1, y1, x2, y2) => `${t}.drawLine(${x1}, ${y1}, ${x2}, ${y2});`,
      rect: (x, y, w, h, _c, fill) =>
        fill ? `${t}.drawBox(${x}, ${y}, ${w}, ${h});` : `${t}.drawFrame(${x}, ${y}, ${w}, ${h});`,
      circle: (cx, cy, r, _c, fill) =>
        fill ? `${t}.drawDisc(${cx}, ${cy}, ${r});` : `${t}.drawCircle(${cx}, ${cy}, ${r});`,
      text: (x, y, text) => [`${t}.setFont(u8g2_font_6x12_tr);`, `${t}.drawStr(${x}, ${y + 10}, "${esc(text)}");`],
      arcApprox: true,
      footer: () => `${t}.sendBuffer();`,
    };
  }

  if (family === "u8x8") {
    return {
      setRotation: (r) => `// U8x8: поворот задайте в конструкторе (rotation=${r})`,
      fillScreen: () => `${t}.clearDisplay();`,
      line: () => `// u8x8: нет линий — используйте U8g2`,
      rect: () => `// u8x8: нет прямоугольников — U8g2`,
      circle: () => `// u8x8: нет окружностей — U8g2`,
      text: (x, y, text) => `${t}.drawString(${Math.floor(x / 8)}, ${Math.floor(y / 8)}, "${esc(text)}");`,
      arcApprox: false,
    };
  }

  if (family === "ssd1306_wire") {
    return {
      setRotation: (r) =>
        r === 0
          ? `// SSD1306Wire: rotation 0`
          : `// SSD1306Wire: rotation ${r} — flipScreenVertically() / геометрия в конструкторе`,
      fillScreen: () => `${t}.clear();`,
      line: (x1, y1, x2, y2) => `${t}.drawLine(${x1}, ${y1}, ${x2}, ${y2});`,
      rect: (x, y, w, h, _c, fill) =>
        fill ? `${t}.fillRect(${x}, ${y}, ${w}, ${h});` : `${t}.drawRect(${x}, ${y}, ${w}, ${h});`,
      circle: (cx, cy, r, _c, fill) =>
        fill ? `${t}.fillCircle(${cx}, ${cy}, ${r});` : `${t}.drawCircle(${cx}, ${cy}, ${r});`,
      text: (x, y, text) => `${t}.drawString(${x}, ${y}, "${esc(text)}");`,
      arcApprox: true,
      footer: () => `${t}.display();`,
    };
  }

  if (family === "tiny4koled") {
    return {
      setRotation: (r) => `// Tiny4kOLED: rotation ${r}`,
      fillScreen: () => `${t}.clear();`,
      line: (x1, y1, x2, y2) => `${t}.drawLine(${x1}, ${y1}, ${x2}, ${y2});`,
      rect: (x, y, w, h, _c, fill) =>
        fill ? `${t}.fillRect(${x}, ${y}, ${w}, ${h});` : `${t}.drawRect(${x}, ${y}, ${w}, ${h});`,
      circle: (cx, cy, r) => `${t}.drawCircle(${cx}, ${cy}, ${r});`,
      text: (x, y, text) => [`${t}.setCursor(${x}, ${y});`, `${t}.print("${esc(text)}");`],
      arcApprox: true,
      footer: () => `${t}.display();`,
    };
  }

  if (family === "utft") {
    return {
      setRotation: (r) => `// UTFT: ориентацию задайте в InitLCD (rotation=${r})`,
      fillScreen: (bg) => {
        const { r, g, b } = hexToRgb(bg);
        return [`${t}.setColor(${r}, ${g}, ${b});`, `${t}.fillScr(${r}, ${g}, ${b});`];
      },
      line: (x1, y1, x2, y2, col) => [
        `${t}.setColor(${formatUtftColor(col)});`,
        `${t}.drawLine(${x1}, ${y1}, ${x2}, ${y2});`,
      ],
      rect: (x, y, w, h, col, fill) => [
        `${t}.setColor(${formatUtftColor(col)});`,
        fill
          ? `${t}.fillRect(${x}, ${y}, ${x + w - 1}, ${y + h - 1});`
          : `${t}.drawRect(${x}, ${y}, ${x + w - 1}, ${y + h - 1});`,
      ],
      circle: (cx, cy, r, col, fill) => [
        `${t}.setColor(${formatUtftColor(col)});`,
        fill ? `${t}.fillCircle(${cx}, ${cy}, ${r});` : `${t}.drawCircle(${cx}, ${cy}, ${r});`,
      ],
      text: (x, y, text, col) => [
        `${t}.setColor(${formatUtftColor(col)});`,
        `${t}.print("${esc(text)}", ${x}, ${y});`,
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
      setRotation: (r) => `// Ucglib: поворот ${r} — зависит от драйвера/конструктора`,
      fillScreen: (bg) => [`${t}.setColor(${rgb(bg)});`, `${t}.clearScreen();`],
      line: (x1, y1, x2, y2, col) => [`${t}.setColor(${rgb(col)});`, `${t}.drawLine(${x1}, ${y1}, ${x2}, ${y2});`],
      rect: (x, y, w, h, col, fill) => [
        `${t}.setColor(${rgb(col)});`,
        fill ? `${t}.drawBox(${x}, ${y}, ${w}, ${h});` : `${t}.drawFrame(${x}, ${y}, ${w}, ${h});`,
      ],
      circle: (cx, cy, r, col, fill) => [
        `${t}.setColor(${rgb(col)});`,
        fill
          ? `${t}.drawDisc(${cx}, ${cy}, ${r}, UCG_DRAW_ALL);`
          : `${t}.drawCircle(${cx}, ${cy}, ${r}, UCG_DRAW_ALL);`,
      ],
      text: (x, y, text, col) => [
        `${t}.setColor(${rgb(col)});`,
        `${t}.setPrintPos(${x}, ${y});`,
        `${t}.print("${esc(text)}");`,
      ],
      arcApprox: true,
    };
  }

  if (family === "lvgl") {
    return {
      setRotation: (r) => `// LVGL: lv_display_set_rotation(disp, ${r * 90});`,
      fillScreen: (bg) => `// screen bg ${format565(bg)}`,
      line: (x1, y1, x2, y2, col) => `// lv_draw_line (${x1},${y1})-(${x2},${y2}) ${format565(col)}`,
      rect: (x, y, w, h, col, fill) =>
        `// lv ${fill ? "fill" : "draw"} rect (${x},${y},${w},${h}) ${format565(col)}`,
      circle: (cx, cy, r, col, fill) =>
        `// lv ${fill ? "fill" : "draw"} circle (${cx},${cy}) r=${r} ${format565(col)}`,
      text: (x, y, text, col) => `// lv_label "${esc(text)}" at (${x},${y}) ${format565(col)}`,
      arcApprox: true,
    };
  }

  // Adafruit GFX / Arduino_GFX / MCUFRIEND / Adafruit OLED
  return {
    setRotation: (r) => `${t}.setRotation(${r});`,
    fillScreen: (bg) => `${t}.fillScreen(${c(bg)});`,
    line: (x1, y1, x2, y2, col) => `${t}.drawLine(${x1}, ${y1}, ${x2}, ${y2}, ${c(col)});`,
    rect: (x, y, w, h, col, fill) =>
      fill
        ? `${t}.fillRect(${x}, ${y}, ${w}, ${h}, ${c(col)});`
        : `${t}.drawRect(${x}, ${y}, ${w}, ${h}, ${c(col)});`,
    circle: (cx, cy, r, col, fill) =>
      fill
        ? `${t}.fillCircle(${cx}, ${cy}, ${r}, ${c(col)});`
        : `${t}.drawCircle(${cx}, ${cy}, ${r}, ${c(col)});`,
    text: (x, y, text, col, size) => [
      `${t}.setTextColor(${c(col)});`,
      `${t}.setTextSize(${size});`,
      `${t}.setCursor(${x}, ${y});`,
      `${t}.print("${esc(text)}");`,
    ],
    arcApprox: true,
  };
}

function emitObject(obj, lib, lines, api) {
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
      if (api.arc && !api.arcApprox) {
        const r1 = Math.max(0, obj.r - th);
        push(lines, api.arc(obj.cx, obj.cy, obj.r, r1, obj.startAngle, obj.endAngle, obj.stroke));
      } else {
        if (th > 1) lines.push(`// толщина дуги ${th} px — концентрические линии`);
        emitArcApprox(api, obj.cx, obj.cy, obj.r, obj.startAngle, obj.endAngle, obj.stroke, lines, 24, th);
      }
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
    case "sector": {
      const a = polar(obj.cx, obj.cy, obj.r, obj.startAngle);
      const b = polar(obj.cx, obj.cy, obj.r, obj.endAngle);
      push(lines, api.line(obj.cx, obj.cy, a.x, a.y, obj.fill));
      push(lines, api.line(obj.cx, obj.cy, b.x, b.y, obj.fill));
      emitArcApprox(api, obj.cx, obj.cy, obj.r, obj.startAngle, obj.endAngle, obj.fill, lines, 32);
      break;
    }
    case "scale": {
      if (obj.showArc !== false) {
        const th = Math.max(1, obj.arcThickness || 2);
        if (api.arc && !api.arcApprox) {
          const r1 = Math.max(0, obj.rOuter - th);
          push(lines, api.arc(obj.cx, obj.cy, obj.rOuter, r1, obj.startAngle, obj.endAngle, obj.arcColor));
        } else {
          if (th > 1) lines.push(`// толщина дуги шкалы ${th} px — концентрические линии`);
          emitArcApprox(api, obj.cx, obj.cy, obj.rOuter, obj.startAngle, obj.endAngle, obj.arcColor, lines, 36, th);
        }
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

export function codegenObject(obj, lib) {
  const lines = [];
  lines.push(`// ${obj.name || obj.type}`);
  emitObject(obj, lib, lines, apiFor(lib));
  return lines.join("\n");
}

export function codegenScreen(project, lib) {
  const lines = [];
  const api = apiFor(lib);
  const rot = orientationToRotation(project.orientationId);
  lines.push(`// GUI Draw Master — ${lib.label}`);
  lines.push(`// ${project.width}x${project.height} px, origin (0,0), ${orientationLabel(project.orientationId)}`);
  lines.push(`void drawGui() {`);
  lines.push(`  // ориентация экрана (0=0°, 1=90°, 2=180°, 3=270°)`);
  if (api.setRotation) {
    push(lines, indent(api.setRotation(rot)));
  } else {
    lines.push(`  // setRotation(${rot});`);
  }
  lines.push(`  // цвет фона`);
  push(lines, indent(api.fillScreen(project.background || "#000000")));
  for (const obj of project.widgets) {
    lines.push(``);
    lines.push(`  // ${obj.name || obj.type}`);
    const chunk = [];
    emitObject(obj, lib, chunk, api);
    for (const ln of chunk) push(lines, indent(ln));
  }
  if (api.footer) {
    lines.push(``);
    lines.push(`  // вывод буфера`);
    push(lines, indent(api.footer()));
  }
  lines.push(`}`);
  return lines.join("\n");
}
