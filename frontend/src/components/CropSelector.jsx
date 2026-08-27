import React, { useState } from "react";
import style from "./assets/CropSelector.module.css";
import promptStyle from "./assets/Prompt.module.css";
import { windowRectFraction } from "../utils/imageCrop";

/**
 * Shown between "an image was picked" and "MaskCanvas gets a fixed
 * 512x512 source" -- lets the user see and, when there's real overhang
 * on one axis, adjust exactly where the model's working window sits
 * within their (arbitrary-aspect) source image.
 */
function CropSelector({ rawImage, srcWidth, srcHeight, geometry, onConfirm }) {
  const [offsetFraction, setOffsetFraction] = useState(0.5);
  const rect = windowRectFraction(geometry, srcWidth, srcHeight, offsetFraction);
  const hasOverhang = geometry.axis !== null && geometry.overhang > 0;

  return (
    <div className={style.wrapper}>
      {geometry.willUpscale && (
        <p className={style.warning}>
          This image is smaller than our working resolution (512px), so
          it will be upscaled. The whole photo will look noticeably
          softer, not just the edited region — a higher-resolution
          source will give sharper results.
        </p>
      )}

      <div className={style.previewBox}>
        <img src={rawImage} alt="Source to crop" className={style.previewImage} />
        <div
          className={style.windowOverlay}
          style={{
            left: `${rect.leftPct}%`,
            top: `${rect.topPct}%`,
            width: `${rect.widthPct}%`,
            height: `${rect.heightPct}%`,
          }}
        />
      </div>

      {hasOverhang && (
        <div className={style.sliderRow}>
          <label className={style.label}>
            {geometry.axis === "x" ? "Horizontal" : "Vertical"} position
          </label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={offsetFraction}
            onChange={(e) => setOffsetFraction(Number(e.target.value))}
          />
        </div>
      )}

      <button
        className={promptStyle.Button}
        type="button"
        onClick={() => onConfirm(offsetFraction)}
      >
        Confirm crop
      </button>
    </div>
  );
}

export default CropSelector;
