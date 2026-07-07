import Link from "next/link";
import { notFound } from "next/navigation";
import { ProjectManager } from "@/lib/projects/ProjectManager";
import {
  ProjectActions,
  ProjectProgress,
  ProjectStatusCards,
  StudioCard,
  StudioLayout,
} from "@/components/studio";
import {
  calculateProductionProgress,
  createProductionSteps,
} from "@/lib/projects/projectProgress";
import type { Project } from "@/types/project";
import type { ResearchData } from "@/types/research";
import type { SceneData } from "@/types/scene";
import type { ScriptData } from "@/types/script";
import type { VisualData } from "@/types/visual";

type ProjectStudioPageProps = {
  params: Promise<{
    slug: string;
  }>;
};

export default async function ProjectStudioPage({
  params,
}: ProjectStudioPageProps) {
  const { slug } = await params;

  const [project, research, script, scenes, visuals] = await Promise.all([
    ProjectManager.getProject(slug) as Promise<Project | null>,
    ProjectManager.getResearch(slug) as Promise<ResearchData | null>,
    ProjectManager.getScript(slug) as Promise<ScriptData | null>,
    ProjectManager.getScenes(slug) as Promise<SceneData | null>,
    ProjectManager.getVisuals(slug) as Promise<VisualData | null>,
  ]);

  if (!project) {
    notFound();
  }

  const progressInput = {
    research: Boolean(research),
    script: Boolean(script),
    scenes: Boolean(scenes),
    visuals: Boolean(visuals),
  };
  const progress = calculateProductionProgress(progressInput);
  const productionSteps = createProductionSteps(progressInput, project.updatedAt);

  return (
    <StudioLayout
      title="Proje Stüdyosu"
      subtitle="Üretilen araştırma, senaryo, sahne ve görsel planlarını tek ekranda incele."
    >
      <div className="space-y-6">
        <Link
          href="/"
          className="inline-flex text-sm font-medium text-yellow-400 hover:text-yellow-300"
        >
          Projelere dön
        </Link>

        <StudioCard title="Proje Başlığı">
          <div className="grid gap-4 text-sm text-zinc-300 md:grid-cols-2">
            <Info label="Başlık" value={project.title} />
            <Info label="Durum" value={project.status} />
            <Info
              label="Oluşturulma Tarihi"
              value={formatDate(project.createdAt)}
            />
            <Info
              label="Güncellenme Tarihi"
              value={formatDate(project.updatedAt)}
            />
            <div className="md:col-span-2">
              <Info
                label="Açıklama"
                value={project.description ?? "Açıklama eklenmemiş."}
              />
            </div>
          </div>
        </StudioCard>

        <StudioCard title="Üretim Kontrol Merkezi">
          <div className="space-y-6">
            <ProjectProgress progress={progress} />
            <ProjectStatusCards steps={productionSteps} />
            <ProjectActions slug={slug} />
          </div>
        </StudioCard>

        <ResearchPanel research={research} />
        <ScriptPanel script={script} />
        <ScenePanel scenes={scenes} />
        <VisualPanel visuals={visuals} />
      </div>
    </StudioLayout>
  );
}

function ResearchPanel({ research }: { research: ResearchData | null }) {
  return (
    <StudioCard title="Araştırma Paneli">
      {!research ? (
        <EmptyState text="Araştırma verisi henüz üretilmedi." />
      ) : (
        <div className="space-y-6">
          <TextBlock title="Kısa Özet" text={research.summary} />
          <TextBlock title="Tarihsel Arka Plan" text={research.historicalContext} />
          <ListBlock title="Kronoloji" items={research.timeline} />
          <ListBlock title="Karakterler" items={research.characters} />
          <ListBlock title="Önemli Olaylar" items={research.keyEvents} />
        </div>
      )}
    </StudioCard>
  );
}

function ScriptPanel({ script }: { script: ScriptData | null }) {
  return (
    <StudioCard title="Senaryo Paneli">
      {!script ? (
        <EmptyState text="Senaryo verisi henüz üretilmedi." />
      ) : (
        <div className="space-y-5">
          <TextBlock title="Başlık" text={script.title} />
          <TextBlock title="Giriş" text={script.introduction} />

          <div className="space-y-4">
            {script.chapters.map((chapter) => (
              <div
                key={chapter.id}
                className="rounded-xl border border-zinc-800 bg-zinc-950 p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="font-semibold text-yellow-400">
                    Bölüm {chapter.id}: {chapter.title}
                  </h3>
                  <span className="text-sm text-zinc-400">
                    {chapter.duration} sn
                  </span>
                </div>
                <p className="mt-3 whitespace-pre-line leading-7 text-zinc-300">
                  {chapter.narration}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </StudioCard>
  );
}

function ScenePanel({ scenes }: { scenes: SceneData | null }) {
  return (
    <StudioCard title="Sahne Paneli">
      {!scenes || scenes.scenes.length === 0 ? (
        <EmptyState text="Sahne verisi henüz üretilmedi." />
      ) : (
        <div className="space-y-4">
          {scenes.scenes.map((scene) => (
            <div
              key={scene.id}
              className="rounded-xl border border-zinc-800 bg-zinc-950 p-4"
            >
              <h3 className="font-semibold text-yellow-400">
                Sahne {scene.id}: {scene.title}
              </h3>
              <p className="mt-3 leading-7 text-zinc-300">{scene.description}</p>
              <div className="mt-4 grid gap-3 text-sm text-zinc-400 md:grid-cols-2">
                <Info label="Kamera" value={scene.visualPrompt ?? "Belirtilmedi."} />
                <Info
                  label="Duygu"
                  value={
                    scene.duration
                      ? `${scene.duration} saniyelik sahne akışı`
                      : "Belirtilmedi."
                  }
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </StudioCard>
  );
}

function VisualPanel({ visuals }: { visuals: VisualData | null }) {
  return (
    <StudioCard title="Görsel Panel">
      {!visuals ? (
        <EmptyState text="Görsel planı henüz üretilmedi." />
      ) : (
        <div className="space-y-6">
          <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
            <h3 className="font-semibold text-yellow-400">
              Thumbnail Konsepti
            </h3>
            <p className="mt-3 text-zinc-300">{visuals.thumbnail.prompt}</p>
            <div className="mt-4 grid gap-3 text-sm text-zinc-400 md:grid-cols-2">
              <Info label="Başlık" value={visuals.thumbnail.title} />
              <Info label="Kompozisyon" value={visuals.thumbnail.composition} />
              <Info label="Duygu" value={visuals.thumbnail.mood} />
            </div>
          </div>

          <div className="space-y-4">
            {visuals.scenes.map((scene) => (
              <div
                key={scene.sceneId}
                className="rounded-xl border border-zinc-800 bg-zinc-950 p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="font-semibold text-yellow-400">
                    Görsel Sahne {scene.sceneId}
                  </h3>
                  <span className="text-sm text-zinc-400">{scene.style}</span>
                </div>
                <TextBlock title="Görsel Prompt" text={scene.visualPrompt} />
                <TextBlock
                  title="Animasyon Prompt"
                  text={scene.animationPrompt}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </StudioCard>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
        {label}
      </p>
      <p className="mt-1 text-zinc-200">{value}</p>
    </div>
  );
}

function TextBlock({ title, text }: { title: string; text: string }) {
  return (
    <div>
      <h3 className="font-semibold text-yellow-400">{title}</h3>
      <p className="mt-2 whitespace-pre-line leading-7 text-zinc-300">{text}</p>
    </div>
  );
}

function ListBlock({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) {
    return <EmptyState text={`${title} verisi bulunmuyor.`} />;
  }

  return (
    <div>
      <h3 className="font-semibold text-yellow-400">{title}</h3>
      <ul className="mt-3 space-y-2 text-zinc-300">
        {items.map((item, index) => (
          <li key={`${title}-${index}`} className="leading-7">
            <span className="mr-2 text-yellow-400">{index + 1}.</span>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <p className="rounded-xl border border-dashed border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-500">
      {text}
    </p>
  );
}

function formatDate(value: string) {
  return new Date(value).toLocaleString("tr-TR");
}
