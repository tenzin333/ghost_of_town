import { defineConfig } from "drizzle-kit";
import { DATABASE_URL } from "./src/env.ts";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./migrations",
  dbCredentials: { url: DATABASE_URL },
  // Supabase owns the auth/storage schemas and the anon/authenticated roles; only manage ours.
  schemaFilter: ["public"],
  entities: { roles: { provider: "supabase" } },
});
