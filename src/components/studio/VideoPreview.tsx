"use client";

import { useState } from "react";

type VideoPreviewProps = {
  src: string;
  title?: string;
  durationSeconds?: number;
  width?: number;
  height?: number;
  byteLength?: number;
  poster?: string;
  badgeText?: string;
  downloadFileName?: string;
  compact?: boolean;
};

export default function VideoPreview({
  src,
  title,
  durationSeconds,
  width = 1920,
  height = 1080,
  byteLength,
  poster,
  badgeText = "Render Edildi (MP4)",
  downloadFileName,
  compact = false,
}: VideoPreviewProps) {
  const [error, setError] = useState(false);

  const formattedDuration = durationSeconds
    ? formatDuration(durationSeconds)
    : null;

  const formattedSize = byteLength
    ? (byteLength / (1024 * 1024)).toFixed(1) + " MB"
    : null;

  if (error || !src) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-center text-sm text-zinc-500">
        <p className="font-semibold text-zinc-400">Video Önizleme Yüklenemedi</p>
        <p className="mt-1 text-xs text-zinc-500">
          Video dosyası henüz oluşturulmadı veya erişilemiyor.
        </p>
      </div>
    );
  }

  if (compact) {
    return (
      <div className="space-y-2">
        <div className="relative overflow-hidden rounded-xl border border-zinc-800 bg-black">
          <video
            controls
            playsInline
            preload="metadata"
            src={src}
            poster={poster}
            onError={() => setError(true)}
            className="aspect-video w-full object-contain"
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-400">
          <div className="flex items-center gap-2">
            <span className="rounded bg-zinc-800 px-2 py-0.5 font-medium text-zinc-300">
              {width}x{height}
            </span>
            {formattedDuration && <span>{formattedDuration}</span>}
            {formattedSize && <span>{formattedSize}</span>}
          </div>
          <a
            href={src}
            download={downloadFileName}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-semibold text-yellow-400 hover:text-yellow-300"
          >
            İndir (MP4)
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4 shadow-xl sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {title && <h3 className="font-bold text-white sm:text-lg">{title}</h3>}
          <span className="rounded-full bg-green-500/10 px-2.5 py-0.5 text-xs font-semibold text-green-400 border border-green-500/20">
            {badgeText}
          </span>
        </div>
        <a
          href={src}
          download={downloadFileName}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-xl bg-yellow-400 px-4 py-2 text-xs font-bold text-black shadow transition hover:bg-yellow-300"
        >
          <svg
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
            />
          </svg>
          MP4 Videosunu İndir
        </a>
      </div>

      <div className="relative overflow-hidden rounded-xl border border-zinc-800 bg-black shadow-inner">
        <video
          controls
          playsInline
          preload="metadata"
          src={src}
          poster={poster}
          onError={() => setError(true)}
          className="aspect-video w-full max-h-[500px] object-contain"
        />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4 sm:gap-4">
        <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/60 p-3">
          <span className="block font-medium uppercase text-zinc-500">Çözünürlük</span>
          <span className="mt-1 block font-bold text-zinc-200">{width} × {height} (HD)</span>
        </div>
        <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/60 p-3">
          <span className="block font-medium uppercase text-zinc-500">Süre</span>
          <span className="mt-1 block font-bold text-zinc-200">
            {formattedDuration ?? "Belirtilmedi"}
          </span>
        </div>
        <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/60 p-3">
          <span className="block font-medium uppercase text-zinc-500">Dosya Boyutu</span>
          <span className="mt-1 block font-bold text-zinc-200">
            {formattedSize ?? "Belirtilmedi"}
          </span>
        </div>
        <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/60 p-3">
          <span className="block font-medium uppercase text-zinc-500">Format & Codec</span>
          <span className="mt-1 block font-bold text-zinc-200">MP4 (H.264 / AAC)</span>
        </div>
      </div>
    </div>
  );
}

function formatDuration(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60);
  const secs = Math.floor(totalSeconds % 60);
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}
