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
    <div className="aw-card">
      <h2 className="mb-5 text-lg font-semibold text-white">
        {title}
      </h2>

      {children}
    </div>
  );
}