import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// WCAG 2.x contrast for the text/background token pairs the screens use.
const css = readFileSync(join(__dirname, '..', 'styles', 'tokens.css'), 'utf8');

function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  const block = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  return Object.fromEntries(
    [...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1]!, m[2]!]),
  );
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

const PAIRS: [string, string][] = [
  ['text', 'bg'],
  ['text2', 'bg'],
  ['text3', 'bg'],
  ['text', 'surface'],
  ['text2', 'surface'],
  ['text3', 'surface'],
  ['text', 'surface2'],
  ['text2', 'surface2'],
  ['text3', 'surface2'],
  ['text', 'search'],
  ['text3', 'search'],
  ['primary', 'bg'],
  ['primary', 'surface'],
  ['primary', 'search'],
  ['on-primary', 'primary'],
  ['on-pc', 'pc'],
  ['on-green', 'green'],
  ['on-gc', 'gc'],
  ['on-amber', 'amber-c'],
  ['on-amber', 'amber-soft'],
  ['amber-text', 'amber-soft'],
  ['amber-text', 'surface'],
  ['on-red', 'red-c'],
  ['on-chg', 'chg'],
  ['on-purple', 'purple-c'],
  ['purple-text', 'purple-soft'],
  ['purple-text', 'surface'],
  ['text2', 'purple-soft'],
  ['on-badge', 'badge'],
  ['text2', 'hero1'],
  ['text2', 'hero2'],
  ['text2', 'hero3'],
];

describe.each([
  ['light', ':root {'],
  ['dark', ":root[data-theme='dark']"],
])('%s theme', (_, selector) => {
  const t = tokens(selector);
  it.each(PAIRS)('%s on %s meets AA (4.5:1)', (fg, bg) => {
    expect(t[fg], fg).toBeDefined();
    expect(t[bg], bg).toBeDefined();
    expect(contrast(t[fg]!, t[bg]!)).toBeGreaterThanOrEqual(4.5);
  });
});
