from fastapi import FastAPI, File, UploadFile, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from groq import Groq
from dotenv import load_dotenv
import httpx
import base64
import re
import os
import json
import hashlib

load_dotenv()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)

@app.middleware("http")
async def add_cors_on_error(request: Request, call_next):
    response = await call_next(request)
    response.headers["Access-Control-Allow-Origin"] = "*"
    return response

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
if not GROQ_API_KEY:
    raise ValueError("GROQ_API_KEY not found in .env file!")
groq_client = Groq(api_key=GROQ_API_KEY)

ALLOWED_TYPES = {"image/jpeg", "image/png", "image/jpg", "image/webp", "image/bmp"}
MAX_FILE_SIZE = 10 * 1024 * 1024

pdf_cache: dict = {}
MAX_CACHE_SIZE = 50

DANGEROUS_PATTERNS = [
    r'\\write18',
    r'\\catcode',
    r'\\openout',
    r'\\openin',
    r'\\immediate',
    r'\\include\s*\{',
    r'\\input\s*\{',
]

OUTDATED_PACKAGES = {
    "graphics": "graphicx",
    "epsfig": "graphicx",
    "psfig": "graphicx",
    "epsf": "graphicx",
    "doublespace": "setspace",
    "spacing": "setspace",
    "fancyheadings": "fancyhdr",
    "t1enc": "fontenc",
    "pslatex": "mathptmx",
    "palatino": "mathpazo",
    "times": "mathptmx",
    "helvet": "mathptmx",
    "avant": "mathptmx",
    "newcent": "mathptmx",
    "bookman": "mathptmx",
    "charter": "mathptmx",
    "isolatin1": "inputenc",
    "isolatin": "inputenc",
    "umlaut": "inputenc",
    "amsfonts": "amssymb",
    "supertabular": "longtable",
    "hhline": "booktabs",
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
}


def get_cache_key(latex_code: str) -> str:
    return hashlib.md5(latex_code.encode()).hexdigest()


def sanitize_latex(latex_code: str) -> tuple[bool, str]:
    for pattern in DANGEROUS_PATTERNS:
        if re.search(pattern, latex_code):
            return False, f"Dangerous command detected: {pattern}"
    return True, ""


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
            errors.append({"message": message, "line": error_line, "context": context})
        i += 1
    return errors


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
        if '\\includegraphics[' in line and '][' in line:
            warnings.append({
                "message": "Wrong \\includegraphics syntax — use {filename} not [filename]",
                "line": str(i),
                "context": line.strip()
            })
        if '$$' in line:
            warnings.append({
                "message": "Avoid '$$' — use \\[ ... \\] for display math instead",
                "line": str(i),
                "context": line.strip()
            })
    if '\\documentclass' not in latex_code:
        warnings.append({
            "message": "Missing \\documentclass — document may not compile correctly",
            "line": "1",
            "context": ""
        })
    return warnings


def replace_images_with_placeholders(latex_code: str) -> str:
    if "\\usepackage{graphicx}" not in latex_code:
        latex_code = re.sub(
            r'(\\documentclass.*?\})',
            lambda m: m.group(1) + '\n\\usepackage{graphicx}',
            latex_code,
            count=1
        )

    def make_placeholder(match):
        full = match.group(0)
        filename_match = re.search(r'\{([^}]+)\}$', full)
        filename = filename_match.group(1) if filename_match else "image"
        width_match = re.search(r'width\s*=\s*([^\s,\]]+)', full)
        width = width_match.group(1) if width_match else "5cm"
        return (
            "\\fbox{\\parbox{" + width + "}{"
            "\\centering\\vspace{1cm}"
            "\\texttt{" + filename + "}"
            "\\vspace{1cm}}}"
        )

    return re.sub(
        r'\\includegraphics(?:\[[^\]]*\])?\{[^}]+\}',
        make_placeholder,
        latex_code
    )


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
                        "image_url": {"url": f"data:image/jpeg;base64,{base64_image}"}
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


@app.get("/")
def read_root():
    return {"message": "Backend is alive!"}


@app.post("/upload")
async def upload_image(file: UploadFile = File(...)):
    if file.content_type not in ALLOWED_TYPES:
        return {"error": f"Invalid file type: {file.content_type}. Allowed: JPEG, PNG, WEBP, BMP"}

    contents = await file.read()

    if len(contents) > MAX_FILE_SIZE:
        return {"error": "File too large. Maximum size is 10MB."}

    text = groq_vision_ocr(contents)
    return {
        "filename": file.filename,
        "text": text,
        "engine": "groq",
        "confidence": 0
    }


@app.post("/compile")
async def compile_latex(data: dict):
    latex_code = data.get("latex", "")

    is_safe, reason = sanitize_latex(latex_code)
    if not is_safe:
        return {"error": f"Security violation: {reason}"}

    warnings = check_outdated_packages(latex_code)
    latex_code = replace_images_with_placeholders(latex_code)

    cache_key = get_cache_key(latex_code)
    if cache_key in pdf_cache:
        cached_pdf, cached_warnings = pdf_cache[cache_key]
        warnings_json = base64.b64encode(json.dumps(cached_warnings).encode()).decode()
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

    try:
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.post(
                "https://latex.ytotech.com/builds/sync",
                json={
                    "compiler": "pdflatex",
                    "resources": [{"main": True, "content": latex_code}]
                },
                headers={"Content-Type": "application/json"}
            )

        if response.status_code not in [200, 201] or "application/pdf" not in response.headers.get("content-type", ""):
            try:
                error_data = response.json()
                log_content = list(error_data.get("log_files", {}).values())[0] if "log_files" in error_data else ""
                errors = parse_latex_errors(log_content) or [{"message": "Compilation failed — check LaTeX syntax", "line": None, "context": ""}]
                return {
                    "error": "Compilation completed with errors",
                    "error_lines": errors,
                    "warning_lines": warnings,
                    "stdout": log_content,
                    "stderr": ""
                }
            except Exception:
                return {
                    "error": "PDF not generated",
                    "error_lines": [{"message": "Compilation failed — check LaTeX syntax", "line": None, "context": ""}],
                    "stdout": "",
                    "stderr": ""
                }

        pdf_bytes = response.content

    except Exception as e:
        return {
            "error": "PDF not generated",
            "error_lines": [{"message": f"Compilation service error: {str(e)}", "line": None, "context": ""}],
            "stdout": "",
            "stderr": ""
        }

    if len(pdf_cache) >= MAX_CACHE_SIZE:
        oldest_key = next(iter(pdf_cache))
        del pdf_cache[oldest_key]
    pdf_cache[cache_key] = (pdf_bytes, warnings)

    warnings_json = base64.b64encode(json.dumps(warnings).encode()).decode()

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