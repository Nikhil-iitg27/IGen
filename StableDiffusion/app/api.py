# app/api.py
import io
import os
import base64
import uuid

import torch
from flask import Flask, request, jsonify
from PIL import Image
from transformers import CLIPTokenizer

from src.model_loader import preload_models_from_standard_weights
from src.pipeline import generate

WEIGHTS_DIR = os.environ.get("WEIGHTS_DIR", "/runpod-volume/weights")
os.makedirs(WEIGHTS_DIR, exist_ok=True)

VOCAB_PATH = os.path.join(WEIGHTS_DIR, "vocab.json")
MERGES_PATH = os.path.join(WEIGHTS_DIR, "merges.txt")
CKPT_PATH = os.path.join(WEIGHTS_DIR, "v1-5-pruned-emaonly.ckpt")

OUTPUT_DIR = os.environ.get("OUTPUT_DIR", "/runpod-volume/outputs")
INFERENCE_API_KEY = os.environ.get("INFERENCE_API_KEY")

# === Load model and tokenizer ONCE at process startup ===
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
print(f"[ok] Using device: {DEVICE}")

tokenizer = CLIPTokenizer(VOCAB_PATH, merges_file=MERGES_PATH)
print("loaded tokenizer")

models = preload_models_from_standard_weights(CKPT_PATH, DEVICE)
print("loaded model")

os.makedirs(OUTPUT_DIR, exist_ok=True)

app = Flask(__name__)
print("Building Flask Application")


def _authorized(req):
    if not INFERENCE_API_KEY:
        # No key configured -- fail closed rather than silently open, same
        # ALLOWED_HOSTS-style philosophy as the Django backend.
        return False
    auth_header = req.headers.get("Authorization", "")
    return auth_header == f"Bearer {INFERENCE_API_KEY}"


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "device": DEVICE})


@app.route("/inference", methods=["POST"])
def infer():
    if not _authorized(request):
        return jsonify({"error": "Unauthorized"}), 401

    data = request.get_json(force=True)

    prompt = data.get("prompt", "")
    unprompt = data.get("unprompt", "")
    steps = int(data.get("steps", 50))
    seed = int(data.get("seed", 42))
    strength = float(data.get("strength", 0.9))
    do_scale = bool(data.get("do_scale", True))
    scale = float(data.get("scale", 8.0))

    uid = uuid.uuid4().hex[:8]
    out_file = f"output_{uid}.png"
    out_path = os.path.join(OUTPUT_DIR, out_file)

    # Optional inpainting inputs -- base64 PNGs. Both absent -> plain
    # txt2img, unchanged. mask alone (no image) is ignored by generate()
    # since there's nothing to preserve pixels from.
    input_image = None
    mask_image = None
    if data.get("image"):
        input_image = Image.open(io.BytesIO(base64.b64decode(data["image"]))).convert("RGB")
    if data.get("mask"):
        mask_image = Image.open(io.BytesIO(base64.b64decode(data["mask"]))).convert("L")

    try:
        output_image = generate(
            prompt=prompt,
            uncond_prompt=unprompt,
            input_image=input_image,
            mask=mask_image,
            strength=strength,
            do_cfg=do_scale,
            cfg_scale=scale,
            sampler_name="ddpm",
            n_inference_steps=steps,
            seed=seed,
            models=models,
            device=DEVICE,
            idle_device="cpu",
            tokenizer=tokenizer,
        )
        Image.fromarray(output_image).save(out_path)

        with open(out_path, "rb") as f:
            encoded_img = base64.b64encode(f.read()).decode("utf-8")

        return jsonify({
            "message": "success",
            "uid": uid,
            "image": encoded_img,
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000, debug=(os.environ.get("FLASK_DEBUG", "false").lower() == "true"))
