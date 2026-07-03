import Link from "next/link";

type Project = {
  file: string;
  topic: string;
  summary: string;
};

type DashboardProps = {
  projects?: Project[];
};

export default function Dashboard({ projects = [] }: DashboardProps) {
  return (
    <section className="flex-1 p-8 text-white">
      <div className="rounded-3xl border border-white/10 bg-white/5 p-8">
        <p className="text-sm uppercase tracking-[0.3em] text-yellow-500">
          Kontrol Paneli
        </p>

        <h2 className="mt-3 text-4xl font-bold">Projeler</h2>

        <p className="mt-3 max-w-2xl text-zinc-400">
          Kaydedilen belgesel projelerin burada listelenecek.
        </p>

        <div className="mt-8 grid gap-4">
          {projects.length === 0 && (
            <div className="rounded-2xl border border-white/10 bg-black/30 p-6 text-zinc-400">
              Henüz kayıtlı proje yok.
            </div>
          )}

          {projects.map((project) => {
            const slug = project.file.replace(".json", "");

            return (
              <div
                key={project.file}
                className="rounded-2xl border border-white/10 bg-black/30 p-6"
              >
                <h3 className="text-xl font-bold text-yellow-400">
                  {project.topic}
                </h3>

                <p className="mt-2 line-clamp-2 text-sm text-zinc-400">
                  {project.summary}
                </p>

                <p className="mt-4 text-xs text-zinc-600">
                  Dosya: {project.file}
                </p>

                <Link
                  href={`/project/${slug}`}
                  className="mt-5 inline-block rounded-xl bg-yellow-500 px-5 py-3 font-bold text-black"
                >
                  Aç
                </Link>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}