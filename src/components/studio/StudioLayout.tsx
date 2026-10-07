import type { ReactNode } from "react";
import StudioHeader from "./StudioHeader";
import StudioSidebar from "./StudioSidebar";
interface StudioLayoutProps { title: string; subtitle?: string; children: ReactNode; }
export default function StudioLayout({ title, subtitle, children }: StudioLayoutProps) {
  return <div className="aw-studio"><StudioSidebar /><main className="aw-studio-main">
    <StudioHeader title={title} subtitle={subtitle} /><div className="mt-8">{children}</div>
  </main></div>;
}
