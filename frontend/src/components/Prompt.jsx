import React, { useState } from "react";
import style from "./assets/Prompt.module.css";
import useGenerationJob from "../hooks/useGenerationJob";
import usePersistentState from "../hooks/usePersistentState";
import { queueStatusText } from "../utils/queueStatus";

function Prompt({ onSendToInpaint }) {
  const [prompt, setPrompt] = usePersistentState("igen_generate_prompt", "A Futuristic Cityscape");
  const [unprompt, setUnprompt] = usePersistentState("igen_generate_unprompt", "");
  const [steps, setSteps] = usePersistentState("igen_generate_steps", 50);
  const [seed, setSeed] = usePersistentState("igen_generate_seed", 43);
  const [strength, setStrength] = usePersistentState("igen_generate_strength", 0.9);
  const [doScale, setDoScale] = usePersistentState("igen_generate_do_scale", true);
  const [scale, setScale] = usePersistentState("igen_generate_scale", 8);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const { submit, status, image, error, queuePosition, latencyMs, isBusy } = useGenerationJob("generate");
  const statusText = isBusy ? queueStatusText(status, queuePosition) : null;

  async function generate() {
    const payload = showAdvanced
      ? { prompt, unprompt, steps, seed, strength, do_scale: doScale, scale }
      : {
          prompt,
          unprompt: unprompt,
          steps: 50,
          seed: 43,
          strength: 0.9,
          do_scale: true,
          scale: 8,
        };
    await submit(payload);
  }

  return (
    <div className={style.mainContent}>
      <div className={style.topRow}>
        <div className={style.promptContainer}>
          <div className={style.textGroup}>
            <label className={style.label}>Positive Prompt :</label>
            <input
              className={style.promptInput}
              type="text"
              placeholder="Enter a prompt..."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
          </div>
          <div className={style.textGroup}>
            <label className={style.label}>Negative Prompt :</label>
            <input
              className={style.promptInput}
              type="text"
              placeholder="Enter negative prompt..."
              value={unprompt}
              onChange={(e) => setUnprompt(e.target.value)}
            />
          </div>
          <div className={style.buttonContainer}>
            <button
              className={`${style.Button} ${isBusy ? style.loading : ""}`}
              onClick={generate}
              disabled={isBusy}
            >
              {isBusy ? <span className={style.spinner}></span> : "Generate"}
            </button>
            <button
              className={style.Button}
              onClick={() => setShowAdvanced((prev) => !prev)}
            >
              {showAdvanced ? "Hide Advanced" : "Show Advanced"}
            </button>
          </div>
          {statusText && <p className={style.statusText}>{statusText}</p>}
          {error && <p className={style.errorText}>{error}</p>}
        </div>

        {image && (
          <div className={style.imageContainer}>
            <img className={style.generatedImage} src={image} alt={prompt} />
            <div className={style.resultMeta}>
              {latencyMs != null && <span>{(latencyMs / 1000).toFixed(1)}s</span>}
              <button className={style.linkButton} onClick={() => onSendToInpaint?.(image)}>
                Send to Inpaint →
              </button>
            </div>
          </div>
        )}
      </div>
      <div className={style.bottomRow}>
        {showAdvanced && (
          <div className={style.advancedWrapper}>
            <div className={style.advancedContainer}>
              <div className={style.advancedRow}>
                <div className={style.inputGroup}>
                  <label className={style.label}>Iterations</label>
                  <input
                    className={style.promptInput}
                    type="number"
                    value={steps}
                    onChange={(e) => setSteps(Number(e.target.value))}
                  />
                </div>
                <div className={style.inputGroup}>
                  <label className={style.label}>Seed</label>
                  <input
                    className={style.promptInput}
                    type="number"
                    value={seed}
                    onChange={(e) => setSeed(Number(e.target.value))}
                  />
                </div>
              </div>
              <div className={style.advancedRow}>
                <div className={style.inputGroup}>
                  <label className={style.label}>
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
                <div className={style.inputGroup}>
                  <label className={style.label}>
                    Scale : <span>{scale}</span>
                  </label>
                  <div className={style.scale}>
                    <input
                      type="checkbox"
                      checked={doScale}
                      onChange={(e) => setDoScale(e.target.checked)}
                    />
                    <input
                      type="range"
                      min="1"
                      max="14"
                      step="0.5"
                      value={scale}
                      onChange={(e) => setScale(Number(e.target.value))}
                      disabled={!doScale}
                      style={{ width: "130px" }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default Prompt;
