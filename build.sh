#!/bin/bash
apt-get update
apt-get install -y tesseract-ocr texlive-latex-base texlive-fonts-recommended texlive-latex-extra chktex
pip install -r backend/requirements.txt