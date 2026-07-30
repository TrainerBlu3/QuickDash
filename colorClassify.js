// Classifies an Excel cell fill color into what it means for course tracking:
// green -> done, blue/purple(lilac) -> priority, everything else -> no signal.
// Colors come in two forms from xlsx-populate: a plain "rgb" hex, or a
// theme index + tint (Excel's "lighter/darker" shades of a theme color),
// which has to be resolved against the workbook's actual theme palette
// before it can be classified.
const JSZip = require('jszip');

async function loadThemeColors(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const themeFile = zip.file('xl/theme/theme1.xml');
  if (!themeFile) return [];
  const xml = await themeFile.async('string');
  const found = {};
  for (const m of xml.matchAll(/<a:(\w+)>\s*<a:(?:srgbClr val|sysClr[^>]*lastClr)="([0-9A-Fa-f]{6})"/g)) {
    found[m[1]] = m[2].toUpperCase();
  }
  // Excel's UI order swaps lt1/dk1 to the front relative to the raw scheme order.
  return [found.lt1 || 'FFFFFF', found.dk1 || '000000', found.lt2 || 'FFFFFF', found.dk2 || '000000',
    found.accent1, found.accent2, found.accent3, found.accent4, found.accent5, found.accent6,
    found.hlink, found.folHlink];
}

function hexToRgb(hex) {
  const n = parseInt(hex, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s;
  const l = (max + min) / 2;
  if (max === min) {
    h = s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4;
    }
    h /= 6;
  }
  return [h, s, l];
}

function hslToRgb(h, s, l) {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue2rgb(p, q, h + 1 / 3), hue2rgb(p, q, h), hue2rgb(p, q, h - 1 / 3)].map(v => Math.round(v * 255));
}

// Excel's documented tint algorithm: lightens (tint > 0) or darkens (tint < 0)
// a theme color by adjusting HSL lightness.
function applyTint(hex, tint) {
  const t = Number(tint);
  const [h, s, l] = rgbToHsl(...hexToRgb(hex));
  const l2 = t < 0 ? l * (1 + t) : l * (1 - t) + t;
  const [r, g, b] = hslToRgb(h, s, Math.max(0, Math.min(1, l2)));
  return [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
}

function resolveFillHex(fill, themeColors) {
  if (!fill || fill.type !== 'solid' || !fill.color) return null;
  const { color } = fill;
  if (color.rgb) {
    const hex = color.rgb.length === 8 ? color.rgb.slice(2) : color.rgb; // strip ARGB alpha
    return hex.toUpperCase();
  }
  if (typeof color.theme === 'number' && themeColors[color.theme]) {
    const base = themeColors[color.theme];
    return color.tint ? applyTint(base, color.tint) : base;
  }
  return null;
}

// Buckets a resolved hex color by what it means for a course row: green is
// "done", white/no-fill (or any near-white/gray) is the neutral baseline,
// and any other color signals higher priority than a plain white row.
function classifyHex(hex) {
  if (!hex) return { done: false, priority: false }; // no fill = white = not done, no priority
  const [r, g, b] = hexToRgb(hex);
  const [h, s, l] = rgbToHsl(r, g, b);
  if (s < 0.15 || l > 0.94) return { done: false, priority: false }; // white/gray
  const hueDeg = h * 360;
  if (hueDeg >= 70 && hueDeg <= 160) return { done: true, priority: false }; // green
  return { done: false, priority: true }; // any other color -> higher priority than white
}

// Highlighting isn't always applied to every column in a row (e.g. a
// priority marker might only color columns 3-10), so scan the whole row
// and use the first cell that actually carries a color signal.
function classifyRow(sheet, rowNumber, columnCount, themeColors) {
  for (let col = 1; col <= columnCount; col++) {
    const fill = sheet.cell(rowNumber, col).style('fill');
    const hex = resolveFillHex(fill, themeColors);
    if (!hex) continue;
    const cls = classifyHex(hex);
    if (cls.done || cls.priority) return { ...cls, hex };
  }
  return { done: false, priority: false, hex: null };
}

module.exports = { loadThemeColors, resolveFillHex, classifyHex, classifyRow };
