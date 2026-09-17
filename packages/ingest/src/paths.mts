// Scripts run from packages/ingest, but read and write the shared repo-level data and the web app's public media.
import { resolve } from "node:path";

export const ROOT = resolve(import.meta.dirname, "../../..");
export const DATA_DIR = resolve(ROOT, "data");
export const CANDIDATES_CSV = resolve(DATA_DIR, "candidates.csv");
export const PLACES_JSON = resolve(DATA_DIR, "places.json");
export const MEDIA_JSON = resolve(DATA_DIR, "media.json");
export const WEB_PUBLIC = resolve(ROOT, "apps/web/public");
