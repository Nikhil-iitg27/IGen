// Cover-scale + single-axis window crop for the Inpaint upload flow.
//
// The model (pipeline.py) only ever works at STANDARD_RES x STANDARD_RES
// and force-resizes whatever it's given -- an arbitrary-aspect upload
// sent as-is would get squished. Instead we scale the whole image
// uniformly (preserving aspect ratio) until its *smaller* dimension
// equals STANDARD_RES, then the larger dimension necessarily overhangs
// past STANDARD_RES on exactly one axis -- so picking the 512x512 window
// only ever needs a single scalar offset along that one axis, never a
// full 2D crop box.
//
// STANDARD_RES must match pipeline.py's WIDTH/HEIGHT -- a second source
// of truth, but one that only drifts if the model itself is retrained
// at a different resolution, which is rare/heavy enough that manual
// sync is an acceptable tradeoff over threading it through the API.
export const STANDARD_RES = 512;

export function loadImageDimensions(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = reject;
    img.src = dataUrl;
  });
}

export function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}

/**
 * scale: multiplier applied uniformly to both source dimensions so the
 * smaller one lands exactly on STANDARD_RES.
 * axis: which axis has overhang left over after that scale ('x' if the
 * source is wider than tall, 'y' if taller, null if already square).
 * overhang: source-pixel slack on `axis` after scaling (0 if square).
 * willUpscale: true when the source's smaller dimension is below
 * STANDARD_RES, i.e. scale > 1 -- the whole image will be upscaled, not
 * just downscaled, which is the case worth warning the user about.
 */
export function computeCoverGeometry(srcWidth, srcHeight) {
  const smaller = Math.min(srcWidth, srcHeight);
  const scale = STANDARD_RES / smaller;
  const scaledWidth = srcWidth * scale;
  const scaledHeight = srcHeight * scale;

  let axis = null;
  let overhang = 0;
  if (scaledWidth > scaledHeight) {
    axis = "x";
    overhang = (scaledWidth - STANDARD_RES) / scale; // back in source pixels
  } else if (scaledHeight > scaledWidth) {
    axis = "y";
    overhang = (scaledHeight - STANDARD_RES) / scale;
  }

  return { scale, axis, overhang, willUpscale: scale > 1 };
}

/**
 * Extracts the STANDARD_RES x STANDARD_RES window at `offsetFraction`
 * (0..1, 0.5 = centered) along `geometry.axis`. Returns the window as a
 * data URL plus the exact source-pixel rect it came from (needed later
 * to composite the result back into the original).
 */
export function extractWindow(img, geometry, offsetFraction = 0.5) {
  const { scale, axis, overhang } = geometry;
  const windowSrcSize = STANDARD_RES / scale; // STANDARD_RES back in source pixels (== the smaller source dimension)

  let sx = 0;
  let sy = 0;
  let sWidth = img.naturalWidth;
  let sHeight = img.naturalHeight;

  if (axis === "x") {
    sWidth = windowSrcSize;
    sx = overhang * offsetFraction;
  } else if (axis === "y") {
    sHeight = windowSrcSize;
    sy = overhang * offsetFraction;
  }

  const canvas = document.createElement("canvas");
  canvas.width = STANDARD_RES;
  canvas.height = STANDARD_RES;
  const ctx = canvas.getContext("2d");
  // The browser's own high-quality resampler is the "algorithmic
  // smoothing" applied when the source is smaller than STANDARD_RES
  // (willUpscale) -- no separate upsampling model needed.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, STANDARD_RES, STANDARD_RES);

  return {
    dataUrl: canvas.toDataURL("image/png"),
    sourceRect: { x: sx, y: sy, width: sWidth, height: sHeight },
  };
}

/**
 * The crop window's position/size as percentages of the source image's
 * own box -- works regardless of what pixel size the <img> is actually
 * rendered at, since percentages of a non-distorted image map 1:1 to
 * source-pixel fractions on both axes.
 */
export function windowRectFraction(geometry, srcWidth, srcHeight, offsetFraction = 0.5) {
  const { axis, overhang } = geometry;
  if (axis === "x") {
    const widthPct = ((srcWidth - overhang) / srcWidth) * 100;
    const leftPct = ((overhang * offsetFraction) / srcWidth) * 100;
    return { leftPct, topPct: 0, widthPct, heightPct: 100 };
  }
  if (axis === "y") {
    const heightPct = ((srcHeight - overhang) / srcHeight) * 100;
    const topPct = ((overhang * offsetFraction) / srcHeight) * 100;
    return { leftPct: 0, topPct, widthPct: 100, heightPct };
  }
  return { leftPct: 0, topPct: 0, widthPct: 100, heightPct: 100 };
}

/**
 * Splices the edited window back into the original image at full
 * original resolution -- everything outside sourceRect is
 * byte-for-byte the original, only the edited window differs.
 */
export async function compositeResult(originalDataUrl, resultDataUrl, sourceRect) {
  const [original, result] = await Promise.all([
    loadImage(originalDataUrl),
    loadImage(resultDataUrl),
  ]);

  const canvas = document.createElement("canvas");
  canvas.width = original.naturalWidth;
  canvas.height = original.naturalHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(original, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(result, sourceRect.x, sourceRect.y, sourceRect.width, sourceRect.height);

  return canvas.toDataURL("image/png");
}
