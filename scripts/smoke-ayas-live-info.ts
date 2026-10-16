/**
 * AYAS personal assistant — weather and news (live-info) smoke.
 *
 * Offline and deterministic: every source answer is a fixture handed to the
 * lookup's reader seam, so no request leaves the machine. Covers the intent
 * (what is and is not a weather/news question), its place in the route-level
 * precedence, the spoken answers, the place/date/topic handling and the
 * reader's fixed host allowlist.
 */
import assert from "node:assert/strict";

import { resolveAyasPreReasoningIntent } from "../src/lib/ayas/AyasIntentRouting";
import { detectAyasLiveInfoIntent, type AyasLiveInfoIntent } from "../src/lib/ayas/liveinfo/AyasLiveInfoIntent";
import { answerAyasLiveInfo, createAyasLiveInfoReader, AYAS_LIVE_INFO_HOSTS, type AyasLiveInfoRead } from "../src/lib/ayas/liveinfo/AyasLiveInfoLookup";
import type { AyasSafeFetchOutcome } from "../src/lib/brain/autonomy/AyasSafePublicFetch";

let scenarios = 0;
async function scenario(name: string, test: () => void | Promise<void>): Promise<void> {
  await test();
  scenarios += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${scenarios}: ${name}`);
}

const NOW = new Date("2026-10-16T12:00:00Z"); // a Friday

function ok(body: string, contentType = "application/json; charset=utf-8", finalUrl = "https://api.open-meteo.com/"): AyasSafeFetchOutcome {
  return { ok: true, status: 200, notModified: false, finalUrl, contentType, body, truncated: false };
}
const down: AyasSafeFetchOutcome = { ok: false, code: "AYAS_FETCH_TIMEOUT", message: "timeout", failureClass: "TRANSIENT", attempts: 2 };

/** A reader over fixtures, keyed by a URL substring; it records every URL asked for. */
function fixtureReader(routes: readonly (readonly [string, AyasSafeFetchOutcome])[]): AyasLiveInfoRead & { urls: string[] } {
  const urls: string[] = [];
  const read = (async (url: string) => {
    urls.push(url);
    for (const [needle, outcome] of routes) if (url.includes(needle)) return outcome;
    throw new Error(`unexpected URL ${url}`);
  }) as AyasLiveInfoRead & { urls: string[] };
  read.urls = urls;
  return read;
}

const geo = (results: readonly Record<string, unknown>[]) => ok(JSON.stringify({ results }));
const BURSA = { name: "Bursa", latitude: 40.19559, longitude: 29.06013, country_code: "TR", country: "Türkiye Cumhuriyeti" };
const PARIS = { name: "Paris", latitude: 48.85341, longitude: 2.3488, country_code: "FR", country: "Fransa" };
const FORECAST = ok(JSON.stringify({
  current: { temperature_2m: 9.7, apparent_temperature: 8.8, relative_humidity_2m: 89, weather_code: 3, wind_speed_10m: 2.5 },
  daily: {
    time: ["2026-10-16", "2026-10-17", "2026-10-18", "2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22"],
    weather_code: [3, 61, 0, 2, 95, 71, 1],
    temperature_2m_max: [19.4, 14.2, 21, 18, 16, 2.4, 12],
    temperature_2m_min: [8.1, 7.6, 9, 8, 6, -3.4, 4],
    precipitation_probability_max: [10, 85, 0, 5, 70, 60, 15],
  },
}));

function rss(items: readonly { title: string; date: string }[], finalUrl = "https://news.google.com/rss"): AyasSafeFetchOutcome {
  const body = `<?xml version="1.0"?><rss><channel><title>t</title>${items.map((item) => `<item><title>${item.title}</title><link>https://news.google.com/rss/articles/x</link><pubDate>${item.date}</pubDate><description>d</description></item>`).join("")}</channel></rss>`;
  return ok(body, "application/xml; charset=utf-8", finalUrl);
}
const env = (values: Readonly<Record<string, string>>): NodeJS.ProcessEnv => values as unknown as NodeJS.ProcessEnv;

const weather = (text: string) => { const intent = detectAyasLiveInfoIntent(text); assert.equal(intent?.kind, "weather", text); return intent as Extract<AyasLiveInfoIntent, { kind: "weather" }>; };
const news = (text: string) => { const intent = detectAyasLiveInfoIntent(text); assert.equal(intent?.kind, "news", text); return intent as Extract<AyasLiveInfoIntent, { kind: "news" }>; };
const none = (text: string) => assert.equal(detectAyasLiveInfoIntent(text), null, text);

async function main(): Promise<void> {
  /* ------------------------------------------------------------- intent --- */
  await scenario("weather questions are recognised with their place and day", () => {
    assert.deepEqual(weather("Bursa'da hava nasıl?"), { kind: "weather", location: "Bursa", day: { kind: "today" } });
    assert.deepEqual(weather("Paris'te bugün hava nasıl?"), { kind: "weather", location: "Paris", day: { kind: "today" } });
    assert.deepEqual(weather("Yarın İstanbul'da yağmur yağacak mı?"), { kind: "weather", location: "İstanbul", day: { kind: "offset", days: 1 } });
    assert.deepEqual(weather("Ankara hava durumu"), { kind: "weather", location: "Ankara", day: { kind: "today" } });
    assert.deepEqual(weather("bursada hava nasıl"), { kind: "weather", location: "bursada", day: { kind: "today" } });
    assert.deepEqual(weather("Cumartesi İzmir'de hava nasıl olacak?"), { kind: "weather", location: "İzmir", day: { kind: "weekday", weekday: 6 } });
    assert.deepEqual(weather("Peki New York'ta hava nasıl?"), { kind: "weather", location: "New York", day: { kind: "today" } });
    assert.deepEqual(weather("Hafta sonu hava nasıl olacak?"), { kind: "weather", location: null, day: { kind: "weekend" } });
    assert.deepEqual(weather("Öbür gün Bursa'da kar yağacak mı?").day, { kind: "offset", days: 2 });
    assert.equal(weather("AYAS, hava durumu?").location, null);
    assert.equal(weather("Yarın hava nasıl olacak sence?").location, null);
    assert.equal(weather("Bugün hava nasıl, dışarı çıkalım mı?").location, null);
    assert.equal(weather("Ankara'da kaç derece?").location, "Ankara");
    assert.equal(weather("Salihli'de hava nasıl?").day.kind, "today", "a town that starts like salı is not a weekday");
    weather("Hava güzel mi bugün?");
    weather("Şemsiye alayım mı?");
  });

  await scenario("spoken forms that used to reach the model (which invents a temperature) are weather questions too", () => {
    for (const text of [
      "Bursa'da hava nasıldır?", "Bursa'da hava nasılmış", "Bursa'nın havası nasıl?", "Bursa'da hava şartları nasıl?", "Bursa'da sıcaklık kaç?",
      "Bursa'da hava sıcaklığı kaç?", "Bursa'da sıcaklık ne kadar?", "Bursa hava", "Bursa'da hava?", "Bursa'daki hava nasıl?",
    ]) assert.deepEqual(weather(text), { kind: "weather", location: "Bursa", day: { kind: "today" } }, text);
    assert.deepEqual(weather("Bursada kaç derece?"), { kind: "weather", location: "Bursada", day: { kind: "today" } }, "a capitalised bare locative is a place");
    assert.deepEqual(weather("Yarın İzmir hava"), { kind: "weather", location: "İzmir", day: { kind: "offset", days: 1 } });
    assert.equal(weather("Denizli'de kaç derece?").location, "Denizli", "a city that starts like deniz");
    assert.equal(weather("Araç'ta hava nasıl?").location, "Araç", "a district that is also a word");
  });

  await scenario("news questions are recognised with their topic", () => {
    assert.deepEqual(news("Gazze hakkındaki son haberler neler?"), { kind: "news", topic: "Gazze" });
    assert.deepEqual(news("Bana internetten deprem haberlerini bul"), { kind: "news", topic: "deprem" });
    assert.deepEqual(news("Bana internetten Fenerbahçe maçı haberini bul ve gelişmeleri söyle"), { kind: "news", topic: "Fenerbahçe maçı" });
    assert.deepEqual(news("Türkiye ekonomisi ile ilgili son gelişmeler neler?"), { kind: "news", topic: "Türkiye ekonomisi" });
    assert.deepEqual(news("Şu haberi bul: Fenerbahçe İsmail Kartal"), { kind: "news", topic: "Fenerbahçe İsmail Kartal" });
    assert.deepEqual(news("Fenerbahçe'nin son haberleri"), { kind: "news", topic: "Fenerbahçe" });
    assert.deepEqual(news("Son dakika haberleri"), { kind: "news", topic: null });
    assert.deepEqual(news("Bugünün güncel dış haberlerini araştır"), { kind: "news", topic: null });
    assert.deepEqual(news("Gündemde ne var?"), { kind: "news", topic: null });
    assert.deepEqual(news("Ne haber AYAS, bugünün haberleri neler?"), { kind: "news", topic: null });
  });

  await scenario("everyday phrases that only look like weather or news stay out", () => {
    for (const text of [
      "bugün hava çok güzel", "Bugün hava güzel", "hava fritözü nasıl kullanılır", "hava kalitesi nasıl", "havaalanına nasıl giderim",
      "hava durumu uygulaması için kod yaz", "hava durumu hakkında bir belgesel sahnesi yaz", "üçgenin iç açıları toplamı kaç derece",
      "fırın kaç derece olmalı", "ne haber", "hey aya ne haber", "Naber AYAS", "bana haber ver", "haberin var mı", "bu işten kar var mı",
      "Bugün hangi yönlerini geliştirdin?", "Bugün hangi gelişmeleri yaptın?", "AYAS, araştırma ne durumda?", "Güncelleme var mı?",
      "Projelerimdeki son gelişmeler neler?", "merhaba nasılsın", "saat kaç", "",
      "Bu şarkının havası nasıl?", "Ortamın havası nasıldı", "Temiz hava", "Biraz hava alalım", "Ortamdaki hava", "Temiz hava iyi gelir mi?",
      "Açık Hava Tiyatrosu", "Sıcak hava balonu", "Hava Kuvvetleri", "Türk Hava Yolları", "Hava Harp Okulu", "Vücut sıcaklığı kaç olmalı",
      "Oda sıcaklığı kaç derece", "Odada kaç derece", "Evde kaç derece", "Arabada kaç derece", "Denizde kaç derece", "İşlemcide kaç derece",
      "İşlemci sıcaklığı kaç", "RTX 2000'de sıcaklık neydi?", "Peki yarın?", "Yarın?",
    ]) none(text);
  });

  await scenario("a short follow-up is weather only right after the owner's weather question", () => {
    const asked = [{ role: "user", text: "Bursa'da hava nasıl?" }, { role: "brain", text: "Bursa için şu an hava kapalı, 10 derece." }];
    const follow = (text: string, history: readonly { role: string; text: string }[]) => detectAyasLiveInfoIntent(text, history);
    assert.deepEqual(follow("Peki yarın?", asked), { kind: "weather", location: null, day: { kind: "offset", days: 1 } });
    assert.deepEqual(follow("Ya İzmir'de?", asked), { kind: "weather", location: "İzmir", day: { kind: "today" } });
    assert.deepEqual(follow("Peki Ankara?", asked), { kind: "weather", location: "Ankara", day: { kind: "today" } });
    assert.deepEqual(follow("Ya hafta sonu?", asked), { kind: "weather", location: null, day: { kind: "weekend" } });
    for (const text of ["Yağacak mı?", "Kaç derece?", "Soğuk mu?", "Yarın sabah?"]) assert.equal(follow(text, asked)?.kind, "weather", text);
    for (const text of ["Teşekkürler", "Tamam", "Peki", "Emin misin?", "Yarın sabah beni uyandır"]) assert.equal(follow(text, asked), null, text);
    // A chain of follow-ups still leads back to the weather question; news, or only AYAS's own words, do not.
    const chain = [...asked, { role: "user", text: "Ya İzmir'de?" }, { role: "brain", text: "İzmir için şu an hava açık." }];
    assert.deepEqual(follow("Ya cumartesi?", chain), { kind: "weather", location: null, day: { kind: "weekday", weekday: 6 } });
    assert.equal(follow("Peki yarın?", [{ role: "user", text: "Gazze hakkındaki son haberler" }, { role: "brain", text: "…" }]), null);
    assert.equal(follow("Peki yarın?", [{ role: "brain", text: "Bursa'da hava nasıl?" }]), null);
    assert.equal(follow("Peki yarın?", [{ role: "user", text: "Bursa'da hava nasıl?" }, { role: "user", text: "Bu dosyayı aç" }]), null, "only the latest turns count");
    assert.deepEqual(resolveAyasPreReasoningIntent("Peki yarın?", asked), { kind: "live-info", liveInfo: { kind: "weather", location: null, day: { kind: "offset", days: 1 } } });
    assert.equal(resolveAyasPreReasoningIntent("Peki yarın?").kind, "reasoning");
  });

  await scenario("route precedence: earlier intents keep their texts, live-info only takes what went to reasoning", () => {
    assert.equal(resolveAyasPreReasoningIntent("Bursa'da hava nasıl?").kind, "live-info");
    assert.equal(resolveAyasPreReasoningIntent("Gazze hakkındaki son haberler neler?").kind, "live-info");
    assert.equal(resolveAyasPreReasoningIntent("hava durumu çalışmıyor").kind, "guided-repair");
    assert.equal(resolveAyasPreReasoningIntent("Bug raporunu göster").kind, "report-center");
    assert.equal(resolveAyasPreReasoningIntent("AYAS, araştırma ne durumda?").kind, "research-status");
    assert.equal(resolveAyasPreReasoningIntent("Benden ne onay bekliyorsun?").kind, "development-status");
    assert.equal(resolveAyasPreReasoningIntent("bugün hava çok güzel").kind, "reasoning");
    assert.equal(resolveAyasPreReasoningIntent("ne haber").kind, "reasoning");
    assert.deepEqual(resolveAyasPreReasoningIntent("Son dakika haberleri"), { kind: "live-info", liveInfo: { kind: "news", topic: null } });
  });

  /* ------------------------------------------------------------ weather --- */
  await scenario("weather today: current conditions, the day's range and the source, spoken", async () => {
    const read = fixtureReader([["geocoding-api", geo([BURSA])], ["api.open-meteo.com/v1/forecast", FORECAST]]);
    const answer = await answerAyasLiveInfo(weather("Bursa'da hava nasıl?"), { read });
    assert.equal(answer, "Bursa için şu an hava kapalı, 10 derece; hissedilen 9 derece. Nem yüzde 89, rüzgar saatte 3 kilometre. Bugün en düşük 8, en yüksek 19 derece bekleniyor, yağış ihtimali yüzde 10. Kaynak: Open-Meteo.");
    assert.equal(read.urls.length, 2);
    assert.match(read.urls[0]!, /^https:\/\/geocoding-api\.open-meteo\.com\/v1\/search\?name=Bursa&count=5&language=tr&format=json$/);
    assert.match(read.urls[1]!, /latitude=40\.1956&longitude=29\.0601/);
  });

  await scenario("weather on another day, a weekday, the weekend and below zero", async () => {
    const read = fixtureReader([["geocoding-api", geo([BURSA])], ["forecast", FORECAST]]);
    assert.equal(await answerAyasLiveInfo(weather("Yarın Bursa'da yağmur yağacak mı?"), { read }),
      "Bursa için yarın 17 Ekim hava hafif yağmurlu; en düşük 8, en yüksek 14 derece, yağış ihtimali yüzde 85. Kaynak: Open-Meteo.");
    assert.equal(await answerAyasLiveInfo(weather("Çarşamba Bursa'da hava nasıl?"), { read }),
      "Bursa için çarşamba 21 Ekim hava hafif karlı; en düşük eksi 3, en yüksek 2 derece, yağış ihtimali yüzde 60. Kaynak: Open-Meteo.");
    assert.equal(await answerAyasLiveInfo(weather("Hafta sonu Bursa'da hava nasıl?"), { read }),
      "Bursa için yarın 17 Ekim hava hafif yağmurlu; en düşük 8, en yüksek 14 derece, yağış ihtimali yüzde 85. Bursa için öbür gün 18 Ekim hava açık; en düşük 9, en yüksek 21 derece, yağış ihtimali yüzde 0. Kaynak: Open-Meteo.");
  });

  await scenario("a foreign place names its country; an exact Turkish match wins over a bigger foreign one", async () => {
    const paris = fixtureReader([["geocoding-api", geo([PARIS])], ["forecast", FORECAST]]);
    assert.match(await answerAyasLiveInfo(weather("Paris'te bugün hava nasıl?"), { read: paris }), /^Paris, Fransa için şu an hava kapalı/);
    const both = fixtureReader([["geocoding-api", geo([{ ...BURSA, country_code: "ET", country: "Etiyopya", latitude: 6.58 }, BURSA])], ["forecast", FORECAST]]);
    await answerAyasLiveInfo(weather("Bursa'da hava nasıl?"), { read: both });
    assert.match(both.urls[1]!, /latitude=40\.1956/);
  });

  await scenario("a typed case suffix is retried without it; an unknown place is said so", async () => {
    const read = fixtureReader([["name=bursada", geo([])], ["name=bursa&", geo([BURSA])], ["forecast", FORECAST]]);
    assert.match(await answerAyasLiveInfo(weather("bursada hava nasıl"), { read }), /^Bursa için şu an/);
    assert.deepEqual(read.urls.slice(0, 2).map((url) => new URL(url).searchParams.get("name")), ["bursada", "bursa"]);
    const unknown = fixtureReader([["geocoding-api", geo([])]]);
    assert.equal(await answerAyasLiveInfo(weather("Zzyzxville'de hava nasıl?"), { read: unknown }), "Zzyzxville adında bir yer bulamadım. Şehir adını kontrol edip tekrar sorar mısın?");
  });

  await scenario("no place: the owner's last named place, then the configured default, else ask", async () => {
    const read = fixtureReader([["geocoding-api", geo([BURSA])], ["forecast", FORECAST]]);
    const history = [{ role: "user", text: "Bursa'da hava nasıl?" }, { role: "brain", text: "Ankara'da hava nasıl diye sorma." }];
    assert.match(await answerAyasLiveInfo(weather("Yarın hava nasıl olacak?"), { read, history }), /^Bursa için yarın 17 Ekim/);
    assert.equal(new URL(read.urls[0]!).searchParams.get("name"), "Bursa");
    const fromEnv = fixtureReader([["geocoding-api", geo([PARIS])], ["forecast", FORECAST]]);
    assert.match(await answerAyasLiveInfo(weather("Hava durumu"), { read: fromEnv, env: env({ AYAS_WEATHER_DEFAULT_LOCATION: "Paris" }) }), /^Paris, Fransa/);
    const nothing = fixtureReader([]);
    assert.match(await answerAyasLiveInfo(weather("Hava durumu"), { read: nothing, env: env({}), history: [{ role: "brain", text: "Bursa'da hava nasıl?" }] }), /^Hangi şehir için bakayım\?/);
    assert.deepEqual(nothing.urls, [], "nothing is fetched without a place; an assistant turn is not the owner's");
  });

  await scenario("a follow-up answers for the place the conversation is on, including one named in an earlier follow-up", async () => {
    const asked = [{ role: "user", text: "Bursa'da hava nasıl?" }, { role: "brain", text: "Bursa için şu an hava kapalı." }];
    const read = fixtureReader([["geocoding-api", geo([BURSA])], ["forecast", FORECAST]]);
    const tomorrow = detectAyasLiveInfoIntent("Peki yarın?", asked)!;
    assert.equal(await answerAyasLiveInfo(tomorrow, { read, history: asked }),
      "Bursa için yarın 17 Ekim hava hafif yağmurlu; en düşük 8, en yüksek 14 derece, yağış ihtimali yüzde 85. Kaynak: Open-Meteo.");
    const izmir = fixtureReader([["geocoding-api", geo([{ ...BURSA, name: "İzmir", latitude: 38.41273, longitude: 27.13838 }])], ["forecast", FORECAST]]);
    const chain = [...asked, { role: "user", text: "Ya İzmir'de?" }, { role: "brain", text: "İzmir için şu an hava kapalı." }];
    assert.match(await answerAyasLiveInfo(detectAyasLiveInfoIntent("Yarın?", chain)!, { read: izmir, history: chain }), /^İzmir için yarın 17 Ekim/);
    assert.equal(new URL(izmir.urls[0]!).searchParams.get("name"), "İzmir");
  });

  await scenario("an unreachable or malformed weather source is an honest answer, never a throw", async () => {
    const message = "Hava durumu servisine şu an ulaşamıyorum; biraz sonra tekrar dener misin?";
    assert.equal(await answerAyasLiveInfo(weather("Bursa'da hava nasıl?"), { read: fixtureReader([["geocoding-api", down]]) }), message);
    assert.equal(await answerAyasLiveInfo(weather("Bursa'da hava nasıl?"), { read: fixtureReader([["geocoding-api", geo([BURSA])], ["forecast", ok("not json")]]) }), message);
    assert.equal(await answerAyasLiveInfo(weather("Bursa'da hava nasıl?"), { read: async () => { throw new Error("boom"); } }), message);
  });

  /* --------------------------------------------------------------- news --- */
  await scenario("news on a topic: the last week, newest first, duplicates once, the outlet named", async () => {
    const read = fixtureReader([["news.google.com/rss/search", rss([
      { title: "Eski gelişme - Hürriyet", date: "Wed, 14 Oct 2026 09:00:00 GMT" },
      { title: "Ateşkes görüşmeleri yeniden başladı - BBC News Türkçe", date: "Fri, 16 Oct 2026 10:00:00 GMT" },
      { title: "Ateşkes görüşmeleri yeniden başladı - Sözcü", date: "Fri, 16 Oct 2026 09:30:00 GMT" },
      { title: "Yardım tırları sınırda bekliyor! - Anadolu Ajansı", date: "Fri, 16 Oct 2026 11:45:00 GMT" },
      { title: "Bölgede son durum - NTV", date: "Thu, 15 Oct 2026 08:00:00 GMT" },
    ])]]);
    const answer = await answerAyasLiveInfo(news("Gazze hakkındaki son haberler neler?"), { read, now: () => NOW });
    assert.equal(answer, "Gazze ile ilgili en son 4 haber, Google Haberler üzerinden. "
      + "Birinci haber, Anadolu Ajansı, 15 dakika önce: Yardım tırları sınırda bekliyor! "
      + "İkinci haber, BBC News Türkçe, 2 saat önce: Ateşkes görüşmeleri yeniden başladı. "
      + "Üçüncü haber, NTV, dün: Bölgede son durum. "
      + "Dördüncü haber, Hürriyet, 2 gün önce: Eski gelişme.");
    assert.deepEqual(read.urls, ["https://news.google.com/rss/search?q=Gazze%20when%3A7d&hl=tr&gl=TR&ceid=TR:tr"]);
  });

  await scenario("a lower-case topic starts the sentence capitalised; a paragraph-long title is cut at a word", async () => {
    const long = `${"Isparta'da 2,7 büyüklüğünde deprem meydana geldi ".repeat(5).trim()} - Facebook`;
    const read = fixtureReader([["news.google.com", rss([{ title: long, date: "Fri, 16 Oct 2026 11:00:00 GMT" }])]]);
    const answer = await answerAyasLiveInfo(news("Bana internetten deprem haberlerini bul"), { read, now: () => NOW });
    assert.match(answer, /^Deprem ile ilgili en son 1 haber, Google Haberler üzerinden\. Birinci haber, Facebook, 1 saat önce: Isparta'da /);
    const headline = answer.slice(answer.indexOf("önce: ") + "önce: ".length);
    assert.ok(headline.endsWith("…") && headline.length <= 161 && !/\s…$/u.test(headline), headline);
  });

  await scenario("an empty week falls back to any date once; still nothing is said plainly", async () => {
    const read = fixtureReader([["when%3A7d", rss([])], ["search?q=Zzyzx&", rss([{ title: "Eski haber - Kaynak", date: "Mon, 01 Jun 2026 08:00:00 GMT" }])]]);
    assert.match(await answerAyasLiveInfo(news("Zzyzx hakkındaki haberler"), { read, now: () => NOW }), /^Zzyzx ile ilgili en son 1 haber, Google Haberler üzerinden\. Birinci haber, Kaynak, 137 gün önce: Eski haber\.$/);
    assert.equal(read.urls.length, 2);
    const empty = fixtureReader([["news.google.com", rss([])]]);
    assert.equal(await answerAyasLiveInfo(news("Zzyzx hakkındaki haberler"), { read: empty, now: () => NOW }), "Zzyzx ile ilgili güncel bir haber bulamadım.");
    assert.equal(empty.urls.length, 2, "at most two searches");
  });

  await scenario("top stories without a topic; BBC Türkçe when Google Haberler is down; both down is said so", async () => {
    const google = fixtureReader([["news.google.com/rss?hl=tr", rss([{ title: "Merkez Bankası faiz kararını açıkladı - Bloomberg HT", date: "Fri, 16 Oct 2026 11:00:00 GMT" }])]]);
    assert.equal(await answerAyasLiveInfo(news("Son dakika haberleri"), { read: google, now: () => NOW }),
      "Türkiye gündeminden en son 1 haber, Google Haberler üzerinden. Birinci haber, Bloomberg HT, 1 saat önce: Merkez Bankası faiz kararını açıkladı.");
    const bbc = fixtureReader([["news.google.com", down], ["feeds.bbci.co.uk", rss([{ title: "<![CDATA[MSCI'dan Türkiye kararı - piyasa]]>", date: "Fri, 16 Oct 2026 08:00:00 GMT" }], "https://feeds.bbci.co.uk/turkce/rss.xml")]]);
    assert.equal(await answerAyasLiveInfo(news("Gündemde ne var?"), { read: bbc, now: () => NOW }),
      "Türkiye gündeminden en son 1 haber, BBC News Türkçe üzerinden. Birinci haber, BBC News Türkçe, 4 saat önce: MSCI'dan Türkiye kararı - piyasa.");
    assert.equal(await answerAyasLiveInfo(news("Gündemde ne var?"), { read: fixtureReader([["news.google.com", down], ["bbci", down]]), now: () => NOW }), "Haber kaynaklarına şu an ulaşamıyorum; biraz sonra tekrar dener misin?");
    assert.equal(await answerAyasLiveInfo(news("Gazze haberleri"), { read: fixtureReader([["news.google.com", down]]), now: () => NOW }), "Haber kaynaklarına şu an ulaşamıyorum; biraz sonra tekrar dener misin?");
  });

  /* ------------------------------------------------------------- reader --- */
  await scenario("the reader reads only its fixed HTTPS hosts, and refuses a redirect off them", async () => {
    assert.deepEqual([...AYAS_LIVE_INFO_HOSTS], ["geocoding-api.open-meteo.com", "api.open-meteo.com", "news.google.com", "feeds.bbci.co.uk"]);
    const calls: string[] = [];
    const reader = createAyasLiveInfoReader(async (url, options) => {
      calls.push(url);
      assert.deepEqual([options.timeoutMs, options.maxRedirects, options.dangerouslyAllowPrivateNetworkForTests], [6_000, 2, undefined]);
      return ok("{}", "application/json", url.includes("redirect") ? "https://evil.example/landing" : url);
    });
    for (const url of ["https://evil.example/x", "http://api.open-meteo.com/v1/forecast", "https://api.open-meteo.com.evil.example/", "https://127.0.0.1/", "not a url"]) {
      const outcome = await reader(url);
      assert.equal(outcome.ok, false, url);
      assert.equal(outcome.ok ? "" : outcome.code, "AYAS_FETCH_BLOCKED_HOST", url);
    }
    assert.deepEqual(calls, [], "a refused URL never reaches the transport");
    assert.equal((await reader("https://api.open-meteo.com/v1/forecast?x=1")).ok, true);
    const redirected = await reader("https://news.google.com/rss?redirect=1");
    assert.equal(redirected.ok ? "" : redirected.code, "AYAS_FETCH_BLOCKED_HOST");
    assert.equal(calls.length, 2);
  });

  console.log(JSON.stringify({ status: "PASS", suite: "ayas-live-info", scenarios }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
