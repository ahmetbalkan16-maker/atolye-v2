type TopicInputProps = {
  topic: string;
  setTopic: (value: string) => void;
  onStart: () => void;
  loading?: boolean;
};

export default function TopicInput({
  topic,
  setTopic,
  onStart,
  loading = false,
}: TopicInputProps) {
  return (
    <div className="mt-10 w-full max-w-2xl rounded-3xl border border-yellow-500/20 bg-zinc-950/70 p-6 shadow-2xl shadow-yellow-900/20 backdrop-blur">
      <label className="mb-3 block text-left text-sm text-zinc-400">
        Bugün hangi belgeseli hazırlıyoruz?
      </label>

      <input
        value={topic}
        onChange={(e) => setTopic(e.target.value)}
        type="text"
        placeholder="Örn: Attila'nın Roma'ya yürüyüşü"
        disabled={loading}
        className="w-full rounded-2xl border border-zinc-800 bg-black px-5 py-4 text-white outline-none transition focus:border-yellow-500 disabled:cursor-not-allowed disabled:text-zinc-500"
      />

      <button
        onClick={onStart}
        disabled={loading}
        className="mt-5 w-full rounded-2xl bg-yellow-500 px-5 py-4 font-bold text-black transition hover:bg-yellow-400 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400"
      >
        {loading ? "Üretim devam ediyor..." : "Üretimi Başlat"}
      </button>
    </div>
  );
}
