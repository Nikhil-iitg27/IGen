import os
import json
import logging
import requests

from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from dotenv import load_dotenv

# --- Load Environment Variables ---
load_dotenv()

# --- Configure Logging ---
logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.DEBUG, format='[%(asctime)s] %(levelname)s: %(message)s')

# --- Inference API Configuration ---
INFERENCE_API_URL = os.getenv("RUNPOD_API", "http://127.0.0.1:5174/inference")
MODEL_UID = os.getenv("MODEL_UID", None)

if not MODEL_UID:
    logger.warning("MODEL_UID is not defined in environment variables.")

logger.info(f"Using Inference API URL: {INFERENCE_API_URL}")
logger.info(f"Using Model UID: {MODEL_UID}")


@csrf_exempt
def generate_image(request):
    if request.method != "POST":
        logger.warning("Non-POST request received.")
        return JsonResponse({"error": "Only POST method is allowed."}, status=405)

    try:
        # Load and parse request body
        try:
            body = request.body.decode("utf-8")
            data = json.loads(body)
            # logger.debug(f"Incoming request data: {data}")
        except json.JSONDecodeError:
            logger.error("Invalid JSON received.")
            return JsonResponse({"error": "Invalid JSON format."}, status=400)

        # Validate inputs
        prompt = data.get("prompt")
        if not prompt:
            logger.warning("Missing prompt in request.")
            return JsonResponse({"error": "Prompt is required."}, status=400)

        payload = {
            "prompt": prompt,
            "unprompt": data.get("unprompt", ""),
            "steps": int(data.get("steps", 50)),
            "seed": int(data.get("seed", 42)),
            "strength": float(data.get("strength", 0.9)),
            "do_scale": bool(data.get("do_scale", True)),
            "scale": float(data.get("scale", 8)),
            "uid": MODEL_UID,
        }

        logger.info("Sending payload to inference backend...")
        # logger.debug(f"Payload: {payload}")

        # Make the API request
        response = requests.post(INFERENCE_API_URL, json=payload, timeout=60)

        # Try parsing response JSON
        try:
            backend_data = response.json()
        except ValueError:
            logger.error("Failed to parse JSON response from backend.")
            return JsonResponse({
                "error": "Invalid JSON from inference server.",
                "status_code": response.status_code,
                "raw_response": response.text
            }, status=500)

        # Handle non-success responses
        if not response.ok:
            logger.error(f"Inference API returned error. Code: {response.status_code}, Body: {backend_data}")
            return JsonResponse({
                "error": "Inference backend failed.",
                "status_code": response.status_code,
                "details": backend_data
            }, status=500)

        logger.info(f"Image generated successfully. ID: {backend_data["uid"]}")
        return JsonResponse(backend_data)

    except requests.exceptions.RequestException as req_err:
        logger.exception("Network error occurred while calling inference backend.")
        return JsonResponse({
            "error": "Failed to connect to inference backend.",
            "details": str(req_err)
        }, status=500)

    except Exception as e:
        logger.exception("Unexpected error in generate_image view.")
        return JsonResponse({
            "error": "Unexpected error occurred.",
            "details": str(e)
        }, status=500)
