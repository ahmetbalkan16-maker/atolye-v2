/**
 * Offline shell (spec §7). Served by the service worker when a navigation fails
 * and nothing better is cached. Static, no data, no execution — AYAS itself
 * needs the network + a valid session, so this page only tells the user that.
 */
export const dynamic = "force-static";

export default function OfflinePage() {
  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        padding: "2rem",
        background: "#04050a",
        color: "#e9edf7",
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        textAlign: "center",
      }}
    >
      <div style={{ maxWidth: 420 }}>
        <p style={{ fontSize: 40, margin: 0 }}>◍</p>
        <h1 style={{ fontSize: 20, fontWeight: 600, margin: "0.75rem 0 0.5rem" }}>AYAS çevrimdışı</h1>
        <p style={{ color: "#8b94a9", lineHeight: 1.5, margin: 0 }}>
          Bağlantı yok. AYAS sohbeti, sesi ve yürütme kapısı yalnızca çevrimiçi ve oturum
          açıkken çalışır. Bağlantı gelince sayfayı yenile.
        </p>
      </div>
    </main>
  );
}
