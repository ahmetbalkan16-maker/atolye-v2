import { AyasExecutiveBriefingPanel } from "@/components/brain/AyasExecutiveBriefingPanel";
import { loadAyasExecutiveOwnerView } from "@/lib/ayas/briefing/AyasExecutiveBriefingService";
export const dynamic = "force-dynamic";
export default async function OwnerBriefingPage() {
  // GET is read-only. The authenticated client action synchronizes diagnostic metadata after mount.
  const initial = await loadAyasExecutiveOwnerView({synchronize:false,ownerAuthenticated:false});
  return <main className="bc-shell"><AyasExecutiveBriefingPanel initial={initial} /></main>;
}
