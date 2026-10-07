import Sidebar from "../Sidebar";
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <div className="aw-studio"><Sidebar /><main className="aw-studio-main">{children}</main></div>;
}
