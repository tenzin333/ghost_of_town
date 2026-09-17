// One-off: download Commons thumbnails for every media_url in candidates.csv into public/media,
// recording credit + licence in data/media.json. Re-run only when media_url values change.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { parse } from "csv-parse/sync";
import { CANDIDATES_CSV, MEDIA_JSON, WEB_PUBLIC } from "./paths.mts";

const UA = "WhatWasHere/0.1 (prototype; tenthinlay007@gmail.com)";
const WIDTH = 1200;

type Row = Record<string, string>;
const rows: Row[] = parse(readFileSync(CANDIDATES_CSV), { columns: true });
mkdirSync(`${WEB_PUBLIC}/media`, { recursive: true });

const stripHtml = (s = "") =>
  s.replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
    .replace(/\s+/g, " ").trim()
    .replace(/^(.+?)\s*\1$/, "$1"); // Commons often renders "Unknown author" twice
const out: Record<string, unknown> = existsSync(MEDIA_JSON)
  ? JSON.parse(readFileSync(MEDIA_JSON, "utf8"))
  : {};

for (const r of rows) {
  if (!r.media_url || !r.story) continue;
  const title = decodeURIComponent(r.media_url.split("/wiki/")[1]);
  const api = new URL("https://commons.wikimedia.org/w/api.php");
  Object.entries({
    action: "query", titles: title, prop: "imageinfo", iiprop: "url|extmetadata|size",
    iiurlwidth: String(WIDTH), format: "json",
  }).forEach(([k, v]) => api.searchParams.set(k, v));

  const data = await (await fetch(api, { headers: { "User-Agent": UA } })).json();
  const page: any = Object.values(data.query.pages)[0];
  const ii = page.imageinfo?.[0];
  if (!ii) { console.warn("missing on Commons:", title); continue; }
  const em = ii.extmetadata ?? {};

  const ext = new URL(ii.thumburl).pathname.split(".").pop()!.toLowerCase().replace("jpeg", "jpg");
  const file = `media/${r.id}.${ext}`;
  const img = await fetch(ii.thumburl, { headers: { "User-Agent": UA } });
  if (!img.ok) { console.warn("download failed", title, img.status); continue; }
  writeFileSync(`${WEB_PUBLIC}/${file}`, Buffer.from(await img.arrayBuffer()));

  out[r.id] = {
    src: `/${file}`,
    width: ii.thumbwidth,
    height: ii.thumbheight,
    credit: stripHtml(em.Artist?.value) || "Unknown",
    licence: em.LicenseShortName?.value ?? r.licence,
    licenceUrl: em.LicenseUrl?.value,
    sourceUrl: ii.descriptionurl,
  };
  console.log("ok", r.id, title);
  await new Promise((res) => setTimeout(res, 300));
}

writeFileSync(MEDIA_JSON, JSON.stringify(out, null, 2));
