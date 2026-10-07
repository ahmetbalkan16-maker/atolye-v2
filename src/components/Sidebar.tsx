import Link from "next/link";

const menuItems = [
  { name: "AYAS Ana Sayfa", href: "/" },
  { name: "Proje Stüdyosu", href: "/studio" },
  { name: "Araştırma", href: "/research" },
  { name: "Senaryo", href: "/script" },
  { name: "Sahneler", href: "/scenes" },
  { name: "Görseller", href: "/visuals" },
];

export default function Sidebar() {
  return <aside className="aw-studio-nav" aria-label="Stüdyo alanları">
    <p>ÜRETİM ALANLARI</p>
    {menuItems.map(item => <Link key={item.href} href={item.href}>{item.name}</Link>)}
    <p>Animasyon, ses ve YouTube araçları seçtiğiniz projenin çalışma alanındadır.</p>
  </aside>;
}
