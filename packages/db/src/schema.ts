// Tables, enums and row-level security. SQL functions the browser calls (map_index, place_detail, places_near)
// live in migrations/0002_api.sql because drizzle-kit can't express them.
import { sql } from "drizzle-orm";
import {
  check, customType, index, integer, pgEnum, pgPolicy, pgTable, primaryKey, smallint, text, timestamp,
} from "drizzle-orm/pg-core";
import { anonRole, authenticatedRole } from "drizzle-orm/supabase";
import { CuratedConfidence, GeoPrecision, LayerType } from "@wwh/schema";

/** WGS84 point stored as PostGIS geography, so distances come back in metres. Written as { lng, lat }. */
const point = customType<{ data: { lng: number; lat: number }; driverData: string }>({
  dataType: () => "geography(Point,4326)",
  toDriver: ({ lng, lat }) => sql`ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography` as unknown as string,
});

// Enum values come from the Zod schemas, so the app and the database can't drift apart.
const values = <T extends string>(e: { options: T[] }) => e.options as [T, ...T[]];
export const geoPrecision = pgEnum("geo_precision", values(GeoPrecision));
// Live "unreviewed" layers are never stored, so the database only knows the curated labels.
export const confidence = pgEnum("confidence", values(CuratedConfidence));
export const layerType = pgEnum("layer_type", values(LayerType));
/** Only `published` rows are visible to the public (anon) role. */
export const publishStatus = pgEnum("publish_status", ["draft", "published"]);

const publicRoles = [anonRole, authenticatedRole];
const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const places = pgTable(
  "places",
  {
    id: text().primaryKey(),
    name: text().notNull(),
    city: text().notNull().default("bengaluru"),
    location: point().notNull(),
    geoPrecision: geoPrecision("geo_precision").notNull(),
    status: publishStatus().notNull().default("published"),
    ...timestamps,
  },
  (t) => [
    index("places_location_idx").using("gist", t.location),
    pgPolicy("places_public_read", { for: "select", to: publicRoles, using: sql`${t.status} = 'published'` }),
  ],
).enableRLS();

export const layers = pgTable(
  "layers",
  {
    id: text().primaryKey(),
    placeId: text("place_id").notNull().references(() => places.id, { onDelete: "cascade" }),
    yearStart: integer("year_start"),
    yearEnd: integer("year_end"),
    datePrecision: text("date_precision").notNull(),
    type: layerType().notNull(),
    title: text().notNull(),
    hook: text().notNull().default(""),
    story: text().notNull(),
    confidence: confidence().notNull(),
    wow: smallint().notNull(),
    status: publishStatus().notNull().default("published"),
    ...timestamps,
  },
  (t) => [
    index("layers_place_id_idx").on(t.placeId),
    check("layers_wow_range", sql`${t.wow} between 1 and 5`),
    check("layers_years_ordered", sql`${t.yearStart} is null or ${t.yearEnd} is null or ${t.yearEnd} >= ${t.yearStart}`),
    // Policy subqueries run under the caller's RLS, so a draft place hides its layers too.
    pgPolicy("layers_public_read", {
      for: "select", to: publicRoles,
      using: sql`${t.status} = 'published' and exists (select 1 from places p where p.id = ${t.placeId})`,
    }),
  ],
).enableRLS();

/** One row per cited URL; many layers can rest on the same source. */
export const sources = pgTable(
  "sources",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    url: text().notNull().unique(),
    label: text().notNull(),
  },
  () => [pgPolicy("sources_public_read", { for: "select", to: publicRoles, using: sql`true` })],
).enableRLS();

export const layerSources = pgTable(
  "layer_sources",
  {
    layerId: text("layer_id").notNull().references(() => layers.id, { onDelete: "cascade" }),
    sourceId: integer("source_id").notNull().references(() => sources.id, { onDelete: "restrict" }),
    position: smallint().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.layerId, t.sourceId] }),
    index("layer_sources_source_id_idx").on(t.sourceId),
    pgPolicy("layer_sources_public_read", {
      for: "select", to: publicRoles, using: sql`exists (select 1 from layers l where l.id = ${t.layerId})`,
    }),
  ],
).enableRLS();

/** At most one image per layer for now. */
export const media = pgTable(
  "media",
  {
    layerId: text("layer_id").primaryKey().references(() => layers.id, { onDelete: "cascade" }),
    src: text().notNull(),
    width: integer().notNull(),
    height: integer().notNull(),
    credit: text().notNull(),
    licence: text().notNull(),
    licenceUrl: text("licence_url"),
    sourceUrl: text("source_url").notNull(),
  },
  (t) => [
    pgPolicy("media_public_read", {
      for: "select", to: publicRoles, using: sql`exists (select 1 from layers l where l.id = ${t.layerId})`,
    }),
  ],
).enableRLS();
