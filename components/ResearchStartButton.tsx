"use client";

import { useState } from "react";

export default function ResearchStartButton({ slug }: { slug: string }) {
  const [loading, setLoading] = useState(false);

  async function startResearch() {
    setLoading(true);

    const response = await fetch(`/api/projects/${slug}/research`, {
      method: "POST",
    });

    const result = await response.json();

    alert(result.message || "İşlem tamamlandı.");
    setLoading(false);

    window.location.href = `/project/${slug}`;
  }

  return (
    <button
      onClick={startResearch}
      disabled={loading}
      className="mt-8 rounded-xl bg-yellow-500 px-6 py-3 font-bold text-black disabled:opacity-50"
    >
      {loading ? "Araştırılıyor..." : "Araştırmayı Başlat"}
    </button>
  );
}