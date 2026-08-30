import {
  classifyMediaRightsStatus,
  isProductionAdmissibleRightsStatus,
} from "@/lib/assets/MediaRightsPolicy";
import type { Asset, MediaRightsStatus } from "@/types/asset";

/**
 * Documentary media effort — Faz 6.7: the production acceptance rights gate.
 *
 * Every asset whose pixels/frames came from a real external source
 * (`mediaOrigin === "real"`) MUST be production-admissible:
 *  - `rightsStatus ∈ { public-domain, open-license, verified }`, AND
 *  - a `sourceUrl` (provenance) is present, AND
 *  - the recorded `rightsStatus` still matches a fresh classification of the
 *    `license` string (no drift / hand-edit).
 *
 * `verified` is accepted only if it was set out-of-band — the classifier never
 * produces it, so a `verified` asset with a `license` that classifies as
 * something weaker is rejected.
 *
 * AI / mock assets carry no external rights and are exempt. A project with no
 * real-media assets (e.g. `5be83a84`) passes trivially.
 */

export interface RightsAuditRejection {
  readonly assetId: string;
  readonly type: string;
  readonly sceneId?: number;
  readonly mediaType?: string;
  readonly rightsStatus?: MediaRightsStatus;
  readonly reason:
    | "rights-not-admissible"
    | "missing-source-url"
    | "rights-status-drift"
    | "missing-rights-metadata";
}

export interface ProductionMediaRightsAudit {
  readonly pass: boolean;
  readonly realMediaAssetCount: number;
  readonly rejected: readonly RightsAuditRejection[];
  readonly summary: {
    readonly publicDomain: number;
    readonly openLicense: number;
    readonly verified: number;
    readonly unknown: number;
    readonly restricted: number;
  };
}

export class ProductionMediaRightsError extends Error {
  readonly code = "PRODUCTION_MEDIA_RIGHTS_INADMISSIBLE";
  readonly audit: ProductionMediaRightsAudit;

  constructor(audit: ProductionMediaRightsAudit) {
    super("A real-media production asset is not rights-admissible.");
    this.name = "ProductionMediaRightsError";
    this.audit = audit;
    this.stack = undefined;
  }
}

export function auditProductionMediaRights(
  assets: readonly Asset[],
): ProductionMediaRightsAudit {
  const rejected: RightsAuditRejection[] = [];
  const summary: MutableRightsSummary = {
    publicDomain: 0, openLicense: 0, verified: 0, unknown: 0, restricted: 0,
  };
  let realMediaAssetCount = 0;

  for (const asset of assets) {
    if (asset.status !== "generated" || asset.mediaOrigin !== "real") continue;
    realMediaAssetCount += 1;

    const status = asset.rightsStatus;
    tally(summary, status);

    const base = {
      assetId: asset.id,
      type: asset.type,
      sceneId: asset.sceneId,
      mediaType: asset.mediaType,
      rightsStatus: status,
    };

    if (status === undefined) {
      rejected.push({ ...base, reason: "missing-rights-metadata" });
      continue;
    }
    if (!isProductionAdmissibleRightsStatus(status)) {
      rejected.push({ ...base, reason: "rights-not-admissible" });
      continue;
    }
    if (!nonEmpty(asset.sourceUrl)) {
      rejected.push({ ...base, reason: "missing-source-url" });
      continue;
    }
    // Drift check: the recorded status must not be *stronger* than a fresh
    // classification of the licence text. `verified` bypasses this (out-of-band).
    if (status !== "verified") {
      const classified = classifyMediaRightsStatus(asset.license);
      if (!isProductionAdmissibleRightsStatus(classified)) {
        rejected.push({ ...base, reason: "rights-status-drift" });
      }
    }
  }

  return {
    pass: rejected.length === 0,
    realMediaAssetCount,
    rejected,
    summary,
  };
}

export function assertProductionMediaRights(assets: readonly Asset[]): ProductionMediaRightsAudit {
  const audit = auditProductionMediaRights(assets);
  if (!audit.pass) throw new ProductionMediaRightsError(audit);
  return audit;
}

// --------------------------------------------------------------------------- internals

interface MutableRightsSummary {
  publicDomain: number;
  openLicense: number;
  verified: number;
  unknown: number;
  restricted: number;
}

function tally(
  summary: MutableRightsSummary,
  status: MediaRightsStatus | undefined,
): void {
  switch (status) {
    case "public-domain": summary.publicDomain += 1; break;
    case "open-license": summary.openLicense += 1; break;
    case "verified": summary.verified += 1; break;
    case "restricted": summary.restricted += 1; break;
    default: summary.unknown += 1; break;
  }
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
