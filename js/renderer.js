import { tickPoints, scaleLabels, polar } from "./codegen.js?v=20260724f";

function strokePath(ctx, points, close = false) {
  if (!points.length) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  if (close) ctx.closePath();
  ctx.stroke();
}

function arcPoints(cx, cy, r, a0, a1, segs = 48) {
  const pts = [];
  const span = a1 - a0;
  const n = Math.max(4, Math.round((Math.abs(span) / 360) * segs));
  for (let i = 0; i <= n; i++) {
    pts.push(polar(cx, cy, r, a0 + (span * i) / n));
  }
  return pts;
}

export function drawElement(ctx, el) {
  ctx.save();
  switch (el.type) {
    case "line":
      ctx.strokeStyle = el.stroke;
      ctx.lineWidth = Math.max(1, el.thickness || 1);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(el.x1, el.y1);
      ctx.lineTo(el.x2, el.y2);
      ctx.stroke();
      break;

    case "rect":
      if (el.filled) {
        ctx.fillStyle = el.fill;
        ctx.fillRect(el.x, el.y, el.w, el.h);
      } else {
        ctx.strokeStyle = el.stroke || el.fill;
        ctx.lineWidth = 1;
        ctx.strokeRect(el.x + 0.5, el.y + 0.5, el.w - 1, el.h - 1);
      }
      break;

    case "circle":
      ctx.beginPath();
      ctx.arc(el.cx, el.cy, el.r, 0, Math.PI * 2);
      if (el.filled) {
        ctx.fillStyle = el.fill;
        ctx.fill();
      } else {
        ctx.strokeStyle = el.stroke || el.fill;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      break;

    case "arc":
      ctx.strokeStyle = el.stroke;
      ctx.lineWidth = el.thickness || 2;
      strokePath(ctx, arcPoints(el.cx, el.cy, el.r, el.startAngle, el.endAngle));
      break;

    case "sector": {
      ctx.fillStyle = el.fill;
      ctx.globalAlpha = 0.45;
      ctx.beginPath();
      ctx.moveTo(el.cx, el.cy);
      for (const p of arcPoints(el.cx, el.cy, el.r, el.startAngle, el.endAngle, 32)) {
        ctx.lineTo(p.x, p.y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = el.fill;
      ctx.lineWidth = 1;
      ctx.stroke();
      break;
    }

    case "text":
      ctx.fillStyle = el.fill;
      ctx.font = `${el.fontSize || 12}px sans-serif`;
      ctx.textBaseline = "top";
      ctx.fillText(el.text || "", el.x, el.y);
      break;

    case "bitmap": {
      const w = el.w || 1;
      const h = el.h || 1;
      if (el._preview) {
        ctx.drawImage(el._preview, el.x, el.y, w, h);
      } else if (el.colorMode === "rgb565" && el.rgb && el.rgb.length) {
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const c = el.rgb[y * w + x] || 0;
            if (!c) continue;
            const r = ((c >> 11) & 0x1f) << 3;
            const g = ((c >> 5) & 0x3f) << 2;
            const b = (c & 0x1f) << 3;
            ctx.fillStyle = `rgb(${r},${g},${b})`;
            ctx.fillRect(el.x + x, el.y + y, 1, 1);
          }
        }
      } else if (el.bits && el.bits.length) {
        const rowBytes = Math.ceil(w / 8);
        const col = el.color || "#ffffff";
        ctx.fillStyle = col;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const bi = y * rowBytes + (x >> 3);
            if (el.bits[bi] & (0x80 >> (x & 7))) {
              ctx.fillRect(el.x + x, el.y + y, 1, 1);
            }
          }
        }
      } else {
        ctx.strokeStyle = "rgba(255,255,255,0.35)";
        ctx.strokeRect(el.x + 0.5, el.y + 0.5, w - 1, h - 1);
        ctx.fillStyle = "rgba(255,255,255,0.2)";
        ctx.font = "10px sans-serif";
        ctx.fillText("PNG/BMP", el.x + 4, el.y + 14);
      }
      break;
    }

    case "scale": {
      if (el.showArc !== false) {
        ctx.strokeStyle = el.arcColor;
        ctx.lineWidth = el.arcThickness || 2;
        strokePath(ctx, arcPoints(el.cx, el.cy, el.rOuter, el.startAngle, el.endAngle, 64));
      }
      for (const t of tickPoints(el)) {
        if (t.isMajor && el.showMajorTicks === false) continue;
        if (!t.isMajor && el.showMinorTicks === false) continue;
        ctx.strokeStyle = t.isMajor ? el.majorColor : el.minorColor;
        ctx.lineWidth = t.isMajor ? 2 : 1;
        ctx.beginPath();
        ctx.moveTo(t.x1, t.y1);
        ctx.lineTo(t.x2, t.y2);
        ctx.stroke();
      }
      if (el.showLabels) {
        const fs = Math.max(6, el.labelFontSize || (el.labelTextSize || 1) * 8);
        ctx.fillStyle = el.labelColor;
        ctx.font = `${fs}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        for (const lb of scaleLabels(el)) {
          ctx.fillText(lb.text, lb.x, lb.y);
        }
      }
      // center mark
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.beginPath();
      ctx.arc(el.cx, el.cy, 2, 0, Math.PI * 2);
      ctx.fill();
      break;
    }

    default:
      break;
  }
  ctx.restore();
}

export function renderProject(ctx, project, { showGrid = true } = {}) {
  const { width, height, background, widgets } = project;
  ctx.clearRect(0, 0, width, height);
  const bg = background || "#000";
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  if (showGrid) {
    const step = width <= 160 ? 8 : 16;
    // на светлом фоне — тёмная сетка, на тёмном — светлая
    const lightBg = (() => {
      const h = String(bg).replace("#", "");
      const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.padStart(6, "0");
      const n = parseInt(full.slice(0, 6), 16) || 0;
      const r = (n >> 16) & 255;
      const g = (n >> 8) & 255;
      const b = n & 255;
      return 0.299 * r + 0.587 * g + 0.114 * b > 140;
    })();
    ctx.strokeStyle = lightBg ? "rgba(80,80,80,0.55)" : "rgba(255,255,255,0.14)";
    ctx.lineWidth = 1;
    for (let x = step; x < width; x += step) {
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, height);
      ctx.stroke();
    }
    for (let y = step; y < height; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(width, y + 0.5);
      ctx.stroke();
    }
  }

  for (const el of widgets) {
    if (el.visible === false) continue;
    drawElement(ctx, el);
  }
}
