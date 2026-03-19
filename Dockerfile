FROM python:3.11-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    tesseract-ocr \
    texlive-latex-base \
    texlive-fonts-recommended \
    texlive-latex-extra \
    chktex \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY backend/requirements.txt .
RUN pip install -r requirements.txt

COPY backend/ .

CMD uvicorn main:app --host 0.0.0.0 --port $PORT