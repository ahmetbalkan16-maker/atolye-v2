import Link from "next/link";
import ProjectList from "./dashboard/ProjectList";
import DashboardStats from "./dashboard/DashboardStats";

export default function Dashboard() {
  return (
    <main className="min-h-screen bg-gray-100 p-8">
      <div className="mx-auto max-w-7xl space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold">🎬 Atölye V2</h1>

            <p className="mt-2 text-gray-600">
              AI Destekli Belgesel Stüdyosu
            </p>
          </div>

          <Link
            href="/research"
            className="rounded-xl bg-blue-600 px-6 py-3 font-semibold text-white hover:bg-blue-700"
          >
            + Yeni Proje
          </Link>
        </div>

        <DashboardStats />

        <section className="rounded-xl bg-white p-6 shadow">
          <h2 className="mb-6 text-2xl font-bold">
            📁 Son Projeler
          </h2>

          <ProjectList />
        </section>
      </div>
    </main>
  );
}