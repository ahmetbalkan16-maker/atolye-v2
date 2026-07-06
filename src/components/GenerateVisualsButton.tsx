"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  projectId: string;
  slug: string;
  scenes: unknown;
};

export default function GenerateVisualsButton({ projectId, slug, scenes }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const generateVisuals = async () => {
    try {
      setLoading(true);

      const res = await fetch("/api/visuals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, slug, scenes }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || "Görsel promptları oluşturulamadı.");
      }

      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Bir hata oluştu.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={generateVisuals}
      disabled={loading}
      className="mt-4 rounded-xl bg-yellow-500 px-5 py-3 font-bold text-black hover:bg-yellow-400 disabled:bg-zinc-700 disabled:text-zinc-400"
    >
      {loading ? "Oluşturuluyor..." : "Görsel Promptlarını Oluştur"}
    </button>
  );
}
