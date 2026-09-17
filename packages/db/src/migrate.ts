// Apply migrations/ with drizzle-orm's migrator. (`drizzle-kit migrate` exits 1 without printing the error.)
import { resolve } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { connect, DATABASE_URL, LOCAL_DATABASE_URL } from "./index.ts";

const { db, close } = connect();
try {
  await migrate(db, { migrationsFolder: resolve(import.meta.dirname, "../migrations") });
  console.log(`Migrated ${DATABASE_URL === LOCAL_DATABASE_URL ? "local database" : new URL(DATABASE_URL).host}`);
} finally {
  await close();
}
