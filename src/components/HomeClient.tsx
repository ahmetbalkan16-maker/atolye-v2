"use client";

import { useState } from "react";
import Sidebar from "@/components/Sidebar";
import Dashboard from "@/components/Dashboard";
import TopicInput from "@/components/TopicInput";

export default function HomeClient() {
  const [topic, setTopic] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<unknown | null>(null);

  const startResearch = async () => {
    if (!topic.trim()) return;

    setLoading(true);
    setResult(null);

    try {
      const res = await fetch("/api/research", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ topic }),
      });

      const data = await res.json();

      if (!res.ok) {
        setResult({ error: data.error });
        return;
      }

      setResult(data);
    } catch {
      setResult({ error: "Server error" });
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
          onStart={startResearch}
        />

        {loading && (
          <p className="text-yellow-400 mt-6">
            Araştırılıyor...
          </p>
        )}

        {result !== null && (
          <pre className="mt-6 whitespace-pre-wrap text-white">
            {String(JSON.stringify(result, null, 2))}
          </pre>
        )}
      </div>
    </main>
  );
}
