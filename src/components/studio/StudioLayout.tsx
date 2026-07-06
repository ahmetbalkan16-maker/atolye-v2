import { ReactNode } from "react";
import StudioHeader from "./StudioHeader";
import StudioSidebar from "./StudioSidebar";

interface StudioLayoutProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
}

export default function StudioLayout({
  title,
  subtitle,
  children,
}: StudioLayoutProps) {
  return (
    <div className="flex min-h-screen bg-black text-white">
      <StudioSidebar />

      <main className="flex-1 p-8">
        <StudioHeader
          title={title}
          subtitle={subtitle}
        />

        <div className="mt-8">
          {children}
        </div>
      </main>
    </div>
  );
}