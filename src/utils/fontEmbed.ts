// Builds a self-contained @font-face stylesheet (woff2 inlined as base64 data: URIs)
// for feeding to modern-screenshot's `font.cssText` option. The exported image is
// rasterized via an SVG <foreignObject>, where url() refs to same-origin fonts don't
// resolve — so the font binaries must be inlined as data: URIs, and the cross-origin
// Google Fonts dependency is bypassed entirely, making the export deterministic.

const WEIGHTS = [400, 500, 600, 700, 800] as const;

const SUBSETS = [
  {
    name: 'latin',
    range:
      'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD'
  },
  {
    name: 'latin-ext',
    range:
      'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF'
  }
] as const;

let cached: Promise<string> | null = null;

async function woff2DataUri(url: string): Promise<string> {
  const buf = await (await fetch(url)).arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return `data:font/woff2;base64,${btoa(binary)}`;
}

/**
 * Returns a memoized @font-face stylesheet for Inter (weights 400-800, latin +
 * latin-ext), with each woff2 inlined as a base64 data: URI. Pass as
 * `font: { cssText }` to modern-screenshot so the export embeds Inter reliably
 * instead of relying on a runtime fetch of the cross-origin Google Fonts CSS.
 */
export function interEmbedCss(): Promise<string> {
  if (!cached) {
    const attempt = (async () => {
      const rules = await Promise.all(
        SUBSETS.flatMap(subset =>
          WEIGHTS.map(async weight => {
            const uri = await woff2DataUri(`/fonts/inter-${subset.name}-${weight}.woff2`);
            return `@font-face{font-family:'Inter';font-style:normal;font-weight:${weight};font-display:swap;src:url(${uri}) format('woff2');unicode-range:${subset.range};}`;
          })
        )
      );
      return rules.join('');
    })();
    // Don't pin a failed load — one transient fetch error would otherwise
    // break image export for the rest of the session.
    attempt.catch(() => {
      if (cached === attempt) {
        cached = null;
      }
    });
    cached = attempt;
  }
  return cached;
}
