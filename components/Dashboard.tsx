"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Project } from "@/types/project";

export default function Dashboard() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function loadProjects() {
    try {
      const res = await fetch("/api/projects");
      const data = await res.json();

      if (data.success) {
        setProjects(data.projects);
      }
    } catch (err) {
      console.error(err);
    }
  }

  async function createProject() {
    if (!title.trim()) return;

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/projects/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title,
          description,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setError(data.error || "Proje oluşturulamadı.");
        return;
      }

      setTitle("");
      setDescription("");

      await loadProjects();
    } catch (err) {
      console.error(err);
      setError("Sunucu hatası oluştu.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadProjects();
  }, []);

  return (
    <section className="flex-1 p-8 text-white">
      <div className="rounded-3xl border border-white/10 bg-white/5 p-8">

        <p className="text-sm uppercase tracking-[0.3em] text-yellow-500">
          Kontrol Paneli
        </p>

        <h1 className="mt-3 text-5xl font-bold">
          Projeler
        </h1>

        <p className="mt-4 text-zinc-400">
          Yeni belgesel projesi oluştur ve tüm üretim sürecini buradan yönet.
        </p>

        <div className="mt-8 rounded-3xl border border-yellow-500/20 bg-black/30 p-6">

          <h2 className="text-2xl font-bold text-yellow-400">
            ➕ Yeni Proje
          </h2>

          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Örn: Hunların Doğuşu: Attila'ya Giden Yol"
            className="mt-6 w-full rounded-xl border border-white/10 bg-black p-4 outline-none focus:border-yellow-500"
          />

          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Kısa açıklama..."
            className="mt-4 h-36 w-full rounded-xl border border-white/10 bg-black p-4 outline-none focus:border-yellow-500"
          />

          {error && (
            <p className="mt-4 text-red-400">
              {error}
            </p>
          )}

          <button
            onClick={createProject}
            disabled={loading}
            className="mt-6 w-full rounded-xl bg-yellow-500 py-4 font-bold text-black transition hover:bg-yellow-400 disabled:opacity-50"
          >
            {loading ? "Oluşturuluyor..." : "Proje Oluştur"}
          </button>

        </div>

        <div className="mt-8 grid gap-4">

          {projects.length === 0 && (
            <div className="rounded-2xl border border-white/10 bg-black/30 p-6 text-zinc-400">
              Henüz kayıtlı proje yok.
            </div>
          )}

          {projects.map((project) => (
            <div
              key={project.id}
              className="rounded-2xl border border-white/10 bg-black/30 p-6"
            >
              <h3 className="text-2xl font-bold text-yellow-400">
                {project.title}
              </h3>

              {project.description && (
                <p className="mt-3 text-zinc-400">
                  {project.description}
                </p>
              )}

              <div className="mt-5 flex items-center justify-between">

                <span className="rounded-full bg-yellow-500/20 px-3 py-1 text-sm text-yellow-400">
                  {project.status}
                </span>

                <Link
                  href={`/project/${project.slug}`}
                  className="rounded-xl bg-yellow-500 px-5 py-3 font-bold text-black"
                >
                  Aç
                </Link>

              </div>
            </div>
          ))}

        </div>

      </div>
    </section>
  );
}