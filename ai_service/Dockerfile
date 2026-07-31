FROM python:3.11-slim

WORKDIR /app

# Install system dependencies needed for compiling python packages
RUN apt-get update && apt-get install -y \
    build-essential \
    libpq-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY ai_service/requirements.txt .
RUN pip install --no-cache-dir --default-timeout=120 --retries=10 -r requirements.txt

COPY ai_service/. .
COPY ai_service/ml_models /app/model_seed
COPY docs/prd/dummy_racket_recommendation_data.csv /app/training_data/dummy_racket_recommendation_data.csv

EXPOSE 8000

CMD ["python", "main.py"]
