"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { getPreviewBrain } from "@/lib/office-preview/brains";
import { PREVIEW_SCENARIOS, type PreviewDialogueStep, type PreviewScenarioId } from "@/lib/office-preview/scenarios";
import type { PreviewBrainId, PreviewBrainProfile } from "@/lib/office-preview/roleTypes";

type Motion = "idle" | "walk" | "work" | "review";
type ProfileTab = "mission" | "limits" | "reviewer";

const ROOMS: readonly { title: string; room: string; x: number; y: number; brain?: PreviewBrainId }[] = [
  { title: "ARAŞTIRMA", room: "Araştırma", x: 30, y: 18, brain: "arastirma" },
  { title: "KURGU & MİZAH", room: "Kurgu & Mizah", x: 51, y: 15, brain: "kurgu" },
  { title: "KOSTÜM", room: "Kostüm", x: 73, y: 19, brain: "kostum" },
  { title: "DİNLENME ODASI", room: "Dinlenme Odası", x: 15, y: 42 },
  { title: "ORTAM & GÖRSEL", room: "Ortam & Görsel", x: 31, y: 43, brain: "ortam" },
  { title: "AYAS YÖNETİM", room: "Yönetim", x: 50, y: 38, brain: "ayas" },
  { title: "MUHASEBE", room: "Muhasebe", x: 68, y: 40, brain: "muhasebe" },
  { title: "TOPLANTI & GELİŞİM", room: "Toplantı & Gelişim", x: 85, y: 42, brain: "gelistirici" },
  { title: "SES STÜDYOSU", room: "Ses Stüdyosu", x: 38, y: 65, brain: "ses" },
  { title: "DENETİM", room: "Denetim", x: 50, y: 61, brain: "denetci" },
  { title: "MONTAJ & KALİTE", room: "Montaj & Kalite", x: 68, y: 66, brain: "kalite" },
  { title: "OWNER ONAYI", room: "Owner Onayı", x: 50, y: 83, brain: "ayas" },
];
const POINTS: Readonly<Record<string, { x: number; y: number }>> = {
  "Yönetim": { x: 50, y: 43 }, "Araştırma": { x: 30, y: 27 }, "Kurgu & Mizah": { x: 51, y: 23 },
  "Kostüm": { x: 73, y: 28 }, "Dinlenme Odası": { x: 17, y: 49 }, "Ortam & Görsel": { x: 32, y: 49 },
  "Muhasebe": { x: 68, y: 47 }, "Toplantı & Gelişim": { x: 85, y: 49 }, "Ses Stüdyosu": { x: 39, y: 73 },
  "Denetim": { x: 50, y: 66 }, "Montaj & Kalite": { x: 68, y: 73 }, "Owner Onayı": { x: 50, y: 87 },
};
const MAIN_MENU = [["⬡","Sistem"],["▤","Bellek"],["⌘","Graphify"],["⌕","Araştırma"],["⬡","Atölye"],["⚙","Üretim"],["▥","Otonomi"],["▦","Görevler"],["◉","Onaylar"]] as const;
const SHORTCUTS = ["Atölye","Bellek","Araştırma","Üretim","Otonom Gelir","Gelişim"] as const;
const SHORTCUT_ICONS = ["⬡","▤","⌕","⚙","▥","▧"] as const;
const COMMANDS = ["/durum","/plan","/graphify","/araştır","/üret","/gelir","/onay"] as const;
const TOP_NAV = ["Ana Sayfa","Sistemler","Bilgi","Araştırma","Gelişim","Üretim","Otonom Gelir"] as const;
const TOP_ICONS = ["⌂","▤","⬡","⌕","▥","⬡","▥"] as const;
const FLOW = ["assign","work","review","verify","learn","owner"] as const;

function statusLabel(status: PreviewBrainProfile["liveStatus"]): string {
  if (status === "planlanan") return "Öneri · planlanan";
  if (status === "koşullu") return "Koşullu altyapı";
  return "Rol kaydı mevcut";
}
function kindLabel(kind: string): string {
  const labels: Record<string,string> = { assign:"ATAMA", work:"ÇALIŞMA", review:"DENETİM", rework:"DÜZELTME", verify:"YENİDEN KONTROL", learn:"DERS ADAYI", owner:"OWNER KAPISI" };
  return labels[kind] ?? "SİMÜLASYON";
}
function motionFor(step?: PreviewDialogueStep): Motion {
  if (!step) return "idle";
  if (step.kind === "work" || step.kind === "rework" || step.kind === "learn") return "work";
  if (step.kind === "review" || step.kind === "verify") return "review";
  if (step.kind === "assign" || step.kind === "owner") return "walk";
  return "idle";
}

/** Lightweight SVG skeleton rig: joint animation uses CSS transforms, without WebGL or a render loop. */
function RobotRig({ motion = "idle", large = false }: { motion?: Motion; large?: boolean }) {
  return <svg className={"oop-rig oop-rig--" + motion + (large ? " oop-rig--large" : "")} viewBox="0 0 72 88" aria-hidden="true">
    <ellipse className="rig-shadow" cx="36" cy="83" rx="19" ry="4" />
    <g className="rig-leg rig-leg-left"><path className="rig-bone" d="M31 55L29 68" /><g className="rig-shin rig-shin-left"><path className="rig-bone" d="M29 68L27 79" /><path className="rig-foot" d="M27 79L21 81" /></g></g>
    <g className="rig-leg rig-leg-right"><path className="rig-bone" d="M41 55L43 68" /><g className="rig-shin rig-shin-right"><path className="rig-bone" d="M43 68L45 79" /><path className="rig-foot" d="M45 79L51 81" /></g></g>
    <g className="rig-torso"><rect className="rig-shell" x="23" y="28" width="26" height="29" rx="9" /><path className="rig-chest" d="M29 38Q36 34 43 38L42 49Q36 52 30 49Z" /><circle className="rig-core" cx="36" cy="44" r="2.4" /></g>
    <g className="rig-arm rig-arm-left"><path className="rig-bone" d="M25 34L16 44" /><g className="rig-forearm rig-forearm-left"><path className="rig-bone" d="M16 44L15 54" /><circle className="rig-joint" cx="15" cy="54" r="2.8" /></g></g>
    <g className="rig-arm rig-arm-right"><path className="rig-bone" d="M47 34L56 44" /><g className="rig-forearm rig-forearm-right"><path className="rig-bone" d="M56 44L57 54" /><circle className="rig-joint" cx="57" cy="54" r="2.8" /></g></g>
    <path className="rig-neck" d="M34 28L34 24M38 28L38 24" />
    <g className="rig-head"><rect className="rig-face" x="24" y="7" width="24" height="18" rx="7" /><circle className="rig-eye" cx="31" cy="15" r="1.8" /><circle className="rig-eye" cx="41" cy="15" r="1.8" /><path className="rig-smile" d="M32 20Q36 22 40 20" /><circle className="rig-antenna" cx="36" cy="5" r="2" /></g>
  </svg>;
}

export function AtolyeOfficePreview() {
  const [scenarioId,setScenarioId] = useState<PreviewScenarioId>("research");
  const [selectedBrainId,setSelectedBrainId] = useState<PreviewBrainId>("ayas");
  const [profileTab,setProfileTab] = useState<ProfileTab>("mission");
  const [stepIndex,setStepIndex] = useState(-1);
  const [playing,setPlaying] = useState(false);
  const [notice,setNotice] = useState("");
  const [topNav,setTopNav] = useState("Ana Sayfa");
  const scenario = PREVIEW_SCENARIOS.find(item => item.id === scenarioId) ?? PREVIEW_SCENARIOS[0]!;
  const step = stepIndex >= 0 ? scenario.steps[stepIndex] : undefined;
  const brain = getPreviewBrain(selectedBrainId);
  const room = step?.room ?? brain.room;
  const point = POINTS[room] ?? POINTS["Yönetim"]!;
  const motion = motionFor(step);
  const isFinished = stepIndex >= scenario.steps.length - 1;
  const visibleMessages = stepIndex >= 0 ? scenario.steps.slice(Math.max(0,stepIndex-3),stepIndex+1) : [];
  const lessonVisible = stepIndex >= 0 && scenario.steps.slice(0,stepIndex+1).some(item => item.kind === "learn");

  useEffect(() => {
    if (!playing) return;
    if (stepIndex >= scenario.steps.length - 1) { setPlaying(false); return; }
    const timer = window.setTimeout(() => {
      const next = Math.min(stepIndex + 1, scenario.steps.length - 1);
      setStepIndex(next);
      setSelectedBrainId(scenario.steps[next]?.brainId ?? "ayas");
    }, 1900);
    return () => window.clearTimeout(timer);
  }, [playing,scenario.steps,stepIndex]);

  function reset(nextId: PreviewScenarioId = scenarioId) {
    setScenarioId(nextId); setStepIndex(-1); setPlaying(false); setSelectedBrainId("ayas");
  }
  function play() {
    if (isFinished || stepIndex < 0) { setStepIndex(0); setSelectedBrainId(scenario.steps[0]?.brainId ?? "ayas"); }
    setPlaying(true);
  }
  function nextStep() {
    setPlaying(false);
    const next = Math.min(stepIndex + 1, scenario.steps.length - 1);
    setStepIndex(next); setSelectedBrainId(scenario.steps[next]?.brainId ?? selectedBrainId);
  }
  function selectRoom(brainId?: PreviewBrainId, name?: string) {
    if (brainId) { setSelectedBrainId(brainId); setProfileTab("mission"); setNotice(getPreviewBrain(brainId).name + " profili açıldı."); }
    else setNotice((name ?? "Bu alan") + " yalnızca ofis görselinde gösteriliyor.");
  }
  function sandboxNotice(label: string) { setNotice(label + ": canlı bağlantı bu önizlemede kapalı."); }
  const done = (kind: string) => scenario.steps.slice(0,stepIndex+1).some(item => item.kind === kind);

  return <main className="oop-page" id="office-preview-top">
    <header className="oop-topbar">
      <div className="oop-brand"><span aria-hidden="true">∿</span> AYAS</div>
      <nav className="oop-topnav" aria-label="Üst menü">{TOP_NAV.map((label,index) =>
        <button key={label} type="button" className={topNav === label ? "is-current" : ""} onClick={() => { setTopNav(label); sandboxNotice(label); }}><span aria-hidden="true">{TOP_ICONS[index]}</span>{label}</button>)}</nav>
      <div className="oop-top-actions"><button type="button" aria-label="Ara" onClick={() => sandboxNotice("Arama")}>⌕</button><button type="button" aria-label="Bildirimler" onClick={() => sandboxNotice("Bildirimler")}>♧</button><button type="button" className="oop-user-icon" aria-label="Owner profili" onClick={() => sandboxNotice("Owner profili")}>●</button></div>
    </header>

    <div className="oop-layout">
      <aside className="oop-sidebar" aria-label="Atölye gezintisi">
        <section className="oop-side-identity"><div className="oop-side-brand"><span aria-hidden="true">∿</span><div><strong>AYAS</strong><small>Atölye Ofisi</small></div></div><div className="oop-sandbox-status"><i /> Önizleme · bağlı veri yok</div></section>
        <nav className="oop-side-menu" aria-label="Sistem menüsü">{MAIN_MENU.map(([icon,label]) =>
          <button key={label} type="button" className={label === "Atölye" ? "is-active" : ""} onClick={() => sandboxNotice(label)}><span className="oop-side-icon" aria-hidden="true">{icon}</span><span>{label}</span><span className="oop-chevron" aria-hidden="true">›</span></button>)}</nav>
        <section className="oop-side-section"><h2>ÇALIŞMA ALANLARI</h2><div className="oop-shortcuts">{SHORTCUTS.map((label,index) =>
          <button key={label} type="button" className={index === 0 ? "is-active" : ""} data-tone={index} onClick={() => sandboxNotice(label)}><span aria-hidden="true">{SHORTCUT_ICONS[index]}</span>{label}<b aria-hidden="true">›</b></button>)}</div></section>
        <section className="oop-side-section"><h2>KOMUTLAR</h2><div className="oop-commands">{COMMANDS.map(command =>
          <button key={command} type="button" onClick={() => sandboxNotice(command)}><span aria-hidden="true">⌁</span>{command}<b aria-hidden="true">›</b></button>)}</div></section>
        <p className="oop-side-footnote">ÖNİZLEME ALANI · CANLI SİSTEME BAĞLI DEĞİL</p>
      </aside>

      <section className="oop-center-column">
        <div className="oop-title-row"><span className="oop-title-line" /><h1>ATÖLYE OFİSİ</h1><span className="oop-title-line" /><button type="button" className="oop-mic-button" aria-label="Mikrofon simülasyonu" onClick={() => setNotice("Mikrofon bu izole önizlemede etkin değil.")}><span aria-hidden="true">♩</span><i /><i /><i /></button></div>
        <section className="oop-office-scene" id="office-map" aria-label="Atölye Ofisi bölümleri">
          <Image src="/office-preview/office-floor-v2.png" alt="Robot çalışanların bulunduğu geniş, cam bölmeli Atölye Ofisi" fill sizes="(max-width: 700px) 100vw, 70vw" priority unoptimized className="oop-office-image" />
          <div className="oop-scene-shade" />
          <svg className="oop-flow-arrows" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><defs><marker id="oop-arrowhead" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto"><path d="M0 0L5 2.5L0 5" /></marker></defs><path d="M50 46C50 52 50 56 50 60" markerEnd="url(#oop-arrowhead)" /><path d="M51 72C51 77 51 79 51 83" markerEnd="url(#oop-arrowhead)" /><path d="M46 64C43 61 41 57 39 52" markerEnd="url(#oop-arrowhead)" /><path d="M54 64C57 61 59 57 61 52" markerEnd="url(#oop-arrowhead)" /></svg>
          {ROOMS.map(item => <button key={item.title} type="button" className={"oop-room-label" + (room === item.room ? " is-active" : "")} style={{left:String(item.x)+"%",top:String(item.y)+"%"}} onClick={() => selectRoom(item.brain,item.room)}>{item.title}</button>)}
          {step && <button type="button" className={"oop-map-agent oop-map-agent--"+motion} style={{left:String(point.x)+"%",top:String(point.y)+"%"}} aria-label={brain.name+" profilini aç"} onClick={() => setProfileTab("mission")}><RobotRig motion={motion} /><span>{step.speakerLabel ?? brain.name.replace(" beyni","")}</span></button>}
          <div className="oop-scene-caption"><i /> AYRI SANDBOX · {step ? "Şu an: "+room : "Hareket ve konuşma örneği"}</div>
        </section>
        <section className="oop-floor-controls" aria-label="Örnek çalışma akışı">
          <div className="oop-flow-heading"><div><p>AYAS GÖREV AKIŞI</p><strong>{step ? kindLabel(step.kind) : "ÖRNEK SİMÜLASYON"}</strong></div><div className="oop-flow-actions">
            <button type="button" className="oop-play-button" onClick={play}>{playing ? "YÜRÜTÜLÜYOR…" : isFinished ? "BAŞTAN OYNAT" : stepIndex < 0 ? "ÖRNEĞİ BAŞLAT" : "DEVAM ET"}</button>
            <button type="button" className="oop-next-button" onClick={nextStep} disabled={isFinished || stepIndex < 0}>SONRAKİ ADIM</button>
            <button type="button" className="oop-reset-button" aria-label="Simülasyonu sıfırla" onClick={() => reset()}>↺</button>
          </div></div>
          <div className="oop-flow-track" aria-label="Atama, üretim, denetim, öğrenme ve owner onayı">{FLOW.map(kind => <span key={kind} className={done(kind) ? "is-done" : ""}>{kindLabel(kind)}</span>)}</div>
        </section>
      </section>

      <aside className="oop-profile-panel" aria-label="Seçili beyin profili">
        <section className="oop-profile-hero"><div className="oop-profile-robot"><RobotRig large motion={selectedBrainId === step?.brainId ? motion : "idle"} /></div><h2>{brain.name}</h2><p>{brain.department} · {statusLabel(brain.liveStatus)}</p></section>
        <div className="oop-profile-tabs" role="tablist" aria-label="Beyin bilgileri">
          <button type="button" role="tab" aria-selected={profileTab === "mission"} onClick={() => setProfileTab("mission")}><span aria-hidden="true">▤</span> GÖREVİ</button>
          <button type="button" role="tab" aria-selected={profileTab === "limits"} onClick={() => setProfileTab("limits")}><span aria-hidden="true">□</span> SINIRI</button>
          <button type="button" role="tab" aria-selected={profileTab === "reviewer"} onClick={() => setProfileTab("reviewer")}><span aria-hidden="true">⌕</span> DENETÇİ</button>
        </div>
        <section className="oop-profile-detail" aria-live="polite">
          {profileTab === "mission" && <><p className="oop-detail-kicker">SORUMLULUĞU</p><p>{brain.mission}</p><ul>{brain.allowed.slice(0,2).map(item => <li key={item}>{item}</li>)}</ul></>}
          {profileTab === "limits" && <><p className="oop-detail-kicker">İZİN SINIRLARI</p><ul>{brain.forbidden.map(item => <li key={item}>{item}</li>)}</ul></>}
          {profileTab === "reviewer" && <><p className="oop-detail-kicker">YARDIMCI DENETÇİ</p><strong>{brain.reviewerName}</strong><p>{brain.reviewerFocus}</p><ul>{brain.qualityChecks.slice(0,3).map(item => <li key={item}>{item}</li>)}</ul></>}
        </section>
        <p className="oop-profile-file">{brain.profileFile}</p>

        <section className="oop-conversation-card" aria-label="Örnek beyin konuşmaları">
          <div className="oop-conversation-heading"><div><p>KURUL VE DENETİM</p><h2>Konuşma</h2></div><span>ÖRNEK</span></div>
          <div className="oop-scenario-tabs" role="tablist" aria-label="Örnek senaryolar">{PREVIEW_SCENARIOS.map(item =>
            <button key={item.id} type="button" role="tab" aria-selected={scenarioId === item.id} onClick={() => reset(item.id)}>{item.id === "research" ? "ARAŞTIRMA" : item.id === "costume" ? "KOSTÜM" : "KOD"}</button>)}</div>
          <div className="oop-transcript" aria-live="polite" aria-relevant="additions text">
            {visibleMessages.length ? visibleMessages.map(item => <article key={item.id} className={"oop-message oop-message--"+item.kind}><header><b>{item.speakerLabel ?? getPreviewBrain(item.brainId).name}</b><span>{kindLabel(item.kind)}</span></header><p>{item.text}</p></article>) : <p className="oop-transcript-empty">Örnek görevde AYAS atama yapar, uzman çalışır; bağımsız denetçi bulguyu kontrol eder.</p>}
          </div>
          {lessonVisible && <p className="oop-lesson"><strong>Ders adayı:</strong> {scenario.lesson}<small>Yalnız bu oturumda görünür; kalıcı belleğe yazılmaz.</small></p>}
          <p className="oop-mic-note">Mikrofon, canlı model ve görev kuyruğu bu önizlemede kapalı.</p>
        </section>
      </aside>
    </div>
    {notice && <div className="oop-toast" role="status">{notice}<button type="button" aria-label="Bildirimi kapat" onClick={() => setNotice("")}>×</button></div>}
  </main>;
}
