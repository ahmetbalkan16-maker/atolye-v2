"use client";

import { useState } from "react";
import DashboardLayout from "@/components/dashboard/DashboardLayout";
import type { ResearchData } from "@/types/research";

export default function ResearchPage() {
  const [topic, setTopic] = useState("");
  const [loading, setLoading] = useState(false);
  const [research, setResearch] = useState<ResearchData | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const startResearch = async () => {
    if (!topic.trim()) {
      setError("Lütfen bir konu yaz.");
      return;
    }

    setLoading(true);
    setResearch(null);
    setMessage("");
    setError("");

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
        setError(data.error || "Araştırma sırasında hata oluştu.");
        return;
      }

      setMessage(data.message || "Araştırma tamamlandı ve proje kaydedildi.");
      setResearch(data.research);
    } catch (error) {
      console.error("Research page error:", error);
      setError("Sunucuya bağlanırken hata oluştu.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="max-w-6xl">
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

          {message && <p className="mt-4 text-sm text-green-400">{message}</p>}

          {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
        </div>

        {research && (
          <div className="mt-8 grid gap-6">
            <ResearchCard title="📌 Kısa Özet" content={research.summary} />
            <ResearchCard
              title="🏛️ Tarihsel Arka Plan"
              content={research.historicalContext}
            />

            <ResearchList title="🕰️ Kronoloji" items={research.timeline} />
            <ResearchList title="👤 Önemli Kişiler" items={research.characters} />
            <ResearchList title="📍 Mekânlar" items={research.locations} />
            <ResearchList title="⚔️ Önemli Olaylar" items={research.keyEvents} />
            <ResearchList title="🧠 Stratejiler" items={research.strategies} />
            <ResearchList
              title="⚖️ Tartışmalı Noktalar"
              items={research.controversies}
            />
            <ResearchList
              title="🔥 İlginç Bilgiler"
              items={research.interestingFacts}
            />
            <ResearchList
              title="🎬 Belgesel Akışı"
              items={research.documentaryFlow}
            />
            <ResearchList
              title="🎥 Sahne Fikirleri"
              items={research.sceneIdeas}
            />
            <ResearchList
              title="🖼️ Görsel Promptları"
              items={research.imagePrompts}
            />
            <ResearchList
              title="🎞️ Animasyon Promptları"
              items={research.animationPrompts}
            />
            <ResearchList
              title="🎵 Müzik Fikirleri"
              items={research.musicIdeas}
            />
            <ResearchList
              title="🔊 Ses Efektleri"
              items={research.soundEffects}
            />
            <ResearchList
              title="🧲 Thumbnail Fikirleri"
              items={research.thumbnailIdeas}
            />
            <ResearchList
              title="📺 YouTube Başlıkları"
              items={research.youtubeTitles}
            />
            <ResearchList title="📚 Kaynaklar" items={research.sources} />
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

function ResearchCard({
  title,
  content,
}: {
  title: string;
  content?: string;
}) {
  if (!content) return null;

  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
      <h3 className="text-xl font-semibold text-yellow-400">{title}</h3>
      <p className="mt-3 whitespace-pre-line leading-7 text-neutral-200">
        {content}
      </p>
    </div>
  );
}

function ResearchList({
  title,
  items,
}: {
  title: string;
  items?: string[];
}) {
  if (!items || items.length === 0) return null;

  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
      <h3 className="text-xl font-semibold text-yellow-400">{title}</h3>

      <ul className="mt-4 space-y-3 text-neutral-200">
        {items.map((item, index) => (
          <li key={index} className="leading-7">
            <span className="mr-2 text-yellow-400">{index + 1}.</span>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
