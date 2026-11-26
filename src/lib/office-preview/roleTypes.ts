export type PreviewBrainId =
  | "ayas"
  | "arastirma"
  | "kurgu"
  | "mizah"
  | "kostum"
  | "ortam"
  | "ses"
  | "kalite"
  | "onarim"
  | "gelistirici"
  | "cirak"
  | "denetci"
  | "muhasebe"
  | "tarih"
  | "yayinci"
  | "analist"
  | "gozcu"
  | "radar"
  | "guvenlik";

export type PreviewLiveStatus = "mevcut" | "koşullu" | "planlanan";

export interface PreviewBrainProfile {
  readonly id: PreviewBrainId;
  readonly name: string;
  readonly department: string;
  readonly room: string;
  readonly liveStatus: PreviewLiveStatus;
  readonly sourceRole?: string;
  readonly mission: string;
  readonly allowed: readonly string[];
  readonly forbidden: readonly string[];
  readonly qualityChecks: readonly string[];
  readonly reviewerId: PreviewBrainId | "owner";
  readonly reviewerName: string;
  readonly reviewerFocus: string;
  readonly profileFile: string;
  readonly memoryRule: string;
}

export const PREVIEW_SANDBOX_NOTE =
  "Bu rol kartı önizleme dalına aittir. Konuşmalar ve dersler oturum içi simülasyondur; canlı görevlere veya kalıcı hafızaya bağlanmaz.";
