# Stable Diffusion Inference Server

This directory holds the actual image-generation engine behind IGen — a Stable Diffusion v1.5 pipeline implemented from scratch in PyTorch (not a wrapper around `diffusers` or another existing library) and served through a small Flask API. It's deployed as a Docker container on a RunPod GPU pod, and it's deliberately the only part of the system that talks to the GPU directly: the Django backend (`../backend/`) never runs a model itself, it just queues requests and forwards one at a time to whatever's running here.

---

## Directory Structure

```
StableDiffusion/
├── Dockerfile
├── requirements.txt
└── app/
    ├── api.py               # Flask API: /health, /inference
    ├── test_input.json
    ├── weights/             # model checkpoint + tokenizer files (gitignored, RunPod volume in prod)
    ├── outputs/              # generated images written here (persisted via volume in prod)
    └── src/
        ├── clip.py           # CLIP text encoder
        ├── encoder.py        # VAE encoder
        ├── decoder.py        # VAE decoder
        ├── diffusion.py      # UNet (with cross-attention conditioning)
        ├── model_loader.py   # loads all four components from one checkpoint
        ├── pipeline.py       # the actual generation/inpainting loop
        ├── demo.ipynb
        └── utils/
            ├── attention.py
            ├── ddpm.py               # custom DDPM sampler
            └── model_converter.py    # checkpoint -> module state_dict mapping
```

---

## Model Architecture

`pipeline.py` drives a standard latent-diffusion loop, but every component in it — CLIP, VAE, UNet, and the DDPM sampler — is a hand-written PyTorch module in `src/`, not an imported implementation. The weights themselves are the standard pretrained SD v1.5 checkpoint (`v1-5-pruned-emaonly.ckpt`), loaded into that architecture via `model_loader.py`/`model_converter.py`; nothing about the weights is distilled or otherwise modified, only the code that runs them is custom.

At generation time: `clip.py` encodes the prompt (and negative prompt, for classifier-free guidance); for img2img/inpainting, `encoder.py` encodes the input image into the latent space and noise is added according to `strength`; `diffusion.py` (the UNet) is run for `steps` denoising iterations against the custom DDPM sampler; and `decoder.py` decodes the final latent back into an image. Inpainting isn't a separate code path — it's the same loop with a **continuous, non-binary mask**: at every denoising step, the "preserve" region is re-noised to that step's level and blended back in proportionally to the mask value, which is what gives the frontend's noise-extent brush its effect (a mask value of 1 fully regenerates a pixel, 0 fully preserves it, and anything between blends the two).

---

## Weights & Tokenizer

- **Model weights**: [v1-5-pruned-emaonly.ckpt](https://huggingface.co/stable-diffusion-v1-5/tree/main)
- **Tokenizer files**: [merges.txt / vocab.json](https://huggingface.co/stable-diffusion-v1-5/tree/main/tokenizer)

In production these live on a RunPod persistent volume (`/runpod-volume/weights` by default, overridable via `WEIGHTS_DIR`) rather than being baked into the Docker image — the image only contains code (`app/src`, `app/api.py`; see the `Dockerfile`), so weights survive a Pod restart without a rebuild, and the image itself stays small and public-shareable.

---

## API

`api.py` loads the tokenizer and all four model components once at process startup (not per-request), then exposes:

- `GET /health` — `{"status": "ok", "device": "cuda"|"cpu"}`, no auth
- `POST /inference` — the actual generation call, requires `Authorization: Bearer <INFERENCE_API_KEY>` (fails closed with `401` if the key isn't configured or doesn't match)

**Request** (`image`/`mask` are optional — omit both for plain text-to-image; `image` alone with no `mask` is treated as a full-image restyle):

```json
{
  "prompt": "a photo of a mountain landscape at sunrise",
  "unprompt": "",
  "steps": 30,
  "seed": 42,
  "strength": 0.9,
  "do_scale": true,
  "scale": 8.0,
  "image": "<base64-png, optional>",
  "mask": "<base64-png, optional>"
}
```

**Response** — `uid` is generated server-side (not something you send):

```json
{
  "message": "success",
  "uid": "8f35400e",
  "image": "<base64-encoded-png>"
}
```

The Django backend's dispatcher (`../backend/igen/dispatcher.py`) is the only intended caller of `/inference` — it holds the bearer key and calls this endpoint directly over TCP rather than through RunPod's HTTP proxy, whose ~100s timeout is too short for a real generation call.

---

## Running Locally / Deployment

In the container (see `Dockerfile`), this runs under Gunicorn, single worker — one GPU means one CUDA context, so a second concurrent request should queue at Gunicorn rather than two workers fighting over the same GPU:

```bash
gunicorn -w 1 --bind 0.0.0.0:8000 --timeout 300 api:app
```

For local development without Docker, Flask's own dev server works the same way, reading the same env vars:

```bash
python app/api.py
```

Either way, three environment variables matter: `WEIGHTS_DIR` and `OUTPUT_DIR` (both default to RunPod volume paths, override locally to point at wherever your weights actually are) and `INFERENCE_API_KEY` (the bearer token `/inference` checks — required, there's no way to disable auth).

On RunPod itself, the pod mounts a persistent volume at `WEIGHTS_DIR`/`OUTPUT_DIR`, exposes port `8000` via a direct TCP port mapping (not the HTTP proxy, for the timeout reason above), and the Docker image built from this directory's `Dockerfile` is what actually runs.

---

## Acknowledgements

- [Umar Jamil](https://github.com/hkproj) for the Stable Diffusion implementation this pipeline is based on
- [HuggingFace](https://huggingface.co/stable-diffusion-v1-5) for model weights and tokenizer files
- [OpenAI CLIP](https://github.com/openai/CLIP)
- [RunPod](https://www.runpod.io/) for GPU pod hosting

---

## License

This project is for research and educational purposes. See the root `LICENSE` file for details.
