import { ReactNode } from "react";

interface StudioCardProps {
  title: string;
  children: ReactNode;
}

export default function StudioCard({
  title,
  children,
}: StudioCardProps) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6 shadow-lg">
      <h2 className="mb-5 text-lg font-semibold text-white">
        {title}
      </h2>

      {children}
    </div>
  );
}