// Search for anywhere on Earth by name ("France", "Palais-Royal", "Howrah Bridge") and fly there.
// Uses the same rate-limited Nominatim queue as map clicks (lib/osm.ts): at most one request a second, so callers
// must debounce. As with the rest of the Nominatim use, a hosted geocoder is needed before real traffic.
import { nominatim } from "./osm";

export type SearchHit = {
  id: string;
  /** What to show in bold: "France", "Palais-Royal". */
  name: string;
  /** The rest of the address, for telling two places of the same name apart. */
  detail?: string;
  /** "country", "city", "theatre" … from OSM, for the caller to label the hit. */
  kind?: string;
  lat: number;
  lng: number;
  /** Zoom that frames the thing itself — a country stays zoomed out, a building goes close. */
  zoom: number;
};

type NominatimHit = {
  place_id?: number;
  osm_type?: string;
  osm_id?: number;
  lat: string;
  lon: string;
  name?: string;
  display_name?: string;
  type?: string;
  category?: string;
  addresstype?: string;
  boundingbox?: [string, string, string, string]; // south, north, west, east
};

/**
 * Fallback zooms when the bounding box is useless. Nominatim's box for "France" runs -178° to +172° because it
 * includes French Polynesia and Réunion; framing that box zooms out to the whole planet instead of pointing at
 * France. The returned centre (46.6, 1.9) is still metropolitan France, so we keep the centre and pick the zoom here.
 */
const ZOOM_BY_KIND: Record<string, number> = {
  country: 5, state: 6, region: 6, province: 6.5, county: 8, city: 11, municipality: 11,
  town: 12.5, village: 14, suburb: 14, quarter: 15, neighbourhood: 15.5, road: 16, building: 17, house: 17.5,
};

/** Frame the result itself: a country stays wide, a theatre goes close. */
function zoomFor(hit: NominatimHit): number {
  const kind = hit.addresstype ?? hit.type ?? hit.category ?? "";
  const byKind = ZOOM_BY_KIND[kind];
  const box = hit.boundingbox?.map(Number);
  if (!box || box.some((n) => !Number.isFinite(n))) return byKind ?? 14;
  const [south, north, west, east] = box;
  const latSpan = Math.abs(north - south);
  const lngSpan = Math.abs(east - west);
  // A box wider than half the planet means scattered territories, not one place: trust the kind instead.
  if (lngSpan > 180 || latSpan > 90) return byKind ?? 4;
  if (!latSpan && !lngSpan) return byKind ?? 16;
  // Fit both axes as fractions of the whole world. Latitude has to go through Mercator, not be treated as linear:
  // a degree of latitude covers less of the map the further it is from the equator, and assuming otherwise zoomed
  // tall countries (Japan) much too far out.
  const mercY = (lat: number) => {
    const r = (Math.min(85, Math.max(-85, lat)) * Math.PI) / 180;
    return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2;
  };
  const fracX = lngSpan / 360;
  const fracY = Math.abs(mercY(north) - mercY(south));
  const zoom = Math.min(fracX ? Math.log2(1 / fracX) : 18, fracY ? Math.log2(1 / fracY) : 18) - 0.3;
  return Math.max(2, Math.min(17, zoom));
}

/** A hit precise enough that digging for history at its centre makes sense (a street or building, not a country). */
export const isDiggable = (hit: SearchHit) => hit.zoom >= 12;

const cache = new Map<string, SearchHit[]>();

export async function searchPlaces(query: string, limit = 6): Promise<SearchHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const cached = cache.get(q.toLowerCase());
  if (cached) return cached;

  const hits = (await nominatim("search", { q, limit: String(limit) })) as NominatimHit[];
  const results = (Array.isArray(hits) ? hits : []).map((hit) => {
    // display_name is "Palais-Royal, 1st Arrondissement, Paris, …": the head is the name, the tail is the context.
    const parts = (hit.display_name ?? "").split(",").map((s) => s.trim());
    const name = hit.name?.trim() || parts[0] || "Unnamed place";
    const detail = parts.filter((p) => p !== name).join(", ") || undefined;
    return {
      id: `${hit.osm_type ?? "x"}${hit.osm_id ?? hit.place_id ?? Math.random()}`,
      name,
      detail,
      kind: (hit.addresstype ?? hit.type ?? hit.category)?.replace(/_/g, " "),
      lat: Number(hit.lat),
      lng: Number(hit.lon),
      zoom: zoomFor(hit),
    };
  }).filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng));

  cache.set(q.toLowerCase(), results);
  return results;
}
