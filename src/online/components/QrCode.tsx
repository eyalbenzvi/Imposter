import { useMemo } from 'react';
import qr from 'qrcode-generator';

/**
 * The join link as something a phone camera can swallow whole.
 *
 * Reading six digits aloud across a noisy room and having five people type
 * them is the slowest part of starting a game. A camera does it in a second.
 *
 * Rendered as SVG rather than canvas: it is a handful of rectangles, it scales
 * to any screen without going fuzzy, and it needs no ref, no layout effect and
 * no device-pixel-ratio arithmetic.
 */
export function QrCode({ url, size = 168 }: { url: string; size?: number }) {
  const path = useMemo(() => qrPath(url), [url]);
  if (!path) return null;

  return (
    <svg
      // The viewBox is in module units, so the drawing is resolution-free and
      // `size` is the only thing that decides how big it lands.
      viewBox={`0 0 ${path.count + QUIET * 2} ${path.count + QUIET * 2}`}
      width={size}
      height={size}
      role="img"
      aria-label="קוד לסריקה שפותח את המשחק"
      shapeRendering="crispEdges"
      className="block"
    >
      {/* Deliberately a white card with dark modules, against the app's dark
          theme. An inverted code reads on many scanners and fails on some, and
          this one has to work on the first try or nobody uses it. */}
      <rect
        x="0"
        y="0"
        width={path.count + QUIET * 2}
        height={path.count + QUIET * 2}
        fill="#ffffff"
      />
      <path d={path.d} fill="#0b0b12" />
    </svg>
  );
}

/** Modules of white margin. Four is what the spec asks for, and scanners need it. */
export const QUIET = 4;

/**
 * The module grid, as plain booleans.
 *
 * Split out from the drawing so the encoding can be checked without a DOM —
 * see `QrCode.test.ts`, which looks for the three finder patterns that make a
 * QR scannable at all.
 */
export function qrMatrix(url: string): boolean[][] | null {
  try {
    // Version 0 = "pick the smallest that fits". Error correction M survives a
    // thumb over a corner without inflating the code.
    const code = qr(0, 'M');
    code.addData(url);
    code.make();
    const count = code.getModuleCount();
    return Array.from({ length: count }, (_, row) =>
      Array.from({ length: count }, (_, col) => code.isDark(row, col)),
    );
  } catch {
    // A URL too long for any version, or a build without the library. The code
    // is a shortcut, never the only way in — the digits are right above it.
    return null;
  }
}

export function qrPath(url: string): { d: string; count: number } | null {
  const matrix = qrMatrix(url);
  if (!matrix) return null;
  const count = matrix.length;
  const parts: string[] = [];
  for (let row = 0; row < count; row++) {
    // Merge runs of dark modules into one rectangle each: a 33×33 code is over
    // a thousand elements drawn one at a time, and a few dozen this way.
    let start = -1;
    for (let col = 0; col <= count; col++) {
      const dark = col < count && matrix[row]![col]!;
      if (dark && start === -1) start = col;
      if (!dark && start !== -1) {
        parts.push(`M${start + QUIET} ${row + QUIET}h${col - start}v1h-${col - start}z`);
        start = -1;
      }
    }
  }
  return { d: parts.join(''), count };
}
