import type { BrainCouncilView, CouncilMember } from "../v3/council/BrainCouncilFeed";
import type { PreviewBrainId } from "./roleTypes";

/** The office worker that sits for each V3 council member (`sef` is AYAS, the director). */
const MEMBER_TO_WORKER: Readonly<Record<CouncilMember, PreviewBrainId>> = {
  sef: "ayas",
  arastirma: "arastirma",
  kurgu: "kurgu",
  mizah: "mizah",
  kostum: "kostum",
  ortam: "ortam",
  ses: "ses",
  kalite: "kalite",
  onarim: "onarim",
  gelistirici: "gelistirici",
};

export type LiveWorkerStatus = "calisiyor" | "bekliyor";

export interface OfficeLiveView {
  /** Only workers the council feed knows about; any other worker has no live record (shown as waiting). */
  readonly statuses: Partial<Record<PreviewBrainId, LiveWorkerStatus>>;
  /** What the worker does now, or its last recorded work, in the feed's own words. */
  readonly work: Partial<Record<PreviewBrainId, string>>;
  /** The running production in one line, when one runs. */
  readonly production?: string;
}

/**
 * Owner 2026-11-26 ("yapılmayanları yap": the office was still driven only by the sample flow): map the real V3
 * council feed (orders, the running order's log, the idle loop, the evening build — `loadBrainCouncil`) onto the
 * office workers. Read-only and fail-closed: a member the feed does not list stays without a status rather than
 * being shown as working.
 */
export function officeLiveFromCouncil(view: BrainCouncilView): OfficeLiveView {
  const statuses: Partial<Record<PreviewBrainId, LiveWorkerStatus>> = {};
  const work: Partial<Record<PreviewBrainId, string>> = {};
  for (const member of view.beyinler) {
    const worker = MEMBER_TO_WORKER[member.id];
    if (!worker) continue;
    statuses[worker] = member.durum;
    if (member.is) work[worker] = member.is;
  }
  return { statuses, work, ...(view.uretim ? { production: view.uretim } : {}) };
}
