import type { Metadata } from "next";
import "@/components/brain/BrainCore.css";

export const metadata: Metadata = {
  title: "Brain Core — Atölye",
  description: "Atölye Brain Core — the living centre of the studio (read-only; execution gate closed).",
};

export default function BrainLayout({ children }: { children: React.ReactNode }) {
  return children;
}
