# backend/Dockerfile
FROM python:3.10-slim

# Install system packages required by dlib, OpenCV and face-recognition
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    cmake \
    g++ \
    git \
    wget \
    pkg-config \
    libopenblas-dev \
    liblapack-dev \
    libx11-6 \
    libx11-dev \
    libgl1 \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender1 \
    libgtk-3-0 \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy requirements first for caching
COPY requirements.txt /app/requirements.txt

# Upgrade pip & install dependencies
RUN pip install --upgrade pip setuptools wheel \
 && pip install --no-cache-dir -r /app/requirements.txt

# Copy the rest of the app
COPY . /app

# Expose backend port
EXPOSE 5000

# Use $PORT (set by Railway) or 5000 locally
CMD ["sh", "-c", "gunicorn app:app --bind 0.0.0.0:${PORT:-5000} --workers 1 --threads 4"]
