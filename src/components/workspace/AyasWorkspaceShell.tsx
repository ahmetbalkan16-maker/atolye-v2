"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AyasWorkspaceFrame } from "./AyasWorkspaceFrame";

/** Route selection only: server children keep their loaders/actions and state. */
export function AyasWorkspaceShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  // Keep the explicitly isolated office demo out of the production workspace
  // shell. Its prefetched navigation links can mount live panels and refresh
  // their observers even when the demo itself never calls those systems.
  if (pathname === "/studio/office-preview" || pathname?.startsWith("/studio/office-preview/")) return children;
  // The owner-fixed HOME already owns its composition and navigation.
  if (pathname === "/") return children;
  return <AyasWorkspaceFrame pathname={pathname ?? ""} logout={
    pathname === "/login" || pathname === "/offline" ? null :
      <form action="/api/auth/logout" method="POST"><button type="submit" className="aw-session">Çıkış</button></form>
  }>{children}<Link className="aw-return" href="/">Ana Sayfa</Link></AyasWorkspaceFrame>;
}
