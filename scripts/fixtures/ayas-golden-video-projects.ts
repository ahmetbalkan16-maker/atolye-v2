/**
 * Stage 15O.3 — three golden historical-video projects.
 *
 * A golden project is everything the deterministic part of a historical video is made from, frozen: the fact pack,
 * the eight narrative units, and one character scene per unit. What the local engines make of it (the two reviews and
 * the rendered scene bytes) is frozen next to it in `ayas-golden-video-projects.expected.ts`.
 *
 * These are fixtures, not productions: no narration audio, no rendered video, no provider and no cost. The claims are
 * well-established history with real sources, and each project carries one disputed claim that has to be narrated as
 * uncertain, so the uncertainty rule is exercised by golden data and not only by negative tests.
 */
import type { CharacterSceneRequest } from "../../src/lib/character/CharacterSceneManifest";
import type { BlockedCharacter, BlockedProp, SceneBlocking } from "../../src/lib/character/SceneBlocking";
import type { HistoricalFactClaim, HistoricalFactPack } from "../../src/lib/storytelling/HistoricalFactPack";
import type { NarrativeBeat, NarrativeUnit } from "../../src/lib/storytelling/NarrativeContract";

export interface AyasGoldenVideoProject {
  readonly id: string;
  readonly factPack: HistoricalFactPack;
  /** Eight units, one per beat, in order. A unit's id is also its scene id. */
  readonly units: readonly NarrativeUnit[];
  readonly scenes: readonly CharacterSceneRequest[];
}

const BEATS: readonly NarrativeBeat[] = ["COLD_OPEN", "CONTEXT", "STAKES", "ESCALATION", "TURNING_POINT", "CONSEQUENCE", "PAYOFF", "LEGACY"];
type UnitSpec = readonly [narration: string, durationSeconds: number, year: number, claimIds: readonly string[], extra?: Partial<Pick<NarrativeUnit, "outOfSequence" | "setups" | "payoffs" | "transition">>];
const units = (specs: readonly UnitSpec[]): NarrativeUnit[] => specs.map(([narration, durationSeconds, year, claimIds, extra], index) => ({
  id: index + 1, beat: BEATS[index]!, narration, durationSeconds, year, transition: null, outOfSequence: false, claimIds, setups: [], payoffs: [], staticVisualSeconds: 10, ...extra,
}));
const claim = (id: string, sceneIds: readonly number[], statement: string, dates: readonly string[], people: readonly string[], locations: readonly string[], sourceIds: readonly string[], certainty: HistoricalFactClaim["certainty"] = "ESTABLISHED"): HistoricalFactClaim =>
  ({ id, statement, dates, people, locations, certainty, sourceIds, sceneIds });
const person = (id: string, x: number, over: Partial<BlockedCharacter> = {}): BlockedCharacter => ({ id, x, depth: 0.2, facing: "RIGHT", pose: "STAND", expression: "NEUTRAL", costume: "NONE", handProp: null, ...over });
const prop = (kind: BlockedProp["prop"], x: number, depth = 0.6, facing: BlockedProp["facing"] = "RIGHT"): BlockedProp => ({ prop: kind, x, depth, facing });
const scene = (sceneId: number, claimIds: readonly string[], cameraBeat: CharacterSceneRequest["cameraBeat"], blocking: SceneBlocking): CharacterSceneRequest =>
  ({ sceneId, format: "DOCUMENTARY", language: "tr", blocking, cameraBeat, claimIds });

const ISTANBUL: AyasGoldenVideoProject = {
  id: "istanbul-1453",
  factPack: {
    schemaVersion: "1", topic: "İstanbul'un Fethi",
    sources: [
      { id: "kritovulos", kind: "PRIMARY", title: "Kritovulos, Fatih Sultan Mehmed'in tarihi", reference: "Kritovoulos, History of Mehmed the Conqueror, çev. C. T. Riggs, Princeton University Press, 1954" },
      { id: "dukas", kind: "PRIMARY", title: "Dukas, Bizans tarihi", reference: "Doukas, Decline and Fall of Byzantium to the Ottoman Turks, çev. H. J. Magoulias, Wayne State University Press, 1975" },
      { id: "runciman", kind: "SECONDARY", title: "Steven Runciman, The Fall of Constantinople 1453", reference: "Cambridge University Press, 1965" },
      { id: "inalcik", kind: "SECONDARY", title: "Halil İnalcık, İstanbul: Türk Devri", reference: "TDV İslâm Ansiklopedisi, cilt 23, 2001" },
    ],
    claims: [
      claim("zincir", [1], "1453'teki kuşatmada Bizans, Haliç'in girişini bir zincirle kapatmıştı.", ["1453"], [], ["Haliç"], ["kritovulos", "runciman"]),
      claim("hisar", [2], "II. Mehmed 1452'de Boğaz'ın Rumeli yakasına Rumeli Hisarı'nı yaptırdı ve Boğaz'dan geçişi denetim altına aldı.", ["1452"], ["II. Mehmed"], ["Rumeli Hisarı", "Boğaz"], ["kritovulos", "inalcik"]),
      claim("kusatma", [3], "Osmanlı ordusu 6 Nisan 1453'te Konstantinopolis'i kuşatmaya başladı; şehri İmparator XI. Konstantinos savunuyordu.", ["6 Nisan 1453"], ["XI. Konstantinos"], ["Konstantinopolis"], ["kritovulos", "runciman"]),
      claim("toplar", [4], "Kuşatmada Macar dökümcü Urban'ın döktüğü büyük toplar Theodosius Surları'nı dövdü.", ["1453"], ["Urban"], ["Theodosius Surları"], ["kritovulos", "runciman"]),
      claim("gemiler", [5], "Osmanlı gemileri 22 Nisan 1453'te Galata'nın arkasından karadan yürütülerek Haliç'e indirildi.", ["22 Nisan 1453"], [], ["Galata", "Haliç"], ["kritovulos", "dukas", "runciman"]),
      claim("dusus", [6], "Şehir 29 Mayıs 1453'te Osmanlıların eline geçti; XI. Konstantinos son saldırıda öldü.", ["29 Mayıs 1453"], ["XI. Konstantinos"], ["Konstantinopolis"], ["kritovulos", "dukas", "runciman"]),
      claim("kerkoporta", [6], "Dukas'a göre surlardaki Kerkoporta adlı küçük bir kapı açık unutulmuştu; başka hiçbir kaynak bunu anlatmaz.", ["1453"], ["Dukas"], ["Kerkoporta"], ["dukas", "runciman"], "DISPUTED"),
      claim("ayasofya", [7], "II. Mehmed 1453'te şehre girdi ve Ayasofya'yı camiye çevirdi.", ["1453"], ["II. Mehmed"], ["Ayasofya"], ["kritovulos", "inalcik"]),
      claim("baskent", [8], "Fetihten sonra şehir Osmanlı Devleti'nin başkenti oldu ve II. Mehmed, Fatih adıyla anıldı.", [], ["II. Mehmed"], ["İstanbul"], ["inalcik"]),
    ],
  },
  units: units([
    ["Yıl 1453. Haliç'in girişinde demir bir zincir geriliydi ve hiçbir gemi içeri giremiyordu. Surların önünde bekleyen genç sultan, bu zinciri denizden aşamayacağını biliyordu. Peki gemiler Haliç'e nasıl girecekti?", 70, 1453, ["zincir"], { setups: ["zincir nasıl aşılacak"] }],
    ["Hikâye bir yıl önce başlar. 1452'de II. Mehmed, Boğaz'ın Rumeli yakasına Rumeli Hisarı'nı yaptırdı. Hisar, Boğaz'dan geçen her gemiyi denetim altına aldı ve kuşatmanın ilk adımı oldu.", 90, 1452, ["hisar"], { outOfSequence: true }],
    ["6 Nisan 1453'te Osmanlı ordusu Konstantinopolis'in önüne geldi ve kuşatma başladı. Şehri İmparator XI. Konstantinos savunuyordu. İki taraf da bu surların düşmesinin neye mal olacağını biliyordu.", 80, 1453, ["kusatma"]],
    ["Kuşatmanın sesi toplardı. Macar dökümcü Urban'ın döktüğü büyük toplar günlerce Theodosius Surları'nı dövdü. Savunucular her gece yıkılan yerleri onardı, ama surlar her gün biraz daha zayıfladı.", 110, 1453, ["toplar"]],
    ["22 Nisan 1453 sabahı savunucular beklemedikleri bir manzarayla uyandı. Osmanlı gemileri Galata'nın arkasından karadan yürütülmüş ve Haliç'e indirilmişti. Zincir yerinde duruyordu, ama artık hiçbir şeyi korumuyordu.", 110, 1453, ["gemiler"], { payoffs: ["zincir nasıl aşılacak"] }],
    ["29 Mayıs 1453'te son saldırı başladı ve şehir Osmanlıların eline geçti. XI. Konstantinos surlarda savaşırken öldü. Rivayete göre Kerkoporta adlı küçük bir kapı açık unutulmuştu; bunu yalnızca Dukas anlatır ve doğruluğu tartışmalı.", 100, 1453, ["dusus", "kerkoporta"]],
    ["Aynı gün II. Mehmed şehre girdi. Ayasofya'ya gitti ve yapıyı camiye çevirdi. Kuşatmanın başındaki soru cevabını bulmuştu: surlar aşılmış, zincir anlamını yitirmişti.", 80, 1453, ["ayasofya"]],
    ["Fetihten sonra şehir Osmanlı Devleti'nin başkenti oldu. II. Mehmed bundan sonra Fatih adıyla anıldı. İstanbul yüzyıllar boyunca bir imparatorluğun merkezi olarak kaldı.", 80, 1453, ["baskent"]],
  ]),
  scenes: [
    scene(1, ["zincir"], "PUSH_IN", { backdrop: "SEA", time: "DUSK", caption: "Haliç, 1453", arrows: [{ fromX: 0.3, fromY: 0.88, toX: 0.8, toY: 0.88 }],
      props: [prop("SHIP", 0.2, 0.7), prop("TOWER", 0.9, 0.8, "LEFT")], characters: [person("sultan", 0.45, { pose: "POINT", expression: "DETERMINED", costume: "TURBAN" }), person("asker", 0.3, { costume: "HELMET", handProp: "SPEAR" })] }),
    scene(2, ["hisar"], "PAN_RIGHT", { backdrop: "MOUNTAINS", time: "DAY", caption: "Rumeli Hisarı, 1452", arrows: [],
      props: [prop("TOWER", 0.3, 0.7), prop("TOWER", 0.6, 0.8), prop("SHIP", 0.88, 0.9, "LEFT")], characters: [person("sultan", 0.2, { pose: "POINT", costume: "TURBAN" }), person("usta", 0.45, { pose: "WALK", handProp: "SCROLL" })] }),
    scene(3, ["kusatma"], "PULL_OUT", { backdrop: "CITY_WALLS", time: "DAY", caption: "Konstantinopolis, 6 Nisan 1453", arrows: [],
      props: [prop("TENT", 0.15, 0.7), prop("TENT", 0.32, 0.8)], characters: [person("sancaktar", 0.3, { handProp: "FLAG", costume: "HELMET" }), person("asker-1", 0.45, { handProp: "SPEAR", costume: "ARMOR" }), person("asker-2", 0.58, { handProp: "SHIELD", costume: "HELMET" }),
        person("imparator", 0.85, { depth: 0.5, facing: "LEFT", costume: "CROWN", expression: "DETERMINED" })] }),
    scene(4, ["toplar"], "HOLD", { backdrop: "CITY_WALLS", time: "NIGHT", caption: "Kuşatma topları", arrows: [{ fromX: 0.3, fromY: 0.6, toX: 0.75, toY: 0.4 }, { fromX: 0.45, fromY: 0.62, toX: 0.8, toY: 0.45 }],
      props: [prop("CANNON", 0.22, 0.3), prop("CANNON", 0.4, 0.4)], characters: [person("topcu", 0.12, { pose: "KNEEL", handProp: "TORCH" }), person("urban", 0.52, { pose: "POINT", costume: "HOOD" })] }),
    scene(5, ["gemiler"], "PAN_LEFT", { backdrop: "FIELD", time: "DAY", caption: "Haliç, 22 Nisan 1453", arrows: [{ fromX: 0.3, fromY: 0.9, toX: 0.9, toY: 0.9 }],
      props: [prop("SHIP", 0.35, 0.5), prop("SHIP", 0.7, 0.7), prop("TREE", 0.1, 0.9)], characters: [person("cekici-1", 0.5, { pose: "WALK" }), person("cekici-2", 0.6, { pose: "WALK" }), person("kaptan", 0.82, { pose: "ARMS_RAISED", costume: "TURBAN" })] }),
    scene(6, ["dusus", "kerkoporta"], "PUSH_IN", { backdrop: "CITY_WALLS", time: "DUSK", caption: "29 Mayıs 1453", arrows: [{ fromX: 0.3, fromY: 0.9, toX: 0.62, toY: 0.9 }],
      props: [prop("TOWER", 0.85, 0.7, "LEFT")], characters: [person("akinci-1", 0.25, { pose: "SWORD_RAISED", handProp: "SWORD", costume: "HELMET", expression: "ANGRY" }), person("akinci-2", 0.38, { pose: "RUN", handProp: "FLAG", costume: "HELMET" }),
        person("imparator", 0.66, { facing: "LEFT", pose: "SWORD_RAISED", handProp: "SWORD", costume: "CROWN", expression: "DETERMINED" }), person("savunucu", 0.78, { facing: "LEFT", pose: "FALLEN", costume: "ARMOR" })] }),
    scene(7, ["ayasofya"], "HOLD", { backdrop: "INTERIOR", time: "DAY", caption: "Ayasofya, 1453", arrows: [],
      props: [], characters: [person("sultan", 0.5, { costume: "TURBAN", expression: "NEUTRAL" }), person("vezir", 0.3, { pose: "BOW", costume: "ROBE" }), person("muhafiz", 0.72, { facing: "LEFT", costume: "HELMET", handProp: "SPEAR" })] }),
    scene(8, ["baskent"], "PULL_OUT", { backdrop: "INTERIOR", time: "DAY", caption: "Başkent İstanbul", arrows: [],
      props: [prop("THRONE", 0.5, 0.5), prop("TABLE", 0.22, 0.4)], characters: [person("sultan", 0.5, { pose: "SIT", costume: "TURBAN", expression: "HAPPY" }), person("katip", 0.24, { pose: "STAND", costume: "ROBE", handProp: "SCROLL" })] }),
  ],
};

const MALAZGIRT: AyasGoldenVideoProject = {
  id: "malazgirt-1071",
  factPack: {
    schemaVersion: "1", topic: "Malazgirt Meydan Muharebesi",
    sources: [
      { id: "attaleiates", kind: "PRIMARY", title: "Mikhail Attaleiates, Tarih", reference: "Michael Attaleiates, The History, çev. A. Kaldellis ve D. Krallis, Harvard University Press, 2012" },
      { id: "ibnulesir", kind: "PRIMARY", title: "İbnü'l-Esîr, el-Kâmil fi't-Târîh", reference: "The Annals of the Saljuq Turks, çev. D. S. Richards, Routledge, 2002" },
      { id: "hillenbrand", kind: "SECONDARY", title: "Carole Hillenbrand, Turkish Myth and Muslim Symbol: The Battle of Manzikert", reference: "Edinburgh University Press, 2007" },
      { id: "cahen", kind: "SECONDARY", title: "Claude Cahen, Pre-Ottoman Turkey", reference: "Sidgwick & Jackson, 1968" },
    ],
    claims: [
      claim("esir", [1], "1071'deki savaşın sonunda Bizans İmparatoru Romanos Diogenes esir alındı ve Selçuklu Sultanı Alp Arslan'ın huzuruna getirildi.", ["1071"], ["Alp Arslan", "Romanos Diogenes"], ["Malazgirt"], ["attaleiates", "ibnulesir", "hillenbrand"]),
      claim("sefer", [2], "1071 baharında IV. Romanos Diogenes büyük bir orduyla Anadolu'nun doğusuna yürüdü; ordusu farklı birliklerden ve paralı askerlerden toplanmıştı.", ["1071"], ["IV. Romanos Diogenes"], ["Anadolu"], ["attaleiates", "cahen"]),
      claim("yonelis", [3], "Alp Arslan, Suriye seferini yarıda bırakıp ordusuyla Malazgirt'e yöneldi; savaştan önceki barış önerisi geri çevrildi.", ["1071"], ["Alp Arslan"], ["Malazgirt"], ["ibnulesir", "hillenbrand"]),
      claim("karsilasma", [4], "İki ordu 26 Ağustos 1071'de Malazgirt ovasında karşılaştı.", ["26 Ağustos 1071"], [], ["Malazgirt"], ["attaleiates", "hillenbrand"]),
      claim("sayilar", [4], "Orduların sayısı kaynaklarda çok farklı verilir.", ["1071"], [], [], ["hillenbrand", "cahen"], "DISPUTED"),
      claim("dagilma", [5], "Selçuklu süvarileri geri çekilip yeniden saldırarak Bizans ordusunu yıprattı; artçı birliklerin komutanı Andronikos Dukas savaş alanını terk etti ve ordu kuşatıldı.", ["1071"], ["Andronikos Dukas"], [], ["attaleiates", "hillenbrand"]),
      claim("antlasma", [6], "Alp Arslan esir imparatorla bir antlaşma yaptı ve onu serbest bıraktı.", ["1071"], ["Alp Arslan", "Romanos Diogenes"], [], ["attaleiates", "ibnulesir"]),
      claim("son", [7], "Romanos Diogenes dönüşünde tahtını kaybetti; 1072'de gözlerine mil çekildi ve öldü.", ["1072"], ["Romanos Diogenes"], [], ["attaleiates", "hillenbrand"]),
      claim("meliksah", [8], "Alp Arslan 1072'de öldü; yerine oğlu Melikşah geçti.", ["1072"], ["Alp Arslan", "Melikşah"], [], ["ibnulesir", "cahen"]),
      claim("yerlesme", [8], "Malazgirt'ten sonraki yıllarda Türkmen boyları Anadolu'ya yerleşti.", [], [], ["Anadolu"], ["cahen", "hillenbrand"]),
    ],
  },
  units: units([
    ["Ağustos 1071. Bir Bizans imparatoru, esir olarak bir Selçuklu sultanının çadırına getirildi. Malazgirt'te yenilen Romanos Diogenes, karşısında Alp Arslan'ı buldu. Bu noktaya nasıl gelinmişti ve imparatoru ne bekliyordu?", 70, 1071, ["esir"], { setups: ["imparatoru ne bekliyor"] }],
    ["Aylar önce, 1071 baharında, Romanos Diogenes büyük bir orduyla doğuya yürümüştü. Amacı Anadolu'nun doğusundaki akınları durdurmaktı. Ordu kalabalıktı, ama farklı birliklerden ve paralı askerlerden toplanmıştı.", 90, 1071, ["sefer"]],
    ["Haberi alan Alp Arslan, Suriye seferini yarıda bıraktı ve ordusuyla Malazgirt'e yöneldi. Savaştan önce barış önerdi; öneri geri çevrildi. Artık iki ordudan biri bu ovadan yenilmiş çıkacaktı.", 80, 1071, ["yonelis"]],
    ["İki ordu 26 Ağustos 1071'de Malazgirt ovasında karşılaştı. Orduların sayısı kaynaklarda çok farklı verilir ve kesin olarak bilinmiyor. Bizans hattı ağır ağır ilerledi; atlı okçular ise yaklaşıp ok atıyor, sonra geri çekiliyordu.", 110, 1071, ["karsilasma", "sayilar"]],
    ["Akşama doğru imparator geri dönme emri verdi. Emir yanlış anlaşıldı; artçı birliklerin komutanı Andronikos Dukas savaş alanını terk etti. Selçuklu süvarileri geri döndü ve dağılan orduyu kuşattı.", 110, 1071, ["dagilma"]],
    ["Romanos Diogenes yaralandı ve esir düştü. Alp Arslan onu öldürmedi. Esir imparatorla bir antlaşma yaptı, onu konuk gibi ağırladı ve serbest bıraktı.", 90, 1071, ["antlasma"]],
    ["İmparatoru asıl felaket kendi başkentinde bekliyordu. Romanos Diogenes dönüşünde tahtını kaybetti. 1072'de gözlerine mil çekildi ve kısa süre sonra öldü.", 90, 1072, ["son"], { payoffs: ["imparatoru ne bekliyor"] }],
    ["Alp Arslan da 1072'de öldü; yerine oğlu Melikşah geçti. Sonraki yıllarda Türkmen boyları Anadolu'ya yerleşti. Malazgirt, bu yüzden bir savaştan çok bir kapının açılışı olarak hatırlanır.", 80, 1072, ["meliksah", "yerlesme"]],
  ]),
  scenes: [
    scene(1, ["esir"], "PUSH_IN", { backdrop: "FIELD", time: "DUSK", caption: "Malazgirt, 1071", arrows: [],
      props: [prop("TENT", 0.75, 0.6, "LEFT")], characters: [person("sultan", 0.68, { facing: "LEFT", costume: "TURBAN", expression: "NEUTRAL" }), person("imparator", 0.4, { pose: "KNEEL", costume: "CROWN", expression: "SAD" }), person("muhafiz", 0.25, { costume: "HELMET", handProp: "SPEAR" })] }),
    scene(2, ["sefer"], "PAN_RIGHT", { backdrop: "MOUNTAINS", time: "DAY", caption: "Anadolu, 1071 baharı", arrows: [{ fromX: 0.3, fromY: 0.9, toX: 0.9, toY: 0.9 }],
      props: [prop("HORSE", 0.3, 0.4), prop("TENT", 0.85, 0.9, "LEFT")], characters: [person("imparator", 0.45, { pose: "POINT", costume: "CROWN" }), person("asker-1", 0.6, { pose: "WALK", costume: "ARMOR", handProp: "SPEAR" }), person("asker-2", 0.72, { pose: "WALK", costume: "HELMET", handProp: "SHIELD" })] }),
    scene(3, ["yonelis"], "PAN_LEFT", { backdrop: "FIELD", time: "DAY", caption: "Malazgirt'e doğru", arrows: [{ fromX: 0.9, fromY: 0.9, toX: 0.3, toY: 0.9 }],
      props: [prop("HORSE", 0.7, 0.4, "LEFT"), prop("HORSE", 0.5, 0.5, "LEFT")], characters: [person("sultan", 0.62, { facing: "LEFT", pose: "POINT", costume: "TURBAN", expression: "DETERMINED" }), person("elci", 0.3, { facing: "LEFT", pose: "WALK", handProp: "SCROLL", costume: "ROBE" })] }),
    scene(4, ["karsilasma", "sayilar"], "PULL_OUT", { backdrop: "FIELD", time: "DAY", caption: "26 Ağustos 1071", arrows: [{ fromX: 0.75, fromY: 0.3, toX: 0.35, toY: 0.34 }, { fromX: 0.3, fromY: 0.9, toX: 0.52, toY: 0.9 }],
      props: [prop("HORSE", 0.8, 0.5, "LEFT")], characters: [person("bizans-1", 0.2, { costume: "ARMOR", handProp: "SHIELD" }), person("bizans-2", 0.3, { costume: "ARMOR", handProp: "SPEAR" }), person("bizans-3", 0.4, { costume: "HELMET", handProp: "SPEAR" }),
        person("okcu-1", 0.72, { facing: "LEFT", handProp: "BOW", costume: "HOOD" }), person("okcu-2", 0.86, { facing: "LEFT", handProp: "BOW", costume: "HOOD" })] }),
    scene(5, ["dagilma"], "HOLD", { backdrop: "FIELD", time: "DUSK", caption: "Akşam, Malazgirt ovası", arrows: [{ fromX: 0.42, fromY: 0.9, toX: 0.28, toY: 0.9 }, { fromX: 0.92, fromY: 0.9, toX: 0.6, toY: 0.9 }],
      props: [prop("HORSE", 0.85, 0.4, "LEFT")], characters: [person("artci", 0.15, { facing: "LEFT", pose: "RUN", costume: "ARMOR" }), person("imparator", 0.45, { pose: "SWORD_RAISED", handProp: "SWORD", costume: "CROWN", expression: "SURPRISED" }),
        person("suvari-1", 0.7, { facing: "LEFT", pose: "RUN", handProp: "SWORD", costume: "HELMET" }), person("suvari-2", 0.82, { facing: "LEFT", pose: "RUN", handProp: "BOW", costume: "HOOD" })] }),
    scene(6, ["antlasma"], "HOLD", { backdrop: "INTERIOR", time: "NIGHT", caption: "Antlaşma", arrows: [],
      props: [prop("TABLE", 0.5, 0.3)], characters: [person("sultan", 0.66, { facing: "LEFT", pose: "SIT", costume: "TURBAN", expression: "NEUTRAL" }), person("imparator", 0.34, { pose: "SIT", costume: "CROWN", expression: "SAD" }), person("katip", 0.5, { depth: 0.6, costume: "ROBE", handProp: "SCROLL" })] }),
    scene(7, ["son"], "PUSH_IN", { backdrop: "CITY_WALLS", time: "DUSK", caption: "1072", arrows: [],
      props: [prop("THRONE", 0.7, 0.6, "LEFT")], characters: [person("imparator", 0.35, { pose: "KNEEL", costume: "ROBE", expression: "SAD" }), person("yeni-hukumdar", 0.7, { facing: "LEFT", costume: "CROWN", expression: "ANGRY" }), person("muhafiz", 0.5, { facing: "LEFT", costume: "HELMET", handProp: "SPEAR" })] }),
    scene(8, ["meliksah", "yerlesme"], "PULL_OUT", { backdrop: "MOUNTAINS", time: "DAY", caption: "Anadolu", arrows: [{ fromX: 0.92, fromY: 0.9, toX: 0.35, toY: 0.9 }],
      props: [prop("TENT", 0.25, 0.6), prop("TENT", 0.42, 0.75), prop("HORSE", 0.75, 0.4, "LEFT"), prop("TREE", 0.08, 0.85)], characters: [person("gocer-1", 0.6, { facing: "LEFT", pose: "WALK", costume: "HOOD" }), person("gocer-2", 0.7, { facing: "LEFT", pose: "WALK", costume: "CAPE", handProp: "FLAG" })] }),
  ],
};

const PREVEZE: AyasGoldenVideoProject = {
  id: "preveze-1538",
  factPack: {
    schemaVersion: "1", topic: "Preveze Deniz Muharebesi",
    sources: [
      { id: "gazavat", kind: "PRIMARY", title: "Seyyid Murâdî, Gazavât-ı Hayreddin Paşa", reference: "16. yüzyıl Osmanlı gazavatnâmesi; Barbaros Hayreddin Paşa'nın anlatımına dayanır" },
      { id: "katipcelebi", kind: "SECONDARY", title: "Kâtib Çelebi, Tuhfetü'l-Kibâr fî Esfâri'l-Bihâr", reference: "17. yüzyıl Osmanlı deniz tarihi; haz. İdris Bostan, 2008" },
      { id: "bostan", kind: "SECONDARY", title: "İdris Bostan, Preveze Deniz Savaşı", reference: "TDV İslâm Ansiklopedisi, cilt 34, 2007" },
      { id: "guilmartin", kind: "SECONDARY", title: "John F. Guilmartin, Gunpowder and Galleys", reference: "Cambridge University Press, 1974" },
    ],
    claims: [
      claim("karsilasma", [1], "İki donanma 28 Eylül 1538'de Preveze önlerinde karşılaştı; Osmanlı donanmasının başında Barbaros Hayreddin Paşa vardı.", ["28 Eylül 1538"], ["Barbaros Hayreddin Paşa"], ["Preveze"], ["gazavat", "bostan", "guilmartin"]),
      claim("kaptanlik", [2], "Cezayir'i yöneten Barbaros Hayreddin Paşa 1534'te Osmanlı donanmasının başına, kaptan-ı deryalığa getirildi.", ["1534"], ["Barbaros Hayreddin Paşa"], ["Cezayir", "Akdeniz"], ["gazavat", "bostan"]),
      claim("ittifak", [3], "1538'de Papa III. Paulus'un çağrısıyla Venedik, İspanya ve Papalık bir Kutsal İttifak donanması kurdu; başına Andrea Doria getirildi.", ["1538"], ["III. Paulus", "Andrea Doria"], ["Venedik"], ["bostan", "guilmartin"]),
      claim("korfez", [4], "Osmanlı donanması Arta Körfezi'nin içinde, kıyı toplarının koruması altında bekledi; müttefik donanması körfeze giremedi.", ["1538"], [], ["Arta Körfezi"], ["katipcelebi", "guilmartin"]),
      claim("sayilar", [4], "İki donanmanın gemi sayısı kaynaklara göre değişir.", ["1538"], [], [], ["bostan", "guilmartin"], "DISPUTED"),
      claim("ruzgar", [5], "Rüzgârın kesilmesiyle müttefiklerin yelkenli büyük gemileri hareketsiz kaldı; Barbaros körfezden çıkarak kadırgalarıyla saldırdı.", ["1538"], ["Barbaros Hayreddin Paşa"], [], ["katipcelebi", "guilmartin"]),
      claim("cekilme", [6], "Andrea Doria geri çekildi ve savaş Osmanlı donanmasının üstünlüğüyle sonuçlandı.", ["1538"], ["Andrea Doria"], [], ["bostan", "guilmartin"]),
      claim("baris", [7], "Venedik 1540'ta Osmanlı Devleti'yle barış yaptı ve savaş tazminatı ödedi.", ["1540"], [], ["Venedik"], ["bostan"]),
      claim("olum", [8], "Barbaros Hayreddin Paşa 1546'da İstanbul'da öldü.", ["1546"], ["Barbaros Hayreddin Paşa"], ["İstanbul"], ["bostan"]),
      claim("ustunluk", [8], "Osmanlı donanması Akdeniz'deki üstünlüğünü 1571'deki İnebahtı Deniz Muharebesi'ne kadar korudu.", ["1571"], [], ["Akdeniz", "İnebahtı"], ["bostan", "guilmartin"]),
    ],
  },
  units: units([
    ["28 Eylül 1538. Preveze önlerinde iki donanma karşı karşıyaydı. Körfezin içinde bekleyen Barbaros, günlerdir dışarı çıkmıyordu. Neyi bekliyordu?", 60, 1538, ["karsilasma"], { setups: ["neden çıkmıyor"] }],
    ["Dört yıl önce, 1534'te, Barbaros Hayreddin Paşa Osmanlı donanmasının başına getirilmişti. Cezayir'i yöneten bu denizci, kaptan-ı deryalık makamına oturdu. Akdeniz'deki denge onunla birlikte değişmeye başladı.", 90, 1534, ["kaptanlik"], { outOfSequence: true }],
    ["1538'de Papa III. Paulus'un çağrısıyla bir Kutsal İttifak kuruldu. Venedik, İspanya ve Papalık gemilerini birleştirdi; başlarına Andrea Doria getirildi. Amaç, Osmanlı donanmasını denizden silmekti.", 90, 1538, ["ittifak"]],
    ["Barbaros donanmasını Arta Körfezi'nin içine çekti ve kıyı toplarının koruması altında bekledi. Müttefik donanması körfeze giremedi. Gemi sayıları kaynaklara göre değişir; müttefiklerin daha kalabalık olduğu söylenir.", 110, 1538, ["korfez", "sayilar"]],
    ["Rüzgâr kesildiğinde Barbaros beklediği anı buldu. Müttefiklerin büyük yelkenli gemileri hareketsiz kaldı. Osmanlı kadırgaları körfezden çıktı ve küreklerle saldırıya geçti.", 110, 1538, ["ruzgar"], { payoffs: ["neden çıkmıyor"] }],
    ["Akşam olduğunda Andrea Doria geri çekilme emri verdi. Müttefik donanması gece karanlığında dağıldı. Savaş, Osmanlı donanmasının üstünlüğüyle sonuçlandı.", 90, 1538, ["cekilme"]],
    ["Sonuç iki yıl sonra masada alındı. Venedik 1540'ta Osmanlı Devleti'yle barış yaptı ve savaş tazminatı ödedi. Kutsal İttifak dağılmıştı.", 80, 1540, ["baris"]],
    ["Barbaros Hayreddin Paşa 1546'da İstanbul'da öldü. Kurduğu donanma, Akdeniz'deki üstünlüğünü 1571'deki İnebahtı Deniz Muharebesi'ne kadar korudu. Preveze, bu üstünlüğün başladığı gün olarak hatırlanır.", 90, 1546, ["olum", "ustunluk"]],
  ]),
  scenes: [
    scene(1, ["karsilasma"], "PUSH_IN", { backdrop: "SEA", time: "DAY", caption: "Preveze, 28 Eylül 1538", arrows: [],
      props: [prop("SHIP", 0.22, 0.6), prop("SHIP", 0.78, 0.7, "LEFT"), prop("TOWER", 0.06, 0.9)], characters: [person("barbaros", 0.3, { pose: "STAND", costume: "TURBAN", expression: "DETERMINED" }), person("levent", 0.18, { costume: "HOOD", handProp: "SPEAR" })] }),
    scene(2, ["kaptanlik"], "HOLD", { backdrop: "INTERIOR", time: "DAY", caption: "İstanbul, 1534", arrows: [],
      props: [prop("THRONE", 0.72, 0.5, "LEFT")], characters: [person("padisah", 0.72, { facing: "LEFT", pose: "SIT", costume: "TURBAN" }), person("barbaros", 0.42, { pose: "BOW", costume: "CAPE" }), person("vezir", 0.25, { costume: "ROBE", handProp: "SCROLL" })] }),
    scene(3, ["ittifak"], "PAN_RIGHT", { backdrop: "SEA", time: "DAY", caption: "Kutsal İttifak, 1538", arrows: [{ fromX: 0.3, fromY: 0.9, toX: 0.9, toY: 0.9 }],
      props: [prop("SHIP", 0.2, 0.6), prop("SHIP", 0.45, 0.75), prop("SHIP", 0.7, 0.6)], characters: [person("doria", 0.3, { pose: "POINT", costume: "HELMET", expression: "DETERMINED" }), person("elci", 0.5, { costume: "ROBE", handProp: "FLAG" })] }),
    scene(4, ["korfez", "sayilar"], "HOLD", { backdrop: "SEA", time: "DUSK", caption: "Arta Körfezi", arrows: [{ fromX: 0.85, fromY: 0.6, toX: 0.6, toY: 0.6 }],
      props: [prop("SHIP", 0.3, 0.6), prop("CANNON", 0.12, 0.3), prop("TOWER", 0.05, 0.8), prop("SHIP", 0.85, 0.8, "LEFT")], characters: [person("barbaros", 0.32, { pose: "STAND", costume: "TURBAN" }), person("topcu", 0.14, { pose: "KNEEL", handProp: "TORCH" })] }),
    scene(5, ["ruzgar"], "PAN_RIGHT", { backdrop: "SEA", time: "DAY", caption: "Rüzgâr kesildi", arrows: [{ fromX: 0.45, fromY: 0.9, toX: 0.75, toY: 0.9 }],
      props: [prop("SHIP", 0.2, 0.5), prop("SHIP", 0.35, 0.7), prop("SHIP", 0.82, 0.7, "LEFT")], characters: [person("barbaros", 0.22, { pose: "SWORD_RAISED", handProp: "SWORD", costume: "TURBAN", expression: "DETERMINED" }), person("levent-1", 0.36, { pose: "RUN", costume: "HOOD", handProp: "SWORD" })] }),
    scene(6, ["cekilme"], "PULL_OUT", { backdrop: "SEA", time: "NIGHT", caption: "Geri çekilme", arrows: [{ fromX: 0.72, fromY: 0.9, toX: 0.95, toY: 0.9 }],
      props: [prop("SHIP", 0.7, 0.7), prop("SHIP", 0.25, 0.5)], characters: [person("doria", 0.68, { pose: "POINT", costume: "HELMET", expression: "SAD" }), person("barbaros", 0.25, { pose: "ARMS_RAISED", costume: "TURBAN", expression: "HAPPY" })] }),
    scene(7, ["baris"], "HOLD", { backdrop: "INTERIOR", time: "DAY", caption: "Barış, 1540", arrows: [],
      props: [prop("TABLE", 0.5, 0.3)], characters: [person("osmanli-elci", 0.66, { facing: "LEFT", pose: "SIT", costume: "TURBAN" }), person("venedik-elci", 0.34, { pose: "SIT", costume: "ROBE", handProp: "SCROLL", expression: "SAD" })] }),
    scene(8, ["olum", "ustunluk"], "PULL_OUT", { backdrop: "SEA", time: "DUSK", caption: "Akdeniz", arrows: [],
      props: [prop("SHIP", 0.3, 0.6), prop("SHIP", 0.55, 0.75), prop("SHIP", 0.8, 0.65)], characters: [person("denizci", 0.42, { pose: "STAND", costume: "TURBAN", handProp: "FLAG" })] }),
  ],
};

/** Frozen with the vault: adding, removing or editing a project is a new vault version. */
export const AYAS_GOLDEN_VIDEO_PROJECTS: readonly AyasGoldenVideoProject[] = Object.freeze([ISTANBUL, MALAZGIRT, PREVEZE]);
