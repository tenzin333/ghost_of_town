// DATABASE_URL comes from the environment, packages/db/.env.local or packages/db/.env (first wins). Without one,
// everything targets the local docker stack (compose.yaml), so a forgotten variable can never write to the hosted database.
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// drizzle-kit loads its config as CommonJS, where import.meta is empty.
for (const name of [".env.local", ".env"]) {
  const envFile = resolve(import.meta.dirname ?? __dirname, "..", name);
  if (existsSync(envFile)) process.loadEnvFile(envFile); // never overrides variables that are already set
}

export const LOCAL_DATABASE_URL = "postgres://postgres:postgres@localhost:54322/postgres";
export const DATABASE_URL = process.env.DATABASE_URL ?? LOCAL_DATABASE_URL;
