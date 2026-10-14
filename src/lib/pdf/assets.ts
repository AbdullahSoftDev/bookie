/**
 * Binary assets the PDF/A-3 e-invoice needs: embedded fonts (PDF/A forbids the
 * non-embedded standard-14 fonts) and the sRGB ICC profile for the OutputIntent.
 * Loaded via fetch(new URL(...)) so Vite emits them as hashed assets in the app
 * and Bun reads them from disk in tests.
 */

async function load(url: URL): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok)
    throw new Error(`Failed to load PDF asset ${url.pathname}: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** Liberation Sans (SIL OFL, metric-compatible with Helvetica/Arial). */
export const loadFontBytes = () =>
  Promise.all([
    load(new URL("./assets/LiberationSans-Regular.ttf", import.meta.url)),
    load(new URL("./assets/LiberationSans-Bold.ttf", import.meta.url)),
  ]);

/** sRGB IEC61966-2.1 profile by Graeme W. Gill, public domain. */
export const loadSrgbIcc = () =>
  load(new URL("./assets/sRGB.icc", import.meta.url));
