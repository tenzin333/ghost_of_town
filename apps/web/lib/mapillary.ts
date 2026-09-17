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
 * How well one photo shows the place, ignoring its age: near, and a 360° pano or pointing at it. Lower is better.
 * `null` = too far away, or no usable position. Photos facing away carry a large penalty rather than being dropped,
 * so they still win when nothing else exists (the viewer lets people turn and step along the street).
 */
function score(place: LngLat, i: ApiImage): { image: MapillaryImage; view: number; ageYears: number } | null {
  const coords = (i.computed_geometry ?? i.geometry)?.coordinates;
  if (!coords) return null;
  const at = { lng: coords[0], lat: coords[1] };
  const metres = distance(at, place);
  if (metres > SEARCH_METRES) return null;
  const compass = i.computed_compass_angle ?? i.compass_angle;
  const offAxis = i.is_pano || compass === undefined || metres < 5 ? 0 : angleBetween(compass, bearing(at, place));
  return {
    image: { id: i.id, ...at, metres, capturedAt: i.captured_at, isPano: Boolean(i.is_pano), creator: i.creator?.username },
    view: metres + offAxis * 0.5 + (i.is_pano ? 0 : 15) + (offAxis > MAX_OFF_AXIS ? 1000 : 0),
    ageYears: i.captured_at ? (Date.now() - i.captured_at) / 3.15e10 : 10,
  };
}

/**
 * Pick the photo that best shows the place *now*: the view score, with recent photos preferred. Exported for tests.
 */
export function pickImage(place: LngLat, images: ApiImage[]): MapillaryImage | null {
  let best: { image: MapillaryImage; score: number } | undefined;
  for (const i of images) {
    const s = score(place, i);
    if (!s) continue;
    const total = s.view + s.ageYears * 2;
    if (!best || total < best.score) best = { score: total, image: s.image };
  }
  return best?.image ?? null;
}

/**
 * Close enough that the photo actually shows the place rather than the street nearby. Measured over the 22 curated
 * places (2026-09-17): only 12 of 92 year-photos fall within 30 m and 53 are beyond 90 m, so most years are a view
 * *near* the place, not of it. Capping at this distance would drop 18/22 timelines to 8, so instead the far ones are
 * kept and labelled — the same choice the project makes for `unreviewed` history and street-level geo precision.
 */
export const NEAR_METRES = 60;
/** A 360° photo can be turned towards the place, so it stays useful further out. */
const NEAR_PANO_METRES = 90;

export const showsPlace = (i: MapillaryImage) => i.metres <= NEAR_METRES || (i.isPano && i.metres <= NEAR_PANO_METRES);

/** One photo of the place per year, newest year first: the recent end of the place's biography (see docs 0013). */
export type YearView = { year: number; image: MapillaryImage; near: boolean };

/**
 * Best photo for each year that has one. Age is deliberately ignored here — within a single year the only question
 * is which photo shows the place best. Exported for tests.
 */
export function pickYears(place: LngLat, images: ApiImage[]): YearView[] {
  const best = new Map<number, { image: MapillaryImage; view: number }>();
  for (const i of images) {
    if (!i.captured_at) continue; // an undated photo can't sit on a timeline
    const s = score(place, i);
    if (!s) continue;
    const year = new Date(i.captured_at).getUTCFullYear();
    const current = best.get(year);
    if (!current || s.view < current.view) best.set(year, { image: s.image, view: s.view });
  }
  return [...best.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([year, { image }]) => ({ year, image, near: showsPlace(image) }));
}

/** Every photo around the place, fetched once per place and shared by "today" and the year timeline. */
const found = new Map<string, Promise<ApiImage[]>>();
function fetchImages(place: LngLat & { id: string }): Promise<ApiImage[]> {
  let p = found.get(place.id);
  if (!p) {
    const dLat = SEARCH_METRES / 111_320;
    const dLng = dLat / Math.cos((place.lat * Math.PI) / 180);
    const url = new URL("https://graph.mapillary.com/images");
    url.searchParams.set("access_token", TOKEN!);
    url.searchParams.set("fields", "id,computed_geometry,geometry,captured_at,compass_angle,computed_compass_angle,is_pano,creator");
    url.searchParams.set("bbox", [place.lng - dLng, place.lat - dLat, place.lng + dLng, place.lat + dLat].map((n) => n.toFixed(6)).join(","));
    // Must be high enough to return *every* photo in the box, not a page of them: a truncated response is also an
    // unstable one (measured 2026-09-17 at Rex Theatre — limit 500 gave 189 images and a year list that changed
    // between reloads; limit 1000+ gave all 202 and the same nine years three times running). The API returns no
    // paging cursor, so the limit is the only lever.
    url.searchParams.set("limit", "2000");
    p = fetch(url)
      .then(async (r) => {
        if (!r.ok) throw new Error(`Mapillary: HTTP ${r.status}`);
        const body: { data?: ApiImage[] } = await r.json();
        return body.data ?? [];
      })
      .catch((e) => {
        found.delete(place.id);
        throw e;
      });
    found.set(place.id, p);
  }
  return p;
}

export const findImage = (place: LngLat & { id: string }): Promise<MapillaryImage | null> =>
  fetchImages(place).then((images) => pickImage(place, images));

/** The place year by year, newest first. Empty when Mapillary has no dated photos near it. */
export const findYears = (place: LngLat & { id: string }): Promise<YearView[]> =>
  fetchImages(place).then((images) => pickYears(place, images));

export const embedUrl = (image: MapillaryImage) => `https://www.mapillary.com/embed?image_key=${image.id}&style=photo`;
export const appUrl = (image: MapillaryImage) => `https://www.mapillary.com/app/?pKey=${image.id}&focus=photo`;
