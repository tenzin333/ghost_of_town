// Real-map clicks: any named thing on the basemap (shop, temple, station, park, street, town) can be opened.
// OpenStreetMap's Nominatim gives what it is, its address and its tags; if OSM links it to Wikidata, the live history
// stack for that item is attached (lib/live.ts), plus OSM's own start_date. Nominatim's usage policy allows at most
// one request per second from an app, so requests are queued; heavy production use needs a hosted geocoder.
import type { Layer, Place, PlaceSummary } from "@wwh/schema";
import type { LngLat } from "./geo";
import { loadLivePlace } from "./live";

/** A named feature under the cursor, read from the vector tiles. */
export type MapFeature = LngLat & { name: string; kind: "poi" | "place" | "street" | "water" | "airport" | "peak"; subclass?: string };

/** Which basemap source-layers are clickable, and what they are. */
export const CLICKABLE_SOURCE_LAYERS: Record<string, MapFeature["kind"]> = {
  poi: "poi", place: "place", transportation_name: "street", water_name: "water", aerodrome_label: "airport", mountain_peak: "peak",
};

export const isOsmId = (id: string) => /^osm-[nwr]\d+(-near)?$/.test(id);

type Nominatim = {
  osm_type?: "node" | "way" | "relation";
  osm_id?: number;
  lat: string;
  lon: string;
  name?: string;
  category?: string;
  type?: string;
  display_name?: string;
  address?: Record<string, string>;
  extratags?: Record<string, string>;
  namedetails?: Record<string, string>;
  error?: string;
};

// ---------- Nominatim, politely ----------

let lastRequest = 0;
async function nominatim(path: string, params: Record<string, string>): Promise<unknown> {
  const wait = Math.max(0, lastRequest + 1100 - Date.now());
  lastRequest = Date.now() + wait;
  if (wait) await new Promise((r) => setTimeout(r, wait));
  const url = new URL(`https://nominatim.openstreetmap.org/${path}`);
  for (const [k, v] of Object.entries({ format: "jsonv2", "accept-language": "en", extratags: "1", addressdetails: "1", namedetails: "1", ...params })) {
    url.searchParams.set(k, v);
  }
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Nominatim: HTTP ${res.status}`);
  return res.json();
}

/** How zoomed-in a reverse lookup should be for each kind of label, so a town label finds the town, not a shop. */
function reverseZoom(f: MapFeature): number {
  if (f.kind === "place") {
    return ({ country: 3, state: 5, province: 5, city: 10, town: 12, village: 14, suburb: 14, quarter: 15, neighbourhood: 16, hamlet: 15 } as Record<string, number>)[f.subclass ?? ""] ?? 12;
  }
  return { poi: 18, street: 17, water: 14, airport: 15, peak: 17 }[f.kind];
}

// ---------- OSM element → place ----------

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Does the clicked label name this OSM object? Compares against every name variant OSM has for it. */
export function sameThing(clicked: string, n: Pick<Nominatim, "name" | "namedetails">): boolean {
  const names = [n.name, ...Object.values(n.namedetails ?? {})].filter((x): x is string => Boolean(x)).map(norm);
  const c = norm(clicked);
  return names.some((x) => x === c || (c.length > 3 && x.length > 3 && (x.includes(c) || c.includes(x))));
}

const humanize = (s?: string) => (s && s !== "yes" ? s.replace(/_/g, " ") : undefined);

function describe(n: Nominatim, clickedName?: string) {
  const tags = n.extratags ?? {};
  const a = n.address ?? {};
  const street = [a.house_number, a.road].filter(Boolean).join(" ");
  const locality = a.suburb ?? a.neighbourhood ?? a.village ?? a.town ?? a.city_district;
  const city = a.city ?? a.town ?? a.county;
  const address = [...new Set([street, locality, city, a.state, a.country].filter(Boolean))].join(", ") || undefined;
  const type = `${n.osm_type?.[0]}${n.osm_id}`;
  return {
    id: `osm-${type}`,
    name: n.name || clickedName || humanize(n.type) || "Unnamed place",
    lat: Number(n.lat),
    lng: Number(n.lon),
    category: humanize(tags.historic) ? `historic ${humanize(tags.historic)}` : humanize(n.type) ?? humanize(n.category),
    address,
    osmUrl: `https://www.openstreetmap.org/${n.osm_type}/${n.osm_id}`,
    website: tags.website ?? tags["contact:website"],
    wikidata: tags.wikidata?.match(/^Q\d+$/)?.[0],
    startDate: tags.start_date,
  };
}
type Described = ReturnType<typeof describe>;

/** "1891", "1891-05-02", "~1890", "C19", "1890s" → year + precision; anything else is ignored. */
export function parseStartDate(raw?: string): { year: number; precision: string } | undefined {
  if (!raw) return undefined;
  let m = raw.match(/^(\d{4})s$/);
  if (m) return { year: Number(m[1]), precision: "decade" };
  m = raw.match(/^~\s*(\d{4})/) ?? raw.match(/^(?:before|after|c\.?|circa)\s*(\d{4})/i);
  if (m) return { year: Number(m[1]), precision: "circa" };
  m = raw.match(/^(\d{4})(-\d{2})?(-\d{2})?$/);
  if (m) return { year: Number(m[1]), precision: m[3] ? "day" : m[2] ? "month" : "year" };
  return undefined;
}

const sortKey = (l: Layer) => l.yearStart ?? (l.yearEnd !== undefined ? l.yearEnd - 0.5 : -Infinity);

async function toPlace(d: Described): Promise<Place> {
  // History for the exact item, when OpenStreetMap links it to Wikidata.
  const history = d.wikidata ? await loadLivePlace(`wd-${d.wikidata}`).catch(() => undefined) : undefined;
  const layers = [...(history?.layers ?? [])];
  const start = parseStartDate(d.startDate);
  if (start && !layers.some((l) => l.yearStart === start.year)) {
    layers.push({
      id: `${d.id}-start`,
      yearStart: start.year,
      datePrecision: start.precision,
      type: "building",
      title: `${d.name} built or opened`,
      hook: d.category ? d.category.charAt(0).toUpperCase() + d.category.slice(1) : "",
      story: `OpenStreetMap records the start date of ${d.name} as ${d.startDate}.`,
      sources: [{ label: "OpenStreetMap", url: d.osmUrl }],
      confidence: "unreviewed",
      wow: 3,
    });
  }
  layers.sort((a, b) => sortKey(b) - sortKey(a));
  return {
    id: d.id,
    name: d.name,
    lat: d.lat,
    lng: d.lng,
    geoPrecision: "building",
    layers,
    live: true,
    info: { category: d.category, address: d.address, osmUrl: d.osmUrl, website: d.website },
  };
}

export const summaryOf = (p: Place): PlaceSummary => ({
  id: p.id, name: p.name, lat: p.lat, lng: p.lng, geoPrecision: p.geoPrecision, live: true,
  layers: p.layers.map(({ yearStart, yearEnd, wow }) => ({ yearStart, yearEnd, wow })),
});

const places = new Map<string, Promise<Place | undefined>>();
const remember = (id: string, p: Promise<Place | undefined>) => {
  places.set(id, p);
  p.catch(() => places.delete(id));
  return p;
};

/** The map thing that was clicked, with its history if any. undefined = OSM has nothing there. */
export async function lookupFeature(f: MapFeature): Promise<Place | undefined> {
  const n = (await nominatim("reverse", { lat: String(f.lat), lon: String(f.lng), zoom: String(reverseZoom(f)) })) as Nominatim;
  if (n.error || !n.osm_type || !n.osm_id) return undefined;
  const d = describe(n, f.name);
  // Towns and cities come back as "administrative" boundaries; the map label knows better (city, town, village).
  if (f.kind === "place" && (d.category === "administrative" || !d.category)) d.category = humanize(f.subclass);
  // A reverse lookup can return a neighbouring object. If none of its names (in any language) match the label that
  // was clicked, keep the clicked name and the address, but never attach the neighbour's history or details.
  if (!sameThing(f.name, n)) {
    Object.assign(d, { name: f.name, category: humanize(f.subclass), wikidata: undefined, startDate: undefined, website: undefined });
    d.id = `${d.id}-near`;
  }
  return remember(d.id, toPlace(d));
}

/** For share links (`?place=osm-w36165294`) and the data layer. */
export function loadOsmPlace(id: string): Promise<Place | undefined> {
  const cached = places.get(id);
  if (cached) return cached;
  const ref = id.slice(4).replace(/-near$/, "").toUpperCase(); // N123 / W123 / R123
  return remember(
    id,
    nominatim("lookup", { osm_ids: ref }).then((list) => {
      const [n] = list as Nominatim[];
      return n?.osm_type ? toPlace(describe(n)) : undefined;
    }),
  );
}
