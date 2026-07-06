"use client";

import { useState } from "react";

export default function ResearchPage() {
  const [topic, setTopic] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState("");

  const startResearch = async () => {
    if (!topic) return;

    setLoading(true);
    setResult("");

    try {
      const res = await fetch("/api/research", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ topic }),
      });

      const data = await res.json();

      console.log("API RESPONSE:", data);

      setResult(data.result || "Sonuç yok");
    } catch (err) {
      console.log(err);
      setResult("Hata oluştu");
    }

    setLoading(false);
  };

  return (
    <div style={{ padding: 40 }}>

      <h1>Araştırma Motoru</h1>

      <input
        value={topic}
        onChange={(e) => setTopic(e.target.value)}
        placeholder="Konu yaz..."
        style={{
          padding: 10,
          border: "1px solid black",
          width: 300,
          marginTop: 20,
        }}
      />

      <br />

      <button
        onClick={startResearch}
        disabled={loading}
        style={{
          marginTop: 20,
          padding: 10,
          background: "gold",
          border: "none",
          cursor: "pointer",
        }}
      >
        {loading ? "Araştırılıyor..." : "Araştırmayı Başlat"}
      </button>

      {result && (
        <pre style={{ marginTop: 20, background: "#111", color: "white", padding: 20 }}>
          {result}
        </pre>
      )}

    </div>
  );
}