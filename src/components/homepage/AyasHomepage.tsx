"use client";

import { Suspense, use, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import type { BrainConsoleViewProps } from "../brain/BrainConsoleView";
import type { AyasControlCenterInputs } from "../brain/AyasControlCenter";
import { describeBrainCoreState } from "../brain/brainCore";
import { buildAyasControlCenterView, type AyasCcDomainId } from "@/lib/brain/ui/AyasControlCenterModel";

type IconName = "home" | "cube" | "memory" | "search" | "growth" | "gear" | "graph" | "tasks" | "check" | "chat" | "mic" | "arrow";

/** Small local line icons. Decorative; all functional labels are DOM text. */
export function HomeIcon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    home: <><path d="m3 10 9-7 9 7M5 9v12h5v-7h4v7h5V9" /></>,
    cube: <><path d="m12 2 9 5v10l-9 5-9-5V7Z M3 7l9 5 9-5M12 12v10" /></>,
    memory: <><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v14c0 4 16 4 16 0V5M4 10c0 4 16 4 16 0M4 15c0 4 16 4 16 0" /></>,
    search: <><circle cx="10" cy="10" r="7" /><path d="m15 15 6 6" /></>,
    growth: <><path d="M3 21V14h4v7M10 21V9h4v12M17 21V4h4v17M3 8l6-5 5 2 6-4" /></>,
    gear: <><path d="m9 3 1-2h4l1 2 3 2 2 1v4l2 2-2 2v4l-2 1-3 2-1 2h-4l-1-2-3-2-2-1v-4l-2-2 2-2V6l2-1Z" /><circle cx="12" cy="12" r="4" /></>,
    graph: <><circle cx="12" cy="4" r="3" /><circle cx="4" cy="19" r="3" /><circle cx="20" cy="19" r="3" /><path d="m10 7-5 9m9-9 5 9M7 19h10" /></>,
    tasks: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M10 7h7M10 12h7M10 17h7M6 7h1M6 12h1M6 17h1" /></>,
    check: <><circle cx="12" cy="12" r="10" /><path d="m7 12 3 3 7-7" /></>,
    chat: <><path d="M21 11a9 9 0 0 1-9 9H3l2-5a9 9 0 1 1 16-4Z" /><path d="M7 10h1m3 0h1m3 0h1" /></>,
    mic: <><rect x="9" y="2" width="6" height="13" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" /></>,
    arrow: <path d="m9 4 8 8-8 8" />,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

// Owner-fixed, explicit navigation. Never enumerate capabilities/proposals here:
// a newly discovered feature cannot append itself to this homepage.
const TOP_NAV = [
  { label: "Ana Sayfa", icon: "home", href: "/" },
  { label: "Sistemler", icon: "memory", href: "/brain?panel=system" },
  { label: "Bilgi", icon: "cube", href: "/brain?panel=memory" },
  { label: "Araştırma", icon: "search", href: "/brain?panel=research" },
  { label: "Gelişim", icon: "growth", href: "/brain?panel=development" },
  { label: "Üretim", icon: "cube", href: "/studio" },
  { label: "Otonom Gelir", icon: "growth", href: "/brain/revenue" },
] as const;

const DOCK = [
  { label: "Atölye", icon: "cube", href: "/studio", tone: "blue" },
  { label: "Bellek", icon: "memory", href: "/brain?panel=memory", tone: "violet" },
  { label: "Araştırma", icon: "search", href: "/brain?panel=research", tone: "cyan" },
  { label: "Üretim", icon: "gear", href: "/brain?panel=production", tone: "amber" },
  { label: "Otonom Gelir", icon: "growth", href: "/brain/revenue", tone: "green" },
  { label: "Gelişim", icon: "growth", href: "/brain?panel=development", tone: "pink" },
] as const;

interface HomepageProps extends BrainConsoleViewProps {
  readonly inputs: AyasControlCenterInputs;
  readonly children: ReactNode;
}

export function AyasHomepage(props: HomepageProps) {
  const info = describeBrainCoreState(props.coreState);
  const voice = props.voice;
  const micHandler = voice?.listening
    ? voice.onStopListening ?? voice.onToggleListening
    : voice?.state === "speaking" && voice.onInterruptSpeech
      ? voice.onInterruptSpeech : props.onStartConversation;
  const micLabel = voice?.listening ? "Dinlemeyi kapat" : voice?.state === "speaking" ? "Sözünü kes ve konuş" : voice?.capability.stt ? "AYAS ile konuş" : "Metin sohbetine geç";
  return (
    <main className="ah-home" data-state={props.coreState} data-testid="ayas-homepage">
      <a className="ah-skip" href="#bc-command-center">Sohbete geç</a>
      <header className="ah-header">
        <Link href="/" className="ah-logo" aria-label="AYAS ana sayfa">AYAS</Link>
        <nav className="ah-topnav" aria-label="Ana gezinme">
          {TOP_NAV.map(item => <Link key={item.href} href={item.href} aria-current={item.href === "/" ? "page" : undefined}><HomeIcon name={item.icon} /><span>{item.label}</span></Link>)}
        </nav>
        <Link className="ah-settings" href="/brain/constitution"><HomeIcon name="gear" /><span>Ayarlar</span></Link>
      </header>

      <div className="ah-layout">
        <aside className="ah-rail ah-glass" aria-label="AYAS sistem durumu">
          <div className="ah-rail-brand"><span className="ah-signal" aria-hidden="true">∿</span><div><h1>AYAS</h1><p>Her zaman yanında</p></div></div>
          <Suspense fallback={<RailLoading />}><StatusRail {...props} /></Suspense>
          <div className="ah-rail-foot"><Link href="/brain">Kontrol Merkezi <span aria-hidden="true">↗</span></Link><button type="button" onClick={props.onRefresh} disabled={!props.onRefresh || props.refreshing} aria-label="Sistem durumunu yenile" data-testid="bc-refresh">{props.refreshing ? "Okunuyor…" : "Yenile"}</button></div>
        </aside>

        <section className="ah-hero" aria-label="AYAS canlı beyin">
          <AyasBrainHero state={props.coreState} />
          <div className="ah-state" role="status"><span className="ah-dot" aria-hidden="true" /><strong>{info.tr}</strong><span>{info.label}</span></div>
          {props.snapshot.errors.length > 0 && <p className="ah-error" role="alert">Durum okunamadı. <Link href="/brain?panel=system">Ayrıntıları incele →</Link></p>}
          {voice?.recovering && <p className="ah-notice" role="status">Ses bağlantısı toparlanıyor.</p>}
        </section>

        <section className="ah-command ah-glass" id="bc-command-center" aria-label="AYAS komut merkezi">
          <nav className="ah-shortcuts" aria-label="Hızlı erişim">
            <Link href="/brain?panel=system"><HomeIcon name="check" />/durum</Link>
            <Link href="/brain?panel=tasks"><HomeIcon name="tasks" />/plan</Link>
            <Link href="/brain?panel=system"><HomeIcon name="graph" />/graphify</Link>
            <Link href="/brain?panel=research"><HomeIcon name="search" />/araştır</Link>
            <Link href="/studio"><HomeIcon name="gear" />/üret</Link>
            <Link href="/brain/revenue"><HomeIcon name="growth" />/gelir</Link>
            <Link href="/brain?panel=development"><HomeIcon name="check" />/onay</Link>
          </nav>
          <nav className="ah-tabs" aria-label="Etkileşim">
            <button type="button" aria-pressed={props.activePanel !== "tasks"} onClick={() => props.onSelectPanel?.("chat")}><HomeIcon name="chat" />Konuş</button>
            <Link href="/brain">⌘ <span>Komut Merkezi</span></Link>
            <button type="button" aria-pressed={props.activePanel === "tasks"} onClick={() => props.onSelectPanel?.("tasks")}><HomeIcon name="tasks" />Görevler</button>
          </nav>
          {props.activePanel !== "tasks" && <>
            <div className="ah-voice-orbit" data-voice={voice?.state ?? "idle"}>
              <span className="ah-wave ah-wave--left" aria-hidden="true" />
              <button type="button" className="ah-voice-button" onClick={micHandler} disabled={!micHandler || props.connectivity === "offline"} aria-label={micLabel} aria-pressed={voice?.listening ?? false} title={voice?.capability.stt ? micLabel : "Metin sohbeti kullanılabilir; bu cihazda mikrofon hazır değil"}><HomeIcon name="mic" /></button>
              <span className="ah-wave ah-wave--right" aria-hidden="true" />
            </div>
            <div className="ah-voice-states" aria-label="Canlı etkileşim durumu">
              {([
                { state: "listening", label: "Dinliyor", icon: "mic", tone: "cyan" },
                { state: "thinking", label: "Düşünüyor", icon: "graph", tone: "amber" },
                { state: "speaking", label: "Konuşuyor", icon: "chat", tone: "pink" },
              ] as const).map(item => <div key={item.state} className="ah-voice-state" data-tone={item.tone} data-active={props.coreState === item.state}>
                <HomeIcon name={item.icon} /><strong>{item.label}</strong><span><i className="ah-dot" aria-hidden="true" />{props.coreState === item.state ? "Etkin" : "Beklemede"}</span>
              </div>)}
            </div>
          </>}
          {props.voiceSessionInterrupted && !voice?.listening && <p className="ah-notice" role="status">Sesli oturum kesildi. Mikrofon düğmesiyle sürdür.</p>}
          <div className="ah-conversation" aria-label={props.activePanel === "tasks" ? "Görevler" : "AYAS sohbeti"}>{props.children}</div>
        </section>
      </div>

      <nav className="ah-dock" aria-label="Çalışma alanları">
        {DOCK.map(item => <Link key={item.label} href={item.href} data-tone={item.tone}><HomeIcon name={item.icon} /><span>{item.label}</span><HomeIcon name="arrow" /></Link>)}
      </nav>
      <footer className="ah-footer"><span><i className="ah-dot" aria-hidden="true" />{info.tr}</span><span>Yürütme kapısı: {props.snapshot.executionGate}</span><Link href="/brain/voice-lab">Ses tanılama ↗</Link></footer>
    </main>
  );
}

/** DOM/CSS animation only; state is supplied by the existing live-state reducer. */
export function AyasBrainHero({ state }: { state: BrainConsoleViewProps["coreState"] }) {
  const info = describeBrainCoreState(state);
  return <div className="ah-brain" data-state={state} role="img" aria-label={`AYAS — ${info.tr}`}>
    <div className="ah-ceiling" aria-hidden="true" />
    <div className="ah-light-column" aria-hidden="true" />
    <div className="ah-orbit ah-orbit--one" aria-hidden="true" />
    <div className="ah-orbit ah-orbit--two" aria-hidden="true" />
    <Image className="ah-brain-image" src="/ayas/brain/ayas-brain-core-v2.webp" width={1000} height={1000} alt="" unoptimized loading="eager" aria-hidden="true" />
    <div className="ah-orbit ah-orbit--three" aria-hidden="true" />
    <div className="ah-pedestal" aria-hidden="true"><span /><span /><span /></div>
  </div>;
}

const RAIL: readonly { label: string; icon: IconName; domain?: AyasCcDomainId; href: string }[] = [
  { label: "Sistem", icon: "cube", domain: "health", href: "/brain?panel=autonomous" },
  { label: "Bellek", icon: "memory", domain: "memory", href: "/brain?panel=memory" },
  { label: "Graphify", icon: "graph", domain: "graphify", href: "/brain?panel=system" },
  { label: "Araştırma", icon: "search", domain: "research", href: "/brain?panel=research" },
  { label: "Atölye", icon: "cube", domain: "atolye", href: "/studio" },
  { label: "Üretim", icon: "gear", domain: "capabilities", href: "/brain?panel=production" },
  { label: "Otonomi", icon: "growth", domain: "autonomy", href: "/brain?panel=autonomous" },
  { label: "Görevler", icon: "tasks", href: "/brain?panel=tasks" },
  { label: "Onaylar", icon: "check", domain: "approvals", href: "/brain?panel=development" },
];

function RailLoading() {
  return <div className="ah-rail-rows" aria-busy="true">{RAIL.map(item => <Link key={item.label} href={item.href}><HomeIcon name={item.icon} /><span>{item.label}<small>Okunuyor…</small></span><span className="ah-dot" data-level="UNKNOWN" aria-hidden="true" /></Link>)}</div>;
}

function StatusRail(props: HomepageProps) {
  const server = props.controlCenter?.override !== undefined ? props.controlCenter.override : props.controlCenter?.facts ? use(props.controlCenter.facts) : null;
  const view = buildAyasControlCenterView({ ...props.inputs, server });
  return <>
    <div className="ah-rail-rows">{RAIL.map(item => {
      const domain = view.domains.find(d => d.id === item.domain);
      const status = item.domain ? domain?.statusLabel ?? "Bağlı değil" : props.snapshot.connected.tasks ? `${props.snapshot.tasks.total} kayıt` : "Bağlı değil";
      const level = domain?.availability === "OK" ? domain.attention : "UNKNOWN";
      return <Link key={item.label} href={item.href} title={domain ? `${domain.summary} · Kaynak: ${domain.source}` : status} data-level={level}><HomeIcon name={item.icon} /><span>{item.label}<small>{status}</small></span><i className="ah-dot" aria-hidden="true" /><HomeIcon name="arrow" /></Link>;
    })}</div>
    <Link href="/brain" className="ah-attention" data-level={view.overall.level} role="status">{view.overall.label}{view.attention.length > 0 ? ` · ${view.attention.length} dikkat maddesi` : ""} <span aria-hidden="true">↗</span></Link>
    {view.generatedAt && <p className="ah-read-time">Son okuma: <time dateTime={view.generatedAt}>{view.generatedAt.replace("T", " ").slice(0, 19)} UTC</time></p>}
  </>;
}
