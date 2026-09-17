# What Was Here?

GeoGuessr-style world map: drop a red pin anywhere and dig down through what used to be there.
The first dig site is central Bengaluru (the old Cantonment), with hand-researched stories. A pin anywhere else pulls live history from Wikidata, Wikipedia and Wikimedia Commons, clearly labelled "Not reviewed" ([0011](docs/decisions/0011-live-history-anywhere.md)). Those pins are also logged as demand for the next curated city.
It is a static site with 22 curated places and 40 sourced layers. It reads them from a Postgres + PostGIS database (Supabase) when configured, and from bundled JSON otherwise. Research is in [`research/`](research/).

**Docs:** [`docs/`](docs/): [progress log](docs/progress.md), [architecture](docs/architecture.md), [content rules](docs/content-rules.md), [decision records](docs/decisions/).

## Repo layout (pnpm workspace)

```
apps/
  web/                 Next.js map app (static export)      @wwh/web
packages/
  schema/              Zod schemas + shared types            @wwh/schema
  db/                  Drizzle schema, migrations, seed,     @wwh/db
                       API tests, local PostGIS + PostgREST
  ingest/              CSV → places.json, Commons media      @wwh/ingest
data/                  candidates.csv (source of truth),     @wwh/data
                       generated places.json + media.json
research/              competitor, source, licensing, go/no-go docs
docs/                  progress log, architecture, content rules, decision records
.github/workflows/     CI: data build + validation, typecheck, web build; database migrate + seed + API tests
```

## Run

Needs Node 24+ and pnpm (the version is pinned in `package.json`). If `pnpm` isn't found, run `corepack enable pnpm` (as admin) or `npm i -g pnpm`.

```bash
pnpm install
pnpm dev           # rebuild data, then http://localhost:3000
pnpm build         # rebuild data, then static export -> apps/web/out/
pnpm typecheck     # all packages
pnpm preview       # serve apps/web/out
```

Deploy `apps/web/out/` to any static host (Cloudflare Pages, Vercel, Netlify, GitHub Pages).

## Street View ("Today")

Tapping **Today** at the top of a place's stack shows the spot at street level as it is now ([0010](docs/decisions/0010-street-view-for-today.md)). It uses Google Street View first, then Mapillary photos, then a Google Maps link. With neither configured, it opens Google Maps Street View in a new tab. Set these in `apps/web/.env.local` (see `apps/web/.env.example`), then restart `pnpm dev`:
- **`NEXT_PUBLIC_GOOGLE_MAPS_KEY`:**
  1. In Google Cloud, enable **Maps Embed API** and **Street View Static API** (both no-charge; the project needs billing enabled).
  2. Create an API key restricted to those two APIs and to your site's HTTP referrers (plus `localhost:3000`).
- **`NEXT_PUBLIC_MAPILLARY_TOKEN`:** register an app at mapillary.com/dashboard/developers and copy its client token. Free. It also adds green photo-coverage lines on the map from zoom 13.

## Database (optional)

Without these steps the app uses the bundled `data/places.json`. Details: [docs/architecture.md](docs/architecture.md#database-built-step-1), [0009](docs/decisions/0009-database-api-shape-and-fallback.md).

**Local** (needs Docker):

```bash
pnpm db:up         # PostGIS on :54322, REST API on http://localhost:54321
pnpm db:migrate    # apply packages/db/migrations
pnpm db:seed       # rebuild places.json, then sync it into the database (removes rows no longer in the CSV)
pnpm db:test       # API returns exactly places.json; drafts hidden; places_near
NEXT_PUBLIC_DATA_API_URL=http://localhost:54321 pnpm dev
```

**Supabase:**
1. Create a project. Put its **session pooler** connection string in `packages/db/.env` as `DATABASE_URL` (see `.env.example`). The direct `db.<ref>.supabase.co` host is IPv6-only and won't resolve on most networks, and `@` in the password must be written `%40`.
2. `pnpm db:migrate && pnpm db:seed && pnpm db:test`.
3. Build the web app with `NEXT_PUBLIC_DATA_API_URL=https://<project-ref>.supabase.co/rest/v1` and `NEXT_PUBLIC_DATA_API_KEY=<publishable key>`. The key is safe to ship: row-level security only allows reading published rows.

**Schema changes:** edit `packages/db/src/schema.ts`, then `pnpm db:generate` (CI fails if migrations are out of date). Put SQL functions in a custom migration: `pnpm --filter @wwh/db exec drizzle-kit generate --custom --name=<name>`. To hide a place or layer without deleting it, set its `status` to `draft`.

## Adding or editing history

All content lives in [`data/candidates.csv`](data/candidates.csv). Each row is one layer; rows with the same `place` stack together.

1. Add a row with `lat/lng`, `geo_precision`, `year_start`/`year_end`, `type`, `hook`, `source_urls` (separate several with `;`), `wow` (1–5) and `confidence`.
2. Write the `story` (≤ 80 words) **only from what the sources say**. A row without a story is treated as unverified and left out of the app.
   - `confidence`: `verified` · `disputed` (the story must say how sources disagree) · `legend` (reported lore, shown with a "Local legend" badge) · `likely` (kept out of the app).
3. For an image, put the Wikimedia Commons file page in `media_url`, then run `pnpm media` to download the thumbnail into `apps/web/public/media` and record its credit and licence. Use only PD/CC files (see `research/licensing.md`).
4. Run `pnpm data`. It validates everything with Zod ([packages/schema](packages/schema/src/index.ts)) and writes `data/places.json`. CI fails if `places.json` wasn't regenerated.

URLs containing commas must encode them as `%2C` so the CSV parses.

## Validation analytics

Events: `session_start`, `data_error`, `live_search`, `map_feature_click`, `map_place_open`, `street_view_open`, `street_view_result`, `street_view_external`, `pin_drop`, `fly_to_area`, `place_open` (with `via` and `self_directed`), `layer_open`, `miss`, `out_of_area_attempt`, `era_change`, `share_click`, `source_click`, `session_end`.

- Set `NEXT_PUBLIC_UMAMI_WEBSITE_ID` at build time to send them to Umami Cloud (free tier).
- Add `?debug=1` to the URL to see the live event log on screen during a moderated test.
- The key signal is `place_open` with `self_directed: true`: someone finished a place and picked another on their own.

## Web app

- `apps/web/components/Explorer.tsx`: state, snapping, notices, analytics
- `apps/web/components/MapView.tsx`: MapLibre world map (OpenFreeMap Liberty basemap, red pin marker, Bengaluru hotspot at low zoom, density glow + place dots when zoomed in)
- `apps/web/components/LayerStack.tsx` / `LayerCard.tsx`: the dig-down stack and the layer detail
- `apps/web/lib/data.ts`: the only module that knows where data lives (database REST API or bundled JSON)

## Notes

- **Map worker:** MapLibre 6's worker URL isn't resolved correctly by Turbopack's static export, so `apps/web/scripts/vendor-maplibre.mjs` copies the worker into `public/maplibre/` and `MapView` calls `setWorkerUrl`.
- **Basemap:** [OpenFreeMap](https://openfreemap.org) is free, needs no key and allows commercial use; attribution is required. Carto's basemaps now need an API key.
- **pnpm build scripts:** pnpm blocks dependency install scripts by default; `pnpm-workspace.yaml` allows only `esbuild` (needed by `tsx`).
