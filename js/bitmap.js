/**
 * PNG/BMP → 1-bit (GFX drawBitmap) or RGB565 (pushImage / drawRGBBitmap)
 */

import { rgbTo565 } from "./color.js?v=20260724g";

/** @param {File|Blob} file */
export function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error || new Error("read failed"));
    r.readAsDataURL(file);
  });
}

/** @param {string} dataUrl */
export function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Не удалось загрузить изображение"));
    img.src = dataUrl;
  });
}

/**
 * Fit into maxW×maxH keeping aspect ratio.
 * @returns {{ w: number, h: number }}
 */
export function fitSize(srcW, srcH, maxW, maxH) {
  if (srcW <= 0 || srcH <= 0) return { w: 16, h: 16 };
  const s = Math.min(maxW / srcW, maxH / srcH, 1);
  return {
    w: Math.max(1, Math.round(srcW * s)),
    h: Math.max(1, Math.round(srcH * s)),
  };
}

async function getImageData(dataUrl, w, h) {
  const img = await loadImage(dataUrl);
  const tw = Math.max(1, Math.min(800, Math.round(w)));
  const th = Math.max(1, Math.min(800, Math.round(h)));
  const canvas = document.createElement("canvas");
  canvas.width = tw;
  canvas.height = th;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = tw < img.width || th < img.height;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, tw, th);
  ctx.drawImage(img, 0, 0, tw, th);
  return { data: ctx.getImageData(0, 0, tw, th).data, w: tw, h: th };
}

/**
 * Rasterize → 1-bit MSB-first rows (GFX drawBitmap).
 * @returns {Promise<{ bits: number[], rgb: null, bytes: number, w: number, h: number, mode: 'mono' }>}
 */
export async function rasterizeToBits(dataUrl, w, h, threshold = 128, invert = false) {
  const { data, w: tw, h: th } = await getImageData(dataUrl, w, h);
  const rowBytes = Math.ceil(tw / 8);
  const bits = new Array(rowBytes * th).fill(0);
  const thr = Math.max(0, Math.min(255, threshold | 0));

  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      const i = (y * tw + x) * 4;
      const a = data[i + 3];
      const lum = a < 16 ? 255 : 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      let on = lum < thr;
      if (invert) on = !on;
      if (on) {
        const bi = y * rowBytes + (x >> 3);
        bits[bi] |= 0x80 >> (x & 7);
      }
    }
  }
  return { bits, rgb: null, bytes: bits.length, w: tw, h: th, mode: "mono" };
}

/**
 * Rasterize → RGB565 pixel array (row-major).
 * @returns {Promise<{ bits: null, rgb: number[], bytes: number, w: number, h: number, mode: 'rgb565' }>}
 */
export async function rasterizeToRgb565(dataUrl, w, h) {
  const { data, w: tw, h: th } = await getImageData(dataUrl, w, h);
  const rgb = new Array(tw * th);
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      const i = (y * tw + x) * 4;
      const a = data[i + 3];
      if (a < 16) {
        rgb[y * tw + x] = 0x0000;
      } else {
        rgb[y * tw + x] = rgbTo565(data[i], data[i + 1], data[i + 2]);
      }
    }
  }
  return { bits: null, rgb, bytes: rgb.length * 2, w: tw, h: th, mode: "rgb565" };
}

/** @param {'mono'|'rgb565'} mode */
export async function rasterizeBitmap(dataUrl, w, h, { mode = "mono", threshold = 128, invert = false } = {}) {
  if (mode === "rgb565") return rasterizeToRgb565(dataUrl, w, h);
  return rasterizeToBits(dataUrl, w, h, threshold, invert);
}

/** Preview ImageData from packed 1-bit */
export function bitsToImageData(bits, w, h) {
  const rowBytes = Math.ceil(w / 8);
  const img = new ImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const bi = y * rowBytes + (x >> 3);
      const on = (bits[bi] & (0x80 >> (x & 7))) !== 0;
      const p = (y * w + x) * 4;
      const v = on ? 0 : 255;
      d[p] = d[p + 1] = d[p + 2] = v;
      d[p + 3] = on ? 255 : 0;
    }
  }
  return img;
}

/** Preview from RGB565 array */
export function rgb565ToImageData(rgb, w, h) {
  const img = new ImageData(w, h);
  const d = img.data;
  for (let i = 0; i < w * h; i++) {
    const c = rgb[i] || 0;
    const r = ((c >> 11) & 0x1f) << 3;
    const g = ((c >> 5) & 0x3f) << 2;
    const b = (c & 0x1f) << 3;
    const p = i * 4;
    d[p] = r;
    d[p + 1] = g;
    d[p + 2] = b;
    d[p + 3] = c === 0 ? 0 : 255; // 0x0000 ≈ прозрачный фон в редакторе
  }
  return img;
}

/** C array: unsigned char (1-bit) */
export function bitsToCArray(bits, name = "bitmap") {
  const lines = [];
  lines.push(`static const unsigned char ${name}[] PROGMEM = {`);
  const chunk = 12;
  for (let i = 0; i < bits.length; i += chunk) {
    const part = bits.slice(i, i + chunk).map((b) => `0x${b.toString(16).padStart(2, "0")}`);
    const comma = i + chunk < bits.length ? "," : "";
    lines.push(`  ${part.join(", ")}${comma}`);
  }
  lines.push(`};`);
  return lines;
}

/** C array: uint16_t RGB565 */
export function rgb565ToCArray(rgb, name = "bitmap") {
  const lines = [];
  lines.push(`static const uint16_t ${name}[] PROGMEM = {`);
  const chunk = 8;
  for (let i = 0; i < rgb.length; i += chunk) {
    const part = rgb
      .slice(i, i + chunk)
      .map((c) => `0x${(c & 0xffff).toString(16).toUpperCase().padStart(4, "0")}`);
    const comma = i + chunk < rgb.length ? "," : "";
    lines.push(`  ${part.join(", ")}${comma}`);
  }
  lines.push(`};`);
  return lines;
}

export function safeArrayName(id, name) {
  const base = String(name || id || "bmp")
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .replace(/^([^a-zA-Z_])/, "_$1")
    .slice(0, 40);
  return `bmp_${base}_${String(id).replace(/\W/g, "")}`;
}
