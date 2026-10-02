import { resolveAccessGate } from "../../../src/lib/auth/accessGate";
import { readAyasSafeMode } from "../../../src/lib/ayas/safety/AyasSafeModeReader";
import { collectAyasSafeModeExitHealth } from "../../../src/lib/ayas/safety/AyasSafeModeStore";
import { enterSafeReadOnly, exitSafeReadOnly } from "./actions";

export const dynamic = "force-dynamic";

const CHECK_LABEL: Readonly<Record<string, string>> = {
  "owner-constitution": "Owner Constitution okunabiliyor",
  "execution-gate": "Execution gate kapalı",
  "self-improvement-gate": "Self-improvement gate kapalı",
  "machine-health": "Makine sağlığı yeni iş başlatmaya uygun",
  "resource-occupancy": "Kaynak envanteri okunabiliyor",
};

export default async function SafeModePage() {
  const state = readAyasSafeMode(process.cwd());
  const ownerAuthenticationReady = resolveAccessGate(process.env).mode === "enforced";
  // The checks are read now, for this render; the exit action reads them again itself.
  const health = state.state === "SAFE_READ_ONLY" ? await collectAyasSafeModeExitHealth(process.cwd()) : [];
  const healthy = health.length > 0 && health.every((check) => check.ok);
  return <main className="mx-auto max-w-3xl space-y-6 p-6 text-slate-100">
    <a href="/brain" className="text-sky-300">AYAS Console</a>
    <h1 className="text-2xl font-semibold">Güvenli Salt-Okunur Mod (SAFE_READ_ONLY)</h1>
    <p>Acil durdurma. Mod açıkken AYAS yalnızca okur ve konuşur; moddan yalnızca owner, sağlık kontrolleri geçerken çıkarır.</p>
    <p role="status" className="rounded bg-slate-900 p-3">
      {state.state === "NORMAL" ? "Durum: NORMAL — mod kapalı."
        : state.state === "SAFE_READ_ONLY" ? `Durum: SAFE_READ_ONLY — ${state.enteredAt} tarihinde açıldı (${state.actor === "OWNER_SESSION" ? "owner oturumu" : "yerel operatör"}).`
        : `Durum: DOĞRULANAMIYOR (${state.reason}) — mod açıkmış gibi davranılır. Kayıt klasörü owner tarafından incelenmeli: data/brain/execution/safe-mode`}
    </p>
    <div className="grid gap-6 sm:grid-cols-2">
      <section>
        <h2 className="font-semibold">Açık kalır</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Sohbet ve durum</li>
          <li>Salt-okunur araçlar ve araştırma</li>
        </ul>
      </section>
      <section>
        <h2 className="font-semibold">Durur</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Kaynak kod yazımı ve onaylı değişikliklerin uygulanması</li>
          <li>Yeni üretim aşamaları ve üretim verisi değişiklikleri</li>
          <li>Yayın ve dış platforma yazma</li>
          <li>Harcama ve yeni maliyet rezervasyonu</li>
          <li>Self-evolution deneyleri ve zamanlanmış ağır işler</li>
        </ul>
      </section>
    </div>
    <p className="text-sm text-slate-400">Çalışmakta olan bir üretim aşaması yarıda kesilmez; yeni aşama başlamaz.</p>
    {state.state === "NORMAL" && <form action={enterSafeReadOnly}>
      <button type="submit" className="rounded bg-amber-600 px-4 py-2 font-semibold">SAFE_READ_ONLY moduna geç</button>
    </form>}
    {state.state === "SAFE_READ_ONLY" && <section className="space-y-3">
      <h2 className="font-semibold">Çıkış için güncel sağlık kontrolleri</h2>
      <ul className="space-y-1">
        {health.map((check) => <li key={check.id} className={check.ok ? "text-emerald-300" : "text-rose-300"}>
          {check.ok ? "✓" : "✗"} {CHECK_LABEL[check.id] ?? check.id} <span className="font-mono text-xs text-slate-400">{check.code}</span>
        </li>)}
      </ul>
      <form action={exitSafeReadOnly}>
        <input type="hidden" name="modeDigest" value={state.lastDigest} />
        <button type="submit" disabled={!ownerAuthenticationReady || !healthy} className="rounded bg-sky-600 px-4 py-2 disabled:opacity-40">Owner olarak moddan çık</button>
      </form>
      {!ownerAuthenticationReady && <p>Çıkış için yapılandırılmış owner erişimi ve geçerli oturum gerekir.</p>}
      {ownerAuthenticationReady && !healthy && <p>Kırmızı kontroller geçmeden moddan çıkılamaz.</p>}
    </section>}
  </main>;
}
