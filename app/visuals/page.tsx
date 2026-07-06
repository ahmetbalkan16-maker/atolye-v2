"use client";

import { useState } from "react";
import { StudioCard, StudioLayout } from "@/components/studio";

export default function VisualsPage() {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [style, setStyle] = useState("cinematic");
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);

  async function generatePrompt() {
    setLoading(true);

    try {
      const res = await fetch("/api/visuals", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          style,
          scenes: [
            {
              id: "1",
              title,
              description,
            },
          ],
        }),
      });

      const data = await res.json();

      if (data.success && data.prompts?.length > 0) {
        setPrompt(data.prompts[0].prompt);
      } else {
        setPrompt("Prompt oluşturulamadı.");
      }
    } catch (err) {
      console.error(err);
      setPrompt("Bir hata oluştu.");
    }

    setLoading(false);
  }

  return (
    <StudioLayout
      title="Visual Studio"
      subtitle="AI destekli sinematik görsel prompt üretimi"
    >
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <StudioCard title="Sahne Bilgileri">
          <div className="space-y-5">
            <input
              className="w-full rounded-xl border border-zinc-700 bg-zinc-950 p-3 text-white outline-none placeholder:text-zinc-500"
              placeholder="Sahne Başlığı"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />

            <textarea
              className="h-40 w-full rounded-xl border border-zinc-700 bg-zinc-950 p-3 text-white outline-none placeholder:text-zinc-500"
              placeholder="Sahne Açıklaması"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />

            <select
              className="w-full rounded-xl border border-zinc-700 bg-zinc-950 p-3 text-white outline-none"
              value={style}
              onChange={(e) => setStyle(e.target.value)}
            >
              <option value="cinematic">Cinematic</option>
              <option value="documentary">Documentary</option>
              <option value="realistic">Realistic</option>
              <option value="epic">Epic</option>
              <option value="dark">Dark</option>
              <option value="ancient">Ancient</option>
            </select>

            <button
              onClick={generatePrompt}
              disabled={loading}
              className="rounded-xl bg-blue-600 px-6 py-3 font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {loading ? "Oluşturuluyor..." : "Prompt Oluştur"}
            </button>
          </div>
        </StudioCard>

        <StudioCard title="Oluşan Prompt">
          <textarea
            className="h-96 w-full rounded-xl border border-zinc-700 bg-zinc-950 p-4 text-sm text-zinc-200 outline-none"
            value={prompt}
            readOnly
            placeholder="Prompt burada görünecek..."
          />
        </StudioCard>
      </div>
    </StudioLayout>
  );
}