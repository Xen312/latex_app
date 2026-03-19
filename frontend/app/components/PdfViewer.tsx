"use client";
import { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";

pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

interface PdfViewerProps {
  pdfUrl: string;
}

export default function PdfViewer({ pdfUrl }: PdfViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!pdfUrl) return;
    loadPdf();
  }, [pdfUrl, currentPage]);

  async function loadPdf() {
    setLoading(true);
    try {
      const response = await fetch(pdfUrl);
      const arrayBuffer = await response.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      setNumPages(pdf.numPages);

      const page = await pdf.getPage(currentPage);
      const canvas = canvasRef.current;
      if (!canvas) return;

      const containerWidth = containerRef.current?.clientWidth || 800;
      const viewport = page.getViewport({ scale: 1 });
      const scale = containerWidth / viewport.width;
      const scaledViewport = page.getViewport({ scale });

      canvas.width = scaledViewport.width;
      canvas.height = scaledViewport.height;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      await page.render({
        canvasContext: ctx,
        viewport: scaledViewport,
        canvas: canvas,
    }).promise;

    } catch (err) {
      console.error("PDF render error:", err);
    }
    setLoading(false);
  }

  return (
    <div ref={containerRef} className="w-full flex flex-col items-center gap-3">
      {loading && (
        <div className="flex items-center justify-center h-64">
          <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      <canvas
        ref={canvasRef}
        className={`w-full rounded-lg border border-gray-700 ${loading ? "hidden" : ""}`}
      />

      {/* Page controls */}
      {numPages > 1 && (
        <div className="flex items-center gap-4 text-sm text-gray-400">
          <button
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            className="px-3 py-1 bg-gray-800 rounded-lg disabled:opacity-50 hover:bg-gray-700 transition-colors"
          >
            ← Prev
          </button>
          <span>Page {currentPage} of {numPages}</span>
          <button
            onClick={() => setCurrentPage(p => Math.min(numPages, p + 1))}
            disabled={currentPage === numPages}
            className="px-3 py-1 bg-gray-800 rounded-lg disabled:opacity-50 hover:bg-gray-700 transition-colors"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}