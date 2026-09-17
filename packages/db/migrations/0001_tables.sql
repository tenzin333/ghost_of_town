CREATE TYPE "public"."confidence" AS ENUM('verified', 'disputed', 'legend');--> statement-breakpoint
CREATE TYPE "public"."geo_precision" AS ENUM('exact', 'building', 'street', 'area');--> statement-breakpoint
CREATE TYPE "public"."layer_type" AS ENUM('building', 'business', 'cinema', 'event', 'photo', 'map', 'street', 'story');--> statement-breakpoint
CREATE TYPE "public"."publish_status" AS ENUM('draft', 'published');--> statement-breakpoint
CREATE TABLE "layer_sources" (
	"layer_id" text NOT NULL,
	"source_id" integer NOT NULL,
	"position" smallint NOT NULL,
	CONSTRAINT "layer_sources_layer_id_source_id_pk" PRIMARY KEY("layer_id","source_id")
);
--> statement-breakpoint
ALTER TABLE "layer_sources" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "layers" (
	"id" text PRIMARY KEY NOT NULL,
	"place_id" text NOT NULL,
	"year_start" integer,
	"year_end" integer,
	"date_precision" text NOT NULL,
	"type" "layer_type" NOT NULL,
	"title" text NOT NULL,
	"hook" text DEFAULT '' NOT NULL,
	"story" text NOT NULL,
	"confidence" "confidence" NOT NULL,
	"wow" smallint NOT NULL,
	"status" "publish_status" DEFAULT 'published' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "layers_wow_range" CHECK ("layers"."wow" between 1 and 5),
	CONSTRAINT "layers_years_ordered" CHECK ("layers"."year_start" is null or "layers"."year_end" is null or "layers"."year_end" >= "layers"."year_start")
);
--> statement-breakpoint
ALTER TABLE "layers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "media" (
	"layer_id" text PRIMARY KEY NOT NULL,
	"src" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"credit" text NOT NULL,
	"licence" text NOT NULL,
	"licence_url" text,
	"source_url" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "media" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "places" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"city" text DEFAULT 'bengaluru' NOT NULL,
	"location" geography(Point,4326) NOT NULL,
	"geo_precision" "geo_precision" NOT NULL,
	"status" "publish_status" DEFAULT 'published' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "places" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sources" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sources_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"url" text NOT NULL,
	"label" text NOT NULL,
	CONSTRAINT "sources_url_unique" UNIQUE("url")
);
--> statement-breakpoint
ALTER TABLE "sources" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "layer_sources" ADD CONSTRAINT "layer_sources_layer_id_layers_id_fk" FOREIGN KEY ("layer_id") REFERENCES "public"."layers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "layer_sources" ADD CONSTRAINT "layer_sources_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "layers" ADD CONSTRAINT "layers_place_id_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_layer_id_layers_id_fk" FOREIGN KEY ("layer_id") REFERENCES "public"."layers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "layer_sources_source_id_idx" ON "layer_sources" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "layers_place_id_idx" ON "layers" USING btree ("place_id");--> statement-breakpoint
CREATE INDEX "places_location_idx" ON "places" USING gist ("location");--> statement-breakpoint
CREATE POLICY "layer_sources_public_read" ON "layer_sources" AS PERMISSIVE FOR SELECT TO "anon", "authenticated" USING (exists (select 1 from layers l where l.id = "layer_sources"."layer_id"));--> statement-breakpoint
CREATE POLICY "layers_public_read" ON "layers" AS PERMISSIVE FOR SELECT TO "anon", "authenticated" USING ("layers"."status" = 'published' and exists (select 1 from places p where p.id = "layers"."place_id"));--> statement-breakpoint
CREATE POLICY "media_public_read" ON "media" AS PERMISSIVE FOR SELECT TO "anon", "authenticated" USING (exists (select 1 from layers l where l.id = "media"."layer_id"));--> statement-breakpoint
CREATE POLICY "places_public_read" ON "places" AS PERMISSIVE FOR SELECT TO "anon", "authenticated" USING ("places"."status" = 'published');--> statement-breakpoint
CREATE POLICY "sources_public_read" ON "sources" AS PERMISSIVE FOR SELECT TO "anon", "authenticated" USING (true);