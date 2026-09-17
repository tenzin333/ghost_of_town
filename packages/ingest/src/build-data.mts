// Curated CSV -> validated data/places.json. Rows without a story (unverified) are skipped.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { parse } from "csv-parse/sync";
import { Places, type Place, type Layer } from "@wwh/schema";
import { CANDIDATES_CSV, MEDIA_JSON, PLACES_JSON } from "./paths.mts";

type Row = Record<string, string>;
const rows: Row[] = parse(readFileSync(CANDIDATES_CSV), { columns: true });
const media: Record<string, Layer["media"]> = existsSync(MEDIA_JSON)
  ? JSON.parse(readFileSync(MEDIA_JSON, "utf8"))
  : {};

const slug = (s: string) => s.toLowerCase().replace(/[''()]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const num = (s: string) => (s ? Number(s) : undefined);
const precisionRank = ["exact", "building", "street", "area"];

function sourceLabel(url: string) {
  const u = new URL(url);
  if (u.hostname.endsWith("wikipedia.org")) return "Wikipedia: " + decodeURIComponent(u.pathname.split("/wiki/")[1]).replace(/_/g, " ");
  if (u.hostname.endsWith("wikimedia.org")) return "Wikimedia Commons";
  if (u.hostname.endsWith("wikidata.org")) return "Wikidata";
  if (u.hostname.includes("thenewsminute")) return "The News Minute";
  if (u.hostname.includes("citizenmatters")) return "Citizen Matters";
  return u.hostname.replace(/^www\./, "");
}

const byPlace = new Map<string, Place>();
let skipped = 0;
for (const r of rows) {
  if (!r.story) { skipped++; continue; }
  const id = slug(r.place);
  const place = byPlace.get(id) ?? {
    id, name: r.place, lat: Number(r.lat), lng: Number(r.lng),
    geoPrecision: r.geo_precision as Place["geoPrecision"], layers: [],
  };
  if (precisionRank.indexOf(r.geo_precision) < precisionRank.indexOf(place.geoPrecision)) {
    Object.assign(place, { lat: Number(r.lat), lng: Number(r.lng), geoPrecision: r.geo_precision });
  }
  place.layers.push({
    id: r.id,
    yearStart: num(r.year_start),
    yearEnd: num(r.year_end),
    datePrecision: r.date_precision,
    type: r.type as Layer["type"],
    title: r.title,
    hook: r.hook,
    story: r.story,
    media: media[r.id],
    sources: r.source_urls.split(";").filter(Boolean).map((url) => ({ label: sourceLabel(url), url })),
    confidence: r.confidence as Layer["confidence"],
    wow: Number(r.wow),
  });
  byPlace.set(id, place);
}

// Newest layer first: the stack reads from the surface downward. "Until X" layers sit just below X;
// undated layers sink to the bottom.
const sortYear = (l: Layer) => l.yearStart ?? (l.yearEnd !== undefined ? l.yearEnd - 0.5 : -Infinity);
for (const p of byPlace.values()) p.layers.sort((a, b) => sortYear(b) - sortYear(a));

const places = Places.parse([...byPlace.values()]);
writeFileSync(PLACES_JSON, JSON.stringify(places, null, 1));
const layers = places.reduce((n, p) => n + p.layers.length, 0);
console.log(`places.json: ${places.length} places, ${layers} layers (${skipped} unverified rows skipped)`);
