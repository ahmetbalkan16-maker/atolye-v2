import { AyasConsolePage } from "@/components/brain/AyasConsolePage";
import { BRAIN_PANELS } from "@/components/brain/brainCore";

export const dynamic = "force-dynamic";

export default async function BrainCorePage({ searchParams }: {
  searchParams: Promise<{ panel?: string | string[] }>;
}) {
  const requested = (await searchParams).panel;
  const panel = BRAIN_PANELS.find((item) => item.id === requested)?.id ?? "chat";
  return <AyasConsolePage initialPanel={panel} />;
}
