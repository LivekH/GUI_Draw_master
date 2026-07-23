/**
 * Display presets + graphics library catalog (TFT & OLED)
 */

export const ORIENTATIONS = [
  { id: "portrait", label: "Портрет (0°)" },
  { id: "landscape", label: "Альбом (90°)" },
  { id: "portrait_inv", label: "Портрет 180°" },
  { id: "landscape_inv", label: "Альбом 270°" },
];

/** @typedef {{ id: string, label: string, w: number, h: number, kind: 'tft'|'oled'|'oled_color', controller?: string, notes?: string }} DisplayPreset */

/** @type {DisplayPreset[]} */
export const DISPLAYS = [
  // --- Mono OLED ---
  { id: "oled_128x64", label: "OLED 128×64", w: 128, h: 64, kind: "oled", controller: "SSD1306 / SH1106", notes: "самый частый I2C OLED" },
  { id: "oled_128x32", label: "OLED 128×32", w: 128, h: 32, kind: "oled", controller: "SSD1306" },
  { id: "oled_64x48", label: "OLED 64×48", w: 64, h: 48, kind: "oled", controller: "SSD1306" },
  { id: "oled_64x32", label: "OLED 64×32", w: 64, h: 32, kind: "oled", controller: "SSD1306" },
  { id: "oled_72x40", label: "OLED 72×40", w: 72, h: 40, kind: "oled", controller: "SSD1306" },
  { id: "oled_96x16", label: "OLED 96×16", w: 96, h: 16, kind: "oled", controller: "SSD1306" },
  { id: "oled_128x128", label: "OLED 128×128", w: 128, h: 128, kind: "oled", controller: "SH1107 / SSD1327" },
  { id: "oled_256x64", label: "OLED 256×64", w: 256, h: 64, kind: "oled", controller: "SSD1322" },

  // --- Color OLED ---
  { id: "oled_c_96x64", label: "OLED color 96×64", w: 96, h: 64, kind: "oled_color", controller: "SSD1331" },
  { id: "oled_c_128x128", label: "OLED color 128×128", w: 128, h: 128, kind: "oled_color", controller: "SSD1351" },

  // --- Small TFT ---
  { id: "tft_80x160", label: "TFT 80×160 (0.96\")", w: 80, h: 160, kind: "tft", controller: "ST7735" },
  { id: "tft_128x128", label: "TFT 128×128 (1.44\")", w: 128, h: 128, kind: "tft", controller: "ST7735" },
  { id: "tft_128x160", label: "TFT 128×160 (1.8\")", w: 128, h: 160, kind: "tft", controller: "ST7735" },
  { id: "tft_135x240", label: "TFT 135×240 (1.14\")", w: 135, h: 240, kind: "tft", controller: "ST7789" },
  { id: "tft_160x80", label: "TFT 160×80 (0.96\" LS)", w: 160, h: 80, kind: "tft", controller: "ST7735" },
  { id: "tft_160x128", label: "TFT 160×128", w: 160, h: 128, kind: "tft", controller: "ST7735 / ILI9163" },
  { id: "tft_240x135", label: "TFT 240×135 (1.14\" LS)", w: 240, h: 135, kind: "tft", controller: "ST7789" },
  { id: "tft_240x240", label: "TFT 240×240 (1.3\")", w: 240, h: 240, kind: "tft", controller: "ST7789 / GC9A01" },
  { id: "tft_240x280", label: "TFT 240×280", w: 240, h: 280, kind: "tft", controller: "ST7789" },
  { id: "tft_240x320", label: "TFT 240×320 (2.4\"/2.8\")", w: 240, h: 320, kind: "tft", controller: "ILI9341 / ST7789" },
  { id: "tft_320x240", label: "TFT 320×240 (2.8\" LS)", w: 320, h: 240, kind: "tft", controller: "ILI9341" },
  { id: "tft_320x480", label: "TFT 320×480 (3.5\")", w: 320, h: 480, kind: "tft", controller: "ILI9488 / HX8357" },
  { id: "tft_320x480_st7796", label: "TFT 320×480 (4\" ST7796)", w: 320, h: 480, kind: "tft", controller: "ST7796", notes: "популярный 4\" IPS" },
  { id: "tft_480x320", label: "TFT 480×320 (3.5\" LS)", w: 480, h: 320, kind: "tft", controller: "ILI9488" },
  { id: "tft_480x320_st7796", label: "TFT 480×320 (4\" ST7796 LS)", w: 480, h: 320, kind: "tft", controller: "ST7796", notes: "альбомная ориентация модуля 4\"" },
  { id: "tft_480x272", label: "TFT 480×272 (4.3\")", w: 480, h: 272, kind: "tft", controller: "RGB / RA8875" },
  { id: "tft_480x480", label: "TFT 480×480", w: 480, h: 480, kind: "tft", controller: "ST7701 / round" },
  { id: "tft_800x480", label: "TFT 800×480 (5\"/7\")", w: 800, h: 480, kind: "tft", controller: "RGB / RA8876" },
  { id: "custom", label: "Свой размер…", w: 240, h: 320, kind: "tft", controller: "—" },
];

/**
 * Libraries grouped by API family for code generation.
 * `apis`: which display kinds they typically support
 * `family`: codegen adapter id
 */
export const LIBRARIES = [
  // —— Adafruit GFX ecosystem ——
  { id: "adafruit_gfx", label: "Adafruit GFX (+ ST77xx / ILI9341 / …)", family: "adafruit_gfx", kinds: ["tft", "oled_color"], obj: "tft", color: "rgb565" },
  { id: "adafruit_ssd1306", label: "Adafruit SSD1306 (OLED)", family: "adafruit_gfx", kinds: ["oled"], obj: "display", color: "mono" },
  { id: "adafruit_sh110x", label: "Adafruit SH110X (OLED)", family: "adafruit_gfx", kinds: ["oled"], obj: "display", color: "mono" },
  { id: "adafruit_ssd1351", label: "Adafruit SSD1351 (OLED color)", family: "adafruit_gfx", kinds: ["oled_color"], obj: "tft", color: "rgb565" },
  { id: "adafruit_ssd1331", label: "Adafruit SSD1331 (OLED color)", family: "adafruit_gfx", kinds: ["oled_color"], obj: "tft", color: "rgb565" },

  // —— Popular TFT ——
  { id: "tft_espi", label: "TFT_eSPI (Bodmer)", family: "tft_espi", kinds: ["tft", "oled_color"], obj: "tft", color: "rgb565" },
  { id: "arduino_gfx", label: "Arduino_GFX (moononournation)", family: "arduino_gfx", kinds: ["tft", "oled", "oled_color"], obj: "gfx", color: "rgb565" },
  { id: "lovyangfx", label: "LovyanGFX", family: "lovyangfx", kinds: ["tft", "oled_color"], obj: "lcd", color: "rgb565" },
  { id: "mcufriend", label: "MCUFRIEND_kbv", family: "mcufriend", kinds: ["tft"], obj: "tft", color: "rgb565" },
  { id: "utft", label: "UTFT", family: "utft", kinds: ["tft"], obj: "myGLCD", color: "rgb565_utft" },

  // —— OLED-focused ——
  { id: "u8g2", label: "U8g2 (olikraus) — OLED/LCD", family: "u8g2", kinds: ["oled", "oled_color", "tft"], obj: "u8g2", color: "mono" },
  { id: "u8x8", label: "U8x8 (текстовый режим U8g2)", family: "u8x8", kinds: ["oled"], obj: "u8x8", color: "mono" },
  { id: "ssd1306_wire", label: "ThingPulse OLEDDisplay (SSD1306Wire)", family: "ssd1306_wire", kinds: ["oled"], obj: "display", color: "mono" },
  { id: "tiny4koled", label: "Tiny4kOLED", family: "tiny4koled", kinds: ["oled"], obj: "oled", color: "mono" },

  // —— Higher-level / other ——
  { id: "lvgl", label: "LVGL (canvas / draw API)", family: "lvgl", kinds: ["tft", "oled", "oled_color"], obj: "draw", color: "rgb565" },
  { id: "ucglib", label: "Ucglib", family: "ucglib", kinds: ["tft", "oled_color"], obj: "ucg", color: "rgb565" },
];

export function getDisplay(id) {
  return DISPLAYS.find((d) => d.id === id) || DISPLAYS.find((d) => d.id === "tft_240x320");
}

export function filterLibraries(displayId) {
  const d = getDisplay(displayId);
  if (!d) return LIBRARIES;
  return LIBRARIES.filter((lib) => lib.kinds.includes(d.kind));
}

export function resolveSize(displayId, orientationId) {
  const d = getDisplay(displayId);
  let w = d.w;
  let h = d.h;
  if (orientationId === "landscape" || orientationId === "landscape_inv") {
    w = d.h;
    h = d.w;
  }
  return { w, h, nativeW: d.w, nativeH: d.h };
}
