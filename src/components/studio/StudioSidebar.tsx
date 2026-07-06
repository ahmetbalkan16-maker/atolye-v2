import Link from "next/link";

const menuItems = [
  { label: "Dashboard", href: "/" },
  { label: "Araştırma", href: "/research" },
  { label: "Senaryo", href: "/script" },
  { label: "Sahneler", href: "/scenes" },
  { label: "Görseller", href: "/visuals" },
];

export default function StudioSidebar() {
  return (
    <aside className="min-h-screen w-64 border-r border-zinc-800 bg-zinc-950 p-5">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Atölye V2</h1>
        <p className="mt-1 text-sm text-zinc-500">
          AI Documentary Studio
        </p>
      </div>

      <nav className="space-y-2">
        {menuItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="block rounded-xl px-4 py-3 text-sm font-medium text-zinc-300 hover:bg-zinc-900 hover:text-white"
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}