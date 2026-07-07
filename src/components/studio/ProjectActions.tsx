import Link from "next/link";

type ProjectActionsProps = {
  slug: string;
};

export default function ProjectActions({ slug }: ProjectActionsProps) {
  return (
    <div className="flex flex-wrap gap-3">
      <Link
        href="/"
        className="rounded-xl bg-yellow-400 px-4 py-3 text-sm font-bold text-black transition hover:bg-yellow-300"
      >
        Üretimi Başlat
      </Link>

      <Link
        href={`/project/${slug}`}
        className="rounded-xl border border-zinc-700 px-4 py-3 text-sm font-bold text-white transition hover:border-yellow-400 hover:text-yellow-300"
      >
        Studio'ya Git
      </Link>

      <button
        disabled
        className="cursor-not-allowed rounded-xl border border-zinc-800 px-4 py-3 text-sm font-bold text-zinc-600"
      >
        Yeniden Üret
      </button>

      <button
        disabled
        className="cursor-not-allowed rounded-xl border border-zinc-800 px-4 py-3 text-sm font-bold text-zinc-600"
      >
        Dışa Aktar
      </button>
    </div>
  );
}
