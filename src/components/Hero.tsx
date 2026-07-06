type HeroProps = {
  title: string;
  description: string;
};

export default function Hero({ title, description }: HeroProps) {
  return (
    <section className="text-center">
      <p className="mb-4 text-sm uppercase tracking-[0.4em] text-yellow-500">
        AI BELGESEL STÜDYOSU
      </p>

      <h1 className="text-6xl font-bold tracking-tight md:text-8xl">
        {title}
      </h1>

      <p className="mx-auto mt-6 max-w-2xl text-lg text-zinc-300">
        {description}
      </p>
    </section>
  );
}