import fs from "fs";
import path from "path";
import Sidebar from "@/components/Sidebar";

type PageProps = {
  params: Promise<{
    slug: string;
  }>;
};

export default async function ProjectPage({ params }: PageProps) {
  const { slug } = await params;

  const filePath = path.join(
    process.cwd(),
    "data",
    "projects",
    `${slug}.json`
  );

  if (!fs.existsSync(filePath)) {
    return (
      <main className="flex min-h-screen bg-black text-white">
        <Sidebar />

        <section className="flex-1 p-10">
          <h1 className="text-4xl font-bold">
            Proje bulunamadı
          </h1>
        </section>
      </main>
    );
  }

  const project = JSON.parse(
    fs.readFileSync(filePath, "utf8")
  );

  return (
    <main className="flex min-h-screen bg-black text-white">
      <Sidebar />

      <section className="flex-1 p-10">

        <h1 className="text-5xl font-bold">
          {project.topic}
        </h1>

        <p className="mt-5 text-zinc-400">
          {project.summary}
        </p>

        <div className="mt-10 grid grid-cols-4 gap-5">

          <ModuleCard
            title="📚 Araştırma"
            color="border-yellow-500"
          />

          <ModuleCard
            title="✍️ Senaryo"
            color="border-blue-500"
          />

          <ModuleCard
            title="🎬 Sahneler"
            color="border-green-500"
          />

          <ModuleCard
            title="🖼 Görseller"
            color="border-purple-500"
          />

          <ModuleCard
            title="🎥 Animasyon"
            color="border-pink-500"
          />

          <ModuleCard
            title="🎙 Ses"
            color="border-cyan-500"
          />

          <ModuleCard
            title="📺 YouTube"
            color="border-red-500"
          />

        </div>

      </section>
    </main>
  );
}

function ModuleCard({
  title,
  color,
}: {
  title: string;
  color: string;
}) {
  return (
    <div
      className={`rounded-2xl border-2 ${color} bg-zinc-900 p-8 text-center hover:scale-105 transition`}
    >
      <h2 className="text-xl font-bold">
        {title}
      </h2>

      <button className="mt-6 rounded-xl bg-yellow-500 px-5 py-3 font-bold text-black">
        Aç
      </button>
    </div>
  );
}