// Google Street View for the "Today" layer: how the spot looks now. Not history, and not stored.
// With NEXT_PUBLIC_GOOGLE_MAPS_KEY: embedded panorama (Maps Embed API) aimed at the place, found via the Street View
// metadata endpoint. Both are free of charge. Without a key: a keyless link that opens Street View in Google Maps.
import { bearing, distance, type LngLat } from "./geo";

const KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY;
export const GOOGLE_STREET_VIEW = Boolean(KEY);

/**
 * LOCAL DEVELOPMENT ONLY: Google Street View through Google's undocumented keyless embed URL. Not covered by the
 * Maps Platform terms and may break at any time, so it is compiled out of production builds (`next build` sets
 * NODE_ENV=production, making this `false` and the URL dead code). Enable with NEXT_PUBLIC_GOOGLE_KEYLESS_DEV=1.
 * Without a key it can't request outdoor imagery or check coverage: Google picks the nearest panorama, sometimes
 * a shop interior, or shows "No Street View available".
 */
export const GOOGLE_KEYLESS_DEV = process.env.NODE_ENV === "development" && process.env.NEXT_PUBLIC_GOOGLE_KEYLESS_DEV === "1";

/** How far from the place we accept a panorama. Most places here are building-precise. */
const SEARCH_METRES = 100;

export type Pano = { id: string; lat: number; lng: number; heading: number; metres: number; date?: string };

/** Opens Street View in Google Maps (no key needed). */
export function googleMapsUrl(at: LngLat, pano?: Pano): string {
  const url = new URL("https://www.google.com/maps/@");
  url.searchParams.set("api", "1");
  url.searchParams.set("map_action", "pano");
  url.searchParams.set("viewpoint", `${(pano ?? at).lat},${(pano ?? at).lng}`);
  if (pano) {
    url.searchParams.set("pano", pano.id);
    url.searchParams.set("heading", String(Math.round(pano.heading)));
  }
  return url.toString();
}

export function embedUrl(pano: Pano): string {
  const url = new URL("https://www.google.com/maps/embed/v1/streetview");
  url.searchParams.set("key", KEY!);
  url.searchParams.set("pano", pano.id);
  url.searchParams.set("heading", String(Math.round(pano.heading)));
  url.searchParams.set("pitch", "8");
  url.searchParams.set("fov", "80");
  return url.toString();
}

const found = new Map<string, Promise<Pano | null>>();
/** Nearest outdoor panorama within SEARCH_METRES, turned to face the place. null = no imagery nearby. */
export function findPano(place: LngLat & { id: string }): Promise<Pano | null> {
  let p = found.get(place.id);
  if (!p) {
    const url = new URL("https://maps.googleapis.com/maps/api/streetview/metadata");
    url.searchParams.set("location", `${place.lat},${place.lng}`);
    url.searchParams.set("radius", String(SEARCH_METRES));
    url.searchParams.set("source", "outdoor");
    url.searchParams.set("key", KEY!);
    p = fetch(url)
      .then((r) => r.json())
      .then((m: { status: string; pano_id?: string; location?: LngLat; date?: string; error_message?: string }) => {
        if (m.status === "ZERO_RESULTS" || m.status === "NOT_FOUND") return null;
        if (m.status !== "OK" || !m.pano_id || !m.location) throw new Error(`Street View: ${m.status} ${m.error_message ?? ""}`);
        const metres = distance(m.location, place);
        // Standing on the spot, any direction is as good as another; otherwise look at the building.
        const heading = metres < 5 ? 0 : bearing(m.location, place);
        return { id: m.pano_id, lat: m.location.lat, lng: m.location.lng, heading, metres, date: m.date };
      })
      .catch((e) => {
        found.delete(place.id);
        throw e;
      });
    found.set(place.id, p);
  }
  return p;
}

/** "2024-03" → "Mar 2024" */
export function imageryDate(date?: string): string | undefined {
  const m = date?.match(/^(\d{4})-(\d{2})/);
  if (!m) return date;
  return new Date(Number(m[1]), Number(m[2]) - 1).toLocaleString("en", { month: "short", year: "numeric" });
}
