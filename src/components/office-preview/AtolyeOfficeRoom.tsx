import { getPreviewBrain } from "@/lib/office-preview/brains";
import {
  AUTHORITY_LABEL,
  OFFICE_ROOMS,
  getRoom,
  roomHref,
  roomMembers,
  type OfficeRoomSlug,
} from "@/lib/office-preview/officeRoster";

/**
 * A room's page (owner 2026-11-26: "alt ajanları tasarla örneğin gelişim merkezine tıkladığımda açılacak sayfalar").
 * Each worker of the room is shown as a chain: what it does → its own independent auditor's questions → the quality
 * brain's measurement → whom it reports to, plus what it may never do and what always waits for the owner.
 */
export function AtolyeOfficeRoom({ slug }: { slug: OfficeRoomSlug }) {
  const room = getRoom(slug);
  if (!room) return null;
  const members = roomMembers(slug);
  return <main className="oop-page oop-room-page">
    <header className="oop-room-head">
      <a className="oop-room-back" href="/studio/office-preview">‹ Ofise dön</a>
      <div><p>ATÖLYE OFİSİ · ODA</p><h1>{room.name}</h1><span>{room.summary}</span></div>
      {room.opens && <a className="oop-room-real" href={room.opens.href}>{room.opens.label} ›</a>}
    </header>
    <nav className="oop-room-nav" aria-label="Diğer odalar">{OFFICE_ROOMS.map(item =>
      <a key={item.slug} href={roomHref(item.slug)} aria-current={item.slug === slug ? "page" : undefined}>{item.name}</a>)}</nav>
    {members.length === 0 && <p className="oop-room-empty">Bu odada sabit çalışan yok; işi biten çalışanlar sırayla buraya mola vermeye gelir.</p>}
    <section className="oop-room-grid">{members.map(entry => {
      const brain = getPreviewBrain(entry.id);
      const boss = entry.reportsTo === "owner" ? "Sahip (sen)" : getPreviewBrain(entry.reportsTo).name;
      return <article key={entry.id} className="oop-agent-card">
        <header><h2>{brain.name}</h2><span className={"oop-live oop-live--" + brain.liveStatus}>{brain.liveStatus === "mevcut" ? "sistemde var" : brain.liveStatus === "koşullu" ? "koşullu" : "planlanan"}</span></header>
        <p className="oop-agent-mission">{brain.mission}</p>
        <dl className="oop-chain"><dt>Yetkisi</dt><dd>{AUTHORITY_LABEL[entry.authority]}</dd><dt>Rapor verir</dt><dd>{boss}</dd>{brain.sourceRole && <><dt>Sistemdeki yeri</dt><dd>{brain.sourceRole}</dd></>}</dl>
        <ol className="oop-pipeline" aria-label="İşin geçtiği kapılar">
          <li><b>1 · Yapar</b>{brain.allowed.map(item => <span key={item}>{item}</span>)}</li>
          <li><b>2 · {entry.auditor.name} sorgular</b>{entry.auditor.questions.map(item => <span key={item}>{item}</span>)}</li>
          <li><b>3 · {entry.qualityGate ? "Kalite beyni ölçer" : "İkinci göz ölçer"}</b>{brain.qualityChecks.map(item => <span key={item}>{item}</span>)}</li>
          <li><b>4 · {boss} karar verir</b><span>Geçmeyen iş gerekçesiyle geri döner; geçen iş rapor olarak gider.</span></li>
        </ol>
        <div className="oop-agent-limits">
          <div><b>Yapamaz</b><ul>{brain.forbidden.map(item => <li key={item}>{item}</li>)}</ul></div>
          {entry.ownerGate.length > 0 && <div><b>Sahip onayı ister</b><ul>{entry.ownerGate.map(item => <li key={item}>{item}</li>)}</ul></div>}
        </div>
        <a className="oop-agent-open" href={entry.opens.href}>{entry.opens.label} ›</a>
      </article>;
    })}</section>
    <p className="oop-side-footnote">ÖNİZLEME · KADRO VE KURALLAR TASLAKTIR · CANLI GÖREVLERE BAĞLI DEĞİL</p>
  </main>;
}
