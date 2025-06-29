# Stable Diffusion Inference Server

This directory contains a custom Stable Diffusion inference engine, built from scratch and deployed on [RunPod](https://www.runpod.io/). It exposes a Flask API for text-to-image generation using a pipeline of CLIP, VAE (Encoder/Decoder), and UNet models.

---

## 🏗️ Directory Structure

```
StableDiffusion/
├── Dockerfile
├── requirements.txt
├── app/
│   ├── api.py           # Flask API server
│   ├── outputs/         # Generated images (persisted)
│   └── src/
│       ├── __init__.py
│       ├── clip.py      # CLIP model
│       ├── decoder.py   # VAE Decoder
│       ├── encoder.py   # VAE Encoder
│       ├── diffusion.py # UNet & diffusion process
│       ├── model_loader.py
│       ├── pipeline.py  # Generation pipeline
│       └── utils/
│           ├── attention.py
│           ├── ddpm.py
│           └── model_converter.py
│
├── weights/
│   ├── v1-5-pruned-emaonly.ckpt  # Model weights
│   ├── merges.txt                # Tokenizer merges (from HuggingFace)
│   └── vocab.json                # Tokenizer vocab (from HuggingFace)
```

---

## 🧠 Model Architecture

- **CLIP**: Used for prompt tokenization and text embedding ([OpenAI CLIP](https://github.com/openai/CLIP)).
- **VAE Encoder/Decoder**: Compresses and reconstructs images in latent space.
- **UNet**: Core of the diffusion process, denoising latent representations.
- **Custom Pipeline**: Orchestrates prompt processing, latent sampling, and image decoding.

All components are loaded from scratch using distilled weights and HuggingFace tokenizer files.

---

## 📦 Weights & Tokenizer

- **Model Weights**: [v1-5-pruned-emaonly.ckpt](https://huggingface.co/stable-diffusion-v1-5/tree/main)
- **Tokenizer Files**: [merges.txt](https://huggingface.co/stable-diffusion-v1-5/tree/main/tokenizer), [vocab.json](https://huggingface.co/stable-diffusion-v1-5/tree/main/tokenizer)
- All files are stored in a persistent volume (`/runpod-volume/weights`) on RunPod for fast pod startup and reusability.

---

## 🚀 Deployment: RunPod Pod

- **Persistent Volume**: Model weights and tokenizer files are mounted at `/runpod-volume/weights` and outputs at `/runpod-volume/outputs`.
- **API Exposure**: Flask app runs on port `8000` and exposes `/inference` endpoint.
- **Pod Startup**: On pod start, all models and tokenizers are loaded into memory for fast inference.
- **Docker**: Use the provided `Dockerfile` for reproducible builds.

---

## 🖥️ Running the API

### 1. With Flask (for development)

```bash
python app/api.py
```

### 2. With Gunicorn (for production)

```bash
gunicorn -w 1 -b 0.0.0.0:8000 app.api:app
```

### 3. With main.py Entrypoint (for RunPod)

Create a `main.py` with:

```python
from app.api import app

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000)
```

Then run:
```bash
python main.py
```

---

## 🔗 API Usage Example

**POST** `/inference`

Request:
```json
{
  "uid": "<your-uid>",
  "prompt": "A futuristic cityscape at sunset",
  "steps": 50,
  "seed": 42,
  "strength": 0.9,
  "do_scale": true,
  "scale": 8.0
}
```

Response:
```json
{
  "message": "success",
  "uid": "abc12345",
  "image": "<base64-encoded-png>"
}
```

---

## 📝 Logging & Debugging

- All requests and errors are logged to stdout (visible in RunPod pod logs).
- Output images are saved in `/runpod-volume/outputs` for persistence.
- For debugging, set `FLASK_DEBUG=true` in environment variables.

---

## 🙏 Acknowledgements

- [Umar Jamil](https://github.com/cloneofsimo) for the distilled Stable Diffusion implementation
- [HuggingFace](https://huggingface.co/stable-diffusion-v1-5) for model weights and tokenizer files
- [OpenAI CLIP](https://github.com/openai/CLIP)
- [RunPod](https://www.runpod.io/) for GPU pod hosting

---

## 📄 License

This project is for research and educational purposes. See the root `LICENSE` file for details.
