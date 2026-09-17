// Mapillary: crowd-sourced street-level photos (CC BY-SA 4.0). Used for "Today" where Google Street View isn't
// available, and for coverage lines on the map. Needs NEXT_PUBLIC_MAPILLARY_TOKEN (a free client token, safe in the
// browser). Photos are shown via Mapillary's embed and never stored.
import { bearing, distance, type LngLat } from "./geo";

const TOKEN = process.env.NEXT_PUBLIC_MAPILLARY_TOKEN;
export const MAPILLARY = Boolean(TOKEN);

/** Vector tiles of where photos exist: source-layers `sequence` (lines, z6–14) and `image` (points, z14). */
export const COVERAGE_TILES = `https://tiles.mapillary.com/maps/vtp/mly1_public/2/{z}/{x}/{y}?access_token=${TOKEN}`;

/** Wider than Google's 100 m: crowd-sourced photos are sparser, and big buildings sit back from the road. */
export const SEARCH_METRES = 150;
/** A non-panoramic photo pointing more than this far away from the place doesn't show it. */
const MAX_OFF_AXIS = 60;

export type MapillaryImage = {
  id: string;
  lat: number;
  lng: number;
  metres: number;
  capturedAt?: number;
  isPano: boolean;
  creator?: string;
};

type ApiImage = {
  id: string;
  computed_geometry?: { coordinates: [number, number] };
  geometry?: { coordinates: [number, number] };
  captured_at?: number;
  compass_angle?: number;
  computed_compass_angle?: number;
  is_pano?: boolean;
  creator?: { username?: string };
};

const angleBetween = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

/**
 * Pick the photo that best shows the place: near, and a 360° pano or pointing at it. If no photo faces the place
 * (e.g. every camera looked along the road), fall back to the nearest one: the viewer lets people turn and step
 * along the street. Exported for tests.
 */
export function pickImage(place: LngLat, images: ApiImage[]): MapillaryImage | null {
  let best: { image: MapillaryImage; score: number } | undefined;
  for (const i of images) {
    const coords = (i.computed_geometry ?? i.geometry)?.coordinates;
    if (!coords) continue;
    const at = { lng: coords[0], lat: coords[1] };
    const metres = distance(at, place);
    if (metres > SEARCH_METRES) continue;
    const compass = i.computed_compass_angle ?? i.compass_angle;
    const offAxis = i.is_pano || compass === undefined || metres < 5 ? 0 : angleBetween(compass, bearing(at, place));
    // Prefer panoramas and photos looking straight at the place; photos facing away only win if nothing else exists.
    const ageYears = i.captured_at ? (Date.now() - i.captured_at) / 3.15e10 : 10;
    const score = metres + offAxis * 0.5 + (i.is_pano ? 0 : 15) + ageYears * 2 + (offAxis > MAX_OFF_AXIS ? 1000 : 0);
    if (!best || score < best.score) {
      best = {
        score,
        image: { id: i.id, ...at, metres, capturedAt: i.captured_at, isPano: Boolean(i.is_pano), creator: i.creator?.username },
      };
    }
  }
  return best?.image ?? null;
}

const found = new Map<string, Promise<MapillaryImage | null>>();
export function findImage(place: LngLat & { id: string }): Promise<MapillaryImage | null> {
  let p = found.get(place.id);
  if (!p) {
    const dLat = SEARCH_METRES / 111_320;
    const dLng = dLat / Math.cos((place.lat * Math.PI) / 180);
    const url = new URL("https://graph.mapillary.com/images");
    url.searchParams.set("access_token", TOKEN!);
    url.searchParams.set("fields", "id,computed_geometry,geometry,captured_at,compass_angle,computed_compass_angle,is_pano,creator");
    url.searchParams.set("bbox", [place.lng - dLng, place.lat - dLat, place.lng + dLng, place.lat + dLat].map((n) => n.toFixed(6)).join(","));
    url.searchParams.set("limit", "200");
    p = fetch(url)
      .then(async (r) => {
        if (!r.ok) throw new Error(`Mapillary: HTTP ${r.status}`);
        const body: { data?: ApiImage[] } = await r.json();
        return pickImage(place, body.data ?? []);
      })
      .catch((e) => {
        found.delete(place.id);
        throw e;
      });
    found.set(place.id, p);
  }
  return p;
}

export const embedUrl = (image: MapillaryImage) => `https://www.mapillary.com/embed?image_key=${image.id}&style=photo`;
export const appUrl = (image: MapillaryImage) => `https://www.mapillary.com/app/?pKey=${image.id}&focus=photo`;
