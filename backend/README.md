# Backend – Django + Gunicorn

This is the backend for the IGen system, built with [Django](https://www.djangoproject.com/) and a custom app called `igen`. It handles API routing, request logging, and proxies inference calls to the Stable Diffusion inference server. The backend is designed for deployment with Gunicorn and Render.

---

## 🏗️ Project Structure

```
backend/
├── db.sqlite3
├── manage.py
├── requirements.txt
├── backend/
│   ├── __init__.py
│   ├── asgi.py
│   ├── settings.py
│   ├── urls.py
│   └── wsgi.py
└── igen/
    ├── __init__.py
    ├── admin.py
    ├── apps.py
    ├── models.py
    ├── tests.py
    ├── urls.py
    └── views.py
```

---

## ⚙️ Features

- Django REST API with custom `igen` app
- Proxies prompt/image requests to ML backend (Stable Diffusion server)
- Logs all requests and responses for traceability
- Deployed with Gunicorn (WSGI) on Render

---

## 🛠️ Setup Instructions

### 1. Prerequisites
- Python 3.10+
- pip

### 2. Install Dependencies

```bash
pip install -r requirements.txt
```

### 3. Database Migration

```bash
python manage.py migrate
```

### 4. Run Locally

```bash
python manage.py runserver
```

---

## 🚀 Deployment (Render + Gunicorn)

- Use [Gunicorn](https://gunicorn.org/) as the WSGI server:
  ```bash
  gunicorn backend.wsgi
  ```
- Configure Render to run migrations and start Gunicorn on deploy.
- Set environment variables (e.g., `DEBUG`, `ALLOWED_HOSTS`, `ML_API_URL`).

---

## 🔗 API Routing & Proxy

- All prompt/image requests are routed through Django and proxied to the Stable Diffusion inference server (e.g., on RunPod).
- Example endpoint: `/api/generate/`
- The backend handles authentication, logging, and error handling.

### Example Request/Response

**Request:**
```bash
curl -X POST https://<your-backend-domain>/api/generate/ \
  -H "Content-Type: application/json" \
  -d '{"prompt": "A futuristic cityscape at sunset"}'
```

**Response:**
```json
{
  "image_url": "https://<your-backend-domain>/media/generated/abc123.png",
  "status": "success"
}
```

---

## 📝 Logging & Debugging

- All API requests and responses are logged by the `igen` app (see `models.py` and `views.py`).
- Logs can be viewed in the Render dashboard or server logs.
- For debugging, set `DEBUG=True` in environment variables (not recommended for production).

---

## 🙏 Acknowledgements

- [Django](https://www.djangoproject.com/)
- [Gunicorn](https://gunicorn.org/)
- [Render](https://render.com/)

---

## 📄 License

This project is for research and educational purposes. See the root `LICENSE` file for details.
