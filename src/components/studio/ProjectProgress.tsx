type ProjectProgressProps = {
  progress: number;
};

export default function ProjectProgress({ progress }: ProjectProgressProps) {
  return (
    <div>
      <div className="mb-3 flex items-center justify-between text-sm">
        <span className="font-medium text-zinc-300">Üretim ilerlemesi</span>
        <span className="font-semibold text-yellow-400">%{progress}</span>
      </div>

      <div className="h-3 overflow-hidden rounded-full bg-zinc-800">
        <div
          className="h-full rounded-full bg-yellow-400 transition-all"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}
