"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { AyasGraceKind, AyasGraceView, AyasGraceViewEntry } from "@/lib/brain/autonomy/AyasGraceAutoApproval";
import { holdAyasGraceAutoApprovalAction, loadAyasGraceViewAction } from "../../../app/brain/actions";

/**
 * Grace auto-approval on one Gelişim Merkezi card (owner instruction 2026-11-19: "5 dakika orada onayda beklesin, ben
 * onay vermezsem bile kendisi işleme alsın ve onaylasın"). Everything shown comes from the executor's ledger
 * (`loadAyasGraceViewAction`): the countdown is the recorded ready time plus the wait, an excluded card says it will
 * never be approved by itself, an approved card says AYAS approved it after the wait. A card the executor has not
 * recorded yet says exactly that. "Otomatik onayı durdur" holds this exact item; it then waits for the owner.
 */

const REFRESH_MS = 30_000;
let cached: { readonly view: AyasGraceView; readonly at: number } | null = null;
let inflight: Promise<void> | null = null;
const listeners = new Set<(view: AyasGraceView) => void>();

function publish(view: AyasGraceView): void {
  cached = { view, at: Date.now() };
  for (const listener of listeners) listener(view);
}

function refresh(force = false): void {
  if (inflight || (!force && cached && Date.now() - cached.at < REFRESH_MS / 2)) return;
  inflight = loadAyasGraceViewAction().then(publish).catch(() => undefined).finally(() => { inflight = null; });
}

/** One shared read for every card on the page, refreshed while the page is visible. */
function useAyasGraceView(): AyasGraceView | null {
  const [view, setView] = useState<AyasGraceView | null>(cached?.view ?? null);
  useEffect(() => {
    listeners.add(setView);
    refresh();
    const timer = setInterval(() => { if (document.visibilityState === "visible") refresh(true); }, REFRESH_MS);
    return () => { listeners.delete(setView); clearInterval(timer); };
  }, []);
  return view;
}

const minutes = (ms: number): string => `${Math.round(ms / 60_000)} dk`;
function countdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)} dk ${total % 60} sn`;
}
const when = (iso?: string): string => (iso ? new Date(iso).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" }) : "");

export function AyasGraceAutoApprovalNotice({ kind, id, hash, liveNote, neverAuto, onlyOutcome }: {
  readonly kind: AyasGraceKind;
  readonly id: string;
  readonly hash: string | undefined;
  /** What the auto-approval leaves to the owner on this kind of card (e.g. the live publish of an update). */
  readonly liveNote?: string;
  /** Set by the card when its own state already puts it outside grace approval (e.g. a REVIEW_REQUIRED proposal). */
  readonly neverAuto?: string;
  /** On a decided or historical card: show only what AYAS itself did (approved, approving, failed), nothing else. */
  readonly onlyOutcome?: boolean;
}) {
  const view = useAyasGraceView();
  const [now, setNow] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const entry: AyasGraceViewEntry | undefined = hash ? view?.entries.find((e) => e.kind === kind && e.id === id && e.hash === hash) : undefined;
  const ticking = !!entry && entry.status === "WAITING" && !entry.held && !!entry.dueAt;

  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [ticking]);

  if (!view || !hash) return null;
  if (onlyOutcome && (!entry || (entry.status !== "APPROVED" && entry.status !== "APPROVING" && entry.status !== "FAILED"))) return null;
  const testId = `ayas-grace-${kind}-${id}`;
  const heldHere = entry?.held || view.holds.includes(`${kind}:${id}:${hash}`);
  const hold = async () => {
    setBusy(true); setMessage("");
    try {
      const result = await holdAyasGraceAutoApprovalAction({ kind, id, hash });
      publish(result.view);
      if (!result.ok) setMessage(result.code === "authentication_required" ? "Oturum doğrulanamadı; yeniden giriş yap." : "Durdurma kaydedilemedi.");
    } catch { setMessage("Durdurma kaydedilemedi."); }
    finally { setBusy(false); }
  };
  const holdButton = <button type="button" className="bc-btn bc-btn--ghost" disabled={busy} onClick={() => void hold()}>{busy ? "KAYDEDİLİYOR…" : "Otomatik onayı durdur"}</button>;
  const note = (tone: "safe" | "warn" | "danger", body: ReactNode, action?: ReactNode) => (
    <div className={`bc-dev__notice bc-dev__notice--${tone}`} data-testid={testId} role="status">
      {body}
      {action ? <div className="bc-dev__actions">{action}</div> : null}
      {message ? <p role="alert">{message}</p> : null}
    </div>
  );

  if (!view.connected) return note("warn", <p>Otomatik onay kaydı okunamadı; bu kart için onayın gerekli.</p>);
  if (entry?.status === "APPROVED") {
    return note("safe", <p><strong>Otomatik onaylandı ({minutes(view.graceMs)} bekleme)</strong> · {when(entry.approvedAt)} · Sen karar vermediğin için AYAS kendisi onayladı; denetimlerin hepsi tıklamadaki gibi çalıştı.{entry.outcome?.commitSha ? ` Commit ${entry.outcome.commitSha.slice(0, 8)}.` : ""}{liveNote ? ` ${liveNote}` : ""}</p>);
  }
  if (entry?.status === "APPROVING") return note("safe", <p><strong>AYAS bekleme süresi dolduğu için onayladı; uygulanıyor.</strong></p>);
  if (entry?.status === "FAILED") {
    return note("warn", <p><strong>Otomatik onay denendi, uygulanamadı</strong>{entry.outcome?.code ? ` (${entry.outcome.code})` : ""}. AYAS bunu bir daha kendisi denemez; karar senin.</p>);
  }
  if (heldHere) return note("safe", <p><strong>Otomatik onay durduruldu</strong> — AYAS bunu kendisi onaylamaz; karar senin.</p>);
  if (!view.enabled) return note("warn", <p>Otomatik onay kapalı (AYAS_GRACE_AUTO_APPROVE=0): onayın gerekli.</p>);
  if (entry?.status === "EXCLUDED") {
    return note("warn", <><p><strong>Bu tür otomatik onaylanmaz — onayın gerekli.</strong></p>{entry.exclusions.length ? <p>{entry.exclusions.slice(0, 2).join(" · ")}</p> : null}</>);
  }
  if (entry?.status === "WAITING" && entry.dueAt) {
    const left = Date.parse(entry.dueAt) - (now ?? Date.parse(view.generatedAt));
    return note("safe", left > 0
      ? <p><strong>{countdown(left)} içinde onaylamazsan AYAS kendisi onaylayıp uygulayacak.</strong> Reddetmek ya da ertelemek otomatik onayı durdurur.{liveNote ? ` ${liveNote}` : ""}</p>
      : <p><strong>Bekleme süresi doldu; AYAS gözlemcinin bir sonraki turunda kendisi onaylayıp uygulayacak.</strong>{liveNote ? ` ${liveNote}` : ""}</p>, holdButton);
  }
  if (neverAuto) return note("warn", <><p><strong>Bu tür otomatik onaylanmaz — onayın gerekli.</strong></p><p>{neverAuto}</p></>);
  return note("safe", <p>AYAS bu kartı henüz saymıyor: gözlemci bir sonraki turunda ya da kart güncel koda göre yenilenince {minutes(view.graceMs)} beklemeyi başlatır. O zamana kadar onayın gerekli.</p>, holdButton);
}
