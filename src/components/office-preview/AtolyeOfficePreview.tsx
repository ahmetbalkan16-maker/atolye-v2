"use client";

import { useEffect, useState } from "react";
import { getPreviewBrain } from "@/lib/office-preview/brains";
import { PREVIEW_SCENARIOS, type PreviewDialogueStep, type PreviewScenarioId } from "@/lib/office-preview/scenarios";
import type { PreviewBrainId, PreviewBrainProfile } from "@/lib/office-preview/roleTypes";
import { AUTHORITY_LABEL, AYAS_VOICE_HREF, getRoom, getRosterEntry, roomHref } from "@/lib/office-preview/officeRoster";
import { AtolyeOffice3DScene, type OfficeWorkerStatus } from "./AtolyeOffice3DScene";
import { officeLiveFromCouncil, type OfficeLiveView } from "@/lib/office-preview/liveStatus";
import { readOfficeCouncil } from "../../../app/studio/office-preview/actions";

const LIVE_REFRESH_MS = 30_000;

type Motion = "idle" | "walk" | "work" | "review";
type ProfileTab = "mission" | "limits" | "reviewer";
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
/** Sample status of every brain at a scripted step: earlier speakers are done, the current speaker is busy. */
function statusesAt(steps: readonly PreviewDialogueStep[], stepIndex: number): Partial<Record<PreviewBrainId, OfficeWorkerStatus>> {
  const out: Partial<Record<PreviewBrainId, OfficeWorkerStatus>> = {};
  if (stepIndex < 0) return out;
  for (const item of steps.slice(0, stepIndex)) out[item.brainId] = "bitti";
  const current = steps[stepIndex];
  if (!current) return out;
  out[current.brainId] = current.kind === "assign" || current.kind === "owner" ? "yonetiyor"
    : current.kind === "review" || current.kind === "verify" ? "denetliyor"
      : "calisiyor";
  return out;
}
function motionFor(step?: PreviewDialogueStep): Motion {
  if (!step) return "idle";
  if (step.kind === "work" || step.kind === "rework" || step.kind === "learn") return "work";
  if (step.kind === "review" || step.kind === "verify") return "review";
  if (step.kind === "assign" || step.kind === "owner") return "walk";
  return "idle";
}

/** Human joint diagram for the selected profile; small CSS motion keeps the profile lightweight. */
function HumanRig({ motion = "idle", large = false, brainId }: { motion?: Motion; large?: boolean; brainId: PreviewBrainId }) {
  const isManager = brainId === "ayas";
  const isAccountant = brainId === "muhasebe";
  const isEditor = brainId === "kurgu" || brainId === "gelistirici";
  const isTailor = brainId === "kostum";
  const roleStyle = isManager ? "manager" : isAccountant ? "accountant" : isEditor ? "editor" : isTailor ? "tailor" : "staff";
  return <svg className={"oop-rig oop-rig--human oop-rig--" + roleStyle + " oop-rig--" + motion + (large ? " oop-rig--large" : "")} viewBox="0 0 72 88" aria-hidden="true">
    <ellipse className="rig-shadow" cx="36" cy="83" rx="19" ry="4" />
    <g className="rig-leg rig-leg-left"><path className="rig-trouser" d="M31 54L29 68" /><g className="rig-shin rig-shin-left"><path className="rig-trouser" d="M29 68L27 79" /><path className="rig-foot" d="M27 79L21 81" /></g></g>
    <g className="rig-leg rig-leg-right"><path className="rig-trouser" d="M41 54L43 68" /><g className="rig-shin rig-shin-right"><path className="rig-trouser" d="M43 68L45 79" /><path className="rig-foot" d="M45 79L51 81" /></g></g>
    <g className="rig-torso">
      <path className="rig-jacket" d="M25 31Q29 27 34 27L36 33L39 27Q44 27 48 31L50 51Q43 57 36 56Q29 57 22 51Z" />
      <path className="rig-shirt" d="M33 29L36 34L39 29L41 47L36 50L31 47Z" />
      {isManager && <path className="rig-tie" d="M35 34L37 34L38 44L36 48L34 44Z" />}
      {isTailor && <path className="rig-apron" d="M27 37L45 37L44 54L28 54Z" />}
      {isEditor && <path className="rig-hood" d="M30 30Q36 23 42 30" />}
    </g>
    <g className="rig-arm rig-arm-left"><path className="rig-sleeve" d="M26 33L17 43" /><g className="rig-forearm rig-forearm-left"><path className="rig-skin" d="M17 43L15 53" /><circle className="rig-hand" cx="15" cy="54" r="2.2" /></g></g>
    <g className="rig-arm rig-arm-right"><path className="rig-sleeve" d="M46 33L55 43" /><g className="rig-forearm rig-forearm-right"><path className="rig-skin" d="M55 43L57 53" /><circle className="rig-hand" cx="57" cy="54" r="2.2" /></g></g>
    <path className="rig-neck" d="M34 28L34 24M38 28L38 24" />
    <g className="rig-head">
      <ellipse className="rig-face" cx="36" cy="16" rx="10" ry="12" />
      <path className="rig-hair" d="M26 15Q25 4 36 4Q47 4 46 15L42 12L39 9L34 12L29 11Z" />
      {isManager && <path className="rig-beard" d="M28 19Q36 22 44 19Q43 28 36 28Q29 27 28 19Z" />}
      <circle className="rig-eye" cx="32.5" cy="15" r="1.1" /><circle className="rig-eye" cx="39.5" cy="15" r="1.1" />
      {isAccountant && <><circle className="rig-glasses" cx="32.5" cy="15" r="3" /><circle className="rig-glasses" cx="39.5" cy="15" r="3" /><path className="rig-glasses" d="M35.5 15H36.5" /></>}
      {!isManager && <path className="rig-smile" d="M33 21Q36 23 39 21" />}
    </g>
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
  const roster = getRosterEntry(selectedBrainId);
  const reportsTo = roster.reportsTo === "owner" ? "Sahip (sen)" : getPreviewBrain(roster.reportsTo).name;
  const room = getRoom(roster.roomSlug);
  const motion = motionFor(step);
  const isFinished = stepIndex >= scenario.steps.length - 1;
  const visibleMessages = stepIndex >= 0 ? scenario.steps.slice(Math.max(0,stepIndex-3),stepIndex+1) : [];
  const lessonVisible = stepIndex >= 0 && scenario.steps.slice(0,stepIndex+1).some(item => item.kind === "learn");
  const [live,setLive] = useState<OfficeLiveView | null>(null);
  const [liveFailed,setLiveFailed] = useState(false);
  // Real worker states from the V3 council feed (read-only observer action), refreshed while the page is visible.
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      if (document.hidden) return;
      readOfficeCouncil()
        .then(view => { if (!cancelled) { setLive(officeLiveFromCouncil(view)); setLiveFailed(false); } })
        .catch(() => { if (!cancelled) setLiveFailed(true); });
    };
    const first = window.setTimeout(load, 0);
    const timer = window.setInterval(load, LIVE_REFRESH_MS);
    return () => { cancelled = true; window.clearTimeout(first); window.clearInterval(timer); };
  }, []);
  const sampleRunning = stepIndex >= 0;
  const statuses: Partial<Record<PreviewBrainId, OfficeWorkerStatus>> = sampleRunning ? statusesAt(scenario.steps, stepIndex) : (live?.statuses ?? {});
  const sourceLabel = sampleRunning ? "ÖRNEK AKIŞ OYNUYOR" : live ? "CANLI · SİSTEMDEN OKUNUYOR" + (live.production ? " · " + live.production : "") : liveFailed ? "CANLI VERİ OKUNAMADI" : "CANLI VERİ BEKLENİYOR";
  const liveWork = live?.work[selectedBrainId];

  useEffect(() => {
    if (!playing) return;
    const atEnd = stepIndex >= scenario.steps.length - 1;
    const timer = window.setTimeout(() => {
      if (atEnd) { setPlaying(false); return; }
      const next = Math.min(stepIndex + 1, scenario.steps.length - 1);
      setStepIndex(next);
      setSelectedBrainId(scenario.steps[next]?.brainId ?? "ayas");
    }, atEnd ? 0 : 1900);
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
  function selectWorker(brainId: PreviewBrainId) {
    // Owner 2026-11-26: "ayasa tıkladığımda … konuşmanın aktif olmasını istiyorum" — AYAS opens the real voice chat.
    if (brainId === "ayas") { setNotice("AYAS ile sesli konuşma açılıyor…"); window.location.assign(AYAS_VOICE_HREF); return; }
    const selected = getPreviewBrain(brainId);
    setSelectedBrainId(brainId); setProfileTab("mission"); setNotice(selected.name + " profili açıldı.");
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
        <section className="oop-side-identity"><div className="oop-side-brand"><span aria-hidden="true">∿</span><div><strong>AYAS</strong><small>Atölye Ofisi</small></div></div><div className="oop-sandbox-status"><i /> Durumlar canlı · kadro taslak</div></section>
        <nav className="oop-side-menu" aria-label="Sistem menüsü">{MAIN_MENU.map(([icon,label]) =>
          <button key={label} type="button" className={label === "Atölye" ? "is-active" : ""} onClick={() => sandboxNotice(label)}><span className="oop-side-icon" aria-hidden="true">{icon}</span><span>{label}</span><span className="oop-chevron" aria-hidden="true">›</span></button>)}</nav>
        <section className="oop-side-section"><h2>ÇALIŞMA ALANLARI</h2><div className="oop-shortcuts">{SHORTCUTS.map((label,index) =>
          <button key={label} type="button" className={index === 0 ? "is-active" : ""} data-tone={index} onClick={() => sandboxNotice(label)}><span aria-hidden="true">{SHORTCUT_ICONS[index]}</span>{label}<b aria-hidden="true">›</b></button>)}</div></section>
        <section className="oop-side-section"><h2>KOMUTLAR</h2><div className="oop-commands">{COMMANDS.map(command =>
          <button key={command} type="button" onClick={() => sandboxNotice(command)}><span aria-hidden="true">⌁</span>{command}<b aria-hidden="true">›</b></button>)}</div></section>
        <p className="oop-side-footnote">ÇALIŞAN DURUMLARI CANLI · ÖRNEK AKIŞ VE KADRO TASLAK</p>
      </aside>

      <section className="oop-center-column">
        <div className="oop-title-row"><span className="oop-title-line" /><h1>ATÖLYE OFİSİ</h1><span className="oop-title-line" /><button type="button" className="oop-mic-button" aria-label="Mikrofon simülasyonu" onClick={() => setNotice("Mikrofon bu izole önizlemede etkin değil.")}><span aria-hidden="true">♩</span><i /><i /><i /></button></div>
        <section className="oop-office-scene" id="office-map" aria-label="Atölye Ofisi bölümleri">
          <AtolyeOffice3DScene selectedBrainId={selectedBrainId} onSelectBrain={selectWorker} statuses={statuses} sourceLabel={sourceLabel} />
          {step && <div className="oop-scene-caption"><i /> ÖRNEK GÖREV · {step.room}</div>}
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
        <section className="oop-profile-hero"><div className="oop-profile-avatar"><HumanRig large brainId={selectedBrainId} motion={selectedBrainId === step?.brainId ? motion : "idle"} /></div><h2>{brain.name}</h2><p>{brain.department} · {statusLabel(brain.liveStatus)}</p></section>
        <div className="oop-profile-tabs" role="tablist" aria-label="Beyin bilgileri">
          <button type="button" role="tab" aria-selected={profileTab === "mission"} onClick={() => setProfileTab("mission")}><span aria-hidden="true">▤</span> GÖREVİ</button>
          <button type="button" role="tab" aria-selected={profileTab === "limits"} onClick={() => setProfileTab("limits")}><span aria-hidden="true">□</span> SINIRI</button>
          <button type="button" role="tab" aria-selected={profileTab === "reviewer"} onClick={() => setProfileTab("reviewer")}><span aria-hidden="true">⌕</span> DENETÇİ</button>
        </div>
        <section className="oop-profile-detail" aria-live="polite">
          {profileTab === "mission" && <><p className="oop-detail-kicker">SORUMLULUĞU</p><p>{brain.mission}</p><ul>{brain.allowed.slice(0,2).map(item => <li key={item}>{item}</li>)}</ul>
            <dl className="oop-chain"><dt>Rapor verir</dt><dd>{reportsTo}</dd><dt>Yetkisi</dt><dd>{AUTHORITY_LABEL[roster.authority]}</dd>{liveWork && <><dt>Şu an</dt><dd>{liveWork}</dd></>}</dl></>}
          {profileTab === "limits" && <><p className="oop-detail-kicker">YAPAMAZ</p><ul>{brain.forbidden.map(item => <li key={item}>{item}</li>)}</ul>
            {roster.ownerGate.length > 0 && <><p className="oop-detail-kicker">SAHİP ONAYI İSTER</p><ul>{roster.ownerGate.map(item => <li key={item}>{item}</li>)}</ul></>}</>}
          {profileTab === "reviewer" && <><p className="oop-detail-kicker">BAĞIMSIZ DENETÇİSİ · SORGULAR</p><strong>{roster.auditor.name}</strong><ul>{roster.auditor.questions.map(item => <li key={item}>{item}</li>)}</ul>
            <p className="oop-detail-kicker">{roster.qualityGate ? "SONRA KALİTE BEYNİ ÖLÇER" : "KENDİ İŞİNE NOT VEREMEZ"}</p><ul>{brain.qualityChecks.slice(0,3).map(item => <li key={item}>{item}</li>)}</ul></>}
        </section>
        <div className="oop-profile-links">
          <a className="oop-open-real" href={roster.opens.href}>{roster.opens.label} ›</a>
          {room && <a className="oop-open-room" href={roomHref(room.slug)}>{room.name} odası ›</a>}
        </div>
        <p className="oop-profile-file">{brain.profileFile}</p>

        <section className="oop-conversation-card" aria-label="Örnek beyin konuşmaları">
          <div className="oop-conversation-heading"><div><p>KURUL VE DENETİM</p><h2>Konuşma</h2></div><span>ÖRNEK</span></div>
          <div className="oop-scenario-tabs" role="tablist" aria-label="Örnek senaryolar">{PREVIEW_SCENARIOS.map(item =>
            <button key={item.id} type="button" role="tab" aria-selected={scenarioId === item.id} onClick={() => reset(item.id)}>{item.id === "research" ? "ARAŞTIRMA" : item.id === "costume" ? "KOSTÜM" : "KOD"}</button>)}</div>
          <div className="oop-transcript" aria-live="polite" aria-relevant="additions text">
            {visibleMessages.length ? visibleMessages.map(item => <article key={item.id} className={"oop-message oop-message--"+item.kind}><header><b>{item.speakerLabel ?? getPreviewBrain(item.brainId).name}</b><span>{kindLabel(item.kind)}</span></header><p>{item.text}</p></article>) : <p className="oop-transcript-empty">Örnek görevde AYAS atama yapar, uzman çalışır; bağımsız denetçi bulguyu kontrol eder.</p>}
          </div>
          {lessonVisible && <p className="oop-lesson"><strong>Ders adayı:</strong> {scenario.lesson}<small>Yalnız bu oturumda görünür; kalıcı belleğe yazılmaz.</small></p>}
          <p className="oop-mic-note">Konuşmalar örnek; AYAS ile gerçek sesli konuşma için AYAS&apos;a tıkla.</p>
        </section>
      </aside>
    </div>
    {notice && <div className="oop-toast" role="status">{notice}<button type="button" aria-label="Bildirimi kapat" onClick={() => setNotice("")}>×</button></div>}
  </main>;
}
