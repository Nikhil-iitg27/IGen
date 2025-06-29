# Frontend – React + Vite

This is the frontend for the IGen system, built with [React](https://react.dev/) and [Vite](https://vitejs.dev/). It provides a modern, responsive UI for users to interact with the generative AI backend and Stable Diffusion inference engine.

---

## 🚀 Features

- Fast, modular React SPA
- Connects to Django backend for prompt submission and image retrieval
- Deployed on [Vercel](https://vercel.com/)
- Clean, component-based structure

---

## 🏗️ Project Structure

```
frontend/
├── src/
│   ├── App.jsx
│   ├── App.css
│   ├── index.css
│   ├── main.jsx
│   └── components/
│       ├── Prompt.jsx
│       └── assets/
│           ├── App.module.css
│           └── Prompt.module.css
├── package.json
├── vite.config.js
├── eslint.config.js
└── README.md
```

---

## 🛠️ Setup Instructions

### 1. Prerequisites

- [Node.js](https://nodejs.org/) (v18+ recommended)
- [npm](https://www.npmjs.com/) or [yarn](https://yarnpkg.com/)

### 2. Install Dependencies

```bash
npm install
# or
yarn install
```

### 3. Run Locally

```bash
npm run dev
# or
yarn dev
```

The app will be available at [http://localhost:5173](http://localhost:5173) by default.

---

## 🌐 Deployment (Vercel)

1. Push your code to a GitHub/GitLab/Bitbucket repo.
2. Connect the repo to [Vercel](https://vercel.com/import).
3. Set the build command to `npm run build` and output directory to `dist`.
4. Environment variables (if any) can be set in the Vercel dashboard.

---

## 🔗 API Integration

The frontend communicates with the Django backend via REST API calls.

### Example: Submitting a Prompt

```js
// src/components/Prompt.jsx
fetch('https://<your-backend-domain>/api/generate/', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ prompt: "A futuristic cityscape at sunset" })
})
  .then(res => res.json())
  .then(data => {
    // data.image_url or similar
  });
```

- **Backend URL**: Set as an environment variable for local/dev/prod.
- **CORS**: Ensure backend allows requests from your frontend domain.

---

## 🧪 Testing

- Lint: `npm run lint`
- (Add your preferred testing framework, e.g., Jest, React Testing Library)

---

## 📝 Logging & Debugging

- Client-side errors are logged in the browser console.
- API errors are surfaced in the UI and can be debugged via browser dev tools.
- For backend/API issues, check the Django backend logs.

---

## 🙏 Acknowledgements

- [React](https://react.dev/)
- [Vite](https://vitejs.dev/)
- [Vercel](https://vercel.com/)

---

## 📄 License

This project is for research and educational purposes. See the root `LICENSE` file for details.
