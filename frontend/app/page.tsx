"use client";
import { useState, useEffect } from "react";
import {
  Upload,
  FileText,
  Code2,
  Download,
  RefreshCw,
  AlertTriangle,
  XCircle,
  MapPin,
  File,
  Camera,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import Auth from "./components/Auth";
import History from "./components/History";

type Tab = "preview" | "latex";

interface ErrorLine {
  message: string;
  line: string | null;
  context: string;
}

const RATE_LIMIT = 10;

export default function Home() {
  const [extractedText, setExtractedText] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [isCompiling, setIsCompiling] = useState(false);
  const [engine, setEngine] = useState("");
  const [compileError, setCompileError] = useState<ErrorLine[]>([]);
  const [compileWarnings, setCompileWarnings] = useState<ErrorLine[]>([]);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("preview");
  const [fileName, setFileName] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [user, setUser] = useState<any>(null);

  // Load user on mount
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  async function saveToHistory(latexCode: string, pdfBlob: Blob) {
    if (!user) return;

    try {
      // Upload PDF to Supabase Storage
      const fileName = `${user.id}/${Date.now()}.pdf`;
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from("pdfs")
        .upload(fileName, pdfBlob, { contentType: "application/pdf" });

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from("pdfs")
        .getPublicUrl(fileName);

      // Save to conversions table
      await supabase.from("conversions").insert({
        user_id: user.id,
        latex_code: latexCode,
        pdf_url: publicUrl,
      });
    } catch (err) {
      console.error("Failed to save history:", err);
    }
  }

  async function uploadImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setEngine("");
    setExtractedText("");
    setCompileError([]);
    setCompileWarnings([]);
    setPdfUrl(null);
    setFileName(file.name);

    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/upload`, {
      method: "POST",
      body: formData,
    });

    const data = await res.json();
    setEngine(data.engine);
    setExtractedText(data.text);
    setIsUploading(false);

    if (data.text) {
      await compile(data.text);
    }
  }

  async function compile(latexCode: string) {
    setIsCompiling(true);
    setCompileError([]);
    setPdfUrl(null);

    const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/compile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ latex: latexCode }),
    });

    const contentType = res.headers.get("content-type");
    if (!res.ok || contentType?.includes("application/json")) {
      const err = await res.json();

      if (err.error === "rate_limited") {
        const minutes = Math.ceil(err.retry_after / 60);
        setCompileError([{
          message: `Rate limit reached — you can compile ${RATE_LIMIT} times per hour. Try again in ${minutes} minute${minutes > 1 ? "s" : ""}.`,
          line: null,
          context: ""
        }]);
        setActiveTab("latex");
        setIsCompiling(false);
        return;
      }

      setCompileError(err.error_lines || [{ message: "Unknown compilation error", line: null, context: "" }]);
      setCompileWarnings(err.warning_lines || []);
      setActiveTab("latex");
      setIsCompiling(false);
      return;
    }

    const warningsData = res.headers.get("X-Warnings-Data");
    if (warningsData) {
      const decoded = JSON.parse(atob(warningsData));
      setCompileWarnings(decoded);
      if (decoded.length > 0) setActiveTab("latex");
    } else {
      setCompileWarnings([]);
    }

    const blob = await res.blob();

    // Save to history if user is signed in
    if (user) {
      await saveToHistory(latexCode, blob);
    }

    const url = URL.createObjectURL(blob);
    setPdfUrl(url);
    if (!warningsData || JSON.parse(atob(warningsData || "W10=")).length === 0) {
      setActiveTab("preview");
    }
    setIsCompiling(false);
  }

  function downloadPdf() {
    if (!pdfUrl) return;
    const a = document.createElement("a");
    a.href = pdfUrl;
    a.download = "output.pdf";
    a.click();
  }

  function handleRestore(latex: string) {
    setExtractedText(latex);
    setActiveTab("latex");
    setCompileError([]);
    setCompileWarnings([]);
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">

      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-900 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between">
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="bg-blue-600 p-1.5 sm:p-2 rounded-lg">
              <FileText className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
            </div>
            <div>
              <h1 className="text-base sm:text-xl font-bold text-white">LaTeX OCR</h1>
              <p className="text-xs text-gray-400 hidden sm:block">Handwritten LaTeX to PDF</p>
            </div>
          </div>
          <Auth user={user} onAuthChange={() => setUser(null)} />
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-4 sm:py-8">

        {/* History */}
        <History user={user} onRestore={handleRestore} />
        {!user && (
          <div className="mb-4 sm:mb-6 flex items-center gap-3 bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
            <div className="text-gray-400 text-sm">
              💡 Sign in to save your conversion history
            </div>
          </div>
        )}

        {/* Upload Zone */}
        <div className="mb-4 sm:mb-8">
          <div
            className={`border-2 border-dashed rounded-xl p-6 sm:p-10 text-center transition-all cursor-pointer ${
              isDragging
                ? "border-blue-400 bg-blue-900/30"
                : isUploading
                ? "border-blue-500 bg-blue-950"
                : isCompiling
                ? "border-purple-500 bg-purple-950"
                : "border-gray-700 bg-gray-900 hover:border-gray-500 hover:bg-gray-800"
            }`}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragEnter={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
            onDrop={async (e) => {
              e.preventDefault();
              setIsDragging(false);
              const file = e.dataTransfer.files?.[0];
              if (!file) return;
              const event = { target: { files: [file] } } as unknown as React.ChangeEvent<HTMLInputElement>;
              await uploadImage(event);
            }}
            onClick={() => document.getElementById("fileInput")?.click()}
          >
            {isUploading ? (
              <div className="flex flex-col items-center gap-3">
                <div className="w-8 h-8 sm:w-10 sm:h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
                <p className="text-blue-400 font-medium text-sm sm:text-base">Extracting text...</p>
              </div>
            ) : isCompiling ? (
              <div className="flex flex-col items-center gap-3">
                <div className="w-8 h-8 sm:w-10 sm:h-10 border-4 border-purple-500 border-t-transparent rounded-full animate-spin" />
                <p className="text-purple-400 font-medium text-sm sm:text-base">Compiling PDF...</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 sm:gap-3">
                <div className={`p-3 sm:p-4 rounded-full ${isDragging ? "bg-blue-800" : "bg-gray-800"}`}>
                  <Upload className={`w-6 h-6 sm:w-8 sm:h-8 ${isDragging ? "text-blue-400" : "text-gray-400"}`} />
                </div>
                <div>
                  <p className="text-gray-200 font-semibold text-base sm:text-lg">
                    {isDragging ? "Drop image here" : "Upload or drag & drop"}
                  </p>
                  <p className="text-gray-500 text-xs sm:text-sm mt-1">
                    JPEG, PNG, WEBP, BMP · Max 10MB
                  </p>
                </div>
                {fileName && (
                  <div className="flex items-center gap-1.5 text-gray-400 text-xs sm:text-sm">
                    <File className="w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0" />
                    <span className="truncate max-w-48 sm:max-w-full">{fileName}</span>
                  </div>
                )}
                 <div className="flex items-center gap-3 mt-2">
                  <button
                    onClick={(e) => { e.stopPropagation(); document.getElementById("fileInput")?.click(); }}
                    className="flex items-center gap-2 text-xs sm:text-sm px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg transition-colors"
                  >
                    <Upload className="w-4 h-4" />
                    Upload File
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); document.getElementById("cameraInput")?.click(); }}
                    className="flex items-center gap-2 text-xs sm:text-sm px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg transition-colors"
                  >
                    <Camera className="w-4 h-4" />
                    Take Photo
                  </button>
                </div>
              </div>
            )}
          </div>
          <input
            id="fileInput"
            type="file"
            accept="image/*"
            onChange={uploadImage}
            className="hidden"
          />
          <input
            id="cameraInput"
            type="file"
            accept="image/*"
            capture="environment"
            onChange={uploadImage}
            className="hidden"
          />
        </div>

        {/* Results */}
        {(pdfUrl || extractedText) && !isUploading && !isCompiling && (
          <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">

            {/* Tab Bar */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between border-b border-gray-800 px-2 sm:px-4">
              <div className="flex">
                <button
                  onClick={() => setActiveTab("preview")}
                  className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-5 py-3 text-xs sm:text-sm font-medium border-b-2 transition-colors ${
                    activeTab === "preview"
                      ? "border-blue-500 text-blue-400"
                      : "border-transparent text-gray-400 hover:text-gray-200"
                  }`}
                >
                  <FileText className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  PDF Preview
                </button>
                <button
                  onClick={() => setActiveTab("latex")}
                  className={`flex items-center gap-2 px-3 sm:px-5 py-3 text-xs sm:text-sm font-medium border-b-2 transition-colors ${
                    activeTab === "latex"
                      ? "border-blue-500 text-blue-400"
                      : "border-transparent text-gray-400 hover:text-gray-200"
                  }`}
                >
                  <Code2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  LaTeX Code
                  {compileWarnings.length > 0 && (
                    <span className="bg-yellow-700 text-yellow-200 text-xs px-1.5 sm:px-2 py-0.5 rounded-full">
                      {compileWarnings.length}
                    </span>
                  )}
                  {compileError.length > 0 && (
                    <span className="bg-red-700 text-red-200 text-xs px-1.5 sm:px-2 py-0.5 rounded-full">
                      {compileError.length}
                    </span>
                  )}
                </button>
              </div>

              {pdfUrl && (
                <div className="px-2 sm:px-0 pb-2 sm:pb-0">
                  <button
                    onClick={downloadPdf}
                    className="w-full sm:w-auto flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white text-xs sm:text-sm font-medium px-4 py-1.5 rounded-lg transition-colors"
                  >
                    <Download className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                    Download PDF
                  </button>
                </div>
              )}
            </div>

            {/* PDF Preview Tab */}
            {activeTab === "preview" && (
              <div className="p-2 sm:p-4">
                {pdfUrl ? (
                  <iframe
                    src={pdfUrl}
                    className="w-full rounded-lg border border-gray-700"
                    style={{ height: "calc(100vh - 300px)", minHeight: "400px" }}
                  />
                ) : (
                  <div className="h-64 sm:h-96 flex flex-col items-center justify-center text-gray-500 gap-3">
                    <XCircle className="w-10 h-10 sm:w-12 sm:h-12 text-red-500" />
                    <p className="text-sm sm:text-base text-center px-4">
                      Compilation failed — check the LaTeX Code tab
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* LaTeX Code Tab */}
            {activeTab === "latex" && (
              <div className="p-3 sm:p-4 flex flex-col gap-3 sm:gap-4">

                {/* Warnings */}
                {compileWarnings.length > 0 && (
                  <div className="bg-yellow-950 border border-yellow-700 rounded-lg p-3 sm:p-4">
                    <p className="flex items-center gap-2 text-yellow-400 font-semibold mb-2 sm:mb-3 text-sm sm:text-base">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      {compileWarnings.length} Warning{compileWarnings.length > 1 ? "s" : ""}
                    </p>
                    <div className="flex flex-col gap-2">
                      {compileWarnings.map((warn, i) => (
                        <div key={i} className="bg-yellow-900/40 border-l-4 border-yellow-500 rounded p-2 sm:p-3">
                          <p className="text-yellow-200 text-xs sm:text-sm font-medium">{warn.message}</p>
                          {warn.line && (
                            <p className="flex items-center gap-1 text-yellow-500 text-xs mt-1">
                              <MapPin className="w-3 h-3 shrink-0" />
                              Line {warn.line}
                              {warn.context && (
                                <code className="ml-1 text-yellow-300 truncate">{warn.context}</code>
                              )}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Errors */}
                {compileError.length > 0 && (
                  <div className="bg-red-950 border border-red-700 rounded-lg p-3 sm:p-4">
                    <p className="flex items-center gap-2 text-red-400 font-semibold mb-2 sm:mb-3 text-sm sm:text-base">
                      <XCircle className="w-4 h-4 shrink-0" />
                      {compileError.length} Error{compileError.length > 1 ? "s" : ""}
                    </p>
                    <div className="flex flex-col gap-2">
                      {compileError.map((err, i) => (
                        <div key={i} className="bg-red-900/40 border-l-4 border-red-500 rounded p-2 sm:p-3">
                          <p className="text-red-200 text-xs sm:text-sm font-medium">{err.message}</p>
                          {err.line && (
                            <p className="flex items-center gap-1 text-red-500 text-xs mt-1">
                              <MapPin className="w-3 h-3 shrink-0" />
                              Line {err.line}
                              {err.context && (
                                <code className="ml-1 text-red-300 truncate">{err.context}</code>
                              )}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Textarea */}
                <textarea
                  rows={15}
                  className={`w-full bg-gray-950 text-gray-100 font-mono text-xs sm:text-sm p-3 sm:p-4 rounded-lg border outline-none resize-y focus:ring-2 focus:ring-blue-500 transition-all ${
                    compileError.length > 0
                      ? "border-red-600"
                      : compileWarnings.length > 0
                      ? "border-yellow-600"
                      : "border-gray-700"
                  }`}
                  value={extractedText}
                  onChange={(e) => {
                    setExtractedText(e.target.value);
                    setCompileError([]);
                  }}
                  spellCheck={false}
                />

                {/* Recompile Button */}
                <button
                  onClick={() => compile(extractedText)}
                  className="w-full sm:w-auto self-start flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white font-medium px-6 py-2.5 rounded-lg transition-colors text-sm sm:text-base"
                >
                  <RefreshCw className="w-4 h-4" />
                  Recompile
                </button>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}