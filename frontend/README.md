# Frontend – React + Vite

This is the frontend for IGen, built with [React](https://react.dev/) and [Vite](https://vitejs.dev/). It's a single-page app with three tabs — Generate, Inpaint, and Metrics — sitting behind a passkey gate, and it talks to the Django backend's asynchronous job queue rather than expecting an image back from a single request: every submission is followed by polling, not a one-shot fetch.

---

## Project Structure

```
frontend/
├── src/
│   ├── App.jsx                      # tab routing, shared "last image" state, gallery strip
│   ├── components/
│   │   ├── AccessGate.jsx           # passkey gate, wraps the app and the Metrics tab separately
│   │   ├── Prompt.jsx               # Generate tab
│   │   ├── InpaintEditor.jsx        # Inpaint tab: upload/crop -> mask -> submit -> save
│   │   ├── MaskCanvas.jsx           # paints the inpainting mask (continuous noise-extent brush)
│   │   ├── CropSelector.jsx         # cover-scale + single-axis crop confirmation step
│   │   ├── MetricsDashboard.jsx     # renders /metrics/summary + /metrics/jobs
│   │   ├── RecentImages.jsx         # last-5 gallery strip, click to send into Inpaint
│   │   └── assets/                  # per-component CSS modules
│   ├── hooks/
│   │   ├── useGenerationJob.js      # shared submit/poll/resume logic for Generate + Inpaint
│   │   └── usePersistentState.js    # sessionStorage-backed useState (survives reload)
│   ├── utils/
│   │   ├── apiClient.js             # axios instances, X-Access-Key injection, verify-key call
│   │   ├── imageCrop.js             # cover-scale/crop/composite canvas geometry
│   │   ├── imageGallery.js          # localStorage-backed recent-images gallery
│   │   └── queueStatus.js           # turns job status + queue_position into UI text
│   └── main.jsx
├── package.json
├── vite.config.js
└── eslint.config.js
```

---

## Features

**Generate** is straightforward text-to-image: prompt, negative prompt, step count, seed, guidance scale, submitted through `useGenerationJob("generate")`.

**Inpaint** is the more involved flow. An uploaded photo is rarely square, but the model always works at a fixed 512×512, so a naive resize would squish it — instead, the image is cover-scaled client-side (canvas) until its *smaller* dimension hits 512, which reduces window selection to a single-axis offset (shown via `CropSelector`, with a slider only when there's real overhang to move along). Once a window is confirmed, `MaskCanvas` lets you paint a *continuous* mask, not a hard on/off one — the brush's opacity controls how strongly the model is allowed to regenerate a given pixel versus preserving the original, on top of the usual denoising-strength slider. After generation, you're shown the edited window and can independently choose to save just that crop, the full original with the edit composited back in at native resolution, or both — nothing is auto-saved on your behalf.

Both flows share `useGenerationJob`: it submits, polls `/api/igen/status/<job_id>/` every 2s, and persists the in-flight job id in `sessionStorage` — deliberately not `localStorage`, since `sessionStorage` is isolated per tab, so two tabs open at once never end up polling and resolving each other's job.

**Metrics** is a third tab, separately gated behind the `metrics` scope (a different passkey than the `app` scope the other two tabs use), rendering the backend's aggregate and per-job latency/outcome data.

A **RecentImages** strip (last 5 saved images, `localStorage`-backed) sits above the active tab; clicking one sends it into the Inpaint tab as a starting image, the same path a completed Generate result uses.

---

## API Integration

`utils/apiClient.js` exports two separate axios instances — `appClient` and `metricsClient` — each reading its own key from `localStorage` (`igen_app_key` / `igen_metrics_key`) and attaching it as `X-Access-Key` on every request. This mirrors the backend's two independent `AccessKey` scopes: a page that only has an app-scope key can't accidentally call a metrics endpoint, or vice versa. `AccessGate.jsx` is what collects and validates a key in the first place, via `POST /api/igen/verify-key/`.

The endpoints actually called are:
- `POST /api/igen/generate/` — submit a job, get back `{job_id, status, queue_position}`
- `GET /api/igen/status/<job_id>/` — poll for `{status, queue_position, image?, error?}`
- `GET /api/igen/metrics/summary/`, `GET /api/igen/metrics/jobs/` — Metrics tab only

The backend's base URL is read from `VITE_BACKEND_URL` at build time, not hardcoded.

---

## Setup Instructions

### 1. Prerequisites

- [Node.js](https://nodejs.org/) (v18+ recommended)
- [npm](https://www.npmjs.com/)

### 2. Configure environment

Create a `.env` in `frontend/`:

```
VITE_BACKEND_URL=http://localhost:8000
```

Point this at wherever the backend from `backend/README.md` is actually running.

### 3. Install and run

```bash
npm install
npm run dev
```

The app is available at [http://localhost:5173](http://localhost:5173) by default. You'll need an `AccessKey` created in the backend's Django admin before the passkey gate will let you in.

---

## Deployment (Vercel)

1. Push the repo to GitHub/GitLab/Bitbucket.
2. Connect it to [Vercel](https://vercel.com/import), with `frontend/` as the project root.
3. Build command `npm run build`, output directory `dist`.
4. Set `VITE_BACKEND_URL` to the deployed backend's URL in the Vercel dashboard.

---

## Testing

There's no automated test suite yet — the only check currently run is `npm run lint`. Frontend changes are verified manually in-browser (Generate and Inpaint flows, both tabs, both success and error paths).

---

## Acknowledgements

- [React](https://react.dev/)
- [Vite](https://vitejs.dev/)
- [Vercel](https://vercel.com/)

---

## License

This project is for research and educational purposes. See the root `LICENSE` file for details.
