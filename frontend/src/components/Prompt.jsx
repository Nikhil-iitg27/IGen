import axios from "axios";
import React, { useState } from "react";
import style from "./assets/Prompt.module.css";

function Prompt() {
  const [prompt, setPrompt] = useState("A Futuristic Cityscape");
  const [unprompt, setUnprompt] = useState("");
  const [steps, setSteps] = useState(50);
  const [seed, setSeed] = useState(43);
  const [strength, setStrength] = useState(0.9);
  const [doScale, setDoScale] = useState(true);
  const [scale, setScale] = useState(8);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [image, setImage] = useState(null);
  const [loading, setLoading] = useState(false);

  const backendUrl = import.meta.env.VITE_BACKEND_URL;

  async function generate() {
    setLoading(true);

    const payload = showAdvanced
      ? {
          prompt,
          unprompt,
          steps,
          seed,
          strength,
          do_scale: doScale,
          scale,
        }
      : {
          prompt,
          unprompt: unprompt,
          steps: 50,
          seed: 43,
          strength: 0.9,
          do_scale: true,
          scale: 8,
        };

    try {
      console.log(payload);
      const response = await axios.post(
        `${backendUrl}/api/igen/generate/`,
        payload,
        {
          headers: { "Content-Type": "application/json" },
        }
      );
      console.log(response);
      if (response.data.image) {
        setImage(`data:image/png;base64,${response.data.image}`);
      }
    } catch (error) {
      console.error("Error generating image:", error);
    }
    setLoading(false);
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
              onChange={(e) => setPrompt(e.target.value)}
            />
          </div>
          <div className={style.textGroup}>
            <label className={style.label}>Negative Prompt :</label>
            <input
              className={style.promptInput}
              type="text"
              placeholder="Enter negative prompt..."
              onChange={(e) => setUnprompt(e.target.value)}
            />
          </div>
          <div className={style.buttonContainer}>
            <button
              className={`${style.Button} ${loading ? style.loading : ""}`}
              onClick={generate}
              disabled={loading}
            >
              {loading ? <span className={style.spinner}></span> : "Generate"}
            </button>
            <button
              className={style.Button}
              onClick={() => setShowAdvanced((prev) => !prev)}
            >
              {showAdvanced ? "Hide Advanced" : "Show Advanced"}
            </button>
          </div>
        </div>

        {image && (
          <div className={style.imageContainer}>
            <img className={style.generatedImage} src={image} alt={prompt} />
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
