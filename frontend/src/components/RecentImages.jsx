import React from "react";
import style from "./assets/RecentImages.module.css";

/** Small thumbnail strip over the last-5 persisted images (see utils/imageGallery.js). */
function RecentImages({ images, onSelect }) {
  if (!images || images.length === 0) return null;

  return (
    <div className={style.strip}>
      <span className={style.label}>Recent:</span>
      {images.map((img) => (
        <button
          key={img.id}
          className={style.thumbButton}
          onClick={() => onSelect?.(img.dataUrl)}
          type="button"
          title={img.source ? `From ${img.source} — click to inpaint` : "Click to inpaint"}
        >
          <img className={style.thumb} src={img.dataUrl} alt="" />
        </button>
      ))}
    </div>
  );
}

export default RecentImages;
