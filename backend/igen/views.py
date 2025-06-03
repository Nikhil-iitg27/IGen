import os
import json
import base64
from io import BytesIO
from PIL import Image, ImageDraw
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

@csrf_exempt
def generate_image(request):
    if request.method == "POST":
        try:
            data = json.loads(request.body)
            print("Request body:", request.body)
            prompt = data.get("prompt","")
            
            if not prompt:
                return JsonResponse({"error": "Prompt is required"}, status=400)
            
            img = Image.new("RGB", (240, 180), color=(255, 255, 255))
            draw = ImageDraw.Draw(img)
            draw.text((20, 90), prompt, fill=(0, 0, 0))

            buffered = BytesIO()
            img.save(buffered, format="PNG")
            img_str = base64.b64encode(buffered.getvalue()).decode()

            return JsonResponse({"image": img_str})
        
        except Exception as e:
            return JsonResponse({"error": str(e)}, status=500)

    return JsonResponse({"error": "Invalid request"}, status=400)          