import type { ProductionStepState } from "@/lib/projects/projectProgress";
import StudioCard from "./StudioCard";

type ProductionPackageSummaryProps = {
  steps: ProductionStepState[];
};

export default function ProductionPackageSummary({
  steps,
}: ProductionPackageSummaryProps) {
  const completedCount = steps.filter((step) => step.completed).length;

  return (
    <StudioCard title="Üretim Paketi Durumu">
      <div className="space-y-4">
        <p className="text-sm text-zinc-400">
          {completedCount}/{steps.length} üretim paketi hazır.
        </p>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((step) => (
            <div
              key={step.key}
              className="flex items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-950 p-4"
            >
              <span className="font-medium text-zinc-200">{step.label}</span>
              <span
                className={
                  step.completed
                    ? "rounded-full bg-green-500/10 px-2 py-1 text-xs font-medium text-green-400"
                    : "rounded-full bg-yellow-500/10 px-2 py-1 text-xs font-medium text-yellow-400"
                }
              >
                {step.completed ? "Hazır" : "Eksik"}
              </span>
            </div>
          ))}
        </div>
      </div>
    </StudioCard>
  );
}
