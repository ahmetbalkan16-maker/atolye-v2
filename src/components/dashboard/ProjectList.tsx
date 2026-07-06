"use client";

import { useEffect, useState } from "react";

type Project = {
  id: string;
  slug: string;
  title: string;
  status: string;
  updatedAt: string;
};

export default function ProjectList() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadProjects() {
      try {
        const res = await fetch("/api/projects");
        const data = await res.json();

        if (data.success) {
          setProjects(data.projects);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }

    loadProjects();
  }, []);

  if (loading) {
    return (
      <div className="text-gray-500">
        Projeler yükleniyor...
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="text-gray-500">
        Henüz proje bulunmuyor.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {projects.map((project) => (
        <div
          key={project.id}
          className="rounded-xl border p-4 shadow-sm"
        >
          <h2 className="text-lg font-bold">
            {project.title}
          </h2>

          <p className="text-sm text-gray-500">
            Durum: {project.status}
          </p>

          <p className="text-sm text-gray-500">
            Son Güncelleme:
            {" "}
            {new Date(project.updatedAt).toLocaleString("tr-TR")}
          </p>
        </div>
      ))}
    </div>
  );
}