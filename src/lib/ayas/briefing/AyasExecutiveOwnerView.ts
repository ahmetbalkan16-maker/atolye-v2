/**
 * Stage 15T — the alert part of the owner view. It never throws for alert metadata: an unreadable history, a
 * clock behind the stored history or a refused write shows the briefing with persistence UNAVAILABLE, and
 * nothing is marked eligible. A durable write happens only for an authenticated owner refresh outside
 * SAFE_READ_ONLY. No source reader, approval or execution is imported here.
 */
import { ayasSafeModeHold } from "../safety/AyasSafeModeReader";
import type { buildAyasExecutiveBriefing } from "./AyasExecutiveBriefing";
import { observeDurableAyasExecutiveSignals, readAyasExecutiveAlerts } from "./AyasExecutiveAlertStore";
import { emptyAyasExecutiveAlerts, observeAyasExecutiveSignals, executiveNotificationEligible, type AyasExecutiveAlert } from "./AyasExecutiveAlerts";
export interface AyasExecutiveAlertView extends AyasExecutiveAlert { readonly notificationEligible: boolean }
export type AyasExecutiveBriefingView = ReturnType<typeof buildAyasExecutiveBriefing>;
export type AyasExecutiveOwnerView = AyasExecutiveBriefingView & {
  readonly persistence: "VERIFIED" | "PREVIEW" | "UNAVAILABLE" | "HELD_BY_SAFE_MODE";
  readonly alerts: readonly AyasExecutiveAlertView[]; readonly ownerAuthenticated: boolean;
};
export function projectAyasExecutiveOwnerView(input: { readonly briefing: AyasExecutiveBriefingView; readonly repoRoot: string; readonly now: string;
  readonly synchronize: boolean; readonly ownerAuthenticated: boolean }): AyasExecutiveOwnerView {
  const { briefing, repoRoot, now } = input, read = readAyasExecutiveAlerts(repoRoot);
  const base = read.status === "UNAVAILABLE" ? emptyAyasExecutiveAlerts() : read.state;
  let persistence: AyasExecutiveOwnerView["persistence"] = read.status === "UNAVAILABLE" ? "UNAVAILABLE" : "PREVIEW", state = base;
  try { state = observeAyasExecutiveSignals(base, briefing.signals, briefing.covered, now); }
  catch { persistence = "UNAVAILABLE"; }
  if (persistence === "PREVIEW") {
    if (ayasSafeModeHold(repoRoot)) persistence = "HELD_BY_SAFE_MODE";
    else if (input.synchronize && input.ownerAuthenticated) {
      try { state = observeDurableAyasExecutiveSignals({ repoRoot, signals: briefing.signals, covered: briefing.covered, at: now }).state; persistence = "VERIFIED"; }
      catch { persistence = "UNAVAILABLE"; }
    }
  }
  return { ...briefing, persistence, ownerAuthenticated: input.ownerAuthenticated,
    alerts: state.alerts.filter(a => a.active).map(a => ({ ...a, notificationEligible: persistence === "VERIFIED" && executiveNotificationEligible(a, now) })) };
}
