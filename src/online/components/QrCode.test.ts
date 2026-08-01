import { describe, expect, it } from 'vitest';
import { QUIET, qrMatrix, qrPath } from './QrCode';

const JOIN_URL = 'https://eyalbenzvi.github.io/Imposter/#join=725985';

/**
 * A QR code either scans on the first try or nobody uses it, and "it looked
 * like a QR in the screenshot" is not evidence of that. What makes one
 * machine-readable is structural: three 7×7 finder patterns in the corners, a
 * quiet margin around the whole thing, and the alternating timing rows that
 * tell a scanner the module size. Those are checkable without a camera.
 */
function isFinderPattern(m: boolean[][], top: number, left: number): boolean {
  // The canonical 7×7: solid ring, one-module gap, solid 3×3 core.
  for (let r = 0; r < 7; r++) {
    for (let c = 0; c < 7; c++) {
      const ring = r === 0 || r === 6 || c === 0 || c === 6;
      const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      if (m[top + r]![left + c]! !== (ring || core)) return false;
    }
  }
  return true;
}

describe('the join code', () => {
  it('encodes to a real QR — finder patterns in all three corners', () => {
    const m = qrMatrix(JOIN_URL)!;
    expect(m).not.toBeNull();
    const n = m.length;
    expect(isFinderPattern(m, 0, 0), 'top-left').toBe(true);
    expect(isFinderPattern(m, 0, n - 7), 'top-right').toBe(true);
    expect(isFinderPattern(m, n - 7, 0), 'bottom-left').toBe(true);
    // …and deliberately nothing in the fourth: that is how a scanner works out
    // which way up the code is.
    expect(isFinderPattern(m, n - 7, n - 7)).toBe(false);
  });

  it('carries the timing pattern that sets the module size', () => {
    const m = qrMatrix(JOIN_URL)!;
    for (let col = 8; col < m.length - 8; col++) {
      expect(m[6]![col], `timing col ${col}`).toBe(col % 2 === 0);
    }
  });

  it('is a square grid of a valid QR version', () => {
    const m = qrMatrix(JOIN_URL)!;
    expect(m.length).toBeGreaterThanOrEqual(21);
    expect((m.length - 17) % 4).toBe(0);
    for (const row of m) expect(row).toHaveLength(m.length);
  });

  it('changes completely when the room code does', () => {
    const a = qrPath('https://x.test/#join=111111')!.d;
    const b = qrPath('https://x.test/#join=222222')!.d;
    expect(a).not.toBe(b);
  });

  it('draws inside the quiet margin, never over it', () => {
    const { d, count } = qrPath(JOIN_URL)!;
    const xs = [...d.matchAll(/M(\d+) (\d+)h(\d+)/g)];
    expect(xs.length).toBeGreaterThan(0);
    for (const [, x, y, w] of xs) {
      expect(Number(x)).toBeGreaterThanOrEqual(QUIET);
      expect(Number(y)).toBeGreaterThanOrEqual(QUIET);
      expect(Number(x) + Number(w)).toBeLessThanOrEqual(QUIET + count);
    }
  });

  it('gives up quietly rather than throwing on something it cannot encode', () => {
    expect(qrMatrix('x'.repeat(10_000))).toBeNull();
    expect(qrPath('x'.repeat(10_000))).toBeNull();
  });
});
