# Use latest compatible base image from RunPod
FROM runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04

# Set environment variables
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    DEBIAN_FRONTEND=noninteractive

# Create app directory
WORKDIR /app

# Install pip if not present and upgrade
RUN apt-get update && apt-get install -y curl git && \
    curl -sS https://bootstrap.pypa.io/get-pip.py | python3.11 && \
    pip install --upgrade pip==24.0

# Install Python libraries
COPY requirements.txt .
RUN pip install --no-deps --ignore-installed -r requirements.txt

# Copy source code
COPY app/src /app/src
COPY app/api.py /app/api.py

# Expose the inference port (mapped via a direct TCP port on the RunPod
# Pod, not the HTTP Proxy -- see docs/13-pod-deployment-guide.md for why)
EXPOSE 8000

# Single worker: one GPU, one CUDA context -- a second concurrent request
# should queue at Gunicorn rather than two workers fighting over the GPU.
CMD ["gunicorn", "-w", "1", "--bind", "0.0.0.0:8000", "--timeout", "300", "api:app"]
