import type { Metadata } from "next";
import { AtolyeOfficePreview } from "@/components/office-preview/AtolyeOfficePreview";
import "@/components/office-preview/office-preview.css";

export const metadata: Metadata = {
  title: "Atölye Ofisi · Önizleme",
  description: "İzole Atölye Ofisi hareket ve görev akışı prototipi.",
};

export default function OfficePreviewPage() {
  return <AtolyeOfficePreview />;
}
