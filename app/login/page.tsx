import type { Metadata } from "next";
import { resolveAccessGate } from "@/lib/auth/accessGate";

export const metadata: Metadata = {
  title: "AYAS — Erişim",
  description: "Atölye AYAS erişim kapısı.",
};

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const gate = resolveAccessGate(process.env);
  const nextParam = typeof params.next === "string" ? params.next : "/brain";
  const safeNext = nextParam.startsWith("/") && !nextParam.startsWith("//")
    ? nextParam
    : "/brain";
  const hasError = params.error === "1";

  return (
    <main style={styles.shell}>
      <section style={styles.card}>
        <p style={styles.eyebrow}>ATÖLYE</p>
        <h1 style={styles.title}>AYAS</h1>
        <p style={styles.sub}>
          {gate.mode === "misconfigured"
            ? "Erişim anahtarı yapılandırılmamış."
            : "Devam etmek için erişim anahtarını gir."}
        </p>

        {gate.mode === "misconfigured" ? (
          <p style={styles.notice}>
            Sunucuda <code>AYAS_ACCESS_KEY</code> ayarlanmalı (en az 12 karakter),
            ardından sunucu yeniden başlatılmalı.
          </p>
        ) : (
          <form method="POST" action="/api/auth/login" style={styles.form}>
            <input type="hidden" name="next" value={safeNext} />
            <label style={styles.label} htmlFor="key">
              Erişim anahtarı
            </label>
            <input
              id="key"
              name="key"
              type="password"
              autoComplete="current-password"
              required
              autoFocus
              style={styles.input}
            />
            {hasError ? (
              <p style={styles.error}>Anahtar hatalı. Tekrar dene.</p>
            ) : null}
            <button type="submit" style={styles.button}>
              Gir
            </button>
          </form>
        )}

        <p style={styles.foot}>
          Bu kapı yalnızca kimlik doğrular. Yürütme Kapısı ayrıca kapalıdır.
        </p>
      </section>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  shell: {
    minHeight: "100dvh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "24px",
    background:
      "radial-gradient(1100px 620px at 50% -12%, hsl(190 55% 32% / 0.16), transparent 70%), linear-gradient(180deg, #080a12, #04050a 46%)",
    color: "#e9edf7",
    fontFamily:
      "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
  },
  card: {
    width: "100%",
    maxWidth: "380px",
    padding: "32px 28px",
    borderRadius: "18px",
    border: "1px solid rgba(255,255,255,0.09)",
    background: "rgba(255,255,255,0.028)",
    backdropFilter: "blur(6px)",
  },
  eyebrow: {
    margin: 0,
    fontSize: "11px",
    letterSpacing: "0.34em",
    color: "#5a6274",
  },
  title: { margin: "6px 0 0", fontSize: "34px", letterSpacing: "0.12em" },
  sub: { margin: "10px 0 22px", color: "#8b94a9", fontSize: "14px" },
  notice: {
    margin: 0,
    padding: "12px 14px",
    borderRadius: "10px",
    background: "rgba(255, 180, 80, 0.08)",
    border: "1px solid rgba(255, 180, 80, 0.22)",
    fontSize: "13px",
    lineHeight: 1.5,
  },
  form: { display: "flex", flexDirection: "column", gap: "8px" },
  label: { fontSize: "12px", color: "#8b94a9" },
  input: {
    padding: "12px 14px",
    borderRadius: "10px",
    border: "1px solid rgba(255,255,255,0.16)",
    background: "rgba(0,0,0,0.35)",
    color: "#e9edf7",
    fontSize: "15px",
  },
  error: { margin: "2px 0 0", color: "#ff9a9a", fontSize: "13px" },
  button: {
    marginTop: "8px",
    padding: "12px 16px",
    borderRadius: "10px",
    border: "1px solid hsl(190 85% 60% / 0.4)",
    background: "hsl(190 85% 60% / 0.15)",
    color: "#e9edf7",
    fontSize: "15px",
    letterSpacing: "0.06em",
    cursor: "pointer",
  },
  foot: {
    margin: "22px 0 0",
    fontSize: "11px",
    color: "#5a6274",
    lineHeight: 1.5,
  },
};
