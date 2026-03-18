from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
import pytesseract
from PIL import Image
from groq import Groq
from dotenv import load_dotenv
import base64
import io
import subprocess
import tempfile
import os
import asyncio
from concurrent.futures import ThreadPoolExecutor
import hashlib
from functools import lru_cache

# Simple in-memory cache: {latex_hash: pdf_bytes}
pdf_cache: dict = {}
MAX_CACHE_SIZE = 50  # Store max 50 compiled PDFs

def get_cache_key(latex_code: str) -> str:
    return hashlib.md5(latex_code.encode()).hexdigest()

load_dotenv()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "https://latexocr-d6pvvxdn0-xen312s-projects.vercel.app",
    ],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "Access-Control-Allow-Origin"],
    allow_credentials=True,
)

pytesseract.pytesseract.tesseract_cmd = r"C:\Program Files\Tesseract-OCR\tesseract.exe"

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
if not GROQ_API_KEY:
    raise ValueError("GROQ_API_KEY not found in .env file!")
groq_client = Groq(api_key=GROQ_API_KEY)

ALLOWED_TYPES = {"image/jpeg", "image/png", "image/jpg", "image/webp", "image/bmp"}
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB

DANGEROUS_COMMANDS = [
    "\\write18",
    "\\input",
    "\\include",
    "\\catcode",
    "\\openout",
    "\\openin",
    "\\immediate",
]

def sanitize_latex(latex_code: str) -> tuple[bool, str]:
    for cmd in DANGEROUS_COMMANDS:
        if cmd in latex_code:
            return False, f"Dangerous command detected: {cmd}"
    return True, ""

OUTDATED_PACKAGES = {
    # Graphics
    "graphics": "graphicx",
    "epsfig": "graphicx",
    "psfig": "graphicx",
    "epsf": "graphicx",
    # Spacing
    "doublespace": "setspace",
    "spacing": "setspace",
    # Headers
    "fancyheadings": "fancyhdr",
    # Fonts
    "t1enc": "fontenc",
    "pslatex": "mathptmx",
    "palatino": "mathpazo",
    "times": "mathptmx",
    "helvet": "mathptmx",
    "avant": "mathptmx",
    "newcent": "mathptmx",
    "bookman": "mathptmx",
    "charter": "mathptmx",
    # Encoding
    "isolatin1": "inputenc",
    "isolatin": "inputenc",
    "umlaut": "inputenc",
    # Math
    "amsfonts": "amssymb",
    "eqnarray": "amsmath (use align instead)",
    # Tables
    "supertabular": "longtable",
    "hhline": "booktabs",
    # Misc
    "a4": "geometry",
    "a4wide": "geometry",
    "fullpage": "geometry",
    "anysize": "geometry",
    "vmargin": "geometry",
    "theorem": "amsthm",
    "caption2": "caption",
    "subfigure": "subcaption",
    "subfig": "subcaption",
    "scrpage2": "scrlayer-scrpage",
    "mathpple": "mathpazo",
    "utopia": "fourier",
    "fourier": "fourier",
}

def check_outdated_packages(latex_code: str) -> list:
    warnings = []
    for i, line in enumerate(latex_code.split('\n'), start=1):
        for old_pkg, new_pkg in OUTDATED_PACKAGES.items():
            if f'\\usepackage{{{old_pkg}}}' in line:
                warnings.append({
                    "message": f"Outdated package '{old_pkg}' — use '{new_pkg}' instead",
                    "line": str(i),
                    "context": line.strip()
                })
    return warnings

def check_latex_warnings(tex_file: str) -> list:
    warnings = []
    
    result = subprocess.run(
        ["chktex", "-q", "-wall", tex_file],
        capture_output=True,
        text=True
    )
    
    output = result.stdout + result.stderr
    
    for line in output.split('\n'):
        line = line.strip()
        if not line:
            continue
            
        # chktex format: filename:line:col: type num: message
        parts = line.split(':')
        if len(parts) >= 4:
            try:
                line_num = parts[1].strip()
                message = ':'.join(parts[3:]).strip()
                warnings.append({
                    "message": message,
                    "line": line_num,
                    "context": ""
                })
            except:
                continue
    
    return warnings

def parse_latex_errors(stdout: str) -> list:
    errors = []
    lines = stdout.split('\n')

    i = 0
    while i < len(lines):
        line = lines[i].strip()

        if line.startswith('!'):
            message = line[1:].strip()
            error_line = None
            context = ""

            for j in range(i + 1, min(i + 15, len(lines))):
                next_line = lines[j].strip()
                if next_line.startswith('l.'):
                    parts = next_line.split(' ', 1)
                    error_line = parts[0][2:]
                    context = parts[1].strip() if len(parts) > 1 else ""
                    break

            errors.append({
                "message": message,
                "line": error_line,
                "context": context
            })

        i += 1

    return errors

def get_tesseract_confidence(image: Image.Image) -> float:
    data = pytesseract.image_to_data(
        image,
        output_type=pytesseract.Output.DICT,
        config=r'--oem 3 --psm 6'
    )
    confidences = [
        int(c) for c in data['conf']
        if str(c).strip() != '-1' and str(c).strip() != ''
    ]
    if not confidences:
        return 0.0
    return sum(confidences) / len(confidences)

def groq_vision_ocr(image_bytes: bytes) -> str:
    base64_image = base64.b64encode(image_bytes).decode('utf-8')
    response = groq_client.chat.completions.create(
        model="meta-llama/llama-4-scout-17b-16e-instruct",
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/jpeg;base64,{base64_image}"
                        }
                    },
                    {
                        "type": "text",
                        "text": "This image contains handwritten LaTeX code. Extract the exact LaTeX source code you see written. Return ONLY the raw LaTeX code, nothing else. No explanations, no markdown, no backticks."
                    }
                ]
            }
        ],
        max_tokens=1000
    )
    return response.choices[0].message.content.strip()

def auto_ocr(image_bytes: bytes) -> dict:
    image = Image.open(io.BytesIO(image_bytes))
    confidence = get_tesseract_confidence(image)
    print(f"Tesseract confidence: {confidence:.1f}%")

    if confidence >= 60:
        text = pytesseract.image_to_string(image, config=r'--oem 3 --psm 6')
        return {"text": text, "engine": "tesseract", "confidence": confidence}
    else:
        print("Low confidence, switching to Groq Vision...")
        text = groq_vision_ocr(image_bytes)
        return {"text": text, "engine": "groq", "confidence": confidence}

@app.get("/")
def read_root():
    return {"message": "Backend is alive!"}

@app.post("/upload")
async def upload_image(file: UploadFile = File(...)):
    if file.content_type not in ALLOWED_TYPES:
        return {
            "error": f"Invalid file type: {file.content_type}. Allowed: JPEG, PNG, WEBP, BMP"
        }

    contents = await file.read()

    if len(contents) > MAX_FILE_SIZE:
        return {"error": "File too large. Maximum size is 10MB."}

    result = auto_ocr(contents)
    return {
        "filename": file.filename,
        "text": result["text"],
        "engine": result["engine"],
        "confidence": result["confidence"]
    }

@app.post("/compile")
async def compile_latex(data: dict):
    latex_code = data.get("latex", "")

    is_safe, reason = sanitize_latex(latex_code)
    if not is_safe:
        return {"error": f"Security violation: {reason}"}

    # Check cache first
    cache_key = get_cache_key(latex_code)
    if cache_key in pdf_cache:
        print("Cache hit!")
        cached_pdf, cached_warnings = pdf_cache[cache_key]
        import json
        warnings_json = base64.b64encode(
            json.dumps(cached_warnings).encode()
        ).decode()
        return Response(
            content=cached_pdf,
            media_type="application/pdf",
            headers={
                "Content-Disposition": "attachment; filename=output.pdf",
                "X-Warnings-Count": str(len(cached_warnings)),
                "X-Warnings-Data": warnings_json,
                "Access-Control-Expose-Headers": "X-Warnings-Count, X-Warnings-Data",
                "X-Cache": "HIT"
            }
        )

    with tempfile.TemporaryDirectory() as tmpdir:
        tex_file = os.path.join(tmpdir, "document.tex")
        pdf_file = os.path.join(tmpdir, "document.pdf")

        with open(tex_file, "w") as f:
            f.write(latex_code)

        # Run chktex AFTER file is written
        # Run chktex and pdflatex IN PARALLEL
        def run_pdflatex():
            return subprocess.run(
                ["pdflatex", "-interaction=nonstopmode", "--no-shell-escape", tex_file],
                cwd=tmpdir,
                capture_output=True,
                text=True
            )

        def run_chktex():
            return check_latex_warnings(tex_file)

        with ThreadPoolExecutor(max_workers=2) as executor:
            future_pdf = executor.submit(run_pdflatex)
            future_warnings = executor.submit(run_chktex)
            result = future_pdf.result()
            chktex_warnings = future_warnings.result()

        warnings = chktex_warnings + check_outdated_packages(latex_code)

        errors = parse_latex_errors(result.stdout)

        if errors:
            return {
                "error": "Compilation completed with errors",
                "error_lines": errors,
                "warning_lines": warnings,
                "stdout": result.stdout,
                "stderr": result.stderr
            }

        if not os.path.exists(pdf_file):
            return {
                "error": "PDF not generated",
                "error_lines": [{"message": "Unknown error — check LaTeX syntax", "line": None, "context": ""}],
                "stdout": result.stdout,
                "stderr": result.stderr
            }

        with open(pdf_file, "rb") as f:
            pdf_bytes = f.read()

    import json
    warnings_json = base64.b64encode(
        json.dumps(warnings).encode()
    ).decode()

    # Store in cache
    if len(pdf_cache) >= MAX_CACHE_SIZE:
        # Remove oldest entry
        oldest_key = next(iter(pdf_cache))
        del pdf_cache[oldest_key]
    pdf_cache[cache_key] = (pdf_bytes, warnings)

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": "attachment; filename=output.pdf",
            "X-Warnings-Count": str(len(warnings)),
            "X-Warnings-Data": warnings_json,
            "Access-Control-Expose-Headers": "X-Warnings-Count, X-Warnings-Data"
        }
    )