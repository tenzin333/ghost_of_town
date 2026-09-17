// "Today" = how a place looks now. Best available source: Google Street View, then Mapillary, then nothing.
import type { LngLat } from "./geo";
import { findPano, GOOGLE_KEYLESS_DEV, GOOGLE_STREET_VIEW, type Pano } from "./streetview";
import { findImage, MAPILLARY, type MapillaryImage } from "./mapillary";

/** True when "Today" can be shown inside the app; otherwise it links out to Google Maps. */
export const TODAY_IN_APP = GOOGLE_STREET_VIEW || MAPILLARY || GOOGLE_KEYLESS_DEV;

export type Today = { source: "google"; pano: Pano } | { source: "mapillary"; image: MapillaryImage };

/** null = no imagery from any configured source. Rejects only if every configured source failed. */
export async function findToday(place: LngLat & { id: string }): Promise<Today | null> {
  let failure: unknown;
  if (GOOGLE_STREET_VIEW) {
    try {
      const pano = await findPano(place);
      if (pano) return { source: "google", pano };
    } catch (e) {
      failure = e;
    }
  }
  if (MAPILLARY) {
    try {
      const image = await findImage(place);
      if (image) return { source: "mapillary", image };
      failure = undefined; // a clean "no photos" answer beats an earlier Google error
    } catch (e) {
      failure ??= e;
    }
  }
  if (failure) throw failure;
  return null;
}
