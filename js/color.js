/** RGB888 ↔ RGB565 helpers */

export function hexToRgb(hex) {
  const h = String(hex || "#000000").replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.padStart(6, "0");
  const n = parseInt(full.slice(0, 6), 16) || 0;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbTo565(r, g, b) {
  return ((r & 0xf8) << 8) | ((g & 0xfc) << 3) | (b >> 3);
}

export function hexTo565(hex) {
  const { r, g, b } = hexToRgb(hex);
  return rgbTo565(r, g, b);
}

export function format565(hex) {
  return "0x" + hexTo565(hex).toString(16).toUpperCase().padStart(4, "0");
}

/** UTFT uses separate R,G,B 0-255 often via setColor */
export function formatUtftColor(hex) {
  const { r, g, b } = hexToRgb(hex);
  return `${r}, ${g}, ${b}`;
}

export function luminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** For mono OLED: treat bright colors as ON */
export function isOn(hex) {
  return luminance(hex) > 40;
}
