import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import style from "./assets/MaskCanvas.module.css";

const MAX_DISPLAY_WIDTH = 480;
const REGEN_TINT = [255, 92, 92]; // matches --danger, heat-map style: more red = more noise
const MAX_DISPLAY_OPACITY = 0.7;

/**
 * Mask painting editor over a source image.
 *
 * Two separate canvases sit on top of the image, not one:
 *  - "data" canvas: the real mask, grayscale 0 (preserve) .. 255 (fully
 *    regenerate) -- matches pipeline.py's continuous blend exactly, no
 *    conversion needed on export, just canvas.toDataURL(). Never rendered
 *    visibly on its own.
 *  - "display" canvas: purely visual, and purely *derived* from the data
 *    canvas -- never drawn on directly with blended strokes. Every paint
 *    operation writes to the data canvas first (plain solid fills, always
 *    overwrite, never accumulate), then the affected region's display
 *    pixels are recomputed straight from the data canvas's current values
 *    and written with putImageData (a raw pixel write, not a composited
 *    draw). This is what makes overlapping strokes behave correctly: the
 *    display can only ever show exactly what the data currently holds,
 *    so a new stroke visibly *replaces* an old one instead of darkening
 *    on top of it, and painting at intensity 0 (fully preserve) always
 *    shows as fully clear, not an invisible black-on-black paint.
 *
 * One continuous intensity value (0..255) drives every stroke -- there is
 * no separate "keep" mode, since painting at 0 already produces exactly
 * that: it's mathematically the same operation, not a different one.
 *
 * All three canvases are allocated at the image's *natural* resolution,
 * then shrunk via CSS for display -- pointer coordinates are converted
 * back to natural-resolution space so the exported mask stays
 * pixel-aligned with the source image without any rescaling step.
 */
const MaskCanvas = forwardRef(function MaskCanvas({ imageSrc }, ref) {
  const imageCanvasRef = useRef(null);
  const dataCanvasRef = useRef(null);
  const displayCanvasRef = useRef(null);
  const drawingRef = useRef(false);
  const startPointRef = useRef(null);
  const lastPointRef = useRef(null);
  const dataSnapshotRef = useRef(null);

  const [tool, setTool] = useState("freehand"); // "freehand" | "rectangle"
  const [brushSize, setBrushSize] = useState(40);
  // 0.00..1.00, step 0.01: the actual paint value, matching pipeline.py's
  // mask blend weight exactly (0 = fully preserve, 1 = fully regenerate)
  // -- converted to a 0..255 grey value only at paint time, see
  // applyDataPaintStyle. There is no separate "keep" mode: 0 already *is*
  // keep, so "keep" below is just a toggle between 0 and the last
  // nonzero-ish value, not a different kind of operation.
  const [noiseExtent, setNoiseExtent] = useState(1);
  const isKeep = noiseExtent === 0;
  // What the button should do coming back from 0 depends on *how* it got
  // to 0: if the button itself zeroed it, pressing again restores exactly
  // what it was before (a true round-trip toggle). If the slider was
  // dragged down to 0 by hand, there's no single "previous value" to
  // round-trip to -- pressing the button then just nudges up to 0.01.
  const preToggleValueRef = useRef(1);
  const zeroedByButtonRef = useRef(false);

  function toggleKeep() {
    if (isKeep) {
      setNoiseExtent(
        zeroedByButtonRef.current && preToggleValueRef.current > 0
          ? preToggleValueRef.current
          : 0.01
      );
      zeroedByButtonRef.current = false;
    } else {
      preToggleValueRef.current = noiseExtent;
      setNoiseExtent(0);
      zeroedByButtonRef.current = true;
    }
  }

  function handleSliderChange(value) {
    // Any direct slider interaction takes over "how we got to 0" --
    // even if this drag happens to land exactly on 0, that's the slider's
    // doing, not the button's, so a later button press should nudge, not
    // restore a stale remembered value.
    zeroedByButtonRef.current = false;
    setNoiseExtent(value);
  }

  const [displaySize, setDisplaySize] = useState({ width: 0, height: 0 });

  // Recomputes display pixels from the data canvas's current values, for
  // just the given region (or the whole canvas if no region given).
  // putImageData is a raw write, not a composited draw -- this is what
  // guarantees no accumulation is possible, by construction.
  function syncDisplayFromData(x, y, w, h) {
    const dataCanvas = dataCanvasRef.current;
    const displayCanvas = displayCanvasRef.current;
    if (!dataCanvas || !displayCanvas) return;

    let rx = 0, ry = 0, rw = dataCanvas.width, rh = dataCanvas.height;
    if (x !== undefined) {
      rx = Math.max(0, Math.floor(x));
      ry = Math.max(0, Math.floor(y));
      rw = Math.min(dataCanvas.width - rx, Math.ceil(w));
      rh = Math.min(dataCanvas.height - ry, Math.ceil(h));
      if (rw <= 0 || rh <= 0) return;
    }

    const dataCtx = dataCanvas.getContext("2d");
    const displayCtx = displayCanvas.getContext("2d");
    const imageData = dataCtx.getImageData(rx, ry, rw, rh);
    const pixels = imageData.data;
    const [tr, tg, tb] = REGEN_TINT;
    for (let i = 0; i < pixels.length; i += 4) {
      const grey = pixels[i]; // data canvas is always drawn grayscale, R==G==B
      if (grey > 0) {
        pixels[i] = tr;
        pixels[i + 1] = tg;
        pixels[i + 2] = tb;
        pixels[i + 3] = Math.round((grey / 255) * MAX_DISPLAY_OPACITY * 255);
      } else {
        pixels[i + 3] = 0; // fully transparent -- reveals the plain image
      }
    }
    displayCtx.putImageData(imageData, rx, ry);
  }

  const resetMask = () => {
    const dataCanvas = dataCanvasRef.current;
    if (!dataCanvas) return;
    const dataCtx = dataCanvas.getContext("2d");
    dataCtx.globalCompositeOperation = "source-over";
    dataCtx.fillStyle = "black";
    dataCtx.fillRect(0, 0, dataCanvas.width, dataCanvas.height);
    syncDisplayFromData();
  };

  useEffect(() => {
    if (!imageSrc) return;
    const img = new Image();
    img.onload = () => {
      const { naturalWidth: w, naturalHeight: h } = img;
      for (const canvasRef of [imageCanvasRef, dataCanvasRef, displayCanvasRef]) {
        canvasRef.current.width = w;
        canvasRef.current.height = h;
      }
      imageCanvasRef.current.getContext("2d").drawImage(img, 0, 0);
      resetMask();

      const scale = Math.min(1, MAX_DISPLAY_WIDTH / w);
      setDisplaySize({ width: w * scale, height: h * scale });
    };
    img.src = imageSrc;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageSrc]);

  useImperativeHandle(ref, () => ({
    getMaskBase64: () => {
      const dataUrl = dataCanvasRef.current.toDataURL("image/png");
      return dataUrl.split(",")[1];
    },
    clear: resetMask,
  }));

  function getCanvasPoint(e) {
    const canvas = displayCanvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }

  // Only ever touches the data canvas -- the display canvas is never
  // painted directly, see syncDisplayFromData above. One continuous
  // value, not a mode switch: noiseExtent=0 paints rgb(0,0,0), which is
  // exactly "keep" -- there's no separate branch for it because there's
  // nothing mathematically different about it.
  function applyDataPaintStyle(dataCtx) {
    dataCtx.globalCompositeOperation = "source-over";
    const grey = Math.round(noiseExtent * 255);
    dataCtx.fillStyle = dataCtx.strokeStyle = `rgb(${grey}, ${grey}, ${grey})`;
  }

  function handlePointerDown(e) {
    e.preventDefault();
    const displayCanvas = displayCanvasRef.current;
    displayCanvas.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    const point = getCanvasPoint(e);
    startPointRef.current = point;
    lastPointRef.current = point;

    const dataCtx = dataCanvasRef.current.getContext("2d");
    applyDataPaintStyle(dataCtx);

    if (tool === "freehand") {
      dataCtx.lineJoin = "round";
      dataCtx.lineCap = "round";
      dataCtx.lineWidth = brushSize;
      dataCtx.beginPath();
      dataCtx.moveTo(point.x, point.y);
      // A single click without a drag should still leave a dot.
      dataCtx.lineTo(point.x + 0.01, point.y + 0.01);
      dataCtx.stroke();
      const r = brushSize / 2 + 2;
      syncDisplayFromData(point.x - r, point.y - r, r * 2, r * 2);
    } else {
      dataSnapshotRef.current = dataCtx.getImageData(
        0, 0, dataCanvasRef.current.width, dataCanvasRef.current.height
      );
    }
  }

  function handlePointerMove(e) {
    if (!drawingRef.current) return;
    const dataCtx = dataCanvasRef.current.getContext("2d");
    const point = getCanvasPoint(e);

    if (tool === "freehand") {
      dataCtx.lineTo(point.x, point.y);
      dataCtx.stroke();
      const prev = lastPointRef.current;
      const r = brushSize / 2 + 2;
      const x = Math.min(prev.x, point.x) - r;
      const y = Math.min(prev.y, point.y) - r;
      const w = Math.abs(point.x - prev.x) + r * 2;
      const h = Math.abs(point.y - prev.y) + r * 2;
      syncDisplayFromData(x, y, w, h);
      lastPointRef.current = point;
    } else {
      // putImageData ignores fillStyle/compositeOp, so re-apply after
      // restoring the pre-drag snapshot and before the preview fillRect.
      dataCtx.putImageData(dataSnapshotRef.current, 0, 0);
      applyDataPaintStyle(dataCtx);
      const start = startPointRef.current;
      const x = Math.min(start.x, point.x);
      const y = Math.min(start.y, point.y);
      const w = Math.abs(point.x - start.x);
      const h = Math.abs(point.y - start.y);
      dataCtx.fillRect(x, y, w, h);
      // Full-canvas sync, not just the new rect -- a shrinking drag needs
      // to revert display pixels outside the smaller rect back to
      // whatever the data canvas actually holds there (the restored
      // snapshot), which a region-only sync would miss.
      syncDisplayFromData();
    }
  }

  function handlePointerUp(e) {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    displayCanvasRef.current.releasePointerCapture(e.pointerId);
  }

  return (
    <div className={style.wrapper}>
      <div className={style.toolbar}>
        <div className={style.toolGroup}>
          <button
            className={`${style.toolButton} ${tool === "freehand" ? style.active : ""}`}
            onClick={() => setTool("freehand")}
            type="button"
          >
            Freehand
          </button>
          <button
            className={`${style.toolButton} ${tool === "rectangle" ? style.active : ""}`}
            onClick={() => setTool("rectangle")}
            type="button"
          >
            Rectangle
          </button>
        </div>
        {tool === "freehand" && (
          <div className={style.brushGroup}>
            <label>Brush: {brushSize}px</label>
            <input
              type="range"
              min="8"
              max="120"
              value={brushSize}
              onChange={(e) => setBrushSize(Number(e.target.value))}
            />
          </div>
        )}
        <div className={style.brushGroup}>
          <label>Noise extent: {noiseExtent.toFixed(2)}</label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={noiseExtent}
            onChange={(e) => handleSliderChange(Number(e.target.value))}
          />
        </div>
        <button
          className={`${style.toolButton} ${isKeep ? style.keepActive : style.keepInactive}`}
          onClick={toggleKeep}
          type="button"
          title={
            isKeep
              ? "Currently keeping (fully preserve); click to switch back to regenerate"
              : "Click to keep (fully preserve); same as dragging Noise extent to 0"
          }
        >
          Keep
        </button>
        <button className={style.clearButton} onClick={resetMask} type="button">
          Clear mask
        </button>
      </div>

      <div
        className={style.canvasStack}
        style={{ width: displaySize.width, height: displaySize.height }}
      >
        <canvas ref={imageCanvasRef} className={style.imageCanvas} />
        <canvas ref={dataCanvasRef} className={style.dataCanvas} />
        <canvas
          ref={displayCanvasRef}
          className={style.maskCanvas}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        />
      </div>
    </div>
  );
});

export default MaskCanvas;
