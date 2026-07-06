type DashboardLayoutProps = {
  children: React.ReactNode;
};

export default function DashboardLayout({ children }: DashboardLayoutProps) {
  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <div className="flex">
        <aside className="min-h-screen w-64 border-r border-neutral-800 bg-neutral-900 p-6">
          <h1 className="text-xl font-bold">Atölye AI</h1>
          <p className="mt-2 text-sm text-neutral-400">
            Belgesel üretim stüdyosu
          </p>

          <nav className="mt-8 space-y-3 text-sm">
            <div className="rounded-lg bg-neutral-800 px-3 py-2">📚 Research</div>
            <div className="rounded-lg px-3 py-2 text-neutral-400">✍️ Script</div>
            <div className="rounded-lg px-3 py-2 text-neutral-400">🎬 Scene</div>
            <div className="rounded-lg px-3 py-2 text-neutral-400">🎨 Assets</div>
            <div className="rounded-lg px-3 py-2 text-neutral-400">📺 SEO</div>
          </nav>
        </aside>

        <main className="flex-1 p-8">{children}</main>
      </div>
    </div>
  );
}