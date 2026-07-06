"use client";

import { useState } from "react";
import DashboardLayout from "@/components/dashboard/DashboardLayout";

export default function ResearchPage() {
  const [topic, setTopic] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState("");
  const [message, setMessage] = useState("");

  const startResearch = async () => {
    if (!topic.trim()) {
      setMessage("Lütfen bir konu yaz.");
      return;
    }

    setLoading(true);
    setResult("");
    setMessage("");

    try {
      const res = await fetch("/api/research", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ topic: topic.trim() }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setMessage(data.error || "Araştırma sırasında hata oluştu.");
        return;
      }

      setMessage(data.message || "Araştırma tamamlandı.");
      setResult(data.project?.research || "Araştırma sonucu bulunamadı.");
    } catch (error) {
      console.error("Research page error:", error);
      setMessage("Sunucuya bağlanırken hata oluştu.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="max-w-5xl">
        <div>
          <p className="text-sm font-medium text-yellow-400">Research Engine</p>
          <h2 className="mt-2 text-3xl font-bold text-white">
            Araştırma Motoru
          </h2>
          <p className="mt-2 text-neutral-400">
            Tarih belgeseli için kapsamlı araştırma üret ve projeye kaydet.
          </p>
        </div>

        <div className="mt-8 rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
          <label className="text-sm text-neutral-300">Konu</label>

          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="Örn: Hunların Doğuşu"
            className="mt-3 w-full rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-3 text-white outline-none focus:border-yellow-400"
          />

          <button
            onClick={startResearch}
            disabled={loading}
            className="mt-5 rounded-xl bg-yellow-400 px-5 py-3 font-medium text-black disabled:cursor-not-allowed disabled:bg-neutral-600"
          >
            {loading ? "Araştırılıyor..." : "Araştırmayı Başlat"}
          </button>

          {message && (
            <p className="mt-4 text-sm text-green-400">
              {message}
            </p>
          )}
        </div>

        {result && (
          <div className="mt-8 rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-xl font-semibold text-white">
                Araştırma Sonucu
              </h3>

              <span className="rounded-full bg-green-500/10 px-3 py-1 text-xs text-green-400">
                Kaydedildi
              </span>
            </div>

            <pre className="whitespace-pre-wrap text-sm leading-7 text-neutral-200">
              {result}
            </pre>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}