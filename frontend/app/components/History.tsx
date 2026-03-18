"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Clock, Trash2, RotateCcw } from "lucide-react";

interface Conversion {
  id: string;
  latex_code: string;
  pdf_url: string | null;
  created_at: string;
}

interface HistoryProps {
  user: any;
  onRestore: (latex: string) => void;
}

export default function History({ user, onRestore }: HistoryProps) {
  const [conversions, setConversions] = useState<Conversion[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user && isOpen) fetchHistory();
  }, [user, isOpen]);

  async function fetchHistory() {
    setLoading(true);
    const { data, error } = await supabase
      .from("conversions")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(20);

    if (!error && data) setConversions(data);
    setLoading(false);
  }

  async function deleteConversion(id: string) {
    await supabase.from("conversions").delete().eq("id", id);
    setConversions((prev) => prev.filter((c) => c.id !== id));
  }

  if (!user) return null;

  return (
    <div className="mb-4 sm:mb-6">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 text-sm text-gray-400 hover:text-gray-200 transition-colors"
      >
        <Clock className="w-4 h-4" />
        {isOpen ? "Hide History" : "Show History"}
      </button>

      {isOpen && (
        <div className="mt-3 bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-800">
            <h3 className="text-sm font-semibold text-gray-200">
              Recent Conversions
            </h3>
          </div>

          {loading ? (
            <div className="p-6 text-center text-gray-500 text-sm">
              Loading...
            </div>
          ) : conversions.length === 0 ? (
            <div className="p-6 text-center text-gray-500 text-sm">
              No conversions yet
            </div>
          ) : (
            <div className="divide-y divide-gray-800">
              {conversions.map((conv) => (
                <div
                  key={conv.id}
                  className="flex items-center justify-between px-4 py-3 hover:bg-gray-800 transition-colors"
                >
                  <div className="flex-1 min-w-0 mr-4">
                    <p className="text-xs text-gray-300 font-mono truncate">
                      {conv.latex_code.slice(0, 60)}...
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {new Date(conv.created_at).toLocaleDateString()} at{" "}
                      {new Date(conv.created_at).toLocaleTimeString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => onRestore(conv.latex_code)}
                      className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span className="hidden sm:block">Restore</span>
                    </button>
                    <button
                      onClick={() => deleteConversion(conv.id)}
                      className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span className="hidden sm:block">Delete</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}