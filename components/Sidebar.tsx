import Link from "next/link";

const menuItems = [
  { name: "Kontrol Paneli", href: "/" },
  { name: "Araştırma", href: "/research" },
  { name: "Senaryo", href: "/script" },
  { name: "Sahneler", href: "/scenes" },
  { name: "Görseller", href: "/visuals" },
  { name: "Animasyon", href: "/animation" },
  { name: "Ses", href: "/audio" },
  { name: "YouTube", href: "/youtube" },
  { name: "Ayarlar", href: "/settings" },
];

export default function Sidebar() {
  return (
    <aside className="hidden min-h-screen w-72 border-r border-white/10 bg-black/40 p-6 text-white md:block">
      <h1 className="text-3xl font-bold tracking-tight text-yellow-400">
        ATÖLYE
      </h1>

      <p className="mt-2 text-sm text-zinc-500">AI Belgesel Stüdyosu</p>

      <nav className="mt-10 space-y-2">
        {menuItems.map((item) => (
          <Link
            key={item.name}
            href={item.href}
            className="block rounded-xl px-4 py-3 text-sm text-zinc-300 transition hover:bg-white/10 hover:text-white"
          >
            {item.name}
          </Link>
        ))}
      </nav>
    </aside>
  );
}