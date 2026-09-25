/**
 * Stage 11 — the recorded outcome of the most recent AYAS security review
 * (Stage 9, `docs/AYAS_SECURITY_SUPPLY_CHAIN.md`), as typed data the Brain
 * Control Center can show.
 *
 * This is a record of a review that already happened, not a live scan: the
 * Control Center labels it with its date and commit and never runs a scanner
 * on page load. `scripts/smoke-ayas-brain-control-center.ts` pins every
 * deferred check against the security doc, so the two cannot drift silently.
 * Update this record in the same change as the doc whenever a new security
 * review closes.
 */

export interface AyasSecurityDeferredCheck {
  readonly id: string;
  /** Short Turkish label for the owner. */
  readonly label: string;
  /** Why it is still open; a documented limitation, not a newly found issue. */
  readonly reason: string;
  /** A phrase that must appear in the security doc (pinned by test). */
  readonly docPhrase: string;
}

export interface AyasSecurityReviewRecord {
  readonly stage: string;
  readonly reviewedOn: string;
  readonly reviewCommit: string;
  readonly doc: string;
  readonly blockers: number;
  readonly unresolvedMajors: number;
  readonly fixedBoundaries: number;
  readonly deferredChecks: readonly AyasSecurityDeferredCheck[];
}

export const AYAS_LAST_SECURITY_REVIEW: AyasSecurityReviewRecord = Object.freeze({
  stage: "Stage 9 — Security / Supply-Chain Defense",
  reviewedOn: "2026-09-24",
  reviewCommit: "1c1ab791411df904b904d52b26b6415da89b8f05",
  doc: "docs/AYAS_SECURITY_SUPPLY_CHAIN.md",
  blockers: 0,
  unresolvedMajors: 0,
  fixedBoundaries: 4,
  deferredChecks: Object.freeze([
    {
      id: "live-npm-advisory",
      label: "Canlı npm güvenlik taraması",
      reason: "Paket bilgisinin npm'e gönderilmesi sahibin açık onayını bekliyor; çevrimdışı sonuç yalnızca sınırlı bir anlık görüntü.",
      docPhrase: "online npm audit",
    },
    {
      id: "install-native-downloads",
      label: "Kurulum sırasında yerel ikili indirmeleri",
      reason: "Bağımlılık güncellemelerinde yeniden incelenmeli.",
      docPhrase: "Installation-time native downloads",
    },
    {
      id: "phone-model-artifacts",
      label: "Telefon modeli dosyalarının sabitlenmesi",
      reason: "Model deposunun `main` revizyonu değişebilir; sürüm sabitleme yapılmadı.",
      docPhrase: "mutable phone-model `main` artifacts",
    },
    {
      id: "local-path-races",
      label: "Aynı yetkideki yerel yol yarışları",
      reason: "Aynı kullanıcı yetkisiyle çalışan bir sürecin dosya yolu yarışı belgelenmiş bir sınır olarak kalıyor.",
      docPhrase: "same-privilege local path races",
    },
  ]),
});
