"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import ProjectProgressCard from "@/components/projects/ProjectProgressCard";
import type { ProductionStepKey } from "@/types/project";

type Project = {
  id: string;
  slug: string;
  title: string;
  status: string;
  updatedAt: string;
  progress: ProjectProgressSummary | null;
};

type ProjectProgressSummary = {
  currentStage: ProjectProgressStageSummary | null;
  nextStage: ProjectProgressStageSummary | null;
  completionPercentage: number;
  completedStagesCount: number;
  totalStagesCount: number;
  completedCount?: number;
  totalStages?: number;
  statusDescription?: string;
  nextTaskSuggestion?: string;
};

type ProjectProgressStageSummary = {
  key: ProductionStepKey;
  label: string;
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
      } catch (error) {
        console.error("Project loading error:", error);
      } finally {
        setLoading(false);
      }
    }

    loadProjects();
  }, []);

  if (loading) {
    return (
      <div className="text-gray-600">
        Projeler yükleniyor...
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="text-gray-600">
        Henüz proje bulunmuyor.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {projects.map((project) => (
        <Link
          key={project.id}
          href={`/project/${project.slug}`}
          className="
            block
            rounded-xl 
            border 
            border-gray-200 
            bg-white 
            p-5 
            shadow-sm
            transition
            hover:border-yellow-400
            hover:shadow-md
          "
        >
          <h2 className="mb-2 text-lg font-bold text-black">
            {project.title}
          </h2>

          <p className="text-sm text-gray-700">
            Durum:
            {" "}
            <span className="font-medium">
              {project.status}
            </span>
          </p>

          <p className="mt-1 text-sm text-gray-600">
            Son Güncelleme:
            {" "}
            {new Date(project.updatedAt).toLocaleString("tr-TR")}
          </p>

          {project.progress ? (
            <ProjectProgressCard
              currentStage={project.progress.currentStage}
              nextStage={project.progress.nextStage}
              completionPercentage={project.progress.completionPercentage}
              completedStagesCount={project.progress.completedStagesCount}
              totalStagesCount={project.progress.totalStagesCount}
              completedCount={project.progress.completedCount}
              totalStages={project.progress.totalStages}
              statusDescription={project.progress.statusDescription}
              nextTaskSuggestion={project.progress.nextTaskSuggestion}
            />
          ) : null}
        </Link>
      ))}
    </div>
  );
}
