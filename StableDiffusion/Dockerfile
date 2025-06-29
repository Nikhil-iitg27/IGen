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

# Expose port
EXPOSE 8000

# Start Gunicorn server (single worker for now, can be scaled)
CMD ["gunicorn", "--bind", "0.0.0.0:8000", "api:app"]
