// Runs against a migrated + seeded database (local by default). Checks the SQL API returns exactly what the
// static JSON app uses, that the public role only sees published rows, and that places_near is right.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MapIndex, Place, Places, type Place as PlaceT } from "@wwh/schema";
import postgres from "postgres";
import { DATABASE_URL } from "../src/env.ts";

const expected: PlaceT[] = Places.parse(JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../data/places.json"), "utf8")));
const sql = postgres(DATABASE_URL, { max: 1, onnotice: () => {} });

/** Run a query as the public role (what the browser gets), inside a transaction that is always rolled back. */
async function asAnon<T>(fn: (q: postgres.TransactionSql) => Promise<T>): Promise<T> {
  let result!: T;
  await sql
    .begin(async (q) => {
      await q`set local role anon`;
      result = await fn(q);
      throw new Rollback();
    })
    .catch((e) => { if (!(e instanceof Rollback)) throw e; });
  return result;
}
class Rollback extends Error {}

const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);
const sortedIds = (rows: { id: string }[]) => rows.map((r) => r.id).sort();

before(async () => {
  const [{ n }] = await sql`select count(*)::int as n from places`;
  assert.ok(n > 0, "database is empty: run `pnpm db:migrate && pnpm db:seed` first");
});
after(() => sql.end());

describe("place_detail", () => {
  test("returns every place exactly as in places.json", async () => {
    await asAnon(async (q) => {
      for (const place of expected) {
        const [{ detail }] = await q`select place_detail(${place.id}) as detail`;
        assert.deepEqual(Place.parse(detail), place, place.id);
      }
    });
  });

  test("returns null for an unknown place", async () => {
    const [{ detail }] = await asAnon((q) => q`select place_detail('nope') as detail`);
    assert.equal(detail, null);
  });
});

describe("map_index", () => {
  test("lists every place with layer years and wow in stack order", async () => {
    const [{ index }] = await asAnon((q) => q`select map_index() as index`);
    const want = expected
      .map((p) => ({
        id: p.id, name: p.name, lat: p.lat, lng: p.lng, geoPrecision: p.geoPrecision,
        // Undated ends are omitted, not undefined.
        layers: p.layers.map(({ yearStart, yearEnd, wow }) => JSON.parse(JSON.stringify({ yearStart, yearEnd, wow }))),
      }))
      .sort(byId);
    assert.deepEqual(MapIndex.parse(index).sort(byId), want);
  });
});

describe("row-level security", () => {
  const draftPlace = expected[0];
  const draftLayer = expected.find((p) => p.layers.length > 1)!;

  test("a draft place disappears from every public read", async () => {
    await asAnon(async (q) => {
      await q`reset role`;
      await q`update places set status = 'draft' where id = ${draftPlace.id}`;
      await q`set local role anon`;
      const [{ index }] = await q`select map_index() as index`;
      assert.ok(!(index as { id: string }[]).some((p) => p.id === draftPlace.id));
      const [{ detail }] = await q`select place_detail(${draftPlace.id}) as detail`;
      assert.equal(detail, null);
      const ids = draftPlace.layers.map((l) => l.id);
      assert.equal((await q`select 1 from layers where id in ${q(ids)}`).length, 0);
      assert.equal((await q`select 1 from layer_sources where layer_id in ${q(ids)}`).length, 0);
    });
  });

  test("a draft layer is hidden but the rest of its place stays", async () => {
    const hidden = draftLayer.layers[0];
    await asAnon(async (q) => {
      await q`reset role`;
      await q`update layers set status = 'draft' where id = ${hidden.id}`;
      await q`set local role anon`;
      const [{ detail }] = await q`select place_detail(${draftLayer.id}) as detail`;
      assert.deepEqual(sortedIds((detail as PlaceT).layers), sortedIds(draftLayer.layers.slice(1)));
      assert.equal((await q`select 1 from media where layer_id = ${hidden.id}`).length, 0);
    });
  });

  test("the public role cannot write", async () => {
    await assert.rejects(asAnon((q) => q`update places set name = 'x'`), /permission denied/);
    await assert.rejects(asAnon((q) => q`delete from layers`), /permission denied/);
    await assert.rejects(asAnon((q) => q`insert into sources (url, label) values ('https://x.org', 'x')`), /permission denied/);
  });
});

describe("places_near", () => {
  const origin = expected[0];

  test("finds the place itself at ~0 m, then others nearest first within the radius", async () => {
    const rows = await asAnon((q) => q`select * from places_near(${origin.lat}, ${origin.lng}, 1500)`);
    assert.equal(rows[0].id, origin.id);
    assert.ok(rows[0].metres < 1);
    const metres = rows.map((r) => r.metres as number);
    assert.deepEqual(metres, [...metres].sort((a, b) => a - b));
    assert.ok(metres.every((m) => m <= 1500));
  });

  test("an empty spot far away finds nothing", async () => {
    const rows = await asAnon((q) => q`select * from places_near(0, 0, 5000)`);
    assert.equal(rows.length, 0);
  });

  test("era filter keeps only places with a layer in that span", async () => {
    const [from, to] = [1800, 1899];
    const inEra = expected.filter((p) =>
      p.layers.some((l) => {
        const s = l.yearStart ?? l.yearEnd, e = l.yearEnd ?? l.yearStart;
        return s !== undefined && e !== undefined && s <= to && e >= from;
      }),
    );
    const rows = await asAnon((q) => q`select * from places_near(${origin.lat}, ${origin.lng}, 50000, ${from}, ${to}, 100)`);
    assert.deepEqual(sortedIds(rows as unknown as { id: string }[]), sortedIds(inEra));
  });
});
