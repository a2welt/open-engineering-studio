import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// WCAG 2.x contrast for the text/background pairs the screens use. Glass and chip tokens are
// translucent, so each pair is composited the way the browser paints it: translucent text over
// its background, the background over the glass, and the glass over the backdrop. For glass,
// the backdrop is each colour blob in turn (the worst case behind any panel).
const css = readFileSync(join(__dirname, '..', 'styles', 'tokens.css'), 'utf8');

type Rgba = [number, number, number, number];

function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  const block = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  return Object.fromEntries(
    [...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6}|rgba\([^)]*\)|[\d.]+)\s*;/gi)].map((m) => [m[1]!, m[2]!]),
  );
}

function parse(value: string): Rgba {
  if (value.startsWith('#')) {
    return [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16)).concat(1) as Rgba;
  }
  const [r, g, b, a] = value.slice(value.indexOf('(') + 1, -1).split(',').map(Number);
  return [r!, g!, b!, a ?? 1];
}

/** Paint `top` over an opaque `bottom`. */
function over(top: Rgba, bottom: Rgba): Rgba {
  const a = top[3];
  return [0, 1, 2].map((i) => top[i]! * a + bottom[i]! * (1 - a)).concat(1) as Rgba;
}

function luminance([r, g, b]: Rgba): number {
  const [lr, lg, lb] = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lr! + 0.7152 * lg! + 0.0722 * lb!;
}

function contrast(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

const THEMES: [string, string][] = [
  ['light', ':root {'],
  ['dark', ":root[data-theme='dark']"],
];

// Text on glass panels (tint) and solid controls.
const ON_GLASS = ['text', 'text2', 'text3', 'accent', 'purple-text', 'on-amber', 'reject'];
// Text on tinted chips and states, which sit on a glass panel.
const ON_CHIP: [string, string][] = [
  ['on-blue', 'blue-c'],
  ['on-purple', 'purple-c'],
  ['on-green', 'green-c'],
  ['on-amber', 'amber-c'],
  ['on-red', 'red-c'],
  ['text', 'tile'],
  ['text2', 'tile'],
  ['text3', 'tile'],
];
// Text on solid fills.
const ON_SOLID: [string, string][] = [
  ['on-btn', 'btn'],
  ['on-approve', 'approve'],
  ['on-badge', 'badge'],
  ['text', 'surface'],
  ['text2', 'surface'],
  ['text3', 'surface'],
];

describe.each(THEMES)('%s theme', (_, selector) => {
  const t = tokens(selector);
  const color = (name: string) => {
    expect(t[name], name).toBeDefined();
    return parse(t[name]!);
  };
  const base = color('base');
  const blobs = ['b1', 'b2', 'b3', 'b4', 'b5'].map((b) => {
    const [r, g, bl] = color(b);
    return over([r, g, bl, Number(t.blob)], base);
  });
  // Glass over the backdrop: the plain backdrop, and each blob at full strength.
  const glasses = (tint: string) => [base, ...blobs].map((behind) => over(color(tint), behind));

  it.each(ON_GLASS.flatMap((fg) => ['tint', 'tint-strong', 'amber-glass'].map((g) => [fg, g])))(
    '%s on %s over every blob meets AA (4.5:1)',
    (fg, tint) => {
      for (const glass of glasses(tint!)) {
        expect(contrast(over(color(fg!), glass), glass)).toBeGreaterThanOrEqual(4.5);
      }
    },
  );

  it.each(ON_CHIP)('%s on %s over glass meets AA (4.5:1)', (fg, chip) => {
    for (const glass of glasses('tint-strong')) {
      const bg = over(color(chip), glass);
      expect(contrast(over(color(fg), bg), bg)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(ON_SOLID)('%s on %s meets AA (4.5:1)', (fg, bg) => {
    const solid = color(bg);
    expect(contrast(over(color(fg), solid), solid)).toBeGreaterThanOrEqual(4.5);
  });
});
