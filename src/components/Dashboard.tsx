import Link from "next/link";
import ProjectList from "./dashboard/ProjectList";
import DashboardStats from "./dashboard/DashboardStats";
export default function Dashboard() {
  return <section className="space-y-8">
    <header className="aw-page-heading"><div><h1>Proje Stüdyosu</h1><p>Araştırmadan üretim paketine, mevcut projeleriniz.</p></div><Link href="/research" className="aw-primary">Yeni Proje</Link></header>
    <DashboardStats />
    <section className="aw-card"><h2 className="mb-6 text-xl font-semibold">Son Projeler</h2><ProjectList /></section>
  </section>;
}
