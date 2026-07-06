"use client";

import { useState } from "react";
import Sidebar from "@/components/Sidebar";
import Dashboard from "@/components/Dashboard";
import TopicInput from "@/components/TopicInput";

export default function HomePage() {
  const [topic, setTopic] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState("");

  const startResearch = async () => {
    setLoading(true);

    const res = await fetch("/api/research", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ topic }),
    });

    const data = await res.json();

    setResult(data.result);
    setLoading(false);
  };

  return (
    <main className="flex min-h-screen bg-black">
      <Sidebar />

      <div className="flex-1 p-6">
        <Dashboard projects={[]} />

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

        {result && (
          <pre className="mt-6 text-white whitespace-pre-wrap">
            {result}
          </pre>
        )}
      </div>
    </main>
  );
}