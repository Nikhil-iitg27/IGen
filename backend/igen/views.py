import os
import json
import base64
import requests
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from dotenv import load_dotenv

load_dotenv()  # Load UID from .env if needed

# The backend inference API
INFERENCE_API_URL = os.environ.get("RUNPOD_API", "http://127.0.0.1:5174/inference")
MODEL_UID = os.environ.get("MODEL_UID")

@csrf_exempt
def generate_image(request):
    if request.method == "POST":
        try:
            data = json.loads(request.body)

            prompt = data.get("prompt", "")
            unprompt = data.get("unprompt", "")
            steps = data.get("steps", 50)
            seed = data.get("seed", 43)
            strength = data.get("strength", 0.9)
            do_scale = data.get("do_scale", True)
            scale = data.get("scale", 8)

            if not prompt:
                return JsonResponse({"error": "Prompt is required"}, status=400)

            # Construct new payload with UID
            forward_payload = {
                "prompt": prompt,
                "unprompt": unprompt,
                "steps": steps,
                "seed": seed,
                "strength": strength,
                "do_scale": do_scale,
                "scale": scale,
                "uid": MODEL_UID
            }

            # Send to inference API
            response = requests.post(INFERENCE_API_URL, json=forward_payload)
            response.raise_for_status()
            backend_data = response.json()

            return JsonResponse(backend_data)

        except requests.exceptions.RequestException as err:
            return JsonResponse({"error": f"Inference request failed: {str(err)}"}, status=500)
        except Exception as e:
            return JsonResponse({"error": str(e)}, status=500)

    return JsonResponse({"error": "Invalid request method"}, status=400)