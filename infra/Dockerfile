FROM python:3.13-slim
RUN apt-get update && apt-get install -y --no-install-recommends poppler-utils tesseract-ocr ghostscript && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
ENV PYTHONPATH=/app/apps/api:/app/apps/worker:/app/packages/pdf-engine:/app/packages/storage
USER 1000
