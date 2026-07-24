import { resolveSize } from "./catalog.js?v=20260724g";

export const TOOLS = [
  {
    type: "scale",
    label: "Шкала",
    glyph: "◔",
    hint: "Аналоговая шкала: дуга, основные/доп. деления и цифры — по отдельным галочкам. Режим шрифта = setTextSize; инверсия меняет мин↔макс по дуге.",
  },
  {
    type: "arc",
    label: "Дуга",
    glyph: "⌒",
    hint: "Дуга по углам начала и конца. Толщина — ширина линии дуги (в коде: drawArc или несколько линий).",
  },
  {
    type: "circle",
    label: "Круг",
    glyph: "○",
    hint: "Окружность или залитый диск. Центр — в координатах экрана (пиксели).",
  },
  {
    type: "sector",
    label: "Сектор",
    glyph: "◐",
    hint: "Залитый «кусок пирога» от центра: цветовая зона на шкале (например красная зона 80–100). Не деления и не стрелка — только подкраска сектора.",
  },
  {
    type: "line",
    label: "Линия",
    glyph: "/",
    hint: "Отрезок между двумя точками. Толщина > 1: drawWideLine (TFT_eSPI/Lovyan) или эмуляция параллельными линиями.",
  },
  {
    type: "rect",
    label: "Рамка",
    glyph: "▭",
    hint: "Прямоугольник: контур или заливка. X/Y — левый верхний угол.",
  },
  {
    type: "text",
    label: "Текст",
    glyph: "T",
    hint: "Текстовая надпись. Размер шрифта на дисплее зависит от библиотеки (setTextSize).",
  },
  {
    type: "bitmap",
    label: "Иконка",
    glyph: "▣",
    hint: "Импорт PNG/BMP. Режим Ч/Б (1-bit) или Цвет RGB565. Масштаб в свойствах → drawBitmap / pushImage.",
  },
];

let _id = 1;
export function nextId() {
  return `el${_id++}`;
}
export function resetIdCounter(n = 1) {
  _id = n;
}

function defaults(type, W, H) {
  const cx = Math.round(W / 2);
  const cy = Math.round(H / 2);
  const R = Math.round(Math.min(W, H) * 0.38);

  switch (type) {
    case "scale":
      return {
        type: "scale",
        name: "Шкала",
        cx,
        cy,
        rOuter: R,
        rInner: R - 12,
        labelRadius: R - 28,
        startAngle: -120,
        endAngle: 120,
        majorCount: 6,
        minorPerMajor: 4,
        minVal: 0,
        maxVal: 100,
        invertValues: false,
        showMajorTicks: true,
        showMinorTicks: true,
        showLabels: true,
        labelTextSize: 1,
        labelFontSize: 10,
        showArc: true,
        arcThickness: 2,
        arcColor: "#c8d0dc",
        majorColor: "#e8eef6",
        minorColor: "#6a7688",
        labelColor: "#e8eef6",
      };
    case "arc":
      return {
        type: "arc",
        name: "Дуга",
        cx,
        cy,
        r: R,
        startAngle: -90,
        endAngle: 90,
        thickness: 2,
        stroke: "#3ecf8e",
      };
    case "circle":
      return {
        type: "circle",
        name: "Круг",
        cx,
        cy,
        r: Math.round(R * 0.35),
        filled: false,
        stroke: "#4dabf7",
        fill: "#4dabf7",
      };
    case "sector":
      return {
        type: "sector",
        name: "Сектор",
        cx,
        cy,
        r: R - 4,
        startAngle: 60,
        endAngle: 120,
        fill: "#e85d5d",
      };
    case "line":
      return {
        type: "line",
        name: "Линия",
        x1: Math.round(W * 0.2),
        y1: Math.round(H * 0.5),
        x2: Math.round(W * 0.8),
        y2: Math.round(H * 0.5),
        thickness: 1,
        stroke: "#e8eef6",
      };
    case "rect":
      return {
        type: "rect",
        name: "Рамка",
        x: Math.round(W * 0.15),
        y: Math.round(H * 0.15),
        w: Math.round(W * 0.7),
        h: Math.round(H * 0.7),
        filled: false,
        stroke: "#8b9bb0",
        fill: "#1a2332",
      };
    case "text":
      return {
        type: "text",
        name: "Текст",
        x: Math.round(W * 0.3),
        y: Math.round(H * 0.45),
        text: "GUI",
        fontSize: 16,
        textSize: 2,
        fill: "#e8eef6",
      };
    case "bitmap":
      return {
        type: "bitmap",
        name: "Иконка",
        x: Math.round(W * 0.1),
        y: Math.round(H * 0.1),
        w: 64,
        h: 32,
        colorMode: "mono",
        threshold: 128,
        invert: false,
        color: "#ffffff",
        srcDataUrl: null,
        bits: null,
        rgb: null,
        bytes: 0,
      };
    default:
      throw new Error(type);
  }
}

export function createElement(type, width, height) {
  const d = defaults(type, width, height);
  d.id = nextId();
  d.name = `${d.name} ${_id - 1}`;
  d.visible = true;
  d.groupId = null;
  return d;
}

export function createProject() {
  resetIdCounter(1);
  _gid = 1;
  const displayId = "tft_240x320";
  const orientationId = "portrait";
  const { w, h } = resolveSize(displayId, orientationId);
  return {
    version: 3,
    name: "Untitled",
    displayId,
    orientationId,
    libraryId: "tft_espi",
    codeObj: "tft",
    codeAccess: ".",
    width: w,
    height: h,
    background: "#000000",
    widgets: [],
    groups: [],
  };
}

let _gid = 1;
export function nextGroupId() {
  return `grp${_gid++}`;
}
export function resetGroupCounter(n = 1) {
  _gid = n;
}

export function getGroup(project, groupId) {
  return (project.groups || []).find((g) => g.id === groupId) || null;
}

export function groupMembers(project, groupId) {
  return project.widgets.filter((w) => w.groupId === groupId);
}

/** Bounding box for hit-test / selection */
export function elementBounds(el) {
  switch (el.type) {
    case "line":
      return {
        x: Math.min(el.x1, el.x2),
        y: Math.min(el.y1, el.y2),
        w: Math.abs(el.x2 - el.x1) || 1,
        h: Math.abs(el.y2 - el.y1) || 1,
      };
    case "rect":
    case "bitmap":
      return { x: el.x, y: el.y, w: el.w, h: el.h };
    case "text":
      return { x: el.x, y: el.y, w: Math.max(40, (el.text || "").length * (el.fontSize || 12) * 0.6), h: el.fontSize || 12 };
    case "circle":
    case "arc":
    case "sector":
    case "scale": {
      const r = el.r || el.rOuter || 10;
      return { x: el.cx - r, y: el.cy - r, w: r * 2, h: r * 2 };
    }
    default:
      return { x: 0, y: 0, w: 1, h: 1 };
  }
}
