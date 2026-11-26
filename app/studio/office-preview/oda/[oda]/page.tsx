import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AtolyeOfficeRoom } from "@/components/office-preview/AtolyeOfficeRoom";
import { getRoom } from "@/lib/office-preview/officeRoster";
import "@/components/office-preview/office-preview.css";

export const metadata: Metadata = {
  title: "Atölye Ofisi · Oda",
  description: "Odadaki çalışanlar, yetkileri, rapor zinciri ve bağımsız denetçileri.",
};

export default async function OfficeRoomPage({ params }: { params: Promise<{ oda: string }> }) {
  const room = getRoom((await params).oda);
  if (!room) notFound();
  return <AtolyeOfficeRoom slug={room.slug} />;
}
