// The only way Node code (seed, tests, future ingest jobs) talks to the database.
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { DATABASE_URL } from "./env.ts";
import * as schema from "./schema.ts";

export function connect(url = DATABASE_URL) {
  const client = postgres(url, { max: 1, onnotice: () => {} });
  return { db: drizzle(client, { schema }), client, close: () => client.end() };
}

export { schema };
export { DATABASE_URL, LOCAL_DATABASE_URL } from "./env.ts";
