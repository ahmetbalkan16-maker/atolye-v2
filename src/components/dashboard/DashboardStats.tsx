"use client";

import { useEffect, useState } from "react";

type Project = {
  id: string;
  status: string;
};

export default function DashboardStats() {
  const [projects, setProjects] = useState<Project[]>([]);

  useEffect(() => {
    async function loadProjects() {
      const res = await fetch("/api/projects");
      const data = await res.json();

      if (data.success) {
        setProjects(data.projects);
      }
    }

    loadProjects();
  }, []);

  const total = projects.length;
  const research = projects.filter((p) => p.status === "research").length;
  const script = projects.filter((p) => p.status === "script").length;
  const completed = projects.filter(
    (p) => p.status === "completed" || p.status === "finished",
  ).length;

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-4">
      <div className="rounded-xl bg-white p-6 shadow">
        <p className="text-sm text-gray-500">Toplam Proje</p>
        <h2 className="mt-2 text-3xl font-bold">{total}</h2>
      </div>

      <div className="rounded-xl bg-white p-6 shadow">
        <p className="text-sm text-gray-500">Research</p>
        <h2 className="mt-2 text-3xl font-bold text-blue-600">{research}</h2>
      </div>

      <div className="rounded-xl bg-white p-6 shadow">
        <p className="text-sm text-gray-500">Script</p>
        <h2 className="mt-2 text-3xl font-bold text-yellow-600">{script}</h2>
      </div>

      <div className="rounded-xl bg-white p-6 shadow">
        <p className="text-sm text-gray-500">Tamamlanan</p>
        <h2 className="mt-2 text-3xl font-bold text-green-600">{completed}</h2>
      </div>
    </div>
  );
}
