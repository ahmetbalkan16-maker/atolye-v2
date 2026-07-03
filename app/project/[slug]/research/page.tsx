import Sidebar from "@/components/Sidebar";
import ResearchStartButton from "@/components/ResearchStartButton";

type Props = {
  params: Promise<{
    slug: string;
  }>;
};

export default async function ResearchPage({ params }: Props) {
  const { slug } = await params;

  return (
    <main className="flex min-h-screen bg-black text-white">
      <Sidebar />

      <section className="flex-1 p-10">
        <p className="text-sm uppercase tracking-[0.4em] text-yellow-400">
          ARAŞTIRMA MOTORU
        </p>

        <h1 className="mt-4 text-5xl font-bold">
          {slug.replaceAll("-", " ")}
        </h1>

        <div className="mt-10 rounded-3xl border border-white/10 bg-zinc-900 p-8">
          <h2 className="text-2xl font-bold text-yellow-400">Araştırma</h2>

          <p className="mt-4 text-zinc-400">
            Bu proje için araştırma paketini oluştur.
          </p>

          <ResearchStartButton slug={slug} />
        </div>
      </section>
    </main>
  );
}