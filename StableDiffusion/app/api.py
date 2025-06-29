# app/api.py
from flask import Flask, request, jsonify
from src.model_loader import preload_models_from_standard_weights
from transformers import CLIPTokenizer
from src.pipeline import generate
from PIL import Image
import uuid
import os
import base64
import torch

# from dotenv import load_dotenv
# load_dotenv()

WEIGHTS_DIR = os.environ.get("WEIGHTS_DIR", "/runpod-volume/weights")
os.makedirs(WEIGHTS_DIR, exist_ok=True)

VOCAB_PATH = os.path.join(WEIGHTS_DIR, "vocab.json")
MERGES_PATH = os.path.join(WEIGHTS_DIR, "merges.txt")
CKPT_PATH = os.path.join(WEIGHTS_DIR, "v1-5-pruned-emaonly.ckpt")

OUTPUT_DIR = os.environ.get("OUTPUT_DIR", "/runpod-volume/outputs")

# === Load model and tokenizer ONCE ===
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
print(f"[✓] Using device: {DEVICE}")

tokenizer = CLIPTokenizer(VOCAB_PATH, merges_file=MERGES_PATH)
print("loaded tokenizer")

models = preload_models_from_standard_weights(CKPT_PATH, DEVICE)
print("loaded model")

os.makedirs(OUTPUT_DIR, exist_ok=True)

# === Flask App ===
app = Flask(__name__)
print("Building Flask Application")

@app.route("/inference", methods=["POST"])
def infer():
    data = request.get_json(force=True)
    
    uid = str(data.get("uid", -1))
    expected_uid = str(os.environ.get("UID"))
    if uid != expected_uid:
        return jsonify({"error": "Unauthorized access: UID mismatch"}), 401


    prompt = data.get("prompt", "")
    unprompt = data.get("unprompt", "")
    steps = int(data.get("steps", 50))
    seed = int(data.get("seed", 42))
    strength = float(data.get("strength", 0.9))
    do_scale = bool(data.get("do_scale", True))
    scale = float(data.get("scale", 8.0))

    # # Output file path
    uid = uuid.uuid4().hex[:8]
    out_file = f"output_{uid}.png"
    out_path = os.path.join(OUTPUT_DIR, out_file)

    # # === Generate ===
    try:
        output_image = generate(
            prompt=prompt,
            uncond_prompt=unprompt,
            input_image=None,
            strength=strength,
            do_cfg=do_scale,
            cfg_scale=scale,
            sampler_name="ddpm",
            n_inference_steps=steps,
            seed=seed,
            models=models,
            device=DEVICE,
            idle_device="cpu",
            tokenizer=tokenizer
        )
        Image.fromarray(output_image).save(out_path)

        # Convert to base64 to return directly (optional)
        with open(out_path, "rb") as f:
            encoded_img = base64.b64encode(f.read()).decode("utf-8")

        return jsonify({
            "message": "success",
            "uid": uid,
            "image": encoded_img
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000, debug=(os.environ.get("FLASK_DEBUG", "false").lower()=="true"))