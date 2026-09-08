# RetinaEdge — single container: builds the React frontend, serves it with FastAPI + ONNX Runtime.
FROM node:20-alpine AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM python:3.11-slim
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 OMP_NUM_THREADS=2
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends libglib2.0-0 libgomp1 && rm -rf /var/lib/apt/lists/*
COPY backend/requirements.txt backend/requirements.txt
RUN pip install -r backend/requirements.txt
COPY backend/ backend/
COPY models/*.onnx models/*.json models/
COPY run.py README.md MODEL_CARD.md ./
COPY --from=web /web/dist frontend/dist
RUN mkdir -p data/images
EXPOSE 8000
CMD ["python", "run.py", "--host", "0.0.0.0"]
