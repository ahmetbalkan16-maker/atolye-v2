/** Client-safe data only. A preview seal grants no execution authority. */
export interface AyasOwnerExactPreviewBinding {
  readonly schema: "ayas-owner-exact-preview:v1";
  readonly proposalId: string;
  readonly proposalHash: string;
  readonly artifactId: string;
  readonly patchHash: string;
  readonly baseHead: string;
  readonly snapshotDigest: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly seal: string;
}

export interface AyasOwnerExactPreview {
  readonly binding: AyasOwnerExactPreviewBinding;
  readonly exactFiles: readonly string[];
  readonly files: readonly { readonly filePath: string; readonly before: string | null; readonly after: string }[];
  readonly evidenceIdentity: string;
  readonly evidenceStatus: "VERIFIED";
  readonly validationSummary: readonly string[];
}

/** The acknowledgement belongs to the rendered snapshot, never to a proposal id alone. */
export function ayasOwnerExactPreviewAcknowledged(preview: AyasOwnerExactPreview | undefined, reviewedSeal: string | null,
  proposal: { readonly proposalId: string; readonly proposalHash: string; readonly patchArtifactId?: string; readonly patchHash?: string; readonly baseHead: string; readonly exactFiles: readonly string[] }, now = Date.now()): boolean {
  return !!preview && preview.evidenceStatus === "VERIFIED" && reviewedSeal === preview.binding.seal
    && preview.binding.proposalId === proposal.proposalId && preview.binding.proposalHash === proposal.proposalHash
    && preview.binding.artifactId === proposal.patchArtifactId && preview.binding.patchHash === proposal.patchHash
    && preview.binding.baseHead === proposal.baseHead && JSON.stringify(preview.exactFiles) === JSON.stringify(proposal.exactFiles)
    && preview.files.length === proposal.exactFiles.length && preview.files.every((file, i) => file.filePath === proposal.exactFiles[i])
    && Date.parse(preview.binding.issuedAt) <= now && Date.parse(preview.binding.expiresAt) > now;
}
