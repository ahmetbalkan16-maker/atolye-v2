type StyleSelectorProps = {
  visible: boolean;
  topic: string;
};

export default function StyleSelector({
  visible,
  topic,
}: StyleSelectorProps) {
  if (!visible) return null;

  return (
    <div className="mt-8 w-full max-w-4xl rounded-3xl border border-white/10 bg-white/5 p-6 text-left">
      <p className="text-sm text-yellow-400">Yeni belgesel başladı:</p>

      <h2 className="mt-2 text-3xl font-bold">{topic}</h2>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-black/40 p-5">
          <h3 className="font-semibold text-yellow-400">
            1. Epik Belgesel
          </h3>

          <p className="mt-2 text-sm text-zinc-400">
            Büyük savaşlar, liderlik ve sinematik anlatım.
          </p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-black/40 p-5">
          <h3 className="font-semibold text-yellow-400">
            2. Gizemli Anlatım
          </h3>

          <p className="mt-2 text-sm text-zinc-400">
            Komplo teorileri, bilinmeyen detaylar ve merak unsuru.
          </p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-black/40 p-5">
          <h3 className="font-semibold text-yellow-400">
            3. Shorts Tarzı
          </h3>

          <p className="mt-2 text-sm text-zinc-400">
            İlk 3 saniyede dikkat çeken hızlı anlatım.
          </p>
        </div>
      </div>
    </div>
  );
}