# IGen – Full Stack Generative AI System

This monorepo contains the complete IGen system: a modern frontend, robust backend, and a custom Stable Diffusion inference engine, all orchestrated for scalable, cloud-native deployment.

---

## 🗺️ Architecture Overview

```
[Frontend (React+Vite)] ⇄ [Backend (Django+Gunicorn)] ⇄ [Stable Diffusion Inference (Flask, RunPod)]
```

- **Frontend**: React SPA (Vite), deployed on Vercel
- **Backend**: Django app (`igen`), deployed on Render, proxies API calls
- **Inference**: Custom Stable Diffusion server (Flask), deployed on RunPod GPU pod

---

## 📦 Monorepo Structure

```
IGen/
├── frontend/         # React + Vite UI (Vercel)
├── backend/          # Django API & proxy (Render)
├── StableDiffusion/  # Custom SD inference server (RunPod)
└── README.md         # (this file)
```

---

## 🚀 Deployment Overview

| Component        | Stack              | Deployment   |
| ---------------- | ------------------ | ------------ |
| Frontend         | React, Vite        | Vercel       |
| Backend          | Django, Gunicorn   | Render       |
| Inference Engine | Flask, PyTorch, SD | RunPod (GPU) |

- **Persistent Volumes**: RunPod pod mounts `/runpod-volume/weights` and `/runpod-volume/outputs` for model and output persistence.
- **API Flow**: Frontend → Backend (Django) → Inference (Flask/RunPod)

---

## 🔗 Component Summaries

### Frontend ([details](./frontend/README.md))

- React + Vite SPA
- Calls backend API for prompt submission and image retrieval
- Deployed on Vercel

### Backend ([details](./backend/README.md))

- Django app with custom `igen` module
- Handles API routing, logging, and proxies requests to inference server
- Deployed on Render with Gunicorn

### Stable Diffusion Inference ([details](./StableDiffusion/README.md))

- Custom pipeline: CLIP, VAE Encoder/Decoder, UNet
- Loads weights from HuggingFace ([model](https://huggingface.co/stable-diffusion-v1-5/tree/main), [tokenizer](https://huggingface.co/stable-diffusion-v1-5/tree/main/tokenizer))
- Flask API exposes `/inference` endpoint
- Deployed on RunPod GPU pod with persistent storage

---

## 🧠 Tech Stack

- **Frontend**: React, Vite, JavaScript/JSX, Vercel
- **Backend**: Django, Gunicorn, Python, Render
- **Inference**: Flask, PyTorch, custom SD pipeline, RunPod
- **ML Models**: CLIP, VAE, UNet (from Umar Jamil’s implementation)
- **Tokenizer/Weights**: HuggingFace

---

## 🛠️ Quickstart

1. **Frontend**
   - See [frontend/README.md](./frontend/README.md)
2. **Backend**
   - See [backend/README.md](./backend/README.md)
3. **Stable Diffusion**
   - See [StableDiffusion/README.md](./StableDiffusion/README.md)

---

## 📡 API Flow Diagram

```
User
  │
  ▼
[Frontend (React)]
  │  REST
  ▼
[Backend (Django)]
  │  Proxy
  ▼
[Stable Diffusion (Flask, RunPod)]
```

---

## 📝 Logging & Debugging

- Frontend: Browser console, UI error messages
- Backend: Django logs, Render dashboard
- Inference: Pod logs (stdout), output images in persistent volume

---

## 🙏 Acknowledgements

- [Umar Jamil](https://github.com/cloneofsimo) for Stable Diffusion implementation
- [HuggingFace](https://huggingface.co/stable-diffusion-v1-5) for model weights/tokenizer
- [OpenAI CLIP](https://github.com/openai/CLIP)
- [RunPod](https://www.runpod.io/), [Vercel](https://vercel.com/), [Render](https://render.com/)

---

## 📄 License

This project is for research and educational purposes. See the root `LICENSE` file for details.
