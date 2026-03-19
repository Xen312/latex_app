"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { ZoomIn, ZoomOut, ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";

interface PdfViewerProps {
  pdfUrl: string;
}

export default function PdfViewer({ pdfUrl }: PdfViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale] = useState(1.0);
  const [loading, setLoading] = useState(true);
  const [pageInput, setPageInput] = useState("1");
  const pdfRef = useRef<any>(null);

  useEffect(() => {
    if (!pdfUrl) return;
    loadPdf();
  }, [pdfUrl]);

  useEffect(() => {
    if (pdfRef.current) renderPage();
  }, [currentPage, scale]);

  async function loadPdf() {
    setLoading(true);
    try {
      const pdfjsLib = await import("pdfjs-dist");
      pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js`;

      const response = await fetch(pdfUrl);
      const arrayBuffer = await response.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      pdfRef.current = pdf;
      setNumPages(pdf.numPages);
      setCurrentPage(1);
      setPageInput("1");

      // Auto fit to container width
      const page = await pdf.getPage(1);
      const viewport = page.getViewport({ scale: 1 });
      const containerWidth = containerRef.current?.clientWidth || 800;
      const fitScale = (containerWidth - 32) / viewport.width;
      setScale(parseFloat(fitScale.toFixed(2)));
    } catch (err) {
      console.error("PDF load error:", err);
    }
    setLoading(false);
  }

  async function renderPage() {
    if (!pdfRef.current || !canvasRef.current) return;
    setLoading(true);
    try {
      const page = await pdfRef.current.getPage(currentPage);
      const canvas = canvasRef.current;
      const dpr = window.devicePixelRatio || 1;

      const viewport = page.getViewport({ scale });
      canvas.width = viewport.width * dpr;
      canvas.height = viewport.height * dpr;
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.scale(dpr, dpr);

      await page.render({
        canvasContext: ctx,
        viewport,
      }).promise;
    } catch (err) {
      console.error("PDF render error:", err);
    }
    setLoading(false);
  }

  function zoomIn() {
    setScale(s => parseFloat(Math.min(s + 0.25, 3.0).toFixed(2)));
  }

  function zoomOut() {
    setScale(s => parseFloat(Math.max(s - 0.25, 0.5).toFixed(2)));
  }

  function resetZoom() {
    if (!pdfRef.current || !containerRef.current) return;
    pdfRef.current.getPage(1).then((page: any) => {
      const viewport = page.getViewport({ scale: 1 });
      const containerWidth = containerRef.current?.clientWidth || 800;
      const fitScale = (containerWidth - 32) / viewport.width;
      setScale(parseFloat(fitScale.toFixed(2)));
    });
  }

  function goToPage(page: number) {
    const p = Math.min(Math.max(1, page), numPages);
    setCurrentPage(p);
    setPageInput(String(p));
  }

  // Pinch to zoom on mobile
  const lastDist = useRef<number | null>(null);
  const lastScale = useRef(scale);

  function onTouchMove(e: React.TouchEvent) {
    if (e.touches.length !== 2) return;
    e.preventDefault();

    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (lastDist.current !== null) {
        const ratio = dist / lastDist.current;
        const newScale = parseFloat(
        Math.min(Math.max(scale * ratio, 0.5), 3.0).toFixed(2)
        );
        setScale(newScale);
        lastScale.current = newScale;
    }
    lastDist.current = dist;
}

  function onTouchEnd() {
    lastDist.current = null;
  }

  return (
    <div className="w-full flex flex-col gap-2">

      {/* Toolbar */}
      <div className="flex items-center justify-between bg-gray-800 rounded-lg px-3 py-2">

        {/* Page navigation */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => goToPage(currentPage - 1)}
            disabled={currentPage === 1}
            className="p-1.5 rounded hover:bg-gray-700 disabled:opacity-40 transition-colors"
          >
            <ChevronLeft className="w-4 h-4 text-gray-300" />
          </button>
          <div className="flex items-center gap-1.5 text-sm text-gray-300">
            <input
              type="number"
              min={1}
              max={numPages}
              value={pageInput}
              onChange={(e) => setPageInput(e.target.value)}
              onBlur={() => goToPage(parseInt(pageInput) || 1)}
              onKeyDown={(e) => e.key === "Enter" && goToPage(parseInt(pageInput) || 1)}
              className="w-10 text-center bg-gray-700 border border-gray-600 rounded px-1 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <span className="text-gray-500">/ {numPages}</span>
          </div>
          <button
            onClick={() => goToPage(currentPage + 1)}
            disabled={currentPage === numPages}
            className="p-1.5 rounded hover:bg-gray-700 disabled:opacity-40 transition-colors"
          >
            <ChevronRight className="w-4 h-4 text-gray-300" />
          </button>
        </div>

        {/* Zoom controls */}
        <div className="flex items-center gap-1">
          <button
            onClick={zoomOut}
            disabled={scale <= 0.5}
            className="p-1.5 rounded hover:bg-gray-700 disabled:opacity-40 transition-colors"
          >
            <ZoomOut className="w-4 h-4 text-gray-300" />
          </button>
          <span className="text-xs text-gray-400 w-12 text-center">
            {Math.round(scale * 100)}%
          </span>
          <button
            onClick={zoomIn}
            disabled={scale >= 3.0}
            className="p-1.5 rounded hover:bg-gray-700 disabled:opacity-40 transition-colors"
          >
            <ZoomIn className="w-4 h-4 text-gray-300" />
          </button>
          <button
            onClick={resetZoom}
            className="p-1.5 rounded hover:bg-gray-700 transition-colors"
            title="Reset zoom"
          >
            <RotateCcw className="w-3.5 h-3.5 text-gray-400" />
          </button>
        </div>
      </div>

      {/* Canvas container */}
      <div
        ref={containerRef}
        className="w-full overflow-x-auto overflow-y-auto bg-gray-950 rounded-lg border border-gray-700"
        style={{ maxHeight: "calc(100vh - 320px)", minHeight: "400px", touchAction: "none" }}
        onTouchMove={(e) => { e.preventDefault(); onTouchMove(e); }}
        onTouchEnd={onTouchEnd}
      >
        <div className="flex justify-center p-4">
          {loading && (
            <div className="absolute flex items-center justify-center">
              <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
            </div>
          )}
          <canvas
            ref={canvasRef}
            className="shadow-lg"
            style={{ opacity: loading ? 0.3 : 1, transition: "opacity 0.2s" }}
          />
        </div>
      </div>
    </div>
  );
}