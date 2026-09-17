// Live history for pins outside the curated dig site. Everything here is the sources' own data: Wikidata dates and
// descriptions, the Wikipedia article's own summary, Commons images with their licence. Nothing is written by us or
// by AI; layers are badged "unreviewed" and never stored. See docs/decisions/0011.
import type { Layer, Media, Place, PlaceSummary } from "@wwh/schema";
import { distance, type LngLat } from "./geo";

export const LIVE_RADIUS_KM = 5;
const NEAREST_ITEMS = 250;
const HISTORY_YEARS = 25;
const STORY_WORDS = 90;
const TIMEOUT = 20_000;

/** Areas and natural features, not spots with a history: administrative areas, electoral districts, geographic
 * regions, watercourses, mountains, hills, lakes, valleys. */
const SKIP_CLASSES = ["Q56061", "Q192611", "Q82794", "Q355304", "Q8502", "Q54050", "Q23397", "Q39816"];

/** Dated Wikidata statements that become layers. */
const EVENTS = {
  P571: { title: (n: string) => `${n} established`, type: "building" },
  P1619: { title: (n: string) => `${n} officially opened`, type: "event" },
  P576: { title: (n: string) => `${n} closed, dissolved or demolished`, type: "event" },
} as const satisfies Record<string, { title: (name: string) => string; type: Layer["type"] }>;
type EventProp = keyof typeof EVENTS;
const EVENT_LABEL: Record<EventProp, string> = { P571: "inception", P1619: "official opening", P576: "end (dissolved, abolished or demolished)" };

type LiveDate = { prop: EventProp; year: number; precision: number };
type Item = {
  qid: string;
  name: string;
  description?: string;
  lat: number;
  lng: number;
  dates: LiveDate[];
  image?: string; // Commons file name (P18) — nearly always a modern photo
  commons?: string; // Commons category (P373) — where the *old* pictures are
  article?: string; // en.wikipedia URL
};

const items = new Map<string, Item>();
export const isLiveId = (id: string) => /^wd-Q\d+$/.test(id);

// ---------- Wikidata ----------

function sparql(selector: string, skipAreas: boolean) {
  return `
SELECT ?item ?itemLabel ?itemDescription ?coord ?prop ?date ?prec ?image ?article WHERE {
  ${selector}
  ${skipAreas ? `FILTER NOT EXISTS { ?item wdt:P31/wdt:P279* ?skip . VALUES ?skip { ${SKIP_CLASSES.map((q) => `wd:${q}`).join(" ")} } }` : ""}
  OPTIONAL {
    VALUES (?prop ?p ?psv) { ${Object.keys(EVENTS).map((p) => `("${p}" p:${p} psv:${p})`).join(" ")} }
    ?item ?p ?st . ?st ?psv ?tv . ?tv wikibase:timeValue ?date ; wikibase:timePrecision ?prec .
  }
  OPTIONAL { ?item wdt:P18 ?image }
  OPTIONAL { ?item wdt:P373 ?commons }
  OPTIONAL { ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul". }
} LIMIT 500`;
}

type Binding = Record<string, { value: string } | undefined>;

/** `skipAreas`: leave out districts, rivers etc. Right for area searches; wrong when someone asked for that exact item. */
async function runQuery(selector: string, skipAreas: boolean): Promise<Item[]> {
  const url = "https://query.wikidata.org/sparql?format=json&query=" + encodeURIComponent(sparql(selector, skipAreas));
  const attempt = async () => {
    const res = await fetch(url, { headers: { Accept: "application/sparql-results+json" }, signal: AbortSignal.timeout(TIMEOUT) });
    if (!res.ok) throw new Error(`Wikidata: HTTP ${res.status}`);
    return (await res.json()).results.bindings as Binding[];
  };
  // The public query service has occasional hiccups (timeouts, 429/5xx): retry once after a short pause.
  const rows = await attempt().catch(() => new Promise((r) => setTimeout(r, 1500)).then(attempt));

  const found = new Map<string, Item>();
  for (const b of rows) {
    const qid = b.item!.value.split("/").pop()!;
    const point = b.coord?.value.match(/Point\(([-\d.eE]+) ([-\d.eE]+)\)/);
    const name = b.itemLabel?.value;
    if (!point || !name || name === qid) continue; // no coordinates, or no usable label
    const item = found.get(qid) ?? {
      qid, name, description: b.itemDescription?.value, lng: Number(point[1]), lat: Number(point[2]), dates: [],
      image: b.image && decodeURIComponent(b.image.value.split("/Special:FilePath/")[1] ?? ""),
      commons: b.commons?.value, article: b.article?.value,
    };
    if (b.date && b.prop && b.prec) {
      const year = parseYear(b.date.value);
      const prop = b.prop.value as EventProp;
      if (year !== undefined && !item.dates.some((d) => d.prop === prop)) item.dates.push({ prop, year, precision: Number(b.prec.value) });
    }
    found.set(qid, item);
  }
  // Keep things with a history signal: a Wikipedia article, or a date at least HISTORY_YEARS ago (a showroom that
  // opened last year isn't "what was here").
  const cutoff = new Date().getFullYear() - HISTORY_YEARS;
  for (const i of found.values()) {
    // "Established" and "officially opened" in the same year say the same thing twice.
    const founded = i.dates.find((d) => d.prop === "P571");
    if (founded) i.dates = i.dates.filter((d) => !(d.prop === "P1619" && d.year === founded.year));
  }
  const kept = [...found.values()].filter((i) => i.article || i.dates.some((d) => d.year <= cutoff));
  for (const i of kept) items.set(i.qid, i);
  return kept;
}

/** "1740-01-01T00:00:00Z" → 1740, "-0500-01-01T00:00:00Z" → -500 */
function parseYear(value: string): number | undefined {
  const m = value.match(/^(-?)(\d+)-/);
  return m ? Number(m[2]) * (m[1] ? -1 : 1) : undefined;
}

function datePrecision(p: number): string {
  return p >= 11 ? "day" : p === 10 ? "month" : p === 9 ? "year" : p === 8 ? "decade" : "circa";
}

function summarize(item: Item): PlaceSummary {
  const oldest = Math.min(...item.dates.map((d) => d.year));
  const wow = Math.min(5, 2 + (item.article ? 1 : 0) + (item.image ? 1 : 0) + (oldest < 1950 ? 1 : 0));
  const layers = item.dates.length
    ? sortLayers(item.dates.map((d) => ({ yearStart: d.year, wow })))
    : [{ wow }];
  return { id: `wd-${item.qid}`, name: item.name, lat: item.lat, lng: item.lng, geoPrecision: "building", layers, live: true };
}

const sortKey = (l: { yearStart?: number; yearEnd?: number }) => l.yearStart ?? (l.yearEnd !== undefined ? l.yearEnd - 0.5 : -Infinity);
const sortLayers = <T extends { yearStart?: number; yearEnd?: number }>(layers: T[]) => [...layers].sort((a, b) => sortKey(b) - sortKey(a));

const searches = new Map<string, Promise<PlaceSummary[]>>();
/** Historic things within LIVE_RADIUS_KM of a point, nearest first. Cached per ~1 km grid cell. */
export function searchLive(point: LngLat): Promise<PlaceSummary[]> {
  const cell = `${point.lat.toFixed(2)},${point.lng.toFixed(2)}`;
  let p = searches.get(cell);
  if (!p) {
    // Only the nearest NEAREST_ITEMS items get filtered: in dense cities (central Paris) a whole 5 km radius has
    // thousands of items and the query times out (504 after 60 s); nearest-first keeps it to a few seconds.
    const selector = `{ SELECT ?item ?coord WHERE {
      SERVICE wikibase:around { ?item wdt:P625 ?coord . bd:serviceParam wikibase:center "Point(${point.lng} ${point.lat})"^^geo:wktLiteral ; wikibase:radius "${LIVE_RADIUS_KM}" ; wikibase:distance ?dist . }
    } ORDER BY ?dist LIMIT ${NEAREST_ITEMS} }`;
    p = runQuery(selector, true)
      .then((found) => found.map(summarize).sort((a, b) => distance(point, a) - distance(point, b)))
      .catch((e) => {
        searches.delete(cell);
        throw e;
      });
    searches.set(cell, p);
  }
  return p;
}

/** One live place by id (for share links), or undefined if Wikidata has nothing usable. */
export async function loadLiveSummary(id: string): Promise<PlaceSummary | undefined> {
  const qid = id.slice(3);
  const cached = items.get(qid);
  if (cached) return summarize(cached);
  const [item] = await runQuery(`VALUES ?item { wd:${qid} } ?item wdt:P625 ?coord .`, false);
  return item && summarize(item);
}

// ---------- Wikipedia + Commons (loaded when a place opens) ----------

async function wikipediaExtract(articleUrl: string): Promise<{ text: string; title: string } | undefined> {
  const title = decodeURIComponent(articleUrl.split("/wiki/")[1]);
  const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`, { signal: AbortSignal.timeout(TIMEOUT) });
  if (!res.ok) return undefined;
  const s: { type?: string; extract?: string; title?: string } = await res.json();
  if (s.type === "disambiguation" || !s.extract) return undefined;
  return { text: trimWords(s.extract, STORY_WORDS), title: s.title ?? title.replace(/_/g, " ") };
}

/** Whole sentences up to `max` words; a first sentence that's too long is cut with an ellipsis. */
export function trimWords(text: string, max: number): string {
  const sentences = text.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) ?? [text];
  let out = "";
  for (const s of sentences) {
    const next = (out + s).trim();
    if (next.split(/\s+/).length > max) break;
    out = next + " ";
  }
  out = out.trim();
  return out || text.split(/\s+/).slice(0, max - 1).join(" ") + "…";
}

type ImageInfo = {
  thumburl?: string;
  thumbwidth?: number;
  thumbheight?: number;
  descriptionurl?: string;
  mime?: string;
  extmetadata?: Record<string, { value: string }>;
};

/** The year the picture itself was made, from Commons' own date fields (often wrapped in markup). */
function pictureYear(meta?: Record<string, { value: string }>): number | undefined {
  const raw = stripHtml(meta?.DateTimeOriginal?.value ?? meta?.DateTime?.value ?? "");
  const m = raw.match(/\b(1[0-9]\d{2}|20[0-2]\d)\b/);
  return m ? Number(m[1]) : undefined;
}

/** A Commons file we're allowed to show: free licence, an actual image, with credit and licence to display. */
function toMedia(info?: ImageInfo): Media | undefined {
  const meta = info?.extmetadata;
  if (!info?.thumburl || !info.thumbwidth || !info.thumbheight || !info.descriptionurl) return undefined;
  if (info.mime && !info.mime.startsWith("image/")) return undefined;
  if (!meta?.LicenseShortName || meta.NonFree) return undefined;
  return {
    src: info.thumburl, width: info.thumbwidth, height: info.thumbheight,
    credit: stripHtml(meta.Artist?.value ?? "") || "Wikimedia Commons contributor",
    licence: meta.LicenseShortName.value, licenceUrl: meta.LicenseUrl?.value, sourceUrl: info.descriptionurl,
    year: pictureYear(meta),
  };
}

async function commonsApi(params: Record<string, string>): Promise<{ imageinfo?: ImageInfo[] }[]> {
  const url = new URL("https://commons.wikimedia.org/w/api.php");
  for (const [k, v] of Object.entries({ action: "query", format: "json", origin: "*", ...params })) url.searchParams.set(k, v);
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) });
  if (!res.ok) return [];
  return Object.values((await res.json()).query?.pages ?? {});
}

async function commonsMedia(file: string): Promise<Media | undefined> {
  const [page] = await commonsApi({ titles: `File:${file}`, prop: "imageinfo", iiprop: "url|extmetadata|mime", iiurlwidth: "640" });
  return toMedia(page?.imageinfo?.[0]);
}

/** A picture must be at least this old to count as showing the place *then* rather than now. */
const HISTORIC_BEFORE = 1950;

/**
 * The oldest free picture in the place's Commons category — an engraving, print or photograph of it as it was.
 * This is where the old images actually live: P18 (`image`) is nearly always a modern photo of the place today.
 */
async function historicMedia(category: string): Promise<Media | undefined> {
  const pages = await commonsApi({
    generator: "categorymembers", gcmtitle: `Category:${category}`, gcmtype: "file", gcmlimit: "200",
    prop: "imageinfo", iiprop: "url|extmetadata|mime", iiurlwidth: "640",
  });
  let oldest: Media | undefined;
  for (const page of pages) {
    const media = toMedia(page.imageinfo?.[0]);
    if (media?.year === undefined || media.year > HISTORIC_BEFORE) continue;
    if (!oldest || media.year < oldest.year!) oldest = media; // the deepest look back the category offers
  }
  return oldest;
}

/** An old picture of the place beats today's photo of it — that is the whole point (docs/decisions/0013). */
async function pickMedia(item: Item): Promise<Media | undefined> {
  const historic = item.commons ? await historicMedia(item.commons).catch(() => undefined) : undefined;
  if (historic) return historic;
  return item.image ? commonsMedia(item.image).catch(() => undefined) : undefined;
}

const stripHtml = (html: string) => new DOMParser().parseFromString(html, "text/html").body.textContent?.trim() ?? "";

const details = new Map<string, Promise<Place | undefined>>();
/** Full layer stack for a live place: Wikidata events plus the Wikipedia summary and a Commons image. */
export function loadLivePlace(id: string): Promise<Place | undefined> {
  let p = details.get(id);
  if (!p) {
    p = (async () => {
      const qid = id.slice(3);
      if (!items.has(qid) && !(await loadLiveSummary(id))) return undefined;
      const item = items.get(qid)!;
      const [extract, media] = await Promise.all([
        item.article ? wikipediaExtract(item.article).catch(() => undefined) : undefined,
        pickMedia(item),
      ]);
      const wikidata = { label: "Wikidata", url: `https://www.wikidata.org/wiki/${qid}` };
      const wikipedia = extract && item.article ? { label: `Wikipedia: ${extract.title}`, url: item.article } : undefined;
      const summary = summarize(item);
      const hook = item.description ? item.description.charAt(0).toUpperCase() + item.description.slice(1) : "";

      const events = sortLayers(item.dates.map((d) => ({ ...d, yearStart: d.year })));
      // The article summary describes the place as a whole: attach it (and the image) to the founding layer if there
      // is one, otherwise to the oldest event, otherwise to a single undated layer.
      const primary = events.find((e) => e.prop === "P571") ?? events.at(-1);
      const layers: Layer[] = events.map((e) => ({
        id: `${id}-${e.prop}`,
        yearStart: e.year,
        datePrecision: datePrecision(e.precision),
        type: EVENTS[e.prop].type,
        title: EVENTS[e.prop].title(item.name),
        hook,
        story: e === primary && extract ? extract.text : `Wikidata records ${e.year} as the ${EVENT_LABEL[e.prop]} of ${item.name}.`,
        media: e === primary ? media : undefined,
        sources: e === primary && wikipedia ? [wikipedia, wikidata] : [wikidata],
        confidence: "unreviewed",
        wow: summary.layers[0].wow,
      }));
      if (!layers.length) {
        const story = extract?.text ?? (item.description && `Described on Wikidata as: ${item.description}.`);
        if (!story) return undefined; // nothing to tell
        layers.push({
          id: `${id}-about`, datePrecision: "none", type: "story", title: item.name, hook, story,
          media, sources: wikipedia ? [wikipedia, wikidata] : [wikidata], confidence: "unreviewed", wow: summary.layers[0].wow,
        });
      }
      return { ...summary, layers };
    })().catch((e) => {
      details.delete(id);
      throw e;
    });
    details.set(id, p);
  }
  return p;
}
