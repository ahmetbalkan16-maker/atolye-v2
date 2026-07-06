interface StudioHeaderProps {
  title: string;
  subtitle?: string;
}

export default function StudioHeader({
  title,
  subtitle,
}: StudioHeaderProps) {
  return (
    <header className="flex items-center justify-between rounded-2xl border border-zinc-800 bg-zinc-900 px-6 py-5 shadow-lg">
      <div>
        <h1 className="text-3xl font-bold text-white">
          {title}
        </h1>

        {subtitle && (
          <p className="mt-1 text-sm text-zinc-400">
            {subtitle}
          </p>
        )}
      </div>

      <div className="flex items-center gap-4">
        <div className="rounded-lg bg-green-500/10 px-4 py-2 text-sm font-medium text-green-400">
          ● Sistem Hazır
        </div>

        <div className="rounded-lg bg-blue-500/10 px-4 py-2 text-sm font-medium text-blue-400">
          OpenAI
        </div>
      </div>
    </header>
  );
}