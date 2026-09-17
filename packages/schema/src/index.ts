import { z } from "zod";

export const GeoPrecision = z.enum(["exact", "building", "street", "area"]);
// verified = sourced; disputed = sources disagree (story says how); legend = reported lore, labelled as such.
export const CuratedConfidence = z.enum(["verified", "disputed", "legend"]);
// unreviewed = pulled live from Wikidata/Wikipedia/Commons for a pin; never stored, never in candidates.csv.
export const Confidence = z.enum([...CuratedConfidence.options, "unreviewed"]);
export const LayerType = z.enum(["building", "business", "cinema", "event", "photo", "map", "street", "story"]);

export const Media = z.object({
  src: z.string(),
  width: z.number(),
  height: z.number(),
  credit: z.string(),
  licence: z.string(),
  licenceUrl: z.string().optional(),
  sourceUrl: z.url(),
});

export const Layer = z.object({
  id: z.string(),
  yearStart: z.number().int().optional(),
  yearEnd: z.number().int().optional(),
  datePrecision: z.string(),
  type: LayerType,
  title: z.string().min(1),
  hook: z.string(),
  story: z.string().min(1).refine((s) => s.split(/\s+/).length <= 90, "story over 90 words"),
  media: Media.optional(),
  sources: z.array(z.object({ label: z.string(), url: z.url() })).min(1),
  confidence: Confidence,
  wow: z.number().int().min(1).max(5),
});

export const Place = z.object({
  id: z.string(),
  name: z.string(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  geoPrecision: GeoPrecision,
  layers: z.array(Layer).min(1),
  /** Pulled live for a pin (see apps/web/lib/live.ts), not curated. */
  live: z.boolean().optional(),
  /** Map facts for places clicked on the basemap (OpenStreetMap): what it is and where. Not history. */
  info: z
    .object({ category: z.string().optional(), address: z.string().optional(), osmUrl: z.string().optional(), website: z.string().optional() })
    .optional(),
});

/** Hand-researched places: the curated dig site only, and never unreviewed layers. */
export const CuratedPlace = Place.omit({ live: true, info: true }).extend({
  lat: z.number().min(12.9).max(13.1),
  lng: z.number().min(77.5).max(77.7),
  layers: z.array(Layer.extend({ confidence: CuratedConfidence })).min(1),
});

export const Places = z.array(CuratedPlace);

/** What the map loads up front: enough to draw, filter by era and snap pins. Full stories load per place. */
export const PlaceSummary = Place.pick({ id: true, name: true, lat: true, lng: true, geoPrecision: true, live: true }).extend({
  layers: z.array(Layer.pick({ yearStart: true, yearEnd: true, wow: true })).min(1),
});
export const MapIndex = z.array(PlaceSummary);

export type Media = z.infer<typeof Media>;
export type Layer = z.infer<typeof Layer>;
export type Place = z.infer<typeof Place>;
export type PlaceSummary = z.infer<typeof PlaceSummary>;
