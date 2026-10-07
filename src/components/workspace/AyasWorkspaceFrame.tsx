import type { ReactNode } from "react";
import Link from "next/link";

// Explicit owner navigation; never enumerate discovered capabilities or plugins.
export const WORKSPACE_NAV = [
  ["Ana Sayfa", "/"], ["Sistemler", "/brain?panel=system"],
  ["Bilgi", "/brain?panel=memory"], ["Araştırma", "/brain?panel=research"],
  ["Gelişim", "/brain?panel=development"], ["Üretim", "/studio"],
  ["Otonom Gelir", "/brain/revenue"],
] as const;
export const WORKSPACE_DOCK = [
  ["Atölye", "/studio", "blue"], ["Bellek", "/brain?panel=memory", "violet"],
  ["Araştırma", "/brain?panel=research", "cyan"], ["Üretim", "/brain?panel=production", "amber"],
  ["Otonom Gelir", "/brain/revenue", "green"], ["Gelişim", "/brain?panel=development", "pink"],
] as const;

function Navigation({ pathname }: { pathname: string }) {
  return <nav aria-label="AYAS alanları">{WORKSPACE_NAV.map(([label, href]) =>
    <Link key={href} href={href} aria-current={pathname === href ? "page" : undefined}>{label}</Link>
  )}<Link href="/brain/constitution">Ayarlar</Link></nav>;
}

/** Pure presentation; used by the app and isolated visual/parity checks. */
export function AyasWorkspaceFrame({ pathname, children, logout }: {
  pathname: string; children: ReactNode; logout?: ReactNode;
}) {
  return <div className="aw-root" data-design-system="brain-ui-v2">
    <a className="aw-skip" href="#ayas-workspace-content">İçeriğe geç</a>
    <header className="aw-header">
      <Link className="aw-brand" href="/" aria-label="AYAS Ana Sayfa">AYAS</Link>
      <div className="aw-wide-nav"><Navigation pathname={pathname} /></div>
      <details className="aw-mobile-menu"><summary>Alanlar</summary><Navigation pathname={pathname} /></details>
      {logout}
    </header>
    <div className="aw-content" id="ayas-workspace-content" tabIndex={-1}>{children}</div>
    <nav className="aw-dock" aria-label="AYAS çalışma alanları">{WORKSPACE_DOCK.map(([label, href, tone]) =>
      <Link key={label} href={href} data-tone={tone}><span className="aw-dock-mark" aria-hidden="true" />{label}</Link>
    )}</nav>
  </div>;
}
