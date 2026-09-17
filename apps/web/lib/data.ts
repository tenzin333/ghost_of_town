// The only module that knows where data lives.
// With NEXT_PUBLIC_DATA_API_URL set, it reads the database's REST API (Supabase: https://<ref>.supabase.co/rest/v1,
// local stack: http://localhost:54321). Without it, it falls back to the bundled data/places.json.
import type { Layer, Place, PlaceSummary } from "@wwh/schema";
import { distance, type LngLat } from "./geo";
import { isLiveId, loadLivePlace } from "./live";
import { isOsmId, loadOsmPlace } from "./osm";

export type { Place, PlaceSummary };

const API_URL = process.env.NEXT_PUBLIC_DATA_API_URL?.replace(/\/$/, "");
/** Supabase publishable (anon) key. Safe in the browser: row-level security only exposes published rows. */
const API_KEY = process.env.NEXT_PUBLIC_DATA_API_KEY;

/** Curated area: Bengaluru Cantonment core. The only dig site so far. */
export const AREA_NAME = "Bengaluru";
export const AREA = { west: 77.58, south: 12.962, east: 77.622, north: 12.993 };
export const AREA_CENTER = { lng: (AREA.west + AREA.east) / 2, lat: (AREA.south + AREA.north) / 2 };
export const SNAP_METRES = 150;

/**
 * Where the app opens. Two presets, chosen with `NEXT_PUBLIC_START`:
 * - **bengaluru** (default): the hand-researched dig site. The only place with 3+ layer stacks (MG Road metro and
 *   Attara Kacheri have four), so it is what a test of the dig-down concept has to land on.
 * - **palais-royal**: the densest stack of *vanished* buildings we measured in France, and the one place where
 *   Commons reliably has pre-1950 pictures — but its deepest live stack is only two layers.
 * `curated` says whether the opening view sits inside the researched area, and so whether landing should read from
 * the curated index or run a live dig.
 */
const START_PRESETS = {
  bengaluru: { ...AREA_CENTER, zoom: 13.8, name: AREA_NAME, curated: true },
  "palais-royal": { lng: 2.337, lat: 48.8635, zoom: 15.5, name: "Palais-Royal, Paris", curated: false },
} as const;

export const START =
  START_PRESETS[(process.env.NEXT_PUBLIC_START ?? "") as keyof typeof START_PRESETS] ?? START_PRESETS.bengaluru;

/**
 * The place the landing notice leads with. An editorial choice, not a computed one: MG Road metro and Attara Kacheri
 * both have four layers and identical wow scores, but only MG Road shows a *change of use* on one spot — Plaza
 * Theatre (1936) → last film (2005) → metro station (2011). That is the differentiation thesis in a single stack
 * (see research/competitors.md), so it is what a first-time visitor should meet.
 * Falls back to the deepest stack in the index if this id isn't present.
 */
export const FEATURED_PLACE_ID = "mg-road-metro-station";

/**
 * The timeline. These buckets used to start at 1800, which was right for Bengaluru and wrong everywhere older:
 * at Palais-Royal 23 of 82 dated layers fall before 1800 (oldest 1484) and had no button at all, so the best
 * material — Molière's theatre, the Turgot map — was unreachable from the timeline.
 */
export const ERAS = [
  { id: "all", label: "All time" },
  { id: "pre1700", label: "Before 1700", from: -4000, to: 1699 },
  { id: "1700", label: "1700s", from: 1700, to: 1799 },
  { id: "1800", label: "1800s", from: 1800, to: 1899 },
  { id: "1900", label: "1900s", from: 1900, to: 1999 },
  { id: "2000", label: "2000s", from: 2000, to: 2099 },
] as const;
export type EraId = (typeof ERAS)[number]["id"];

async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`${API_URL}/rpc/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(API_KEY && { apikey: API_KEY }) },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  return res.json();
}

const bundled = () => import("@wwh/data/places.json").then((m) => m.default as Place[]);

let index: Promise<PlaceSummary[]> | undefined;
/** All places with just enough to draw the map. Fetched once; a failed fetch is retried on the next call. */
export function loadMapIndex(): Promise<PlaceSummary[]> {
  index ??= (API_URL ? rpc<PlaceSummary[]>("map_index") : bundled()).catch((e) => {
    index = undefined;
    throw e;
  });
  return index;
}

const details = new Map<string, Promise<Place | undefined>>();
/** One place with its full layer stack (curated, or live from Wikidata for `wd-Q…` ids). Cached; failures aren't. */
export function loadPlace(id: string): Promise<Place | undefined> {
  if (isLiveId(id)) return loadLivePlace(id);
  if (isOsmId(id)) return loadOsmPlace(id);
  let p = details.get(id);
  if (!p) {
    p = (API_URL
      ? rpc<Place | null>("place_detail", { place_id: id }).then((d) => d ?? undefined)
      : bundled().then((all) => all.find((x) => x.id === id))
    ).catch((e) => {
      details.delete(id);
      throw e;
    });
    details.set(id, p);
  }
  return p;
}

export function inArea({ lng, lat }: LngLat) {
  return lng >= AREA.west && lng <= AREA.east && lat >= AREA.south && lat <= AREA.north;
}

export function layerInEra(layer: Pick<Layer, "yearStart" | "yearEnd">, era: EraId): boolean {
  const e = ERAS.find((x) => x.id === era)!;
  if (!("from" in e)) return true;
  const start = layer.yearStart ?? layer.yearEnd;
  const end = layer.yearEnd ?? layer.yearStart;
  if (start === undefined || end === undefined) return false;
  return start <= e.to && end >= e.from;
}

export function nearestPlaces(places: PlaceSummary[], point: LngLat, opts: { exclude?: Set<string>; era?: EraId } = {}) {
  return places
    .filter((p) => p.layers.length > 0) // clicked map places without history aren't dig targets
    .filter((p) => !opts.exclude?.has(p.id))
    .filter((p) => !opts.era || p.layers.some((l) => layerInEra(l, opts.era!)))
    .map((p) => ({ place: p, metres: distance(point, p) }))
    .sort((a, b) => a.metres - b.metres);
}

export function yearLabel(l: Layer): string {
  const { yearStart: s, yearEnd: e, datePrecision } = l;
  if (s === undefined && e === undefined) return "Undated";
  if (s === undefined) return `until ${e}`;
  if (datePrecision === "decade" && s % 10 === 0) return `${s}s`;
  if (e !== undefined && e !== s) return `${s}–${String(e).slice(2)}`;
  return datePrecision === "circa" ? `c. ${s}` : String(s);
}

export function spanLabel(p: Place): string {
  const years = p.layers.flatMap((l) => [l.yearStart, l.yearEnd]).filter((y): y is number => y !== undefined);
  if (!years.length) return "";
  return `${Math.min(...years)} → today`;
}
