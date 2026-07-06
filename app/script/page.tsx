"use client";

import { useState } from "react";
import Sidebar from "@/components/Sidebar";
import { ScriptData } from "@/types/script";


export default function ScriptPage() {
  const [topic, setTopic] = useState("");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ScriptData | null>(null);
  const [error, setError] = useState("");

  async function generateScript() {
    if (!topic.trim() || loading) return;

    setLoading(true);
    setError("");
    setData(null);

    try {
      const response = await fetch("/api/script", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ topic }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        setError(result.error || "Senaryo üretilemedi.");
        return;
      }

      setData(result.script);
    } catch (err) {
      console.error(err);
      setError("Senaryo oluşturulurken beklenmeyen bir hata oluştu.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen bg-black text-white">
      <Sidebar />

      <section className="flex-1 p-10">
        <div className="max-w-6xl">
          <p className="text-sm font-bold tracking-[0.4em] text-yellow-400">
            SENARYO MOTORU
          </p>

          <h1 className="mt-4 text-5xl font-bold">AI Belgesel Senaryosu</h1>

          <p className="mt-4 max-w-3xl text-zinc-400">
            Bir konu yaz. Atölye bunu güçlü bir YouTube belgesel senaryosuna
            dönüştürsün.
          </p>

          <div className="mt-10 rounded-3xl border border-yellow-500/20 bg-zinc-900/80 p-6">
            <label className="text-sm font-semibold text-zinc-300">
              Belgesel Konusu
            </label>

            <input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="Örn: Atilla'nın yükselişi"
              className="mt-3 w-full rounded-xl border border-white/10 bg-black p-4 text-white outline-none transition focus:border-yellow-500"
            />

            <button
              onClick={generateScript}
              disabled={loading}
              className="mt-5 w-full rounded-xl bg-yellow-500 py-4 font-bold text-black transition hover:bg-yellow-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "Senaryo Yazılıyor..." : "Senaryoyu Oluştur"}
            </button>
          </div>

          {error && (
            <div className="mt-8 rounded-xl border border-red-500/30 bg-red-950/30 p-6 text-red-300">
              {error}
            </div>
          )}

          {data && (
            <div className="mt-8 grid gap-6">
              <ScriptCard title="🎬 Başlık" content={data.title} />
              <ScriptCard title="📌 Alt Başlık" content={data.subtitle} />
              <ScriptCard title="⚡ Hook" content={data.hook} />
              <ScriptCard title="🎙️ Giriş" content={data.introduction} />

              {data.chapters?.map((chapter) => (
                <div
                  key={chapter.id}
                  className="rounded-2xl border border-white/10 bg-zinc-900 p-6"
                >
                  <h2 className="text-xl font-bold text-yellow-400">
                    Bölüm {chapter.id}: {chapter.title}
                  </h2>

                  <p className="mt-3 whitespace-pre-line leading-7 text-zinc-300">
                    {chapter.narration}
                  </p>

                  <div className="mt-5 grid gap-3 text-sm text-zinc-400 md:grid-cols-2">
                    <p>
                      <span className="text-zinc-200">Süre:</span>{" "}
                      {chapter.duration} sn
                    </p>
                    <p>
                      <span className="text-zinc-200">Duygu:</span>{" "}
                      {chapter.emotion}
                    </p>
                    <p>
                      <span className="text-zinc-200">Görsel Hedef:</span>{" "}
                      {chapter.visualGoal}
                    </p>
                    <p>
                      <span className="text-zinc-200">Geçiş:</span>{" "}
                      {chapter.transition}
                    </p>
                  </div>
                </div>
              ))}

              <ScriptCard title="🏁 Sonuç" content={data.conclusion} />
              <ScriptCard title="📣 Çağrı" content={data.callToAction} />
              <ScriptCard title="🎧 Ses Tarzı" content={data.voiceStyle} />
              <ScriptCard title="🎵 Müzik Tarzı" content={data.musicStyle} />
              <ScriptCard title="🖼️ Thumbnail Fikri" content={data.thumbnailIdea} />
              <ScriptCard
                title="🔎 SEO Anahtar Kelimeleri"
                content={data.seoKeywords?.join(", ")}
              />
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

function ScriptCard({
  title,
  content,
}: {
  title: string;
  content?: string;
}) {
  if (!content) return null;

  return (
    <div className="rounded-2xl border border-white/10 bg-zinc-900 p-6">
      <h2 className="text-xl font-bold text-yellow-400">{title}</h2>
      <p className="mt-3 whitespace-pre-line leading-7 text-zinc-300">
        {content}
      </p>
    </div>
  );
}