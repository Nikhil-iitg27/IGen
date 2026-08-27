import React, { useCallback, useEffect, useRef, useState } from "react";
import style from "./assets/InpaintEditor.module.css";
import promptStyle from "./assets/Prompt.module.css";
import MaskCanvas from "./MaskCanvas";
import CropSelector from "./CropSelector";
import useGenerationJob from "../hooks/useGenerationJob";
import usePersistentState from "../hooks/usePersistentState";
import { queueStatusText } from "../utils/queueStatus";
import { computeCoverGeometry, extractWindow, loadImage, loadImageDimensions, compositeResult } from "../utils/imageCrop";
import { saveImage } from "../utils/imageGallery";

function dataUrlToBase64(dataUrl) {
  return dataUrl.split(",")[1];
}

function InpaintEditor({ initialImage }) {
  // sourceImage is always the fixed-size (512x512) window MaskCanvas
  // paints on. pendingCrop holds a raw, arbitrary-aspect image waiting
  // for the user to confirm where its crop window sits; null once
  // resolved into a sourceImage (or while none is picked yet).
  const [sourceImage, setSourceImage] = useState(null);
  const [pendingCrop, setPendingCrop] = useState(null);
  const [prompt, setPrompt] = usePersistentState("igen_inpaint_prompt", "");
  const [unprompt, setUnprompt] = usePersistentState("igen_inpaint_unprompt", "");
  const [steps, setSteps] = usePersistentState("igen_inpaint_steps", 50);
  const [seed, setSeed] = usePersistentState("igen_inpaint_seed", 43);
  const [strength, setStrength] = usePersistentState("igen_inpaint_strength", 0.9);
  const [scale, setScale] = usePersistentState("igen_inpaint_scale", 8);

  // originalImage/sourceRect track what the current sourceImage window
  // was cropped from, so the user's "save full image" choice can
  // composite the result back into the original at full resolution on
  // demand. Refs, not state -- only read from event handlers, never
  // rendered directly.
  const originalImageRef = useRef(null);
  const sourceRectRef = useRef(null);

  const maskRef = useRef(null);
  const fileInputRef = useRef(null);

  // autoSave: false -- `image` here is only the fixed-size edited
  // window, not the full photo, so it's never saved to the gallery
  // automatically. The user explicitly picks which version to keep via
  // the Save buttons below (handleSaveCrop/handleSaveFull).
  const { submit, status, image, error, queuePosition, latencyMs, isBusy, reset } = useGenerationJob("inpaint", {
    autoSave: false,
  });
  const statusText = isBusy ? queueStatusText(status, queuePosition) : null;

  // Independent, not mutually exclusive -- the user can keep both the
  // cropped and the full-composite version. Each fires at most once per
  // result: `savedXRef` guards synchronously (state updates are
  // batched/async, so relying on `disabled={savedX}` alone leaves a
  // window -- especially during handleSaveFull's await -- where rapid
  // repeat clicks each slip through and each append another gallery
  // entry, flooding the capped 5-slot history with duplicates).
  const [savedCrop, setSavedCrop] = useState(false);
  const [savedFull, setSavedFull] = useState(false);
  const savedCropRef = useRef(false);
  const savedFullRef = useRef(false);
  // False when the source was already square and skipped the crop step
  // (e.g. "Send to Inpaint" from a native 512x512 result) -- in that
  // case the "cropped" and "full" saves would be byte-identical, so
  // showing two choices is misleading. True once the user has actually
  // confirmed a real crop window via CropSelector.
  const [hasCropWindow, setHasCropWindow] = useState(false);

  // A fresh result (new job, or the old one cleared) means neither save
  // choice has been made yet.
  useEffect(() => {
    savedCropRef.current = false;
    savedFullRef.current = false;
    setSavedCrop(false);
    setSavedFull(false);
  }, [image]);

  function handleSaveCrop() {
    if (!image || savedCropRef.current) return;
    savedCropRef.current = true;
    saveImage(image, { source: "inpaint" });
    setSavedCrop(true);
  }

  async function handleSaveFull() {
    if (!image || !originalImageRef.current || !sourceRectRef.current || savedFullRef.current) return;
    savedFullRef.current = true;
    const composited = await compositeResult(originalImageRef.current, image, sourceRectRef.current);
    saveImage(composited, { source: "inpaint" });
    setSavedFull(true);
  }

  // Entry point for every new source image (upload, "Send to Inpaint",
  // or re-importing a prior result) -- an already-square image (e.g.
  // exactly 512x512 model output) skips the crop step entirely, since
  // computeCoverGeometry naturally reports no overhang for it.
  const beginCrop = useCallback(async (dataUrl) => {
    try {
      const { width, height } = await loadImageDimensions(dataUrl);
      const geometry = computeCoverGeometry(width, height);
      if (geometry.axis === null) {
        originalImageRef.current = dataUrl;
        sourceRectRef.current = { x: 0, y: 0, width, height };
        setSourceImage(dataUrl);
        setPendingCrop(null);
        setHasCropWindow(false);
      } else {
        setSourceImage(null);
        setPendingCrop({ rawImage: dataUrl, srcWidth: width, srcHeight: height, geometry });
      }
    } catch (err) {
      console.error("Error reading uploaded image:", err);
    }
  }, []);

  // Preload whatever the Generate tab just produced, if the user arrived
  // via "Send to Inpaint" -- but don't clobber a source they already
  // picked themselves on a later render.
  useEffect(() => {
    if (initialImage) beginCrop(initialImage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialImage]);

  function handleUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => beginCrop(reader.result);
    reader.readAsDataURL(file);
  }

  async function confirmCrop(offsetFraction) {
    if (!pendingCrop) return;
    const img = await loadImage(pendingCrop.rawImage);
    const { dataUrl, sourceRect } = extractWindow(img, pendingCrop.geometry, offsetFraction);
    originalImageRef.current = pendingCrop.rawImage;
    sourceRectRef.current = sourceRect;
    setSourceImage(dataUrl);
    setPendingCrop(null);
    setHasCropWindow(true);
  }

  // Re-run inpainting on the result we just produced -- re-enters the
  // same crop step (the composited result is full original resolution,
  // same as any other source) and clears the old result so the output
  // column goes back to "will appear here" instead of showing a stale
  // image.
  function reimportResult() {
    if (!image) return;
    beginCrop(image);
    reset();
  }

  async function handleSubmit() {
    if (!sourceImage) return;
    const maskBase64 = maskRef.current?.getMaskBase64();
    await submit({
      prompt,
      unprompt,
      steps,
      seed,
      strength,
      do_scale: true,
      scale,
      image: dataUrlToBase64(sourceImage),
      mask: maskBase64,
    });
  }

  return (
    <div className={style.mainContent}>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={handleUpload}
      />
      {pendingCrop ? (
        <CropSelector
          rawImage={pendingCrop.rawImage}
          srcWidth={pendingCrop.srcWidth}
          srcHeight={pendingCrop.srcHeight}
          geometry={pendingCrop.geometry}
          onConfirm={confirmCrop}
        />
      ) : !sourceImage ? (
        <div className={style.uploadPrompt}>
          <p>Use an image from the Generate tab, or upload one to inpaint.</p>
          <button
            className={promptStyle.Button}
            onClick={() => fileInputRef.current?.click()}
            type="button"
          >
            Upload image
          </button>
        </div>
      ) : (
        <div className={style.grid}>
          <div className={style.settingsColumn}>
            <div className={promptStyle.promptContainer}>
              <div className={promptStyle.textGroup}>
                <label className={promptStyle.label}>Prompt (for the regenerated region) :</label>
                <input
                  className={promptStyle.promptInput}
                  type="text"
                  placeholder="Describe what should appear there..."
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                />
              </div>
              <div className={promptStyle.textGroup}>
                <label className={promptStyle.label}>Negative Prompt :</label>
                <input
                  className={promptStyle.promptInput}
                  type="text"
                  placeholder="Enter negative prompt..."
                  value={unprompt}
                  onChange={(e) => setUnprompt(e.target.value)}
                />
              </div>
              <div className={promptStyle.advancedRow}>
                <div className={promptStyle.inputGroup}>
                  <label className={promptStyle.label}>Iterations</label>
                  <input
                    className={promptStyle.promptInput}
                    type="number"
                    value={steps}
                    onChange={(e) => setSteps(Number(e.target.value))}
                  />
                </div>
                <div className={promptStyle.inputGroup}>
                  <label className={promptStyle.label}>Seed</label>
                  <input
                    className={promptStyle.promptInput}
                    type="number"
                    value={seed}
                    onChange={(e) => setSeed(Number(e.target.value))}
                  />
                </div>
              </div>
              <div className={promptStyle.advancedRow}>
                <div className={promptStyle.inputGroup}>
                  <label className={promptStyle.label}>
                    Strength: <span>{strength}</span>
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={strength}
                    onChange={(e) => setStrength(Number(e.target.value))}
                    style={{ width: "150px" }}
                  />
                </div>
                <div className={promptStyle.inputGroup}>
                  <label className={promptStyle.label}>
                    Scale : <span>{scale}</span>
                  </label>
                  <input
                    type="range"
                    min="1"
                    max="14"
                    step="0.5"
                    value={scale}
                    onChange={(e) => setScale(Number(e.target.value))}
                    style={{ width: "130px" }}
                  />
                </div>
              </div>
              <div className={`${promptStyle.buttonContainer} ${style.centerButton}`}>
                <button
                  className={`${promptStyle.Button} ${isBusy ? promptStyle.loading : ""}`}
                  onClick={handleSubmit}
                  disabled={isBusy || !prompt}
                >
                  {isBusy ? <span className={promptStyle.spinner}></span> : "Generate inpaint"}
                </button>
              </div>
              {statusText && <p className={promptStyle.statusText}>{statusText}</p>}
              {error && <p className={promptStyle.errorText}>{error}</p>}
            </div>
          </div>

          <div className={style.editorColumn}>
            <MaskCanvas ref={maskRef} imageSrc={sourceImage} />
            <button
              className={style.changeImageButton}
              onClick={() => fileInputRef.current?.click()}
              type="button"
            >
              Use a different image
            </button>
          </div>

          <div className={style.outputColumn}>
            {image ? (
              <div className={promptStyle.imageContainer}>
                <img className={promptStyle.generatedImage} src={image} alt={prompt} />
                <div className={promptStyle.resultMeta}>
                  {latencyMs != null && <span>{(latencyMs / 1000).toFixed(1)}s</span>}
                  <button className={promptStyle.linkButton} onClick={reimportResult} type="button">
                    Inpaint this result →
                  </button>
                </div>
                <div className={style.saveChoiceRow}>
                  {hasCropWindow ? (
                    <>
                      <button
                        className={promptStyle.Button}
                        type="button"
                        onClick={handleSaveCrop}
                        disabled={savedCrop}
                      >
                        {savedCrop ? "Saved cropped" : "Save cropped"}
                      </button>
                      <button
                        className={promptStyle.Button}
                        type="button"
                        onClick={handleSaveFull}
                        disabled={savedFull}
                      >
                        {savedFull ? "Saved full" : "Save full"}
                      </button>
                    </>
                  ) : (
                    // No real crop happened -- "cropped" and "full" would
                    // be the same image, so only offer one save action.
                    <button
                      className={promptStyle.Button}
                      type="button"
                      onClick={handleSaveCrop}
                      disabled={savedCrop}
                    >
                      {savedCrop ? "Saved" : "Save image"}
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className={style.outputPlaceholder}>
                Your inpainted result will appear here.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default InpaintEditor;
