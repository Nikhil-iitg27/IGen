# IGen – Full Stack Generative AI System

IGen is an end-to-end Stable Diffusion image-generation system: a from-scratch latent-diffusion pipeline (not a wrapper around an existing library) running on a RunPod GPU, fronted by a Django job queue and a React SPA, deployed the way a real production service would be rather than a notebook demo. It supports both plain text-to-image generation and mask-guided inpainting, gated behind revocable access keys, with a bounded request queue and load-tested behavior under sustained traffic — details on all of that below.

![Application UI](https://github.com/user-attachments/assets/ea59f10e-c525-4664-8230-1275baa80da3)

---

## Architecture

Three tiers, each independently deployed:

```
[Frontend (React+Vite)] ⇄ [Backend (Django+Postgres, job queue)] ⇄ [Stable Diffusion Inference (Flask, RunPod GPU Pod)]
```

- **Frontend**: React SPA on Vercel — Generate, Inpaint, and Metrics tabs behind a passkey gate.
- **Backend**: Django on Render, backed by Postgres — not a synchronous proxy. Every request becomes a database-backed job; a background dispatcher thread claims and forwards jobs one at a time to the Pod, and the frontend polls for the result rather than holding a request open.
- **Inference**: the custom SD pipeline (CLIP, VAE, UNet, DDPM sampler, all hand-implemented) served via Flask, on a RunPod GPU pod, called over a direct TCP port rather than RunPod's HTTP proxy — that proxy's ~100s timeout is too short for a real generation call.

That queue in the middle exists because there's exactly one GPU: a request can't just block a web worker for however long generation takes, so the backend decouples "accept the request" from "actually run it." Rejection, wait time, and throughput under that design are exactly what the [Stress Test Results](#stress-test-results) section below measures.

```
IGen/
├── frontend/         # React + Vite UI (Vercel)          -- see frontend/README.md
├── backend/          # Django job queue & dispatcher (Render) -- see backend/README.md
├── StableDiffusion/  # from-scratch SD pipeline (RunPod)  -- see StableDiffusion/README.md
└── scripts/
    └── stress_test/  # load-testing tool + results referenced below
```

Each subdirectory's README goes into that tier's actual implementation; this file covers how they fit together and what the whole system does end to end.

---

## What It Does

**Generate** is straightforward text-to-image: prompt, negative prompt, step count, seed, and guidance scale.

**Inpaint** is more involved. Since the model always works at a fixed 512×512 but uploaded photos aren't, the frontend cover-scales an upload client-side and reduces window selection to a single-axis crop (no distortion, no squishing), then lets you paint a **continuous** mask — not on/off, but a brush whose opacity controls how strongly the model regenerates each pixel versus preserving the original, on top of the usual denoising-strength control. After generation, you choose to keep the edited crop, the full image with the edit composited back in at native resolution, or both.

Both flows go through the same submit-and-poll job lifecycle: `POST /api/igen/generate/` returns a job id immediately, the frontend polls `/api/igen/status/<id>/` until the job reaches a terminal state, and every outcome is tracked as one of four distinct states — `COMPLETED`, `FAILED` (a genuine error), `TIMEOUT` (the Pod didn't respond in time), or `REJECTED` (the queue was already full, see below) — each with real dispatch/completion timestamps, not something reconstructed from client-side polling.

Access is gated by revocable `AccessKey` rows (two independent scopes, `app` and `metrics`, each separately issuable/revocable), and the queue itself is bounded: once too many jobs are pending or in flight, new requests are rejected outright (`MAX_QUEUE_DEPTH`) instead of queuing indefinitely — trading a measurable rejection rate for a bounded worst-case wait time. A **Metrics** tab in the frontend (separately gated) surfaces exactly this data — job outcome counts and wait/service-time aggregates — pulled from the backend's own metrics endpoints.

| Component | Stack | Deployment |
| --- | --- | --- |
| Frontend | React, Vite | Vercel |
| Backend | Django, Postgres, Gunicorn | Render |
| Inference | Flask, PyTorch, custom SD pipeline | RunPod (GPU pod, persistent volume for weights/outputs) |

For the deep dive on any of these — exact endpoints, env vars, request lifecycle, model internals — see [`frontend/README.md`](./frontend/README.md), [`backend/README.md`](./backend/README.md), and [`StableDiffusion/README.md`](./StableDiffusion/README.md).

---

## Tech Stack

- **Frontend**: React, Vite, JavaScript/JSX, Vercel
- **Backend**: Django, Postgres, Gunicorn, Python, Render
- **Inference**: Flask, PyTorch, custom SD pipeline, RunPod
- **ML models**: CLIP, VAE, UNet (from-scratch implementation, based on Umar Jamil's; standard pretrained SD v1.5 weights)
- **Tokenizer/weights**: HuggingFace
- **Load testing**: Python (`scripts/stress_test/`), matplotlib

---

## Quickstart

Each tier runs independently and needs its own environment configured — see the linked README for the one you're working on:

1. [`frontend/README.md`](./frontend/README.md) — React dev server, needs `VITE_BACKEND_URL`
2. [`backend/README.md`](./backend/README.md) — Django, needs a `.env` with DB/Pod connection info
3. [`StableDiffusion/README.md`](./StableDiffusion/README.md) — Flask inference server, needs model weights and an API key

The backend is the one dependency the other two share: the frontend needs it running to do anything past the passkey gate, and the backend needs the inference server's URL/key to actually dispatch jobs (though it'll accept and queue requests without one — they'll just never complete).

---

## Stress Test Results

With the queue's bounded-depth design in place, the natural question is what it actually buys you under load — this is a real measurement, not a theoretical estimate. `scripts/stress_test/` submits jobs at Poisson-process arrivals (exponential inter-arrival times) across five arrival-rate levels, each run for a 300s window, then drains outstanding jobs and pulls authoritative per-job timestamps from the backend's `/metrics/jobs/` endpoint to compute wait time, service time, and blocking rate from server-side ground truth.

**Test conditions:**
- GPU: single RunPod Pod, RTX 4090 (24GB)
- Sampling steps: 30 per job (fixed, so service time is comparable across runs)
- `MAX_QUEUE_DEPTH`: 20 (jobs beyond this are rejected, not queued)
- `MAX_CONCURRENT_DISPATCHED`: 1 (one job in flight at a time, matching the single GPU)
- Arrival-rate levels: mean inter-arrival 8s, 5s, 3s, 2s, 1s (~0.13–1.0 jobs/sec)

Two caveats worth stating plainly: each run starts from an empty queue, so the measured blocking probability near the saturation point is a run-average blending an initial low-blocking transient with a later steady state — likely a slight underestimate of true steady-state blocking at that rate. And every job used the same fixed prompt/parameters, so real variability in service time across genuinely different prompts isn't captured here.

![Stress test results](./scripts/stress_test/results/stress_test_results.png)

**Findings:**
- Service time is ~5.2s/job with very low variance across every arrival rate — the model's compute cost is essentially deterministic on a dedicated, uncontended GPU.
- The system holds 0% blocking with low wait up to ~0.2 jobs/sec (mean 5s); wait time visibly degrades before any request is ever rejected — blocking lags behind the real onset of saturation.
- Once saturated, p95 wait time plateaus at ~100–108s, matching the theoretical worst case of `(MAX_QUEUE_DEPTH − 1) × service_time ≈ 99s` almost exactly — direct confirmation that the queue cap bounds wait time by converting excess load into a measurable rejection rate instead of unbounded queueing.
- 100% completion rate, zero failures, zero timeouts across all 262 completed jobs spanning every load level tested — no dispatcher races or Pod instability observed even under sustained queue saturation.

---

## Acknowledgements

- [Umar Jamil](https://github.com/hkproj) for the Stable Diffusion implementation this pipeline is based on
- [HuggingFace](https://huggingface.co/stable-diffusion-v1-5) for model weights/tokenizer
- [OpenAI CLIP](https://github.com/openai/CLIP)
- [RunPod](https://www.runpod.io/), [Vercel](https://vercel.com/), [Render](https://render.com/)

---

## License

This project is for research and educational purposes. See the root `LICENSE` file for details.
