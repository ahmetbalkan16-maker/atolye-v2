"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Dashboard from "@/components/Dashboard";
import Sidebar from "@/components/Sidebar";
import TopicInput from "@/components/TopicInput";
import {
  resolvePipelineStartOutcome,
  type PipelineStartResponseBody,
} from "@/lib/pipeline/pipelineStartOutcome";

export default function HomeClient() {
  const router = useRouter();
  const [topic, setTopic] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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

      const data = (await res.json()) as PipelineStartResponseBody;

      // The route attaches `projectUrl` whenever a project exists the user can
      // act on — full success, a `stopReason` stop, or a mid-pipeline failure
      // that still created the project. In all of those, send the user to the
      // project page (progress + resume/retry). Only a response with no usable
      // project reference stays here as an inline error.
      const outcome = resolvePipelineStartOutcome(data);
      if (outcome.kind === "navigate") {
        router.push(outcome.to);
        return;
      }
      setError(outcome.message);
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
            Üretim isteğinin sunucu yanıtı bekleniyor…
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
