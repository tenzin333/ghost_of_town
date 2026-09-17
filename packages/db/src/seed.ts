// Sync data/places.json into the database in one transaction. While candidates.csv is the source of truth,
// the database mirrors it: places, layers and sources missing from the JSON are deleted. A row's publish status
// is left alone on update, so a place hidden as `draft` stays hidden.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { notInArray, sql } from "drizzle-orm";
import { Places } from "@wwh/schema";
import { connect, DATABASE_URL, LOCAL_DATABASE_URL } from "./index.ts";
import { layerSources, layers, media, places, sources } from "./schema.ts";

const PLACES_JSON = resolve(import.meta.dirname, "../../../data/places.json");
const data = Places.parse(JSON.parse(readFileSync(PLACES_JSON, "utf8")));
const allLayers = data.flatMap((p) => p.layers.map((l) => ({ ...l, placeId: p.id })));

const excluded = (column: string) => sql.raw(`excluded.${column}`);
const target = DATABASE_URL === LOCAL_DATABASE_URL ? "local database" : new URL(DATABASE_URL).host;
const { db, close } = connect();

try {
  const summary = await db.transaction(async (tx) => {
    await tx
      .insert(places)
      .values(data.map((p) => ({ id: p.id, name: p.name, location: { lng: p.lng, lat: p.lat }, geoPrecision: p.geoPrecision })))
      .onConflictDoUpdate({
        target: places.id,
        set: { name: excluded("name"), location: excluded("location"), geoPrecision: excluded("geo_precision"), updatedAt: sql`now()` },
      });

    await tx
      .insert(layers)
      .values(allLayers.map((l) => ({
        id: l.id, placeId: l.placeId, yearStart: l.yearStart, yearEnd: l.yearEnd, datePrecision: l.datePrecision,
        type: l.type, title: l.title, hook: l.hook, story: l.story, confidence: l.confidence, wow: l.wow,
      })))
      .onConflictDoUpdate({
        target: layers.id,
        set: {
          placeId: excluded("place_id"), yearStart: excluded("year_start"), yearEnd: excluded("year_end"),
          datePrecision: excluded("date_precision"), type: excluded("type"), title: excluded("title"), hook: excluded("hook"),
          story: excluded("story"), confidence: excluded("confidence"), wow: excluded("wow"), updatedAt: sql`now()`,
        },
      });

    const cited = new Map(allLayers.flatMap((l) => l.sources.map((s) => [s.url, s.label] as const)));
    const sourceRows = await tx
      .insert(sources)
      .values([...cited].map(([url, label]) => ({ url, label })))
      .onConflictDoUpdate({ target: sources.url, set: { label: excluded("label") } })
      .returning({ id: sources.id, url: sources.url });
    const sourceId = new Map(sourceRows.map((s) => [s.url, s.id]));

    // Links and images are replaced wholesale for the seeded layers.
    const layerIds = allLayers.map((l) => l.id);
    await tx.execute(sql`delete from layer_sources where layer_id in ${layerIds}`);
    await tx.insert(layerSources).values(
      allLayers.flatMap((l) => l.sources.map((s, position) => ({ layerId: l.id, sourceId: sourceId.get(s.url)!, position }))),
    );
    await tx.execute(sql`delete from media where layer_id in ${layerIds}`);
    const images = allLayers.filter((l) => l.media);
    if (images.length) await tx.insert(media).values(images.map((l) => ({ layerId: l.id, ...l.media! })));

    const prunedLayers = await tx.delete(layers).where(notInArray(layers.id, layerIds)).returning({ id: layers.id });
    const prunedPlaces = await tx.delete(places).where(notInArray(places.id, data.map((p) => p.id))).returning({ id: places.id });
    await tx.execute(sql`delete from sources s where not exists (select 1 from layer_sources x where x.source_id = s.id)`);

    return { sources: cited.size, images: images.length, prunedLayers: prunedLayers.length, prunedPlaces: prunedPlaces.length };
  });

  console.log(
    `Seeded ${target}: ${data.length} places, ${allLayers.length} layers, ${summary.sources} sources, ${summary.images} images` +
      (summary.prunedPlaces || summary.prunedLayers ? ` (removed ${summary.prunedPlaces} places, ${summary.prunedLayers} layers)` : ""),
  );
} finally {
  await close();
}
