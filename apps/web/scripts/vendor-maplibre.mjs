// MapLibre 6 spawns a module worker via `new URL(..., import.meta.url)`, which Turbopack's static export
// resolves to the page URL. Ship the worker (and the shared chunk it imports) as plain static files instead.
import { copyFileSync, mkdirSync } from "node:fs";

const from = "node_modules/maplibre-gl/dist";
const to = "public/maplibre";
mkdirSync(to, { recursive: true });
for (const f of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) copyFileSync(`${from}/${f}`, `${to}/${f}`);
console.log("maplibre worker copied to", to);
