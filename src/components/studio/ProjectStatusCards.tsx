import type { ProductionStepState } from "@/lib/projects/projectProgress";

type ProjectStatusCardsProps = {
  steps: ProductionStepState[];
};

export default function ProjectStatusCards({ steps }: ProjectStatusCardsProps) {
  return (
    <div className="grid gap-4 md:grid-cols-4">
      {steps.map((step) => (
        <div
          key={step.key}
          className="rounded-xl border border-zinc-800 bg-zinc-950 p-4"
        >
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-semibold text-white">{step.label}</h3>
            <span
              className={
                step.completed
                  ? "rounded-full bg-green-500/10 px-2 py-1 text-xs font-medium text-green-400"
                  : "rounded-full bg-yellow-500/10 px-2 py-1 text-xs font-medium text-yellow-400"
              }
            >
              {step.completed ? "Tamamlandı" : "Bekliyor"}
            </span>
          </div>

          <p className="mt-3 text-sm text-zinc-500">
            Son güncelleme:{" "}
            {step.updatedAt
              ? new Date(step.updatedAt).toLocaleString("tr-TR")
              : "Belirtilmedi"}
          </p>
        </div>
      ))}
    </div>
  );
}
