"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Dashboard from "@/components/Dashboard";
import Sidebar from "@/components/Sidebar";
import TopicInput from "@/components/TopicInput";

const loadingMessages = [
  "Araştırma yapılıyor...",
  "Senaryo hazırlanıyor...",
  "Sahneler oluşturuluyor...",
  "Görsel plan hazırlanıyor...",
];

type PipelineResponse = {
  success?: boolean;
  slug?: string;
  projectUrl?: string;
  error?: string;
};

export default function HomeClient() {
  const router = useRouter();
  const [topic, setTopic] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!loading) {
      setLoadingStep(0);
      return;
    }

    const interval = window.setInterval(() => {
      setLoadingStep((step) =>
        step >= loadingMessages.length - 1 ? step : step + 1,
      );
    }, 3500);

    return () => window.clearInterval(interval);
  }, [loading]);

  const startPipeline = async () => {
    if (!topic.trim() || loading) return;

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/pipeline", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ topic }),
      });

      const data = (await res.json()) as PipelineResponse;

      if (!res.ok || !data.success || !data.projectUrl) {
        setError(data.error || "Üretim akışı tamamlanamadı.");
        return;
      }

      router.push(data.projectUrl);
    } catch (err) {
      console.error("[HomeClient] Pipeline request failed:", err);
      setError("Sunucuya bağlanırken hata oluştu.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen bg-black text-white">
      <Sidebar />

      <div className="flex-1 p-6">
        <Dashboard />

        <TopicInput
          topic={topic}
          setTopic={setTopic}
          onStart={startPipeline}
          loading={loading}
        />

        {loading && (
          <p className="mt-6 text-yellow-400">
            {loadingMessages[loadingStep]}
          </p>
        )}

        {error && (
          <div className="mt-6 rounded-xl border border-red-500/30 bg-red-950/30 p-4 text-red-300">
            {error}
          </div>
        )}
      </div>
    </main>
  );
}
