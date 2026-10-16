# AYAS live information: weather and news

AYAS answers two kinds of personal-assistant questions from the internet:
the weather and the news. Everything else stays as before. Other "current
fact" questions (exchange rates, the stock market, elections) still get the
honest refusal from `streamAyasChat`, because no source for them is wired.

## What the owner can ask

| Kind | Examples | Answer |
|------|----------|--------|
| Weather | "Bursa'da hava nasıl?", "Yarın İstanbul'da yağmur yağacak mı?", "Cumartesi İzmir'de hava nasıl olacak?", "Hafta sonu hava nasıl?", "Paris'te bugün hava nasıl?", "Ankara'da kaç derece?" | Current conditions plus the day's low/high and chance of rain, or the requested day (tomorrow, the day after, a weekday or the weekend, up to 7 days ahead). Source: Open-Meteo. |
| News | "Gazze hakkındaki son haberler neler?", "Bana internetten deprem haberlerini bul", "Türkiye ekonomisi ile ilgili son gelişmeler neler?", "Son dakika haberleri", "Gündemde ne var?" | The 5 newest headlines with the outlet and how long ago each was published. On a topic: Google Haberler search for the last 7 days, or any date when the week has none. Without a topic: Google Haberler top stories, with BBC News Türkçe's RSS as the fallback. |

If a weather question names no place, AYAS uses the last place the owner
named in this conversation, then `AYAS_WEATHER_DEFAULT_LOCATION` (optional
env, e.g. `Bursa`), and otherwise asks which city.

Answers are plain spoken Turkish sentences with no links or symbols, because
the console reads replies aloud. AYAS lists headlines and does not summarise
articles: no model runs on this path, so nothing in the answer can be
invented.

## Where it runs

- `src/lib/ayas/liveinfo/AyasLiveInfoIntent.ts`: pure text classification.
  It returns `null` for anything that is not clearly a weather or news
  request: "ne haber", "bana haber ver", "haberin var mı", "bugün hava çok
  güzel", "hava fritözü", "hava kalitesi", an angle's "kaç derece", and
  requests about code, a project, a video or AYAS's own development.
- `src/lib/ayas/liveinfo/AyasLiveInfoLookup.ts`: the lookup and the spoken
  answer. It never throws; an unreachable source becomes "ulaşamıyorum".
- `resolveAyasPreReasoningIntent` adds `live-info` last, after development
  status, Report Center, research status and guided repair. Those keep every
  text they matched before ("hava durumu çalışmıyor" is still a repair).
- `app/api/ayas/chat/stream/route.ts` and `askAyas` in `app/brain/actions.ts`
  answer it before any model call, as one terminal frame
  (`source: "fallback"`, no `reason`). The console labels it as a rule-layer
  answer.
- `streamAyasChat` is unchanged, so every evaluation and smoke that drives it
  behaves exactly as before.

## Security and privacy

- Fixed hosts only (`AYAS_LIVE_INFO_HOSTS`): `geocoding-api.open-meteo.com`,
  `api.open-meteo.com`, `news.google.com`, `feeds.bbci.co.uk`. HTTPS GET only,
  checked before the request and again on the final URL after redirects.
- Every request goes through `ayasSafePublicFetch` (SSRF and DNS-rebinding
  block, 1 MB body bound, at most 2 redirects, content-type allowlist, 6 s
  timeout, one retry on a transient failure).
- The only data sent out is the place name or the topic the owner just said.
  No cookie, credential, memory, repository content or history leaves the
  machine.
- The Stage 15D firewall closure audit
  (`scripts/smoke-ayas-action-firewall-closure.ts`) classifies this reach as
  `OWNER_PUBLIC_LOOKUP` on the chat route and the owner-session actions. It
  asserts the host list, the single transport call behind the host check, and
  that both surfaces look up before the model. EVAL 15F.4-v68 re-pins that
  suite.
- Google Haberler's feed terms allow personal, non-commercial feed-reader
  use. That is what this is: the owner's own assistant.

## Tests

- `scripts/smoke-ayas-live-info.ts` (CI step): offline fixtures only. It
  covers detection and near misses, route precedence, the weather and news
  answers, place/date/topic handling, failure messages and the reader's host
  allowlist.
- Regression set run for this change: intent-routing, cognitive-quality,
  named-development-routing, action-firewall-closure, chat, chat-stream,
  chat-stream-client, chat-quality, agentic-routing, research-status-intent,
  tool-candidate-resolution, development-status, graphify-state-chat,
  autonomy-approval, autonomous-execution-gate, owner-approval-admission,
  owner-session-admission, operation-evidence, product-brain,
  autonomous-foundation-acceptance, safe-mode, security-request-body-isolated
  (TEMP archive), daemon-authority-boundary, eval-yardstick-protection,
  research-intelligence, technology-watch, safe-public-fetch,
  research-source-resilience, security-supply-chain,
  constitution-run-binding, independence-certification, homepage-v2, context,
  memory.
