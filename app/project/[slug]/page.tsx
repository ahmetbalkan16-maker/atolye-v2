import Link from "next/link";
import Sidebar from "@/components/Sidebar";
import { ProjectManager } from "@/lib/projects/ProjectManager";

type Props = {
  params: Promise<{
    slug: string;
  }>;
};

export default async function ProjectPage({ params }: Props) {
  const { slug } = await params;

  const project = ProjectManager.getProject(slug);
  const research = ProjectManager.loadResearch(slug);
  const script = ProjectManager.loadScript(slug);

  if (!project) {
    return (
      <main className="flex min-h-screen bg-black text-white">
        <Sidebar />
        <section className="flex-1 p-10">
          <h1 className="text-4xl font-bold text-red-400">Proje bulunamadı.</h1>
          <Link href="/" className="mt-6 inline-block text-yellow-400">
            Kontrol paneline dön
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen bg-black text-white">
      <Sidebar />

      <section className="flex-1 p-10">
        <p className="text-sm font-bold uppercase tracking-[0.4em] text-yellow-400">
          PROJE ÇALIŞMA ALANI
        </p>

        <h1 className="mt-4 text-5xl font-bold">{project.title}</h1>

        {project.description && (
          <p className="mt-4 max-w-4xl text-zinc-400">{project.description}</p>
        )}

        <div className="mt-8 rounded-3xl border border-white/10 bg-zinc-900 p-6">
          <h2 className="text-2xl font-bold text-yellow-400">📋 Proje Bilgileri</h2>

          <div className="mt-4 grid gap-3 text-sm text-zinc-300">
            <p>Durum: {project.status}</p>
            <p>Slug: {project.slug}</p>
            <p>Oluşturulma: {new Date(project.createdAt).toLocaleString("tr-TR")}</p>
            <p>Son Güncelleme: {new Date(project.updatedAt).toLocaleString("tr-TR")}</p>
          </div>
        </div>

        <div className="mt-8 grid gap-4">
          <ModuleCard
            title="📖 Araştırma"
            description={research ? "Araştırma tamamlandı." : "Henüz araştırma yapılmadı."}
            status={research ? "Tamamlandı" : "Bekliyor"}
            href={`/project/${project.slug}/research`}
            buttonText={research ? "Araştırmayı Gör" : "Araştırmayı Başlat"}
          />

          <ModuleCard
            title="✍️ Senaryo"
            description={
              script
                ? "Senaryo tamamlandı."
                : research
                ? "Araştırma hazır. Senaryo oluşturulabilir."
                : "Önce araştırma tamamlanmalı."
            }
            status={script ? "Tamamlandı" : research ? "Hazır" : "Kilitli"}
            href={research ? `/project/${project.slug}/script` : "#"}
            buttonText={script ? "Senaryoyu Gör" : "Senaryoyu Oluştur"}
            disabled={!research}
          />

          <ModuleCard
            title="🎬 Sahneler"
            description="Senaryo tamamlandıktan sonra sahne planı oluşturulacak."
            status={script ? "Hazır" : "Kilitli"}
            href={script ? `/project/${project.slug}/scenes` : "#"}
            buttonText="Sahneleri Oluştur"
            disabled={!script}
          />
        </div>
      </section>
    </main>
  );
}

function ModuleCard({
  title,
  description,
  status,
  href,
  buttonText,
  disabled = false,
}: {
  title: string;
  description: string;
  status: string;
  href: string;
  buttonText: string;
  disabled?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-zinc-900 p-6">
      <div className="flex items-center justify-between gap-6">
        <div>
          <h2 className="text-2xl font-bold text-yellow-400">{title}</h2>
          <p className="mt-2 text-zinc-400">{description}</p>
          <span className="mt-4 inline-block rounded-full bg-yellow-500/20 px-3 py-1 text-sm text-yellow-400">
            {status}
          </span>
        </div>

        {disabled ? (
          <button disabled className="rounded-xl bg-zinc-700 px-5 py-3 font-bold text-zinc-400">
            {buttonText}
          </button>
        ) : (
          <Link href={href} className="rounded-xl bg-yellow-500 px-5 py-3 font-bold text-black">
            {buttonText}
          </Link>
        )}
      </div>
    </div>
  );
}