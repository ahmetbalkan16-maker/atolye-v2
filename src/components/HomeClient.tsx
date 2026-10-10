"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Dashboard from "@/components/Dashboard";
import Sidebar from "@/components/Sidebar";
import TopicInput from "@/components/TopicInput";
import {
  findStartedProjectUrl,
  resolvePipelineStartOutcome,
  type PipelineStartResponseBody,
} from "@/lib/pipeline/pipelineStartOutcome";
import { createProjectSlug } from "@/lib/projects/projectSlug";

/** How often the start screen looks for the project its request created. */
const PROJECT_POLL_INTERVAL_MS = 5_000;
/** After a lost response, how many more looks before the error is shown. */
const LOST_RESPONSE_RECHECKS = 6;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export default function HomeClient() {
  const router = useRouter();
  const [topic, setTopic] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const startPipeline = async () => {
    if (!topic.trim() || loading) return;

    const slug = createProjectSlug(topic.trim());
    const requestStartedAt = Date.now();
    let settled = false;
    const findStartedProject = async (): Promise<string | null> => {
      try {
        const res = await fetch("/api/projects", { cache: "no-store" });
        if (!res.ok) return null;
        const body = (await res.json()) as { projects?: unknown };
        return findStartedProjectUrl(body?.projects, slug, requestStartedAt);
      } catch {
        return null;
      }
    };

    setLoading(true);
    setError("");

    // The whole production runs inside this one request, for minutes. The
    // project is created first, so as soon as it exists the user is taken to
    // its live progress page; the request keeps running on the server.
    const followStartedProject = async () => {
      while (!settled) {
        await wait(PROJECT_POLL_INTERVAL_MS);
        if (settled) return;
        const url = await findStartedProject();
        if (url && !settled) {
          settled = true;
          router.push(url);
        }
      }
    };
    void followStartedProject();

    try {
      const res = await fetch("/api/pipeline", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ topic }),
      });

      const data = (await res.json()) as PipelineStartResponseBody;
      if (settled) return;
      settled = true;

      // The route attaches `projectUrl` whenever a project exists the user can
      // act on — full success, a `stopReason` stop, or a mid-pipeline failure
      // that still created the project. In all of those, send the user to the
      // project page (progress + resume/retry). Only a response with no usable
      // project reference stays here as an inline error.
      const outcome = resolvePipelineStartOutcome(data);
      if (outcome.kind === "navigate") {
        router.push(outcome.to);
        return;
      }
      setError(outcome.message);
    } catch (err) {
      if (settled) return;
      settled = true;
      // A proxy (Cloudflare: 524 after 100 s) can drop the response while the
      // production goes on. Look for the project before calling it an error.
      console.error("[HomeClient] Pipeline response lost; looking for the project:", err);
      for (let attempt = 0; attempt < LOST_RESPONSE_RECHECKS; attempt += 1) {
        const url = await findStartedProject();
        if (url) {
          router.push(url);
          return;
        }
        await wait(PROJECT_POLL_INTERVAL_MS);
      }
      setError("Sunucuya bağlanırken hata oluştu.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="aw-studio">
      <Sidebar />

      <div className="aw-studio-main">
        <Dashboard />

        <TopicInput
          topic={topic}
          setTopic={setTopic}
          onStart={startPipeline}
          loading={loading}
        />

        {loading && (
          <p className="mt-6 text-yellow-400">
            Üretim başlatılıyor; proje oluşunca ilerleme sayfasına geçilecek…
          </p>
        )}

        {error && (
          <div className="mt-6 rounded-xl border border-red-500/30 bg-red-950/30 p-4 text-red-300">
            {error}
          </div>
        )}
      </div>
    </main>
  );
}
