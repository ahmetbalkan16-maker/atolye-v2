import { resolveAccessGate } from "../../../src/lib/auth/accessGate";
import { constitutionDigest, proposeAyasOwnerConstitution } from "../../../src/lib/ayas/governance/AyasOwnerConstitution";
import { readAyasOwnerConstitution } from "../../../src/lib/ayas/governance/AyasOwnerConstitutionReader";
import { adoptAyasOwnerConstitution } from "./actions";

export const dynamic = "force-dynamic";

export default function OwnerConstitutionPage() {
  const state = readAyasOwnerConstitution(process.cwd());
  const proposal = proposeAyasOwnerConstitution();
  const ownerAuthenticationReady = resolveAccessGate(process.env).mode === "enforced";
  const policy = state.state === "ACTIVE" ? state.policy : proposal;
  return <main className="mx-auto max-w-3xl space-y-6 p-6 text-slate-100">
    <a href="/brain" className="text-sky-300">AYAS Console</a>
    <h1 className="text-2xl font-semibold">Owner Constitution</h1>
    <p>AYAS bu kuralları önerebilir; etkinleştirme ve değişiklik yetkisi owner’a aittir.</p>
    <p role="status">{state.state === "ACTIVE" ? `Etkin sürüm: ${state.policy.version}` : state.state === "MISSING" ? "Taslak hazır; henüz etkinleştirilmedi." : "Policy doğrulanamıyor. Yeni işler etkin policy’ye bağlanamaz; owner incelemesi gerekir."}</p>
    <ul className="list-disc space-y-2 pl-5">
      <li>Harcama varsayılanı 0 USD. Beklenen gelir harcama yetkisi vermez.</li>
      <li>Yayın ve üretim işlemleri exact owner onayına bağlıdır.</li>
      <li>AYAS kendi önerisini onaylayamaz veya terfi ettiremez.</li>
      <li>Gizli cloud fallback yok; Graphify kontrolü korunur.</li>
      <li>Secret’lar memory, ledger ve loglara yazılmaz.</li>
      <li>Yerel runtime ON_DEMAND çalışır; RAM %{policy.rules.maxRamAdmissionPercent} veya üzerindeyken yeni ağır iş başlamaz.</li>
      <li>Uzun işler etkin policy digest’ine bağlanır; değişiklikte yeni dispatch durur.</li>
    </ul>
    <details><summary className="cursor-pointer">{state.state === "ACTIVE" ? "Etkin policy ve digest" : "İncelenecek tam taslak ve digest"}</summary>
      <p className="break-all font-mono text-xs">{state.state === "ACTIVE" ? state.digest : constitutionDigest(proposal)}</p>
      <pre className="overflow-x-auto rounded bg-slate-900 p-4 text-xs">{JSON.stringify(policy, null, 2)}</pre>
    </details>
    {state.state === "MISSING" && <form action={adoptAyasOwnerConstitution}>
      <input type="hidden" name="proposalDigest" value={constitutionDigest(proposal)} />
      <button type="submit" disabled={!ownerAuthenticationReady} className="rounded bg-sky-600 px-4 py-2 disabled:opacity-40">Bu exact taslağı owner olarak etkinleştir</button>
      {!ownerAuthenticationReady && <p className="mt-2">Etkinleştirme için yapılandırılmış owner erişimi ve geçerli oturum gerekir.</p>}
    </form>}
  </main>;
}
