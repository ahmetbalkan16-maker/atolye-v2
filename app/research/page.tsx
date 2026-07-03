"use client";

import { useState } from "react";
import Sidebar from "@/components/Sidebar";

type ResearchData = {
  topic?: string;
  summary?: string;
  timeline?: unknown[];
  characters?: unknown[];
  controversies?: unknown[];
  documentaryFlow?: unknown[];
  sources?: unknown[];
};

function itemToText(item: unknown) {
  if (typeof item === "string") return item;

  if (typeof item === "object" && item !== null) {
    return Object.values(item).join(" - ");
  }

  return String(item);
}

export default function ResearchPage() {
  const [topic, setTopic] = useState("");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ResearchData | null>(null);
  const [error, setError] = useState("");
  const [savedFile, setSavedFile] = useState("");

  async function startResearch() {
    if (!topic.trim()) return;

    setLoading(true);
    setError("");
    setData(null);
    setSavedFile("");

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ topic }),
      });

      const result = await response.json();

      if (!result.success) {
        setError(result.error || "Araştırma başarısız.");
        setLoading(false);
        return;
      }

      setData(result.data);

      const saveResponse = await fetch("/api/save-project", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(result.data),
      });

      const saveResult = await saveResponse.json();

      if (!saveResponse.ok || !saveResult.success) {
        setError(saveResult.error || "Proje kaydedilemedi.");
      } else {
        setSavedFile(saveResult.file || "Proje kaydedildi.");
      }
    } catch (err) {
      console.error(err);
      setError("Sunucu hatası oluştu.");
    }

    setLoading(false);
  }

  return (
    <main className="flex min-h-screen bg-black text-white">
      <Sidebar />

      <section className="flex-1 p-10">
        <h1 className="text-5xl font-bold">AI Araştırma</h1>

        <p className="mt-3 text-zinc-400">
          Belgesel konunu yaz ve araştırmayı başlat.
        </p>

        <div className="mt-10 rounded-3xl border border-yellow-500/20 bg-zinc-900 p-6">
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="Örn: Attila'nın Roma Seferi"
            className="w-full rounded-xl bg-black p-4 outline-none"
          />

          <button
            onClick={startResearch}
            className="mt-5 w-full rounded-xl bg-yellow-500 py-4 font-bold text-black"
          >
            AI Araştırmasını Başlat
          </button>
        </div>

        {loading && (
          <div className="mt-8 rounded-xl bg-zinc-900 p-6 text-yellow-400">
            Araştırılıyor...
          </div>
        )}

        {error && (
          <div className="mt-8 rounded-xl border border-red-500/30 bg-red-950/30 p-6 text-red-300">
            {error}
          </div>
        )}

        {savedFile && (
          <div className="mt-8 rounded-xl border border-green-500/30 bg-green-950/30 p-6 text-green-300">
            Proje kaydedildi: {savedFile}
          </div>
        )}

        {data && (
          <div className="mt-8 grid gap-6">
            <ResearchCard title="📚 Konu" content={data.topic || topic} />
            <ResearchCard title="📝 Özet" content={data.summary || ""} />
            <ResearchList title="📅 Kronoloji" items={data.timeline || []} />
            <ResearchList title="👑 Karakterler" items={data.characters || []} />
            <ResearchList
              title="⚔️ Tartışmalı Noktalar"
              items={data.controversies || []}
            />
            <ResearchList
              title="🎬 Belgesel Akışı"
              items={data.documentaryFlow || []}
            />
            <ResearchList title="📖 Kaynaklar" items={data.sources || []} />
          </div>
        )}
      </section>
    </main>
  );
}

function ResearchCard({
  title,
  content,
}: {
  title: string;
  content: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-zinc-900 p-6">
      <h2 className="text-xl font-bold text-yellow-400">{title}</h2>
      <p className="mt-3 text-zinc-300">{content}</p>
    </div>
  );
}

function ResearchList({
  title,
  items,
}: {
  title: string;
  items: unknown[];
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-zinc-900 p-6">
      <h2 className="text-xl font-bold text-yellow-400">{title}</h2>

      <ul className="mt-3 space-y-2 text-zinc-300">
        {items.map((item, index) => (
          <li key={index}>• {itemToText(item)}</li>
        ))}
      </ul>
    </div>
  );
}