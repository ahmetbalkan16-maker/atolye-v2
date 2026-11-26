"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { PREVIEW_BRAINS, getPreviewBrain } from "@/lib/office-preview/brains";
import { PREVIEW_SCENARIOS, type PreviewScenarioId } from "@/lib/office-preview/scenarios";
import type { PreviewBrainId, PreviewBrainProfile } from "@/lib/office-preview/roleTypes";

const ROOM_POINTS: Readonly<Record<string, { x: number; y: number }>> = {
  "Yönetim": { x: 49, y: 54 },
  "Araştırma": { x: 39, y: 37 },
  "Kostüm": { x: 19, y: 42 },
  "Üretim": { x: 83, y: 42 },
  "Toplantı": { x: 69, y: 25 },
  "Kalite kontrol": { x: 70, y: 56 },
  "Geliştirici masası": { x: 85, y: 52 },
};

const ROOM_LABELS = [
  { title: "KOSTÜM", room: "Kostüm", x: 18, y: 27 },
  { title: "ARAŞTIRMA", room: "Araştırma", x: 42, y: 27 },
  { title: "ÜRETİM", room: "Üretim", x: 83, y: 31 },
  { title: "TOPLANTI", room: "Toplantı", x: 69, y: 18 },
  { title: "DİNLENME", room: "Dinlenme", x: 82, y: 77 },
];

function statusLabel(status: PreviewBrainProfile["liveStatus"]): string {
  if (status === "planlanan") return "Canlıda planlanan";
  if (status === "koşullu") return "Canlıda koşullu";
  return "Canlı rolden";
}

function stepKindLabel(kind: string): string {
  const labels: Record<string, string> = {
    assign: "ATAMA",
    work: "ÇALIŞMA",
    review: "DENETİM",
    rework: "DÜZELTME",
    verify: "YENİDEN KONTROL",
    learn: "DERS ADAYI",
    owner: "OWNER KAPISI",
  };
  return labels[kind] ?? "SİMÜLASYON";
}

export function AtolyeOfficePreview() {
  const [scenarioId, setScenarioId] = useState<PreviewScenarioId>("research");
  const [selectedBrainId, setSelectedBrainId] = useState<PreviewBrainId>("arastirma");
  const [stepIndex, setStepIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const scenario = PREVIEW_SCENARIOS.find((item) => item.id === scenarioId) ?? PREVIEW_SCENARIOS[0]!;
  const currentStep = stepIndex >= 0 ? scenario.steps[stepIndex] : undefined;
  const selectedBrain = getPreviewBrain(selectedBrainId);
  const activeBrainId = currentStep?.brainId;
  const activeRoom = currentStep?.room;
  const activePoint = activeRoom ? ROOM_POINTS[activeRoom] : undefined;
  const visibleMessages = stepIndex >= 0 ? scenario.steps.slice(0, stepIndex + 1) : [];
  const finished = stepIndex >= scenario.steps.length - 1;

  useEffect(() => {
    if (!playing) return;
    if (stepIndex >= scenario.steps.length - 1) {
      setPlaying(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setStepIndex((current) => Math.min(current + 1, scenario.steps.length - 1));
    }, 2100);
    return () => window.clearTimeout(timer);
  }, [playing, scenario.steps.length, stepIndex]);

  function resetScenario(nextId: PreviewScenarioId = scenarioId) {
    const next = PREVIEW_SCENARIOS.find((item) => item.id === nextId) ?? PREVIEW_SCENARIOS[0]!;
    setScenarioId(nextId);
    setStepIndex(-1);
    setPlaying(false);
    setSelectedBrainId(next.assignedBrain);
  }

  function playScenario() {
    if (finished) {
      setStepIndex(0);
      setSelectedBrainId(scenario.steps[0]?.brainId ?? scenario.assignedBrain);
    } else if (stepIndex < 0) {
      setStepIndex(0);
      setSelectedBrainId(scenario.steps[0]?.brainId ?? scenario.assignedBrain);
    }
    setPlaying(true);
  }

  function advanceOneStep() {
    setPlaying(false);
    setStepIndex((current) => Math.min(current + 1, scenario.steps.length - 1));
  }

  const flowKinds = ["assign", "work", "review", "verify", "learn", "owner"] as const;
  const stepHasKind = (kind: string) => scenario.steps.slice(0, stepIndex + 1).some((step) => step.kind === kind);

  return (
    <main className="oop-page">
      <header className="oop-header">
        <div>
          <a className="oop-back" href="/studio">← Atölye’ye dön</a>
          <div className="oop-title-row"><span className="oop-title-mark" aria-hidden="true">∿</span><div><p className="oop-eyebrow">AYAS · ÖNİZLEME LABORATUVARI</p><h1>Atölye Ofisi</h1></div></div>
        </div>
        <div className="oop-live-pill"><span /> AYRI SANDBOX</div>
      </header>

      <aside className="oop-sandbox-notice" role="note">
        <span className="oop-notice-icon" aria-hidden="true">i</span>
        <div><strong>Simülasyon alanı</strong><p>Konuşmalar ve hareketler örnek akıştır. Canlı beyin, mikrofon, görev kuyruğu, kalıcı hafıza, dosya yazımı, harcama ve yayın bağlantısı kapalıdır.</p></div>
      </aside>

      <section className="oop-scenario-section" aria-label="Demo senaryosu seç">
        <div className="oop-section-heading"><div><p className="oop-eyebrow">ÖRNEK İŞ AKIŞI</p><h2>Bir senaryo seç</h2></div><span className="oop-scenario-note">Adımlar otomatik ilerler; istersen tek tek yürüt.</span></div>
        <div className="oop-scenarios" role="tablist" aria-label="Simülasyon senaryoları">
          {PREVIEW_SCENARIOS.map((item) => (
            <button key={item.id} type="button" role="tab" aria-selected={scenarioId === item.id} className={`oop-scenario-tab${scenarioId === item.id ? " is-selected" : ""}`} onClick={() => resetScenario(item.id)}>
              <span>{item.title}</span><small>{item.summary}</small>
            </button>
          ))}
        </div>
      </section>

      <section className="oop-main-grid">
        <div className="oop-left-column">
          <section className="oop-office-card" aria-label="Atölye ofis haritası">
            <div className="oop-card-heading"><div><p className="oop-eyebrow">DEPARTMANLAR</p><h2>Ofis görünümü</h2></div><span className="oop-motion-key"><i /> Çalışan rol simülasyonu</span></div>
            <div className="oop-office-scene">
              <Image src="/office-preview/office.png" alt="Atölye Ofisi için gerçekçi, bölümlere ayrılmış örnek ofis" fill sizes="(max-width: 900px) 100vw, 68vw" priority className="oop-office-image" />
              <div className="oop-scene-shade" />
              {ROOM_LABELS.map((room) => (
                <button key={room.title} type="button" className={`oop-room-label${activeRoom === room.room ? " is-active" : ""}`} style={{ left: `${room.x}%`, top: `${room.y}%` }} onClick={() => {
                  const match = PREVIEW_BRAINS.find((brain) => brain.room === room.room);
                  if (match) setSelectedBrainId(match.id);
                }}>{room.title}</button>
              ))}
              <div className="oop-marker-layer">
                {(["ayas", "arastirma", "kostum", "kalite", "gelistirici"] as const).map((id) => {
                  const profile = getPreviewBrain(id);
                  const point = ROOM_POINTS[profile.room] ?? ROOM_POINTS["Yönetim"]!;
                  return <button key={id} type="button" className={`oop-person${selectedBrainId === id ? " is-selected" : ""}${activeBrainId === id ? " is-speaking" : ""}`} style={{ left: `${point.x}%`, top: `${point.y}%` }} aria-label={`${profile.name} profilini aç`} onClick={() => setSelectedBrainId(id)}><span className="oop-person__orb"><i /></span><span>{profile.name.replace(" beyni", "")}</span></button>;
                })}
                {activePoint && currentStep ? <div className="oop-moving-robot" style={{ left: `${activePoint.x}%`, top: `${activePoint.y}%` }} aria-hidden="true"><span className="oop-robot-face"><i /></span><small>{currentStep.speakerLabel ?? getPreviewBrain(currentStep.brainId).name}</small></div> : null}
              </div>
              <div className="oop-scene-caption"><span className="oop-scene-live-dot" /> {activeRoom ? `Simülasyon konumu · ${activeRoom}` : "Simülasyon başlatılmayı bekliyor"}</div>
            </div>
            <div className="oop-roster-heading"><h3>Beyin kadrosu</h3><span>Profil dosyaları ayrı · ortak görev akışı</span></div>
            <div className="oop-roster">
              {PREVIEW_BRAINS.map((profile) => (
                <button key={profile.id} type="button" className={`oop-roster-chip${selectedBrainId === profile.id ? " is-selected" : ""}`} onClick={() => setSelectedBrainId(profile.id)}>
                  <span className="oop-roster-dot" data-status={profile.liveStatus} />{profile.name}<small>{statusLabel(profile.liveStatus)}</small>
                </button>
              ))}
            </div>
          </section>

          <section className="oop-profile-card" aria-label={`${selectedBrain.name} görev profili`}>
            <div className="oop-profile-heading"><div><p className="oop-eyebrow">SEÇİLİ BEYİN · {statusLabel(selectedBrain.liveStatus).toUpperCase()}</p><h2>{selectedBrain.name}</h2><p>{selectedBrain.mission}</p></div><span className="oop-profile-file">{selectedBrain.profileFile}</span></div>
            <div className="oop-profile-grid">
              <div><h3>Yapabilir</h3><ul>{selectedBrain.allowed.map((item) => <li key={item}>{item}</li>)}</ul></div>
              <div><h3>Sınırları</h3><ul>{selectedBrain.forbidden.map((item) => <li key={item}>{item}</li>)}</ul></div>
              <div><h3>Kalite kontrolü</h3><ul>{selectedBrain.qualityChecks.map((item) => <li key={item}>{item}</li>)}</ul></div>
              <div><h3>Yardımcı denetçi</h3><p className="oop-reviewer-name">{selectedBrain.reviewerName}</p><p>{selectedBrain.reviewerFocus}</p></div>
            </div>
            <p className="oop-memory-note"><strong>Hafıza:</strong> {selectedBrain.memoryRule}</p>
          </section>
        </div>

        <aside className="oop-right-column">
          <section className="oop-conversation-card" aria-label="Simülasyon konuşması">
            <div className="oop-card-heading"><div><p className="oop-eyebrow">KURUL VE DENETİM</p><h2>Konuşma akışı</h2></div><span className="oop-demo-badge">ÖRNEK</span></div>
            <div className="oop-controls">
              <button type="button" className="oop-primary-button" onClick={playScenario}>{playing ? "Çalışıyor…" : finished ? "Baştan oynat" : stepIndex < 0 ? "Senaryoyu başlat" : "Devam et"}</button>
              <button type="button" className="oop-secondary-button" onClick={advanceOneStep} disabled={finished || stepIndex < 0}>Sonraki adım</button>
              <button type="button" className="oop-icon-button" onClick={() => resetScenario()} aria-label="Simülasyonu sıfırla">↺</button>
            </div>
            <div className="oop-flow" aria-label="Görev durumu">
              {flowKinds.map((kind) => <span key={kind} className={stepHasKind(kind) ? "is-done" : ""}>{stepKindLabel(kind)}</span>)}
            </div>
            <div className="oop-transcript" aria-live="polite" aria-relevant="additions text">
              {visibleMessages.length ? visibleMessages.map((step) => {
                const profile = getPreviewBrain(step.brainId);
                return <article key={step.id} className={`oop-message oop-message--${step.kind}`}><header><span className="oop-message-avatar">{profile.name.slice(0, 1)}</span><strong>{step.speakerLabel ?? profile.name}</strong><span className="oop-message-kind">{stepKindLabel(step.kind)}</span></header><p>{step.text}</p></article>;
              }) : <div className="oop-transcript-empty"><span>◌</span><strong>Henüz simülasyon başlamadı</strong><p>Senaryoyu başlat; AYAS görevi dağıtsın, uzman beyin ve denetçi sırayla konuşsun.</p></div>}
            </div>
            <div className="oop-mic-note"><span aria-hidden="true">♩</span><p>Mikrofon bu sandbox'ta canlıya bağlı değil. Sesli AYAS bağlantısı daha sonra, onaylı entegrasyon aşamasında ele alınır.</p></div>
          </section>

          <section className="oop-learning-card">
            <div className="oop-card-heading"><div><p className="oop-eyebrow">GERİ BİLDİRİM</p><h2>Ders çıkarma</h2></div><span className="oop-session-tag">OTURUM İÇİ</span></div>
            {stepIndex >= 0 && scenario.steps.slice(0, stepIndex + 1).some((step) => step.kind === "learn") ? <><p className="oop-lesson">{scenario.lesson}</p><p className="oop-temporary-note">Ders adayı görüntüleniyor. Sayfayı yenileyince silinir; gerçek beyin hafızasına yazılmaz.</p></> : <p className="oop-learning-empty">Denetim ve düzeltme adımları tamamlanınca örnek ders burada görünür.</p>}
          </section>

          <section className="oop-gates-card">
            <p className="oop-eyebrow">CANLIYA ALMA KAPILARI</p>
            <ul><li><span>01</span> Her beyin yalnız profilindeki kapsamda çalışır</li><li><span>02</span> Denetçi, işi yapan rolden ayrıdır</li><li><span>03</span> Kalıcı öğrenme ölçüm ve onay ister</li><li><span>04</span> Kod ve yayın owner kararını bekler</li></ul>
          </section>
        </aside>
      </section>
    </main>
  );
}
